import type { ContentBlock, Decided, ExcludedReason } from '@chalkline/ir';
import { plainTitle } from './guards.js';
import type { Placement, StructureItem } from './input.js';
import { PARENT_ROLES, type Role, type StructureOutput } from './schema.js';

/**
 * A structuring result in terms of block ids, after the decisions that are
 * not the model's (or the heuristic's) to make have been applied:
 *
 * - teacher tags win over any role the structurer chose;
 * - blocks the teacher edited or moved keep the placement they have;
 * - a block with a personal name is held back until the teacher approves it;
 * - roles that do not fit the block (an image as an answer) or its parent
 *   become plain content, and a parent may hold one solution and one answer.
 *
 * The output always satisfies the parent rules in schema.ts.
 */
export type Structure = {
  by: 'ai' | 'heuristic';
  /** Top-level block ids per section, in reading order. */
  sections: { title?: string; headingId?: string; ids: string[] }[];
  placements: Map<string, Placement & { typeBy: Decided['typeBy'] }>;
  excluded: Map<string, ExcludedReason>;
  /** Blocks structuring found a personal name in. */
  personal: Set<string>;
};

export function normalize(
  output: StructureOutput,
  items: readonly StructureItem[],
  by: Structure['by'],
): Structure {
  const byLocal = new Map(items.map((i) => [i.local, i]));
  const idOf = (local: string) => byLocal.get(local)?.block.id ?? local;
  const leaves = new Map(items.map((i) => [i.block.id, i.block]));
  const order = new Map(items.map((i, index) => [i.block.id, index]));

  const placements: Structure['placements'] = new Map();
  const excluded: Structure['excluded'] = new Map();
  const personal = new Set<string>();
  for (const b of output.blocks) {
    const id = idOf(b.id);
    placements.set(id, {
      role: b.role,
      parentId: b.parentId === null ? null : idOf(b.parentId),
      typeBy: by,
    });
    if (b.personalName) personal.add(id);
  }
  for (const e of output.excluded) excluded.set(idOf(e.id), e.reason);

  const include = (id: string, placement: Placement, typeBy: Decided['typeBy']) => {
    excluded.delete(id);
    placements.set(id, { ...placement, typeBy });
  };
  const exclude = (id: string, reason: ExcludedReason) => {
    placements.delete(id);
    excluded.set(id, reason);
  };

  // Teacher decisions.
  const solutionTagged = new Set<string>();
  const teacherIncluded = new Set<string>();
  for (const item of items) {
    const id = item.block.id;
    if (item.pinned) {
      include(id, { role: item.pinned.role, parentId: item.pinned.parentId }, 'teacher');
      teacherIncluded.add(id);
    } else if (item.tags.includes('exclude')) {
      exclude(id, 'teacher');
    } else if (item.tags.includes('problem')) {
      include(id, { role: 'problem', parentId: null }, 'teacherTag');
    } else if (item.tags.includes('solution')) {
      include(
        id,
        { role: 'solution', parentId: placements.get(id)?.parentId ?? null },
        'teacherTag',
      );
      solutionTagged.add(id);
    }
  }
  for (const id of personal) {
    if (!teacherIncluded.has(id) && placements.has(id)) exclude(id, 'personalData');
  }

  // Roles that need a particular kind of block.
  for (const [id, p] of placements) {
    const leaf = leaves.get(id);
    if (leaf && !fitsRole(leaf, p.role)) p.role = 'content';
  }

  // A tagged solution goes with the nearest problem, part or example before it.
  for (const id of solutionTagged) {
    const p = placements.get(id);
    if (!p || PARENT_ROLES.solution.includes(roleOf(placements, p.parentId))) continue;
    p.parentId = nearestBefore(items, order.get(id) ?? 0, (other) =>
      ['problem', 'part', 'example'].includes(placements.get(other)?.role ?? ''),
    );
  }

  repairParents(placements);
  limitSolutionsAndAnswers(placements, order);
  repairParents(placements);

  const sections = buildSections(output, items, placements, idOf, order);
  return { by, sections, placements, excluded, personal };
}

const roleOf = (placements: Structure['placements'], id: string | null): Role | null =>
  id === null ? null : (placements.get(id)?.role ?? null);

function fitsRole(leaf: ContentBlock, role: Role): boolean {
  switch (role) {
    case 'answer':
      return leaf.type === 'paragraph' || (leaf.type === 'displayMath' && leaf.lines.length === 1);
    case 'figure':
      return leaf.type === 'imageFallback';
    case 'heading':
      return headingText(leaf) !== undefined;
    default:
      return true;
  }
}

/** A heading is a short line of plain text; its text becomes the section title. */
export function headingText(leaf: ContentBlock): string | undefined {
  if (leaf.type !== 'paragraph' || leaf.inlines.some((i) => i.kind !== 'text')) return undefined;
  const text = leaf.inlines.map((i) => (i.kind === 'text' ? i.text : '')).join('');
  return text.length <= 120 ? plainTitle(text, 200) : undefined;
}

