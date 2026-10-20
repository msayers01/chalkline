/**
 * Characters the preset font chain (text font, then the math font, then
 * FreeSerif/FreeSans) is known to cover: Latin, Greek, Cyrillic, Hebrew,
 * phonetic extensions, punctuation, letterlike and number forms, arrows,
 * mathematical operators and symbols, technical symbols, box drawing,
 * geometric shapes, Latin ligatures and math alphanumerics. Anything else
 * (CJK, emoji, most dingbats) may print as nothing, so the renderer reports
 * it for review instead of letting it disappear.
 */
const COVERED =
  /^[\t\n\r\u0020-\u052F\u0590-\u05FF\u1D00-\u1DBF\u1E00-\u1FFF\u2000-\u25FF\u27C0-\u27FF\u2900-\u2BFF\u2E00-\u2E7F\uFB00-\uFB4F\u{1D400}-\u{1D7FF}]*$/u;

export function isCoveredText(text: string): boolean {
  return COVERED.test(text);
}
