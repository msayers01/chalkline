import { brand, type SafeLatex } from './brand.js';

/**
 * The only path from text content to LaTeX text mode.
 *
 * - The ten special characters are replaced by commands that print them.
 * - Control characters are dropped and all whitespace (newlines included)
 *   collapses to single spaces, so content can never start a new paragraph,
 *   command or comment.
 * - TeX ligatures (`--`, `''`, `` ` ``) are broken so text prints as written.
 * - A leading `[` is braced so the text can follow `\item` or `\\` without
 *   being read as an optional argument.
 *
 * Everything else, including all non-ASCII Unicode, passes through: the
 * document is compiled with LuaLaTeX and fontspec, where those characters are
 * ordinary letters or symbols.
 */
export function escapeText(text: string): SafeLatex {
  return escapeTextIn(text, true);
}

/**
 * Inside a braced text argument (`\text{...}`) nothing can read a leading
 * bracket as an optional argument, so the guard is skipped there.
 */
export function escapeTextArgument(text: string): SafeLatex {
  return escapeTextIn(text, false);
}

function escapeTextIn(text: string, guardLeadingBracket: boolean): SafeLatex {
  let out = '';
  let pendingSpace = false;
  const chars = Array.from(text);

  for (let i = 0; i < chars.length; i += 1) {
    const ch = chars[i] as string;
    if (isWhitespace(ch)) {
      pendingSpace = true;
      continue;
    }
    if (isDropped(ch)) continue;
    if (pendingSpace) {
      out += ' ';
      pendingSpace = false;
    }
    const next = chars[i + 1];
    out += escapeChar(ch, next, guardLeadingBracket && out.length === 0);
  }
  if (pendingSpace) out += ' ';
  return brand(out);
}

const REPLACEMENTS: Readonly<Record<string, string>> = {
  '\\': '\\textbackslash{}',
  '{': '\\{',
  '}': '\\}',
  $: '\\$',
  '&': '\\&',
  '#': '\\#',
  '^': '\\textasciicircum{}',
  _: '\\_',
  '%': '\\%',
  '~': '\\textasciitilde{}',
  '`': '\\textasciigrave{}',
};

function escapeChar(ch: string, next: string | undefined, atStart: boolean): string {
  const replacement = REPLACEMENTS[ch];
  if (replacement !== undefined) return replacement;
  if (ch === '-' && next === '-') return '-{}';
  if (ch === "'" && next === "'") return "'{}";
  if (ch === '[' && atStart) return '{[}';
  return ch;
}

function isWhitespace(ch: string): boolean {
  return /^[\s\u2028\u2029]$/u.test(ch);
}

/** Control and format characters, lone surrogates and private-use characters. */
function isDropped(ch: string): boolean {
  if (/^[\p{Cc}\p{Cs}\p{Co}]$/u.test(ch)) return true;
  // Format characters other than the joiners some scripts need.
  return /^\p{Cf}$/u.test(ch) && ch !== '\u200c' && ch !== '\u200d';
}
