import { RECOGNITION_PARAMS } from '../params.js';
import type { StructureItem } from './input.js';
import { PARENT_ROLES, type StructureOutput } from './schema.js';

/**
 * Guard checks on a structuring response (architecture, "Guard checks"). A
 * response that fails any of them is not applied: it is retried once, then
 * replaced by the heuristic structurer. Messages name local ids only, never
 * content, so they are safe to log and to send back with the retry.
 */
export function checkOutput(output: StructureOutput, items: readonly StructureItem[]): string[] {
  const problems: string[] = [];
  const known = new Set(items.map((i) => i.local));

  const uses = new Map<string, number>();
  for (const { id } of [...output.blocks, ...output.excluded])
    uses.set(id, (uses.get(id) ?? 0) + 1);
  for (const [id, n] of uses) {
    if (!known.has(id)) problems.push(`unknown id ${quoteId(id)}`);
    else if (n > 1) problems.push(`${id} is used ${n} times`);
  }
  for (const id of known) if (!uses.has(id)) problems.push(`${id} is missing`);

  // With these parent rules a block can never be its own ancestor: only
  // problems, parts, solutions and callouts hold blocks, and none of them
  // may sit inside a block of its own kind or below.
  const placed = new Map(output.blocks.map((b) => [b.id, b]));
  for (const b of output.blocks) {
    const parent = b.parentId === null ? null : placed.get(b.parentId);
    if (parent === undefined) {
      problems.push(`${b.id} has parent ${quoteId(b.parentId ?? '')}, which is not a placed block`);
    } else if (!PARENT_ROLES[b.role].includes(parent?.role ?? null)) {
      problems.push(
        parent
          ? `${b.id} (${b.role}) cannot be inside ${parent.id} (${parent.role})`
          : `${b.id} (${b.role}) needs a parent`,
      );
    }
  }

  const topLevel = new Set(output.blocks.filter((b) => b.parentId === null).map((b) => b.id));
  const sectionUses = new Map<string, number>();
  for (const section of output.sections) {
    for (const id of section.blockIds) {
      sectionUses.set(id, (sectionUses.get(id) ?? 0) + 1);
      if (!topLevel.has(id))
        problems.push(`a section lists ${quoteId(id)}, which is not a top-level block`);
    }
  }
  for (const id of topLevel) {
    const n = sectionUses.get(id) ?? 0;
    if (n !== 1) problems.push(`${id} is in ${n} sections`);
  }
  return problems;
}

/** Model-written ids are echoed back clipped and reduced to id characters. */
function quoteId(id: string): string {
  return `"${id.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 12)}"`;
}

/**
 * Section titles are the only free text the model writes. They become plain
 * text: no math, no LaTeX, no control characters, one short line.
 */
export function plainTitle(
  title: string | null | undefined,
  max: number = RECOGNITION_PARAMS.maxTitleChars,
): string | undefined {
  if (!title) return undefined;
  const plain = title
    .normalize('NFC')
    .replace(/\\[()[\]]|\$+/g, ' ')
    .replace(/\\[A-Za-z]+\*?|\\./g, ' ')
    .replace(/[{}^_&#%~\\]/g, ' ')
    .replace(/\p{Cc}|\p{Cf}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[\s.:;,]+$/, '');
  if (!plain) return undefined;
  if (plain.length <= max) return plain;
  const cut = plain.slice(0, max + 1);
  const space = cut.lastIndexOf(' ');
  return (space > max / 2 ? cut.slice(0, space) : plain.slice(0, max)).trim();
}
