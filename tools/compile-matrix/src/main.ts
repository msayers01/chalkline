/**
 * pnpm compile-matrix [--quick] [--only TEXT] [--jobs N] [--random N] [--seed N] [--out DIR]
 *
 * Compiles every built-in preset x fixture x key convention variant, plus the
 * allowlist and random-sanitizer documents, in the sandboxed runner; then
 * validates every PDF against PDF/UA-2 with veraPDF when it is available
 * ($VERAPDF or /opt/verapdf/verapdf). Exits non-zero on any compile failure
 * or UA-2 failure. Outputs land in tools/compile-matrix/out/ for inspection.
 */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs, promisify } from 'node:util';
import type { ConventionChain } from '@chalkline/conventions';
import type { Doc } from '@chalkline/ir';
import { fixtures } from '@chalkline/ir/fixtures';
import { blockAtLine } from '@chalkline/latex';
import { BUILT_IN_PRESETS, renderWithPreset, type PresetId } from '@chalkline/presets';
import {
  bubblewrapAvailable,
  compileBundle,
  findTexBin,
  placeholderPng,
  type CompileOptions,
} from '@chalkline/worker-compile';
import { boardDocs } from './board.js';
import { allowlistDoc, randomDoc } from './samples.js';

type Variant = { name: string; chain: Omit<ConventionChain, 'preset'> };

const VARIANTS: Variant[] = [
  { name: 'default', chain: {} },
  {
    name: 'pagella-a4-numbered',
    chain: {
      teacher: {
        font: 'pagella',
        paperSize: 'a4',
        fontSize: 12,
        equationNumbers: 'all',
        decimalSeparator: 'comma',
        vectors: 'bold',
        differentialD: 'upright',
        multiplicationSign: 'cdot',
      },
    },
  },
  {
    name: 'termes-compact-plain',
    chain: {
      teacher: {
        font: 'termes',
        fontSize: 10,
        finalAnswers: 'plain',
        inkColor: 'monochrome',
        problemNumbering: 'restartEachSection',
        header: ['course', 'teacher', 'date', 'unit', 'lessonTitle', 'pageXofY'],
      },
    },
  },
  { name: 'sans-large-print', chain: { teacher: { font: 'sans', fontSize: 14 } } },
];

type Case = { id: string; doc: () => Doc; preset: PresetId; variant: Variant };

type Outcome = {
  id: string;
  ok: boolean;
  seconds: number;
  overfull: number;
  error?: string;
  ua2?: 'pass' | 'fail' | 'skipped';
};

const { values } = parseArgs({
  options: {
    quick: { type: 'boolean', default: false },
    only: { type: 'string' },
    jobs: { type: 'string' },
    random: { type: 'string', default: '300' },
    seed: { type: 'string', default: '20261020' },
    out: { type: 'string' },
  },
});

const texBin = findTexBin();
if (!texBin) {
  console.error(
    'compile-matrix: no TeX Live with lualatex found (set TEXLIVE_BIN). See apps/worker-compile/toolchain/.',
  );
  process.exit(2);
}
const sandbox = bubblewrapAvailable() ? 'bwrap' : 'none';
if (sandbox === 'none')
  console.warn('compile-matrix: bubblewrap not found, compiling WITHOUT the sandbox.');
const options: CompileOptions = { texBin, sandbox };
const outDir = resolve(values.out ?? join(import.meta.dirname, '..', 'out'));
const jobs = Number(values.jobs ?? Math.max(1, Math.min(4, availableParallelism())));

const presets = Object.keys(BUILT_IN_PRESETS) as PresetId[];
const variants = values.quick ? VARIANTS.slice(0, 1) : VARIANTS;
const cases: Case[] = [];
for (const [fixture, build] of Object.entries(fixtures)) {
  for (const preset of presets) {
    for (const variant of variants)
      cases.push({ id: `${preset}__${fixture}__${variant.name}`, doc: build, preset, variant });
  }
}
const random = Number(values.random);
const seed = Number(values.seed);
cases.push({
  id: 'lecture-notes__allowlist__default',
  doc: allowlistDoc,
  preset: 'lecture-notes',
  variant: VARIANTS[0] as Variant,
});
if (random > 0) {
  cases.push({
    id: `lecture-notes__random-${seed}__default`,
    doc: () => randomDoc(random, seed),
    preset: 'lecture-notes',
    variant: VARIANTS[0] as Variant,
  });
}

