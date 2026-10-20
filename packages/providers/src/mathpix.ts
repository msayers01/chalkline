import { z } from 'zod';
import type { Stroke } from '@chalkline/ink';
import { ProviderError } from './errors.js';

/**
 * Mathpix Convert API: v3/strokes for board ink, v3/text for screen crops
 * (https://docs.mathpix.com/reference/post-v3-strokes, /post-v3-text).
 * Requests opt out of Mathpix data retention (`metadata.improve_mathpix:
 * false`). Called only from workers; keys never reach the browser.
 */

export const MathpixLine = z
  .object({
    id: z.string().optional(),
    type: z.string().optional(),
    subtype: z.string().optional(),
    text: z.string().optional(),
    confidence: z.number().min(0).max(1).optional(),
    confidence_rate: z.number().min(0).max(1).optional(),
    conversion_output: z.boolean().optional(),
    is_printed: z.boolean().optional(),
    is_handwritten: z.boolean().optional(),
    error_id: z.string().optional(),
  })
  .loose();

export const MathpixResponse = z
  .object({
    request_id: z.string().optional(),
    /** Mathpix Markdown: text with \( \) inline and \[ \] display math. */
    text: z.string().optional(),
    latex_styled: z.string().optional(),
    confidence: z.number().min(0).max(1).optional(),
    confidence_rate: z.number().min(0).max(1).optional(),
    is_printed: z.boolean().optional(),
    is_handwritten: z.boolean().optional(),
    line_data: z.array(MathpixLine).optional(),
    error: z.string().optional(),
    error_info: z
      .object({ id: z.string().optional(), message: z.string().optional() })
      .loose()
      .optional(),
    version: z.string().optional(),
  })
  .loose();
export type MathpixResponse = z.infer<typeof MathpixResponse>;

export type Recognition = {
  engine: 'mathpix-strokes' | 'mathpix-text' | 'simulated';
  response: MathpixResponse;
};

/** Board ink, as stroke data. */
export interface StrokeRecognizer {
  recognizeStrokes(regionId: string, strokes: readonly Stroke[]): Promise<Recognition>;
}

/** A cropped image of new writing (Companion Capture, imports). */
export interface ImageRecognizer {
  recognizeImage(regionId: string, png: Uint8Array): Promise<Recognition>;
}

const OPTIONS = {
  formats: ['text'],
  include_line_data: true,
  metadata: { improve_mathpix: false },
} as const;

/** Coordinates rounded to 0.1 page units: smaller requests, no visible loss. */
const round = (v: number) => Math.round(v * 10) / 10;

export function strokesRequestBody(strokes: readonly Stroke[]) {
  return {
    strokes: {
      strokes: {
        x: strokes.map((s) => s.points.map((p) => round(p.x))),
        y: strokes.map((s) => s.points.map((p) => round(p.y))),
      },
    },
    ...OPTIONS,
  };
}

/** Exact size of the v3/strokes request body, for splitting regions under the 512 KB limit. */
export function strokesRequestBytes(strokes: readonly Stroke[]): number {
  return Buffer.byteLength(JSON.stringify(strokesRequestBody(strokes)), 'utf8');
}

export function textRequestBody(png: Uint8Array) {
  return { src: `data:image/png;base64,${Buffer.from(png).toString('base64')}`, ...OPTIONS };
}

export type MathpixOptions = {
  appId: string;
  appKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
};

export class MathpixClient implements StrokeRecognizer, ImageRecognizer {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetch: typeof fetch;

  constructor(private readonly options: MathpixOptions) {
    this.baseUrl = options.baseUrl ?? 'https://api.mathpix.com';
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.fetch = options.fetch ?? fetch;
  }

  async recognizeStrokes(_regionId: string, strokes: readonly Stroke[]): Promise<Recognition> {
    return {
      engine: 'mathpix-strokes',
      response: await this.post('/v3/strokes', strokesRequestBody(strokes)),
    };
  }

  async recognizeImage(_regionId: string, png: Uint8Array): Promise<Recognition> {
    return { engine: 'mathpix-text', response: await this.post('/v3/text', textRequestBody(png)) };
  }

  private async post(path: string, body: unknown): Promise<MathpixResponse> {
    let res: Response;
    try {
      res = await this.fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: {
          app_id: this.options.appId,
          app_key: this.options.appKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (e) {
      throw new ProviderError('mathpix', 'network', true, e);
    }
    if (!res.ok)
      throw new ProviderError(
        'mathpix',
        `http_${res.status}`,
        res.status === 429 || res.status >= 500,
      );
    const parsed = MathpixResponse.safeParse(await res.json().catch(() => undefined));
    if (!parsed.success) throw new ProviderError('mathpix', 'invalid_response', false);
    if (parsed.data.error) {
      throw new ProviderError('mathpix', parsed.data.error_info?.id ?? 'error', false);
    }
    return parsed.data;
  }
}
