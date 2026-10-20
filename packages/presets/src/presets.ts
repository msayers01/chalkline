import {
  DEFAULT_CONVENTIONS,
  resolveConventions,
  type ConventionChain,
  type Conventions,
  type ResolvedConventions,
} from '@chalkline/conventions';
import { ALL_CONTENT, selectView, type Doc, type StructureRules } from '@chalkline/ir';
import {
  DEFAULT_LAYOUT,
  renderLatex,
  tex,
  type LatexLayout,
  type LatexRendering,
  type LatexTemplate,
  type SafeLatex,
} from '@chalkline/latex';
import { labelsFor, titleWithSuffix, type TITLE_SUFFIX } from './labels.js';
import { buildPreamble, classOptions, type ElementStyle } from './modules.js';

/**
 * A preset is template + structure rules + conventions. Presets are
 * versioned; bump `version` whenever output for the same IR changes.
 */
export type Preset = {
  id: PresetId;
  version: number;
  name: string;
  texId: SafeLatex;
  texName: SafeLatex;
  rules: Omit<StructureRules, 'numbering'>;
  conventions: Conventions;
  style: ElementStyle;
  layout: LatexLayout;
  titleBlock: LatexTemplate['titleBlock'];
  titleSuffix?: keyof typeof TITLE_SUFFIX;
  /** Rendered alongside another preset rather than chosen on its own. */
  companionOf?: PresetId;
};

export type PresetId =
  | 'lecture-notes'
  | 'guided-notes'
  | 'guided-notes-filled'
  | 'worked-examples'
  | 'practice-worksheet'
  | 'answer-key'
  | 'quiz'
  | 'study-sheet'
  | 'exit-ticket'
  | 'board-snapshot';

const ALL_CALLOUTS: StructureRules['callouts'] = [
  'definition',
  'theorem',
  'note',
  'example',
  'announcement',
];

const NOTES_RULES: Preset['rules'] = {
  callouts: ALL_CALLOUTS,
  content: ALL_CONTENT,
  problems: true,
  solutions: 'all',
  answers: true,
  exampleSolutions: true,
  standaloneSolutions: true,
  answerSpace: null,
};

const PROBLEMS_ONLY: Preset['rules'] = {
  callouts: [],
  content: [],
  problems: true,
  solutions: 'none',
  answers: false,
  exampleSolutions: false,
  standaloneSolutions: false,
  answerSpace: { factor: 1.2, minLines: 3, maxLines: 12 },
};

const plain: ElementStyle = { boxed: [], columns: 1 };
const boxedCallouts: ElementStyle = { boxed: ['definition', 'theorem'], columns: 1 };

/** Everything not excluded; definitions and theorems boxed; examples with full solutions. */
export const LECTURE_NOTES: Preset = {
  id: 'lecture-notes',
  version: 2,
  name: 'Lecture Notes',
  texId: tex`lecture-notes`,
  texName: tex`Lecture Notes`,
  rules: NOTES_RULES,
  conventions: DEFAULT_CONVENTIONS,
  style: boxedCallouts,
  layout: DEFAULT_LAYOUT,
  titleBlock: 'standard',
};

/**
 * Lecture Notes with the teacher's key results replaced by writing space.
 * Only teacher-tagged blocks become blanks (the open question of AI-chosen
 * blanks is not settled); the filled companion is the answer.
 */
export const GUIDED_NOTES: Preset = {
  ...LECTURE_NOTES,
  id: 'guided-notes',
  version: 1,
  name: 'Guided Notes',
  texId: tex`guided-notes`,
  texName: tex`Guided Notes`,
  layout: { ...DEFAULT_LAYOUT, blankKeyResults: true },
  titleSuffix: 'guidedNotes',
};

export const GUIDED_NOTES_FILLED: Preset = {
  ...LECTURE_NOTES,
  id: 'guided-notes-filled',
  version: 1,
  name: 'Guided Notes (filled)',
  texId: tex`guided-notes-filled`,
  texName: tex`Guided Notes (filled)`,
  titleSuffix: 'guidedNotesFilled',
  companionOf: 'guided-notes',
};

/** Problems and examples with full solutions, nothing else. */
export const WORKED_EXAMPLES: Preset = {
  id: 'worked-examples',
  version: 1,
  name: 'Worked Examples',
  texId: tex`worked-examples`,
  texName: tex`Worked Examples`,
  rules: { ...NOTES_RULES, callouts: ['example'], content: [] },
  conventions: DEFAULT_CONVENTIONS,
  style: plain,
  layout: DEFAULT_LAYOUT,
  titleBlock: 'standard',
  titleSuffix: 'workedExamples',
};

/** Problems only, numbered, with answer space sized from the original solution. */
export const PRACTICE_WORKSHEET: Preset = {
  id: 'practice-worksheet',
  version: 2,
  name: 'Practice Worksheet',
  texId: tex`practice-worksheet`,
  texName: tex`Practice Worksheet`,
  rules: PROBLEMS_ONLY,
  conventions: DEFAULT_CONVENTIONS,
  style: plain,
  layout: DEFAULT_LAYOUT,
  titleBlock: 'standard',
  titleSuffix: 'practice',
};

