import { createHash } from 'node:crypto';
import type { ContentBlock, Doc, DocMeta } from '@chalkline/ir';
import { renderWithPreset, type PresetId } from '@chalkline/presets';
import { derivedId } from '../ids.js';
import { regionAssetRef } from '../postprocess/postprocess.js';
import type { BoardBlock } from '../types.js';

/**
 * Stage 4 (architecture, "Validate"): new math is compiled in a probe
 * document with the production preamble before it can reach a handout.
 * When a batch fails, bisection finds the blocks responsible and they
 * become images of their region. Together with the sanitizer this is how
 * "always compile" holds before the real document is ever built.
 */

export type ProbeOutcome = 'ok' | 'failed' | 'unavailable';

/** Compiles a bundle; `unavailable` means no verdict (timeout, no TeX), not a bad block. */
export type ProbeCompile = (job: {
  tex: string;
  assets: { path: string; bytes: Uint8Array }[];
}) => Promise<ProbeOutcome>;

export type ProbeOptions = {
  compile: ProbeCompile;
  /** Any valid PNG: crops are not needed to know whether the math compiles. */
  placeholder: Uint8Array;
  preset?: PresetId;
  batchSize?: number;
};

export type ValidateReport = {
  probed: number;
  failed: string[];
  /** `probeKey`s of blocks that compiled, for the caller to remember. */
  validated: string[];
  compiles: number;
  /** Set when the compiler could not give a verdict; blocks were kept as they were. */
  unavailable?: boolean;
};

const PROBE_META: DocMeta = {
  title: 'Probe',
  course: 'Probe',
  teacher: 'Probe',
  date: '2026-01-01',
  lang: 'en',
};

/** Identifies a block's content, so an edited block is probed again. */
export function probeKey(block: ContentBlock): string {
  const content =
    block.type === 'paragraph'
      ? block.inlines
      : block.type === 'displayMath'
        ? block.lines
        : block.type === 'list'
          ? block.items
          : block.type === 'table'
            ? block.rows
            : block.id;
  return createHash('sha256')
    .update(JSON.stringify([block.type, content]))
    .digest('hex')
    .slice(0, 32);
}

export function hasMath(block: ContentBlock): boolean {
  switch (block.type) {
    case 'displayMath':
      return true;
    case 'paragraph':
      return block.inlines.some((i) => i.kind === 'math');
    case 'list':
      return block.items.some((item) => item.inlines.some((i) => i.kind === 'math'));
    case 'table':
      return block.rows.some((row) => row.some((c) => c.inlines.some((i) => i.kind === 'math')));
    default:
      return false;
  }
}

export async function validateBlocks(
  blocks: readonly BoardBlock[],
  options: ProbeOptions,
): Promise<{ blocks: BoardBlock[]; report: ValidateReport }> {
  const candidates = blocks.filter((b) => b.block.status !== 'excluded' && hasMath(b.block));
  const report: ValidateReport = {
    probed: candidates.length,
    failed: [],
    validated: [],
    compiles: 0,
  };
  let unavailable = false;
  const compiles = async (batch: readonly BoardBlock[]): Promise<boolean> => {
    if (unavailable) return true;
    report.compiles += 1;
    const outcome = await options.compile(probeJob(batch, options));
    if (outcome === 'unavailable') unavailable = true;
    return outcome !== 'failed';
  };

  const size = options.batchSize ?? 24;
  for (let i = 0; i < candidates.length && !unavailable; i += size) {
    const failing = await bisect(candidates.slice(i, i + size), compiles);
    if (!unavailable) report.failed.push(...failing.map((b) => b.block.id));
  }
  if (unavailable) {
    return { blocks: [...blocks], report: { ...report, failed: [], unavailable } };
  }

  const failed = new Set(report.failed);
  report.validated = candidates
    .filter((b) => !failed.has(b.block.id))
    .map((b) => probeKey(b.block));
  return {
    blocks: blocks.map((b) => (failed.has(b.block.id) ? { ...b, block: asImage(b.block) } : b)),
    report,
  };
}

function probeJob(batch: readonly BoardBlock[], options: ProbeOptions) {
  const first = batch[0]?.block.id ?? '00000000000000000000000000';
  const doc: Doc = {
    id: derivedId(first, 'probe'),
    sessionId: derivedId(first, 'probe-session'),
    version: 1,
    meta: PROBE_META,
    sections: [{ id: derivedId(first, 'probe-section'), blocks: batch.map((b) => b.block) }],
  };
  const rendering = renderWithPreset(doc, options.preset ?? 'lecture-notes');
  return {
    tex: rendering.tex,
    assets: rendering.assets.map((a) => ({ path: a.path, bytes: options.placeholder })),
  };
}

/**
 * The items whose presence makes `compiles` fail. Halves are tested
 * separately; when a batch fails but both of its halves compile, the
 * failure comes from a combination and the whole batch counts as failing.
 */
export async function bisect<T>(
  items: readonly T[],
  compiles: (items: readonly T[]) => Promise<boolean>,
): Promise<T[]> {
  if (items.length === 0 || (await compiles(items))) return [];
  return narrow(items, compiles);
}

async function narrow<T>(
  items: readonly T[],
  compiles: (items: readonly T[]) => Promise<boolean>,
): Promise<T[]> {
  if (items.length === 1) return [...items];
  const mid = Math.ceil(items.length / 2);
  const left = items.slice(0, mid);
  const right = items.slice(mid);
  const leftOk = await compiles(left);
  const rightOk = await compiles(right);
  if (leftOk && rightOk) return [...items];
  return [
    ...(leftOk ? [] : await narrow(left, compiles)),
    ...(rightOk ? [] : await narrow(right, compiles)),
  ];
}

function asImage(block: ContentBlock): ContentBlock {
  const regionId = block.provenance.regionIds[0] ?? block.id;
  return {
    id: block.id,
    type: 'imageFallback',
    status: 'image',
    provenance: block.provenance,
    ...(block.recognition ? { recognition: block.recognition } : {}),
    decided: block.decided,
    ...(block.flags ? { flags: block.flags } : {}),
    assetRef: regionAssetRef(regionId),
    reason: 'validationFailed',
  };
}
