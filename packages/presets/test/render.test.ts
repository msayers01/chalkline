import { DEFAULT_CONVENTIONS, type Conventions } from '@chalkline/conventions';
import { applyPatch, findBlock, walkBlocks, type Doc } from '@chalkline/ir';
import { DocBuilder, fixtures } from '@chalkline/ir/fixtures';
import { BANNED_MACROS, CONTRACT } from '@chalkline/latex';
import { describe, expect, it } from 'vitest';
import {
  BANNED_PACKAGES,
  BUILT_IN_PRESETS,
  THE_SET,
  buildPreamble,
  isAllowedPackage,
  packagesIn,
  renderWithPreset,
  type PresetId,
} from '../src/index.js';

const presets = Object.keys(BUILT_IN_PRESETS) as PresetId[];
const body = (tex: string) => tex.slice(tex.indexOf('\\begin{document}'));

describe('determinism', () => {
  it('renders byte-identical output for the same input, including after a JSON round trip', () => {
    for (const preset of presets) {
      for (const build of Object.values(fixtures)) {
        const doc = build();
        const a = renderWithPreset(doc, preset).tex;
        const b = renderWithPreset(JSON.parse(JSON.stringify(doc)) as Doc, preset).tex;
        expect(b).toBe(a);
      }
    }
  });
});

describe('source map', () => {
  it('points at the % blk: marker of every rendered block', () => {
    for (const preset of presets) {
      const { tex, sourceMap } = renderWithPreset(fixtures.quadratics(), preset);
      const lines = tex.split('\n');
      expect(sourceMap.length).toBeGreaterThan(0);
      for (const entry of sourceMap) {
        expect(lines[entry.startLine - 1]).toBe(`% blk:${entry.blockId}`);
        expect(entry.endLine).toBeGreaterThanOrEqual(entry.startLine);
      }
    }
  });

  it('includes every non-excluded block in Lecture Notes and no excluded ones', () => {
    const doc = fixtures.quadratics();
    const { sourceMap } = renderWithPreset(doc, 'lecture-notes');
    const mapped = new Set(sourceMap.map((e) => e.blockId));
    for (const { block, ancestors } of walkBlocks(doc)) {
      const hidden = block.status === 'excluded' || ancestors.some((a) => a.status === 'excluded');
      expect(mapped.has(block.id)).toBe(!hidden);
    }
  });
});

