/**
 * `SafeLatex` marks a string that is known to be safe to place in a .tex
 * file: either a constant we authored, or content that went through
 * `escapeText()` or `sanitizeMath()`. Plain strings never become SafeLatex
 * outside this directory (the lint rule `chalkline/no-raw-latex-interpolation`
 * rejects casts and raw template literals elsewhere).
 */
declare const safeLatexBrand: unique symbol;
export type SafeLatex = string & { readonly [safeLatexBrand]: true };

/** Internal: only modules in `safe/` may brand strings. */
export function brand(value: string): SafeLatex {
  return value as SafeLatex;
}

type TexValue = SafeLatex | readonly SafeLatex[];

/**
 * Tagged template for authoring LaTeX. The literal parts are taken raw, so
 * backslashes need no doubling (tex`\section{${title}}`); interpolated values
 * must already be SafeLatex. Arrays are concatenated without separators.
 */
export function tex(strings: TemplateStringsArray, ...values: TexValue[]): SafeLatex {
  let out = strings.raw[0] ?? '';
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    out += Array.isArray(value) ? value.join('') : (value as string);
    out += strings.raw[i + 1] ?? '';
  }
  return brand(out);
}

export const EMPTY: SafeLatex = brand('');

export function joinLatex(parts: readonly SafeLatex[], separator: SafeLatex = EMPTY): SafeLatex {
  return brand(parts.join(separator));
}

/** Non-negative integers (counters, line counts, point values). */
export function texInt(value: number): SafeLatex {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new RangeError('texInt expects a non-negative integer');
  return brand(String(value));
}

/**
 * Finite decimals for lengths and scale factors, printed with a fixed number
 * of places so output is deterministic across platforms.
 */
export function texDecimal(value: number, places = 2): SafeLatex {
  if (!Number.isFinite(value)) throw new RangeError('texDecimal expects a finite number');
  return brand(value.toFixed(places));
}
