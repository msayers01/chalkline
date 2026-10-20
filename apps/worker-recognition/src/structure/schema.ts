import { z } from 'zod';

/**
 * What the structuring model returns (architecture, "Stage 3: Structure").
 * The model refers to blocks by short local ids (`b1`, `b2`, ...) and may
 * write free text only in section titles; guards.ts checks everything else
 * against the input before any of it is applied.
 */

export const ROLES = [
  'content',
  'heading',
  'problem',
  'part',
  'solution',
  'answer',
  'definition',
  'theorem',
  'note',
  'example',
  'announcement',
  'figure',
] as const;
export const Role = z.enum(ROLES);
export type Role = z.infer<typeof Role>;

export const CALLOUT_ROLES = ['definition', 'theorem', 'note', 'example', 'announcement'] as const;
export type CalloutRole = (typeof CALLOUT_ROLES)[number];
export const isCalloutRole = (role: Role): role is CalloutRole =>
  (CALLOUT_ROLES as readonly string[]).includes(role);

/** The reasons a model may exclude for; teacher and personal-data exclusions are applied separately. */
export const ModelExclusion = z.enum(['crossedOut', 'projectedSource', 'interfaceText']);
export type ModelExclusion = z.infer<typeof ModelExclusion>;

export const StructureOutput = z.object({
  sections: z.array(
    z.object({
      title: z.string().nullable(),
      blockIds: z.array(z.string()),
    }),
  ),
  blocks: z.array(
    z.object({
      id: z.string(),
      role: Role,
      parentId: z.string().nullable(),
      personalName: z.boolean(),
    }),
  ),
  excluded: z.array(z.object({ id: z.string(), reason: ModelExclusion })),
});
export type StructureOutput = z.infer<typeof StructureOutput>;

/** Which roles may hold which. Everything else is a guard violation. */
export const PARENT_ROLES: Readonly<Record<Role, readonly (Role | null)[]>> = {
  content: [null, 'problem', 'part', 'solution', ...CALLOUT_ROLES],
  figure: [null, 'problem', 'part', 'solution', ...CALLOUT_ROLES],
  heading: [null],
  problem: [null],
  part: ['problem'],
  solution: ['problem', 'part', 'example'],
  answer: ['problem', 'part'],
  definition: [null],
  theorem: [null],
  note: [null],
  example: [null],
  announcement: [null],
};
