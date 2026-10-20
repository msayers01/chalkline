import { schema, type Doc, type DocMeta } from '@chalkline/ir';
import { ProviderError, type JsonModel, type JsonModelResult } from '@chalkline/providers';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  PARENT_ROLES,
  ROLES,
  buildDoc,
  checkOutput,
  detectLabel,
  heuristicStructure,
  normalize,
  plainTitle,
  stripLabel,
  structureItems,
  userMessage,
  type StructureItem,
  type StructureOutput,
} from '../src/index.js';
import { Board, inlinesOf } from './helpers.js';

const META: DocMeta = {
  title: 'Quadratics',
  course: 'Algebra II',
  teacher: 'Ms. Rivera',
  date: '2026-10-20',
  lang: 'en',
};
const IDENTITY = {
  id: '01JD0000000000000000000001',
  sessionId: '01JS0000000000000000000001',
  version: 1,
  meta: META,
};

const block = (
  id: string,
  role: StructureOutput['blocks'][number]['role'],
  parentId: string | null = null,
) => ({ id, role, parentId, personalName: false });

describe('labels', () => {
  it('finds the labels teachers write, in five languages', () => {
    const kinds = [
      '1. Solve',
      '12) Find',
      'Ex 2: Solve',
      'Problem 3 Find',
      'Q4. Why',
      '(a) x',
      'b) y',
      '(iii) z',
      'Solution: x',
      'Sol. x',
      'Answer: 3',
      'Ans 3',
      'Def. A set',
      'Theorem: Every',
      'Note: careful',
      'Example 2: Solve',
      'Ex: Solve',
      'Quiz on Friday',
      'Lösung: x',
      'Réponse : 4',
      'Definición: un',
      'Ejercicio 3. Resuelve',
      'Teorema: todo',
    ].map((text) => detectLabel(inlinesOf(text))?.kind);
    expect(kinds).toEqual([
      'problem',
      'problem',
      'problem',
      'problem',
      'problem',
      'part',
      'part',
      'part',
      'solution',
      'solution',
      'answer',
      'answer',
      'definition',
      'theorem',
      'note',
      'example',
      'example',
      'announcement',
      'solution',
      'answer',
      'definition',
      'problem',
      'theorem',
    ]);
  });

  it('does not mistake ordinary text for a label', () => {
    for (const text of [
      '3.5 is the answer',
      'Solve for x',
      'Notes are online',
      'Answering',
      'Test the series',
      'Define f',
    ]) {
      expect(detectLabel(inlinesOf(text)), text).toBeUndefined();
    }
    expect(detectLabel(inlinesOf('$x$ is 1'))).toBeUndefined();
  });

  it('strips the label of the block role and points from problems', () => {
    expect(stripLabel(inlinesOf('3. Solve $x^2=4$. (5 points)'), 'problem')).toEqual({
      inlines: [
        { kind: 'text', text: 'Solve ' },
        { kind: 'math', latex: 'x^2=4' },
        { kind: 'text', text: '.' },
      ],
      points: 5,
      labelOnly: false,
    });
    // A label for another role stays.
    expect(stripLabel(inlinesOf('Solution: x'), 'answer').inlines).toEqual(
      inlinesOf('Solution: x'),
    );
    expect(stripLabel(inlinesOf('Solution:'), 'solution')).toEqual({
      inlines: inlinesOf('Solution:'),
      labelOnly: true,
    });
    expect(stripLabel(inlinesOf('(b) $x$'), 'part').inlines).toEqual([
      { kind: 'math', latex: 'x' },
    ]);
  });
});

