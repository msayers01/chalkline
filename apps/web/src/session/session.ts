import type { InkRegion, Stroke } from '@chalkline/ink';
import { newId } from '@chalkline/ir';
import type { BoardAdapter, BoardEvent, BoardStroke } from '../board/BoardAdapter.js';
import type { InkIn, InkOut } from '../workers/ink-protocol.js';
import { ApiProblem, type BoardApi, type RenderRequest, type RenderResult } from './api.js';
import type { BoardDb, RegionRow, RegionStatus, SessionRow } from './db.js';

/**
 * One board session: strokes from the board are stored, grouped into
 * regions by the ink worker, and each settled region is sent for
 * recognition once. The handout is built from the recognized blocks on
 * request.
 *
 * Local first: every stroke and region is written to IndexedDB before the
 * view changes or anything leaves the browser. Board events are handled one
 * at a time, in order, so an erase always sees the stroke it erases.
 */

/** Channel to the ink worker (a Worker in the browser, `InkCore` in tests). */
export interface InkChannel {
  send(message: InkIn): void;
  listen(listener: (message: InkOut) => void): void;
  close(): void;
}

export type SessionDeps = {
  db: BoardDb;
  api: BoardApi;
  ink: InkChannel;
  /** Draws a region's ink as a PNG (base64); undefined where there is no canvas. */
  renderCrop: (region: InkRegion) => Promise<string | undefined>;
  /** Wall clock in ms. */
  wallClock?: () => number;
  /** Runs `fn` after `ms`; returns a cancel function. */
  schedule?: (fn: () => void, ms: number) => () => void;
};

export type RegionView = {
  id: string;
  page: number;
  t0: number;
  status: RegionStatus;
  blocks: RegionRow['blocks'];
  failure?: string;
};

export type HandoutView =
  | { state: 'idle' }
  | { state: 'working' }
  | { state: 'done'; result: RenderResult; pdfUrl?: string }
  | { state: 'failed'; code: string };

export type SessionView = {
  sessionId: string;
  regions: RegionView[];
  /** Regions still being written (not settled yet). */
  openRegions: number;
  handout: HandoutView;
  /** A problem reaching the server, by `type` code. */
  problem?: string;
};

export type HandoutOptions = {
  preset: string;
  structurer: RenderRequest['structurer'];
  title: string;
};

/** How often the ink worker is told the time, so quiet regions settle. */
export const TICK_MS = 250;
/** Retries for a region whose recognition failed in a retryable way. */
const MAX_ATTEMPTS = 5;
const backoffMs = (attempt: number) => Math.min(60_000, 2_000 * 2 ** (attempt - 1));

export class BoardSession {
  private view: SessionView;
  private readonly listeners = new Set<() => void>();
  private queue: Promise<void> = Promise.resolve();
  private readonly timers = new Set<() => void>();
  private readonly wallClock: () => number;
  private readonly schedule: (fn: () => void, ms: number) => () => void;
  readonly clock: () => number;

  private constructor(
    private readonly deps: SessionDeps,
    readonly sessionId: string,
    readonly startedAt: number,
    regions: RegionRow[],
  ) {
    this.wallClock = deps.wallClock ?? Date.now;
    this.schedule =
      deps.schedule ??
      ((fn, ms) => {
        const id = setTimeout(fn, ms);
        return () => clearTimeout(id);
      });
    this.clock = () => Math.max(0, this.wallClock() - this.startedAt);
    this.view = {
      sessionId,
      regions: regions.map(viewOf).sort(byPosition),
      openRegions: 0,
      handout: { state: 'idle' },
    };
    deps.ink.listen((message) => this.enqueue(() => this.onInk(message)));
  }

  /** Opens the current session, or starts one (`fresh` always starts a new one). */
  static async open(deps: SessionDeps, options: { fresh?: boolean } = {}): Promise<BoardSession> {
    const { db } = deps;
    const now = (deps.wallClock ?? Date.now)();
    let row = options.fresh ? undefined : await db.sessions.where('current').equals(1).first();
    if (!row) {
      const created: SessionRow = { id: newId(now), startedAt: now, current: 1 };
      await db.transaction('rw', db.sessions, async () => {
        await db.sessions.where('current').equals(1).modify({ current: 0 });
        await db.sessions.add(created);
      });
      row = created;
    }
    const regions = await db.regions.where('sessionId').equals(row.id).toArray();
    const session = new BoardSession(deps, row.id, row.startedAt, regions);
    await session.resume(regions);
    return session;
  }

