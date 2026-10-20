import type * as Ast from '@unified-latex/unified-latex-types';
import { getParser } from '@unified-latex/unified-latex-util-parse';
import { printRaw } from '@unified-latex/unified-latex-util-print-raw';
import type { MathTransform, TransformNote } from '@chalkline/conventions';
import {
  BANNED_MACROS,
  BIG_OPERATORS,
  DELIMITER_CHARS,
  DELIMITER_MACROS,
  MATH_ENVIRONMENTS,
  MATH_MACROS,
  RELATIONS,
  TEXT_MACROS,
  type ArgMode,
  type MacroSpec,
} from './allowlist.js';
import { brand, type SafeLatex } from './brand.js';
import { escapeTextArgument } from './escapeText.js';

/**
 * The only path from math content to LaTeX: parse to an AST, check every node
 * against the allowlist, apply convention transforms, then serialize from the
 * AST. Input text is never copied to the output as-is, so whatever survives is
 * balanced, allowlisted and free of catcode or expansion tricks.
 */

export const MATH_LIMITS = { maxLength: 4_000, maxDepth: 32, maxNodes: 3_000 } as const;

export type SanitizeErrorCode =
  | 'tooLong'
  | 'tooDeep'
  | 'tooLarge'
  | 'parseError'
  | 'bannedMacro'
  | 'forbiddenMacro'
  | 'forbiddenEnvironment'
  | 'forbiddenCharacter'
  | 'unsupportedNode'
  | 'missingArgument'
  | 'invalidArgument'
  | 'unbalancedDelimiters'
  | 'invalidDelimiter'
  | 'misplacedAlignment'
  | 'tooManyColumns'
  | 'misplacedLineBreak'
  | 'misplacedLimits'
  | 'misplacedNegation'
  | 'doubleScript';

export type SanitizeError = { code: SanitizeErrorCode; detail?: string };

export type SanitizeResult =
  | {
      ok: true;
      latex: SafeLatex;
      applied: TransformNote[];
      suggestions: TransformNote[];
      /** Whether an alignment point was inserted (see `alignAtRelation`). */
      aligned: boolean;
    }
  | { ok: false; error: SanitizeError };

export type SanitizeOptions = {
  /**
   * Convention transforms, applied in order to the validated AST. They must be
   * pure: return new nodes rather than mutating their input.
   */
  transforms?: readonly MathTransform[];
  /**
   * Insert `&` before the first top-level relation, for one line of an
   * aligned derivation. The renderer only uses the result when every line of
   * the derivation got one.
   */
  alignAtRelation?: boolean;
};

class Reject extends Error {
  constructor(readonly error: SanitizeError) {
    super(error.code);
  }
}

let parser: ReturnType<typeof getParser> | undefined;

type MacroInfo = { signature: string; renderInfo: { inMathMode: boolean } };

function mathParser(): ReturnType<typeof getParser> {
  if (!parser) {
    // Every allowlisted command gets its signature (so arguments attach) and
    // the mode of its arguments (so math arguments are parsed as math).
    const macros: Record<string, MacroInfo> = {
      '\\': { signature: '', renderInfo: { inMathMode: true } },
    };
    const add = (table: ReadonlyMap<string, MacroSpec>, defaultMode: ArgMode) => {
      for (const [name, spec] of table) {
        if (!spec.signature) continue;
        const mode = spec.argModes?.[0] ?? defaultMode;
        macros[name] = { signature: spec.signature, renderInfo: { inMathMode: mode === 'math' } };
      }
    };
    add(TEXT_MACROS, 'text');
    add(MATH_MACROS, 'math');
    parser = getParser({ mode: 'math', macros, environments: { array: { signature: 'o m' } } });
  }
  return parser;
}

/**
 * The parser leaves the contents of bare groups (`{x^2}`) and of script
 * arguments (`x^{y^2}`) unprocessed, so scripts inside them would look like
 * plain strings. Re-parse them from their raw text in math mode; the result
 * is validated like everything else.
 */
