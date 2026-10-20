import { detectLabel } from './labels.js';
import type { StructureItem } from './input.js';
import { headingText } from './normalize.js';
import { isCalloutRole, type Role, type StructureOutput } from './schema.js';

/**
 * The heuristic structurer (architecture, "Stage 3"): used when the model is
 * unavailable, refuses, or fails the guards twice. It reads the board in
 * reading order and keeps a little state:
 *
 * - problems start at the teacher's Problem tag or a numbered label ("1.",
 *   "Ex 2"), parts at "(a)", and the blocks after a problem are its solution
 *   until the next problem;
 * - labelled definitions, theorems, notes and examples become callouts, and
 *   an example's working is its solution;
 * - ink recognized from the same region as the block before it continues
 *   that block (a problem statement and its equation are written together);
 * - a teacher's New section tag on a short line of text makes it a heading.
 *
 * Its output goes through the same guards and normalization as the model's.
 */
export function heuristicStructure(items: readonly StructureItem[]): StructureOutput {
  const blocks: StructureOutput['blocks'] = [];
  const parentOf = new Map<string, string | null>();
  const roleOf = new Map<string, Role>();
  const place = (item: StructureItem, role: Role, parentId: string | null) => {
    blocks.push({ id: item.local, role, parentId, personalName: false });
    parentOf.set(item.local, parentId);
    roleOf.set(item.local, role);
  };

  let problem: string | null = null;
  let part: string | null = null;
  let solution: string | null = null;
  let callout: { id: string; role: Role } | null = null;
  let previous: StructureItem | undefined;
  const close = () => {
    problem = part = solution = callout = null;
  };

  for (const item of items) {
    const { block, tags } = item;
    if (tags.includes('exclude')) {
      // Excluded by the teacher (normalization applies it): no effect on structure.
      place(item, 'content', null);
      continue;
    }
    if (tags.includes('newSection')) close();
    const label = block.type === 'paragraph' ? detectLabel(block.inlines)?.kind : undefined;
    const kind: Role | undefined = tags.includes('problem')
      ? 'problem'
      : tags.includes('solution')
        ? 'solution'
        : tags.includes('newSection') && headingText(block) !== undefined
          ? 'heading'
          : label;
    const prevRole = previous ? roleOf.get(previous.local) : undefined;
    const continues =
      previous !== undefined &&
      prevRole !== 'answer' &&
      prevRole !== 'heading' &&
      previous.block.provenance.regionIds.some((r) => block.provenance.regionIds.includes(r));

    if (kind === 'heading') {
      place(item, 'heading', null);
    } else if (kind === 'problem') {
      place(item, 'problem', null);
      close();
      problem = item.local;
    } else if (kind === 'part' && problem !== null) {
      place(item, 'part', problem);
      part = item.local;
      solution = null;
    } else if (kind === 'solution' && (part ?? problem ?? exampleOf(callout)) !== null) {
      const owner = part ?? problem ?? exampleOf(callout);
      place(item, 'solution', owner);
      solution = item.local;
    } else if (kind === 'answer' && (part ?? problem) !== null) {
      place(item, 'answer', part ?? problem);
    } else if (kind !== undefined && isCalloutRole(kind)) {
      close();
      place(item, kind, null);
      callout = { id: item.local, role: kind };
    } else if (continues && previous) {
      // Same region as the block before: inside it when it holds content, else beside it.
      const prev = previous.local;
      place(item, 'content', prevRole === 'content' ? (parentOf.get(prev) ?? null) : prev);
    } else if (solution !== null) {
      place(item, 'content', solution);
    } else if ((part ?? problem ?? exampleOf(callout)) !== null) {
      const owner = part ?? problem ?? exampleOf(callout);
      place(item, 'solution', owner);
      solution = item.local;
    } else if (callout !== null && previous && near(previous, item)) {
      place(item, 'content', callout.id);
    } else {
      place(item, 'content', null);
      callout = null;
    }
    previous = item;
  }

  const topLevel = blocks.filter((b) => b.parentId === null).map((b) => b.id);
  return { sections: [{ title: null, blockIds: topLevel }], blocks, excluded: [] };
}

const exampleOf = (callout: { id: string; role: Role } | null): string | null =>
  callout?.role === 'example' ? callout.id : null;

/** Written just below the previous block, in the same column of the same page. */
function near(a: StructureItem, b: StructureItem): boolean {
  const pa = a.block.provenance;
  const pb = b.block.provenance;
  if (pa.page !== pb.page) return false;
  const gap = pb.bbox.y - (pa.bbox.y + pa.bbox.h);
  const overlap =
    Math.min(pa.bbox.x + pa.bbox.w, pb.bbox.x + pb.bbox.w) - Math.max(pa.bbox.x, pb.bbox.x);
  return gap >= -pa.bbox.h && gap <= 1.5 * Math.max(pa.bbox.h, 1) && overlap > 0;
}
