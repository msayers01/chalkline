import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';

/**
 * Finds a TeX Live bin directory with lualatex: $TEXLIVE_BIN, then the
 * pinned install location used by the compile image, then PATH.
 */
export function findTexBin(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const candidates = [
    env.TEXLIVE_BIN,
    '/opt/texlive/2026/bin/x86_64-linux',
    ...(env.PATH ?? '').split(delimiter),
  ].filter((p): p is string => !!p);
  return candidates.find(
    (dir) => existsSync(join(dir, 'lualatex')) && existsSync(join(dir, 'latexmk')),
  );
}

export function bubblewrapAvailable(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.PATH ?? '').split(delimiter).some((dir) => existsSync(join(dir, 'bwrap')));
}
