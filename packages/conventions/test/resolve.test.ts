import { describe, expect, it } from 'vitest';
import { getParser } from '@unified-latex/unified-latex-util-parse';
import {
  DEFAULT_CONVENTIONS,
  PartialConventions,
  mathTransformsFor,
  resolveConventions,
} from '../src/index.js';

describe('resolveConventions', () => {
  it('applies preset, school, class and teacher layers, most specific last', () => {
    const { conventions, sources } = resolveConventions({
      preset: DEFAULT_CONVENTIONS,
      school: { paperSize: 'a4', decimalSeparator: 'comma', lang: 'es' },
      class: { fontSize: 12, decimalSeparator: 'point' },
      teacher: { fontSize: 14 },
    });
    expect(conventions).toMatchObject({
      paperSize: 'a4',
      decimalSeparator: 'point',
      fontSize: 14,
      lang: 'es',
    });
    expect(sources).toMatchObject({
      paperSize: 'school',
      decimalSeparator: 'class',
      fontSize: 'teacher',
      font: 'preset',
    });
  });

  it('stops the chain at a setting the school locks', () => {
    const { conventions, sources, locked } = resolveConventions({
      preset: DEFAULT_CONVENTIONS,
      school: { paperSize: 'a4' },
      schoolLocks: ['paperSize', 'font'],
      class: { paperSize: 'letter', font: 'pagella' },
      teacher: { paperSize: 'letter' },
    });
    expect(conventions.paperSize).toBe('a4');
    expect(conventions.font).toBe('latinModern');
    expect(sources.paperSize).toBe('school');
    expect(sources.font).toBe('preset');
    expect(locked).toEqual(['paperSize', 'font']);
  });

  it('does not share arrays with its inputs', () => {
    const header = ['course' as const];
    const { conventions } = resolveConventions({ preset: DEFAULT_CONVENTIONS, class: { header } });
    header.push('date' as never);
    expect(conventions.header).toEqual(['course']);
  });

  it('validates partial layers at the boundary', () => {
    expect(PartialConventions.safeParse({ fontSize: 13 }).success).toBe(false);
    expect(PartialConventions.safeParse({ fontSize: 14, units: 'plain' }).success).toBe(true);
  });
});

describe('math transforms', () => {
  it('are pure: they never mutate the input tree', () => {
    const parser = getParser({
      mode: 'math',
      macros: { vec: { signature: 'm', renderInfo: { inMathMode: true } } },
    });
    const nodes = parser.parse('\\vec{v} = 3.14 \\times r \\int x dx').content;
    const before = JSON.stringify(nodes);
    const transforms = mathTransformsFor({
      ...DEFAULT_CONVENTIONS,
      multiplicationSign: 'cdot',
      decimalSeparator: 'comma',
      vectors: 'bold',
      differentialD: 'upright',
    });
    let current = nodes;
    for (const t of transforms) current = t(current).nodes;
    expect(JSON.stringify(nodes)).toBe(before);
    expect(JSON.stringify(current)).not.toBe(before);
  });

  it('include only what the conventions ask for', () => {
    expect(mathTransformsFor(DEFAULT_CONVENTIONS)).toHaveLength(3);
  });
});
