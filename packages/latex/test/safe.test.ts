import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  BANNED_MACROS,
  MATH_ENVIRONMENTS,
  MATH_MACROS,
  TEXT_MACROS,
  assetPath,
  escapeText,
  sanitizeMath,
  tex,
  texInt,
} from '../src/safe/index.js';

const SPECIALS = /[\\{}$&#^_%~]/;

/** Removes every escape sequence escapeText may produce; nothing special may remain. */
function stripTextEscapes(s: string): string {
  return s
    .replace(
      /\\textbackslash\{\}|\\textasciicircum\{\}|\\textasciitilde\{\}|\\textasciigrave\{\}/g,
      '',
    )
    .replace(/\\[{}$&#_%]/g, '')
    .replace(/-\{\}|'\{\}|\{\[\}/g, '');
}

function bracesBalanced(s: string): boolean {
  let depth = 0;
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (ch === '\\') {
      i += 1; // skip the escaped character (\{ \} \\ ...)
      continue;
    }
    if (ch === '{') depth += 1;
    if (ch === '}') depth -= 1;
    if (depth < 0) return false;
  }
  return depth === 0;
}

describe('escapeText', () => {
  it('escapes every special character', () => {
    expect(escapeText('50% & #2 $5 a_b ^ ~ {x} \\')).toBe(
      '50\\% \\& \\#2 \\$5 a\\_b \\textasciicircum{} \\textasciitilde{} \\{x\\} \\textbackslash{}',
    );
  });

  it('collapses whitespace so text can never start a paragraph', () => {
    expect(escapeText('a\n\n\tb   c\r\n')).toBe('a b c ');
  });

  it('drops control characters', () => {
    expect(escapeText('a\u0000b\u0007c\u202ed')).toBe('abcd');
  });

  it('breaks TeX ligatures and guards a leading bracket', () => {
    expect(escapeText("--- and ``quotes'' [x]")).toBe(
      "-{}-{}- and \\textasciigrave{}\\textasciigrave{}quotes'{}' [x]",
    );
    expect(escapeText('[a] b')).toBe('{[}a] b');
  });

  it('keeps Unicode intact', () => {
    expect(escapeText('José Nguyễn — Ελληνικά')).toBe('José Nguyễn — Ελληνικά');
  });

  it('never leaves a special character unescaped (property)', () => {
    fc.assert(
      fc.property(
        fc.string({ unit: fc.constantFrom(..."\\{}$&#^_%~`-'[] a\n\u0000é".split('')) }),
        (input) => {
          const out = escapeText(input);
          expect(SPECIALS.test(stripTextEscapes(out))).toBe(false);
          expect(bracesBalanced(out)).toBe(true);
          expect(out).not.toMatch(/\n/);
        },
      ),
      { numRuns: 2000 },
    );
  });
});

describe('sanitizeMath', () => {
  const ok = (input: string) => {
    const r = sanitizeMath(input);
    if (!r.ok) throw new Error(`rejected ${input}: ${r.error.code}`);
    return r.latex as string;
  };
  const code = (input: string) => {
    const r = sanitizeMath(input);
    return r.ok ? 'ok' : r.error.code;
  };

  it('normalizes ordinary math', () => {
    expect(ok('x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}')).toBe(
      'x = \\frac{-b \\pm \\sqrt{b^{2} - 4ac}}{2a}',
    );
    expect(ok('\\frac12')).toBe('\\frac{1}{2}');
    expect(ok('{x^2}')).toBe('{x^{2}}');
    expect(ok('\\alpha x')).toBe('\\alpha x');
    expect(ok('\\operatorname*{arg\\,max}_x f')).toBe('\\operatorname*{arg\\,max}_{x} f');
  });

  it('keeps a command apart from a following Unicode letter (LuaTeX reads é as a letter)', () => {
    expect(ok('a \\cdot é')).toBe('a \\cdot é');
    expect(ok('\\cdotβ')).toBe('\\cdot β');
  });

  it('tells escaped underscores from subscripts', () => {
    expect(ok('a \\_ b_1')).toBe('a \\_ b_{1}');
  });

  it('keeps text arguments in text mode', () => {
    expect(ok('\\text{50\\% off a_b $x^2$}')).toBe('\\text{50\\% off a\\_b \\(x^{2}\\)}');
  });

  it('rejects the banned commands outright', () => {
    for (const name of [
      'input{/etc/passwd}',
      'write18{rm}',
      'def\\x{1}',
      'catcode`\\^^M=13',
      'directlua{os.exit()}',
      'csname x\\endcsname',
      'usepackage{x}',
      'openin',
      'let\\a\\b',
    ]) {
      expect(code(`\\${name}`)).toBe('bannedMacro');
    }
  });

  it('rejects unknown commands and environments', () => {
    expect(code('\\foo')).toBe('forbiddenMacro');
    expect(code('\\@foo')).toBe('forbiddenMacro');
    expect(code('\\begin{equation}x\\end{equation}')).toBe('forbiddenEnvironment');
    expect(code('\\begin{pmatrix}')).toBe('forbiddenMacro');
  });

  it('rejects characters that would escape math mode or comment out the rest', () => {
    expect(code('a % b')).toBe('forbiddenCharacter');
    expect(code('$x$')).toBe('forbiddenCharacter');
    expect(code('#1')).toBe('forbiddenCharacter');
    expect(code('x^{2')).toBe('forbiddenCharacter');
    expect(code('}{')).toBe('forbiddenCharacter');
    expect(code('a\u0000b')).toBe('unsupportedNode');
  });

  it('rejects structures TeX would fail on', () => {
    expect(code('x^2^3')).toBe('doubleScript');
    expect(code("x^2'")).toBe('doubleScript');
    expect(code("x'_1^2")).toBe('doubleScript');
    expect(code("x'_1'")).toBe('doubleScript');
    expect(code("='_\\frac2\\sum^\\int")).toBe('doubleScript');
    expect(ok("x' ^2")).toBe("x'^{2}");
    expect(ok("x''^2_1")).toBe("x''^{2}_{1}");
    expect(code('x_1_2')).toBe('doubleScript');
    expect(code('\\frac{1}')).toBe('missingArgument');
    expect(code('x^')).toBe('missingArgument');
    expect(code('\\left( x')).toBe('unbalancedDelimiters');
    expect(code('x \\right)')).toBe('unbalancedDelimiters');
    expect(code('\\frac{\\left( a}{b\\right)}')).toBe('unbalancedDelimiters');
    expect(code('\\left x \\right)')).toBe('invalidDelimiter');
    expect(code('\\begin{pmatrix}\\left( a & b \\right)\\end{pmatrix}')).toBe(
      'unbalancedDelimiters',
    );
    expect(code('\\begin{cases}\\left( a \\\\ b \\right)\\end{cases}')).toBe(
      'unbalancedDelimiters',
    );
    expect(code('\\begin{pmatrix}\\left( a \\right) & b\\end{pmatrix}')).toBe('ok');
    expect(code('a & b')).toBe('misplacedAlignment');
    expect(code('\\begin{pmatrix}{a&b}\\end{pmatrix}')).toBe('misplacedAlignment');
    expect(code('a \\\\ b')).toBe('misplacedLineBreak');
    expect(code('x\\limits')).toBe('misplacedLimits');
    expect(code('\\not x')).toBe('misplacedNegation');
    expect(code('\\begin{array}{c;rm}1\\end{array}')).toBe('invalidArgument');
    expect(code('\\begin{array}{cc}a&b&c\\end{array}')).toBe('tooManyColumns');
    expect(code('\\begin{array}{c|c}a&b\\\\c&d\\end{array}')).toBe('ok');
    expect(code('\\begin{cases}a&b&c\\end{cases}')).toBe('tooManyColumns');
    expect(code('\\begin{pmatrix}' + '1&'.repeat(9) + '1\\end{pmatrix}')).toBe('ok');
    expect(code('\\begin{pmatrix}' + '1&'.repeat(10) + '1\\end{pmatrix}')).toBe('tooManyColumns');
  });

  it('accepts alignment and line breaks inside grid environments', () => {
    expect(ok('\\begin{cases} x^2 & x \\geq 0 \\\\ -x & x < 0 \\end{cases}')).toBe(
      '\\begin{cases}x^{2}&x \\geq 0 \\\\ -x&x < 0\\end{cases}',
    );
    expect(ok('\\begin{array}{c|c}1&2\\end{array}')).toBe('\\begin{array}{c|c}1&2\\end{array}');
  });

  it('guards a line break from swallowing a following bracket', () => {
    expect(ok('\\begin{cases}a\\\\[2pt]b\\end{cases}')).toBe(
      '\\begin{cases}a\\\\{}[2pt]b\\end{cases}',
    );
  });

  it('enforces size limits', () => {
    expect(code('x'.repeat(4_001))).toBe('tooLong');
    expect(code('{'.repeat(40) + 'x' + '}'.repeat(40))).toBe('tooDeep');
  });

  it('never emits banned or unlisted commands, and is a fixed point (property)', () => {
    const fragments = [
      'x',
      'y',
      '2',
      ' ',
      '+',
      '=',
      '(',
      ')',
      '[',
      ']',
      '{',
      '}',
      '^',
      '_',
      '&',
      '\\\\',
      '%',
      '#',
      '$',
      '~',
      "'",
      '\\frac',
      '\\sqrt',
      '\\left',
      '\\right',
      '\\big',
      '\\text',
      '\\mathbf',
      '\\alpha',
      '\\cdot',
      '\\limits',
      '\\int',
      '\\not',
      '\\begin{pmatrix}',
      '\\end{pmatrix}',
      '\\begin{cases}',
      '\\end{cases}',
      '\\input',
      '\\def',
      '\\csname',
      '\\catcode',
      '\\directlua',
      '\\verb|',
      '\\,',
      '\\%',
      '\\{',
      '\\}',
      '.',
      '|',
      'é',
      '\\operatorname*',
      '\\begin{array}{cc}',
      '\\end{array}',
      '\\@',
      '^^5c',
    ];
    const allowed = new Set([...MATH_MACROS.keys(), ...TEXT_MACROS.keys(), 'begin', 'end']);
    fc.assert(
      fc.property(fc.array(fc.constantFrom(...fragments), { maxLength: 24 }), (parts) => {
        const input = parts.join('');
        const r = sanitizeMath(input);
        if (!r.ok) return;
        const out = r.latex as string;
        expect(bracesBalanced(out)).toBe(true);
        expect(out).not.toMatch(/(?<!\\)[%#$]/);
        expect(out).not.toMatch(/\^\^/);
        for (const [, name] of out.matchAll(/\\([A-Za-z]+)/g))
          expect(allowed.has(name as string)).toBe(true);
        for (const [, env] of out.matchAll(/\\(?:begin|end)\{([^}]*)\}/g)) {
          expect(MATH_ENVIRONMENTS.has(env as string)).toBe(true);
        }
        // Sanitizing the output again changes nothing but insignificant spaces.
        const again = sanitizeMath(out);
        const squash = (s: string) => s.replace(/\s+/g, '');
        expect(again.ok && squash(again.latex)).toBe(squash(out));
      }),
      { numRuns: 3000 },
    );
  });
});

describe('allowlists', () => {
  it('never include a banned command', () => {
    for (const name of BANNED_MACROS) {
      expect(MATH_MACROS.has(name)).toBe(false);
      expect(TEXT_MACROS.has(name)).toBe(false);
    }
  });

  it('include the commands the invariants name as banned', () => {
    for (const name of [
      'input',
      'include',
      'write',
      'openin',
      'openout',
      'read',
      'csname',
      'catcode',
      'def',
      'let',
      'directlua',
      'usepackage',
    ]) {
      expect(BANNED_MACROS).toContain(name);
    }
  });
});

describe('tex and helpers', () => {
  it('interpolates only branded values and keeps literal parts raw', () => {
    const title = escapeText('A & B');
    expect(tex`\section{${title}}`).toBe('\\section{A \\& B}');
    expect(tex`${[title, title]}`).toBe('A \\& BA \\& B');
  });

  it('validates numbers and asset paths', () => {
    expect(texInt(12)).toBe('12');
    expect(() => texInt(-1)).toThrow();
    expect(() => texInt(1.5)).toThrow();
    expect(assetPath('crop_01', 'png')).toBe('assets/crop_01.png');
    expect(() => assetPath('../x', 'png')).toThrow();
  });
});
