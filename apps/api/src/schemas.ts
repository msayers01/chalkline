import { Stroke, type InkRegion } from '@chalkline/ink';
import { schema } from '@chalkline/ir';
import { BUILT_IN_PRESETS, type PresetId } from '@chalkline/presets';
import { TEACHER_TAGS, type BoardBlock } from '@chalkline/worker-recognition';
import { z } from 'zod';

/** Request bodies, validated at the boundary. */

export const PRESET_IDS = Object.keys(BUILT_IN_PRESETS) as [PresetId, ...PresetId[]];

const TeacherTags = z.array(z.enum(TEACHER_TAGS)).max(TEACHER_TAGS.length);

export const RegionBody = z.object({
  region: z.object({
    id: schema.Id,
    page: z.number().int().nonnegative(),
    strokes: z.array(Stroke).min(1).max(5_000),
    bbox: schema.Rect,
    t0: z.number().nonnegative(),
    t1: z.number().nonnegative(),
    color: schema.InkColor,
    replaces: schema.Id.optional(),
  }),
  tags: TeacherTags.default([]),
});
export type RegionBody = z.infer<typeof RegionBody>;

/** The parsed region without `undefined` optionals (exactOptionalPropertyTypes). */
export function inkRegionOf(body: RegionBody): InkRegion {
  const { replaces, ...region } = body.region;
  return replaces ? { ...region, replaces } : region;
}

export const STRUCTURERS = ['heuristic', 'claude'] as const;

export const RenderBody = z.object({
  preset: z.enum(PRESET_IDS),
  structurer: z.enum(STRUCTURERS).default('heuristic'),
  meta: z.object({
    title: z.string().max(200),
    date: schema.IsoDate,
    lang: schema.Lang.default('en'),
  }),
  blocks: z.array(z.object({ block: schema.ContentBlock, tags: TeacherTags })).max(5_000),
  /** Each region's ink drawn as a PNG (base64), for blocks kept as images. */
  crops: z.record(schema.Id, z.base64().max(8_000_000)).default({}),
});
export type RenderBody = z.infer<typeof RenderBody>;

export function boardBlocksOf(body: RenderBody): BoardBlock[] {
  return body.blocks.map((b) => ({ block: b.block, tags: b.tags }));
}
