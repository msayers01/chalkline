import type { InkRegion } from '@chalkline/ink';
import type {
  BlockStatus,
  ContentBlock,
  ImageFallback,
  Inline,
  Provenance,
  Recognition,
} from '@chalkline/ir';
import type { MathpixResponse, Recognition as ProviderRecognition } from '@chalkline/providers';
import { derivedId } from '../ids.js';
import { RECOGNITION_PARAMS } from '../params.js';
import type { BoardBlock, TeacherTag } from '../types.js';
import { repairMath, type RepairName } from './repair.js';
import { pieces, type Run } from './segments.js';

/**
 * Stage 2 (architecture, "Post-process"): one recognized region into leaf
 * blocks. Text runs and math are split apart, every math segment is
 * sanitized (and repaired when it fails), and each block gets its status
 * from the recognizer's confidence. Anything that still fails becomes an
 * image of the region, so nothing the teacher wrote is ever dropped.
 */

export type RegionInput = {
  region: InkRegion;
  tags: readonly TeacherTag[];
  source?: Provenance['source'];
};

/** What stage 1 produced for a region: a response, or the reason there is none. */
export type RegionOutcome =
  { kind: 'recognized'; recognition: ProviderRecognition } | { kind: 'failed'; code: string };

export type PostprocessNote = { blockId: string; repairs: RepairName[] };

export type PostprocessResult = { blocks: BoardBlock[]; notes: PostprocessNote[] };

/** Crops are stored as `regions/<region_id>.png`; the compile bundle names them by this ref. */
export const regionAssetRef = (regionId: string) => `region-${regionId}`;

export function confidenceOf(response: MathpixResponse): number {
  // confidence_rate is a per-character quality estimate; `confidence` is the
  // probability that the whole output is exactly right, which falls with
  // length and would push every long derivation into review.
  return response.confidence_rate ?? response.confidence ?? 0;
}

export function statusFor(
  confidence: number,
  params: typeof RECOGNITION_PARAMS = RECOGNITION_PARAMS,
): BlockStatus {
  if (confidence >= params.readyConfidence) return 'ready';
  if (confidence >= params.checkConfidence) return 'check';
  return 'image';
}

export function postprocessRegion(
  input: RegionInput,
  outcome: RegionOutcome,
  params: typeof RECOGNITION_PARAMS = RECOGNITION_PARAMS,
): PostprocessResult {
  const { region } = input;
  const provenance: Provenance = {
    source: input.source ?? 'board',
    regionIds: [region.id],
    page: region.page,
    bbox: region.bbox,
    t0: region.t0,
    t1: region.t1,
  };
  // Problem, Solution and New section mark where something starts: only the
  // region's first block carries them. Key result and Exclude cover it all.
  const tagsAt = (index: number): TeacherTag[] =>
    input.tags.filter((t) => index === 0 || t === 'keyResult' || t === 'exclude');
  const imageOf = (
    id: string,
    reason: ImageFallback['reason'],
    recognition?: Recognition,
  ): BoardBlock => ({
    block: {
      id,
      type: 'imageFallback',
      status: 'image',
      provenance,
      ...(recognition ? { recognition } : {}),
      decided: { typeBy: 'heuristic', pinned: false },
      assetRef: regionAssetRef(region.id),
      reason,
    },
    tags: tagsAt(0),
  });

  if (outcome.kind === 'failed') {
    return { blocks: [imageOf(derivedId(region.id, 'b0'), 'recognizerUnavailable')], notes: [] };
  }

  const { response, engine } = outcome.recognition;
  const confidence = confidenceOf(response);
  const recognition: Recognition = { engine, confidence, rawRef: `raw/${region.id}` };
  const status = statusFor(confidence, params);
  const found = pieces(response.text ?? '');
  if (status === 'image' || found.length === 0) {
    return {
      blocks: [imageOf(derivedId(region.id, 'b0'), 'lowConfidence', recognition)],
      notes: [],
    };
  }

  const blocks: BoardBlock[] = [];
  const notes: PostprocessNote[] = [];
  found.forEach((piece, index) => {
    const id = derivedId(region.id, `b${index}`);
    const base = {
      id,
      status,
      provenance,
      recognition,
      decided: { typeBy: 'heuristic' as const, pinned: false },
    };
    const repairs: RepairName[] = [];
    const fix = (latex: string): string | undefined => {
      const result = repairMath(latex);
      if (!result.ok) return undefined;
      repairs.push(...result.repairs);
      return result.latex;
    };

    let block: ContentBlock | undefined;
    if (piece.kind === 'display') {
      const lines = piece.lines.map(fix);
      if (lines.every((l): l is string => l !== undefined) && lines.length > 0) {
        block = { ...base, type: 'displayMath', lines, ...colorOf(region) };
      }
    } else {
      const inlines = piece.runs.map((run) => inlineOf(run, fix, region));
      if (inlines.every((i): i is Inline => i !== undefined)) {
        block = { ...base, type: 'paragraph', inlines };
      }
    }
    blocks.push(
      block
        ? { block, tags: tagsAt(index) }
        : { ...imageOf(id, 'validationFailed', recognition), tags: tagsAt(index) },
    );
    if (block && repairs.length) notes.push({ blockId: id, repairs: [...new Set(repairs)] });
  });
  return { blocks, notes };
}

function inlineOf(
  run: Run,
  fix: (latex: string) => string | undefined,
  region: InkRegion,
): Inline | undefined {
  if (run.kind === 'text') return { kind: 'text', text: run.text, ...colorOf(region) };
  const latex = fix(run.latex);
  return latex === undefined ? undefined : { kind: 'math', latex, ...colorOf(region) };
}

/** Black is the default ink; anything else is kept for presets that show color. */
function colorOf(region: InkRegion): { color?: InkRegion['color'] } {
  return region.color === 'black' ? {} : { color: region.color };
}
