import { INK_PARAMS, RegionGrouper, type Stroke } from '@chalkline/ink';
import {
  sequentialIds,
  type AnyBlock,
  type Answer,
  type Block,
  type ContentBlock,
  type Doc,
  type Inline,
  type ProblemPart,
  type Solution,
} from '@chalkline/ir';
import type {
  JsonModel,
  JsonModelRequest,
  JsonModelResult,
  Recognition,
  StrokeRecognizer,
} from '@chalkline/providers';
import type { z } from 'zod';
import type { RegionInput } from './postprocess/postprocess.js';
import { pieces } from './postprocess/segments.js';
import type { Role, StructureOutput } from './structure/schema.js';
import type { TeacherTag } from './types.js';

/**
 * A simulated board session: a lesson document written out the way a
 * teacher would write it (labels, one region per statement or step), as
 * synthetic strokes through the real region grouper, with a recognizer that
 * returns what was written. `oracle` is a structuring model that answers
 * with the lesson's true structure, so the AI path can be tested end to
 * end without a provider.
 */

export type Write = {
  text: string;
  /** When writing started, ms since session start (set by the layout). */
  t0: number;
  tags: TeacherTag[];
  confidence: number;
  /** The true role of each piece the text splits into, and its parent piece. */
  truth: PieceTruth[];
};

type PieceRef = { write: number; piece: number };
type PieceTruth = {
  role: Role;
  parent: PieceRef | null;
  excluded?: 'crossedOut';
  personalName?: boolean;
};

export type SimulatedSession = {
  writes: Write[];
  regions: RegionInput[];
  recognizer: StrokeRecognizer;
  oracle: JsonModel;
};

const LABELS: Record<string, string> = {
  definition: 'Definition: ',
  theorem: 'Theorem: ',
  note: 'Note: ',
  example: 'Example: ',
  announcement: '',
};

const LINE_HEIGHT = 60;
const PAGE_HEIGHT = 1500;

export function simulateSession(doc: Doc, options: { idPrefix?: string } = {}): SimulatedSession {
  const writes = writesOf(doc);
  const { regions, strokeWrite } = layOut(writes, options.idPrefix ?? '01JBRD');
  return {
    writes,
    regions,
    recognizer: new SimulatedRecognizer(writes, strokeWrite),
    oracle: new OracleModel(writes),
  };
}

