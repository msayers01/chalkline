import { INK_PARAMS, type Stroke } from '@chalkline/ink';
import { sequentialIds } from '@chalkline/ir';
import { describe, expect, it } from 'vitest';
import { inkColorOf, strokeWidthOf, timedPoints } from '../src/board/strokes.js';
import { InkCore } from '../src/workers/ink-protocol.js';

describe('stroke conversion', () => {
  it('maps the board palette onto document ink colors', () => {
    expect(inkColorOf('violet')).toBe('purple');
    expect(inkColorOf('light-red')).toBe('red');
    expect(inkColorOf('grey')).toBe('black');
    expect(inkColorOf('something-new')).toBe('black');
  });

  it('scales pen widths', () => {
    expect(strokeWidthOf('m', 1)).toBe(3.5);
    expect(strokeWidthOf('xl', 2)).toBe(20);
    expect(strokeWidthOf('unknown', 0)).toBe(3.5);
  });

  it('spreads times over the stroke and defaults pressure', () => {
    const points = timedPoints(
      [
        { x: 0, y: 0 },
        { x: 1, y: 1, z: 0.8 },
        { x: 2, y: 2, z: 7 },
      ],
      100,
      300,
    );
    expect(points.map((p) => p.t)).toEqual([100, 200, 300]);
    expect(points.map((p) => p.p)).toEqual([0.5, 0.8, 1]);
    expect(timedPoints([{ x: 0, y: 0 }], 50, 10)).toEqual([{ x: 0, y: 0, p: 0.5, t: 50 }]);
  });
});

describe('ink core', () => {
  const strokeIds = sequentialIds('01JWEB');
  const stroke = (x: number, y: number, t: number): Stroke => ({
    id: strokeIds(),
    page: 0,
    tool: 'pen',
    color: 'black',
    width: 3,
    points: [
      { x, y, p: 0.5, t },
      { x: x + 20, y: y + 30, p: 0.5, t: t + 50 },
    ],
  });

  it('closes a region once the writing settles', () => {
    const core = new InkCore(sequentialIds('01JRGN'));
    expect(core.handle({ kind: 'stroke', stroke: stroke(0, 0, 0), now: 50 })).toEqual([
      { kind: 'open', count: 1 },
    ]);
    // Quiet ticks say nothing.
    expect(core.handle({ kind: 'tick', now: 1_000 })).toEqual([]);
    const out = core.handle({ kind: 'tick', now: 50 + INK_PARAMS.settleMs });
    expect(out[0]).toMatchObject({ kind: 'closed', region: { strokes: [{}] } });
    expect(out[1]).toEqual({ kind: 'open', count: 0 });
  });

  it('marks a rewrite after an erase as a correction', () => {
    const core = new InkCore(sequentialIds('01JRGM'));
    const first = stroke(0, 0, 0);
    core.handle({ kind: 'stroke', stroke: first, now: 50 });
    const [closed] = core.handle({ kind: 'flush', now: 100 });
    if (closed?.kind !== 'closed') throw new Error('expected a closed region');

    core.handle({ kind: 'erase', strokeIds: [first.id], now: 3_000 });
    core.handle({ kind: 'stroke', stroke: stroke(2, 2, 3_500), now: 3_600 });
    const [rewrite] = core.handle({ kind: 'flush', now: 4_000 });
    expect(rewrite).toMatchObject({ kind: 'closed', region: { replaces: closed.region.id } });
  });
});
