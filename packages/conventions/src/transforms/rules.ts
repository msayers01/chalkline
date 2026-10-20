import type * as Ast from '@unified-latex/unified-latex-types';
import type { Conventions } from '../schema.js';
import {
  argContents,
  group,
  isMacro,
  isString,
  isVariable,
  isWhitespace,
  isGreek,
  macro,
  mapLists,
  neighbor,
  Notes,
  significant,
  str,
  withArgs,
  type MathTransform,
} from './ast.js';

/**
 * Splits multi-character strings into single characters. The parser keeps
 * some runs together (digits in a script, letters in an argument); the rules
 * below reason character by character. Serialization is unchanged.
 */
export const normalizeStrings: MathTransform = (nodes) => ({
  nodes: mapLists(nodes, (list) =>
    list.flatMap((n) =>
      isString(n) && n.content.length > 1 ? Array.from(n.content, (c) => str(c)) : [n],
    ),
  ),
  applied: [],
  suggestions: [],
});

const VECTORISH = new Set(['vec', 'overrightarrow', 'mathbf', 'boldsymbol', 'symbf', 'symbfit']);

function isVectorish(node: Ast.Node | undefined): boolean {
  if (isMacro(node, VECTORISH)) return true;
  if (node && typeof node === 'object' && node.type === 'group') {
    const inner = significant(node.content);
    return inner.length > 0 && inner.every((n) => isVectorish(n) || isString(n, /^[_^]$/));
  }
  return false;
}

const OPERATOR_MACROS = new Set([
  'cdot',
  'times',
  'div',
  'pm',
  'mp',
  'ast',
  'circ',
  'leq',
  'geq',
  'le',
  'ge',
  'neq',
  'ne',
  'approx',
  'equiv',
  'to',
  'left',
  'middle',
  'right',
  'quad',
  'qquad',
]);

/** Could this node end the left operand of a product? */
function endsOperand(node: Ast.Node | undefined): boolean {
  if (!node || typeof node !== 'object') return false;
  if (node.type === 'string')
    return /^[A-Za-z0-9)\]'!.\u0080-\uFFFF]$/u.test(node.content) || /^[0-9]+$/.test(node.content);
  if (node.type === 'group') return true;
  if (node.type === 'macro') return !OPERATOR_MACROS.has(node.content);
  return false;
}

