import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import type { z } from 'zod';
import { ProviderError } from './errors.js';

/**
 * Schema-constrained JSON from Claude, for structuring and alt text. The
 * caller owns the schema and the prompt (worker-recognition/src/structure);
 * this module owns transport, timeouts and failure mapping. Requests run
 * under the account's zero-data-retention agreement; nothing here logs
 * content.
 */

export type StructuringModelId = 'claude-haiku-5-5' | 'claude-sonnet-5-5';

export type JsonModelRequest<S extends z.ZodType> = {
  model: StructuringModelId;
  system: string;
  /** The data to work on, as one user message. */
  user: string;
  schema: S;
  effort: 'low' | 'medium' | 'high';
  maxTokens?: number;
};

export type JsonModelResult<T> =
  | { kind: 'ok'; output: T }
  /** A safety classifier declined; the caller falls back (heuristic structurer). */
  | { kind: 'refused'; category: string | null }
  | { kind: 'invalid'; reason: 'maxTokens' | 'unparseable' };

export interface JsonModel {
  complete<S extends z.ZodType>(request: JsonModelRequest<S>): Promise<JsonModelResult<z.infer<S>>>;
}

const TIMEOUT_MS: Record<StructuringModelId, number> = {
  'claude-haiku-5-5': 60_000,
  'claude-sonnet-5-5': 180_000,
};

export class AnthropicJsonModel implements JsonModel {
  private readonly client: Anthropic;

  constructor(client?: Anthropic) {
    // Credentials come from the environment (ANTHROPIC_API_KEY or a profile).
    this.client = client ?? new Anthropic({ maxRetries: 2 });
  }

  async complete<S extends z.ZodType>(
    request: JsonModelRequest<S>,
  ): Promise<JsonModelResult<z.infer<S>>> {
    // The final pass on Claude Sonnet 5.5 opts into server-side refusal
    // fallback, so a false-positive decline is retried on another model in
    // the same call. Claude Haiku 5.5 has no server-side fallback; a refusal
    // there goes to the heuristic structurer.
    const fallback =
      request.model === 'claude-sonnet-5-5'
        ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }
        : {};
    // create() rather than parse(): parse() throws on truncated output before
    // the stop reason can be checked, and a refusal is not a parse error.
    let response;
    try {
      response = await this.client.beta.messages.create(
        {
          model: request.model,
          max_tokens: request.maxTokens ?? 16_000,
          system: request.system,
          messages: [{ role: 'user', content: request.user }],
          output_config: { effort: request.effort, format: betaZodOutputFormat(request.schema) },
          ...fallback,
        },
        { timeout: TIMEOUT_MS[request.model] },
      );
    } catch (e) {
      throw mapError(e);
    }
    if (response.stop_reason === 'refusal') {
      return { kind: 'refused', category: response.stop_details?.category ?? null };
    }
    if (response.stop_reason === 'max_tokens') return { kind: 'invalid', reason: 'maxTokens' };
    const text = response.content
      .map((block) => (block.type === 'text' ? block.text : ''))
      .join('');
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return { kind: 'invalid', reason: 'unparseable' };
    }
    const parsed = request.schema.safeParse(json);
    if (!parsed.success) return { kind: 'invalid', reason: 'unparseable' };
    return { kind: 'ok', output: parsed.data };
  }
}

function mapError(e: unknown): Error {
  if (e instanceof Anthropic.RateLimitError)
    return new ProviderError('anthropic', 'rate_limited', true, e);
  if (e instanceof Anthropic.InternalServerError)
    return new ProviderError('anthropic', 'server_error', true, e);
  if (e instanceof Anthropic.APIConnectionError)
    return new ProviderError('anthropic', 'network', true, e);
  if (e instanceof Anthropic.APIError)
    return new ProviderError('anthropic', `http_${e.status ?? 'unknown'}`, false, e);
  return new ProviderError('anthropic', 'unknown', false, e);
}
