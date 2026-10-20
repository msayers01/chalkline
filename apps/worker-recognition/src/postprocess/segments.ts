/**
 * Splits recognizer output (Mathpix Markdown: text with `\( \)` inline and
 * `\[ \]` display math) into lines of text and math. A line that holds only
 * one math expression is display math, whichever delimiters it used:
 * handwritten math on a line of its own is a displayed equation.
 */

export type Run = { kind: 'text'; text: string } | { kind: 'math'; latex: string };

export type Piece =
  /** Text with inline math, one or more board lines joined. */
  | { kind: 'paragraph'; runs: Run[] }
  /** Display math, one entry per line of a derivation. */
  | { kind: 'display'; lines: string[] };

type Token =
  | { kind: 'text'; text: string }
  | { kind: 'math'; latex: string; display: boolean }
  | { kind: 'newline' };

const OPENERS: Record<string, { close: string; display: boolean }> = {
  '\\(': { close: '\\)', display: false },
  '\\[': { close: '\\]', display: true },
};

export function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  const pushText = (text: string) => {
    const parts = text.split(/\r?\n/);
    parts.forEach((part, i) => {
      if (i > 0) tokens.push({ kind: 'newline' });
      if (part) tokens.push({ kind: 'text', text: part });
    });
  };
  let at = 0;
  while (at < source.length) {
    const open = nextOpener(source, at);
    if (!open) {
      pushText(source.slice(at));
      break;
    }
    pushText(source.slice(at, open.index));
    const spec = OPENERS[open.delimiter];
    if (!spec) break;
    const start = open.index + 2;
    const end = source.indexOf(spec.close, start);
    // An unclosed delimiter takes the rest of the output; repair or the
    // image fallback deals with whatever that leaves.
    const stop = end === -1 ? source.length : end;
    tokens.push({ kind: 'math', latex: source.slice(start, stop).trim(), display: spec.display });
    at = end === -1 ? source.length : end + 2;
  }
  return tokens;
}

function nextOpener(
  source: string,
  from: number,
): { index: number; delimiter: string } | undefined {
  for (let i = from; i < source.length - 1; i += 1) {
    if (source[i] !== '\\') continue;
    const next = source[i + 1];
    if (next === '(' || next === '[') return { index: i, delimiter: `\\${next}` };
    // Skip the escaped character, so `\\(` is a line break and a paren.
    i += 1;
  }
  return undefined;
}

/** Groups tokens into paragraphs and display math. Blank lines end a paragraph. */
export function pieces(source: string): Piece[] {
  const lines: Token[][] = [[]];
  for (const token of tokenize(source)) {
    if (token.kind === 'newline') lines.push([]);
    else lines[lines.length - 1]?.push(token);
  }

  const out: Piece[] = [];
  let paragraph: Run[] | undefined;
  let display: string[] | undefined;
  const end = () => {
    if (paragraph?.length) out.push({ kind: 'paragraph', runs: paragraph });
    if (display?.length) out.push({ kind: 'display', lines: display });
    paragraph = undefined;
    display = undefined;
  };

  for (const line of lines) {
    const content = line.filter((t) => !(t.kind === 'text' && !t.text.trim()));
    if (content.length === 0) {
      end();
      continue;
    }
    const maths = content.filter((t) => t.kind === 'math');
    if (maths.length === content.length && (maths.length === 1 || maths.every((t) => t.display))) {
      if (paragraph) end();
      display ??= [];
      for (const m of maths) if (m.latex) display.push(...displayLines(m.latex));
      continue;
    }
    if (display) end();
    paragraph ??= [];
    for (const token of line) {
      if (token.kind === 'text') appendText(paragraph, token.text);
      else if (token.kind === 'math' && token.latex)
        paragraph.push({ kind: 'math', latex: token.latex });
    }
    // Board lines of one paragraph are joined with a space.
    appendText(paragraph, ' ');
  }
  end();
  return out.map((piece) => (piece.kind === 'paragraph' ? trimRuns(piece) : piece));
}

function appendText(runs: Run[], text: string): void {
  const last = runs[runs.length - 1];
  if (last?.kind === 'text') last.text = (last.text + text).replace(/\s+/g, ' ');
  else runs.push({ kind: 'text', text: text.replace(/\s+/g, ' ') });
}

function trimRuns(piece: { kind: 'paragraph'; runs: Run[] }): Piece {
  const runs = piece.runs.map((r) => ({ ...r }));
  const first = runs[0];
  if (first?.kind === 'text') first.text = first.text.trimStart();
  const last = runs[runs.length - 1];
  if (last?.kind === 'text') last.text = last.text.trimEnd();
  return { kind: 'paragraph', runs: runs.filter((r) => r.kind === 'math' || r.text) };
}

const MULTILINE =
  /^\\begin\{(aligned|align\*?|gathered|gather\*?|split|eqnarray\*?|array)\}(\{[^{}]*\})?([\s\S]*)\\end\{\1\}$/;

/**
 * One displayed expression into derivation lines. Recognizers write several
 * handwritten lines as one `aligned` or single-column `array`; the IR keeps
 * them as separate lines and the renderer aligns them itself, so the
 * alignment points are dropped.
 */
export function displayLines(latex: string): string[] {
  const m = MULTILINE.exec(latex.trim());
  let body = latex;
  if (m) {
    const [, env = '', columns = '', inner = ''] = m;
    const multiColumn = env === 'array' && columns.replace(/[{}|\s]/g, '').length > 1;
    if (multiColumn) return [latex.trim()];
    body = inner;
  }
  const lines = splitTopLevel(body);
  if (lines.length === 1 && !m) return [latex.trim()];
  return lines.map((line) => (m ? dropTopLevelAmpersands(line) : line).trim()).filter(Boolean);
}

/** Splits at `\\` outside braces and environments, dropping an optional `[2pt]` after it. */
function splitTopLevel(body: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let envDepth = 0;
  let current = '';
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i] ?? '';
    if (ch === '\\') {
      const word = /^\\(?:[A-Za-z]+|.)/.exec(body.slice(i))?.[0] ?? '\\';
      if (word === '\\\\' && depth === 0 && envDepth === 0) {
        out.push(current);
        current = '';
        i += 1;
        const spacing = /^\s*\[[^\]]*\]/.exec(body.slice(i + 1));
        if (spacing) i += spacing[0].length;
        continue;
      }
      if (word === '\\begin') envDepth += 1;
      if (word === '\\end') envDepth = Math.max(0, envDepth - 1);
      current += word;
      i += word.length - 1;
      continue;
    }
    if (ch === '{') depth += 1;
    if (ch === '}') depth = Math.max(0, depth - 1);
    current += ch;
  }
  out.push(current);
  return out;
}

function dropTopLevelAmpersands(line: string): string {
  let depth = 0;
  let envDepth = 0;
  let out = '';
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i] ?? '';
    if (ch === '\\') {
      const word = /^\\(?:[A-Za-z]+|.)/.exec(line.slice(i))?.[0] ?? '\\';
      if (word === '\\begin') envDepth += 1;
      if (word === '\\end') envDepth = Math.max(0, envDepth - 1);
      out += word;
      i += word.length - 1;
      continue;
    }
    if (ch === '{') depth += 1;
    if (ch === '}') depth = Math.max(0, depth - 1);
    if (ch === '&' && depth === 0 && envDepth === 0) continue;
    out += ch;
  }
  return out.replace(/\s+/g, ' ');
}
