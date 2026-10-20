import {
  findBlock,
  type Answer,
  type Block,
  type BlockFlag,
  type Callout,
  type ContentBlock,
  type Decided,
  type Doc,
  type DocMeta,
  type ExcludedReason,
  type Figure,
  type Inline,
  type Problem,
  type ProblemPart,
  type Provenance,
  type Section,
  type Solution,
} from '@chalkline/ir';
import { derivedId } from '../ids.js';
import type { StructureItem } from './input.js';
import { stripLabel } from './labels.js';
import { headingText, type Structure } from './normalize.js';
import { isCalloutRole, type Role } from './schema.js';

/**
 * Builds the document from a structure.
 *
 * - Leaves keep their ids. A problem, part, solution or callout gets an id
 *   derived from the block that starts it (its head), so the same structure
 *   always yields the same ids and patches keep pointing at the right block.
 * - The head's label ("3.", "Solution:") is removed, since presets print
 *   their own; a head that was only a label is dropped when the container
 *   has other content.
 * - Excluded blocks stay in the document, marked excluded, after the block
 *   they followed on the board, so review shows them where they were.
 * - What the teacher set on a container that still exists (points, a
 *   title, an exclusion) is carried over from `previous`.
 */

export type DocIdentity = { id: string; sessionId: string; version: number; meta: DocMeta };

export function buildDoc(
  structure: Structure,
  items: readonly StructureItem[],
  identity: DocIdentity,
  previous?: Doc,
): Doc {
  const builder = new Builder(structure, items, previous);
  const sections = structure.sections.map((s) => builder.section(s));
  builder.placeExcluded(sections);
  return {
    id: identity.id,
    sessionId: identity.sessionId,
    version: identity.version,
    meta: identity.meta,
    sections,
  };
}

class Builder {
  private readonly items: Map<string, StructureItem>;
  private readonly order: Map<string, number>;
  private readonly children = new Map<string, string[]>();

  constructor(
    private readonly structure: Structure,
    private readonly ordered: readonly StructureItem[],
    private readonly previous: Doc | undefined,
  ) {
    this.items = new Map(ordered.map((i) => [i.block.id, i]));
    this.order = new Map(ordered.map((i, index) => [i.block.id, index]));
    for (const i of ordered) {
      const parent = structure.placements.get(i.block.id)?.parentId;
      if (parent) this.children.set(parent, [...(this.children.get(parent) ?? []), i.block.id]);
    }
  }

  section(s: Structure['sections'][number]): Section {
    const headingLeaf = s.headingId === undefined ? undefined : this.items.get(s.headingId)?.block;
    const id = s.headingId ?? derivedId(s.ids[0] ?? '', 'section');
    const before = this.previous?.sections.find((p) => p.id === id);
    const title = before?.titlePinned
      ? before.title
      : headingLeaf
        ? headingText(headingLeaf)
        : s.title;
    return {
      id,
      ...(title !== undefined ? { title } : {}),
      ...(before?.titlePinned ? { titlePinned: true } : {}),
      blocks: s.ids.map((leafId) => this.top(leafId)),
    };
  }

  private role(id: string): Role {
    return this.structure.placements.get(id)?.role ?? 'content';
  }

  private childrenWith(id: string, roles: readonly Role[]): string[] {
    return (this.children.get(id) ?? []).filter((c) => roles.includes(this.role(c)));
  }

  private decided(id: string): Decided {
    return {
      typeBy: this.structure.placements.get(id)?.typeBy ?? this.structure.by,
      pinned: false,
    };
  }

  private leaf(id: string): ContentBlock {
    const item = this.items.get(id);
    if (!item) throw new Error(`unknown block ${id}`);
    const { block } = item;
    const flags = new Set<BlockFlag>(block.flags ?? []);
    if (item.tags.includes('keyResult') && !isCalloutRole(this.role(id))) flags.add('keyResult');
    if (this.structure.personal.has(id)) flags.add('personalName');
    const extra = {
      decided: block.decided.pinned ? block.decided : this.decided(id),
      ...(flags.size ? { flags: [...flags] } : {}),
    };
    if (this.role(id) === 'figure' && block.type === 'imageFallback') {
      const figure: Figure = {
        id: block.id,
        type: 'figure',
        status: 'check',
        provenance: block.provenance,
        ...(block.recognition ? { recognition: block.recognition } : {}),
        ...extra,
        figure: { kind: 'raster', assetRef: block.assetRef },
        ...(block.altText !== undefined ? { altText: block.altText } : {}),
        altTextConfirmed: false,
      };
      return figure;
    }
    return { ...block, ...extra };
  }

