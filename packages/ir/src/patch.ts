import { z } from 'zod';
import {
  Block as BlockSchema,
  CalloutKind,
  DocMeta,
  ExcludedReason,
  Id,
  Inline,
  Section as SectionSchema,
} from './schema.js';
import type { AnyBlock, Block, ContentBlock, Doc } from './types.js';
import { childrenOf, collectIds, findBlock, topLevelIndex, walkBlocks } from './walk.js';

/**
 * Teacher edits and pipeline updates are both expressed as patches: an
 * append-only list of operations against a base version of the IR. The
 * document is never edited any other way.
 */

export const Actor = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('teacher'), userId: z.string().min(1).max(64) }),
  z.object({
    kind: z.literal('system'),
    component: z.enum(['recognition', 'structuring', 'validation', 'session']),
  }),
]);
export type Actor = z.infer<typeof Actor>;

export const PatchOp = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('setMathLines'),
    blockId: Id,
    lines: z.array(z.string().max(4_000)).min(1),
  }),
  z.object({ op: z.literal('setInlines'), blockId: Id, inlines: z.array(Inline) }),
  z.object({ op: z.literal('setCalloutKind'), blockId: Id, kind: CalloutKind }),
  z.object({ op: z.literal('setBlockTitle'), blockId: Id, title: z.string().max(200).nullable() }),
  z.object({ op: z.literal('exclude'), blockId: Id, reason: ExcludedReason }),
  z.object({ op: z.literal('include'), blockId: Id }),
  z.object({
    op: z.literal('moveBlock'),
    blockId: Id,
    sectionId: Id,
    index: z.number().int().nonnegative(),
  }),
  z.object({
    op: z.literal('insertBlock'),
    sectionId: Id,
    index: z.number().int().nonnegative(),
    block: BlockSchema,
  }),
  z.object({ op: z.literal('replaceBlock'), blockId: Id, block: BlockSchema }),
  z.object({ op: z.literal('setAltText'), blockId: Id, altText: z.string().max(500) }),
  z.object({
    op: z.literal('setPoints'),
    blockId: Id,
    points: z.number().int().positive().max(1000).nullable(),
  }),
  z.object({
    op: z.literal('insertSection'),
    index: z.number().int().nonnegative(),
    section: SectionSchema,
  }),
  z.object({
    op: z.literal('setSectionTitle'),
    sectionId: Id,
    title: z.string().max(200).nullable(),
  }),
  z.object({ op: z.literal('setMeta'), meta: DocMeta.partial() }),
]);
export type PatchOp = z.infer<typeof PatchOp>;

export const Patch = z.object({
  id: Id,
  docId: Id,
  baseVersion: z.number().int().nonnegative(),
  actor: Actor,
  /** Milliseconds since the epoch, assigned where the patch was created. */
  at: z.number().int().nonnegative(),
  ops: z.array(PatchOp).min(1),
});
export type Patch = z.infer<typeof Patch>;

export type PatchError =
  | { code: 'wrongDocument'; docId: string }
  | { code: 'versionConflict'; currentVersion: number }
  | { code: 'unknownBlock'; blockId: string; opIndex: number }
  | { code: 'unknownSection'; sectionId: string; opIndex: number }
  | { code: 'duplicateId'; id: string; opIndex: number }
  | { code: 'wrongBlockType'; blockId: string; expected: string; actual: string; opIndex: number }
  | { code: 'indexOutOfRange'; index: number; opIndex: number }
  | { code: 'notTopLevel'; blockId: string; opIndex: number };

export type PatchResult =
  | {
      ok: true;
      doc: Doc;
      /** Ops a system actor wanted to apply to pinned content; shown in review instead. */
      proposals: PatchOp[];
      applied: PatchOp[];
    }
  | { ok: false; error: PatchError };

type OpOutcome = 'applied' | 'proposed' | PatchError;

/**
 * Applies a patch to a document. Pure: the input document is not modified.
 *
 * - The patch must be based on the current version (optimistic concurrency).
 * - All ops apply or none do; a structural error rejects the whole patch.
 * - Teacher ops pin the blocks they touch ("teacher edits win").
 * - System ops that would change pinned content become proposals.
 */
