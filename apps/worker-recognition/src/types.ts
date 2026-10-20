import type { ContentBlock } from '@chalkline/ir';

/**
 * The teacher's optional quick tags (product design, "Optional quick tags").
 * They are decisions, not hints: structuring never overrides them.
 */
export const TEACHER_TAGS = ['newSection', 'problem', 'solution', 'keyResult', 'exclude'] as const;
export type TeacherTag = (typeof TEACHER_TAGS)[number];

/**
 * A recognized leaf block on its way into the document, with the tags the
 * teacher put on the ink it came from.
 */
export type BoardBlock = {
  block: ContentBlock;
  tags: readonly TeacherTag[];
};