function reparseGroups(nodes: Ast.Node[], mode: ArgMode, depth = 0): Ast.Node[] {
  if (depth > MATH_LIMITS.maxDepth) throw new Reject({ code: 'tooDeep' });
  return nodes.map((node): Ast.Node => {
    if (typeof node !== 'object') return node;
    switch (node.type) {
      case 'group': {
        const content =
          mode === 'math' ? mathParser().parse(printRaw(node.content)).content : node.content;
        return { ...node, content: reparseGroups(content, mode, depth + 1) };
      }
      case 'macro': {
        if (!node.args) return node;
        if (isScriptNode(node)) {
          // Script arguments are left unprocessed like bare groups.
          const args = node.args.map((a) => {
            const content =
              mode === 'math' ? mathParser().parse(printRaw(a.content)).content : a.content;
            return { ...a, content: reparseGroups(content, mode, depth + 1) };
          });
          return { ...node, args };
        }
        const spec = (mode === 'math' ? MATH_MACROS : TEXT_MACROS).get(node.content);
        if (!spec) return node; // rejected during validation
        const kinds = spec.signature.split(' ').filter(Boolean);
        let modeIndex = 0;
        const args = node.args.map((arg, i) => {
          if (kinds[i] === 's') return arg;
          const argMode = spec.argModes?.[modeIndex] ?? 'math';
          modeIndex += 1;
          return { ...arg, content: reparseGroups(arg.content, argMode, depth + 1) };
        });
        return { ...node, args };
      }
      case 'environment':
      case 'mathenv':
        return { ...node, content: reparseGroups(node.content, 'math', depth + 1) };
      case 'inlinemath':
        return { ...node, content: reparseGroups(node.content, 'math', depth + 1) };
      default:
        return node;
    }
  });
}

/** Parses and validates math without serializing. */
export function parseMathSafe(
  input: string,
): { ok: true; nodes: Ast.Node[] } | { ok: false; error: SanitizeError } {
  if (input.length > MATH_LIMITS.maxLength) return { ok: false, error: { code: 'tooLong' } };
  let nodes: Ast.Node[];
  try {
    nodes = mathParser().parse(input).content;
    nodes = reparseGroups(nodes, 'math');
  } catch (e) {
    if (e instanceof Reject) return { ok: false, error: e.error };
    return { ok: false, error: { code: 'parseError' } };
  }
  try {
    serialize(nodes);
  } catch (e) {
    if (e instanceof Reject) return { ok: false, error: e.error };
    throw e;
  }
  return { ok: true, nodes };
}

export function sanitizeMath(input: string, options: SanitizeOptions = {}): SanitizeResult {
  const parsed = parseMathSafe(input);
  if (!parsed.ok) return parsed;

  let nodes = parsed.nodes;
  const applied: TransformNote[] = [];
  const suggestions: TransformNote[] = [];
  for (const transform of options.transforms ?? []) {
    const result = transform(nodes);
    nodes = result.nodes;
    applied.push(...result.applied);
    suggestions.push(...result.suggestions);
  }

  const align = options.alignAtRelation ?? false;
  try {
    const out = serialize(nodes, align);
    return { ok: true, latex: brand(out.latex), applied, suggestions, aligned: out.aligned };
  } catch (e) {
    if (!(e instanceof Reject)) throw e;
    // A transform produced something outside the allowlist. That is a bug in
    // the transform, never in the content: publish the math as written.
    const out = serialize(parsed.nodes, align);
    return { ok: true, latex: brand(out.latex), applied: [], suggestions, aligned: out.aligned };
  }
}

// ---------------------------------------------------------------------------
// Serializer. Validation and output are the same walk, so nothing can be
// emitted that was not checked.

type Ctx = {
  mode: 'math' | 'text';
  /** `&` permitted here (top level of an alignment environment). */
  alignment: boolean;
  /** `\\` permitted here. */
  lineBreaks: boolean;
  depth: number;
  budget: { nodes: number };
  /** Shared state for `alignAtRelation`; only consulted at depth 0. */
  align?: { wanted: boolean; done: boolean };
  /** Cells in the current row of the enclosing alignment, and the most allowed. */
  row?: { cells: number; max: number };
};

const BANNED = new Set<string>(BANNED_MACROS);
const BIG_OPS = new Set<string>(BIG_OPERATORS);
const RELATION_MACROS = new Set<string>(RELATIONS);
const DELIM_MACROS = new Set<string>(DELIMITER_MACROS);
const DELIM_CHARS = new Set<string>(DELIMITER_CHARS);
const RELATION_CHARS = new Set(['=', '<', '>']);