export function applyPatch(doc: Doc, patch: Patch): PatchResult {
  if (patch.docId !== doc.id)
    return { ok: false, error: { code: 'wrongDocument', docId: patch.docId } };
  if (patch.baseVersion !== doc.version) {
    return { ok: false, error: { code: 'versionConflict', currentVersion: doc.version } };
  }

  const next = clone(doc);
  const proposals: PatchOp[] = [];
  const applied: PatchOp[] = [];

  for (const [opIndex, op] of patch.ops.entries()) {
    const outcome = applyOp(next, op, patch.actor, opIndex);
    if (outcome === 'applied') applied.push(op);
    else if (outcome === 'proposed') proposals.push(op);
    else return { ok: false, error: outcome };
  }

  if (applied.length === 0) return { ok: true, doc, proposals, applied };
  next.version = doc.version + 1;
  return { ok: true, doc: next, proposals, applied };
}

function applyOp(doc: Doc, op: PatchOp, actor: Actor, opIndex: number): OpOutcome {
  const isTeacher = actor.kind === 'teacher';

  switch (op.op) {
    case 'setMathLines': {
      const target = expectBlock(doc, op.blockId, 'displayMath', opIndex);
      if (!isBlock(target)) return target;
      if (!isTeacher && isPinned(target)) return 'proposed';
      target.lines = [...op.lines];
      markTeacherEdit(target, actor);
      return 'applied';
    }
    case 'setInlines': {
      const visit = findBlock(doc, op.blockId);
      if (!visit) return { code: 'unknownBlock', blockId: op.blockId, opIndex };
      const target = visit.block;
      if (target.type !== 'paragraph' && target.type !== 'answer') {
        return wrongType(target, 'paragraph | answer', opIndex);
      }
      if (!isTeacher && isPinned(target)) return 'proposed';
      target.inlines = clone(op.inlines);
      markTeacherEdit(target, actor);
      return 'applied';
    }
    case 'setCalloutKind': {
      const target = expectBlock(doc, op.blockId, 'callout', opIndex);
      if (!isBlock(target)) return target;
      if (!isTeacher && isPinned(target)) return 'proposed';
      target.kind = op.kind;
      if (op.kind !== 'example') delete target.solution;
      pinFor(target, actor, true);
      return 'applied';
    }
    case 'setBlockTitle': {
      const target = expectBlock(doc, op.blockId, 'callout', opIndex);
      if (!isBlock(target)) return target;
      if (!isTeacher && isPinned(target)) return 'proposed';
      if (op.title === null) delete target.title;
      else target.title = op.title;
      pinFor(target, actor, false);
      return 'applied';
    }
    case 'exclude': {
      const visit = findBlock(doc, op.blockId);
      if (!visit) return { code: 'unknownBlock', blockId: op.blockId, opIndex };
      const target = visit.block;
      if (!isTeacher && isPinned(target)) return 'proposed';
      if (target.status !== 'excluded') target.statusBeforeExclusion = target.status;
      target.status = 'excluded';
      target.excludedReason = op.reason;
      pinFor(target, actor, false);
      return 'applied';
    }
    case 'include': {
      const visit = findBlock(doc, op.blockId);
      if (!visit) return { code: 'unknownBlock', blockId: op.blockId, opIndex };
      const target = visit.block;
      if (!isTeacher && isPinned(target)) return 'proposed';
      if (target.status === 'excluded') {
        // Unknown prior status means nobody has confirmed the content: flag it for review.
        target.status = target.statusBeforeExclusion ?? 'check';
      }
      delete target.statusBeforeExclusion;
      delete target.excludedReason;
      pinFor(target, actor, false);
      return 'applied';
    }
    case 'moveBlock': {
      const from = topLevelIndex(doc, op.blockId);
      if (!from) {
        return findBlock(doc, op.blockId)
          ? { code: 'notTopLevel', blockId: op.blockId, opIndex }
          : { code: 'unknownBlock', blockId: op.blockId, opIndex };
      }
      const toSection = doc.sections.find((s) => s.id === op.sectionId);
      if (!toSection) return { code: 'unknownSection', sectionId: op.sectionId, opIndex };
      if (!isTeacher && isPinned(from.block)) return 'proposed';
      const fromSection = doc.sections[from.sectionIndex];
      if (!fromSection) return { code: 'unknownBlock', blockId: op.blockId, opIndex };
      const lengthAfterRemoval = toSection.blocks.length - (fromSection === toSection ? 1 : 0);
      if (op.index > lengthAfterRemoval)
        return { code: 'indexOutOfRange', index: op.index, opIndex };
      fromSection.blocks.splice(from.index, 1);
      toSection.blocks.splice(op.index, 0, from.block);
      pinFor(from.block, actor, false);
      return 'applied';
    }
    case 'insertBlock': {
      const section = doc.sections.find((s) => s.id === op.sectionId);
      if (!section) return { code: 'unknownSection', sectionId: op.sectionId, opIndex };
      if (op.index > section.blocks.length)
        return { code: 'indexOutOfRange', index: op.index, opIndex };
      const duplicate = firstDuplicate(doc, collectIds(op.block));
      if (duplicate) return { code: 'duplicateId', id: duplicate, opIndex };
      const block = clone(op.block);
      pinFor(block, actor, true);
      section.blocks.splice(op.index, 0, block);
      return 'applied';
    }
    case 'replaceBlock': {
      const visit = findBlock(doc, op.blockId);
      if (!visit) return { code: 'unknownBlock', blockId: op.blockId, opIndex };
      const old = visit.block;
      if (!isTeacher && collectIds(old).some((id) => isPinnedId(doc, id))) return 'proposed';
      const incomingIds = collectIds(op.block);
      const outgoing = new Set(collectIds(old));
      const duplicate = firstDuplicate(
        doc,
        incomingIds.filter((id) => !outgoing.has(id)),
      );
      if (duplicate) return { code: 'duplicateId', id: duplicate, opIndex };
      const block = clone(op.block);
      const replaced = replaceInDoc(doc, old, block);
      if (!replaced) return wrongType(old, 'a block of the same kind', opIndex);
      pinFor(block, actor, true);
      return 'applied';
    }
    case 'setAltText': {
      const visit = findBlock(doc, op.blockId);
      if (!visit) return { code: 'unknownBlock', blockId: op.blockId, opIndex };
      const target = visit.block;
      if (target.type !== 'figure' && target.type !== 'imageFallback') {
        return wrongType(target, 'figure | imageFallback', opIndex);
      }
      if (!isTeacher && isPinned(target)) return 'proposed';
      target.altText = op.altText;
      if (target.type === 'figure') target.altTextConfirmed = isTeacher;
      pinFor(target, actor, false);
      return 'applied';
    }
    case 'setPoints': {
      const target = expectBlock(doc, op.blockId, 'problem', opIndex);
      if (!isBlock(target)) return target;
      if (!isTeacher && isPinned(target)) return 'proposed';
      if (op.points === null) delete target.points;
      else target.points = op.points;
      pinFor(target, actor, false);
      return 'applied';
    }
    case 'insertSection': {
      if (op.index > doc.sections.length)
        return { code: 'indexOutOfRange', index: op.index, opIndex };
      if (doc.sections.some((s) => s.id === op.section.id)) {
        return { code: 'duplicateId', id: op.section.id, opIndex };
      }
      const ids = op.section.blocks.flatMap((b) => collectIds(b));
      const duplicate = firstDuplicate(doc, ids);
      if (duplicate) return { code: 'duplicateId', id: duplicate, opIndex };
      const section = clone(op.section);
      if (isTeacher) {
        section.titlePinned = true;
        for (const block of section.blocks) pinFor(block, actor, true);
      }
      doc.sections.splice(op.index, 0, section);
      return 'applied';
    }
    case 'setSectionTitle': {
      const section = doc.sections.find((s) => s.id === op.sectionId);
      if (!section) return { code: 'unknownSection', sectionId: op.sectionId, opIndex };
      if (!isTeacher && section.titlePinned) return 'proposed';
      if (op.title === null) delete section.title;
      else section.title = op.title;
      if (isTeacher) section.titlePinned = true;
      return 'applied';
    }
    case 'setMeta': {
      const meta: Record<string, unknown> = { ...doc.meta };
      for (const [key, value] of Object.entries(op.meta)) {
        if (value !== undefined) meta[key] = value;
      }
      doc.meta = meta as Doc['meta'];
      return 'applied';
    }
  }
}

