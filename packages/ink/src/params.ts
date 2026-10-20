/**
 * Tunable thresholds for board ink. Tuned on the lesson corpus; change them
 * here, never inline, and run `pnpm corpus:score --subset smoke` after.
 */
export const INK_PARAMS = {
  /** A region closes after this long without new strokes nearby. */
  settleMs: 2_000,
  /** A stroke farther than this many line-heights from a region starts a new one. */
  farLineHeights: 3,
  /** A far stroke closes other open regions idle at least this long (a second writer keeps theirs). */
  farCloseIdleMs: 300,
  /** Line height (page units) assumed until a region has strokes to measure. */
  defaultLineHeight: 48,
  minLineHeight: 16,
  maxLineHeight: 200,
  /** Ink erased and rewritten in the same area within this window is a correction. */
  correctionWindowMs: 20_000,
  /** Share of a committed region's strokes that must be erased for it to count as erased. */
  erasedShare: 0.5,
  /** Overlap (of the smaller box) for new ink to count as written in the same area. */
  sameAreaOverlap: 0.3,
  /** Mathpix v3/strokes request body limit. */
  maxRequestBytes: 512 * 1024,
} as const;

export type InkParams = { [K in keyof typeof INK_PARAMS]: number };