describe('structure rules', () => {
  const doc = fixtures.quadratics();
  const notes = body(renderWithPreset(doc, 'lecture-notes').tex);
  const worksheet = body(renderWithPreset(doc, 'practice-worksheet').tex);
  const key = body(renderWithPreset(doc, 'answer-key').tex);

  it('Lecture Notes keep callouts, examples with solutions, and answers', () => {
    expect(notes).toContain('\\begin{cldefinition}{Definition}{Quadratic equation}');
    expect(notes).toContain('\\begin{clannouncement}');
    expect(notes).toContain('\\begin{clsolution}{Solution}');
    expect(notes).toContain('\\clanswerboxed{Answer}');
  });

  it('the Practice Worksheet has problems only, with answer space and no solutions', () => {
    expect(worksheet).not.toMatch(
      /clsolution|clanswer\{|clanswerboxed|cldefinition|clannouncement/,
    );
    expect(worksheet).toContain('\\clanswerspace{');
    expect(worksheet).not.toContain('Quiz Friday');
    expect(worksheet).toContain('Practice}');
  });

  it('the Answer Key shows answers, and a solution only where there is no answer', () => {
    expect(key).toContain('\\clanswerboxed{Answer}');
    expect(key).not.toContain('\\clanswerspace');
    expect(key).toContain('Answer Key');
  });

  it('numbers problems identically on the worksheet and the key', () => {
    const numbers = (tex: string) =>
      [...tex.matchAll(/\\begin\{clproblem\}\{(\d+)\}/g)].map((m) => m[1]);
    expect(numbers(worksheet)).toEqual(['1', '2', '3', '4']);
    expect(numbers(key)).toEqual(numbers(worksheet));
  });

  it('sizes answer space from the original solution, within 3 to 12 lines', () => {
    const spaces = [...worksheet.matchAll(/\\clanswerspace\{(\d+)\}/g)].map((m) => Number(m[1]));
    expect(spaces.length).toBeGreaterThan(0);
    for (const n of spaces) expect(n).toBeGreaterThanOrEqual(3);
    for (const n of spaces) expect(n).toBeLessThanOrEqual(12);
    expect(Math.max(...spaces)).toBeGreaterThan(3);
  });

  it('restarts numbering per section when the convention says so', () => {
    const b = new DocBuilder('01JNM000000000000000');
    const twoSections = b.doc(
      { title: 'T', course: 'C', teacher: 'X', date: '2026-01-01', lang: 'en' },
      b.section('A', b.problem([b.p('one')]), b.problem([b.p('two')])),
      b.section('B', b.problem([b.p('three')])),
    );
    const restart = body(
      renderWithPreset(twoSections, 'practice-worksheet', {
        teacher: { problemNumbering: 'restartEachSection' },
      }).tex,
    );
    expect([...restart.matchAll(/\\begin\{clproblem\}\{(\d+)\}/g)].map((m) => m[1])).toEqual([
      '1',
      '2',
      '1',
    ]);
  });

  it('makes the set: notes, worksheet and key', () => {
    expect(THE_SET).toEqual(['lecture-notes', 'practice-worksheet', 'answer-key']);
  });
});

describe('teacher edits survive preset switches', () => {
  it('renders an edited block in every preset', () => {
    const doc = fixtures.quadratics();
    const problem = doc.sections[1]?.blocks[2];
    const math = problem?.type === 'problem' ? problem.prompt[0] : undefined;
    if (!math) throw new Error('fixture changed');
    const edited = applyPatch(doc, {
      id: '01JEDT00000000000000000001',
      docId: doc.id,
      baseVersion: doc.version,
      actor: { kind: 'teacher', userId: 'u1' },
      at: 0,
      ops: [{ op: 'setMathLines', blockId: math.id, lines: ['3x^2 = 48'] }],
    });
    if (!edited.ok) throw new Error('patch failed');
    expect(findBlock(edited.doc, math.id)?.block.decided.pinned).toBe(true);
    for (const preset of presets)
      expect(renderWithPreset(edited.doc, preset).tex).toContain('3x^{2} = 48');
  });
});

describe('content safety', () => {
  const adversarial = renderWithPreset(fixtures.adversarial(), 'lecture-notes');
  const text = body(adversarial.tex);

  it('never lets a banned command through from content', () => {
    for (const name of BANNED_MACROS) {
      expect(text).not.toMatch(new RegExp(`(?<!\\\\)\\\\${name}(?![A-Za-z])`));
    }
  });

  it('escapes injected text and replaces rejected math with a placeholder', () => {
    expect(text).toContain('\\textbackslash{}input\\{/etc/passwd\\}');
    expect(text).toContain('\\clplaceholder{');
    const rejected = adversarial.issues.filter((i) => i.code === 'mathRejected');
    expect(rejected.length).toBeGreaterThanOrEqual(12);
  });

  it('escapes the title and header fields', () => {
    expect(adversarial.tex).toContain(
      '\\cltitle{\\textbackslash{}documentclass\\{evil\\} \\{Title\\} 100\\% \\& \\#1}',
    );
    expect(adversarial.tex).toContain(
      '\\clheader{Course\\_with\\_underscores \\textasciitilde{} tilde}',
    );
  });

  it('reports text the fonts may not cover instead of dropping it silently', () => {
    const b = new DocBuilder('01JEMJ00000000000000');
    const para = b.p('Great work 😀 数学');
    const doc = b.doc(
      { title: 'T', course: 'C', teacher: 'X', date: '2026-01-01', lang: 'en' },
      b.section(undefined, para),
    );
    const { issues, tex } = renderWithPreset(doc, 'lecture-notes');
    expect(issues).toContainEqual({ blockId: para.id, code: 'unsupportedCharacter' });
    expect(tex).toContain('😀 数学');
  });
});

describe('languages', () => {
  it('uses the document language for labels, dates and the PDF language tag', () => {
    const { tex } = renderWithPreset(fixtures.calculus(), 'answer-key');
    expect(tex).toContain('\\DocumentMetadata{lang=es,');
    expect(tex).toContain('Derivadas e integrales — Solucionario');
    expect(tex).toContain('21 de octubre de 2026');
    expect(tex).toContain('{Respuesta}');
  });
});

describe('preambles', () => {
  const variants: Conventions[] = [];
  for (const font of ['latinModern', 'pagella', 'termes', 'sans'] as const) {
    for (const fontSize of [10, 11, 12, 14] as const) {
      for (const lang of ['en', 'fr'] as const) {
        variants.push({
          ...DEFAULT_CONVENTIONS,
          font,
          fontSize,
          lang,
          paperSize: lang === 'fr' ? 'a4' : 'letter',
        });
      }
    }
  }

  it('load only allowlisted, tagging-compatible packages', () => {
    for (const preset of Object.values(BUILT_IN_PRESETS)) {
      for (const conventions of variants) {
        const preamble = buildPreamble(conventions, preset.style);
        const loaded = packagesIn(preamble);
        expect(loaded.length).toBeGreaterThan(5);
        for (const name of loaded) expect(isAllowedPackage(name), name).toBe(true);
        for (const name of BANNED_PACKAGES) expect(loaded).not.toContain(name);
        expect(preamble).not.toMatch(/\\RequirePackage|titlesec/);
      }
    }
  });

  it('define every command and environment the renderer emits', () => {
    for (const preset of Object.values(BUILT_IN_PRESETS)) {
      const preamble = buildPreamble(DEFAULT_CONVENTIONS, preset.style);
      for (const env of CONTRACT.environments)
        expect(preamble).toContain(`\\NewDocumentEnvironment{${env}}`);
      for (const cmd of CONTRACT.commands)
        expect(preamble).toContain(`\\NewDocumentCommand{\\${cmd}}`);
    }
  });
});