  /** Connects a board; returns a function that disconnects it. */
  attach(board: BoardAdapter): () => void {
    return board.subscribe((event) => {
      // The time it happened, not the time it is handled after earlier writes.
      const now = this.clock();
      this.enqueue(() => this.onBoard(event, now));
    });
  }

  /**
   * Called on every clock signal; lets quiet regions settle. Queued behind
   * board events, so a stroke still being stored is grouped before a tick
   * can close the region it belongs to.
   */
  tick(): void {
    const now = this.clock();
    this.enqueue(async () => this.deps.ink.send({ kind: 'tick', now }));
  }

  /** Closes every region still being written, so it is recognized now. */
  finishWriting(): void {
    const now = this.clock();
    this.enqueue(async () => this.deps.ink.send({ kind: 'flush', now }));
  }

  /** Sends regions that are waiting (recognition was off, or the server was down) again. */
  retry(): void {
    for (const region of this.view.regions) {
      if (region.status === 'waiting' || region.status === 'retrying') {
        void this.upload(region.id, { reset: true });
      }
    }
  }

  async makeHandout(options: HandoutOptions): Promise<void> {
    this.update({ handout: { state: 'working' } });
    const rows = await this.deps.db.regions.where('sessionId').equals(this.sessionId).toArray();
    const recognized = rows.filter((r) => r.status === 'recognized').sort(byRegionPosition);
    const crops: Record<string, string> = {};
    for (const row of recognized) {
      if (row.crop && row.blocks.some((b) => b.block.type === 'imageFallback')) {
        crops[row.id] = row.crop;
      }
    }
    try {
      const result = await this.deps.api.render(this.sessionId, {
        preset: options.preset,
        structurer: options.structurer,
        meta: { title: options.title, date: localDate(this.wallClock()), lang: 'en' },
        blocks: recognized.flatMap((r) => r.blocks),
        crops,
      });
      this.update({
        handout: {
          state: 'done',
          result,
          ...(result.exportId ? { pdfUrl: this.deps.api.exportUrl(result.exportId) } : {}),
        },
      });
    } catch (e) {
      this.update({ handout: { state: 'failed', code: problemCode(e) } });
    }
  }

  getView = (): SessionView => this.view;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Resolves when every queued board and ink event has been handled. */
  settled(): Promise<void> {
    return this.queue;
  }

  dispose(): void {
    for (const cancel of this.timers) cancel();
    this.timers.clear();
    this.deps.ink.close();
    this.listeners.clear();
  }

  private async resume(regions: RegionRow[]): Promise<void> {
    // Strokes written before a reload but not yet in a region are grouped again.
    const inRegion = new Set(regions.flatMap((r) => r.region.strokes.map((s) => s.id)));
    const strokes = await this.deps.db.strokes.where('sessionId').equals(this.sessionId).toArray();
    const now = this.clock();
    for (const row of strokes) {
      if (!row.erased && !inRegion.has(row.id)) {
        this.deps.ink.send({ kind: 'stroke', stroke: row.stroke, now });
      }
    }
    for (const region of regions) {
      if (region.status === 'recognizing' || region.status === 'retrying') {
        void this.upload(region.id);
      }
    }
  }

  private enqueue(task: () => Promise<void>): void {
    // A failing task must not stop the ones after it.
    this.queue = this.queue.then(task).catch(() => {
      this.update({ problem: 'storage' });
    });
  }

  private async onBoard(event: BoardEvent, now: number): Promise<void> {
    if (event.kind === 'strokeEnded') return this.onStroke(event.stroke, now);
    const rows = await this.deps.db.strokes.where('boardKey').anyOf(event.boardKeys).toArray();
    const mine = rows.filter((r) => r.sessionId === this.sessionId && !r.erased);
    if (mine.length === 0) return;
    await this.deps.db.strokes.bulkUpdate(
      mine.map((r) => ({ key: r.id, changes: { erased: true } })),
    );
    this.deps.ink.send({ kind: 'erase', strokeIds: mine.map((r) => r.id), now });
  }

