import {
  applyPatch,
  schema,
  type AnyBlock,
  type ContentBlock,
  type Doc,
  type Inline,
} from '@chalkline/ir';
import { parseLesson } from '@chalkline/lesson';
import { ProviderError, type StrokeRecognizer } from '@chalkline/providers';
import { BUILT_IN_PRESETS, renderWithPreset, type PresetId } from '@chalkline/presets';
import { describe, expect, it } from 'vitest';
import {
  bisect,
  probeKey,
  recognizeRegions,
  simulateSession,
  structureSession,
  validateBlocks,
  type BoardBlock,
  type ProbeCompile,
} from '../src/index.js';
import { Board } from './helpers.js';

const LESSON = String.raw`---
title: Solving quadratic equations
course: Algebra II, Period 3
teacher: Ms. Rivera
date: 2026-10-20
lang: en
---

# Quadratic equations

Today we solve equations of the form $ax^2 + bx + c = 0$ where $a \neq 0$.

::: definition
A quadratic equation is a polynomial equation of degree 2.
:::

::: theorem {key}
$$ x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a} $$
:::

::: example
Solve $x^2 - 5x + 6 = 0$.
Solution:
$$
x^2 - 5x + 6 = 0
(x - 2)(x - 3) = 0
$$
So $x = 2$ or $x = 3$.
:::

::: announcement
Quiz on Friday: sections 4.1 to 4.3.
:::

# Practice

::: problem
Solve by factoring.
(a) $x^2 + 7x + 12 = 0$
Solution: $$ (x + 3)(x + 4) = 0 $$
Answer: $x = -3$ or $x = -4$
(b) $x^2 - 9 = 0$
Answer: $x = \pm 3$
:::

::: problem 5 points
Use the quadratic formula to solve $2x^2 - 4x - 1 = 0$.
Solution:
$$
x = \frac{4 \pm \sqrt{16 + 8}}{4}
x = \frac{2 \pm \sqrt{6}}{2}
$$
Answer: $x = 1 \pm \frac{\sqrt{6}}{2}$
:::

A note for later. {excluded}
`;

/** Crossed-out work only the model can recognize as such. */
const CROSSED_OUT = '\n$$ x = 7 $$ {crossed-out}\n';

function lesson(source: string): Doc {
  const parsed = parseLesson(source);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
  return parsed.doc;
}

const identity = (doc: Doc) => ({
  id: '01JD0000000000000000000001',
  sessionId: '01JS0000000000000000000001',
  version: 1,
  meta: doc.meta,
});

/** The structure of a document, as text: what the review screen and presets see. */
function shape(doc: Doc): unknown {
  return doc.sections.map((s) => ({
    title: s.title,
    blocks: s.blocks.filter((b) => b.status !== 'excluded').map(blockShape),
  }));
}

function blockShape(block: AnyBlock): unknown {
  switch (block.type) {
    case 'problem':
      return {
        problem: block.prompt.map(blockShape),
        parts: block.parts.map(blockShape),
        solution: block.solution?.steps.map(blockShape),
        answer: block.answer ? text(block.answer.inlines) : undefined,
        points: block.points,
      };
    case 'part':
      return {
        part: block.prompt.map(blockShape),
        solution: block.solution?.steps.map(blockShape),
        answer: block.answer ? text(block.answer.inlines) : undefined,
      };
    case 'callout':
      return {
        [block.kind]: block.body.map(blockShape),
        solution: block.solution?.steps.map(blockShape),
        key: block.flags?.includes('keyResult') ?? false,
      };
    case 'paragraph':
      return text(block.inlines);
    case 'displayMath':
      return block.lines;
    default:
      return block.type;
  }
}

const text = (inlines: readonly Inline[]) =>
  inlines.map((i) => (i.kind === 'text' ? i.text : `$${i.latex}$`)).join('');

async function runSession(source: string, withModel: boolean, previous?: Doc) {
  const doc = lesson(source);
  const session = simulateSession(doc);
  const recognized = await recognizeRegions(session.regions, session.recognizer);
  const result = await structureSession({
    blocks: recognized.blocks,
    identity: identity(doc),
    pass: 'final',
    ...(withModel ? { model: session.oracle } : {}),
    ...(previous ? { previous } : {}),
  });
  return { lesson: doc, session, recognized, ...result };
}

