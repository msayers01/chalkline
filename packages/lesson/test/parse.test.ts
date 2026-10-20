import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { safeParseDoc, walkBlocks } from '@chalkline/ir';
import { describe, expect, it } from 'vitest';
import { parseInlines, parseLesson } from '../src/index.js';

const example = readFileSync(
  join(import.meta.dirname, '../../../tools/preview/examples/quadratics.lesson'),
  'utf8',
);

function ok(source: string) {
  const r = parseLesson(source);
  if (!r.ok) throw new Error(r.errors.map((e) => `${e.line}: ${e.message}`).join('\n'));
  return r;
}

function errorOf(source: string) {
  const r = parseLesson(source);
  if (r.ok) throw new Error('expected an error');
  return r.errors[0];
}

describe('parseLesson', () => {
  it('parses the example lesson into a valid document', () => {
    const { doc, lines } = ok(example);
    expect(safeParseDoc(doc).ok).toBe(true);
    expect(doc.meta).toMatchObject({
      title: 'Solving quadratic equations',
      unit: 'Unit 4: Quadratics',
      lang: 'en',
    });
    expect(doc.sections.map((s) => s.title)).toEqual(['Quadratic equations', 'Practice']);
    for (const { block } of walkBlocks(doc)) expect(lines.get(block.id)).toBeGreaterThan(0);
  });

  it('builds problems with parts, solutions, answers and points', () => {
    const { doc } = ok(example);
    const problems = doc.sections[1]?.blocks.filter((b) => b.type === 'problem') ?? [];
    expect(problems).toHaveLength(3);
    const [first, second] = problems;
    if (first?.type !== 'problem' || second?.type !== 'problem')
      throw new Error('expected problems');
    expect(first.parts).toHaveLength(2);
    expect(first.parts[0]?.solution?.steps[0]).toMatchObject({
      type: 'displayMath',
      lines: ['(x + 3)(x + 4) = 0'],
    });
    expect(first.parts[1]?.answer?.inlines).toEqual([{ kind: 'math', latex: 'x = \\pm 3' }]);
    expect(second.points).toBe(5);
    expect(second.solution?.steps[0]).toMatchObject({
      type: 'displayMath',
      lines: ['x = \\frac{4 \\pm \\sqrt{16 + 8}}{4}', 'x = \\frac{2 \\pm \\sqrt{6}}{2}'],
    });
  });

  it('applies tags: key results, low confidence and crossed-out work', () => {
    const { doc } = ok(example);
    const blocks = [...walkBlocks(doc)].map((v) => v.block);
    expect(blocks.find((b) => b.type === 'callout' && b.kind === 'theorem')?.flags).toEqual([
      'keyResult',
    ]);
    expect(blocks.find((b) => b.status === 'excluded')).toMatchObject({
      excludedReason: 'crossedOut',
      lines: ['x = 7'],
    });
    const checked = ok('Hard to read $x^2$ {check}').doc.sections[0]?.blocks[0];
    expect(checked?.status).toBe('check');
  });

  it('parses examples with solutions, tables, lists and figures', () => {
    const { doc } = ok(`# S
::: example Factoring
Solve it.
Solution: $$ x = 1 $$
:::

- one
- two $x$

1. first
2. second

| a | b |
|---|---|
| 1 | 2 |

![A parabola](parabola-crop)
`);
    const blocks = doc.sections[0]?.blocks ?? [];
    expect(blocks.map((b) => b.type)).toEqual(['callout', 'list', 'list', 'table', 'figure']);
    expect(blocks[0]).toMatchObject({
      kind: 'example',
      title: 'Factoring',
      solution: { steps: [{ lines: ['x = 1'] }] },
    });
    expect(blocks[1]).toMatchObject({ ordered: false });
    expect(blocks[2]).toMatchObject({ ordered: true });
    expect(blocks[3]).toMatchObject({
      headerRow: true,
      rows: [
        [{}, {}],
        [{}, {}],
      ],
    });
    expect(blocks[4]).toMatchObject({
      figure: { kind: 'raster', assetRef: 'parabola-crop' },
      altText: 'A parabola',
      altTextConfirmed: true,
    });
  });

  it('reports mistakes with line numbers instead of guessing', () => {
    expect(errorOf('a\n\n::: problem\nSolve $x')).toMatchObject({ line: 4 });
    expect(errorOf('::: problem\nx\n')).toMatchObject({
      line: 1,
      message: expect.stringContaining('never closed'),
    });
    expect(errorOf('Solution: x')).toMatchObject({
      line: 1,
      message: expect.stringContaining('belongs inside'),
    });
    expect(errorOf('::: lemma\n:::')).toMatchObject({
      message: expect.stringContaining('unknown block'),
    });
    expect(errorOf('x {important}')).toMatchObject({
      message: expect.stringContaining('unknown tag'),
    });
    expect(errorOf('---\ndate: 20/10/2026\n---\n')).toMatchObject({
      message: expect.stringContaining('date'),
    });
    expect(errorOf('::: problem 5 apples\n:::')).toMatchObject({
      message: expect.stringContaining('points'),
    });
  });

  it('is deterministic', () => {
    expect(JSON.stringify(ok(example).doc)).toBe(JSON.stringify(ok(example).doc));
  });
});

describe('parseInlines', () => {
  it('splits text, math, bold and italic, and keeps escaped dollars as text', () => {
    expect(parseInlines('Cost \\$5 for **two** *nice* $x^2$ items')).toEqual([
      { kind: 'text', text: 'Cost $5 for ' },
      { kind: 'text', text: 'two', style: { bold: true } },
      { kind: 'text', text: ' ' },
      { kind: 'text', text: 'nice', style: { italic: true } },
      { kind: 'text', text: ' ' },
      { kind: 'math', latex: 'x^2' },
      { kind: 'text', text: ' items' },
    ]);
  });

  it('keeps backslash sequences inside math', () => {
    expect(parseInlines('$a \\$ b$')).toEqual([{ kind: 'math', latex: 'a \\$ b' }]);
  });
});
