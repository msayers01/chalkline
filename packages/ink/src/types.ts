import { schema, type InkColor, type Rect } from '@chalkline/ir';
import { z } from 'zod';

export const StrokePoint = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  /** Pressure, 0 to 1; 0.5 when the device reports none. */
  p: z.number().min(0).max(1),
  /** Milliseconds since session start. */
  t: z.number().nonnegative(),
});
export type StrokePoint = z.infer<typeof StrokePoint>;

export const Stroke = z.object({
  id: schema.Id,
  page: z.number().int().nonnegative(),
  tool: z.enum(['pen', 'highlighter']),
  color: schema.InkColor,
  width: z.number().positive(),
  points: z.array(StrokePoint).min(1),
});
export type Stroke = z.infer<typeof Stroke>;

/** A settled group of strokes, recognized once. */
export type InkRegion = {
  id: string;
  page: number;
  strokes: Stroke[];
  bbox: Rect;
  t0: number;
  t1: number;
  /** Dominant ink color, kept for emphasis when the preset allows color. */
  color: InkColor;
  /** Set when this region rewrites erased ink within the correction window. */
  replaces?: string;
  /** Set on chunks of a region split to fit the recognizer's request limit. */
  splitFrom?: string;
};
