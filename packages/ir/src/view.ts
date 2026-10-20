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
  /** Keep top-level paragraphs, display math, figures, tables, lists and image fallbacks. */
  content: boolean;
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
  /** Keep only the last N problems (Exit Ticket). */
  lastProblems?: number;
  numbering: 'continuous' | 'restartEachSection';
};

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
  const keepProblemIds =
    rules.lastProblems !== undefined ? lastProblemIds(doc, rules.lastProblems) : undefined;

  const sections: ViewSection[] = doc.sections.map((section) => {
    if (rules.numbering === 'restartEachSection') number = 0;
    const blocks: ViewBlock[] = [];
    for (const block of section.blocks) {
      if (!included(block)) continue;
      const view = selectBlock(block, rules, keepProblemIds, () => (number += 1));
      if (view) blocks.push(view);
    }
    return {
      id: section.id,
      ...(section.title !== undefined ? { title: section.title } : {}),
      blocks,
    };
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
      return rules.content ? { kind: 'content', block } : undefined;
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
function estimateLines(block: ContentBlock): number {
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

function lastProblemIds(doc: Doc, count: number): Set<string> {
  const ids = doc.sections.flatMap((s) =>
    s.blocks.filter((b) => b.type === 'problem' && included(b)).map((b) => b.id),
  );
  return new Set(ids.slice(Math.max(0, ids.length - count)));
}