describe('guards', () => {
  const items = new Board().text('1. Solve').text('(a) x').text('Solution: y').items();
  const valid: StructureOutput = {
    sections: [{ title: 'Practice', blockIds: ['b1'] }],
    blocks: [block('b1', 'problem'), block('b2', 'part', 'b1'), block('b3', 'solution', 'b2')],
    excluded: [],
  };

  it('accepts a response that uses every id once with valid parents and sections', () => {
    expect(checkOutput(valid, items)).toEqual([]);
  });

  it('rejects missing, repeated and invented ids', () => {
    expect(
      checkOutput(
        {
          ...valid,
          blocks: [block('b1', 'problem'), block('b9', 'content')],
          excluded: [{ id: 'b1', reason: 'crossedOut' }],
          sections: [{ title: null, blockIds: ['b1', 'b9'] }],
        },
        items,
      ),
    ).toEqual(['b1 is used 2 times', 'unknown id "b9"', 'b2 is missing', 'b3 is missing']);
  });

  it('rejects parents that do not exist or cannot hold the block', () => {
    const problems = checkOutput(
      {
        sections: [{ title: null, blockIds: ['b2'] }],
        blocks: [block('b1', 'problem', 'b2'), block('b2', 'part'), block('b3', 'answer', 'zz')],
        excluded: [],
      },
      items,
    );
    expect(problems).toEqual([
      'b1 (problem) cannot be inside b2 (part)',
      'b2 (part) needs a parent',
      'b3 has parent "zz", which is not a placed block',
    ]);
  });

  it('rejects sections that miss, repeat or list nested blocks', () => {
    expect(
      checkOutput(
        {
          ...valid,
          sections: [
            { title: null, blockIds: ['b2'] },
            { title: null, blockIds: [] },
          ],
        },
        items,
      ),
    ).toEqual(['a section lists "b2", which is not a top-level block', 'b1 is in 0 sections']);
  });

  it('turns titles into one short line of plain text', () => {
    expect(plainTitle('Solving $x^2 = 4$ \\textbf{fast}')).toBe('Solving x 2 = 4 fast');
    expect(plainTitle('  Limits\u0007 and continuity.  ')).toBe('Limits and continuity');
    expect(plainTitle('$$')).toBeUndefined();
    expect(plainTitle(null)).toBeUndefined();
    const long = plainTitle('word '.repeat(40));
    expect(long?.length).toBeLessThanOrEqual(80);
    expect(long?.endsWith('word')).toBe(true);
  });
});

describe('normalize', () => {
  it('lets teacher tags win over the structurer', () => {
    const board = new Board()
      .text('Find the roots', { tags: ['problem'] })
      .math('x = 2', { tags: ['solution'] })
      .text('scribble', { tags: ['exclude'] });
    const items = board.items();
    const s = normalize(
      {
        sections: [{ title: null, blockIds: ['b1', 'b2'] }],
        blocks: [block('b1', 'content'), block('b2', 'content')],
        excluded: [{ id: 'b3', reason: 'crossedOut' }],
      },
      items,
      'ai',
    );
    const id = (i: number) => items[i]?.block.id ?? '';
    expect(s.placements.get(id(0))).toEqual({
      role: 'problem',
      parentId: null,
      typeBy: 'teacherTag',
    });
    expect(s.placements.get(id(1))).toEqual({
      role: 'solution',
      parentId: id(0),
      typeBy: 'teacherTag',
    });
    expect(s.excluded.get(id(2))).toBe('teacher');
    expect(s.sections).toEqual([{ ids: [id(0)] }]);
  });

  it('keeps what the teacher placed, and holds back personal names', () => {
    const board = new Board().text('Great work, Maya').text('1. Solve').math('x = 1');
    const items: StructureItem[] = board.items();
    const pinned = items[2];
    if (pinned) pinned.pinned = { role: 'content', parentId: items[1]?.block.id ?? null };
    const s = normalize(
      {
        sections: [{ title: null, blockIds: ['b1', 'b2', 'b3'] }],
        blocks: [
          { ...block('b1', 'content'), personalName: true },
          block('b2', 'problem'),
          block('b3', 'content'),
        ],
        excluded: [],
      },
      items,
      'ai',
    );
    expect(s.excluded.get(items[0]?.block.id ?? '')).toBe('personalData');
    expect(s.personal.has(items[0]?.block.id ?? '')).toBe(true);
    expect(s.placements.get(items[2]?.block.id ?? '')).toMatchObject({
      role: 'content',
      parentId: items[1]?.block.id,
      typeBy: 'teacher',
    });
  });

  it('repairs roles that do not fit the block or its parent', () => {
    const items = new Board()
      .text('1. Problem')
      .image()
      .text('Solution: a')
      .text('Solution: b')
      .text('Answer: 1')
      .text('Answer: 2')
      .text('A drawing?')
      .items();
    const s = normalize(
      {
        sections: [{ title: null, blockIds: ['b1', 'b7'] }],
        blocks: [
          block('b1', 'problem'),
          block('b2', 'answer', 'b1'),
          block('b3', 'solution', 'b1'),
          block('b4', 'solution', 'b1'),
          block('b5', 'answer', 'b1'),
          block('b6', 'answer', 'b1'),
          block('b7', 'figure'),
        ],
        excluded: [],
      },
      items,
      'ai',
    );
    const roles = items.map((i) => {
      const p = s.placements.get(i.block.id);
      return [p?.role, items.find((x) => x.block.id === p?.parentId)?.local ?? null];
    });
    expect(roles).toEqual([
      ['problem', null],
      ['content', 'b1'], // an image cannot be an answer
      ['solution', 'b1'],
      ['content', 'b3'], // a second solution continues the first
      ['answer', 'b1'],
      ['content', 'b3'], // so does a second answer
      ['content', null], // only images are figures
    ]);
  });

  it('starts sections at New section tags and headings, with the heading as title', () => {
    const items = new Board()
      .text('Intro')
      .text('Quadratics')
      .text('More')
      .text('Practice', { tags: ['newSection'] })
      .items();
    const s = normalize(
      {
        sections: [{ title: 'Warm-up', blockIds: ['b1', 'b2', 'b3', 'b4'] }],
        blocks: [
          block('b1', 'content'),
          block('b2', 'heading'),
          block('b3', 'content'),
          block('b4', 'content'),
        ],
        excluded: [],
      },
      items,
      'ai',
    );
    const id = (i: number) => items[i]?.block.id ?? '';
    expect(s.sections).toEqual([
      { title: 'Warm-up', ids: [id(0)] },
      { headingId: id(1), ids: [id(2)] },
      { ids: [id(3)] },
    ]);
  });
});

