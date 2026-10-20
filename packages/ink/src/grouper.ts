import type { InkColor, Rect } from '@chalkline/ir';
import { distance, median, overlapOfSmaller, strokeBox, union } from './geometry.js';
import { INK_PARAMS, type InkParams } from './params.js';
import type { InkRegion, Stroke } from './types.js';

/**
 * Groups board strokes into regions and decides when each has settled.
 *
 * Pure and clock-free: callers pass the current time with every event
 * (stroke end, erase, tick), so the same event log always produces the same
 * regions, and nothing depends on timers a background tab would throttle.
 *
 * Rules (architecture, "Built-in Board ink path"):
 * - a region closes after `settleMs` without new strokes nearby;
 * - a stroke more than `farLineHeights` line-heights from every open region
 *   starts a new region and closes open regions that have gone quiet;
 * - a page change closes every open region;
 * - highlighter strokes never take part in recognition.
 *
 * Several regions can be open at once, so two people writing at the board
 * get separate regions.
 */
export type GrouperEvent =
  | { kind: 'closed'; region: InkRegion }
  /** Strokes of an already committed region were erased. */
  | { kind: 'committedErased'; regionId: string; strokeIds: string[] };

type OpenRegion = {
  id: string;
  page: number;
  strokes: Stroke[];
  boxes: Rect[];
  bbox: Rect;
  t0: number;
  t1: number;
  lastActivity: number;
};

export class RegionGrouper {
  private open: OpenRegion[] = [];
  /** Strokes in regions already handed off for recognition, by stroke id. */
  private readonly committed = new Map<string, string>();
  private page: number | undefined;

  constructor(
    private readonly newId: () => string,
    private readonly params: InkParams = INK_PARAMS,
  ) {}

  /** A finished stroke. Returns regions that closed because of it. */
  addStroke(stroke: Stroke, now: number): GrouperEvent[] {
    if (stroke.tool === 'highlighter') return [];
    const events: GrouperEvent[] = [];
    if (this.page !== undefined && stroke.page !== this.page) events.push(...this.flush());
    this.page = stroke.page;

    const box = strokeBox(stroke);
    let best: OpenRegion | undefined;
    let bestGap = Infinity;
    for (const region of this.open) {
      const gap = distance(region.bbox, box);
      if (gap <= this.params.farLineHeights * this.lineHeight(region) && gap < bestGap) {
        best = region;
        bestGap = gap;
      }
    }

    if (!best) {
      // Writing moved away: regions that have gone quiet are done.
      const quiet = this.open.filter((r) => now - r.lastActivity >= this.params.farCloseIdleMs);
      events.push(...quiet.map((r) => this.close(r)));
      best = {
        id: this.newId(),
        page: stroke.page,
        strokes: [],
        boxes: [],
        bbox: box,
        t0: firstTime(stroke),
        t1: lastTime(stroke),
        lastActivity: now,
      };
      this.open.push(best);
    }

    best.strokes.push(stroke);
    best.boxes.push(box);
    best.bbox = union(best.bbox, box);
    best.t0 = Math.min(best.t0, firstTime(stroke));
    best.t1 = Math.max(best.t1, lastTime(stroke));
    best.lastActivity = now;
    return events;
  }

  /** Erased strokes: dropped from open regions, reported for committed ones. */
  erase(strokeIds: readonly string[], now: number): GrouperEvent[] {
    const ids = new Set(strokeIds);
    for (const region of this.open) {
      const keep = region.strokes
        .map((s, i) => [s, region.boxes[i]] as const)
        .filter(([s]) => !ids.has(s.id));
      if (keep.length === region.strokes.length) continue;
      region.strokes = keep.map(([s]) => s);
      region.boxes = keep.map(([, b]) => b as Rect);
      region.lastActivity = now;
      const first = region.boxes[0];
      region.bbox = first ? region.boxes.reduce(union, first) : region.bbox;
    }
    this.open = this.open.filter((r) => r.strokes.length > 0);

    const byRegion = new Map<string, string[]>();
    for (const id of strokeIds) {
      const regionId = this.committed.get(id);
      if (!regionId) continue;
      byRegion.set(regionId, [...(byRegion.get(regionId) ?? []), id]);
      this.committed.delete(id);
    }
    return [...byRegion].map(([regionId, ids]) => ({
      kind: 'committedErased',
      regionId,
      strokeIds: ids,
    }));
  }

