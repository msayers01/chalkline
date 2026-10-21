import { sequentialIds } from '@chalkline/ir';
import type { Stroke } from '@chalkline/ink';
import {
  ProviderError,
  type MathpixResponse,
  type Recognition,
  type StrokeRecognizer,
} from '@chalkline/providers';
import { bubblewrapAvailable, findTexBin } from '@chalkline/worker-compile';
import { describe, expect, it } from 'vitest';
import { buildServer, type BoardDeps } from '../src/index.js';

const ids = sequentialIds('01JAPX');
const SESSION = ids();

/** Answers every region with the next scripted response, counting calls. */
class ScriptedRecognizer implements StrokeRecognizer {
  calls = 0;
  constructor(private readonly answers: (MathpixResponse | ProviderError)[]) {}
  async recognizeStrokes(): Promise<Recognition> {
    const answer = this.answers[Math.min(this.calls, this.answers.length - 1)];
    this.calls += 1;
    if (answer instanceof ProviderError || !answer) throw answer;
    return { engine: 'mathpix-strokes', response: answer };
  }
}

function stroke(x: number, y: number): Stroke {
  return {
    id: ids(),
    page: 0,
    tool: 'pen',
    color: 'black',
    width: 3,
    points: [
      { x, y, p: 0.5, t: 0 },
      { x: x + 20, y: y + 30, p: 0.5, t: 40 },
    ],
  };
}

function region(y = 100) {
  const strokes = [stroke(100, y), stroke(130, y)];
  return {
    region: {
      id: ids(),
      page: 0,
      strokes,
      bbox: { x: 100, y, w: 50, h: 30 },
      t0: 0,
      t1: 40,
      color: 'black',
    },
    tags: [],
  };
}

const today = { title: 'Board notes', date: '2026-10-21', lang: 'en' };

async function recognized(deps: BoardDeps, body = region()) {
  const app = buildServer(deps);
  const res = await app.inject({
    method: 'POST',
    url: `/v1/sessions/${SESSION}/regions`,
    payload: body,
  });
  return { app, res };
}

describe('board API', () => {
  it('reports what is configured', async () => {
    const app = buildServer({ recognition: 'off' });
    const res = await app.inject({ method: 'GET', url: '/v1/health' });
    expect(res.statusCode).toBe(200);
    const health = res.json();
    expect(health).toMatchObject({ recognition: 'off', claude: false, tex: false });
    expect(health.presets.map((p: { id: string }) => p.id)).toContain('lecture-notes');
  });

  it('answers with a problem when recognition is off', async () => {
    const { res } = await recognized({ recognition: 'off' });
    expect(res.statusCode).toBe(503);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.json().type).toBe('recognition-not-configured');
  });

  it('rejects malformed regions without echoing them', async () => {
    const recognizer = new ScriptedRecognizer([{ text: 'x' }]);
    const bad = region();
    bad.region.id = 'not-a-ulid';
    const { res } = await recognized({ recognition: 'live', recognizer }, bad);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      type: 'invalid-request',
      title: 'The region could not be read',
      status: 400,
    });
    expect(recognizer.calls).toBe(0);
  });

  it('recognizes a region into blocks once, however often it is uploaded', async () => {
    const recognizer = new ScriptedRecognizer([{ text: '\\( x^{2}+1 \\)', confidence_rate: 0.99 }]);
    const body = region();
    const { app, res } = await recognized({ recognition: 'live', recognizer }, body);
    expect(res.statusCode).toBe(200);
    const result = res.json();
    expect(result.regionId).toBe(body.region.id);
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0].block).toMatchObject({ type: 'displayMath', status: 'ready' });

    const again = await app.inject({
      method: 'POST',
      url: `/v1/sessions/${SESSION}/regions`,
      payload: body,
    });
    expect(again.json()).toEqual(result);
    expect(recognizer.calls).toBe(1);
  });

  it('does not keep a retryable failure, so the next upload calls again', async () => {
    const recognizer = new ScriptedRecognizer([
      new ProviderError('mathpix', 'http_503', true),
      { text: 'Hello', confidence_rate: 0.95 },
    ]);
    const body = region();
    const { app, res } = await recognized({ recognition: 'live', recognizer }, body);
    expect(res.json().failure).toEqual({ code: 'http_503', retryable: true });

    const retry = await app.inject({
      method: 'POST',
      url: `/v1/sessions/${SESSION}/regions`,
      payload: body,
    });
    expect(retry.json().failure).toBeUndefined();
    expect(retry.json().blocks[0].block.type).toBe('paragraph');
    expect(recognizer.calls).toBe(2);
  });

  it('renders recognized blocks with a preset', async () => {
    const recognizer = new ScriptedRecognizer([
      { text: 'Quadratics', confidence_rate: 0.97 },
      { text: '\\( x^{2}-5 x+6=0 \\)', confidence_rate: 0.97 },
    ]);
    const deps: BoardDeps = { recognition: 'live', recognizer };
    const app = buildServer(deps);
    const blocks = [];
    for (const y of [100, 400]) {
      const res = await app.inject({
        method: 'POST',
        url: `/v1/sessions/${SESSION}/regions`,
        payload: region(y),
      });
      blocks.push(...res.json().blocks);
    }

    const res = await app.inject({
      method: 'POST',
      url: `/v1/sessions/${SESSION}/render`,
      payload: { preset: 'lecture-notes', meta: today, blocks },
    });
    expect(res.statusCode).toBe(200);
    const result = res.json();
    expect(result.tex).toContain('x^{2}-5 x+6=0');
    expect(result.counts.ready).toBe(2);
    expect(result.structuredBy.by).toBe('heuristic');
    expect(result.exportId).toBeUndefined();
  });

  it('refuses blocks that are not valid document blocks', async () => {
    const app = buildServer({ recognition: 'off' });
    const res = await app.inject({
      method: 'POST',
      url: `/v1/sessions/${SESSION}/render`,
      payload: {
        preset: 'lecture-notes',
        meta: today,
        blocks: [{ block: { type: 'paragraph', latex: '\\input{x}' }, tags: [] }],
      },
    });
    expect(res.statusCode).toBe(400);
  });

  const texBin = findTexBin();
  it.skipIf(!texBin)(
    'compiles the handout and serves the PDF',
    async () => {
      const recognizer = new ScriptedRecognizer([{ text: '\\( a^{2}+b^{2}=c^{2} \\)' }]);
      const app = buildServer({
        recognition: 'live',
        recognizer,
        compile: { texBin: texBin ?? '', sandbox: bubblewrapAvailable() ? 'bwrap' : 'none' },
      });
      const { blocks } = (
        await app.inject({
          method: 'POST',
          url: `/v1/sessions/${SESSION}/regions`,
          payload: region(),
        })
      ).json();
      // Low confidence: the block is kept as an image of the ink, so the crop is used.
      expect(blocks[0].block.type).toBe('imageFallback');
      const res = await app.inject({
        method: 'POST',
        url: `/v1/sessions/${SESSION}/render`,
        payload: {
          preset: 'board-snapshot',
          meta: today,
          blocks,
          crops: { [blocks[0].block.provenance.regionIds[0]]: TINY_PNG },
        },
      });
      const result = res.json();
      expect(result.compile.error).toBeUndefined();
      const pdf = await app.inject({ method: 'GET', url: `/v1/exports/${result.exportId}` });
      expect(pdf.headers['content-type']).toBe('application/pdf');
      expect(pdf.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    },
    120_000,
  );
});

/** A 1×1 white PNG. */
const TINY_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGP4DwABAQEAWB1v2AAAAABJRU5ErkJggg==';