describe('heuristicStructure', () => {
  it('reads a labelled board into problems, parts, solutions and callouts', () => {
    const board = new Board()
      .text('Factoring', { tags: ['newSection'] })
      .text('Definition: a root is a zero of $f$.')
      .text('1. Solve by factoring.')
      .text('(a) $x^2 - 9 = 0$')
      .math('(x-3)(x+3) = 0')
      .text('Answer: $x = \\pm 3$')
      .text('(b) $x^2 = 4$')
      .text('Solution:')
      .math('x = \\pm 2', { sameRegion: true })
      .text('2. Find the vertex')
      .math('y = (x - 1)^2', { sameRegion: true })
      .math('vertex (1, 0)')
      .text('Quiz on Friday!');
    const items = board.items();
    const output = heuristicStructure(items);
    expect(checkOutput(output, items)).toEqual([]);
    expect(output.blocks.map((b) => [b.id, b.role, b.parentId])).toEqual([
      ['b1', 'heading', null],
      ['b2', 'definition', null],
      ['b3', 'problem', null],
      ['b4', 'part', 'b3'],
      ['b5', 'solution', 'b4'],
      ['b6', 'answer', 'b4'],
      ['b7', 'part', 'b3'],
      ['b8', 'solution', 'b7'],
      ['b9', 'content', 'b8'],
      ['b10', 'problem', null],
      ['b11', 'content', 'b10'], // written with the statement
      ['b12', 'solution', 'b10'],
      ['b13', 'announcement', null],
    ]);
  });

  it('always satisfies the guards', () => {
    const texts = [
      '1. A',
      '(a) b',
      'Solution: c',
      'Answer: d',
      'Example: e',
      'Note: f',
      'plain',
      'Quiz g',
    ];
    const tags = [
      [],
      [],
      ['problem'],
      ['solution'],
      ['newSection'],
      ['exclude'],
      ['keyResult'],
    ] as const;
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            text: fc.constantFrom(...texts),
            tags: fc.constantFrom(...tags),
            same: fc.boolean(),
            image: fc.boolean(),
            page: fc.integer({ min: 0, max: 2 }),
          }),
          { maxLength: 30 },
        ),
        (specs) => {
          const board = new Board();
          for (const spec of specs) {
            const opts = { tags: [...spec.tags], sameRegion: spec.same, page: spec.page };
            if (spec.image) board.image(opts);
            else board.text(spec.text, opts);
          }
          const items = board.items();
          expect(checkOutput(heuristicStructure(items), items)).toEqual([]);
        },
      ),
    );
  });
});