  /** The head as the first content of its container, without its label. */
  private head(id: string, role: Role): { blocks: ContentBlock[]; points?: number } {
    const block = this.leaf(id);
    if (block.type !== 'paragraph') return { blocks: [block] };
    const { inlines, points, labelOnly } = stripLabel(block.inlines, role);
    const withPoints = points !== undefined ? { points } : {};
    if (labelOnly && (this.children.get(id) ?? []).length > 0) return { blocks: [], ...withPoints };
    return { blocks: [{ ...block, inlines }], ...withPoints };
  }

  private contents(id: string): ContentBlock[] {
    return this.childrenWith(id, ['content', 'figure']).map((c) => this.leaf(c));
  }

  private container(id: string, role: Role) {
    const provenances = [id, ...this.descendants(id)]
      .map((d) => this.items.get(d)?.block.provenance)
      .filter((p) => p !== undefined);
    return {
      id: derivedId(id, role),
      status: 'ready' as const,
      provenance: unionProvenance(provenances),
      decided: this.decided(id),
    };
  }

  private descendants(id: string): string[] {
    return (this.children.get(id) ?? []).flatMap((c) => [c, ...this.descendants(c)]);
  }

  private solution(owner: string): Solution | undefined {
    const [id] = this.childrenWith(owner, ['solution']);
    if (id === undefined) return undefined;
    return {
      ...this.container(id, 'solution'),
      type: 'solution',
      steps: [...this.head(id, 'solution').blocks, ...this.contents(id)],
    };
  }

  private answer(owner: string): Answer | undefined {
    const [id] = this.childrenWith(owner, ['answer']);
    if (id === undefined) return undefined;
    const block = this.leaf(id);
    let inlines: Inline[] = [];
    if (block.type === 'paragraph') inlines = stripLabel(block.inlines, 'answer').inlines;
    if (block.type === 'displayMath') {
      inlines = block.lines.map((latex) => ({
        kind: 'math',
        latex,
        ...(block.color ? { color: block.color } : {}),
      }));
    }
    // normalize() only lets paragraphs and one-line math be answers.
    if (inlines.length === 0) return undefined;
    return {
      id: block.id,
      type: 'answer',
      status: block.status,
      provenance: block.provenance,
      ...(block.recognition ? { recognition: block.recognition } : {}),
      decided: block.decided,
      ...(block.flags ? { flags: block.flags } : {}),
      inlines,
    };
  }

  private part(id: string): ProblemPart {
    const solution = this.solution(id);
    const answer = this.answer(id);
    return {
      ...this.container(id, 'part'),
      type: 'part',
      prompt: [...this.head(id, 'part').blocks, ...this.contents(id)],
      ...(solution ? { solution } : {}),
      ...(answer ? { answer } : {}),
    };
  }

  private top(id: string): Block {
    const role = this.role(id);
    if (role === 'problem') {
      const head = this.head(id, 'problem');
      const solution = this.solution(id);
      const answer = this.answer(id);
      const problem: Problem = {
        ...this.container(id, 'problem'),
        type: 'problem',
        prompt: [...head.blocks, ...this.contents(id)],
        parts: this.childrenWith(id, ['part']).map((p) => this.part(p)),
        ...(solution ? { solution } : {}),
        ...(answer ? { answer } : {}),
        ...(head.points !== undefined ? { points: head.points } : {}),
      };
      return carryOver(problem, this.previous);
    }
    if (isCalloutRole(role)) {
      const solution = role === 'example' ? this.solution(id) : undefined;
      // A Key result tag on the block that starts a callout blanks the whole callout.
      const key = this.items.get(id)?.tags.includes('keyResult') === true;
      const callout: Callout = {
        ...this.container(id, role),
        type: 'callout',
        kind: role,
        body: [...this.head(id, role).blocks, ...this.contents(id)],
        ...(solution ? { solution } : {}),
        ...(key ? { flags: ['keyResult'] } : {}),
      };
      return carryOver(callout, this.previous);
    }
    return this.leaf(id);
  }

