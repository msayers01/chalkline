import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { parseLatexLog, type LogFinding } from '@chalkline/latex';

/**
 * Compiles one bundle (main.tex plus assets) with latexmk and LuaLaTeX.
 *
 * Defense in depth: the .tex only ever comes from the renderer, and the run
 * is still treated as hostile. Shell escape is off, TeX may only open files
 * inside the job directory, latexmk ignores rc files, and in production the
 * whole process runs in a bubblewrap sandbox with no network namespace and a
 * read-only view of the system. The job directory is deleted afterwards.
 */

export type CompileAsset = { path: string; bytes: Uint8Array };

export type CompileJob = { tex: string; assets: readonly CompileAsset[] };

export type SandboxMode = 'bwrap' | 'none';

export type CompileOptions = {
  /** Directory holding latexmk and lualatex; defaults to PATH lookup. */
  texBin?: string;
  /** Wall clock limit; the process group is killed when it is reached. */
  timeoutMs?: number;
  /** `none` is for local development only. */
  sandbox: SandboxMode;
  /** Read-only paths visible inside the sandbox (the TeX installation, system libraries). */
  sandboxReadOnly?: readonly string[];
  maxOutputBytes?: number;
  workRoot?: string;
};

export type CompileResult = {
  ok: boolean;
  pdf?: Uint8Array;
  log: string;
  findings: LogFinding[];
  timedOut: boolean;
  durationMs: number;
  /** Why the run failed before or after TeX itself (bad asset path, output too large). */
  refusal?: 'invalidAssetPath' | 'outputTooLarge';
};

export const COMPILE_DEFAULTS = {
  timeoutMs: 60_000,
  maxOutputBytes: 50 * 1024 * 1024,
  // No /etc beyond fonts and the loader cache, no /home, nothing writable but the job directory.
  sandboxReadOnly: ['/usr', '/opt/texlive', '/etc/fonts', '/etc/ld.so.cache'],
} as const;

const ASSET_PATH = /^assets\/[A-Za-z0-9_-]{1,64}\.(?:png|pdf)$/;

/** The compile cache key: sha256 over the source, the assets and the TeX Live release. */
export function compileCacheKey(job: CompileJob, texliveRelease: number): string {
  const hash = createHash('sha256');
  hash.update(`texlive:${texliveRelease}\n`);
  hash.update(job.tex);
  for (const asset of [...job.assets].sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  )) {
    hash.update(`\nasset:${asset.path}:${createHash('sha256').update(asset.bytes).digest('hex')}`);
  }
  return hash.digest('hex');
}

export function latexmkArgs(): string[] {
  return [
    '-norc',
    '-lualatex',
    '-interaction=nonstopmode',
    '-halt-on-error',
    '-file-line-error',
    '-no-shell-escape',
    'main.tex',
  ];
}

/** kpathsea settings, passed as environment variables so they override texmf.cnf. */
export function texEnvironment(workDir: string): Record<string, string> {
  return {
    shell_escape: 'f',
    openin_any: 'p',
    openout_any: 'p',
    TEXMFOUTPUT: workDir,
    HOME: workDir,
    max_print_line: '1000',
  };
}

function sandboxed(
  command: string,
  args: string[],
  workDir: string,
  options: CompileOptions,
): [string, string[]] {
  if (options.sandbox === 'none') return [command, args];
  const readOnly = [...(options.sandboxReadOnly ?? COMPILE_DEFAULTS.sandboxReadOnly)];
  // The TeX installation in use must be visible: <prefix>/<release>/bin/<platform>.
  if (options.texBin) readOnly.push(resolve(options.texBin, '..', '..', '..'));
  return [
    'bwrap',
    [
      '--unshare-all',
      '--die-with-parent',
      '--new-session',
      // Order matters: later mounts are layered over earlier ones.
      '--tmpfs',
      '/tmp',
      ...readOnly.flatMap((p) => ['--ro-bind-try', p, p]),
      '--symlink',
      'usr/bin',
      '/bin',
      '--symlink',
      'usr/lib',
      '/lib',
      '--symlink',
      'usr/lib64',
      '/lib64',
      '--proc',
      '/proc',
      '--dev',
      '/dev',
      '--bind',
      workDir,
      workDir,
      '--chdir',
      workDir,
      command,
      ...args,
    ],
  ];
}

export async function compileBundle(
  job: CompileJob,
  options: CompileOptions,
): Promise<CompileResult> {
  const started = Date.now();
  const timeoutMs = options.timeoutMs ?? COMPILE_DEFAULTS.timeoutMs;
  const maxOutput = options.maxOutputBytes ?? COMPILE_DEFAULTS.maxOutputBytes;

  if (job.assets.some((a) => !ASSET_PATH.test(a.path))) {
    return {
      ok: false,
      log: '',
      findings: [],
      timedOut: false,
      durationMs: 0,
      refusal: 'invalidAssetPath',
    };
  }

  const workDir = await mkdtemp(join(options.workRoot ?? tmpdir(), 'chalkline-compile-'));
  try {
    await writeFile(join(workDir, 'main.tex'), job.tex, 'utf8');
    for (const asset of job.assets) {
      const target = join(workDir, asset.path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, asset.bytes);
    }

    const latexmk = options.texBin ? join(options.texBin, 'latexmk') : 'latexmk';
    const [command, args] = sandboxed(latexmk, latexmkArgs(), workDir, options);
    const path = [options.texBin, process.env.PATH].filter(Boolean).join(':');
    const timedOut = await run(
      command,
      args,
      workDir,
      { PATH: path, ...texEnvironment(workDir) },
      timeoutMs,
    );

    const log = await readFile(join(workDir, 'main.log'), 'utf8').catch(() => '');
    const findings = parseLatexLog(log);
    const pdfPath = join(workDir, 'main.pdf');
    const size = await stat(pdfPath)
      .then((s) => s.size)
      .catch(() => -1);
    const durationMs = Date.now() - started;
    if (size > maxOutput)
      return { ok: false, log, findings, timedOut, durationMs, refusal: 'outputTooLarge' };
    const failed = timedOut || size < 0 || findings.some((f) => f.kind === 'error');
    if (failed) return { ok: false, log, findings, timedOut, durationMs };
    return {
      ok: true,
      pdf: new Uint8Array(await readFile(pdfPath)),
      log,
      findings,
      timedOut,
      durationMs,
    };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

/** Runs a command to completion; resolves to true if it had to be killed for time. */
function run(
  command: string,
  args: string[],
  cwd: string,
  env: Record<string, string>,
  timeoutMs: number,
): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: 'ignore', detached: true });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      if (child.pid !== undefined) process.kill(-child.pid, 'SIGKILL');
    }, timeoutMs);
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('exit', () => {
      clearTimeout(timer);
      resolve(timedOut);
    });
  });
}
