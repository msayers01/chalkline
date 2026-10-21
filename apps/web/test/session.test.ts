import 'fake-indexeddb/auto';
import { INK_PARAMS, type InkRegion } from '@chalkline/ink';
import { sequentialIds } from '@chalkline/ir';
import { beforeEach, describe, expect, it } from 'vitest';
import type { BoardAdapter, BoardEvent, BoardStroke } from '../src/board/BoardAdapter.js';
import {
  ApiProblem,
  type BoardApi,
  type Health,
  type RegionResult,
  type RenderRequest,
  type RenderResult,
} from '../src/session/api.js';
import { BoardDb } from '../src/session/db.js';
import { BoardSession, type InkChannel } from '../src/session/session.js';
import { InkCore, type InkOut } from '../src/workers/ink-protocol.js';

/** The ink worker, in process: answers on a later microtask like a real worker. */
function inProcessInk(sent: string[]): InkChannel {
  const core = new InkCore();
  let listener: (m: InkOut) => void = () => undefined;
  return {
    send: (message) => {
      sent.push(message.kind);
      const out = core.handle(message);
      queueMicrotask(() => out.forEach((m) => listener(m)));
    },
    listen: (l) => (listener = l),
    close: () => undefined,
  };
}

class FakeBoard implements BoardAdapter {
  private listener: (e: BoardEvent) => void = () => undefined;
  private n = 0;
  constructor(readonly clock: () => number) {}
  subscribe(listener: (e: BoardEvent) => void) {
    this.listener = listener;
    return () => undefined;
  }
  /** A stroke written at (x, y), ending now. */
  write(x: number, y: number): BoardStroke {
    const t = this.clock();
    const stroke: BoardStroke = {
      boardKey: `shape:${(this.n += 1)}`,
      page: 0,
      tool: 'pen',
      color: 'black',
      width: 3,
      points: [
        { x, y, p: 0.5, t: Math.max(0, t - 100) },
        { x: x + 30, y: y + 40, p: 0.5, t },
      ],
    };
    this.listener({ kind: 'strokeEnded', stroke });
    return stroke;
  }
  erase(...boardKeys: string[]) {
    this.listener({ kind: 'erased', boardKeys });
  }
}

type Answer = RegionResult['blocks'] | ApiProblem | { code: string; retryable: boolean };

/** Recognizes each region with the next scripted answer. */
class ScriptedApi implements BoardApi {
  calls: string[] = [];
  renders: RenderRequest[] = [];
  private readonly blockIds = sequentialIds('01JBLK');
  constructor(public answers: Answer[]) {}

  async health(): Promise<Health> {
    return { recognition: 'live', claude: false, tex: false, sandbox: null, presets: [] };
  }

  async recognize(_session: string, region: InkRegion): Promise<RegionResult> {
    this.calls.push(region.id);
    const answer = this.answers.shift() ?? this.text('…');
    if (answer instanceof ApiProblem) throw answer;
    if (!Array.isArray(answer)) {
      return { regionId: region.id, blocks: [this.image(region)], failure: answer };
    }
    return {
      regionId: region.id,
      blocks: answer.map((b) => ({
        ...b,
        block: { ...b.block, provenance: provenanceOf(region) },
      })),
    };
  }

  async render(_session: string, request: RenderRequest): Promise<RenderResult> {
    this.renders.push(request);
    return {
      preset: request.preset,
      tex: '\\documentclass{article}',
      structuredBy: { by: 'heuristic' },
      counts: { ready: request.blocks.length, check: 0, image: 0, excluded: 0 },
      issues: [],
    };
  }

  exportUrl(id: string) {
    return `/v1/exports/${id}`;
  }

  text(text: string): RegionResult['blocks'] {
    return [
      {
        block: {
          id: this.blockIds(),
          type: 'paragraph',
          status: 'ready',
          // Replaced by the region's own when it is recognized.
          provenance: { source: 'board', regionIds: [], page: 0, bbox: BOX, t0: 0, t1: 0 },
          decided: { typeBy: 'heuristic', pinned: false },
          inlines: [{ kind: 'text', text }],
        },
        tags: [],
      },
    ];
  }

  private image(region: InkRegion): RegionResult['blocks'][number] {
    return {
      block: {
        id: this.blockIds(),
        type: 'imageFallback',
        status: 'image',
        provenance: provenanceOf(region),
        decided: { typeBy: 'heuristic', pinned: false },
        assetRef: `region-${region.id}`,
        reason: 'recognizerUnavailable',
      },
      tags: [],
    };
  }
}

const BOX = { x: 0, y: 0, w: 0, h: 0 };

function provenanceOf(region: InkRegion) {
  const { page, bbox, t0, t1 } = region;
  return { source: 'board' as const, regionIds: [region.id], page, bbox, t0, t1 };
}

let dbCount = 0;

