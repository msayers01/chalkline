import { DocBuilder, fixtures } from '@chalkline/ir/fixtures';
import { describe, expect, it } from 'vitest';
import {
  BUILT_IN_PRESETS,
  SELECTABLE_PRESETS,
  packagesIn,
  renderWithPreset,
} from '../src/index.js';

const body = (tex: string) => tex.slice(tex.indexOf('\\begin{document}'));
const render = (preset: Parameters<typeof renderWithPreset>[1], doc = fixtures.quadratics()) =>
  renderWithPreset(doc, preset).tex;
const problemNumbers = (tex: string) =>
  [...tex.matchAll(/\\begin\{clproblem\}\{(\d+)\}/g)].map((m) => Number(m[1]));

describe('the nine presets', () => {
  it('are all selectable except the Guided Notes companion', () => {
    expect(SELECTABLE_PRESETS).toHaveLength(9);
    expect(SELECTABLE_PRESETS).not.toContain('guided-notes-filled');
    expect(BUILT_IN_PRESETS['guided-notes-filled'].companionOf).toBe('guided-notes');
  });

  it('Guided Notes blank the teacher’s key results; the filled companion keeps them', () => {
    const guided = body(render('guided-notes'));
    const filled = body(render('guided-notes-filled'));
    expect(guided).toContain('Guided Notes}');
    expect(guided).toMatch(
      /\\begin\{cltheorem\}\{Theorem\}\{Quadratic formula\}\n\\clblank\{\d+\}/,
    );
    expect(guided).not.toContain('\\sqrt{b^{2} - 4ac}');
    expect(filled).toContain('\\sqrt{b^{2} - 4ac}');
    expect(filled).not.toContain('\\clblank');
    expect(filled).toContain('Guided Notes (filled)');
    expect(body(render('guided-notes', fixtures.calculus()))).toMatch(/% blk:\w+\n\\clblank\{2\}/);
  });

  it('Worked Examples keep problems and examples with full solutions, nothing else', () => {
    const worked = body(render('worked-examples'));
    expect(worked).toContain('\\begin{clexample}');
    expect(worked).toContain('\\begin{clsolution}');
    expect(worked).not.toMatch(/cldefinition|cltheorem|clannouncement|clanswerspace/);
    expect(worked).not.toContain('Today we solve');
    expect(problemNumbers(worked)).toEqual([1, 2, 3, 4]);
  });

  it('Quiz adds name, date and score lines, keeps each problem on one page, and shows points', () => {
    const quiz = body(render('quiz'));
    expect(quiz).toContain('\\clquizheader{Name}{Date}{Score}');
    expect(quiz.match(/\\begin\{clkeep\}/g)).toHaveLength(4);
    expect(quiz).toMatch(/\\begin\{clkeep\}\n\\begin\{clproblem\}\{1\}/);
    expect(quiz).toContain('{5 points}');
    expect(quiz).toContain('\\clanswerspace{');
    expect(quiz).not.toMatch(/clsolution|clanswerboxed/);
  });

  it('Study Sheet keeps definitions, theorems and formulas in two compact columns', () => {
    const rendering = renderWithPreset(fixtures.quadratics(), 'study-sheet');
    expect(rendering.tex).toContain('\\documentclass[10pt]{article}');
    expect(packagesIn(rendering.tex)).toContain('multicol');
    const sheet = body(rendering.tex);
    expect(sheet).toContain('\\begin{clcolumns}');
    expect(sheet).toMatch(/cldefinition[\s\S]*cltheorem/);
    expect(sheet).not.toMatch(/clproblem|clexample|clannouncement|Today we solve/);
  });

  it('Exit Ticket prints the last problems that fit half a page, twice per sheet with a cut line', () => {
    const rendering = renderWithPreset(fixtures.quadratics(), 'exit-ticket');
    const ticket = body(rendering.tex);
    expect(ticket.match(/\\clcutline/g)).toHaveLength(1);
    expect(ticket.match(/\\cltitle\{/g)).toHaveLength(2);
    expect(problemNumbers(ticket)).toEqual([1, 2, 1, 2]);
    expect(ticket).not.toContain('\\section*');
    expect(ticket).not.toContain('Solve by factoring');
    const lines = rendering.tex.split('\n');
    for (const entry of rendering.sourceMap)
      expect(lines[entry.startLine - 1]).toBe(`% blk:${entry.blockId}`);
  });

  it('Board Snapshot keeps everything in the order it was written', () => {
    const b = new DocBuilder('01JBRD00000000000000');
    const first = b.p('written first');
    const second = b.p('written second');
    const doc = b.doc(
      { title: 'T', course: 'C', teacher: 'X', date: '2026-01-01', lang: 'en' },
      b.section('S', second, first),
    );
    const notes = body(renderWithPreset(doc, 'lecture-notes').tex);
    const board = body(renderWithPreset(doc, 'board-snapshot').tex);
    expect(notes.indexOf('written second')).toBeLessThan(notes.indexOf('written first'));
    expect(board.indexOf('written first')).toBeLessThan(board.indexOf('written second'));
    expect(body(render('board-snapshot'))).toContain('\\begin{clannouncement}');
  });
});
