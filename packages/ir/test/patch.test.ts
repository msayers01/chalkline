import { describe, expect, it } from 'vitest';
import {
  applyPatch,
  findBlock,
  sequentialIds,
  type Actor,
  type Doc,
  type Patch,
  type PatchOp,
} from '../src/index.js';
import { DocBuilder, quadraticsLesson } from '../src/fixtures/index.js';

const teacher: Actor = { kind: 'teacher', userId: 'u1' };
const structuring: Actor = { kind: 'system', component: 'structuring' };
const patchIds = sequentialIds('01JPATCH000000000000');

function patch(doc: Doc, actor: Actor, ...ops: PatchOp[]): Patch {
  return {
    id: patchIds(),
    docId: doc.id,
    baseVersion: doc.version,
    actor,
    at: 1_700_000_000_000,
    ops,
  };
}

function firstOfType<T extends string>(doc: Doc, type: T) {
  for (const section of doc.sections) {
    for (const block of section.blocks)
      if (block.type === type) return block as Extract<typeof block, { type: T }>;
  }
  throw new Error(`no ${type}`);
}

describe('applyPatch', () => {
  it('rejects a patch based on a stale version', () => {
    const doc = quadraticsLesson();
    const p = { ...patch(doc, teacher, { op: 'setMeta', meta: { title: 'New' } }), baseVersion: 0 };
    expect(applyPatch(doc, p)).toEqual({
      ok: false,
      error: { code: 'versionConflict', currentVersion: 1 },
    });
  });

  it('does not mutate its input and bumps the version once per patch', () => {
    const doc = quadraticsLesson();
    const before = JSON.stringify(doc);
    const math = firstOfType(doc, 'paragraph');
    const result = applyPatch(
      doc,
      patch(
        doc,
        teacher,
        { op: 'setMeta', meta: { title: 'Renamed' } },
        { op: 'exclude', blockId: math.id, reason: 'teacher' },
      ),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(JSON.stringify(doc)).toBe(before);
    expect(result.doc.version).toBe(2);
    expect(result.doc.meta.title).toBe('Renamed');
  });

  it('pins blocks a teacher edits and clears a Check flag', () => {
    const b = new DocBuilder('01JTEST0000000000000');
    const check = b.mathCheck('3x^2 = 2y');
    const doc = b.doc(
      { title: 'T', course: 'C', teacher: 'X', date: '2026-01-01', lang: 'en' },
      b.section('S', check),
    );
    const result = applyPatch(
      doc,
      patch(doc, teacher, { op: 'setMathLines', blockId: check.id, lines: ['3x^2 = 27'] }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const edited = findBlock(result.doc, check.id)?.block;
    expect(edited).toMatchObject({
      lines: ['3x^2 = 27'],
      status: 'ready',
      decided: { pinned: true },
    });
  });

  it('turns system changes to pinned blocks into proposals', () => {
    const doc = quadraticsLesson();
    const callout = firstOfType(doc, 'callout');
    const pinned = applyPatch(
      doc,
      patch(doc, teacher, { op: 'setCalloutKind', blockId: callout.id, kind: 'note' }),
    );
    expect(pinned.ok).toBe(true);
    if (!pinned.ok) return;
    expect(findBlock(pinned.doc, callout.id)?.block.decided).toEqual({
      typeBy: 'teacher',
      pinned: true,
    });

    const retype: PatchOp = { op: 'setCalloutKind', blockId: callout.id, kind: 'theorem' };
    const result = applyPatch(pinned.doc, patch(pinned.doc, structuring, retype));
    expect(result).toMatchObject({ ok: true, proposals: [retype], applied: [] });
    if (!result.ok) return;
    expect(result.doc).toBe(pinned.doc);
    expect(findBlock(result.doc, callout.id)?.block).toMatchObject({ kind: 'note' });
  });

  it('never lets a system replace overwrite a pinned descendant', () => {
    const doc = quadraticsLesson();
    const problem = firstOfType(doc, 'problem');
    const promptPara = problem.prompt[0];
    if (!promptPara) throw new Error('fixture changed');
    const edited = applyPatch(
      doc,
      patch(doc, teacher, {
        op: 'setInlines',
        blockId: promptPara.id,
        inlines: [{ kind: 'text', text: 'Factor.' }],
      }),
    );
    if (!edited.ok) throw new Error('edit failed');
    const b = new DocBuilder('01JREP00000000000000');
    const result = applyPatch(
      edited.doc,
      patch(edited.doc, structuring, {
        op: 'replaceBlock',
        blockId: problem.id,
        block: b.p('replacement'),
      }),
    );
    expect(result).toMatchObject({ ok: true, applied: [] });
    expect(result.ok && result.proposals).toHaveLength(1);
  });

  it('restores the prior status when an excluded block is included again', () => {
    const doc = quadraticsLesson();
    const crossed = doc.sections[0]?.blocks.find((x) => x.status === 'excluded');
    if (!crossed) throw new Error('fixture changed');
    const result = applyPatch(doc, patch(doc, teacher, { op: 'include', blockId: crossed.id }));
    if (!result.ok) throw new Error('include failed');
    const block = findBlock(result.doc, crossed.id)?.block;
    expect(block?.status).toBe('ready');
    expect(block?.excludedReason).toBeUndefined();
    expect(block?.decided.pinned).toBe(true);
  });

  it('moves top-level blocks between sections and rejects nested moves', () => {
    const doc = quadraticsLesson();
    const [intro, practice] = doc.sections;
    if (!intro || !practice) throw new Error('fixture changed');
    const first = intro.blocks[0];
    if (!first) throw new Error('fixture changed');
    const moved = applyPatch(
      doc,
      patch(doc, teacher, { op: 'moveBlock', blockId: first.id, sectionId: practice.id, index: 0 }),
    );
    if (!moved.ok) throw new Error('move failed');
    expect(moved.doc.sections[1]?.blocks[0]?.id).toBe(first.id);
    expect(moved.doc.sections[0]?.blocks).toHaveLength(intro.blocks.length - 1);

    const part = firstOfType(doc, 'problem').parts[0];
    if (!part) throw new Error('fixture changed');
    const nested = applyPatch(
      doc,
      patch(doc, teacher, { op: 'moveBlock', blockId: part.id, sectionId: intro.id, index: 0 }),
    );
    expect(nested).toMatchObject({ ok: false, error: { code: 'notTopLevel' } });
  });

  it('rejects the whole patch when one op fails', () => {
    const doc = quadraticsLesson();
    const result = applyPatch(
      doc,
      patch(
        doc,
        teacher,
        { op: 'setMeta', meta: { title: 'Changed' } },
        { op: 'exclude', blockId: '01JNOPE0000000000000000000', reason: 'teacher' },
      ),
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'unknownBlock', opIndex: 1 } });
  });

  it('rejects inserted blocks whose ids already exist', () => {
    const doc = quadraticsLesson();
    const existing = firstOfType(doc, 'paragraph');
    const section = doc.sections[0];
    if (!section) throw new Error('fixture changed');
    const result = applyPatch(
      doc,
      patch(doc, structuring, {
        op: 'insertBlock',
        sectionId: section.id,
        index: 0,
        block: existing,
      }),
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'duplicateId', id: existing.id } });
  });

  it('marks teacher alt text as confirmed and system alt text as unconfirmed', () => {
    const doc = quadraticsLesson();
    const figure = firstOfType(doc, 'figure');
    const bySystem = applyPatch(
      doc,
      patch(doc, structuring, { op: 'setAltText', blockId: figure.id, altText: 'A parabola' }),
    );
    if (!bySystem.ok) throw new Error('failed');
    expect(findBlock(bySystem.doc, figure.id)?.block).toMatchObject({
      altText: 'A parabola',
      altTextConfirmed: false,
    });
    const byTeacher = applyPatch(
      bySystem.doc,
      patch(bySystem.doc, teacher, { op: 'setAltText', blockId: figure.id, altText: 'A parabola' }),
    );
    if (!byTeacher.ok) throw new Error('failed');
    expect(findBlock(byTeacher.doc, figure.id)?.block).toMatchObject({ altTextConfirmed: true });
  });

  it('keeps teacher section titles pinned', () => {
    const doc = quadraticsLesson();
    const section = doc.sections[0];
    if (!section) throw new Error('fixture changed');
    const renamed = applyPatch(
      doc,
      patch(doc, teacher, { op: 'setSectionTitle', sectionId: section.id, title: 'Mine' }),
    );
    if (!renamed.ok) throw new Error('failed');
    const proposed = applyPatch(
      renamed.doc,
      patch(renamed.doc, structuring, {
        op: 'setSectionTitle',
        sectionId: section.id,
        title: 'AI title',
      }),
    );
    expect(proposed).toMatchObject({ ok: true, applied: [] });
    expect(proposed.ok && proposed.doc.sections[0]?.title).toBe('Mine');
  });
});
