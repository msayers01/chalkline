/**
 * pnpm preview <lesson file> [--preset set|all|<id>,<id>] [--set key=value ...] [--out DIR] [--no-pdf]
 *
 * Renders a lesson written in the lesson format (packages/lesson/README.md)
 * with the chosen presets and conventions, and compiles each one to PDF in
 * the same sandboxed runner production uses.
 */
import { isAbsolute, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { PRESET_IDS, parseSettings, presetsFor, previewLesson } from './preview.js';

const usage = `Usage: pnpm preview <lesson file> [options]

  --preset set|all|<id>,...  presets to render (default: set = notes, worksheet, key)
                             ${PRESET_IDS.join(', ')}
  --set key=value            override a convention; repeatable, e.g.
                             --set font=pagella --set paperSize=a4 --set fontSize=14
                             --set lang=es --set decimalSeparator=comma --set vectors=bold
  --out DIR                  output folder (default: <lesson>-preview next to the lesson)
  --no-pdf                   write .tex only`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    preset: { type: 'string', default: 'set' },
    set: { type: 'string', multiple: true, default: [] },
    out: { type: 'string' },
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

const result = await previewLesson({
  lessonPath: fromCwd(lesson),
  presets: presets.presets,
  settings: settings.settings,
  pdf: !values['no-pdf'],
  ...(values.out ? { outDir: fromCwd(values.out) } : {}),
});

if (!result.ok) {
  for (const e of result.errors) console.error(`${show(fromCwd(lesson))}:${e.line}: ${e.message}`);
  process.exit(1);
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
