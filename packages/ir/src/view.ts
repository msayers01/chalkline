import type {
  Answer,
  Block,
  Callout,
  CalloutKind,
  ContentBlock,
  Doc,
  DocMeta,
  Problem,
  ProblemPart,
  Solution,
} from './types.js';

/**
 * The select step: a preset's structure rules applied to the IR produce a
 * view tree. Every renderer (LaTeX, HTML, Word) renders the same view tree,
 * so presets mean the same thing in every format.
 */

export type StructureRules = {
  /** Callout kinds to keep. */
  callouts: readonly CalloutKind[];
  /** Top-level content block types to keep (paragraphs, display math, figures, ...). */
  content: readonly ContentBlock['type'][];
  /** Keep problems at all. */
  problems: boolean;
  /**
   * Which worked solutions to show with problems: all of them, none, or only
   * where there is no final answer (so an answer key is never blank).
   */
  solutions: 'all' | 'none' | 'whenNoAnswer';
  answers: boolean;
  /** Worked solutions inside examples. */
  exampleSolutions: boolean;
  /** Solutions the structurer could not attach to a problem. */
  standaloneSolutions: boolean;
  /** Reserve writing space after problems that show no solution. */
  answerSpace: { factor: number; minLines: number; maxLines: number } | null;
  /**
   * Keep only the last problems (Exit Ticket): up to `max` of them, as many
   * as fit an estimated `maxLines` including writing space, and at least one.
   */
  lastProblems?: { max: number; maxLines: number };
  /** Print section titles (default true). */
  sectionTitles?: boolean;
  /** `board`: blocks in the order they were written (page, then time), as on the board. */
  order?: 'document' | 'board';
  numbering: 'continuous' | 'restartEachSection';
};

export const ALL_CONTENT: readonly ContentBlock['type'][] = [
  'paragraph',
  'displayMath',
  'figure',
  'table',
  'list',
  'imageFallback',
];

export type ViewPart = {
  part: ProblemPart;
  solution?: Solution;
  answer?: Answer;
  answerLines?: number;
};

export type ViewBlock =
  | { kind: 'content'; block: ContentBlock }
  | {
      kind: 'problem';
      block: Problem;
      number: number;
      parts: ViewPart[];
      solution?: Solution;
      answer?: Answer;
      answerLines?: number;
    }
  | { kind: 'callout'; block: Callout; solution?: Solution }
  | { kind: 'solution'; block: Solution };

export type ViewSection = { id: string; title?: string; blocks: ViewBlock[] };

export type ViewDoc = { docId: string; version: number; meta: DocMeta; sections: ViewSection[] };

const included = <T extends { status: string }>(b: T | undefined): b is T =>
  !!b && b.status !== 'excluded';

export function selectView(doc: Doc, rules: StructureRules): ViewDoc {
  let number = 0;
  const keepProblemIds = rules.lastProblems !== undefined ? lastProblemIds(doc, rules) : undefined;

  const ordered = rules.order === 'board' ? boardOrder(doc.sections) : doc.sections;
  const sections: ViewSection[] = ordered.map((section) => {
    if (rules.numbering === 'restartEachSection') number = 0;
    const blocks: ViewBlock[] = [];
    for (const block of section.blocks) {
      if (!included(block)) continue;
      const view = selectBlock(block, rules, keepProblemIds, () => (number += 1));
      if (view) blocks.push(view);
    }
    const title = rules.sectionTitles === false ? undefined : section.title;
    return { id: section.id, ...(title !== undefined ? { title } : {}), blocks };
  });

  return {
    docId: doc.id,
    version: doc.version,
    meta: doc.meta,
    sections: sections.filter((s) => s.blocks.length > 0),
  };
}

function selectBlock(
  block: Block,
  rules: StructureRules,
  keepProblemIds: Set<string> | undefined,
  nextNumber: () => number,
): ViewBlock | undefined {
  switch (block.type) {
    case 'problem': {
      if (!rules.problems) return undefined;
      if (keepProblemIds && !keepProblemIds.has(block.id)) return undefined;
      const prompt = block.prompt.filter(included);
      const parts = block.parts.filter(included).map((part) => selectPart(part, rules));
      const shown = shownWork(block.solution, block.answer, rules);
      const view: Extract<ViewBlock, { kind: 'problem' }> = {
        kind: 'problem',
        block: { ...block, prompt },
        number: nextNumber(),
        parts,
        ...shown,
      };
      if (parts.length === 0 && !shown.solution && rules.answerSpace) {
        view.answerLines = answerLines(block.solution, rules.answerSpace);
      }
      return view;
    }
    case 'callout': {
      if (!rules.callouts.includes(block.kind)) return undefined;
      const body = block.body.filter(included);
      const solution =
        rules.exampleSolutions && included(block.solution)
          ? filterSolution(block.solution)
          : undefined;
      return { kind: 'callout', block: { ...block, body }, ...(solution ? { solution } : {}) };
    }
    case 'solution':
      return rules.standaloneSolutions
        ? { kind: 'solution', block: filterSolution(block) }
        : undefined;
    default:
      return rules.content.includes(block.type) ? { kind: 'content', block } : undefined;
  }
}

