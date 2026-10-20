import { childrenOf, type AnyBlock, type Block, type ContentBlock, type Doc } from '@chalkline/ir';
import { derivedId } from '../ids.js';
import type { BoardBlock, TeacherTag } from '../types.js';
import type { Role } from './schema.js';

/**
 * What structuring works on: leaf blocks in reading order, each with a short
 * local id for the model, the teacher's tags, and, for blocks the teacher has
 * already edited or moved, the placement they decided on.
 */

export type Placement = { role: Role; parentId: string | null };

/**
 * A teacher's placement. An exclusion the teacher made stays on the block
 * itself (its status), so an excluded head still anchors its container.
 */
export type Pinned = Placement;

export type StructureItem = {
  local: string;
  block: ContentBlock;
  tags: readonly TeacherTag[];
  pinned?: Pinned;
};

export function buildItems(blocks: readonly BoardBlock[], previous?: Doc): StructureItem[] {
  const ordered = readingOrder(blocks);
  const placements = previous
    ? placementsFromDoc(
        previous,
        ordered.map((b) => b.block.id),
      )
    : new Map<string, Pinned & { pinned: boolean }>();
  return ordered.map((b, i) => {
    const placed = placements.get(b.block.id);
    const item: StructureItem = { local: `b${i + 1}`, block: b.block, tags: b.tags };
    if (placed?.pinned) {
      item.pinned = { role: placed.role, parentId: placed.parentId };
    }
    return item;
  });
}

/**
 * Reading order from geometry: pages in order, columns left to right, then
 * top to bottom, then writing time. Columns come from the horizontal extent
 * of blocks narrower than 60% of what is written on the page, so a title
 * across the top does not merge two columns into one.
 */
export function readingOrder<T extends { block: ContentBlock }>(blocks: readonly T[]): T[] {
  // Blocks from one region share its box; their recognized order breaks the tie.
  const index = new Map(blocks.map((b, i) => [b, i]));
  const byPage = new Map<number, T[]>();
  for (const b of blocks) {
    const page = b.block.provenance.page;
    byPage.set(page, [...(byPage.get(page) ?? []), b]);
  }
  const out: T[] = [];
  for (const page of [...byPage.keys()].sort((a, b) => a - b)) {
    const onPage = byPage.get(page) ?? [];
    const columns = columnsOf(onPage.map((b) => b.block.provenance.bbox));
    const columnOf = (b: T) => {
      const { x, w } = b.block.provenance.bbox;
      const anchor = w > 0 && columns.length > 1 ? x + Math.min(w, 40) / 2 : x;
      let index = 0;
      columns.forEach((c, i) => {
        if (anchor >= c.from) index = i;
      });
      return index;
    };
    out.push(
      ...[...onPage].sort((a, b) => {
        const pa = a.block.provenance;
        const pb = b.block.provenance;
        return (
          columnOf(a) - columnOf(b) ||
          pa.bbox.y - pb.bbox.y ||
          pa.t0 - pb.t0 ||
          (index.get(a) ?? 0) - (index.get(b) ?? 0)
        );
      }),
    );
  }
  return out;
}

function columnsOf(boxes: readonly { x: number; w: number }[]): { from: number; to: number }[] {
  if (boxes.length === 0) return [];
  const left = Math.min(...boxes.map((b) => b.x));
  const right = Math.max(...boxes.map((b) => b.x + b.w));
  const narrow = boxes.filter((b) => b.w <= 0.6 * (right - left));
  const intervals = narrow
    .map((b) => ({ from: b.x, to: b.x + b.w }))
    .sort((a, b) => a.from - b.from);
  const merged: { from: number; to: number }[] = [];
  for (const interval of intervals) {
    const last = merged[merged.length - 1];
    if (last && interval.from <= last.to) last.to = Math.max(last.to, interval.to);
    else merged.push({ ...interval });
  }
  return merged.length ? merged : [{ from: left, to: right }];
}

const CONTAINER_ROLE: Partial<Record<AnyBlock['type'], (b: AnyBlock) => Role>> = {
  problem: () => 'problem',
  part: () => 'part',
  solution: () => 'solution',
  callout: (b) => (b.type === 'callout' ? b.kind : 'content'),
};

/**
 * Where each leaf sits in an existing document, in structuring terms. A
 * container's head is the leaf its id was derived from (see apply.ts); a
 * head written only as a label ("Solution:") is not in the document but is
 * still among `leafIds`, the leaves being structured now.
 */
export function placementsFromDoc(
  doc: Doc,
  leafIds: readonly string[],
): Map<string, Pinned & { pinned: boolean }> {
  const out = new Map<string, Pinned & { pinned: boolean }>();
  const candidates = new Set(leafIds);
  for (const section of doc.sections) {
    candidates.add(section.id);
    for (const block of section.blocks) for (const id of leafIdsUnder(block)) candidates.add(id);
  }
  const headOf = (container: AnyBlock): string | undefined => {
    const role = CONTAINER_ROLE[container.type]?.(container);
    if (!role) return undefined;
    for (const id of candidates) if (derivedId(id, role) === container.id) return id;
    return undefined;
  };

  const visit = (block: AnyBlock, parentHead: string | null) => {
    const role = CONTAINER_ROLE[block.type]?.(block);
    if (role) {
      const head = headOf(block);
      const pinned = block.decided.pinned;
      if (head) {
        out.set(head, {
          role,
          parentId: parentHead,
          pinned: pinned || out.get(head)?.pinned === true,
        });
      }
      for (const child of childrenOf(block)) visit(child, head ?? parentHead);
      return;
    }
    if (out.has(block.id)) {
      // The head leaf itself, listed again as the first content of its container.
      const existing = out.get(block.id);
      if (existing) existing.pinned ||= block.decided.pinned;
      return;
    }
    const leafRole: Role =
      block.type === 'answer' ? 'answer' : block.type === 'figure' ? 'figure' : 'content';
    out.set(block.id, {
      role: leafRole,
      parentId: parentHead,
      pinned: block.decided.pinned,
    });
  };

  for (const section of doc.sections) {
    if (section.title !== undefined && candidates.has(section.id) && leafIds.includes(section.id)) {
      out.set(section.id, {
        role: 'heading',
        parentId: null,
        pinned: section.titlePinned === true,
      });
    }
    for (const block of section.blocks) visit(block, null);
  }
  return out;
}

function leafIdsUnder(block: Block | AnyBlock): string[] {
  const children = childrenOf(block);
  if (children.length === 0) return [block.id];
  return children.flatMap(leafIdsUnder);
}
