import Anthropic from '@anthropic-ai/sdk';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Stroke } from '@chalkline/ink';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  AnthropicJsonModel,
  MathpixClient,
  ProviderError,
  RecordedJsonModel,
  RecordedRecognizer,
  RecordingStore,
  providersFromEnv,
  stableStringify,
  strokesRequestBody,
  strokesRequestBytes,
} from '../src/index.js';

const strokes: Stroke[] = [
  {
    id: '01JS0000000000000000000001',
    page: 0,
    tool: 'pen',
    color: 'black',
    width: 2,
    points: [
      { x: 1.234, y: 2.25, p: 0.5, t: 0 },
      { x: 3, y: 4, p: 0.5, t: 10 },
    ],
  },
  {
    id: '01JS0000000000000000000002',
    page: 0,
    tool: 'pen',
    color: 'black',
    width: 2,
    points: [{ x: 5, y: 6.06, p: 0.5, t: 20 }],
  },
];

type Captured = { url: string; init: RequestInit };

function fakeFetch(responses: (() => Response)[], captured: Captured[] = []): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    captured.push({ url: String(input), init: init ?? {} });
    const next = responses.shift();
    if (!next) throw new Error('no more responses');
    return next();
  }) as typeof fetch;
}

const json =
  (body: unknown, status = 200) =>
  () =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('Mathpix', () => {
  it('builds the v3/strokes body with rounded coordinates and the retention opt-out', () => {
    expect(strokesRequestBody(strokes)).toEqual({
      strokes: { strokes: { x: [[1.2, 3], [5]], y: [[2.3, 4], [6.1]] } },
      formats: ['text'],
      include_line_data: true,
      metadata: { improve_mathpix: false },
    });
    expect(strokesRequestBytes(strokes)).toBe(JSON.stringify(strokesRequestBody(strokes)).length);
  });

  it('posts with app_id/app_key headers and validates the response', async () => {
    const captured: Captured[] = [];
    const client = new MathpixClient({
      appId: 'id',
      appKey: 'key',
      fetch: fakeFetch(
        [json({ request_id: 'r', text: '\\( x^2 \\)', confidence: 0.97, line_data: [] })],
        captured,
      ),
    });
    const result = await client.recognizeStrokes('01JR', strokes);
    expect(result).toMatchObject({
      engine: 'mathpix-strokes',
      response: { text: '\\( x^2 \\)', confidence: 0.97 },
    });
    expect(captured[0]?.url).toBe('https://api.mathpix.com/v3/strokes');
    expect(captured[0]?.init.headers).toMatchObject({ app_id: 'id', app_key: 'key' });
  });

  it('marks rate limits and server errors retryable, content errors not', async () => {
    const errorFor = async (response: () => Response) => {
      const client = new MathpixClient({
        appId: 'id',
        appKey: 'key',
        fetch: fakeFetch([response]),
      });
      return client.recognizeStrokes('r', strokes).catch((e: unknown) => e);
    };
    expect(await errorFor(json({}, 429))).toMatchObject({ code: 'http_429', retryable: true });
    expect(await errorFor(json({}, 503))).toMatchObject({ retryable: true });
    expect(await errorFor(json({}, 401))).toMatchObject({ code: 'http_401', retryable: false });
    expect(
      await errorFor(json({ error: 'Cannot read', error_info: { id: 'image_no_content' } })),
    ).toMatchObject({
      code: 'image_no_content',
      retryable: false,
    });
    expect(await errorFor(json({ confidence: 7 }))).toBeInstanceOf(ProviderError);
  });
});

const Output = z.object({ ids: z.array(z.string()) });

function message(
  model: string,
  text: string,
  stop_reason = 'end_turn',
  extra: Record<string, unknown> = {},
) {
  return json({
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model,
    content: text ? [{ type: 'text', text }] : [],
    stop_reason,
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 5 },
    ...extra,
  });
}

function sdk(responses: (() => Response)[], captured: Captured[]) {
  return new Anthropic({ apiKey: 'test', maxRetries: 0, fetch: fakeFetch(responses, captured) });
}