/** ASCII characters that may appear in math strings (`&` only in alignments). */
const MATH_ASCII = /^[A-Za-z0-9+\-=<>()[\]|/.,;:!?'*~]$/;
const NON_ASCII_PRINTABLE = /^[\p{L}\p{M}\p{N}\p{S}\p{P}]$/u;

function serialize(
  nodes: Ast.Node[],
  alignAtRelation = false,
): { latex: string; aligned: boolean } {
  const out = new Emitter();
  const align = { wanted: alignAtRelation, done: false };
  emitList(
    nodes,
    { mode: 'math', alignment: false, lineBreaks: false, depth: 0, budget: { nodes: 0 }, align },
    out,
  );
  return { latex: out.toString(), aligned: align.done };
}

class Emitter {
  private buf = '';
  private guardNext = false;

  push(piece: string): void {
    if (piece === '') return;
    if (this.guardNext && /^[[*]/.test(piece)) this.buf += '{}';
    this.guardNext = false;
    // A control word swallows following letters, and LuaTeX counts every
    // Unicode letter as one; keep them apart. (An even run of backslashes
    // before the letters is a line break, not a command.)
    if (/(?:^|[^\\])(?:\\\\)*\\[A-Za-z]+$/.test(this.buf) && /^[A-Za-z\u0080-\uFFFF]/.test(piece)) {
      this.buf += ' ';
    }
    this.buf += piece;
  }

  space(): void {
    if (this.buf !== '' && !this.buf.endsWith(' ')) this.buf += ' ';
  }

  /** After `\\`, a following `[` or `*` would be read as an argument. */
  guard(): void {
    this.guardNext = true;
  }

  toString(): string {
    return this.buf.trim();
  }
}

function enter(ctx: Ctx, patch: Partial<Ctx>): Ctx {
  const depth = ctx.depth + 1;
  if (depth > MATH_LIMITS.maxDepth) throw new Reject({ code: 'tooDeep' });
  const next: Ctx = { ...ctx, ...patch, depth };
  delete next.align;
  if (!('row' in patch)) delete next.row;
  return next;
}

function significant(nodes: Ast.Node[], from: number, step: 1 | -1): Ast.Node | undefined {
  for (let i = from; i >= 0 && i < nodes.length; i += step) {
    const node = nodes[i];
    if (node && !(typeof node === 'object' && node.type === 'whitespace')) return node;
  }
  return undefined;
}

function isDelimiter(node: Ast.Node | undefined): boolean {
  if (!node || typeof node !== 'object') return false;
  if (node.type === 'string') return DELIM_CHARS.has(node.content);
  if (node.type === 'macro') return DELIM_MACROS.has(node.content);
  return false;
}

function isRelation(node: Ast.Node | undefined): boolean {
  if (!node || typeof node !== 'object') return false;
  if (node.type === 'string') return RELATION_CHARS.has(node.content);
  if (node.type === 'macro') return RELATION_MACROS.has(node.content);
  return false;
}

function isMacro(node: Ast.Node | undefined, name: string): boolean {
  return !!node && typeof node === 'object' && node.type === 'macro' && node.content === name;
}

/** `^` and `_` as scripts. The control symbols `\_` and `\^` carry an escape token; scripts do not. */
function isScriptNode(node: Ast.Node | undefined): boolean {
  return (
    !!node &&
    typeof node === 'object' &&
    node.type === 'macro' &&
    (node.content === '^' || node.content === '_') &&
    node.escapeToken === ''
  );
}

function isPrime(node: Ast.Node | undefined): boolean {
  return !!node && typeof node === 'object' && node.type === 'string' && /^'+$/.test(node.content);
}

function emitList(nodes: Ast.Node[], ctx: Ctx, out: Emitter): void {
  let leftDepth = 0;
  // Scripts attached to the current base, following TeX's "Double
  // superscript" rules: at most one ^ and one _; a prime is a superscript
  // that only merges with a ^ (or more primes) directly after it.
  const fresh = () => ({ sup: 0, sub: 0, primed: false, afterPrime: false });
  let run = fresh();

  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i];
    ctx.budget.nodes += 1;
    if (ctx.budget.nodes > MATH_LIMITS.maxNodes) throw new Reject({ code: 'tooLarge' });
    if (node === undefined || typeof node !== 'object')
      throw new Reject({ code: 'unsupportedNode' });

    if (ctx.mode === 'math') {
      if (isScriptNode(node)) {
        const kind = (node as Ast.Macro).content === '^' ? 'sup' : 'sub';
        if (kind === 'sup' && run.primed && !run.afterPrime) {
          throw new Reject({ code: 'doubleScript' });
        }
        run[kind] += 1;
        if (run[kind] > 1) throw new Reject({ code: 'doubleScript' });
        run.afterPrime = false;
      } else if (isPrime(node)) {
        if (run.sup > 0 || (run.primed && !run.afterPrime)) {
          throw new Reject({ code: 'doubleScript' });
        }
        run.primed = true;
        run.afterPrime = true;
      } else if (node.type === 'whitespace') {
        // TeX's prime lookahead would see the space; leave it out.
        if (run.afterPrime) continue;
      } else {
        run = fresh();
      }
    }

    if (ctx.depth === 0 && ctx.align?.wanted && !ctx.align.done) {
      const negatedRelation = node.type === 'macro' && node.content === 'not';
      if (negatedRelation || (isRelation(node) && !(i > 0 && isMacro(nodes[i - 1], 'not')))) {
        out.push('&');
        ctx.align.done = true;
      }
    }

    switch (node.type) {
      case 'string':
        emitString(node.content, ctx, out);
        break;
      case 'whitespace':
        out.space();
        break;
      case 'group': {
        const inner = enter(ctx, { alignment: false, lineBreaks: false });
        out.push('{');
        emitList(node.content, inner, out);
        out.push('}');
        break;
      }
      case 'macro': {
        if (ctx.mode === 'math') {
          const role = MATH_MACROS.get(node.content)?.role;
          if (role === 'left') leftDepth += 1;
          if (role === 'right') {
            if (leftDepth === 0) throw new Reject({ code: 'unbalancedDelimiters' });
            leftDepth -= 1;
          }
          if (role === 'middle' && leftDepth === 0)
            throw new Reject({ code: 'unbalancedDelimiters' });
          if (
            (role === 'left' || role === 'right' || role === 'middle' || role === 'sizer') &&
            !isDelimiter(significant(nodes, i + 1, 1))
          ) {
            throw new Reject({ code: 'invalidDelimiter', detail: node.content });
          }
          if (role === 'limits') {
            const prev = significant(nodes, i - 1, -1);
            const ok =
              prev?.type === 'macro' &&
              (BIG_OPS.has(prev.content) || (prev.content === 'operatorname' && hasStar(prev)));
            if (!ok) throw new Reject({ code: 'misplacedLimits' });
          }
          if (role === 'negation' && !isRelation(significant(nodes, i + 1, 1))) {
            throw new Reject({ code: 'misplacedNegation' });
          }
        }
        emitMacro(node, ctx, out);
        break;
      }
      case 'environment':
      case 'mathenv':
        if (ctx.mode !== 'math') throw new Reject({ code: 'unsupportedNode' });
        emitEnvironment(node, ctx, out);
        break;
      case 'inlinemath': {
        if (ctx.mode !== 'text') throw new Reject({ code: 'unsupportedNode' });
        const inner = enter(ctx, { mode: 'math', alignment: false, lineBreaks: false });
        out.push('\\(');
        emitList(node.content, inner, out);
        out.push('\\)');
        break;
      }
      case 'comment':
        throw new Reject({ code: 'forbiddenCharacter', detail: '%' });
      default:
        throw new Reject({ code: 'unsupportedNode', detail: node.type });
    }
  }

  if (leftDepth !== 0) throw new Reject({ code: 'unbalancedDelimiters' });
}