  /** Called on any clock signal (a frame, a pointer event): closes settled regions. */
  tick(now: number): GrouperEvent[] {
    const settled = this.open.filter((r) => now - r.lastActivity >= this.params.settleMs);
    return settled.map((r) => this.close(r));
  }

  /** Closes everything (page change, end of class). */
  flush(): GrouperEvent[] {
    return [...this.open].map((r) => this.close(r));
  }

  openRegionCount(): number {
    return this.open.length;
  }

  private close(region: OpenRegion): GrouperEvent {
    this.open = this.open.filter((r) => r !== region);
    for (const s of region.strokes) this.committed.set(s.id, region.id);
    return {
      kind: 'closed',
      region: {
        id: region.id,
        page: region.page,
        strokes: region.strokes,
        bbox: region.bbox,
        t0: region.t0,
        t1: region.t1,
        color: dominantColor(region.strokes),
      },
    };
  }

  /** Median stroke height, a robust stand-in for the writing's line height. */
  private lineHeight(region: OpenRegion): number {
    const h = median(region.boxes.map((b) => b.h).filter((v) => v > 0));
    const { defaultLineHeight, minLineHeight, maxLineHeight } = this.params;
    return Math.min(maxLineHeight, Math.max(minLineHeight, h ? h * 1.5 : defaultLineHeight));
  }
}

function firstTime(stroke: Stroke): number {
  return stroke.points[0]?.t ?? 0;
}

function lastTime(stroke: Stroke): number {
  return stroke.points[stroke.points.length - 1]?.t ?? 0;
}

function dominantColor(strokes: readonly Stroke[]): InkColor {
  const ink = new Map<InkColor, number>();
  for (const s of strokes) ink.set(s.color, (ink.get(s.color) ?? 0) + s.points.length);
  let best: InkColor = 'black';
  let most = -1;
  for (const [color, n] of ink) {
    if (n > most) {
      best = color;
      most = n;
    }
  }
  return best;
}

/**
 * Commit, retract and correction (architecture, "Commit, retract and
 * correction rules"): committed ink that is erased is kept unless new ink is
 * written in the same area within the correction window, in which case the
 * new region replaces the old one in place.
 */
export class CorrectionTracker {
  private readonly erased: { regionId: string; bbox: Rect; page: number; at: number }[] = [];
  private readonly regions = new Map<
    string,
    { bbox: Rect; page: number; strokes: number; erased: number }
  >();

  constructor(private readonly params: InkParams = INK_PARAMS) {}

  /** Records a closed region; returns it with `replaces` set when it is a correction. */
  committed(region: InkRegion, now: number): InkRegion {
    this.expire(now);
    this.regions.set(region.id, {
      bbox: region.bbox,
      page: region.page,
      strokes: region.strokes.length,
      erased: 0,
    });
    const i = this.erased.findIndex(
      (e) =>
        e.page === region.page &&
        overlapOfSmaller(e.bbox, region.bbox) >= this.params.sameAreaOverlap,
    );
    if (i < 0) return region;
    const [match] = this.erased.splice(i, 1);
    return match ? { ...region, replaces: match.regionId } : region;
  }

  /** Strokes of a committed region were erased. */
  strokesErased(regionId: string, count: number, now: number): void {
    const region = this.regions.get(regionId);
    if (!region) return;
    region.erased += count;
    const alreadyListed = this.erased.some((e) => e.regionId === regionId);
    if (!alreadyListed && region.erased / region.strokes >= this.params.erasedShare) {
      this.erased.push({ regionId, bbox: region.bbox, page: region.page, at: now });
    }
  }

  private expire(now: number): void {
    for (let i = this.erased.length - 1; i >= 0; i -= 1) {
      const e = this.erased[i];
      if (e && now - e.at > this.params.correctionWindowMs) this.erased.splice(i, 1);
    }
  }
}
