import {
  DEFAULT_CONVENTIONS,
  resolveConventions,
  type ConventionChain,
  type Conventions,
  type ResolvedConventions,
} from '@chalkline/conventions';
import { selectView, type Doc, type StructureRules } from '@chalkline/ir';
import {
  renderLatex,
  tex,
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
  titleBlock: LatexTemplate['titleBlock'];
  titleSuffix?: keyof typeof TITLE_SUFFIX;
};

export type PresetId = 'lecture-notes' | 'practice-worksheet' | 'answer-key';

export const LECTURE_NOTES: Preset = {
  id: 'lecture-notes',
  version: 1,
  name: 'Lecture Notes',
  texId: tex`lecture-notes`,
  texName: tex`Lecture Notes`,
  rules: {
    callouts: ['definition', 'theorem', 'note', 'example', 'announcement'],
    content: true,
    problems: true,
    solutions: 'all',
    answers: true,
    exampleSolutions: true,
    standaloneSolutions: true,
    answerSpace: null,
  },
  conventions: DEFAULT_CONVENTIONS,
  style: { boxed: ['definition', 'theorem'] },
  titleBlock: 'standard',
};

export const PRACTICE_WORKSHEET: Preset = {
  id: 'practice-worksheet',
  version: 1,
  name: 'Practice Worksheet',
  texId: tex`practice-worksheet`,
  texName: tex`Practice Worksheet`,
  rules: {
    callouts: [],
    content: false,
    problems: true,
    solutions: 'none',
    answers: false,
    exampleSolutions: false,
    standaloneSolutions: false,
    answerSpace: { factor: 1.2, minLines: 3, maxLines: 12 },
  },
  conventions: DEFAULT_CONVENTIONS,
  style: { boxed: [] },
  titleBlock: 'standard',
  titleSuffix: 'practice',
};

export const ANSWER_KEY: Preset = {
  id: 'answer-key',
  version: 1,
  name: 'Answer Key',
  texId: tex`answer-key`,
  texName: tex`Answer Key`,
  rules: {
    callouts: [],
    content: false,
    problems: true,
    solutions: 'whenNoAnswer',
    answers: true,
    exampleSolutions: false,
    standaloneSolutions: false,
    answerSpace: null,
  },
  conventions: DEFAULT_CONVENTIONS,
  style: { boxed: [] },
  titleBlock: 'standard',
  titleSuffix: 'answerKey',
};

export const BUILT_IN_PRESETS: Readonly<Record<PresetId, Preset>> = {
  'lecture-notes': LECTURE_NOTES,
  'practice-worksheet': PRACTICE_WORKSHEET,
  'answer-key': ANSWER_KEY,
};

/** "Make the set": the three handouts most teachers want from one lesson. */
export const THE_SET: readonly PresetId[] = ['lecture-notes', 'practice-worksheet', 'answer-key'];

export function buildTemplate(preset: Preset, conventions: Conventions): LatexTemplate {
  return {
    presetId: preset.texId,
    presetVersion: preset.version,
    presetName: preset.texName,
    classOptions: classOptions(conventions),
    preamble: buildPreamble(conventions, preset.style),
    labels: labelsFor(conventions.lang),
    titleBlock: preset.titleBlock,
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
