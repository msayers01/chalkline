import { existsSync } from 'node:fs';
import { posix, win32 } from 'node:path';

/** A program's file name: `lualatex.exe` on Windows, `lualatex` elsewhere. */
export function executable(name: string, platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32' ? `${name}.exe` : name;
}

/** PATH entries; Windows separates them with `;` and may spell the variable `Path`. */
export function pathEntries(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
): string[] {
  const path =
    platform === 'win32'
      ? Object.entries(env).find(([k]) => k.toUpperCase() === 'PATH')?.[1]
      : env.PATH;
  return (path ?? '').split(platform === 'win32' ? ';' : ':').filter(Boolean);
}

/**
 * Finds a TeX Live bin directory with lualatex: $TEXLIVE_BIN, then the
 * pinned install location (the compile image's on Linux, the Windows setup
 * script's on Windows), then PATH.
 */
export function findTexBin(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  exists: (path: string) => boolean = existsSync,
): string | undefined {
  const pinned =
    platform === 'win32' ? 'C:\\texlive\\2026\\bin\\windows' : '/opt/texlive/2026/bin/x86_64-linux';
  const candidates = [env.TEXLIVE_BIN, pinned, ...pathEntries(env, platform)].filter(
    (p): p is string => !!p,
  );
  const join = platform === 'win32' ? win32.join : posix.join;
  return candidates.find(
    (dir) =>
      exists(join(dir, executable('lualatex', platform))) &&
      exists(join(dir, executable('latexmk', platform))),
  );
}

/** bubblewrap is Linux-only; Windows compiles always run unsandboxed (development only). */
export function bubblewrapAvailable(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (platform !== 'linux') return false;
  return pathEntries(env, platform).some((dir) => existsSync(posix.join(dir, 'bwrap')));
}
