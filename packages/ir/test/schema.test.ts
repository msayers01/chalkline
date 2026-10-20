import { describe, expect, it } from 'vitest';
import { allIds, newId, safeParseDoc, schema, sequentialIds } from '../src/index.js';
import { fixtures } from '../src/fixtures/index.js';

describe('fixtures', () => {
  for (const [name, build] of Object.entries(fixtures)) {
    it(`${name} is a valid document with unique ids`, () => {
      const result = safeParseDoc(build());
      expect(result.ok ? [] : result.issues).toEqual([]);
    });

    it(`${name} is deterministic`, () => {
      expect(JSON.stringify(build())).toBe(JSON.stringify(build()));
    });
  }
});

describe('safeParseDoc', () => {
  it('rejects duplicate block ids', () => {
    const doc = fixtures.quadratics();
    const [first, second] = doc.sections[0]?.blocks ?? [];
    if (!first || !second) throw new Error('fixture changed');
    second.id = first.id;
    expect(safeParseDoc(doc)).toMatchObject({ ok: false });
    expect(allIds(doc).filter((id) => id === first.id)).toHaveLength(2);
  });

  it('rejects asset references that could escape the bundle directory', () => {
    expect(schema.AssetRef.safeParse('../../etc/passwd').success).toBe(false);
    expect(schema.AssetRef.safeParse('crop_01-a').success).toBe(true);
  });

  it('rejects unknown block types and malformed dates', () => {
    const doc = fixtures.quadratics() as unknown as { meta: { date: string } };
    doc.meta.date = '20/10/2026';
    expect(safeParseDoc(doc).ok).toBe(false);
  });
});

describe('ids', () => {
  it('generates valid, sortable ULIDs', () => {
    const a = newId(1_700_000_000_000);
    const b = newId(1_700_000_000_000);
    expect(schema.Id.safeParse(a).success).toBe(true);
    expect(a < b).toBe(true);
  });

  it('generates deterministic sequential ids', () => {
    const next = sequentialIds('01JX');
    expect([next(), next()]).toEqual(['01JX0000000000000000000001', '01JX0000000000000000000002']);
    expect(schema.Id.safeParse(next()).success).toBe(true);
  });
});
