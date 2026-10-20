import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseSettings, presetsFor, previewLesson } from '../src/preview.js';

describe('presetsFor', () => {
  it('expands set and all, and checks ids', () => {
    expect(presetsFor('set')).toEqual({
      ok: true,
      presets: ['lecture-notes', 'practice-worksheet', 'answer-key'],
    });
    expect(presetsFor('answer-key')).toEqual({ ok: true, presets: ['answer-key'] });
    expect(presetsFor('notes').ok).toBe(false);
  });
});

describe('parseSettings', () => {
  it('parses and validates conventions', () => {
    expect(parseSettings(['font=pagella', 'fontSize=14', 'header=course,date'])).toEqual({
      ok: true,
      settings: { font: 'pagella', fontSize: 14, header: ['course', 'date'] },
    });
    expect(parseSettings(['fontSize=13'])).toEqual({
      ok: false,
      error: '--set fontSize: must be one of 10, 11, 12, 14',
    });
    expect(parseSettings(['nonsense'])).toMatchObject({ ok: false });
    expect(parseSettings(['colour=red'])).toMatchObject({ ok: false });
  });
});

describe('previewLesson', () => {
  it('writes .tex for each preset and points notes at lesson lines', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'chalkline-preview-'));
    const lesson = join(dir, 'test.lesson');
    writeFileSync(lesson, '---\ntitle: T\n---\n# One\n::: problem\nSolve $x^2^3 = 1$.\n:::\n');
    const result = await previewLesson({
      lessonPath: lesson,
      presets: ['lecture-notes', 'answer-key'],
      settings: {},
      pdf: false,
    });
    if (!result.ok) throw new Error('parse failed');
    expect(result.outcomes.map((o) => o.preset)).toEqual(['lecture-notes', 'answer-key']);
    expect(readFileSync(join(dir, 'test-preview', 'lecture-notes.tex'), 'utf8')).toContain(
      '\\DocumentMetadata',
    );
    expect(result.outcomes[0]?.notes).toEqual([
      'line 6: math could not be typeset (doubleScript); a placeholder was printed',
    ]);
  });

  it('returns lesson errors with line numbers', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'chalkline-preview-'));
    const lesson = join(dir, 'bad.lesson');
    writeFileSync(lesson, 'Fine.\n\n::: lemma\n:::\n');
    const result = await previewLesson({
      lessonPath: lesson,
      presets: ['lecture-notes'],
      settings: {},
      pdf: false,
    });
    expect(result).toMatchObject({ ok: false, errors: [{ line: 3 }] });
  });
});
