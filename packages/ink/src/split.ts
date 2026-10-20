import { median, strokeBox, union } from './geometry.js';
import { INK_PARAMS } from './params.js';
import type { InkRegion, Stroke } from './types.js';

/**
 * Splits a region whose recognition request would exceed the provider's body
 * limit. Splits fall between lines of writing, so no expression is cut in
 * half; a single line that is still too large is split between strokes, left
 * to right, as a last resort. Each chunk gets its own id and points back at
 * the region it came from.
 */
export function splitForRequest(
  region: InkRegion,
  requestBytes: (strokes: readonly Stroke[]) => number,
  newId: () => string,
  maxBytes: number = INK_PARAMS.maxRequestBytes,
): InkRegion[] {
  if (requestBytes(region.strokes) <= maxBytes) return [region];

  const chunks: Stroke[][] = [];
  let current: Stroke[] = [];
  for (const line of lines(region.strokes)) {
    if (requestBytes([...current, ...line]) <= maxBytes) {
      current.push(...line);
      continue;
    }
    if (current.length) chunks.push(current);
    current = [];
    if (requestBytes(line) <= maxBytes) {
      current = [...line];
      continue;
    }
    for (const stroke of [...line].sort((a, b) => strokeBox(a).x - strokeBox(b).x)) {
      if (current.length && requestBytes([...current, stroke]) > maxBytes) {
        chunks.push(current);
        current = [];
      }
      current.push(stroke);
    }
  }
  if (current.length) chunks.push(current);

  return chunks.map((strokes) => {
    const boxes = strokes.map(strokeBox);
    const bbox = boxes.slice(1).reduce(union, boxes[0] ?? region.bbox);
    const times = strokes.flatMap((s) => s.points.map((p) => p.t));
    return {
      ...region,
      id: newId(),
      splitFrom: region.id,
      strokes,
      bbox,
      t0: Math.min(...times),
      t1: Math.max(...times),
    };
  });
}

/** Strokes grouped into lines by vertical position, top to bottom. */
export function lines(strokes: readonly Stroke[]): Stroke[][] {
  const boxes = new Map(strokes.map((s) => [s, strokeBox(s)]));
  const height = median([...boxes.values()].map((b) => b.h).filter((h) => h > 0)) ?? 1;
  const byCenter = [...strokes].sort((a, b) => center(boxes.get(a)) - center(boxes.get(b)));
  const out: Stroke[][] = [];
  let last = -Infinity;
  for (const stroke of byCenter) {
    const c = center(boxes.get(stroke));
    if (out.length === 0 || c - last > height * 0.75) out.push([]);
    out[out.length - 1]?.push(stroke);
    last = c;
  }
  return out;
}

function center(box: { y: number; h: number } | undefined): number {
  return box ? box.y + box.h / 2 : 0;
}