describe('a simulated board session', () => {
  it('writes one region per statement or step, through the real region grouper', async () => {
    const { session, recognized } = await runSession(LESSON, true);
    expect(session.regions).toHaveLength(session.writes.length);
    expect(recognized.reports.every((r) => r.failure === undefined && r.chunks === 1)).toBe(true);
  });

  it('comes out with the lesson structure when the model structures it', async () => {
    const result = await runSession(LESSON + CROSSED_OUT, true);
    expect(result.report.structure).toMatchObject({ by: 'ai', attempts: 1 });
    expect(shape(result.doc)).toEqual(shape(result.lesson));
    expect(schema.Doc.safeParse(result.doc).success).toBe(true);
    // The crossed-out line and the teacher's exclusion are kept, excluded, for review.
    const excluded = result.doc.sections
      .flatMap((s) => s.blocks)
      .filter((b) => b.status === 'excluded');
    expect(excluded.map((b) => b.excludedReason).sort()).toEqual(['crossedOut', 'teacher']);
  });

  it('comes out with the same structure from the heuristic structurer when the board is labelled', async () => {
    const result = await runSession(LESSON, false);
    expect(result.report.structure).toMatchObject({ by: 'heuristic', fallback: 'noModel' });
    expect(shape(result.doc)).toEqual(shape(result.lesson));
  });

  it('renders and keeps ids stable across passes', async () => {
    const first = await runSession(LESSON, true);
    const second = await runSession(LESSON, true);
    expect(second.doc).toEqual(first.doc);
    for (const preset of Object.keys(BUILT_IN_PRESETS) as PresetId[]) {
      const rendering = renderWithPreset(first.doc, preset);
      expect(rendering.issues).toEqual([]);
      expect(rendering.tex).toContain('\\begin{document}');
    }
  });

  it('keeps teacher edits through the next structuring pass', async () => {
    const first = await runSession(LESSON, true);
    const doc = first.doc;
    const problem = doc.sections[1]?.blocks.find((b) => b.type === 'problem');
    const step = doc.sections[0]?.blocks.find((b) => b.type === 'callout' && b.kind === 'example');
    const paragraph = doc.sections[0]?.blocks.find((b) => b.type === 'paragraph');
    if (!problem || problem.type !== 'problem' || !paragraph || !step) throw new Error('fixture');
    const patched = applyPatch(doc, {
      id: '01JP0000000000000000000001',
      at: 0,
      docId: doc.id,
      baseVersion: doc.version,
      actor: { kind: 'teacher', userId: '01JU0000000000000000000001' },
      ops: [
        {
          op: 'setInlines',
          blockId: paragraph.id,
          inlines: [{ kind: 'text', text: 'Edited by the teacher.' }],
        },
        { op: 'setPoints', blockId: problem.id, points: 7 },
        { op: 'exclude', blockId: step.id, reason: 'teacher' },
      ],
    });
    if (!patched.ok) throw new Error(JSON.stringify(patched.error));

    const again = await runSession(LESSON, true, patched.doc);
    const blocks = again.doc.sections.flatMap((s) => s.blocks);
    expect(blocks.find((b) => b.id === paragraph.id)).toMatchObject({
      inlines: [{ kind: 'text', text: 'Edited by the teacher.' }],
    });
    expect(blocks.find((b) => b.id === problem.id)).toMatchObject({ points: 7 });
    expect(blocks.find((b) => b.id === step.id)).toMatchObject({
      status: 'excluded',
      excludedReason: 'teacher',
    });
  });

  it('puts typed blocks back where the teacher inserted them', async () => {
    const first = await runSession(LESSON, true);
    const doc = first.doc;
    const section = doc.sections[1];
    if (!section) throw new Error('fixture');
    const typed: ContentBlock = {
      id: '01JTYPED000000000000000001',
      type: 'paragraph',
      status: 'ready',
      provenance: {
        source: 'typed',
        regionIds: [],
        page: 0,
        bbox: { x: 0, y: 0, w: 0, h: 0 },
        t0: 0,
        t1: 0,
      },
      decided: { typeBy: 'teacher', pinned: true },
      inlines: [{ kind: 'text', text: 'Show your work.' }],
    };
    const patched = applyPatch(doc, {
      id: '01JP0000000000000000000001',
      at: 0,
      docId: doc.id,
      baseVersion: doc.version,
      actor: { kind: 'teacher', userId: '01JU0000000000000000000001' },
      ops: [{ op: 'insertBlock', sectionId: section.id, index: 0, block: typed }],
    });
    if (!patched.ok) throw new Error(JSON.stringify(patched.error));
    const again = await runSession(LESSON, true, patched.doc);
    expect(again.doc.sections[1]?.blocks[0]?.id).toBe(typed.id);
  });
});