function emitString(content: string, ctx: Ctx, out: Emitter): void {
  if (ctx.mode === 'text') {
    out.push(escapeTextArgument(content));
    return;
  }
  for (const ch of content) {
    if (ch === '&') {
      if (!ctx.alignment) throw new Reject({ code: 'misplacedAlignment' });
      if (ctx.row) {
        ctx.row.cells += 1;
        if (ctx.row.cells > ctx.row.max) throw new Reject({ code: 'tooManyColumns' });
      }
      continue;
    }
    const ok = ch.charCodeAt(0) < 0x80 ? MATH_ASCII.test(ch) : NON_ASCII_PRINTABLE.test(ch);
    if (!ok)
      throw new Reject({
        code: 'forbiddenCharacter',
        detail: ch.charCodeAt(0) < 0x80 ? ch : 'non-printable',
      });
  }
  out.push(content);
}

function hasStar(node: Ast.Macro): boolean {
  const first = node.args?.[0];
  return !!first && first.openMark === '' && first.content.length > 0;
}

function emitMacro(node: Ast.Macro, ctx: Ctx, out: Emitter): void {
  const name = node.content;

  if (ctx.mode === 'math' && isScriptNode(node)) {
    const arg = node.args?.[0];
    if (!arg || (arg.openMark === '' && arg.content.length === 0))
      throw new Reject({ code: 'missingArgument', detail: name });
    out.push(name);
    out.push('{');
    emitList(arg.content, enter(ctx, { alignment: false, lineBreaks: false }), out);
    out.push('}');
    return;
  }

  if (name === '\\') {
    if (!ctx.lineBreaks) throw new Reject({ code: 'misplacedLineBreak' });
    if (node.args && node.args.some((a) => a.content.length > 0))
      throw new Reject({ code: 'invalidArgument', detail: name });
    out.push('\\\\');
    out.guard();
    if (ctx.row) ctx.row.cells = 1;
    return;
  }

  if (BANNED.has(name)) throw new Reject({ code: 'bannedMacro', detail: name });
  const spec = (ctx.mode === 'math' ? MATH_MACROS : TEXT_MACROS).get(name);
  if (!spec) throw new Reject({ code: 'forbiddenMacro', detail: name });

  out.push(`\\${name}`);
  emitArgs(node, spec, ctx, out);
}

