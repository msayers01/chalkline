import { describe, expect, it } from 'vitest';
import {
  bubblewrapAvailable,
  compileBundle,
  compileCacheKey,
  findTexBin,
  pathEntries,
  placeholderPng,
  texEnvironment,
  type CompileOptions,
} from '../src/index.js';

const texBin = findTexBin();
const sandbox = bubblewrapAvailable() ? 'bwrap' : 'none';
const options: CompileOptions = { sandbox, timeoutMs: 60_000, ...(texBin ? { texBin } : {}) };

const doc = (body: string) =>
  `\\documentclass{article}\n\\begin{document}\n${body}\n\\end{document}\n`;

describe('compileCacheKey', () => {
  it('is stable, order independent over assets, and changes with the TeX Live release', () => {
    const a = { path: 'assets/a.png', bytes: new Uint8Array([1]) };
    const b = { path: 'assets/b.png', bytes: new Uint8Array([2]) };
    const k1 = compileCacheKey({ tex: 'x', assets: [a, b] }, 2026);
    expect(compileCacheKey({ tex: 'x', assets: [b, a] }, 2026)).toBe(k1);
    expect(compileCacheKey({ tex: 'x', assets: [a, b] }, 2027)).not.toBe(k1);
    expect(
      compileCacheKey({ tex: 'x', assets: [a, { ...b, bytes: new Uint8Array([3]) }] }, 2026),
    ).not.toBe(k1);
  });
});

describe('TeX Live on Windows', () => {
  it("finds the setup script's install, then PATH, by .exe names", () => {
    const files = new Set([
      'C:\\texlive\\2026\\bin\\windows\\lualatex.exe',
      'C:\\texlive\\2026\\bin\\windows\\latexmk.exe',
      'D:\\tl\\bin\\lualatex.exe',
      'D:\\tl\\bin\\latexmk.exe',
    ]);
    const exists = (p: string) => files.has(p);
    expect(findTexBin({}, 'win32', exists)).toBe('C:\\texlive\\2026\\bin\\windows');
    files.delete('C:\\texlive\\2026\\bin\\windows\\latexmk.exe');
    // Windows spells it Path; entries are separated by semicolons.
    expect(findTexBin({ Path: 'C:\\Windows;D:\\tl\\bin' }, 'win32', exists)).toBe('D:\\tl\\bin');
    expect(findTexBin({ PATH: '/usr/bin' }, 'linux', exists)).toBeUndefined();
  });

  it("splits PATH the platform's way", () => {
    expect(pathEntries({ Path: 'C:\\a;C:\\b;' }, 'win32')).toEqual(['C:\\a', 'C:\\b']);
    expect(pathEntries({ PATH: '/a:/b' }, 'linux')).toEqual(['/a', '/b']);
  });

  it('gives TeX the system root and keeps temporary files in the job', () => {
    const env = texEnvironment('C:\\job', 'win32', {
      SYSTEMROOT: 'C:\\Windows',
      ANTHROPIC_API_KEY: 'secret',
      TEMP: 'C:\\Users\\t\\Temp',
    });
    expect(env).toMatchObject({
      SYSTEMROOT: 'C:\\Windows',
      TEMP: 'C:\\job',
      TMP: 'C:\\job',
      openin_any: 'p',
    });
    expect(Object.keys(env)).not.toContain('ANTHROPIC_API_KEY');
    expect(texEnvironment('/job', 'linux', { SystemRoot: 'x' })).not.toHaveProperty('SystemRoot');
  });
});

describe('placeholderPng', () => {
  it('produces a PNG', () => {
    expect(Array.from(placeholderPng(2, 2).slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });
});

describe.skipIf(!texBin)(`compileBundle (sandbox: ${sandbox})`, () => {
  it('compiles a document with assets and cleans up', async () => {
    const result = await compileBundle(
      {
        tex: doc(
          '\\usepackage{graphicx}Hello \\(x^2\\). \\includegraphics[width=2cm]{assets/fig.png}',
        ).replace(
          '\\begin{document}\n\\usepackage{graphicx}',
          '\\usepackage{graphicx}\n\\begin{document}\n',
        ),
        assets: [{ path: 'assets/fig.png', bytes: placeholderPng() }],
      },
      options,
    );
    expect(result.findings.filter((f) => f.kind === 'error')).toEqual([]);
    expect(result.ok).toBe(true);
    expect(new TextDecoder().decode(result.pdf?.slice(0, 5))).toBe('%PDF-');
  }, 120_000);

  it('refuses asset paths outside assets/', async () => {
    const result = await compileBundle(
      { tex: doc('x'), assets: [{ path: '../evil.png', bytes: new Uint8Array() }] },
      options,
    );
    expect(result).toMatchObject({ ok: false, refusal: 'invalidAssetPath' });
  });

  it('cannot read files outside the job directory', async () => {
    const result = await compileBundle({ tex: doc('\\input{/etc/hostname}'), assets: [] }, options);
    expect(result.ok).toBe(false);
  }, 120_000);

  it('has shell escape disabled', async () => {
    const result = await compileBundle(
      {
        tex: doc(
          '\\immediate\\write18{echo pwned > pwned.txt}\\IfFileExists{pwned.txt}{\\errmessage{shell escape ran}}{}' +
            "\\directlua{if status.shell_escape ~= 0 then tex.error('shell escape on') end} ok",
        ),
        assets: [],
      },
      options,
    );
    expect(result.ok).toBe(true);
  }, 120_000);

  it.skipIf(sandbox !== 'bwrap')(
    'hides the rest of the file system from Lua',
    async () => {
      const probe =
        "\\directlua{if io.open('/etc/hostname') or io.open('/root') then tex.error('escaped sandbox') end}";
      const result = await compileBundle({ tex: doc(`${probe} ok`), assets: [] }, options);
      expect(result.findings.filter((f) => f.kind === 'error')).toEqual([]);
      expect(result.ok).toBe(true);
    },
    120_000,
  );

  it('kills runaway jobs at the time limit', async () => {
    const result = await compileBundle(
      { tex: doc('\\loop\\iftrue\\repeat'), assets: [] },
      { ...options, timeoutMs: 3_000 },
    );
    expect(result).toMatchObject({ ok: false, timedOut: true });
  }, 60_000);
});
