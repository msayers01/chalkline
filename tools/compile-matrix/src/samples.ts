import { DocBuilder } from '@chalkline/ir/fixtures';
import type { Doc } from '@chalkline/ir';
import { MATH_ENVIRONMENTS, MATH_MACROS, TEXT_MACROS, sanitizeMath } from '@chalkline/latex';

/**
 * Generated documents for the compile matrix: one line per allowlisted
 * command and environment, and a batch of random expressions that passed
 * the sanitizer. Both must compile in the production preamble.
 */

function sampleFor(name: string): string {
  const spec = MATH_MACROS.get(name);
  if (!spec) throw new Error(`not allowlisted: ${name}`);
  switch (spec.role) {
    case 'left':
    case 'right':
      return '\\left( x \\right)';
    case 'middle':
      return '\\left( a \\middle| b \\right)';
    case 'sizer':
      return `\\${name}( x \\${name})`;
    case 'limits':
      return `\\sum\\${name}_{i=1}^{n} i`;
    case 'negation':
      return 'a \\not= b';
    default:
      break;
  }
  if (name.length === 1 && !/[A-Za-z]/.test(name)) {
    if (name === '{' || name === '}') return '\\{ x \\}';
    return `a \\${name} b`;
  }
  const kinds = spec.signature.split(' ').filter(Boolean);
  const args = kinds
    .map((k, i) =>
      k === 's' ? '*' : k === 'o' ? '[3]' : spec.argModes?.[i] === 'text' ? '{text}' : '{x}',
    )
    .join('');
  if (name === 'operatorname') return '\\operatorname*{arg\\,max}_{x} f';
  if (['overbrace', 'underbrace'].includes(name)) return `\\${name}{x + y}^{n}`;
  return `x \\${name}${args} y`;
}

const ENV_SAMPLES: Record<string, string> = {
  array: '\\begin{array}{c|c} 1 & 2 \\\\ 3 & 4 \\end{array}',
  gathered: '\\begin{gathered} a \\\\ b \\end{gathered}',
  cases: 'f = \\begin{cases} 1 & x > 0 \\\\ 0 & x \\leq 0 \\end{cases}',
  aligned: '\\begin{aligned} a &= b \\\\ c &= d \\end{aligned}',
};

export function allowlistDoc(): Doc {
  const b = new DocBuilder('01JA0000000000000000');
  const lines = [...MATH_MACROS.keys()].map(sampleFor);
  for (const name of MATH_ENVIRONMENTS.keys()) {
    lines.push(ENV_SAMPLES[name] ?? `\\begin{${name}} a & b \\\\ c & d \\end{${name}}`);
  }
  const textCommands = [...TEXT_MACROS.keys()].filter((n) => /^[A-Za-z]+$/.test(n));
  lines.push(
    `\\text{a ${textCommands.map((n) => (TEXT_MACROS.get(n)?.signature ? `\\${n}{x}` : `\\${n}{}`)).join(' ')} \\% \\& \\# \\$ \\_ \\{ \\} b}`,
  );
  for (const line of lines) {
    const r = sanitizeMath(line);
    if (!r.ok) throw new Error(`allowlist sample rejected (${r.error.code}): ${line}`);
  }
  const blocks = lines.map((line) => b.math(line));
  return b.doc(
    {
      title: 'Allowlist coverage',
      course: 'Compile matrix',
      teacher: 'CI',
      date: '2026-10-20',
      lang: 'en',
    },
    b.section('Every allowlisted command and environment', ...blocks),
  );
}

const FRAGMENTS = [
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
  "'",
  '.',
  '|',
  'é',
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
  '\\sum',
  '\\not',
  '\\begin{pmatrix}',
  '\\end{pmatrix}',
  '\\begin{cases}',
  '\\end{cases}',
  '\\,',
  '\\%',
  '\\{',
  '\\}',
  '\\operatorname*',
  '\\begin{array}{cc}',
  '\\end{array}',
  '\\vec',
  '\\overbrace',
];

/** Deterministic PRNG (mulberry32) so a failing run can be reproduced from its seed. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomDoc(count: number, seed: number): Doc {
  const next = prng(seed);
  const b = new DocBuilder('01JR0000000000000000');
  const accepted: string[] = [];
  for (let tries = 0; accepted.length < count && tries < count * 200; tries += 1) {
    const parts = Array.from(
      { length: 1 + Math.floor(next() * 20) },
      () => FRAGMENTS[Math.floor(next() * FRAGMENTS.length)] ?? 'x',
    );
    const input = parts.join('');
    if (sanitizeMath(input).ok) accepted.push(input);
  }
  const blocks = accepted.map((input, i) =>
    i % 2 === 0 ? b.math(input) : b.p('Inline ', b.m(input), ' end.'),
  );
  return b.doc(
    {
      title: `Random sanitizer output (seed ${seed})`,
      course: 'Compile matrix',
      teacher: 'CI',
      date: '2026-10-20',
      lang: 'en',
    },
    b.section('Random expressions', ...blocks),
  );
}