type BlockOfType<T extends AnyBlock['type']> = Extract<AnyBlock, { type: T }>;

function expectBlock<T extends AnyBlock['type']>(
  doc: Doc,
  blockId: string,
  type: T,
  opIndex: number,
): BlockOfType<T> | PatchError {
  const visit = findBlock(doc, blockId);
  if (!visit) return { code: 'unknownBlock', blockId, opIndex };
  if (visit.block.type !== type) return wrongType(visit.block, type, opIndex);
  return visit.block as BlockOfType<T>;
}

function isBlock<T extends AnyBlock>(value: T | PatchError): value is T {
  return !('code' in value);
}

function wrongType(block: AnyBlock, expected: string, opIndex: number): PatchError {
  return { code: 'wrongBlockType', blockId: block.id, expected, actual: block.type, opIndex };
}

function isPinned(block: AnyBlock): boolean {
  return block.decided.pinned;
}

function isPinnedId(doc: Doc, id: string): boolean {
  const visit = findBlock(doc, id);
  return visit ? isPinned(visit.block) : false;
}

/** A teacher touching a block pins it; changing its type also records who decided. */
function pinFor(block: AnyBlock, actor: Actor, decidesType: boolean): void {
  if (actor.kind !== 'teacher') return;
  block.decided = {
    typeBy: decidesType ? 'teacher' : block.decided.typeBy,
    pinned: true,
  };
}