describe('recognizeRegions', () => {
  it('turns recognizer failures into images and says whether to retry', async () => {
    const session = simulateSession(lesson(LESSON));
    const failing: StrokeRecognizer = {
      recognizeStrokes: () => Promise.reject(new ProviderError('mathpix', 'http_503', true)),
    };
    const result = await recognizeRegions(session.regions.slice(0, 2), failing);
    expect(result.reports.map((r) => r.failure)).toEqual([
      { code: 'http_503', retryable: true },
      { code: 'http_503', retryable: true },
    ]);
    expect(result.blocks.map((b) => b.block)).toMatchObject([
      { type: 'imageFallback', reason: 'recognizerUnavailable' },
      { type: 'imageFallback', reason: 'recognizerUnavailable' },
    ]);
    const broken: StrokeRecognizer = {
      recognizeStrokes: () => Promise.reject(new TypeError('bug')),
    };
    await expect(recognizeRegions(session.regions.slice(0, 1), broken)).rejects.toThrow('bug');
  });
});

describe('the compile probe', () => {
  it('bisects to the failing items', async () => {
    let calls = 0;
    const compiles = (bad: number[]) => async (items: readonly number[]) => {
      calls += 1;
      return !items.some((i) => bad.includes(i));
    };
    const items = Array.from({ length: 16 }, (_, i) => i);
    expect(await bisect(items, compiles([]))).toEqual([]);
    expect(calls).toBe(1);
    calls = 0;
    expect(await bisect(items, compiles([11]))).toEqual([11]);
    expect(calls).toBeLessThanOrEqual(1 + 2 * 4);
    expect(await bisect(items, compiles([0, 15]))).toEqual([0, 15]);
    // Failing only together: the whole batch counts as failing.
    const pair = async (xs: readonly number[]) => !(xs.includes(3) && xs.includes(12));
    expect(await bisect(items, pair)).toEqual(items);
  });

  const placeholder = new Uint8Array([137, 80, 78, 71]);
  const board = () =>
    new Board().text('No math here').math('x = 1').math('\\frac{1}{2}').text('Inline $y = 2$');

  it('turns blocks whose math breaks the compile into images of their region', async () => {
    const blocks = board().blocks;
    const jobs: string[] = [];
    // A stand-in compiler that fails on one particular expression.
    const compile: ProbeCompile = async (job) => {
      jobs.push(job.tex);
      return job.tex.includes('\\frac{1}{2}') ? 'failed' : 'ok';
    };
    const result = await validateBlocks(blocks, { compile, placeholder });
    expect(result.report).toMatchObject({ probed: 3, failed: [blocks[2]?.block.id] });
    expect(result.report.validated).toEqual(
      [blocks[1], blocks[3]].map((b) => probeKey((b as BoardBlock).block)),
    );
    expect(result.blocks.map((b) => b.block.type)).toEqual([
      'paragraph',
      'displayMath',
      'imageFallback',
      'paragraph',
    ]);
    expect(result.blocks[2]?.block).toMatchObject({
      status: 'image',
      reason: 'validationFailed',
      id: blocks[2]?.block.id,
    });
    expect(jobs[0]).toContain('\\DocumentMetadata');
  });

  it('keeps blocks as they are when the compiler gives no verdict', async () => {
    const blocks = board().blocks;
    const result = await validateBlocks(blocks, {
      compile: async () => 'unavailable',
      placeholder,
    });
    expect(result.blocks).toEqual(blocks);
    expect(result.report).toMatchObject({ unavailable: true, failed: [], compiles: 1 });
  });

  it('skips blocks already validated in this session', async () => {
    const { session, recognized, lesson: doc } = await runSession(LESSON, true);
    let compiles = 0;
    const compile: ProbeCompile = async () => {
      compiles += 1;
      return 'ok';
    };
    const first = await structureSession({
      blocks: recognized.blocks,
      identity: identity(doc),
      pass: 'incremental',
      model: session.oracle,
      probe: { compile, placeholder },
    });
    expect(compiles).toBe(1);
    const validated = new Set(first.report.validate?.validated);
    await structureSession({
      blocks: recognized.blocks,
      identity: identity(doc),
      pass: 'incremental',
      model: session.oracle,
      probe: { compile, placeholder, validated },
    });
    expect(compiles).toBe(1);
  });
});
