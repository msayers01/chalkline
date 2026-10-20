/**
 * pnpm preview <lesson file> [--preset set|all|<id>,<id>] [--set key=value ...] [--board MODE] [--out DIR] [--no-pdf]
 *
 * Renders a lesson written in the lesson format (packages/lesson/README.md)
 * with the chosen presets and conventions, and compiles each one to PDF in
 * the same sandboxed runner production uses.
 */
import { existsSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  BOARD_MODES,
  PRESET_IDS,
  parseSettings,
  presetsFor,
  previewLesson,
  type BoardMode,
} from './preview.js';

const usage = `Usage: pnpm preview <lesson file> [options]

  --preset set|all|<id>,...  presets to render (default: set = notes, worksheet, key)
                             ${PRESET_IDS.join(', ')}
  --set key=value            override a convention; repeatable, e.g.
                             --set font=pagella --set paperSize=a4 --set fontSize=14
                             --set lang=es --set decimalSeparator=comma --set vectors=bold
  --board heuristic|ideal|claude
                             write the lesson on a simulated board and run it through
                             recognition and structuring first: the heuristic structurer,
                             a model that knows the right answer, or Claude (needs
                             ANTHROPIC_API_KEY, from the environment or .env.local)
  --out DIR                  output folder (default: <lesson>-preview next to the lesson)
  --no-pdf                   write .tex only`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    preset: { type: 'string', default: 'set' },
    set: { type: 'string', multiple: true, default: [] },
    out: { type: 'string' },
    board: { type: 'string' },
    'no-pdf': { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  },
});

// pnpm runs scripts from this package's folder; resolve paths against where the user typed the command.
const cwd = process.env.INIT_CWD ?? process.cwd();
const fromCwd = (p: string) => (isAbsolute(p) ? p : resolve(cwd, p));
const show = (p: string) => relative(cwd, p) || '.';

const [lesson] = positionals;
if (values.help || !lesson) {
  console.log(usage);
  process.exit(lesson || values.help ? 0 : 2);
}

const presets = presetsFor(values.preset);
if (!presets.ok) {
  console.error(presets.error);
  process.exit(2);
}
const settings = parseSettings(values.set);
if (!settings.ok) {
  console.error(settings.error);
  process.exit(2);
}

const board = values.board as BoardMode | undefined;
if (board !== undefined && !BOARD_MODES.includes(board)) {
  console.error(`--board must be one of ${BOARD_MODES.join(', ')}`);
  process.exit(2);
}
if (board === 'claude') {
  // Keys live in .env.local at the repository root, never in the repository.
  const envFile = join(import.meta.dirname, '..', '..', '..', '.env.local');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('--board claude needs ANTHROPIC_API_KEY (in the environment or .env.local)');
    process.exit(2);
  }
}

const result = await previewLesson({
  lessonPath: fromCwd(lesson),
  presets: presets.presets,
  settings: settings.settings,
  pdf: !values['no-pdf'],
  ...(values.out ? { outDir: fromCwd(values.out) } : {}),
  ...(board ? { board } : {}),
});

if (!result.ok) {
  for (const e of result.errors) console.error(`${show(fromCwd(lesson))}:${e.line}: ${e.message}`);
  process.exit(1);
}

if (result.board) {
  const { structure, counts } = result.board;
  const by =
    structure.by === 'ai'
      ? `${structure.model ?? 'model'} (${structure.attempts} attempt${structure.attempts === 1 ? '' : 's'})`
      : `heuristic${structure.fallback && structure.fallback !== 'noModel' ? ` (model ${structure.fallback})` : ''}`;
  console.log(
    `board: structured by ${by}; ${counts.ready} ready, ${counts.check} to check, ${counts.image} images, ${counts.excluded} excluded`,
  );
}

let failed = false;
for (const o of result.outcomes) {
  const status = o.pdfPath
    ? `${show(o.pdfPath)} (${o.seconds}s)`
    : o.compileError
      ? `FAILED: ${o.compileError}`
      : show(o.texPath);
  console.log(`${o.preset.padEnd(20)} ${status}`);
  for (const note of o.notes) console.log(`  - ${note}`);
  if (o.compileError) failed = true;
}
if (!values['no-pdf'] && result.outcomes.every((o) => !o.pdfPath && !o.compileError)) {
  console.warn(
    'No TeX Live found, so only .tex files were written. Install it with apps/worker-compile/toolchain/install-texlive.sh.',
  );
} else if (result.sandbox === 'none' && !values['no-pdf']) {
  console.warn('bubblewrap not found: compiled without the sandbox.');
}
process.exit(failed ? 1 : 0);