/** A teacher who rewrites content has reviewed it, so a Check flag is cleared. */
function markTeacherEdit(block: AnyBlock, actor: Actor): void {
  if (actor.kind !== 'teacher') return;
  pinFor(block, actor, false);
  if (block.status === 'check') block.status = 'ready';
}

function firstDuplicate(doc: Doc, ids: string[]): string | undefined {
  const existing = new Set<string>();
  for (const visit of walkBlocks(doc)) existing.add(visit.block.id);
  for (const section of doc.sections) existing.add(section.id);
  const seen = new Set<string>();
  for (const id of ids) {
    if (existing.has(id) || seen.has(id)) return id;
    seen.add(id);
  }
  return undefined;
}

const CONTENT_TYPES = new Set<AnyBlock['type']>([
  'paragraph',
  'displayMath',
  'figure',
  'table',
  'list',
  'imageFallback',
]);

function isContentBlock(block: AnyBlock): block is ContentBlock {
  return CONTENT_TYPES.has(block.type);
}

/**
 * Replaces `old` with `replacement` wherever it sits. A content block can be
 * replaced by any content block; anything else only by a block of the same
 * type, so nested slots (a problem's solution, say) keep their shape. A
 * top-level block can be replaced by any block.
 */
function replaceInDoc(doc: Doc, old: AnyBlock, replacement: Block): boolean {
  for (const section of doc.sections) {
    const index = section.blocks.indexOf(old as Block);
    if (index >= 0) {
      section.blocks[index] = replacement;
      return true;
    }
  }
  const compatible =
    replacement.type === old.type || (isContentBlock(old) && isContentBlock(replacement));
  if (!compatible) return false;
  for (const visit of walkBlocks(doc)) {
    if (replaceChild(visit.block, old, replacement)) return true;
  }
  return false;
}

function replaceChild(parent: AnyBlock, old: AnyBlock, replacement: Block): boolean {
  if (!childrenOf(parent).includes(old)) return false;
  const swapIn = <T extends AnyBlock>(list: T[]): boolean => {
    const i = list.indexOf(old as T);
    if (i < 0) return false;
    list[i] = replacement as unknown as T;
    return true;
  };
  switch (parent.type) {
    case 'problem':
    case 'part':
      if (swapIn(parent.prompt)) return true;
      if (parent.type === 'problem' && swapIn(parent.parts)) return true;
      if (parent.solution === old && replacement.type === 'solution') {
        parent.solution = replacement;
        return true;
      }
      return false;
    case 'solution':
      return swapIn(parent.steps);
    case 'callout':
      if (swapIn(parent.body)) return true;
      if (parent.solution === old && replacement.type === 'solution') {
        parent.solution = replacement;
        return true;
      }
      return false;
    default:
      return false;
  }
}

/** The IR is plain JSON (it is validated as such at every boundary), so a JSON round trip is a faithful deep copy. */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
