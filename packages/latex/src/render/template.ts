import type { SafeLatex } from '../safe/index.js';

/** Teacher-facing words the renderer puts into documents, in the document's language. */
export type Labels = {
  definition: string;
  theorem: string;
  note: string;
  example: string;
  announcement: string;
  solution: string;
  answer: string;
  points: (n: number) => string;
  name: string;
  date: string;
  score: string;
  page: string;
  pageOf: string;
  /** Alt text for a handwriting image kept because recognition failed. */
  imageAlt: string;
  /** Alt text for a figure nobody has described yet (review flags it before publishing). */
  figureAlt: string;
  /** Shown in place of math that could not be typeset safely. */
  mathPlaceholder: string;
  formatDate: (isoDate: string) => string;
};

/**
 * Everything format-specific a preset contributes to a LaTeX rendering. The
 * preamble must define the commands and environments in `CONTRACT`.
 */
export type LatexTemplate = {
  presetId: SafeLatex;
  presetVersion: number;
  presetName: SafeLatex;
  classOptions: SafeLatex;
  preamble: SafeLatex;
  labels: Labels;
  /** `quiz` adds name, date and score lines under the title. */
  titleBlock: 'standard' | 'quiz';
  layout: LatexLayout;
};

export type LatexLayout = {
  /** Two-column body (Study Sheet). */
  columns: 1 | 2;
  /** Copies of the whole handout per sheet, separated by a cut line (Exit Ticket). */
  copies: 1 | 2;
  /** Never break a page inside a problem (Quiz). */
  keepProblemsTogether: boolean;
  /** Replace blocks the teacher tagged as key results with writing space (Guided Notes). */
  blankKeyResults: boolean;
};

export const DEFAULT_LAYOUT: LatexLayout = {
  columns: 1,
  copies: 1,
  keepProblemsTogether: false,
  blankKeyResults: false,
};

/**
 * The commands and environments the renderer emits and every preset's
 * preamble must define. The renderer stays semantic; presets decide the look.
 */
export const CONTRACT = {
  environments: [
    'cldefinition', // {label}{title}
    'cltheorem',
    'clnote',
    'clexample',
    'clannouncement',
    'clproblem', // {number}{points label}
    'clparts', // list of \item
    'clsolution', // {label}
    'clkeep', // keeps its content on one page
    'clcolumns', // the body in the preset's column layout
  ],
  commands: [
    'cltitle', // {title}{details}
    'clquizheader', // {name}{date}{score}
    'clheader', // {left}{right}
    'clfooter', // {center}
    'clanswer', // {label}{content}
    'clanswerboxed', // {label}{content}
    'clanswerspace', // {lines}
    'clplaceholder', // {message}
    'clblank', // {lines}: writing space in place of a key result
    'clcutline', // between copies on one sheet
  ],
} as const;
