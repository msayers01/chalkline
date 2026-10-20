import { Doc as DocSchema } from './schema.js';
import type { Doc } from './types.js';
import { allIds } from './walk.js';

export type DocParseResult =
  { ok: true; doc: Doc } | { ok: false; issues: { path: string; message: string }[] };

/**
 * Validates untrusted input (HTTP bodies, IndexedDB reads) as a document.
 * Beyond the schema, block and section ids must be unique.
 */
export function safeParseDoc(input: unknown): DocParseResult {
  const parsed = DocSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    };
  }
  const doc = parsed.data;
  const seen = new Set<string>();
  for (const id of [...doc.sections.map((s) => s.id), ...allIds(doc)]) {
    if (seen.has(id))
      return { ok: false, issues: [{ path: 'sections', message: `duplicate id ${id}` }] };
    seen.add(id);
  }
  return { ok: true, doc };
}

export function parseDoc(input: unknown): Doc {
  const result = safeParseDoc(input);
  if (!result.ok) {
    throw new Error(
      `invalid document: ${result.issues.map((i) => `${i.path}: ${i.message}`).join('; ')}`,
    );
  }
  return result.doc;
}