function emitArgs(node: Ast.Macro, spec: MacroSpec, ctx: Ctx, out: Emitter): void {
  const kinds = spec.signature.split(' ').filter(Boolean);
  const args = node.args ?? [];
  if (kinds.length === 0) {
    if (args.some((a) => a.content.length > 0 || a.openMark !== ''))
      throw new Reject({ code: 'invalidArgument', detail: node.content });
    return;
  }
  if (args.length !== kinds.length)
    throw new Reject({ code: 'invalidArgument', detail: node.content });

  let modeIndex = 0;
  kinds.forEach((kind, i) => {
    const arg = args[i] as Ast.Argument;
    if (kind === 's') {
      if (arg.content.length > 0) out.push('*');
      return;
    }
    const mode: ArgMode = spec.argModes?.[modeIndex] ?? 'math';
    modeIndex += 1;
    const inner = enter(ctx, { mode, alignment: false, lineBreaks: false });
    if (kind === 'o') {
      if (arg.openMark === '' && arg.content.length === 0) return;
      if (containsBracket(arg.content))
        throw new Reject({ code: 'invalidArgument', detail: node.content });
      out.push('[');
      emitList(arg.content, inner, out);
      out.push(']');
      return;
    }
    if (arg.openMark === '' && arg.content.length === 0)
      throw new Reject({ code: 'missingArgument', detail: node.content });
    out.push('{');
    emitList(arg.content, inner, out);
    out.push('}');
  });
}

/** `]` inside an optional argument would end it early. */
function containsBracket(nodes: Ast.Node[]): boolean {
  return nodes.some((n) => typeof n === 'object' && n.type === 'string' && /[[\]]/.test(n.content));
}

function emitEnvironment(node: Ast.Environment, ctx: Ctx, out: Emitter): void {
  const name = typeof node.env === 'string' ? node.env : '';
  const spec = name ? MATH_ENVIRONMENTS.get(name) : undefined;
  if (!spec || node.type !== 'environment')
    throw new Reject({ code: 'forbiddenEnvironment', detail: name || 'unknown' });

  out.push(`\\begin{${name}}`);
  const args = node.args ?? [];
  let maxColumns = spec.maxColumns;
  if (spec.columns) {
    const [position, columns] = args;
    if (position && (position.content.length > 0 || position.openMark !== ''))
      throw new Reject({ code: 'invalidArgument', detail: name });
    const columnSpec =
      columns?.content
        .map((n) => (typeof n === 'object' && n.type === 'string' ? n.content : '?'))
        .join('') ?? '';
    if (!/^[lcr|]{1,40}$/.test(columnSpec) || !/[lcr]/.test(columnSpec)) {
      throw new Reject({ code: 'invalidArgument', detail: name });
    }
    maxColumns = columnSpec.replace(/\|/g, '').length;
    out.push(`{${columnSpec}}`);
  } else if (args.some((a) => a.content.length > 0 || a.openMark !== '')) {
    throw new Reject({ code: 'invalidArgument', detail: name });
  }
  // More cells in a row than the environment has columns is a TeX error.
  const row = maxColumns !== undefined ? { row: { cells: 1, max: maxColumns } } : {};
  emitList(
    node.content,
    enter(ctx, { mode: 'math', alignment: spec.alignment, lineBreaks: spec.lineBreaks, ...row }),
    out,
  );
  out.push(`\\end{${name}}`);
}