describe('normalize and buildDoc on any response', () => {
  it('produce a valid document holding every block exactly once', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 14 }).chain((n) =>
          fc.record({
            n: fc.constant(n),
            roles: fc.array(fc.constantFrom(...ROLES), { minLength: n, maxLength: n }),
            parents: fc.array(fc.integer({ min: -1, max: n - 1 }), { minLength: n, maxLength: n }),
            excluded: fc.array(fc.boolean(), { minLength: n, maxLength: n }),
            breaks: fc.array(fc.boolean(), { minLength: n, maxLength: n }),
            kinds: fc.array(fc.constantFrom('text', 'label', 'math', 'image'), {
              minLength: n,
              maxLength: n,
            }),
            tags: fc.array(
              fc.constantFrom(
                [],
                ['problem'],
                ['solution'],
                ['exclude'],
                ['newSection'],
                ['keyResult'],
              ),
              {
                minLength: n,
                maxLength: n,
              },
            ),
          }),
        ),
        ({ n, roles, parents, excluded, breaks, kinds, tags }) => {
          const board = new Board();
          for (let i = 0; i < n; i += 1) {
            const opts = { tags: [...(tags[i] ?? [])] };
            const kind = kinds[i];
            if (kind === 'math') board.math('x = 1', opts);
            else if (kind === 'image') board.image(opts);
            else board.text(kind === 'label' ? 'Solution:' : 'Some text', opts);
          }
          const items = board.items();
          const local = (i: number) => `b${i + 1}`;
          const output: StructureOutput = { sections: [], blocks: [], excluded: [] };
          for (let i = 0; i < n; i += 1) {
            if (excluded[i]) {
              output.excluded.push({ id: local(i), reason: 'crossedOut' });
              continue;
            }
            const p = parents[i] ?? -1;
            output.blocks.push(block(local(i), roles[i] ?? 'content', p < 0 ? null : local(p)));
            if (p < 0) {
              if (breaks[i] || output.sections.length === 0)
                output.sections.push({ title: 'T', blockIds: [] });
              output.sections[output.sections.length - 1]?.blockIds.push(local(i));
            }
          }
          const structure = normalize(output, items, 'ai');
          for (const p of structure.placements.values()) {
            const parentRole =
              p.parentId === null ? null : (structure.placements.get(p.parentId)?.role ?? null);
            expect(PARENT_ROLES[p.role]).toContain(parentRole);
          }
          const doc = buildDoc(structure, items, IDENTITY);
          expect(schema.Doc.safeParse(doc).success).toBe(true);
          const ids = leafIds(doc);
          // Every leaf exactly once, except headings (now section titles) and label-only heads.
          expect(new Set(ids).size).toBe(ids.length);
          for (const item of items) {
            const placed = structure.placements.get(item.block.id);
            const labelOnly =
              placed?.role === 'solution' &&
              item.block.type === 'paragraph' &&
              item.block.inlines[0]?.kind === 'text' &&
              item.block.inlines[0].text === 'Solution:';
            const dropped = placed?.role === 'heading' || labelOnly;
            if (!dropped) expect(ids).toContain(item.block.id);
          }
        },
      ),
      { numRuns: 300 },
    );
  });
});

function leafIds(doc: Doc): string[] {
  const out: string[] = [];
  const visit = (b: Record<string, unknown> & { id: string; type: string }) => {
    const kids = (['prompt', 'parts', 'steps', 'body'] as const).flatMap(
      (k) => (b[k] as (typeof b)[] | undefined) ?? [],
    );
    const nested = (['solution', 'answer'] as const)
      .map((k) => b[k] as typeof b | undefined)
      .filter((x) => x !== undefined);
    if (
      kids.length === 0 &&
      nested.length === 0 &&
      !['problem', 'part', 'solution', 'callout'].includes(b.type)
    ) {
      out.push(b.id);
    }
    [...kids, ...nested].forEach(visit);
  };
  for (const s of doc.sections) for (const b of s.blocks) visit(b as never);
  return out;
}

