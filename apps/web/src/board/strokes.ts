import type { InkColor } from '@chalkline/ir';
import type { StrokePoint } from '@chalkline/ink';

/**
 * Engine-neutral helpers for turning a drawn path into stroke data: color
 * and width mapping, and point times. Pure, so they are tested in Node.
 */

/** Board palette names (tldraw's) to the document's ink colors. */
const COLORS: Record<string, InkColor> = {
  black: 'black',
  grey: 'black',
  blue: 'blue',
  'light-blue': 'blue',
  red: 'red',
  'light-red': 'red',
  green: 'green',
  'light-green': 'green',
  orange: 'orange',
  yellow: 'orange',
  violet: 'purple',
  'light-violet': 'purple',
  white: 'white',
};

export function inkColorOf(boardColor: string): InkColor {
  return COLORS[boardColor] ?? 'black';
}

/** Pen sizes in page units at scale 1 (tldraw's stroke sizes). */
const SIZES: Record<string, number> = { s: 2, m: 3.5, l: 5, xl: 10 };

export function strokeWidthOf(size: string, scale: number): number {
  return (SIZES[size] ?? SIZES.m ?? 3.5) * (scale > 0 ? scale : 1);
}

/**
 * Stamps times on a path. Engines keep positions, not times, so points
 * are spread evenly between when the stroke started and ended; grouping
 * and recognition only need the order and the overall span.
 */
export function timedPoints(
  path: readonly { x: number; y: number; z?: number }[],
  t0: number,
  t1: number,
): StrokePoint[] {
  const start = Math.max(0, t0);
  const end = Math.max(start, t1);
  const last = Math.max(1, path.length - 1);
  return path.map((p, i) => ({
    x: p.x,
    y: p.y,
    p: pressureOf(p.z),
    t: Math.round(start + ((end - start) * i) / last),
  }));
}

function pressureOf(z: number | undefined): number {
  if (z === undefined || !Number.isFinite(z)) return 0.5;
  return Math.min(1, Math.max(0, z));
}
