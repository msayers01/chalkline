import type { InkRegion } from '@chalkline/ink';
import { schema } from '@chalkline/ir';
import { z } from 'zod';

/**
 * Client for the local API (apps/api), validated with Zod at the boundary.
 * Failures become `ApiProblem`s with the server's stable `type` code, or
 * `network` when the API could not be reached.
 */

/** A recognized block and the teacher tags on the ink it came from. */
export const BoardBlock = z.object({
  block: schema.ContentBlock,
  tags: z.array(z.string()),
});
export type BoardBlock = z.infer<typeof BoardBlock>;

export const Health = z.object({
  recognition: z.enum(['live', 'record', 'recorded', 'off']),
  claude: z.boolean(),
  tex: z.boolean(),
  sandbox: z.string().nullable(),
  presets: z.array(z.object({ id: z.string(), name: z.string() })),
});
export type Health = z.infer<typeof Health>;

export const RegionResult = z.object({
  regionId: z.string(),
  blocks: z.array(BoardBlock),
  failure: z.object({ code: z.string(), retryable: z.boolean() }).optional(),
});
export type RegionResult = z.infer<typeof RegionResult>;

export const RenderResult = z.object({
  preset: z.string(),
  tex: z.string(),
  exportId: z.string().optional(),
  compile: z.object({ seconds: z.number(), error: z.string().optional() }).optional(),
  structuredBy: z.object({ by: z.string(), fallback: z.string().optional() }).loose(),
  counts: z.object({
    ready: z.number(),
    check: z.number(),
    image: z.number(),
    excluded: z.number(),
  }),
  issues: z.array(z.object({ blockId: z.string().nullable(), code: z.string() })),
});
export type RenderResult = z.infer<typeof RenderResult>;

export type RenderRequest = {
  preset: string;
  structurer: 'heuristic' | 'claude';
  meta: { title: string; date: string; lang: 'en' | 'es' | 'fr' | 'de' | 'pt' };
  blocks: BoardBlock[];
  crops: Record<string, string>;
};

export class ApiProblem extends Error {
  constructor(
    readonly type: string,
    readonly status: number,
  ) {
    super(type);
    this.name = 'ApiProblem';
  }
}

export interface BoardApi {
  health(): Promise<Health>;
  recognize(sessionId: string, region: InkRegion, tags: readonly string[]): Promise<RegionResult>;
  render(sessionId: string, request: RenderRequest): Promise<RenderResult>;
  exportUrl(exportId: string): string;
}

const Problem = z.object({ type: z.string(), status: z.number() });

export class HttpBoardApi implements BoardApi {
  constructor(private readonly base = '') {}

  health(): Promise<Health> {
    return this.call('GET', '/v1/health', undefined, Health);
  }

  recognize(sessionId: string, region: InkRegion, tags: readonly string[]): Promise<RegionResult> {
    return this.call('POST', `/v1/sessions/${sessionId}/regions`, { region, tags }, RegionResult);
  }

  render(sessionId: string, request: RenderRequest): Promise<RenderResult> {
    return this.call('POST', `/v1/sessions/${sessionId}/render`, request, RenderResult);
  }

  exportUrl(exportId: string): string {
    return `${this.base}/v1/exports/${exportId}`;
  }

  private async call<T>(
    method: 'GET' | 'POST',
    path: string,
    body: unknown,
    result: z.ZodType<T>,
  ): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.base}${path}`, {
        method,
        ...(body === undefined
          ? {}
          : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
      });
    } catch {
      throw new ApiProblem('network', 0);
    }
    const json: unknown = await res.json().catch(() => undefined);
    if (!res.ok) {
      const problem = Problem.safeParse(json);
      // The dev proxy answers 502/504 when the API process is not running.
      throw new ApiProblem(
        problem.success ? problem.data.type : res.status >= 502 ? 'network' : 'internal',
        res.status,
      );
    }
    const parsed = result.safeParse(json);
    if (!parsed.success) throw new ApiProblem('invalid-response', res.status);
    return parsed.data;
  }
}
