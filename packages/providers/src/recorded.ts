import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { Stroke } from '@chalkline/ink';
import { ProviderError } from './errors.js';
import {
  AnthropicJsonModel,
  type JsonModel,
  type JsonModelRequest,
  type JsonModelResult,
} from './anthropic.js';
import {
  MathpixClient,
  MathpixResponse,
  strokesRequestBody,
  textRequestBody,
  type ImageRecognizer,
  type Recognition,
  type StrokeRecognizer,
} from './mathpix.js';

/**
 * Recorded providers: responses stored on disk, keyed by a hash of the
 * request, so tests and local development never need API keys and never
 * bill. `replay` serves only what is recorded; `record` calls the live
 * provider for anything missing and saves the response.
 */

export type RecordingMode = 'replay' | 'record';

/** JSON with sorted keys, so equal requests hash equally. */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function requestKey(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex').slice(0, 32);
}

export class RecordingStore {
  constructor(
    readonly dir: string,
    readonly mode: RecordingMode,
  ) {}

  read(kind: string, key: string): unknown {
    const file = join(this.dir, kind, `${key}.json`);
    return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as unknown) : undefined;
  }

  write(kind: string, key: string, value: unknown): void {
    mkdirSync(join(this.dir, kind), { recursive: true });
    writeFileSync(join(this.dir, kind, `${key}.json`), `${JSON.stringify(value, null, 2)}\n`);
  }

  missing(kind: string, key: string): ProviderError {
    return new ProviderError('recorded', `missing_recording:${kind}/${key}`, false);
  }
}

const StoredRecognition = z.object({
  engine: z.enum(['mathpix-strokes', 'mathpix-text', 'simulated']),
  response: MathpixResponse,
});

export class RecordedRecognizer implements StrokeRecognizer, ImageRecognizer {
  constructor(
    private readonly store: RecordingStore,
    private readonly live?: StrokeRecognizer & ImageRecognizer,
  ) {}

  recognizeStrokes(regionId: string, strokes: readonly Stroke[]): Promise<Recognition> {
    const key = requestKey(strokesRequestBody(strokes));
    return this.lookup('strokes', key, () => this.live?.recognizeStrokes(regionId, strokes));
  }

  recognizeImage(regionId: string, png: Uint8Array): Promise<Recognition> {
    const key = requestKey(textRequestBody(png));
    return this.lookup('text', key, () => this.live?.recognizeImage(regionId, png));
  }

  private async lookup(
    kind: string,
    key: string,
    call: () => Promise<Recognition> | undefined,
  ): Promise<Recognition> {
    const stored = this.store.read(kind, key);
    if (stored !== undefined) return StoredRecognition.parse(stored);
    const pending = this.store.mode === 'record' ? call() : undefined;
    if (!pending) throw this.store.missing(kind, key);
    const result = await pending;
    this.store.write(kind, key, result);
    return result;
  }
}

const StoredResult = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('ok'), output: z.unknown() }),
  z.object({ kind: z.literal('refused'), category: z.string().nullable() }),
  z.object({ kind: z.literal('invalid'), reason: z.enum(['maxTokens', 'unparseable']) }),
]);

export class RecordedJsonModel implements JsonModel {
  constructor(
    private readonly store: RecordingStore,
    private readonly live?: JsonModel,
  ) {}

  /** The schema is part of the key, so changing it invalidates old recordings. */
  static key<S extends z.ZodType>(request: JsonModelRequest<S>): string {
    const { schema, ...rest } = request;
    return requestKey({ ...rest, schema: z.toJSONSchema(schema) });
  }

  async complete<S extends z.ZodType>(
    request: JsonModelRequest<S>,
  ): Promise<JsonModelResult<z.infer<S>>> {
    const key = RecordedJsonModel.key(request);
    const stored = this.store.read('model', key);
    if (stored !== undefined) {
      const result = StoredResult.parse(stored);
      if (result.kind !== 'ok') return result;
      const output = request.schema.safeParse(result.output);
      return output.success
        ? { kind: 'ok', output: output.data }
        : { kind: 'invalid', reason: 'unparseable' };
    }
    if (this.store.mode !== 'record' || !this.live) throw this.store.missing('model', key);
    const result = await this.live.complete(request);
    this.store.write('model', key, result);
    return result;
  }
}

export type Providers = {
  recognizer: StrokeRecognizer & ImageRecognizer;
  model: JsonModel;
  mode: 'recorded' | 'record' | 'live';
};

/**
 * `PROVIDERS=recorded` (default): replay only. `PROVIDERS=record`: call
 * live providers for missing recordings and save them. `PROVIDERS=live`:
 * always call live. Live modes need MATHPIX_APP_ID, MATHPIX_APP_KEY and
 * Anthropic credentials, from the worker's environment only.
 */
export function providersFromEnv(env: NodeJS.ProcessEnv, recordingsDir: string): Providers {
  const mode = env.PROVIDERS ?? 'recorded';
  const liveRecognizer = () => {
    if (!env.MATHPIX_APP_ID || !env.MATHPIX_APP_KEY)
      throw new Error('PROVIDERS=' + mode + ' needs MATHPIX_APP_ID and MATHPIX_APP_KEY');
    return new MathpixClient({ appId: env.MATHPIX_APP_ID, appKey: env.MATHPIX_APP_KEY });
  };
  switch (mode) {
    case 'recorded': {
      const store = new RecordingStore(recordingsDir, 'replay');
      return {
        recognizer: new RecordedRecognizer(store),
        model: new RecordedJsonModel(store),
        mode,
      };
    }
    case 'record': {
      const store = new RecordingStore(recordingsDir, 'record');
      const model = new AnthropicJsonModel();
      return {
        recognizer: new RecordedRecognizer(store, liveRecognizer()),
        model: new RecordedJsonModel(store, model),
        mode,
      };
    }
    case 'live':
      return { recognizer: liveRecognizer(), model: new AnthropicJsonModel(), mode };
    default:
      throw new Error(`PROVIDERS must be recorded, record or live (got ${mode})`);
  }
}