/** Problems with final answers; a full solution only where there is no answer. */
export const ANSWER_KEY: Preset = {
  id: 'answer-key',
  version: 2,
  name: 'Answer Key',
  texId: tex`answer-key`,
  texName: tex`Answer Key`,
  rules: { ...PROBLEMS_ONLY, solutions: 'whenNoAnswer', answers: true, answerSpace: null },
  conventions: DEFAULT_CONVENTIONS,
  style: plain,
  layout: DEFAULT_LAYOUT,
  titleBlock: 'standard',
  titleSuffix: 'answerKey',
};

/** A worksheet with name, date and score lines, point values, and no page break inside a problem. */
export const QUIZ: Preset = {
  id: 'quiz',
  version: 1,
  name: 'Quiz',
  texId: tex`quiz`,
  texName: tex`Quiz`,
  rules: PROBLEMS_ONLY,
  conventions: DEFAULT_CONVENTIONS,
  style: plain,
  layout: { ...DEFAULT_LAYOUT, keepProblemsTogether: true },
  titleBlock: 'quiz',
  titleSuffix: 'quiz',
};

/** Definitions, theorems and formulas only, compact, in two columns. */
export const STUDY_SHEET: Preset = {
  id: 'study-sheet',
  version: 1,
  name: 'Study Sheet',
  texId: tex`study-sheet`,
  texName: tex`Study Sheet`,
  rules: {
    ...PROBLEMS_ONLY,
    callouts: ['definition', 'theorem'],
    content: ['displayMath'],
    problems: false,
    answerSpace: null,
  },
  conventions: { ...DEFAULT_CONVENTIONS, fontSize: 10 },
  style: { boxed: ['definition', 'theorem'], columns: 2 },
  layout: { ...DEFAULT_LAYOUT, columns: 2 },
  titleBlock: 'standard',
  titleSuffix: 'studySheet',
};

/** The last one to three problems, half a page, two copies per sheet. */
export const EXIT_TICKET: Preset = {
  id: 'exit-ticket',
  version: 1,
  name: 'Exit Ticket',
  texId: tex`exit-ticket`,
  texName: tex`Exit Ticket`,
  rules: {
    ...PROBLEMS_ONLY,
    answerSpace: { factor: 1, minLines: 2, maxLines: 5 },
    lastProblems: { max: 3, maxLines: 18 },
    sectionTitles: false,
  },
  conventions: DEFAULT_CONVENTIONS,
  style: plain,
  layout: { ...DEFAULT_LAYOUT, copies: 2 },
  titleBlock: 'standard',
  titleSuffix: 'exitTicket',
};

/** Everything in the order it was written, with minimal restructuring: a faithful record of the board. */
export const BOARD_SNAPSHOT: Preset = {
  id: 'board-snapshot',
  version: 1,
  name: 'Board Snapshot',
  texId: tex`board-snapshot`,
  texName: tex`Board Snapshot`,
  rules: { ...NOTES_RULES, order: 'board' },
  conventions: DEFAULT_CONVENTIONS,
  style: plain,
  layout: DEFAULT_LAYOUT,
  titleBlock: 'standard',
  titleSuffix: 'boardSnapshot',
};

export const BUILT_IN_PRESETS: Readonly<Record<PresetId, Preset>> = {
  'lecture-notes': LECTURE_NOTES,
  'guided-notes': GUIDED_NOTES,
  'guided-notes-filled': GUIDED_NOTES_FILLED,
  'worked-examples': WORKED_EXAMPLES,
  'practice-worksheet': PRACTICE_WORKSHEET,
  'answer-key': ANSWER_KEY,
  quiz: QUIZ,
  'study-sheet': STUDY_SHEET,
  'exit-ticket': EXIT_TICKET,
  'board-snapshot': BOARD_SNAPSHOT,
};

/** "Make the set": the three handouts most teachers want from one lesson. */
export const THE_SET: readonly PresetId[] = ['lecture-notes', 'practice-worksheet', 'answer-key'];

/** The presets a teacher picks from; companions are rendered alongside their preset. */
export const SELECTABLE_PRESETS: readonly PresetId[] = (
  Object.keys(BUILT_IN_PRESETS) as PresetId[]
).filter((id) => !BUILT_IN_PRESETS[id].companionOf);

export function buildTemplate(preset: Preset, conventions: Conventions): LatexTemplate {
  return {
    presetId: preset.texId,
    presetVersion: preset.version,
    presetName: preset.texName,
    classOptions: classOptions(conventions),
    preamble: buildPreamble(conventions, preset.style),
    labels: labelsFor(conventions.lang),
    titleBlock: preset.titleBlock,
    layout: preset.layout,
  };
}

export type PresetRendering = LatexRendering & { resolved: ResolvedConventions; preset: Preset };

/**
 * Renders a document with a preset. Switching presets never re-runs
 * recognition: it is the same IR through different rules and templates.
 * The document language is the default for the `lang` convention.
 */
export function renderWithPreset(
  doc: Doc,
  presetId: PresetId,
  chain: Omit<ConventionChain, 'preset'> = {},
): PresetRendering {
  const preset = BUILT_IN_PRESETS[presetId];
  const resolved = resolveConventions({
    ...chain,
    preset: { ...preset.conventions, lang: doc.meta.lang },
  });
  const { conventions } = resolved;
  const view = selectView(doc, { ...preset.rules, numbering: conventions.problemNumbering });
  if (preset.titleSuffix) {
    view.meta = {
      ...view.meta,
      title: titleWithSuffix(view.meta.title, preset.titleSuffix, conventions.lang),
    };
  }
  const rendering = renderLatex(view, buildTemplate(preset, conventions), conventions);
  return { ...rendering, resolved, preset };
}