async function setup(answers: (api: ScriptedApi) => Answer[]) {
  const db = new BoardDb(`test-${(dbCount += 1)}`);
  const api = new ScriptedApi([]);
  api.answers = answers(api);
  let wall = 1_700_000_000_000;
  const timers: (() => void)[] = [];
  const sent: string[] = [];
  const deps = {
    db,
    api,
    ink: inProcessInk(sent),
    renderCrop: async (region: InkRegion) => `png-of-${region.id}`,
    wallClock: () => wall,
    schedule: (fn: () => void) => {
      timers.push(fn);
      return () => undefined;
    },
  };
  const session = await BoardSession.open(deps);
  const board = new FakeBoard(session.clock);
  session.attach(board);

  /** Lets queued board events, ink messages and uploads run to completion. */
  const idle = async () => {
    for (let i = 0; i < 20; i += 1) {
      await session.settled();
      await new Promise((r) => setTimeout(r, 0));
    }
  };
  const advance = async (ms: number) => {
    wall += ms;
    session.tick();
    await idle();
  };
  const runTimers = async () => {
    timers.splice(0).forEach((fn) => fn());
    await idle();
  };
  return { db, api, session, board, sent, deps, idle, advance, runTimers };
}

describe('board session', () => {
  beforeEach(() => {
    dbCount += 1;
  });

  it('stores each stroke before it is grouped, and reads settled writing', async () => {
    const t = await setup((api) => [api.text('Quadratics')]);
    let storedFirst = false;
    const send = t.deps.ink.send;
    t.deps.ink.send = (message) => {
      if (message.kind === 'stroke') {
        void t.db.strokes.get(message.stroke.id).then((row) => (storedFirst = row !== undefined));
      }
      send(message);
    };
    t.board.write(100, 100);
    await t.idle();
    expect(storedFirst).toBe(true);
    expect(t.session.getView().openRegions).toBe(1);

    await t.advance(INK_PARAMS.settleMs);
    const [region] = t.session.getView().regions;
    expect(region?.status).toBe('recognized');
    expect(region?.blocks[0]?.block).toMatchObject({ inlines: [{ text: 'Quadratics' }] });
    expect((await t.db.regions.toArray())[0]?.status).toBe('recognized');
  });

  it('builds the handout from read regions in order, with pictures only where needed', async () => {
    const t = await setup((api) => [api.text('First'), { code: 'http_400', retryable: false }]);
    t.board.write(100, 100);
    await t.advance(INK_PARAMS.settleMs);
    t.board.write(100, 900);
    await t.advance(INK_PARAMS.settleMs);

    await t.session.makeHandout({ preset: 'lecture-notes', structurer: 'heuristic', title: 'T' });
    const [request] = t.api.renders;
    expect(request?.blocks.map((b) => b.block.type)).toEqual(['paragraph', 'imageFallback']);
    const [, second] = t.session.getView().regions;
    expect(Object.keys(request?.crops ?? {})).toEqual([second?.id]);
    expect(request?.meta.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(t.session.getView().handout.state).toBe('done');
  });

  it('waits while recognition is off and reads the region on retry', async () => {
    const t = await setup((api) => [
      new ApiProblem('recognition-not-configured', 503),
      api.text('later'),
    ]);
    t.board.write(100, 100);
    await t.advance(INK_PARAMS.settleMs);
    expect(t.session.getView().regions[0]).toMatchObject({
      status: 'waiting',
      failure: 'recognition-not-configured',
    });

    t.session.retry();
    await t.idle();
    expect(t.session.getView().regions[0]?.status).toBe('recognized');
  });

  it('tries a retryable failure again after a pause', async () => {
    const t = await setup((api) => [{ code: 'http_503', retryable: true }, api.text('ok')]);
    t.board.write(100, 100);
    await t.advance(INK_PARAMS.settleMs);
    expect(t.session.getView().regions[0]?.status).toBe('retrying');
    await t.runTimers();
    expect(t.session.getView().regions[0]).toMatchObject({ status: 'recognized' });
    expect(t.api.calls).toHaveLength(2);
  });

  it('replaces a region that was erased and rewritten, and leaves it out of the handout', async () => {
    const t = await setup((api) => [api.text('x = 3'), api.text('x = 2')]);
    const first = t.board.write(100, 100);
    await t.advance(INK_PARAMS.settleMs);
    t.board.erase(first.boardKey);
    await t.advance(1_000);
    t.board.write(105, 102);
    await t.advance(INK_PARAMS.settleMs);

    const regions = t.session.getView().regions;
    expect(regions.map((r) => r.status)).toEqual(['replaced', 'recognized']);
    expect((await t.db.strokes.toArray()).map((s) => s.erased)).toEqual([true, false]);

    await t.session.makeHandout({ preset: 'lecture-notes', structurer: 'heuristic', title: 'T' });
    expect(t.api.renders[0]?.blocks).toHaveLength(1);
  });

  it('reopens the same session and regroups strokes written before a reload', async () => {
    const t = await setup((api) => [api.text('kept')]);
    t.board.write(100, 100);
    await t.idle();
    t.session.dispose();

    const sent: string[] = [];
    const reopened = await BoardSession.open({ ...t.deps, ink: inProcessInk(sent) });
    expect(reopened.sessionId).toBe(t.session.sessionId);
    expect(sent).toEqual(['stroke']);

    const fresh = await BoardSession.open({ ...t.deps, ink: inProcessInk([]) }, { fresh: true });
    expect(fresh.sessionId).not.toBe(t.session.sessionId);
    expect(await t.db.sessions.where('current').equals(1).count()).toBe(1);
  });
});