describe('AnthropicJsonModel', () => {
  const request = { system: 'Organize.', user: '{"blocks":[]}', schema: Output } as const;

  it('requests schema-constrained output and parses it', async () => {
    const captured: Captured[] = [];
    const model = new AnthropicJsonModel(
      sdk([message('claude-haiku-5-5', '{"ids":["a"]}')], captured),
    );
    const result = await model.complete({ ...request, model: 'claude-haiku-5-5', effort: 'low' });
    expect(result).toEqual({ kind: 'ok', output: { ids: ['a'] } });
    const body = JSON.parse(String(captured[0]?.init.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      model: 'claude-haiku-5-5',
      system: 'Organize.',
      output_config: { effort: 'low', format: { type: 'json_schema' } },
    });
    expect(body.fallbacks).toBeUndefined();
  });

  it('opts the Sonnet final pass into server-side refusal fallback', async () => {
    const captured: Captured[] = [];
    const model = new AnthropicJsonModel(
      sdk([message('claude-sonnet-5-5', '{"ids":[]}')], captured),
    );
    await model.complete({ ...request, model: 'claude-sonnet-5-5', effort: 'medium' });
    const body = JSON.parse(String(captured[0]?.init.body)) as Record<string, unknown>;
    expect(body.fallbacks).toBe('default');
    expect(new Headers(captured[0]?.init.headers).get('anthropic-beta')).toContain(
      'server-side-fallback-2026-07-01',
    );
  });

  it('reports refusals and truncation instead of guessing', async () => {
    const refused = new AnthropicJsonModel(
      sdk(
        [
          message('claude-haiku-5-5', '', 'refusal', {
            stop_details: { type: 'refusal', category: 'cyber', explanation: 'x' },
          }),
        ],
        [],
      ),
    );
    expect(
      await refused.complete({ ...request, model: 'claude-haiku-5-5', effort: 'low' }),
    ).toEqual({ kind: 'refused', category: 'cyber' });
    const truncated = new AnthropicJsonModel(
      sdk([message('claude-haiku-5-5', '{"ids":["a"', 'max_tokens')], []),
    );
    expect(
      await truncated.complete({ ...request, model: 'claude-haiku-5-5', effort: 'low' }),
    ).toEqual({ kind: 'invalid', reason: 'maxTokens' });
  });

  it('maps API errors to retryable or not', async () => {
    const limited = new AnthropicJsonModel(
      sdk(
        [json({ type: 'error', error: { type: 'rate_limit_error', message: 'slow down' } }, 429)],
        [],
      ),
    );
    await expect(
      limited.complete({ ...request, model: 'claude-haiku-5-5', effort: 'low' }),
    ).rejects.toMatchObject({ code: 'rate_limited', retryable: true });
    const bad = new AnthropicJsonModel(
      sdk(
        [json({ type: 'error', error: { type: 'invalid_request_error', message: 'no' } }, 400)],
        [],
      ),
    );
    await expect(
      bad.complete({ ...request, model: 'claude-haiku-5-5', effort: 'low' }),
    ).rejects.toMatchObject({ code: 'http_400', retryable: false });
  });
});

describe('recorded providers', () => {
  it('replays recordings and refuses to call anything in replay mode', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'chalkline-rec-'));
    const store = new RecordingStore(dir, 'replay');
    const req = {
      model: 'claude-haiku-5-5' as const,
      system: 's',
      user: 'u',
      schema: Output,
      effort: 'low' as const,
    };
    const model = new RecordedJsonModel(store);
    await expect(model.complete(req)).rejects.toMatchObject({
      code: expect.stringContaining('missing_recording'),
    });
    store.write('model', RecordedJsonModel.key(req), { kind: 'ok', output: { ids: ['x'] } });
    expect(await model.complete(req)).toEqual({ kind: 'ok', output: { ids: ['x'] } });
  });

  it('records missing responses in record mode, then replays them', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'chalkline-rec-'));
    let calls = 0;
    const live = {
      recognizeStrokes: async () => {
        calls += 1;
        return { engine: 'mathpix-strokes' as const, response: { text: 'x' } };
      },
      recognizeImage: async () => ({ engine: 'mathpix-text' as const, response: {} }),
    };
    const recorder = new RecordedRecognizer(new RecordingStore(dir, 'record'), live);
    await recorder.recognizeStrokes('r', strokes);
    const replay = new RecordedRecognizer(new RecordingStore(dir, 'replay'));
    expect(await replay.recognizeStrokes('r', strokes)).toMatchObject({ response: { text: 'x' } });
    expect(calls).toBe(1);
  });

  it('defaults to recorded providers and needs keys for live ones', () => {
    expect(providersFromEnv({}, '/tmp/x').mode).toBe('recorded');
    expect(() => providersFromEnv({ PROVIDERS: 'live' }, '/tmp/x')).toThrow(/MATHPIX_APP_ID/);
    expect(stableStringify({ b: 1, a: [2, { d: 3, c: 4 }] })).toBe('{"a":[2,{"c":4,"d":3}],"b":1}');
  });
});
