/**
 * Packages preamble modules may load. Every entry was checked against the
 * LaTeX Tagging Project status list (https://latex3.github.io/tagging-project/tagging-status/)
 * for the pinned TeX Live release; `updated` is the date of the status entry
 * at the time it was checked. Re-check every entry when the TeX Live pin
 * moves, and run the compile matrix plus veraPDF.
 *
 * Only `compatible` and `partially-compatible` packages are allowed, and for
 * partially compatible ones the note says which features we rely on.
 */

export const TEXLIVE_RELEASE = 2026;
export const TAGGING_STATUS_CHECKED = '2026-10-20';

export type TaggingStatus = 'compatible' | 'partially-compatible';

export type AllowedPackage = {
  name: string;
  status: TaggingStatus;
  updated: string;
  note?: string;
};

export const PACKAGE_ALLOWLIST: readonly AllowedPackage[] = [
  {
    name: 'amsmath',
    status: 'partially-compatible',
    updated: '2026-03-14',
    note: 'Display environments are tagged with MathML through luamml; we use align*, gather*, equation and the matrix environments.',
  },
  { name: 'fontspec', status: 'compatible', updated: '2024-07-12' },
  { name: 'unicode-math', status: 'compatible', updated: '2025-05-26' },
  { name: 'geometry', status: 'compatible', updated: '2026-03-09' },
  { name: 'fancyhdr', status: 'compatible', updated: '2024-07-12' },
  { name: 'lastpage', status: 'compatible', updated: '2026-01-26' },
  { name: 'xcolor', status: 'compatible', updated: '2024-07-07' },
  { name: 'graphicx', status: 'compatible', updated: '2026-07-25' },
  { name: 'array', status: 'compatible', updated: '2024-07-06' },
  { name: 'booktabs', status: 'compatible', updated: '2025-06-13' },
  { name: 'multicol', status: 'compatible', updated: '2025-06-09' },
  { name: 'siunitx', status: 'compatible', updated: '2026-10-08' },
  {
    name: 'tcolorbox',
    status: 'partially-compatible',
    updated: '2026-08-16',
    note: 'Simple boxes are tagged correctly; presets use only simple, untitled boxes.',
  },
  {
    name: 'hyperref',
    status: 'partially-compatible',
    updated: '2025-06-07',
    note: 'Forms are not supported; presets use no forms.',
  },
];

/**
 * Never allowed in a preamble. `titlesec` is the first entry (invariant 14).
 * `enumitem` cannot be loaded under tagging; its document-level list keys
 * work without it. `babel` is unchecked as a whole and French is currently
 * incompatible, so labels are localized by the renderer instead.
 */
export const BANNED_PACKAGES: readonly string[] = [
  'titlesec',
  'enumitem',
  'caption',
  'float',
  'framed',
  'mdframed',
  'cancel',
  'pgfplots',
  'babel',
  'polyglossia',
  'amssymb',
];

export const ALLOWED_CLASSES: readonly string[] = ['article'];

const allowed = new Set(PACKAGE_ALLOWLIST.map((p) => p.name));

export function isAllowedPackage(name: string): boolean {
  return allowed.has(name) && !BANNED_PACKAGES.includes(name);
}

/** Package names loaded by a preamble (`\usepackage[...]{a,b}`). */
export function packagesIn(preamble: string): string[] {
  const names: string[] = [];
  for (const match of preamble.matchAll(
    /\\(?:usepackage|RequirePackage)\s*(?:\[[^\]]*\])?\s*\{([^}]*)\}/g,
  )) {
    for (const name of (match[1] ?? '').split(',')) names.push(name.trim());
  }
  return names;
}