function nearestBefore(
  items: readonly StructureItem[],
  index: number,
  accept: (id: string) => boolean,
): string | null {
  for (let i = index - 1; i >= 0; i -= 1) {
    const id = items[i]?.block.id;
    if (id !== undefined && accept(id)) return id;
  }
  return null;
}

/**
 * Moves every block whose parent is gone (excluded) or does not accept it:
 * a misplaced role becomes content, and content climbs to the nearest
 * ancestor that can hold it. Overrides can combine into a loop (a pinned
 * block placed under one the model put inside it); the loop is cut first.
 */
function repairParents(placements: Structure['placements']): void {
  for (const p of placements.values()) {
    if (p.parentId !== null && !placements.has(p.parentId)) p.parentId = null;
  }
  for (const p of placements.values()) {
    const seen = new Set<string>();
    for (let up = p.parentId; up !== null; up = placements.get(up)?.parentId ?? null) {
      if (seen.has(up)) {
        p.parentId = null;
        break;
      }
      seen.add(up);
    }
  }
  for (let changed = true; changed;) {
    changed = false;
    for (const p of placements.values()) {
      if (PARENT_ROLES[p.role].includes(roleOf(placements, p.parentId))) continue;
      p.role = 'content';
      while (!PARENT_ROLES.content.includes(roleOf(placements, p.parentId))) {
        p.parentId = placements.get(p.parentId ?? '')?.parentId ?? null;
      }
      changed = true;
    }
  }
}

/** One solution and one answer per parent; later ones become steps of the first solution. */
function limitSolutionsAndAnswers(
  placements: Structure['placements'],
  order: ReadonlyMap<string, number>,
): void {
  const byOrder = [...placements.entries()].sort(
    ([a], [b]) => (order.get(a) ?? 0) - (order.get(b) ?? 0),
  );
  const firstSolution = new Map<string, string>();
  const hasAnswer = new Set<string>();
  for (const [id, p] of byOrder) {
    if (p.parentId === null) continue;
    if (p.role === 'solution') {
      const first = firstSolution.get(p.parentId);
      if (first === undefined) firstSolution.set(p.parentId, id);
      else {
        p.role = 'content';
        p.parentId = first;
      }
    }
  }
  for (const [, p] of byOrder) {
    if (p.parentId === null || p.role !== 'answer') continue;
    if (!hasAnswer.has(p.parentId)) {
      hasAnswer.add(p.parentId);
      continue;
    }
    p.role = 'content';
    p.parentId = firstSolution.get(p.parentId) ?? p.parentId;
  }
}

function buildSections(
  output: StructureOutput,
  items: readonly StructureItem[],
  placements: Structure['placements'],
  idOf: (local: string) => string,
  order: ReadonlyMap<string, number>,
): Structure['sections'] {
  const isTop = (id: string) => placements.get(id)?.parentId === null;
  const seen = new Set<string>();
  const sections: { title?: string; ids: string[] }[] = output.sections.map((s) => {
    const title = plainTitle(s.title);
    const ids = s.blockIds.map(idOf).filter((id) => {
      if (!isTop(id) || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
    return { ...(title !== undefined ? { title } : {}), ids };
  });
  if (sections.length === 0) sections.push({ ids: [] });

  // Top-level blocks no section lists (overrides can create them) go after
  // the top-level block that precedes them in reading order.
  const position = new Map<string, [number, number]>();
  sections.forEach((s, si) => s.ids.forEach((id, i) => position.set(id, [si, i])));
  for (const item of items) {
    const id = item.block.id;
    if (!isTop(id) || seen.has(id)) continue;
    const before = nearestBefore(items, order.get(id) ?? 0, (other) => position.has(other));
    const [si, i] = before === null ? [0, -1] : (position.get(before) ?? [0, -1]);
    sections[si]?.ids.splice(i + 1, 0, id);
    seen.add(id);
    sections.forEach((s, sj) => s.ids.forEach((other, k) => position.set(other, [sj, k])));
  }

  // Teacher "New section" tags and board headings start sections.
  const topOf = (id: string): string => {
    let current = id;
    for (let p = placements.get(current); p?.parentId; p = placements.get(current)) {
      current = p.parentId;
    }
    return current;
  };
  const starts = new Set<string>();
  for (const item of items) {
    const id = item.block.id;
    if (!placements.has(id)) continue;
    if (item.tags.includes('newSection')) starts.add(topOf(id));
    if (placements.get(id)?.role === 'heading') starts.add(id);
  }

  // The model's title stays with the first piece of a section it drew.
  const out: Structure['sections'] = [];
  for (const section of sections) {
    section.ids.forEach((id, index) => {
      if (index === 0 || starts.has(id)) {
        out.push({
          ...(index === 0 && section.title !== undefined ? { title: section.title } : {}),
          ids: [],
        });
      }
      out[out.length - 1]?.ids.push(id);
    });
  }
  for (const section of out) {
    const first = section.ids[0];
    if (first !== undefined && placements.get(first)?.role === 'heading') {
      section.headingId = first;
      section.ids.shift();
    }
  }
  return out.filter((s) => s.ids.length > 0 || s.headingId !== undefined);
}