describe('structureItems', () => {
  const items = new Board().text('1. Solve').math('x = 2').items();
  const good: StructureOutput = {
    sections: [{ title: null, blockIds: ['b1'] }],
    blocks: [block('b1', 'problem'), block('b2', 'solution', 'b1')],
    excluded: [],
  };
  const bad: StructureOutput = { ...good, blocks: [block('b1', 'problem')] };

  class Scripted implements JsonModel {
    readonly requests: { model: string; user: string; effort: string }[] = [];
    constructor(private readonly results: (JsonModelResult<StructureOutput> | Error)[]) {}
    complete(request: { model: string; user: string; effort: string }) {
      this.requests.push(request);
      const next = this.results.shift();
      if (next instanceof Error) return Promise.reject(next);
      return Promise.resolve(next as never);
    }
  }

  it('uses the fast model during class and the final model at the end', async () => {
    const model = new Scripted([
      { kind: 'ok', output: good },
      { kind: 'ok', output: good },
    ]);
    const incremental = await structureItems(items, { model, pass: 'incremental', meta: META });
    const final = await structureItems(items, { model, pass: 'final', meta: META });
    expect(incremental.report).toEqual({
      by: 'ai',
      model: 'claude-haiku-5-5',
      attempts: 1,
      violations: 0,
    });
    expect(final.report.model).toBe('claude-sonnet-5-5');
    expect(model.requests.map((r) => r.effort)).toEqual(['low', 'medium']);
    expect(incremental.structure.by).toBe('ai');
  });

  it('retries once with the guard problems, then falls back to the heuristic', async () => {
    const model = new Scripted([
      { kind: 'ok', output: bad },
      { kind: 'ok', output: good },
    ]);
    const retried = await structureItems(items, { model, pass: 'final', meta: META });
    expect(retried.report).toMatchObject({ by: 'ai', attempts: 2, violations: 1 });
    expect(JSON.parse(model.requests[1]?.user ?? '{}')).toMatchObject({
      previousAttemptProblems: ['b2 is missing'],
    });

    const twice = new Scripted([
      { kind: 'ok', output: bad },
      { kind: 'invalid', reason: 'maxTokens' },
    ]);
    expect(
      (await structureItems(items, { model: twice, pass: 'final', meta: META })).report,
    ).toMatchObject({
      by: 'heuristic',
      attempts: 2,
      fallback: 'invalid',
    });
  });

  it('falls back to the heuristic on refusal, provider errors, no model and no blocks', async () => {
    const refused = new Scripted([{ kind: 'refused', category: null }]);
    expect(
      (await structureItems(items, { model: refused, pass: 'incremental', meta: META })).report,
    ).toMatchObject({
      by: 'heuristic',
      fallback: 'refused',
    });
    const down = new Scripted([new ProviderError('anthropic', 'server_error', true)]);
    expect(
      (await structureItems(items, { model: down, pass: 'final', meta: META })).report.fallback,
    ).toBe('unavailable');
    expect((await structureItems(items, { pass: 'final', meta: META })).report.fallback).toBe(
      'noModel',
    );
    expect(
      (await structureItems([], { model: refused, pass: 'final', meta: META })).report.fallback,
    ).toBe('empty');
    await expect(
      structureItems(items, {
        model: new Scripted([new TypeError('bug')]),
        pass: 'final',
        meta: META,
      }),
    ).rejects.toThrow('bug');
  });

  it('sends board content as data, clipped, with local ids only', () => {
    const long = new Board().text('x'.repeat(1000), { tags: ['keyResult'] }).items();
    const message = JSON.parse(userMessage(long, META)) as { blocks: Record<string, unknown>[] };
    expect(message.blocks[0]).toMatchObject({
      id: 'b1',
      kind: 'text',
      tags: ['keyResult'],
      page: 0,
    });
    expect(String(message.blocks[0]?.content).length).toBeLessThan(420);
    expect(JSON.stringify(message)).not.toContain(long[0]?.block.id);
    expect(JSON.stringify(message)).not.toContain(META.teacher);
  });
});