// Pipeline output: every fixture through the simulated board, with the
// compile probe running against this TeX Live first.
const board = await boardDocs({
  compile: async (job) => {
    const result = await compileBundle(job, options);
    return result.ok ? 'ok' : result.timedOut ? 'unavailable' : 'failed';
  },
  placeholder: placeholderPng(),
});
for (const [name, report] of Object.entries(board.probes)) {
  const verdict = report.unavailable ? 'no verdict' : `${report.failed.length} failed`;
  console.log(
    `compile-matrix: probe ${name}: ${report.probed} blocks, ${report.compiles} compiles, ${verdict}`,
  );
}
for (const [name, doc] of Object.entries(board.docs)) {
  const boardPresets = name === 'board-model-quadratics' ? presets : (['lecture-notes'] as const);
  for (const preset of boardPresets) {
    cases.push({
      id: `${preset}__${name}__default`,
      doc: () => doc,
      preset,
      variant: VARIANTS[0] as Variant,
    });
  }
}

const selected = values.only ? cases.filter((c) => c.id.includes(values.only ?? '')) : cases;

async function runCase(c: Case): Promise<Outcome> {
  const rendering = renderWithPreset(c.doc(), c.preset, c.variant.chain);
  const assets = rendering.assets.map((a) => ({ path: a.path, bytes: placeholderPng() }));
  const result = await compileBundle({ tex: rendering.tex, assets }, options);
  const dir = join(outDir, c.id);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'main.tex'), rendering.tex);
  await writeFile(join(dir, 'main.log'), result.log);
  if (result.pdf) await writeFile(join(dir, 'main.pdf'), result.pdf);
  const firstError = result.findings.find((f) => f.kind === 'error');
  const errorBlock =
    firstError?.line !== undefined ? blockAtLine(rendering.sourceMap, firstError.line) : undefined;
  const outcome: Outcome = {
    id: c.id,
    ok: result.ok,
    seconds: Math.round(result.durationMs / 100) / 10,
    overfull: result.findings.filter((f) => f.kind === 'overfull').length,
  };
  if (!result.ok) {
    const where = errorBlock ? ` (block ${errorBlock})` : '';
    outcome.error = result.timedOut
      ? 'timed out'
      : `${firstError?.message ?? result.refusal ?? 'no PDF'}${where}`;
  }
  return outcome;
}

async function pool<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await fn(items[i] as T);
      }
    }),
  );
  return results;
}

function verapdfPath(): string | undefined {
  const candidates = [process.env.VERAPDF, '/opt/verapdf/verapdf'].filter((p): p is string => !!p);
  return candidates.find((p) => existsSync(p));
}

async function validateUa2(outcomes: Outcome[]): Promise<void> {
  const verapdf = verapdfPath();
  const compiled = outcomes.filter((o) => o.ok);
  if (!verapdf) {
    for (const o of compiled) o.ua2 = 'skipped';
    console.warn(
      'compile-matrix: veraPDF not found; PDF/UA-2 validation skipped (apps/worker-compile/toolchain/install-verapdf.sh).',
    );
    return;
  }
  const files = compiled.map((o) => join(outDir, o.id, 'main.pdf'));
  const { stdout } = await promisify(execFile)(
    verapdf,
    ['--flavour', 'ua2', '--format', 'text', ...files],
    {
      maxBuffer: 64 * 1024 * 1024,
    },
  ).catch((e: { stdout?: string }) => ({ stdout: e.stdout ?? '' }));
  for (const o of compiled) {
    const line = stdout.split('\n').find((l) => l.includes(join(outDir, o.id, 'main.pdf')));
    o.ua2 = line?.startsWith('PASS') ? 'pass' : 'fail';
  }
}

await rm(outDir, { recursive: true, force: true });
console.log(
  `compile-matrix: ${selected.length} documents, ${jobs} at a time, sandbox=${sandbox}, TeX Live at ${texBin}`,
);
const started = Date.now();
const outcomes = await pool(selected, jobs, runCase);
await validateUa2(outcomes);

for (const o of outcomes) {
  const status = o.ok ? (o.ua2 === 'fail' ? 'UA2-FAIL' : 'ok') : 'FAIL';
  const extra = [
    o.overfull ? `${o.overfull} overfull` : '',
    o.ua2 ? `ua2:${o.ua2}` : '',
    o.error ?? '',
  ]
    .filter(Boolean)
    .join('  ');
  console.log(`${status.padEnd(9)} ${o.id.padEnd(58)} ${String(o.seconds).padStart(5)}s  ${extra}`);
}
const failed = outcomes.filter((o) => !o.ok || o.ua2 === 'fail');
// A block the sanitizer accepted but TeX rejected is a sanitizer bug, even though the pipeline coped.
const probeFailures = Object.values(board.probes).flatMap((r) => r.failed);
await writeFile(join(outDir, 'summary.json'), `${JSON.stringify(outcomes, null, 2)}\n`);
console.log(
  `compile-matrix: ${outcomes.length - failed.length}/${outcomes.length} passed in ${Math.round((Date.now() - started) / 1000)}s` +
    (failed.length ? `; failed: ${failed.map((f) => f.id).join(', ')}` : '') +
    (probeFailures.length ? `; probe rejected blocks ${probeFailures.join(', ')}` : ''),
);
process.exit(failed.length || probeFailures.length ? 1 : 0);
