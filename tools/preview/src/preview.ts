import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import { Conventions, PartialConventions, type TransformNote } from '@chalkline/conventions';
import type { Doc } from '@chalkline/ir';
import { blockAtLine, type BlockFinding } from '@chalkline/latex';
import { parseLesson, type LessonError } from '@chalkline/lesson';
import {
  BUILT_IN_PRESETS,
  THE_SET,
  renderWithPreset,
  type PresetId,
  type PresetRendering,
} from '@chalkline/presets';
import {
  bubblewrapAvailable,
  compileBundle,
  findTexBin,
  placeholderPng,
  type CompileAsset,
} from '@chalkline/worker-compile';

export const PRESET_IDS = Object.keys(BUILT_IN_PRESETS) as PresetId[];

/** `set` (notes, worksheet, key), `all`, or a comma-separated list of preset ids. */
export function presetsFor(
  arg: string,
): { ok: true; presets: PresetId[] } | { ok: false; error: string } {
  if (arg === 'set') return { ok: true, presets: [...THE_SET] };
  if (arg === 'all') return { ok: true, presets: PRESET_IDS };
  const ids = arg
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const unknown = ids.filter((id) => !(PRESET_IDS as string[]).includes(id));
  if (unknown.length || ids.length === 0) {
    return {
      ok: false,
      error: `unknown preset ${unknown.join(', ') || '(none)'}; choose from set, all, ${PRESET_IDS.join(', ')}`,
    };
  }
  return { ok: true, presets: ids as PresetId[] };
}

/** `--set font=pagella --set fontSize=14 --set header=course,date` into validated conventions. */
export function parseSettings(
  pairs: readonly string[],
): { ok: true; settings: PartialConventions } | { ok: false; error: string } {
  const raw: Record<string, unknown> = {};
  for (const pair of pairs) {
    const m = /^([A-Za-z]+)=(.*)$/.exec(pair);
    if (!m) return { ok: false, error: `--set expects key=value, got "${pair}"` };
    const [, key = '', value = ''] = m;
    raw[key] =
      key === 'header'
        ? value
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : key === 'fontSize'
          ? Number(value)
          : value;
  }
  const parsed = PartialConventions.strict().safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const key = String(issue?.path[0] ?? '');
    const allowed = allowedValues(key);
    return {
      ok: false,
      error: allowed
        ? `--set ${key}: must be one of ${allowed.join(', ')}`
        : `--set ${key || pairs.join(' ')}: ${issue?.message ?? 'invalid'}`,
    };
  }
  return { ok: true, settings: parsed.data };
}

export type PresetOutcome = {
  preset: PresetId;
  texPath: string;
  pdfPath?: string;
  seconds?: number;
  compileError?: string;
  notes: string[];
};

export type PreviewOptions = {
  lessonPath: string;
  outDir?: string;
  presets: readonly PresetId[];
  settings: PartialConventions;
  pdf: boolean;
};

export type PreviewResult =
  | { ok: true; outDir: string; outcomes: PresetOutcome[]; sandbox: string }
  | { ok: false; errors: LessonError[] };

