import { sequentialIds } from '@chalkline/ir';
import { describe, expect, it } from 'vitest';
import {
  CorrectionTracker,
  RegionGrouper,
  lines,
  splitForRequest,
  type GrouperEvent,
  type InkRegion,
  type Stroke,
} from '../src/index.js';

const strokeIds = sequentialIds('01JSTRK0000000000000'.replace(/[ILOU]/g, '0'));

/** A horizontal scribble of `w` by `h` at (x, y), drawn from time t over 200 ms. */
function stroke(
  x: number,
  y: number,
  t: number,
  opts: Partial<Pick<Stroke, 'page' | 'tool' | 'color'>> & { w?: number; h?: number } = {},
): Stroke {
  const { w = 30, h = 30, page = 0, tool = 'pen', color = 'black' } = opts;
  const points = Array.from({ length: 5 }, (_, i) => ({
    x: x + (w * i) / 4,
    y: y + (i % 2 ? h : 0),
    p: 0.5,
    t: t + i * 50,
  }));
  return { id: strokeIds(), page, tool, color, width: 2, points };
}

const closed = (events: GrouperEvent[]) =>
  events
    .filter((e): e is Extract<GrouperEvent, { kind: 'closed' }> => e.kind === 'closed')
    .map((e) => e.region);

function grouper() {
  return new RegionGrouper(sequentialIds('01JREGN0000000000000'.replace(/[ILOU]/g, '0')));
}

describe('RegionGrouper', () => {
  it('groups nearby strokes and closes the region once it has settled for 2 s', () => {
    const g = grouper();
    expect(g.addStroke(stroke(0, 0, 0), 200)).toEqual([]);
    expect(g.addStroke(stroke(40, 0, 400), 600)).toEqual([]);
    expect(g.tick(2_500)).toEqual([]);
    const [region] = closed(g.tick(2_600));
    expect(region?.strokes).toHaveLength(2);
    expect(region).toMatchObject({ page: 0, t0: 0, t1: 600, bbox: { x: 0, y: 0, w: 70, h: 30 } });
    expect(g.openRegionCount()).toBe(0);
  });

  it('starts a new region when writing moves far away, closing the quiet one', () => {
    const g = grouper();
    g.addStroke(stroke(0, 0, 0), 200);
    const events = g.addStroke(stroke(0, 600, 1_000), 1_200);
    expect(closed(events)).toHaveLength(1);
    expect(g.openRegionCount()).toBe(1);
  });

  it('keeps two writers apart without closing each other’s regions', () => {
    const g = grouper();
    g.addStroke(stroke(0, 0, 0), 200);
    expect(closed(g.addStroke(stroke(1_000, 0, 100), 250))).toEqual([]);
    g.addStroke(stroke(40, 0, 300), 400);
    g.addStroke(stroke(1_040, 0, 350), 450);
    expect(g.openRegionCount()).toBe(2);
    const regions = closed(g.tick(5_000));
    expect(regions.map((r) => r.strokes.length)).toEqual([2, 2]);
  });

  it('closes everything on a page change and ignores the highlighter', () => {
    const g = grouper();
    g.addStroke(stroke(0, 0, 0), 200);
    expect(g.addStroke(stroke(0, 0, 300, { tool: 'highlighter' }), 400)).toEqual([]);
    const events = g.addStroke(stroke(0, 0, 500, { page: 1 }), 700);
    expect(closed(events)).toMatchObject([{ page: 0, strokes: [{ tool: 'pen' }] }]);
  });

  it('drops erased strokes from open regions and reports erasures of committed ones', () => {
    const g = grouper();
    const a = stroke(0, 0, 0);
    const b = stroke(40, 0, 300);
    g.addStroke(a, 200);
    g.addStroke(b, 500);
    g.erase([b.id], 600);
    const [region] = closed(g.tick(3_000));
    expect(region?.strokes.map((s) => s.id)).toEqual([a.id]);
    expect(g.erase([a.id], 3_100)).toEqual([
      { kind: 'committedErased', regionId: region?.id, strokeIds: [a.id] },
    ]);
  });

  it('uses the stroke color with the most ink as the region color', () => {
    const g = grouper();
    g.addStroke(stroke(0, 0, 0, { color: 'blue' }), 200);
    g.addStroke(stroke(40, 0, 300, { color: 'blue' }), 400);
    g.addStroke(stroke(80, 0, 500), 600);
    expect(closed(g.flush())[0]?.color).toBe('blue');
  });

  it('is deterministic for the same event log', () => {
    const strokes = [stroke(0, 0, 0), stroke(40, 0, 300), stroke(0, 500, 3_000)];
    const run = () => {
      const ids = sequentialIds('01JDET00000000000000');
      const g = new RegionGrouper(ids);
      const out: GrouperEvent[] = [];
      strokes.forEach((s, i) =>
        out.push(...g.addStroke(s, 200 + i * 1_000), ...g.tick(400 + i * 1_000)),
      );
      out.push(...g.flush());
      return JSON.stringify(out);
    };
    expect(run()).toBe(run());
  });
});

