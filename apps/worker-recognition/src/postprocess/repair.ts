import { sanitizeMath, type SanitizeError } from '@chalkline/latex';

/**
 * Repairs for the faults handwriting recognition commonly produces:
 * unbalanced braces, a `\left` without its `\right` (or the reverse), and
 * scripts with nothing in them. Each repair is tried only when the math does
 * not sanitize, and the result is sanitized again, so a repair can never
 * smuggle anything past the allowlist.
 */

export type RepairName = 'braces' | 'leftRight' | 'emptyScripts';

export type RepairResult =
  { ok: true; latex: string; repairs: RepairName[] } | { ok: false; error: SanitizeError };

const REPAIRS: readonly [RepairName, (latex: string) => string][] = [
  ['braces', balanceBraces],
  ['leftRight', dropUnmatchedLeftRight],
  ['emptyScripts', dropEmptyScripts],
];

export function repairMath(latex: string): RepairResult {
  const first = sanitizeMath(latex);
  if (first.ok) return { ok: true, latex, repairs: [] };
  let current = latex;
  const repairs: RepairName[] = [];
  let error = first.error;
  for (const [name, repair] of REPAIRS) {
    const next = repair(current);
    if (next === current) continue;
    current = next;
    repairs.push(name);
    const result = sanitizeMath(current);
    if (result.ok) return { ok: true, latex: current, repairs };
    error = result.error;
  }
  return { ok: false, error };
}

/** Control sequences and characters, so `\{` and `\\` are never mistaken for braces. */
function* tokens(latex: string): Generator<string> {
  for (let i = 0; i < latex.length;) {
    if (latex[i] === '\\') {
      const word = /^\\(?:[A-Za-z]+|.)?/.exec(latex.slice(i))?.[0] ?? '\\';
      yield word;
      i += word.length;
    } else {
      yield latex[i] ?? '';
      i += 1;
    }
  }
}

/** Drops closing braces with no opener and closes what is left open. */
export function balanceBraces(latex: string): string {
  let depth = 0;
  let out = '';
  for (const token of tokens(latex)) {
    if (token === '{') depth += 1;
    if (token === '}') {
      if (depth === 0) continue;
      depth -= 1;
    }
    out += token;
  }
  return out + '}'.repeat(depth);
}

/**
 * When `\left` and `\right` do not pair up, drops all of them (and `\middle`)
 * and keeps the plain delimiters. A `.` that stood for an invisible
 * delimiter goes with them.
 */
export function dropUnmatchedLeftRight(latex: string): string {
  const all = [...tokens(latex)];
  const lefts = all.filter((t) => t === '\\left').length;
  const rights = all.filter((t) => t === '\\right').length;
  if (lefts === rights) return latex;
  let out = '';
  for (let i = 0; i < all.length; i += 1) {
    const token = all[i] ?? '';
    if (token === '\\left' || token === '\\right' || token === '\\middle') {
      let j = i + 1;
      while (all[j] === ' ') j += 1;
      if (all[j] === '.') i = j;
      continue;
    }
    out += token;
  }
  return out;
}

/** `x^{}`, `x_{ }` and a script marker with nothing after it. */
export function dropEmptyScripts(latex: string): string {
  return latex.replace(/(?<!\\)[_^]\s*\{\s*\}/g, '').replace(/(?<!\\)[_^]\s*(?=\}|$|&|\\\\)/g, '');
}