  private async onStroke(board: BoardStroke, now: number): Promise<void> {
    const stroke: Stroke = {
      id: newId(this.wallClock()),
      page: board.page,
      tool: board.tool,
      color: board.color,
      width: board.width,
      points: board.points,
    };
    await this.deps.db.strokes.add({
      id: stroke.id,
      sessionId: this.sessionId,
      boardKey: board.boardKey,
      stroke,
      erased: false,
    });
    this.deps.ink.send({ kind: 'stroke', stroke, now });
  }

  private async onInk(message: InkOut): Promise<void> {
    if (message.kind === 'open') {
      if (message.count !== this.view.openRegions) this.update({ openRegions: message.count });
      return;
    }
    const { region } = message;
    const crop = await this.deps.renderCrop(region).catch(() => undefined);
    const row: RegionRow = {
      id: region.id,
      sessionId: this.sessionId,
      region,
      status: 'recognizing',
      blocks: [],
      attempts: 0,
      ...(crop ? { crop } : {}),
    };
    const { db } = this.deps;
    await db.transaction('rw', db.regions, async () => {
      await db.regions.put(row);
      if (region.replaces) await db.regions.update(region.replaces, { status: 'replaced' });
    });
    this.setRegions((regions) => [
      ...regions.map((r) => (r.id === region.replaces ? { ...r, status: 'replaced' as const } : r)),
      viewOf(row),
    ]);
    void this.upload(region.id);
  }

  private async upload(regionId: string, options: { reset?: boolean } = {}): Promise<void> {
    const { db, api } = this.deps;
    const row = await db.regions.get(regionId);
    if (!row || row.status === 'replaced' || row.status === 'recognized') return;
    const attempts = (options.reset ? 0 : row.attempts) + 1;
    await this.store(regionId, { status: 'recognizing', attempts });

    let changes: Partial<RegionRow>;
    try {
      const result = await api.recognize(this.sessionId, row.region, []);
      if (result.failure?.retryable && attempts < MAX_ATTEMPTS) {
        changes = { status: 'retrying', failure: result.failure.code };
        this.later(() => void this.upload(regionId), backoffMs(attempts));
      } else {
        changes = { status: 'recognized', blocks: result.blocks };
        if (result.failure) changes.failure = result.failure.code;
      }
      if (this.view.problem) this.update({ problem: undefined });
    } catch (e) {
      const code = problemCode(e);
      changes = { status: 'waiting', failure: code };
      if (code === 'network') this.update({ problem: code });
      // The server may be restarting: try again on its own; the teacher can also press retry.
      if (code === 'network' && attempts < MAX_ATTEMPTS) {
        this.later(() => void this.upload(regionId), backoffMs(attempts));
      }
    }
    await this.store(regionId, changes);
  }

  /** Writes a region change, then shows it. */
  private async store(regionId: string, changes: Partial<RegionRow>): Promise<void> {
    await this.deps.db.regions.update(regionId, changes);
    const row = await this.deps.db.regions.get(regionId);
    if (!row) return;
    this.setRegions((regions) => regions.map((r) => (r.id === regionId ? viewOf(row) : r)));
  }

  private later(fn: () => void, ms: number): void {
    const cancel = this.schedule(() => {
      this.timers.delete(cancel);
      fn();
    }, ms);
    this.timers.add(cancel);
  }

  private setRegions(change: (regions: RegionView[]) => RegionView[]): void {
    this.update({ regions: change(this.view.regions).sort(byPosition) });
  }

  private update(changes: { [K in keyof SessionView]?: SessionView[K] | undefined }): void {
    const next = { ...this.view, ...changes } as SessionView;
    if ('problem' in changes && changes.problem === undefined) delete next.problem;
    this.view = next;
    for (const listener of this.listeners) listener();
  }
}

function viewOf(row: RegionRow): RegionView {
  return {
    id: row.id,
    page: row.region.page,
    t0: row.region.t0,
    status: row.status,
    blocks: row.blocks,
    ...(row.failure ? { failure: row.failure } : {}),
  };
}

const byPosition = (a: RegionView, b: RegionView) => a.page - b.page || a.t0 - b.t0;
const byRegionPosition = (a: RegionRow, b: RegionRow) =>
  a.region.page - b.region.page || a.region.t0 - b.region.t0;

function problemCode(e: unknown): string {
  return e instanceof ApiProblem ? e.type : 'internal';
}

/** yyyy-mm-dd in the teacher's time zone. */
function localDate(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