export async function previewLesson(options: PreviewOptions): Promise<PreviewResult> {
  const source = await readFile(options.lessonPath, 'utf8');
  const parsed = parseLesson(source);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };

  const name = basename(options.lessonPath, extname(options.lessonPath));
  const outDir = options.outDir ?? join(dirname(options.lessonPath), `${name}-preview`);
  await mkdir(outDir, { recursive: true });

  const texBin = options.pdf ? findTexBin() : undefined;
  const sandbox = bubblewrapAvailable() ? 'bwrap' : 'none';

  // Presets compile in parallel; each run is single-threaded.
  const outcomes = await Promise.all(
    options.presets.map(async (preset): Promise<PresetOutcome> => {
      const rendering = renderWithPreset(parsed.doc, preset, { teacher: options.settings });
      const texPath = join(outDir, `${preset}.tex`);
      await writeFile(texPath, rendering.tex);
      const outcome: PresetOutcome = {
        preset,
        texPath,
        notes: describe(rendering, parsed.lines, []),
      };

      if (options.pdf && texBin) {
        const assets = await loadAssets(rendering, dirname(options.lessonPath));
        const result = await compileBundle({ tex: rendering.tex, assets }, { texBin, sandbox });
        outcome.seconds = Math.round(result.durationMs / 100) / 10;
        outcome.notes = describe(rendering, parsed.lines, result.findings);
        if (result.pdf) {
          outcome.pdfPath = join(outDir, `${preset}.pdf`);
          await writeFile(outcome.pdfPath, result.pdf);
        } else {
          const error = result.findings.find((f) => f.kind === 'error');
          outcome.compileError = result.timedOut
            ? 'timed out'
            : (error?.message ?? 'no PDF produced');
          await writeFile(join(outDir, `${preset}.log`), result.log);
        }
      }
      return outcome;
    }),
  );
  return { ok: true, outDir, outcomes, sandbox };
}

/** Figures and image fallbacks use `<ref>.png` / `<ref>.pdf` next to the lesson, or a grey placeholder. */
async function loadAssets(rendering: PresetRendering, lessonDir: string): Promise<CompileAsset[]> {
  const assets: CompileAsset[] = [];
  for (const use of rendering.assets) {
    const file = join(lessonDir, basename(use.path));
    assets.push({
      path: use.path,
      bytes: existsSync(file) ? new Uint8Array(await readFile(file)) : placeholderPng(),
    });
  }
  return assets;
}

const lineOf = (lines: ReadonlyMap<string, number>, blockId: string | null | undefined) =>
  blockId ? lines.get(blockId) : undefined;

const at = (line: number | undefined) => (line ? `line ${line}: ` : '');

/** Everything a teacher should look at, pointing back at lesson lines. */
export function describe(
  rendering: PresetRendering,
  lines: ReadonlyMap<string, number>,
  findings: readonly BlockFinding[],
): string[] {
  const notes: string[] = [];
  for (const issue of rendering.issues) {
    if (issue.code === 'mathRejected') {
      notes.push(
        `${at(lineOf(lines, issue.blockId))}math could not be typeset (${issue.reason}); a placeholder was printed`,
      );
    } else {
      notes.push(
        `${at(lineOf(lines, issue.blockId))}contains characters the fonts may not have (they may print as blanks)`,
      );
    }
  }
  for (const s of rendering.suggestions) {
    notes.push(`${at(lineOf(lines, s.blockId))}${suggestionText(s)}`);
  }
  for (const f of findings) {
    if (f.kind !== 'overfull') continue;
    const blockId = blockAtLine(rendering.sourceMap, f.line);
    notes.push(`${at(lineOf(lines, blockId))}a line is ${f.points}pt too wide for the page`);
  }
  return [...new Set(notes)];
}

export type { Doc };

const SUGGESTIONS: Record<string, string> = {
  'multiplicationSign/vectorProduct':
    'the multiplication sign between vectors was left as written (dot and cross are different products)',
  'vectors/arrowToBold': 'an arrow over more than one letter was left as written',
  'vectors/boldToArrow': 'bold letters were left as written (they may not be vectors)',
  'derivatives/leibnizToPrime':
    'derivative notation was left as written (the variable is not clear)',
  'derivatives/primeToLeibniz':
    'derivative notation was left as written (the variable is not clear)',
};

function suggestionText(note: TransformNote): string {
  return (
    SUGGESTIONS[`${note.convention}/${note.detail}`] ??
    `${note.convention} (${note.detail}) was left as written because the change was ambiguous`
  );
}

/** The values a convention accepts, for error messages ("must be one of ..."). */
function allowedValues(key: string): string[] | undefined {
  const field = (Conventions.shape as Record<string, unknown>)[key] as
    { options?: unknown[] } | undefined;
  const options = field?.options;
  if (!Array.isArray(options)) return undefined;
  return options.map((o) =>
    typeof o === 'object' && o !== null && 'value' in o ? String(o.value) : String(o),
  );
}
