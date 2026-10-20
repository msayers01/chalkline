import type * as Ast from '@unified-latex/unified-latex-types';
import type { ConventionKey } from '../schema.js';

/**
 * Convention transforms operate on the unified-latex AST after the sanitizer
 * has validated it, and before it is serialized. They must be pure (return
 * new nodes, never mutate) and must only produce allowlisted commands.
 */

export type TransformNote = {
  convention: ConventionKey;
  /** Stable code describing what was (or could be) changed, e.g. `timesToCdot`. */
  detail: string;
};

export type MathTransformResult = {
  nodes: Ast.Node[];
  /** Changes made; review marks them and offers a one-click revert. */
  applied: TransformNote[];
  /** Changes the engine was unsure about; listed in review, not applied. */
  suggestions: TransformNote[];
};

export type MathTransform = (nodes: Ast.Node[]) => MathTransformResult;

/** Commands whose arguments are text (or operator names), never transformed. */
const OPAQUE_ARGS = new Set([
  'text',
  'textrm',
  'textbf',
  'textit',
  'textsf',
  'texttt',
  'textnormal',
  'mbox',
  'operatorname',
]);

export function str(content: string): Ast.String {
  return { type: 'string', content };
}

export function group(content: Ast.Node[]): Ast.Group {
  return { type: 'group', content };
}

/** A command with mandatory (braced) arguments. */
export function macro(name: string, ...args: Ast.Node[][]): Ast.Macro {
  const node: Ast.Macro = { type: 'macro', content: name };
  if (args.length > 0) {
    node.args = args.map((content) => ({
      type: 'argument',
      content,
      openMark: '{',
      closeMark: '}',
    }));
  }
  return node;
}

export function isString(
  node: Ast.Node | undefined,
  content?: string | RegExp,
): node is Ast.String {
  if (!node || typeof node !== 'object' || node.type !== 'string') return false;
  if (content === undefined) return true;
  return typeof content === 'string' ? node.content === content : content.test(node.content);
}

export function isMacro(
  node: Ast.Node | undefined,
  names?: ReadonlySet<string> | string,
): node is Ast.Macro {
  if (!node || typeof node !== 'object' || node.type !== 'macro') return false;
  if (names === undefined) return true;
  return typeof names === 'string' ? node.content === names : names.has(node.content);
}

export function isWhitespace(node: Ast.Node | undefined): boolean {
  return !!node && typeof node === 'object' && node.type === 'whitespace';
}

/** Nearest non-whitespace node before (`step = -1`) or after (`step = 1`) index `i`. */
export function neighbor(list: Ast.Node[], i: number, step: 1 | -1): Ast.Node | undefined {
  for (let j = i + step; j >= 0 && j < list.length; j += step) {
    if (!isWhitespace(list[j])) return list[j];
  }
  return undefined;
}

export function significant(list: Ast.Node[]): Ast.Node[] {
  return list.filter((n) => !isWhitespace(n));
}

/** Mandatory argument contents of a macro, or undefined if it has none. */
export function argContents(node: Ast.Macro): Ast.Node[][] {
  return (node.args ?? []).filter((a) => a.openMark === '{').map((a) => a.content);
}

export function withArgs(node: Ast.Macro, contents: Ast.Node[][]): Ast.Macro {
  let k = 0;
  const args = (node.args ?? []).map((a) => {
    if (a.openMark !== '{') return a;
    const content = contents[k] ?? a.content;
    k += 1;
    return { ...a, content };
  });
  return { ...node, args };
}

/**
 * Bottom-up map over every math node list: groups, math arguments, script
 * arguments and environment bodies. Text arguments and environment
 * arguments (such as array column specs) are left alone.
 */
export function mapLists(nodes: Ast.Node[], fn: (list: Ast.Node[]) => Ast.Node[]): Ast.Node[] {
  const mapped = nodes.map((node): Ast.Node => {
    if (typeof node !== 'object') return node;
    switch (node.type) {
      case 'group':
        return { ...node, content: mapLists(node.content, fn) };
      case 'macro':
        if (!node.args || OPAQUE_ARGS.has(node.content)) return node;
        return {
          ...node,
          args: node.args.map((a) => ({ ...a, content: mapLists(a.content, fn) })),
        };
      case 'environment':
      case 'mathenv':
        return { ...node, content: mapLists(node.content, fn) };
      default:
        return node;
    }
  });
  return fn(mapped);
}

/** Single-letter variables (Latin or Greek), the operands conventions reason about. */
const GREEK = new Set([
  'alpha',
  'beta',
  'gamma',
  'delta',
  'epsilon',
  'varepsilon',
  'zeta',
  'eta',
  'theta',
  'vartheta',
  'iota',
  'kappa',
  'lambda',
  'mu',
  'nu',
  'xi',
  'pi',
  'rho',
  'sigma',
  'tau',
  'upsilon',
  'phi',
  'varphi',
  'chi',
  'psi',
  'omega',
  'Gamma',
  'Delta',
  'Theta',
  'Lambda',
  'Xi',
  'Pi',
  'Sigma',
  'Upsilon',
  'Phi',
  'Psi',
  'Omega',
]);

export function isGreek(node: Ast.Node | undefined): node is Ast.Macro {
  return isMacro(node, GREEK) && !node.args;
}

export function isVariable(node: Ast.Node | undefined): boolean {
  return isString(node, /^[A-Za-z]$/) || isGreek(node);
}

/** Collects notes while a transform runs. */
export class Notes {
  readonly applied: TransformNote[] = [];
  readonly suggestions: TransformNote[] = [];

  constructor(private readonly convention: ConventionKey) {}

  apply(detail: string): void {
    this.applied.push({ convention: this.convention, detail });
  }

  suggest(detail: string): void {
    this.suggestions.push({ convention: this.convention, detail });
  }

  result(nodes: Ast.Node[]): MathTransformResult {
    return { nodes, applied: this.applied, suggestions: this.suggestions };
  }
}