function selectPart(part: ProblemPart, rules: StructureRules): ViewPart {
  const shown = shownWork(part.solution, part.answer, rules);
  const view: ViewPart = { part: { ...part, prompt: part.prompt.filter(included) }, ...shown };
  if (!shown.solution && rules.answerSpace)
    view.answerLines = answerLines(part.solution, rules.answerSpace);
  return view;
}

function shownWork(
  solution: Solution | undefined,
  answer: Answer | undefined,
  rules: StructureRules,
): { solution?: Solution; answer?: Answer } {
  const keptAnswer = rules.answers && included(answer) ? answer : undefined;
  const wantSolution =
    rules.solutions === 'all' || (rules.solutions === 'whenNoAnswer' && keptAnswer === undefined);
  const keptSolution = wantSolution && included(solution) ? filterSolution(solution) : undefined;
  return {
    ...(keptSolution ? { solution: keptSolution } : {}),
    ...(keptAnswer ? { answer: keptAnswer } : {}),
  };
}

function filterSolution(solution: Solution): Solution {
  return { ...solution, steps: solution.steps.filter(included) };
}

/**
 * Writing space sized from the original solution: `factor` times its
 * estimated height in lines, clamped. Without a solution, the minimum.
 */
export function answerLines(
  solution: Solution | undefined,
  space: { factor: number; minLines: number; maxLines: number },
): number {
  const estimate = solution
    ? solution.steps.filter(included).reduce((n, step) => n + estimateLines(step), 0)
    : 0;
  return Math.min(space.maxLines, Math.max(space.minLines, Math.round(estimate * space.factor)));
}

/** Deterministic height estimate in text lines; display math counts double. */
export function estimateLines(block: ContentBlock): number {
  switch (block.type) {
    case 'displayMath':
      return block.lines.length * 2;
    case 'paragraph': {
      const chars = block.inlines.reduce(
        (n, i) => n + (i.kind === 'text' ? i.text.length : i.latex.length),
        0,
      );
      return Math.max(1, Math.ceil(chars / 80));
    }
    case 'table':
      return block.rows.length + 1;
    case 'list':
      return block.items.length;
    case 'figure':
    case 'imageFallback':
      return 6;
  }
}

function lastProblemIds(doc: Doc, rules: StructureRules): Set<string> {
  const limit = rules.lastProblems ?? { max: Infinity, maxLines: Infinity };
  const problems = doc.sections.flatMap((s) =>
    s.blocks.filter((b): b is Problem => b.type === 'problem' && included(b)),
  );
  const kept: string[] = [];
  let lines = 0;
  for (const problem of [...problems].reverse()) {
    if (kept.length >= limit.max) break;
    const cost = problemLines(problem, rules);
    if (kept.length > 0 && lines + cost > limit.maxLines) break;
    kept.push(problem.id);
    lines += cost;
  }
  return new Set(kept);
}

/** Estimated height of a problem with its writing space, for fitting problems into a fixed area. */
function problemLines(problem: Problem, rules: StructureRules): number {
  const prompt = (blocks: ContentBlock[]) =>
    blocks.filter(included).reduce((n, b) => n + estimateLines(b), 0);
  const space = (solution: Solution | undefined) =>
    rules.answerSpace ? answerLines(solution, rules.answerSpace) : 0;
  const parts = problem.parts.filter(included);
  const body = parts.length
    ? parts.reduce((n, part) => n + prompt(part.prompt) + space(part.solution), 0)
    : space(problem.solution);
  return 2 + prompt(problem.prompt) + body;
}
const written = (b: Block) => [b.provenance.page, b.provenance.t0] as const;

function compareWritten(a: Block, b: Block): number {
  const [pa, ta] = written(a);
  const [pb, tb] = written(b);
  return pa - pb || ta - tb;
}

/** Sections and their blocks in writing order. Array.prototype.sort is stable, so ties keep document order. */
function boardOrder(sections: Doc['sections']): Doc['sections'] {
  const sorted = sections.map((s) => ({ ...s, blocks: [...s.blocks].sort(compareWritten) }));
  return sorted
    .map((s, i) => ({ s, i }))
    .sort((a, b) => {
      const fa = a.s.blocks[0];
      const fb = b.s.blocks[0];
      if (!fa || !fb) return fa ? -1 : fb ? 1 : a.i - b.i;
      return compareWritten(fa, fb) || a.i - b.i;
    })
    .map(({ s }) => s);
}