/** Could this node start the right operand of a product? */
function startsOperand(node: Ast.Node | undefined): boolean {
  if (!node || typeof node !== 'object') return false;
  if (node.type === 'string')
    return /^[A-Za-z0-9([.\u0080-\uFFFF]$/u.test(node.content) || /^[0-9]+$/.test(node.content);
  if (node.type === 'group') return true;
  if (node.type === 'macro')
    return (
      node.content === 'left' ||
      (!OPERATOR_MACROS.has(node.content) && node.content !== '^' && node.content !== '_')
    );
  return false;
}

/**
 * `\cdot` <-> `\times`, only between two operands that are not vectors (a dot
 * or cross between vectors is a different product, so it is only suggested).
 */
export function multiplicationSign(target: 'cdot' | 'times'): MathTransform {
  const from = target === 'cdot' ? 'times' : 'cdot';
  return (nodes) => {
    const notes = new Notes('multiplicationSign');
    const out = mapLists(nodes, (list) =>
      list.map((node, i) => {
        if (!isMacro(node, from) || node.args) return node;
        const prev = neighbor(list, i, -1);
        const next = neighbor(list, i, 1);
        if (!endsOperand(prev) || !startsOperand(next)) return node;
        if (isVectorish(prev) || isVectorish(next)) {
          notes.suggest('vectorProduct');
          return node;
        }
        notes.apply(`${from}To${target === 'cdot' ? 'Cdot' : 'Times'}`);
        return macro(target);
      }),
    );
    return notes.result(out);
  };
}

const isDigit = (node: Ast.Node | undefined) => isString(node, /^[0-9]$/);
const isCommaGroup = (node: Ast.Node | undefined) =>
  !!node &&
  typeof node === 'object' &&
  node.type === 'group' &&
  node.content.length === 1 &&
  isString(node.content[0], ',');

/**
 * Decimal separator. A point or a braced comma between two digits is a
 * decimal mark. A bare comma between digits is usually a list separator, as
 * in the point (1,2), so it is left alone.
 */
export function decimalSeparator(target: 'point' | 'comma'): MathTransform {
  return (nodes) => {
    const notes = new Notes('decimalSeparator');
    const out = mapLists(nodes, (list) =>
      list.map((node, i) => {
        const between = isDigit(list[i - 1]) && isDigit(list[i + 1]);
        if (!between) return node;
        if (target === 'comma' && isString(node, '.')) {
          notes.apply('pointToComma');
          return group([str(',')]);
        }
        if (target === 'point' && isCommaGroup(node)) {
          notes.apply('commaToPoint');
          return str('.');
        }
        return node;
      }),
    );
    return notes.result(out);
  };
}

const ARROW_VECTOR = new Set(['vec', 'overrightarrow']);
const BOLD = new Set(['mathbf', 'boldsymbol', 'symbf', 'symbfit']);

/**
 * Vector style. An arrow always marks a vector, so arrow -> bold is applied
 * for single symbols. Bold does not always mean vector (matrices, points),
 * so bold -> arrow is only suggested.
 */
export function vectors(target: 'arrow' | 'bold'): MathTransform {
  return (nodes) => {
    const notes = new Notes('vectors');
    const out = mapLists(nodes, (list) =>
      list.map((node) => {
        if (target === 'bold' && isMacro(node, ARROW_VECTOR)) {
          const [arg] = argContents(node);
          const inner = significant(arg ?? []);
          const only = inner[0];
          if (inner.length === 1 && only && isVariable(only)) {
            notes.apply('arrowToBold');
            return isGreek(only) ? macro('boldsymbol', [only]) : macro('mathbf', [only]);
          }
          notes.suggest('arrowToBold');
          return node;
        }
        if (target === 'arrow' && isMacro(node, BOLD)) notes.suggest('boldToArrow');
        return node;
      }),
    );
    return notes.result(out);
  };
}

const FRACTIONS = new Set(['frac', 'dfrac', 'tfrac']);

/** `d`, optionally `d^n`, then a variable or the end: the start of a Leibniz numerator or denominator. */
function startsLeibniz(content: Ast.Node[], allowBare: boolean): boolean {
  const sig = significant(content);
  if (!isString(sig[0], 'd') && !isUprightD(sig[0])) return false;
  if (sig.length === 1) return allowBare;
  const second = sig[1];
  return isVariable(second) || isMacro(second, '^');
}

function isUprightD(node: Ast.Node | undefined): boolean {
  if (!isMacro(node, 'mathrm')) return false;
  const [arg] = argContents(node);
  return !!arg && arg.length === 1 && isString(arg[0], 'd');
}

function isLeibnizFraction(node: Ast.Node): node is Ast.Macro {
  if (!isMacro(node, FRACTIONS)) return false;
  const [num, den] = argContents(node);
  return !!num && !!den && startsLeibniz(num, true) && startsLeibniz(den, false);
}

/**
 * Derivative notation. Converting between prime and Leibniz notation needs
 * the independent variable, which the board rarely states unambiguously, so
 * v1 only suggests it.
 */
export function derivatives(target: 'prime' | 'leibniz'): MathTransform {
  return (nodes) => {
    const notes = new Notes('derivatives');
    mapLists(nodes, (list) => {
      list.forEach((node, i) => {
        if (target === 'prime' && isLeibnizFraction(node)) notes.suggest('leibnizToPrime');
        if (target === 'leibniz' && isString(node, "'") && isVariable(list[i - 1]))
          notes.suggest('primeToLeibniz');
      });
      return list;
    });
    return notes.result(nodes);
  };
}

const INTEGRALS = new Set(['int', 'iint', 'iiint', 'oint']);
const ENDS_INTEGRAND = new Set(['=', '<', '>', '+', '-', ',', '.', ')', ']', ';']);
const RELATION_MACROS = new Set([
  'leq',
  'geq',
  'le',
  'ge',
  'neq',
  'ne',
  'approx',
  'equiv',
  'quad',
  'qquad',
  ',',
  ';',
]);

/** `d` + variable at the end of an integrand: followed by nothing, a relation, a sign, or another differential. */
function isIntegralDifferential(list: Ast.Node[], i: number): boolean {
  const before = list[i - 1];
  if (isString(before, /^[A-Za-z]$/)) return false;
  const variable = neighbor(list, i, 1);
  if (!isVariable(variable)) return false;
  const varIndex = list.indexOf(variable as Ast.Node, i + 1);
  const after = neighbor(list, varIndex, 1);
  if (after === undefined) return true;
  if (isString(after) && (ENDS_INTEGRAND.has(after.content) || after.content === 'd')) return true;
  if (isMacro(after, RELATION_MACROS)) return true;
  return isUprightD(after);
}

/**
 * Differential d. Applied where the d is unambiguous: Leibniz fractions, and
 * a trailing `d<var>` in an expression that contains an integral sign.
 */
export function differentialD(target: 'italic' | 'upright'): MathTransform {
  return (nodes) => {
    const notes = new Notes('differentialD');
    const upright = () => macro('mathrm', [str('d')]);
    const italic = () => str('d');

    const out = mapLists(nodes, (list) => {
      const hasIntegral = list.some((n) => isMacro(n, INTEGRALS));
      let integralSeen = false;
      return list.map((node, i) => {
        if (isMacro(node, INTEGRALS)) integralSeen = true;

        if (isLeibnizFraction(node)) {
          const [num = [], den = []] = argContents(node);
          const swap = (content: Ast.Node[]) => {
            const k = content.findIndex((n) => !isWhitespace(n));
            const first = content[k];
            const wanted = target === 'upright' ? isString(first, 'd') : isUprightD(first);
            if (!wanted) return content;
            const copy = [...content];
            copy[k] = target === 'upright' ? upright() : italic();
            return copy;
          };
          const next = withArgs(node, [swap(num), swap(den)]);
          if (JSON.stringify(next) !== JSON.stringify(node)) notes.apply('leibnizD');
          return next;
        }

        if (hasIntegral && integralSeen) {
          if (target === 'upright' && isString(node, 'd') && isIntegralDifferential(list, i)) {
            notes.apply('integralD');
            return upright();
          }
          if (target === 'italic' && isUprightD(node) && isVariable(neighbor(list, i, 1))) {
            notes.apply('integralD');
            return italic();
          }
        }
        return node;
      });
    });
    return notes.result(out);
  };
}

/** The transforms a set of conventions implies, in application order. */
export function mathTransformsFor(conventions: Conventions): MathTransform[] {
  const transforms: MathTransform[] = [normalizeStrings];
  if (conventions.multiplicationSign !== 'asWritten')
    transforms.push(multiplicationSign(conventions.multiplicationSign));
  transforms.push(decimalSeparator(conventions.decimalSeparator));
  if (conventions.vectors !== 'asWritten') transforms.push(vectors(conventions.vectors));
  if (conventions.derivatives !== 'asWritten')
    transforms.push(derivatives(conventions.derivatives));
  transforms.push(differentialD(conventions.differentialD));
  return transforms;
}
