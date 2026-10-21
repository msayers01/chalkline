import { schema, type DocMeta } from '@chalkline/ir';
import { BUILT_IN_PRESETS, renderWithPreset, type PresetId } from '@chalkline/presets';
import { requestKey, type JsonModel, type StrokeRecognizer } from '@chalkline/providers';
import {
  compileBundle,
  placeholderPng,
  type CompileAsset,
  type SandboxMode,
} from '@chalkline/worker-compile';
import {
  derivedId,
  recognizeRegions,
  regionAssetRef,
  structureSession,
  type BoardBlock,
  type RegionReport,
  type SessionReport,
} from '@chalkline/worker-recognition';
import { boardBlocksOf, inkRegionOf, type RegionBody, type RenderBody } from './schemas.js';

/**
 * Local, single-user board service: recognition, structuring and compiling
 * run inline in the request, with no database or queue. The browser keeps
 * the session (strokes, regions and their blocks in IndexedDB) and sends
 * what a render needs; this side holds only caches.
 *
 * Nothing here logs content: errors and reports carry ids and codes only.
 */

export type RecognitionMode = 'live' | 'record' | 'recorded' | 'off';

export type BoardDeps = {
  recognition: RecognitionMode;
  /** Absent when recognition is `off` (no Mathpix keys). */
  recognizer?: StrokeRecognizer;
  /** Claude, when ANTHROPIC_API_KEY is set. */
  model?: JsonModel;
  /** TeX Live, when found. Without it renders return `.tex` only. */
  compile?: { texBin: string; sandbox: SandboxMode };
};

export type RegionResult = {
  regionId: string;
  blocks: BoardBlock[];
  failure?: RegionReport['failure'];
};

export type RenderResult = {
  preset: PresetId;
  tex: string;
  /** Present when the PDF compiled: GET /v1/exports/{exportId}. */
  exportId?: string;
  compile?: { seconds: number; error?: string };
  structuredBy: SessionReport['structure'];
  counts: SessionReport['counts'];
  /** Things to look at, without content: block ids and kinds. */
  issues: { blockId: string | null; code: string }[];
};

/** Most recent PDFs kept for download. */
const MAX_EXPORTS = 20;
/** Most recent recognized regions kept for idempotent retries. */
const MAX_REGIONS = 2_000;

export class BoardService {
  /** By region id: the request key and the result, so a retried upload never calls Mathpix twice. */
  private readonly regions = new Map<string, { key: string; result: RegionResult }>();
  /** `probeKey`s of blocks that compiled in a probe. */
  private readonly validated = new Set<string>();
  private readonly exports = new Map<string, Uint8Array>();

  constructor(readonly deps: BoardDeps) {}

  health() {
    return {
      recognition: this.deps.recognition,
      claude: this.deps.model !== undefined,
      tex: this.deps.compile !== undefined,
      sandbox: this.deps.compile?.sandbox ?? null,
      presets: Object.entries(BUILT_IN_PRESETS).map(([id, p]) => ({ id, name: p.name })),
    };
  }

  /** Recognizes one settled region. Throws `NotConfigured` when there is no recognizer. */
  async recognize(body: RegionBody): Promise<RegionResult> {
    const recognizer = this.deps.recognizer;
    if (!recognizer) throw new NotConfigured();
    const region = inkRegionOf(body);
    const key = requestKey({ region, tags: body.tags });
    const known = this.regions.get(region.id);
    if (known?.key === key) return known.result;

    const { blocks, reports } = await recognizeRegions([{ region, tags: body.tags }], recognizer);
    const failure = reports[0]?.failure;
    const result: RegionResult = { regionId: region.id, blocks, ...(failure ? { failure } : {}) };
    // A retryable failure is not an answer: the next upload tries again.
    if (!failure?.retryable) remember(this.regions, region.id, { key, result }, MAX_REGIONS);
    return result;
  }

  async render(sessionId: string, body: RenderBody): Promise<RenderResult> {
    const meta: DocMeta = {
      title: body.meta.title,
      course: '',
      teacher: '',
      date: body.meta.date,
      lang: body.meta.lang,
    };
    const compile = this.deps.compile;
    const { doc, report } = await structureSession({
      blocks: boardBlocksOf(body),
      identity: { id: derivedId(sessionId, 'doc'), sessionId, version: 1, meta },
      pass: 'final',
      ...(body.structurer === 'claude' && this.deps.model ? { model: this.deps.model } : {}),
      ...(compile
        ? {
            probe: {
              compile: async (job) => {
                const result = await compileBundle(job, compile);
                return result.ok ? 'ok' : result.timedOut ? 'unavailable' : 'failed';
              },
              placeholder: placeholderPng(),
              preset: body.preset,
              validated: this.validated,
            },
          }
        : {}),
    });
    for (const key of report.validate?.validated ?? []) this.validated.add(key);

    const rendering = renderWithPreset(doc, body.preset);
    const result: RenderResult = {
      preset: body.preset,
      tex: rendering.tex,
      structuredBy: report.structure,
      counts: report.counts,
      issues: rendering.issues.map((i) => ({ blockId: i.blockId ?? null, code: i.code })),
    };
    if (!compile) return result;

    const crops = new Map(
      Object.entries(body.crops).map(([id, png]) => [regionAssetRef(id), png] as const),
    );
    const assets: CompileAsset[] = rendering.assets.map((use) => {
      const png = crops.get(use.ref);
      return {
        path: use.path,
        bytes: png ? new Uint8Array(Buffer.from(png, 'base64')) : placeholderPng(),
      };
    });
    const compiled = await compileBundle({ tex: rendering.tex, assets }, compile);
    const seconds = Math.round(compiled.durationMs / 100) / 10;
    if (!compiled.pdf) {
      const error = compiled.findings.find((f) => f.kind === 'error');
      return {
        ...result,
        compile: {
          seconds,
          error: compiled.timedOut
            ? 'timedOut'
            : (compiled.refusal ?? (error ? 'texError' : 'noPdf')),
        },
      };
    }
    const exportId = schema.Id.parse(derivedId(sessionId, requestKey({ tex: rendering.tex })));
    remember(this.exports, exportId, compiled.pdf, MAX_EXPORTS);
    return { ...result, exportId, compile: { seconds } };
  }

  exportPdf(exportId: string): Uint8Array | undefined {
    return this.exports.get(exportId);
  }
}

export class NotConfigured extends Error {
  constructor() {
    super('recognition is not configured');
    this.name = 'NotConfigured';
  }
}

/** Map insert that drops the oldest entries past `max`. */
function remember<K, V>(map: Map<K, V>, key: K, value: V, max: number): void {
  map.delete(key);
  map.set(key, value);
  for (const oldest of map.keys()) {
    if (map.size <= max) break;
    map.delete(oldest);
  }
}