describe('CorrectionTracker', () => {
  const region = (id: string, x: number, y: number): InkRegion => ({
    id,
    page: 0,
    strokes: [stroke(x, y, 0), stroke(x + 40, y, 100)],
    bbox: { x, y, w: 70, h: 30 },
    t0: 0,
    t1: 300,
    color: 'black',
  });

  it('treats erase and rewrite in the same area within 20 s as a correction', () => {
    const t = new CorrectionTracker();
    t.committed(region('01JA0000000000000000000001', 0, 0), 1_000);
    t.strokesErased('01JA0000000000000000000001', 2, 5_000);
    expect(t.committed(region('01JA0000000000000000000002', 10, 5), 15_000).replaces).toBe(
      '01JA0000000000000000000001',
    );
  });

  it('keeps erased ink when nothing is rewritten there in time (the teacher was making room)', () => {
    const t = new CorrectionTracker();
    t.committed(region('01JA0000000000000000000001', 0, 0), 1_000);
    t.strokesErased('01JA0000000000000000000001', 2, 5_000);
    expect(
      t.committed(region('01JA0000000000000000000002', 10, 5), 26_000).replaces,
    ).toBeUndefined();
    expect(
      t.committed(region('01JA0000000000000000000003', 500, 500), 6_000).replaces,
    ).toBeUndefined();
  });

  it('needs most of the region erased, not a single stroke', () => {
    const t = new CorrectionTracker();
    const big = {
      ...region('01JA0000000000000000000001', 0, 0),
      strokes: Array.from({ length: 6 }, (_, i) => stroke(i * 10, 0, i)),
    };
    t.committed(big, 1_000);
    t.strokesErased(big.id, 1, 2_000);
    expect(t.committed(region('01JA0000000000000000000002', 0, 0), 3_000).replaces).toBeUndefined();
  });
});

describe('splitForRequest', () => {
  const bytes = (strokes: readonly Stroke[]) => strokes.length * 100;
  const ids = sequentialIds('01JSPL00000000000000'.replace(/[ILOU]/g, '0'));

  it('leaves small regions alone', () => {
    const r: InkRegion = {
      id: 'r',
      page: 0,
      strokes: [stroke(0, 0, 0)],
      bbox: { x: 0, y: 0, w: 30, h: 30 },
      t0: 0,
      t1: 200,
      color: 'black',
    };
    expect(splitForRequest(r, bytes, ids, 1_000)).toEqual([r]);
  });

  it('splits between lines and keeps every stroke exactly once', () => {
    const strokes = [0, 1, 2, 3].flatMap((line) =>
      [0, 1, 2].map((k) => stroke(k * 40, line * 80, line * 1_000 + k * 100)),
    );
    const r: InkRegion = {
      id: 'r',
      page: 0,
      strokes,
      bbox: { x: 0, y: 0, w: 110, h: 270 },
      t0: 0,
      t1: 3_400,
      color: 'black',
    };
    const chunks = splitForRequest(r, bytes, ids, 700);
    expect(chunks.map((c) => c.strokes.length)).toEqual([6, 6]);
    expect(chunks.flatMap((c) => c.strokes.map((s) => s.id)).sort()).toEqual(
      strokes.map((s) => s.id).sort(),
    );
    expect(chunks.every((c) => c.splitFrom === 'r' && bytes(c.strokes) <= 700)).toBe(true);
    expect(lines(strokes)).toHaveLength(4);
  });

  it('splits a single oversized line between strokes, left to right', () => {
    const strokes = Array.from({ length: 5 }, (_, k) => stroke((4 - k) * 40, 0, k * 100));
    const r: InkRegion = {
      id: 'r',
      page: 0,
      strokes,
      bbox: { x: 0, y: 0, w: 190, h: 30 },
      t0: 0,
      t1: 600,
      color: 'black',
    };
    const chunks = splitForRequest(r, bytes, ids, 200);
    expect(chunks.map((c) => c.strokes.length)).toEqual([2, 2, 1]);
    expect(chunks[0]?.bbox.x).toBe(0);
  });
});
