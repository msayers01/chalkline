import type { AnyBlock, Block, Doc } from './types.js';

/** Direct children of a block, in document order. */
export function childrenOf(block: AnyBlock): AnyBlock[] {
  switch (block.type) {
    case 'problem':
      return [
        ...block.prompt,
        ...block.parts,
        ...(block.solution ? [block.solution] : []),
        ...(block.answer ? [block.answer] : []),
      ];
    case 'part':
      return [
        ...block.prompt,
        ...(block.solution ? [block.solution] : []),
        ...(block.answer ? [block.answer] : []),
      ];
    case 'solution':
      return block.steps;
    case 'callout':
      return [...block.body, ...(block.solution ? [block.solution] : [])];
    case 'paragraph':
    case 'displayMath':
    case 'figure':
    case 'table':
    case 'list':
    case 'imageFallback':
    case 'answer':
      return [];
  }
}

export type BlockVisit = {
  block: AnyBlock;
  sectionId: string;
  /** Ancestors from the top-level block down to the direct parent. */
  ancestors: AnyBlock[];
};

/** Depth-first, document-order traversal of every block, nested ones included. */
export function* walkBlocks(doc: Doc): Generator<BlockVisit> {
  for (const section of doc.sections) {
    for (const block of section.blocks) {
      yield* walkFrom(block, section.id, []);
    }
  }
}

function* walkFrom(
  block: AnyBlock,
  sectionId: string,
  ancestors: AnyBlock[],
): Generator<BlockVisit> {
  yield { block, sectionId, ancestors };
  const next = [...ancestors, block];
  for (const child of childrenOf(block)) {
    yield* walkFrom(child, sectionId, next);
  }
}

export function findBlock(doc: Doc, id: string): BlockVisit | undefined {
  for (const visit of walkBlocks(doc)) {
    if (visit.block.id === id) return visit;
  }
  return undefined;
}

/** Every block id in a subtree, root included. */
export function collectIds(block: AnyBlock): string[] {
  const ids = [block.id];
  for (const child of childrenOf(block)) ids.push(...collectIds(child));
  return ids;
}

/** Block ids in a document, in traversal order. Duplicates indicate a corrupt document. */
export function allIds(doc: Doc): string[] {
  return [...walkBlocks(doc)].map((v) => v.block.id);
}

export function topLevelIndex(
  doc: Doc,
  id: string,
): { sectionIndex: number; index: number; block: Block } | undefined {
  for (const [sectionIndex, section] of doc.sections.entries()) {
    const index = section.blocks.findIndex((b) => b.id === id);
    const block = section.blocks[index];
    if (block) return { sectionIndex, index, block };
  }
  return undefined;
}