/** The lesson as board writing, in the order a teacher would write it. */
function writesOf(doc: Doc): Write[] {
  const writes: Write[] = [];
  let problemNumber = 0;

  const add = (text: string, truth: PieceTruth[], block?: AnyBlock, extra: TeacherTag[] = []) => {
    const tags: TeacherTag[] = [...extra];
    if (block?.flags?.includes('keyResult')) tags.push('keyResult');
    if (block?.status === 'excluded' && block.excludedReason === 'teacher') tags.push('exclude');
    const confidence =
      block?.status === 'check' ? 0.7 : block?.type === 'imageFallback' ? 0.2 : 0.95;
    writes.push({ text, t0: 0, tags, confidence, truth });
    return writes.length - 1;
  };
  /** Truth for every piece of `text`: the first gets `first`, the rest are content under `rest`. */
  const truthFor = (
    text: string,
    first: Omit<PieceTruth, 'parent'> & { parent: PieceRef | null },
    rest: (self: PieceRef) => PieceRef | null,
  ): PieceTruth[] => {
    const count = Math.max(1, pieces(text).length);
    const index = writes.length;
    return Array.from({ length: count }, (_, piece) =>
      piece === 0
        ? first
        : {
            role: 'content' as const,
            parent: rest({ write: index, piece: 0 }),
            ...(first.excluded ? { excluded: first.excluded } : {}),
          },
    );
  };

  const leaf = (
    block: ContentBlock,
    parent: PieceRef | null,
    prefix = '',
    tags: TeacherTag[] = [],
  ) => {
    const text = prefix + textOf(block);
    const excluded =
      block.status === 'excluded' && block.excludedReason === 'crossedOut'
        ? 'crossedOut'
        : undefined;
    const role: Role = block.type === 'figure' ? 'figure' : 'content';
    const index = writes.length;
    add(
      text,
      truthFor(text, { role, parent, ...(excluded ? { excluded } : {}) }, () => parent),
      block,
      tags,
    );
    return { write: index, piece: 0 };
  };

  /** A statement (several blocks) written as one region: its first piece is the head. */
  const statement = (
    blocks: readonly ContentBlock[],
    role: Role,
    parent: PieceRef | null,
    prefix: string,
    owner: Block | ProblemPart,
    tags: TeacherTag[] = [],
  ): PieceRef => {
    // A label goes on its own line before displayed math, as on a board.
    const gap = prefix && blocks[0]?.type === 'displayMath' ? '\n' : '';
    const text = prefix.trimEnd() + (prefix ? gap || ' ' : '') + blocks.map(textOf).join('\n');
    const index = writes.length;
    const self = { write: index, piece: 0 };
    add(
      text,
      truthFor(text, { role, parent }, () => self),
      owner,
      tags,
    );
    return self;
  };

  let solutionHead: PieceRef | null = null;
  const solution = (sol: Solution, owner: PieceRef) => {
    sol.steps.forEach((step, i) => {
      if (i === 0) {
        const text = `Solution: ${step.type === 'displayMath' ? '\n' : ''}${textOf(step)}`;
        const index = writes.length;
        const self = { write: index, piece: 0 };
        add(
          text,
          truthFor(text, { role: 'solution', parent: owner }, () => self),
          step,
        );
        solutionHead = self;
      } else {
        leaf(step, solutionHead);
      }
    });
    if (sol.steps.length === 0) {
      const index = writes.length;
      add('Solution:', [{ role: 'solution', parent: owner }]);
      solutionHead = { write: index, piece: 0 };
    }
  };

  const answer = (ans: Answer, owner: PieceRef) => {
    add(`Answer: ${inlineText(ans.inlines)}`, [{ role: 'answer', parent: owner }], ans);
  };

  doc.sections.forEach((section, si) => {
    let sectionTag: TeacherTag[] = si > 0 ? ['newSection'] : [];
    if (section.title !== undefined) {
      add(section.title, [{ role: 'heading', parent: null }], undefined, ['newSection']);
      sectionTag = [];
    }
    for (const block of section.blocks) {
      const tags = sectionTag;
      sectionTag = [];
      switch (block.type) {
        case 'problem': {
          problemNumber += 1;
          const points = block.points !== undefined ? ` (${block.points} points)` : '';
          const [first, ...rest] = block.prompt;
          const head = statement(
            first
              ? [
                  { ...first, ...(first.type === 'paragraph' ? withSuffix(first, points) : {}) },
                  ...rest,
                ]
              : [],
            'problem',
            null,
            `${problemNumber}. `,
            block,
            tags,
          );
          block.parts.forEach((part, pi) => {
            const partHead = statement(
              part.prompt,
              'part',
              head,
              `(${'abcdefgh'[pi] ?? 'a'}) `,
              part,
            );
            if (part.solution) solution(part.solution, partHead);
            if (part.answer) answer(part.answer, partHead);
          });
          if (block.solution) solution(block.solution, head);
          if (block.answer) answer(block.answer, head);
          break;
        }
        case 'callout': {
          const head = statement(
            block.body,
            block.kind,
            null,
            LABELS[block.kind] ?? '',
            block,
            tags,
          );
          if (block.solution) solution(block.solution, head);
          break;
        }
        case 'solution':
          // A solution outside a problem is not something the board produces.
          for (const step of block.steps) leaf(step, null, '', tags);
          break;
        default:
          leaf(block, null, '', tags);
      }
    }
  });
  return writes;
}

function withSuffix(block: Extract<ContentBlock, { type: 'paragraph' }>, suffix: string) {
  if (!suffix) return {};
  return { inlines: [...block.inlines, { kind: 'text' as const, text: suffix }] };
}

/** What a recognizer would return for a block: Mathpix Markdown. */
export function textOf(block: ContentBlock): string {
  switch (block.type) {
    case 'paragraph':
      return inlineText(block.inlines);
    case 'displayMath':
      return block.lines.length === 1
        ? `\\[ ${block.lines[0] ?? ''} \\]`
        : `\\[ \\begin{aligned} ${block.lines.join(' \\\\ ')} \\end{aligned} \\]`;
    case 'list':
      return block.items.map((item) => inlineText(item.inlines)).join('\n');
    case 'table':
      return block.rows.map((row) => row.map((c) => inlineText(c.inlines)).join(' ')).join('\n');
    case 'figure':
    case 'imageFallback':
      return '';
  }
}

function inlineText(inlines: readonly Inline[]): string {
  return inlines.map((i) => (i.kind === 'text' ? i.text : `\\( ${i.latex} \\)`)).join('');
}

