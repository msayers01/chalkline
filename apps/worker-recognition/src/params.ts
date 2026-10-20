/**
 * Tunable thresholds for recognition and structuring. Tuned on the lesson
 * corpus; change them here, never inline, and run
 * `pnpm corpus:score --subset smoke` after.
 */
export const RECOGNITION_PARAMS = {
  /** At or above: Ready. */
  readyConfidence: 0.85,
  /** At or above (and below ready): Check. Below: kept as an image. */
  checkConfidence: 0.6,
  /** Most characters of a block's content shown to the structuring model. */
  maxContentChars: 400,
  /** Section titles the model writes: plain text, at most this long. */
  maxTitleChars: 80,
  /** Figure alt text the model drafts: plain text, at most this long. */
  maxAltTextChars: 250,
} as const;
