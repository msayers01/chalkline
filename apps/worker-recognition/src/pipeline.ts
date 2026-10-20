import { splitForRequest, type InkRegion } from '@chalkline/ink';
import {
  childrenOf,
  schema,
  type AnyBlock,
  type Block,
  type ContentBlock,
  type Doc,
} from '@chalkline/ir';
import {
  ProviderError,
  strokesRequestBytes,
  type JsonModel,
  type StrokeRecognizer,
} from '@chalkline/providers';
import { derivedId } from './ids.js';
import {
  postprocessRegion,
  type PostprocessNote,
  type RegionInput,
  type RegionOutcome,
} from './postprocess/postprocess.js';
import { buildDoc, type DocIdentity } from './structure/apply.js';
import { buildItems } from './structure/input.js';
import { structureItems, type StructurePass, type StructureReport } from './structure/structure.js';
import type { BoardBlock } from './types.js';
import {
  probeKey,
  validateBlocks,
  type ProbeOptions,
  type ValidateReport,
} from './validate/probe.js';

/**
 * The recognition worker's two jobs:
 *
 * - `recognizeRegions`: stages 1 and 2 for settled regions. Run once per
 *   region (jobs are keyed by region id); the blocks it returns are stored
 *   with the region and reused by every later structuring pass.
 * - `structureSession`: stages 4 and 3 over every block of the session, then
 *   the document. Probing runs before structuring so a failing block is an
 *   image by the time anything places it.
 *
 * Nothing here logs content; reports carry ids and counts only.
 */

export type RegionReport = {
  regionId: string;
  /** Present when recognition failed; `retryable` failures are worth queueing again. */
  failure?: { code: string; retryable: boolean };
  chunks: number;
  repairs: PostprocessNote[];
};

export async function recognizeRegions(
  regions: readonly RegionInput[],
  recognizer: StrokeRecognizer,
  options: { concurrency?: number } = {},
): Promise<{ blocks: BoardBlock[]; reports: RegionReport[] }> {
  const results = await pool(regions, options.concurrency ?? 4, async (input) => {
    let n = 0;
    const chunks = splitForRequest(input.region, strokesRequestBytes, () =>
      derivedId(input.region.id, `chunk${(n += 1)}`),
    );
    const blocks: BoardBlock[] = [];
    const report: RegionReport = { regionId: input.region.id, chunks: chunks.length, repairs: [] };
    for (const chunk of chunks) {
      const outcome = await recognize(chunk, recognizer);
      if (outcome.kind === 'failed' && !report.failure) {
        report.failure = { code: outcome.code, retryable: outcome.retryable };
      }
      const result = postprocessRegion({ ...input, region: chunk }, outcome);
      blocks.push(...result.blocks);
      report.repairs.push(...result.notes);
    }
    return { blocks, report };
  });
  return { blocks: results.flatMap((r) => r.blocks), reports: results.map((r) => r.report) };
}

async function recognize(
  region: InkRegion,
  recognizer: StrokeRecognizer,
): Promise<RegionOutcome & { retryable: boolean }> {
  try {
    const recognition = await recognizer.recognizeStrokes(region.id, region.strokes);
    return { kind: 'recognized', recognition, retryable: false };
  } catch (e) {
    if (e instanceof ProviderError) return { kind: 'failed', code: e.code, retryable: e.retryable };
    throw e;
  }
}

export type SessionInput = {
  /** Every recognized block of the session, as stored with its region. */
  blocks: readonly BoardBlock[];
  identity: DocIdentity;
  pass: StructurePass;
  /** The current document, whose teacher edits are kept. */
  previous?: Doc;
  model?: JsonModel;
  /** Compile probe for blocks not validated before, by `probeKey`. */
  probe?: ProbeOptions & { validated?: ReadonlySet<string> };
};

export type SessionReport = {
  structure: StructureReport;
  validate?: ValidateReport;
  counts: Record<'ready' | 'check' | 'image' | 'excluded', number>;
};

export async function structureSession(
  input: SessionInput,
): Promise<{ doc: Doc; report: SessionReport }> {
  const merged = mergeWithPrevious(input.blocks, input.previous);
  let blocks = merged.blocks;

  let validate: ValidateReport | undefined;
  if (input.probe) {
    const validated = input.probe.validated ?? new Set<string>();
    const fresh = blocks.filter((b) => !validated.has(probeKey(b.block)));
    const result = await validateBlocks(fresh, input.probe);
    const replaced = new Map(result.blocks.map((b) => [b.block.id, b]));
    blocks = blocks.map((b) => replaced.get(b.block.id) ?? b);
    validate = result.report;
  }

  const items = buildItems(blocks, input.previous);
  const { structure, report } = await structureItems(items, {
    ...(input.model ? { model: input.model } : {}),
    pass: input.pass,
    meta: input.identity.meta,
  });
  const built = buildDoc(structure, items, input.identity, input.previous);
  const doc = reinsert(built, merged.teacherBlocks, input.previous);

  // The document must be valid IR; anything else is a bug here, not bad input.
  schema.Doc.parse(doc);
  return {
    doc,
    report: { structure: report, ...(validate ? { validate } : {}), counts: countStatuses(doc) },
  };
}

