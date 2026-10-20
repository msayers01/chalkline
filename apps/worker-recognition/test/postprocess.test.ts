import type { InkRegion } from '@chalkline/ink';
import { schema } from '@chalkline/ir';
import { describe, expect, it } from 'vitest';
import { displayLines, pieces, postprocessRegion, repairMath, statusFor } from '../src/index.js';

const region = (extra: Partial<InkRegion> = {}): InkRegion => ({
  id: '01JR0000000000000000000001',
  page: 2,
  strokes: [],
  bbox: { x: 10, y: 20, w: 300, h: 80 },
  t0: 1000,
  t1: 4000,
  color: 'black',
  ...extra,
});

const recognized = (text: string, confidence = 0.95) => ({
  kind: 'recognized' as const,
  recognition: {
    engine: 'mathpix-strokes' as const,
    response: { text, confidence: 0.4, confidence_rate: confidence },
  },
});

describe('pieces', () => {
  it('splits text, inline math and display math, and joins board lines of a paragraph', () => {
    expect(pieces('Solve \\( x^2 = 4 \\) for\nreal \\(x\\).\n\\[ x = \\pm 2 \\]')).toEqual([
      {
        kind: 'paragraph',
        runs: [
          { kind: 'text', text: 'Solve ' },
          { kind: 'math', latex: 'x^2 = 4' },
          { kind: 'text', text: ' for real ' },
          { kind: 'math', latex: 'x' },
          { kind: 'text', text: '.' },
        ],
      },
      { kind: 'display', lines: ['x = \\pm 2'] },
    ]);
  });

  it('treats math alone on a line as display math, and consecutive lines as one derivation', () => {
    expect(pieces('\\( 2x + 1 = 5 \\)\n\\( 2x = 4 \\)\n\nSo')).toEqual([
      { kind: 'display', lines: ['2x + 1 = 5', '2x = 4'] },
      { kind: 'paragraph', runs: [{ kind: 'text', text: 'So' }] },
    ]);
  });

  it('ends a paragraph at a blank line and keeps an unclosed delimiter as math', () => {
    expect(pieces('One.\n\nTwo \\( x +')).toEqual([
      { kind: 'paragraph', runs: [{ kind: 'text', text: 'One.' }] },
      {
        kind: 'paragraph',
        runs: [
          { kind: 'text', text: 'Two ' },
          { kind: 'math', latex: 'x +' },
        ],
      },
    ]);
    expect(pieces('')).toEqual([]);
    expect(pieces('a \\\\(b')).toEqual([
      { kind: 'paragraph', runs: [{ kind: 'text', text: 'a \\\\(b' }] },
    ]);
  });
});

describe('displayLines', () => {
  it('splits aligned and single-column arrays into lines without alignment points', () => {
    expect(displayLines('\\begin{aligned} x &= 1 + 1 \\\\ &= 2 \\end{aligned}')).toEqual([
      'x = 1 + 1',
      '= 2',
    ]);
    expect(displayLines('\\begin{array}{l} a=b \\\\[2pt] b=c \\end{array}')).toEqual([
      'a=b',
      'b=c',
    ]);
  });

  it('leaves multi-column arrays, nested breaks and single expressions alone', () => {
    const matrix = '\\begin{array}{cc} 1 & 2 \\\\ 3 & 4 \\end{array}';
    expect(displayLines(matrix)).toEqual([matrix]);
    expect(
      displayLines('\\begin{aligned} A = \\begin{pmatrix} 1 \\\\ 2 \\end{pmatrix} \\end{aligned}'),
    ).toEqual(['A = \\begin{pmatrix} 1 \\\\ 2 \\end{pmatrix}']);
    expect(displayLines('x^2')).toEqual(['x^2']);
    expect(displayLines('a = b \\\\ b = c')).toEqual(['a = b', 'b = c']);
  });
});

