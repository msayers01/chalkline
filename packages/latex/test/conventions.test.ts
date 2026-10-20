import { DEFAULT_CONVENTIONS, mathTransformsFor, type Conventions } from '@chalkline/conventions';
import { describe, expect, it } from 'vitest';
import { sanitizeMath } from '../src/safe/index.js';

function render(input: string, overrides: Partial<Conventions>) {
  const r = sanitizeMath(input, {
    transforms: mathTransformsFor({ ...DEFAULT_CONVENTIONS, ...overrides }),
  });
  if (!r.ok) throw new Error(`rejected: ${r.error.code}`);
  return {
    latex: r.latex as string,
    applied: r.applied.map((n) => n.detail),
    suggested: r.suggestions.map((n) => n.detail),
  };
}

describe('multiplication sign', () => {
  it('switches between cdot and times between ordinary operands', () => {
    expect(render('A = 3 \\times r^2', { multiplicationSign: 'cdot' })).toMatchObject({
      latex: 'A = 3 \\cdot r^{2}',
      applied: ['timesToCdot'],
    });
    expect(render('2 \\cdot 10^3', { multiplicationSign: 'times' }).latex).toBe('2 \\times 10^{3}');
  });

  it('only suggests a change between vectors, where it would change the product', () => {
    expect(render('\\vec{a} \\cdot \\vec{b}', { multiplicationSign: 'times' })).toMatchObject({
      latex: '\\vec{a}\\cdot \\vec{b}',
      applied: [],
      suggested: ['vectorProduct'],
    });
  });

  it('leaves operators without two operands alone', () => {
    expect(render('f(\\cdot)', { multiplicationSign: 'times' }).latex).toBe('f(\\cdot)');
    expect(render('a = \\cdot b', { multiplicationSign: 'times' }).latex).toBe('a = \\cdot b');
    expect(render('(a+b) \\times \\frac{1}{2}', { multiplicationSign: 'cdot' }).latex).toBe(
      '(a+b) \\cdot \\frac{1}{2}',
    );
  });

  it('leaves math as written by default', () => {
    expect(render('3 \\times 4 \\cdot 5', {}).latex).toBe('3 \\times 4 \\cdot 5');
  });
});

describe('decimal separator', () => {
  it('converts decimal points between digits to a braced comma', () => {
    expect(render('h = -4.9t^2 + 19.6t', { decimalSeparator: 'comma' })).toMatchObject({
      latex: 'h = -4{,}9t^{2} + 19{,}6t',
      applied: ['pointToComma', 'pointToComma'],
    });
  });

  it('converts braced commas back to points', () => {
    expect(render('3{,}14', { decimalSeparator: 'point' }).latex).toBe('3.14');
  });

  it('never touches list commas or sentence points', () => {
    expect(render('(1,2) \\text{ and } x.', { decimalSeparator: 'comma' }).latex).toBe(
      '(1,2) \\text{ and }x.',
    );
    expect(render('(1,2)', { decimalSeparator: 'point' })).toMatchObject({
      latex: '(1,2)',
      suggested: [],
    });
  });

  it('does not reach into text arguments', () => {
    expect(render('\\text{3.5 m}', { decimalSeparator: 'comma' }).latex).toBe('\\text{3.5 m}');
  });
});

describe('vectors', () => {
  it('turns arrows on single symbols into bold', () => {
    expect(render('\\vec{v} = \\vec{v}_0 + \\vec{\\omega} t', { vectors: 'bold' }).latex).toBe(
      '\\mathbf{v}= \\mathbf{v}_{0} + \\boldsymbol{\\omega}t',
    );
  });

  it('only suggests bold for multi-letter arrows and arrows for bold', () => {
    expect(render('\\overrightarrow{AB}', { vectors: 'bold' })).toMatchObject({
      latex: '\\overrightarrow{AB}',
      suggested: ['arrowToBold'],
    });
    expect(render('\\mathbf{F} = m\\mathbf{a}', { vectors: 'arrow' })).toMatchObject({
      latex: '\\mathbf{F}= m\\mathbf{a}',
      applied: [],
      suggested: ['boldToArrow', 'boldToArrow'],
    });
  });
});

describe('derivatives', () => {
  it('only ever suggests a notation change', () => {
    expect(render('\\frac{dy}{dx} = 2x', { derivatives: 'prime' })).toMatchObject({
      latex: '\\frac{dy}{dx}= 2x',
      applied: [],
      suggested: ['leibnizToPrime'],
    });
    expect(render("f'(x)", { derivatives: 'leibniz' })).toMatchObject({
      latex: "f'(x)",
      suggested: ['primeToLeibniz'],
    });
  });
});

describe('differential d', () => {
  it('sets d upright in Leibniz fractions and after integrals', () => {
    expect(render('\\frac{d^2y}{dx^2}', { differentialD: 'upright' }).latex).toBe(
      '\\frac{\\mathrm{d}^{2}y}{\\mathrm{d}x^{2}}',
    );
    expect(render('\\int_0^1 x^2 dx = \\frac{1}{3}', { differentialD: 'upright' }).latex).toBe(
      '\\int_{0}^{1} x^{2} \\mathrm{d}x = \\frac{1}{3}',
    );
    expect(render('\\iint f \\, dx \\, dy', { differentialD: 'upright' }).latex).toBe(
      '\\iint f \\, \\mathrm{d}x \\, \\mathrm{d}y',
    );
  });

  it('turns upright d back to italic', () => {
    expect(render('\\int x \\, \\mathrm{d}x', { differentialD: 'italic' }).latex).toBe(
      '\\int x \\, dx',
    );
    expect(render('\\frac{\\mathrm{d}}{\\mathrm{d}t}', { differentialD: 'italic' }).latex).toBe(
      '\\frac{d}{dt}',
    );
  });

  it('leaves a d that is not a differential alone', () => {
    expect(render('d = 5', { differentialD: 'upright' }).latex).toBe('d = 5');
    expect(render('a + d x', { differentialD: 'upright' }).latex).toBe('a + d x');
    expect(render('\\int xdx', { differentialD: 'upright' }).latex).toBe('\\int xdx');
    expect(render('\\frac{d+1}{dx}', { differentialD: 'upright' }).latex).toBe('\\frac{d+1}{dx}');
  });
});