const RECOGNIZED = new Set(['board', 'capture']);

/**
 * Combines stored blocks with the current document:
 * - a recognized block the teacher edited keeps the teacher's version;
 * - a recognized block that is no longer stored (its region was retracted
 *   by a correction) leaves the document;
 * - blocks the teacher typed into a structured block take part in
 *   structuring, keeping the placement they were given;
 * - top-level blocks with nothing recognized in them (typed or imported
 *   by the teacher) are left alone and put back after structuring.
 */
export function mergeWithPrevious(
  blocks: readonly BoardBlock[],
  previous: Doc | undefined,
): { blocks: BoardBlock[]; teacherBlocks: Block[] } {
  if (!previous) return { blocks: [...blocks], teacherBlocks: [] };
  const teacherBlocks: Block[] = [];
  const edited = new Map<string, ContentBlock>();
  const typed: BoardBlock[] = [];
  for (const section of previous.sections) {
    for (const top of section.blocks) {
      const leaves = leavesOf(top);
      if (!leaves.some((l) => RECOGNIZED.has(l.provenance.source))) {
        teacherBlocks.push(top);
        continue;
      }
      for (const leaf of leaves) {
        if (!RECOGNIZED.has(leaf.provenance.source)) typed.push({ block: leaf, tags: [] });
        else if (leaf.decided.pinned) edited.set(leaf.id, leaf);
      }
    }
  }
  return {
    blocks: [
      ...blocks.map((b) => {
        const teacher = edited.get(b.block.id);
        return teacher ? { ...b, block: teacher } : b;
      }),
      ...typed,
    ],
    teacherBlocks,
  };
}

/** Leaf blocks under a block, answers as the paragraphs they were recognized as. */
function leavesOf(block: AnyBlock): ContentBlock[] {
  if (block.type === 'answer') {
    // Spread first so `type` is overwritten: an answer is stored as the paragraph it was.
    return [{ ...block, type: 'paragraph' }];
  }
  const children = childrenOf(block);
  if (children.length === 0) return [block as ContentBlock];
  return children.flatMap(leavesOf);
}

/** Puts teacher-made top-level blocks back after the block they followed. */
function reinsert(doc: Doc, teacherBlocks: readonly Block[], previous: Doc | undefined): Doc {
  if (!previous || teacherBlocks.length === 0) return doc;
  const sections = doc.sections.map((s) => ({ ...s, blocks: [...s.blocks] }));
  const teacherIds = new Set(teacherBlocks.map((b) => b.id));
  for (const section of previous.sections) {
    section.blocks.forEach((block, index) => {
      if (!teacherIds.has(block.id)) return;
      const anchor = section.blocks
        .slice(0, index)
        .reverse()
        .find((b) => sections.some((s) => s.blocks.some((x) => x.id === b.id)));
      const target = anchor
        ? sections.find((s) => s.blocks.some((x) => x.id === anchor.id))
        : (sections.find((s) => s.id === section.id) ?? sections[0]);
      if (!target) {
        sections.push({ ...section, blocks: [block] });
        return;
      }
      const at = anchor ? target.blocks.findIndex((x) => x.id === anchor.id) + 1 : 0;
      target.blocks.splice(at, 0, block);
    });
  }
  return { ...doc, sections };
}

const LEAF_TYPES = new Set<AnyBlock['type']>([
  'paragraph',
  'displayMath',
  'figure',
  'table',
  'list',
  'imageFallback',
  'answer',
]);

function countStatuses(doc: Doc): SessionReport['counts'] {
  const counts = { ready: 0, check: 0, image: 0, excluded: 0 };
  const visit = (block: AnyBlock) => {
    if (LEAF_TYPES.has(block.type)) counts[block.status] += 1;
    childrenOf(block).forEach(visit);
  };
  for (const section of doc.sections) section.blocks.forEach(visit);
  return counts;
}

/** Runs `fn` over `items` with at most `size` in flight, keeping input order. */
async function pool<T, R>(
  items: readonly T[],
  size: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await fn(items[i] as T);
      }
    }),
  );
  return results;
}