describe('repairMath', () => {
  it('leaves valid math as it is', () => {
    expect(repairMath('\\frac{1}{2}')).toEqual({ ok: true, latex: '\\frac{1}{2}', repairs: [] });
  });

  it('balances braces, drops unpaired \\left and \\right, and removes empty scripts', () => {
    expect(repairMath('\\frac{1}{2')).toMatchObject({
      ok: true,
      latex: '\\frac{1}{2}',
      repairs: ['braces'],
    });
    expect(repairMath('x}+1')).toMatchObject({ ok: true, latex: 'x+1' });
    expect(repairMath('\\left( x + 1 )')).toMatchObject({
      ok: true,
      latex: '( x + 1 )',
      repairs: ['leftRight'],
    });
    expect(repairMath('\\left. x \\right|_{0}^{1} + \\right)')).toMatchObject({ ok: true });
    expect(repairMath('x^{} + y_')).toMatchObject({
      ok: true,
      latex: 'x + y',
      repairs: ['emptyScripts'],
    });
  });

  it('never lets a repair through the allowlist', () => {
    expect(repairMath('\\input{x}')).toMatchObject({ ok: false });
    expect(repairMath('\\def\\a{1')).toMatchObject({ ok: false });
  });
});

describe('postprocessRegion', () => {
  it('keeps Key result and Exclude on every block of the region', () => {
    const result = postprocessRegion(
      { region: region(), tags: ['newSection', 'keyResult'] },
      recognized('Pythagoras\n\\[ a^2 + b^2 = c^2 \\]'),
    );
    expect(result.blocks.map((b) => b.tags)).toEqual([['newSection', 'keyResult'], ['keyResult']]);
  });

  it('turns a recognized region into leaf blocks with provenance and stable ids', () => {
    const input = { region: region({ color: 'blue' }), tags: ['problem' as const] };
    const result = postprocessRegion(input, recognized('1. Solve\n\\[ x^2 = 4 \\]'));
    expect(result.blocks).toHaveLength(2);
    const [text, math] = result.blocks.map((b) => b.block);
    expect(text).toMatchObject({
      type: 'paragraph',
      status: 'ready',
      inlines: [{ kind: 'text', text: '1. Solve', color: 'blue' }],
      provenance: { source: 'board', regionIds: [input.region.id], page: 2, t0: 1000, t1: 4000 },
      recognition: {
        engine: 'mathpix-strokes',
        confidence: 0.95,
        rawRef: `raw/${input.region.id}`,
      },
    });
    expect(math).toMatchObject({ type: 'displayMath', lines: ['x^2 = 4'], color: 'blue' });
    // Where something starts is the first block's tag only.
    expect(result.blocks.map((b) => b.tags)).toEqual([['problem'], []]);
    for (const b of result.blocks)
      expect(schema.ContentBlock.safeParse(b.block).success).toBe(true);
    // Same region, same ids: a retried job writes the same blocks.
    expect(postprocessRegion(input, recognized('1. Solve\n\\[ x^2 = 4 \\]')).blocks).toEqual(
      result.blocks,
    );
  });

  it('assigns Ready, Check and Image by confidence', () => {
    expect([0.9, 0.85, 0.7, 0.6, 0.59].map((c) => statusFor(c))).toEqual([
      'ready',
      'ready',
      'check',
      'check',
      'image',
    ]);
    const low = postprocessRegion({ region: region(), tags: [] }, recognized('x', 0.3));
    expect(low.blocks.map((b) => b.block)).toMatchObject([
      {
        type: 'imageFallback',
        status: 'image',
        reason: 'lowConfidence',
        assetRef: `region-${region().id}`,
      },
    ]);
  });

  it('falls back to an image when recognition failed, found nothing, or math will not sanitize', () => {
    const failed = postprocessRegion(
      { region: region(), tags: [] },
      { kind: 'failed', code: 'http_503' },
    );
    expect(failed.blocks[0]?.block).toMatchObject({
      type: 'imageFallback',
      reason: 'recognizerUnavailable',
    });
    const empty = postprocessRegion({ region: region(), tags: [] }, recognized('  \n '));
    expect(empty.blocks[0]?.block).toMatchObject({
      type: 'imageFallback',
      reason: 'lowConfidence',
    });
    const bad = postprocessRegion(
      { region: region(), tags: [] },
      recognized('Fine.\n\\[ \\input{x} \\]'),
    );
    expect(bad.blocks.map((b) => b.block.type)).toEqual(['paragraph', 'imageFallback']);
    expect(bad.blocks[1]?.block).toMatchObject({ reason: 'validationFailed', status: 'image' });
  });

  it('records repairs by block id', () => {
    const result = postprocessRegion(
      { region: region(), tags: [] },
      recognized('\\( \\frac{1}{2 \\)'),
    );
    expect(result.blocks[0]?.block).toMatchObject({ type: 'displayMath', lines: ['\\frac{1}{2}'] });
    expect(result.notes).toEqual([{ blockId: result.blocks[0]?.block.id, repairs: ['braces'] }]);
  });
});