  /** The top-level leaf a placed block sits under. */
  private topLeaf(id: string): string {
    let current = id;
    for (let p = this.structure.placements.get(current)?.parentId; p;) {
      current = p;
      p = this.structure.placements.get(current)?.parentId;
    }
    return current;
  }

  /**
   * Excluded leaves go after the top-level block holding the leaf before
   * them in reading order (at the start of a section after its heading).
   */
  placeExcluded(sections: Section[]): void {
    const excluded = [...this.structure.excluded].sort(
      ([a], [b]) => (this.order.get(a) ?? 0) - (this.order.get(b) ?? 0),
    );
    const placedAfter = new Map<string, string>();
    for (const [id, reason] of excluded) {
      const source = this.items.get(id)?.block;
      if (!source) continue;
      const block = excludedBlock(source, reason);
      const target = this.excludedTarget(sections, id, placedAfter);
      target.section.blocks.splice(target.index, 0, block);
      placedAfter.set(id, block.id);
    }
  }

  private excludedTarget(
    sections: Section[],
    id: string,
    placedAfter: ReadonlyMap<string, string>,
  ): { section: Section; index: number } {
    for (let i = (this.order.get(id) ?? 0) - 1; i >= 0; i -= 1) {
      const before = this.ordered[i]?.block.id;
      if (before === undefined) continue;
      let blockId = placedAfter.get(before);
      if (blockId === undefined && this.structure.placements.has(before)) {
        const top = this.topLeaf(before);
        const role = this.role(top);
        blockId = role === 'problem' || isCalloutRole(role) ? derivedId(top, role) : top;
      }
      if (blockId === undefined) continue;
      for (const section of sections) {
        if (section.id === blockId) return { section, index: 0 };
        const index = section.blocks.findIndex((b) => b.id === blockId);
        if (index !== -1) return { section, index: index + 1 };
      }
    }
    let first = sections[0];
    if (!first) {
      first = { id: derivedId(id, 'section'), blocks: [] };
      sections.push(first);
    }
    return { section: first, index: 0 };
  }
}

function unionProvenance(all: readonly Provenance[]): Provenance {
  const [first, ...rest] = all;
  if (!first) throw new Error('a container needs at least one block');
  let { x, y } = first.bbox;
  let right = x + first.bbox.w;
  let bottom = y + first.bbox.h;
  const regionIds = new Set(first.regionIds);
  let { t0, t1 } = first;
  for (const p of rest) {
    for (const r of p.regionIds) regionIds.add(r);
    t0 = Math.min(t0, p.t0);
    t1 = Math.max(t1, p.t1);
    // The box is on the head's page; blocks continued on another page do not stretch it.
    if (p.page !== first.page) continue;
    x = Math.min(x, p.bbox.x);
    y = Math.min(y, p.bbox.y);
    right = Math.max(right, p.bbox.x + p.bbox.w);
    bottom = Math.max(bottom, p.bbox.y + p.bbox.h);
  }
  return {
    ...first,
    regionIds: [...regionIds],
    bbox: { x, y, w: right - x, h: bottom - y },
    t0,
    t1,
  };
}

/** Teacher-set fields of a container that already existed. */
function carryOver<T extends Problem | Callout>(block: T, previous: Doc | undefined): T {
  const before = previous ? findBlock(previous, block.id)?.block : undefined;
  if (!before || before.type !== block.type || !before.decided.pinned) return block;
  const next: T = { ...block, decided: before.decided };
  if (before.type === 'problem' && next.type === 'problem') {
    if (before.points !== undefined) next.points = before.points;
    else delete next.points;
  }
  if (before.type === 'callout' && next.type === 'callout' && before.title !== undefined) {
    next.title = before.title;
  }
  if (before.status === 'excluded' && before.excludedReason) {
    next.status = 'excluded';
    next.excludedReason = before.excludedReason;
    next.statusBeforeExclusion = before.statusBeforeExclusion ?? 'ready';
  }
  return next;
}

function excludedBlock(block: ContentBlock, reason: ExcludedReason): ContentBlock {
  if (block.status === 'excluded') return { ...block, excludedReason: reason };
  return {
    ...block,
    status: 'excluded',
    excludedReason: reason,
    statusBeforeExclusion: block.status,
  };
}
