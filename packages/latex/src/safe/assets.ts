import type { InkColor } from '@chalkline/ir';
import { brand, type SafeLatex } from './brand.js';

const ASSET_REF = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Path of an asset inside the compile bundle. Asset refs are validated by the
 * IR schema; this re-checks so a renderer can never be handed a path with
 * separators, dots or TeX specials.
 */
export function assetPath(ref: string, extension: 'png' | 'pdf'): SafeLatex {
  if (!ASSET_REF.test(ref)) throw new Error('invalid asset reference');
  return brand(`assets/${ref}.${extension}`);
}

/** Fixed xcolor names for the board palette. White ink prints black on paper. */
const INK: Record<InkColor, string> = {
  black: 'black',
  blue: 'clBlue',
  red: 'clRed',
  green: 'clGreen',
  orange: 'clOrange',
  purple: 'clPurple',
  brown: 'clBrown',
  white: 'black',
};

export function inkColorName(color: InkColor): SafeLatex {
  return brand(INK[color]);
}

const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;

/** A ULID, re-validated before it is written into the source (for comments). */
export function texId(id: string): SafeLatex {
  if (!ULID.test(id)) throw new Error('invalid id');
  return brand(id);
}

/** The `% blk:<id>` line that precedes every block, used by source maps and overflow mapping. */
export function blockMarker(id: string): SafeLatex {
  return brand(`% blk:${texId(id)}`);
}