/** Synthetic strokes, one per line of writing, fed through the region grouper. */
function layOut(writes: readonly Write[], prefix: string) {
  const strokeId = sequentialIds(`${prefix}S`);
  const grouper = new RegionGrouper(sequentialIds(`${prefix}R`));
  const strokeWrite = new Map<string, number>();
  const regions: RegionInput[] = [];
  let page = 0;
  let y = 60;
  let t = 1_000;

  const collect = (events: ReturnType<RegionGrouper['tick']>) => {
    for (const event of events) {
      if (event.kind !== 'closed') continue;
      const write = writes[strokeWrite.get(event.region.strokes[0]?.id ?? '') ?? -1];
      regions.push({ region: event.region, tags: write?.tags ?? [] });
    }
  };

  writes.forEach((write, index) => {
    write.t0 = t;
    const lines = Math.max(1, write.text.split('\n').length);
    if (y + lines * LINE_HEIGHT > PAGE_HEIGHT) {
      page += 1;
      y = 60;
    }
    write.text.split('\n').forEach((line, li) => {
      const stroke = zigzag(
        strokeId(),
        page,
        40,
        y + li * LINE_HEIGHT,
        Math.max(40, Math.min(900, line.length * 12)),
        t,
      );
      strokeWrite.set(stroke.id, index);
      t = (stroke.points[stroke.points.length - 1]?.t ?? t) + 200;
      collect(grouper.addStroke(stroke, t));
    });
    y += lines * LINE_HEIGHT + LINE_HEIGHT / 2;
    // The teacher pauses before the next statement: the region settles.
    t += INK_PARAMS.settleMs + 1_000;
    collect(grouper.tick(t));
  });
  collect(grouper.flush());
  return { regions, strokeWrite };
}

function zigzag(id: string, page: number, x: number, y: number, width: number, t0: number): Stroke {
  const points = Array.from({ length: 8 }, (_, i) => ({
    x: x + (width * i) / 7,
    y: y + (i % 2 === 0 ? -18 : 18),
    p: 0.5,
    t: t0 + i * 40,
  }));
  return { id, page, tool: 'pen', color: 'black', width: 2, points };
}

class SimulatedRecognizer implements StrokeRecognizer {
  constructor(
    private readonly writes: readonly Write[],
    private readonly strokeWrite: ReadonlyMap<string, number>,
  ) {}

  recognizeStrokes(_regionId: string, strokes: readonly Stroke[]): Promise<Recognition> {
    const indexes = [...new Set(strokes.map((s) => this.strokeWrite.get(s.id) ?? -1))]
      .filter((i) => i >= 0)
      .sort((a, b) => a - b);
    const written = indexes.map((i) => this.writes[i]).filter((w) => w !== undefined);
    const confidence = Math.min(1, ...written.map((w) => w.confidence));
    return Promise.resolve({
      engine: 'simulated',
      response: {
        text: written.map((w) => w.text).join('\n'),
        confidence,
        confidence_rate: confidence,
      },
    });
  }
}

/**
 * Answers a structuring request with the true structure. Blocks are matched
 * to writes by writing time (`t`), and to pieces by their order within it.
 */
class OracleModel implements JsonModel {
  constructor(private readonly writes: readonly Write[]) {}

  complete<S extends z.ZodType>(
    request: JsonModelRequest<S>,
  ): Promise<JsonModelResult<z.infer<S>>> {
    const input = JSON.parse(request.user) as { blocks: { id: string; t: number }[] };
    const times = new Map<number, number>();
    const local = new Map<string, string>();
    const truths: { id: string; truth: PieceTruth | undefined }[] = [];
    const writeAt = new Map(this.writes.map((w, index) => [Math.round(w.t0 / 100) / 10, index]));
    for (const block of input.blocks) {
      const write = writeAt.get(block.t) ?? -1;
      const piece = times.get(write) ?? 0;
      times.set(write, piece + 1);
      local.set(`${write}:${piece}`, block.id);
      truths.push({ id: block.id, truth: this.writes[write]?.truth[piece] });
    }
    const ref = (r: PieceRef | null) => (r ? (local.get(`${r.write}:${r.piece}`) ?? null) : null);

    const output: StructureOutput = { sections: [], blocks: [], excluded: [] };
    let section: StructureOutput['sections'][number] | undefined;
    for (const { id, truth } of truths) {
      if (truth?.excluded) {
        output.excluded.push({ id, reason: truth.excluded });
        continue;
      }
      const role = truth?.role ?? 'content';
      const parentId = ref(truth?.parent ?? null);
      output.blocks.push({ id, role, parentId, personalName: truth?.personalName ?? false });
      if (parentId !== null) continue;
      if (!section || role === 'heading') {
        section = { title: null, blockIds: [] };
        output.sections.push(section);
      }
      section.blockIds.push(id);
    }
    return Promise.resolve({ kind: 'ok', output: request.schema.parse(output) });
  }
}
