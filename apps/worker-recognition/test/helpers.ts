import { sequentialIds, type ContentBlock, type Inline } from '@chalkline/ir';
import { buildItems, type BoardBlock, type StructureItem, type TeacherTag } from '../src/index.js';

/**
 * Board blocks for tests: each call is a new region written below the last,
 * unless `sameRegion` continues the previous one.
 */
export class Board {
  private readonly ids = sequentialIds('01JTEST');
  private readonly regions = sequentialIds('01JREG');
  private y = 40;
  private t = 1_000;
  private region = '';
  readonly blocks: BoardBlock[] = [];

  text(text: string, opts: BlockOptions = {}): this {
    return this.add({ type: 'paragraph', inlines: inlinesOf(text) }, opts);
  }

  math(lines: string | string[], opts: BlockOptions = {}): this {
    return this.add({ type: 'displayMath', lines: Array.isArray(lines) ? lines : [lines] }, opts);
  }

  image(opts: BlockOptions = {}): this {
    return this.add({ type: 'imageFallback', assetRef: 'region-x', reason: 'lowConfidence' }, opts);
  }

  items(): StructureItem[] {
    return buildItems(this.blocks);
  }

  private add(
    content:
      | { type: 'paragraph'; inlines: Inline[] }
      | { type: 'displayMath'; lines: string[] }
      | { type: 'imageFallback'; assetRef: string; reason: 'lowConfidence' },
    opts: BlockOptions,
  ): this {
    if (!opts.sameRegion || !this.region) this.region = this.regions();
    else this.y -= 30;
    const block = {
      id: this.ids(),
      status: content.type === 'imageFallback' ? ('image' as const) : ('ready' as const),
      provenance: {
        source: 'board' as const,
        regionIds: [this.region],
        page: opts.page ?? 0,
        bbox: { x: opts.x ?? 40, y: this.y, w: opts.w ?? 500, h: 50 },
        t0: this.t,
        t1: this.t + 2_000,
      },
      decided: { typeBy: 'heuristic' as const, pinned: false },
      ...content,
    } as ContentBlock;
    this.y += 80;
    this.t += 4_000;
    this.blocks.push({ block, tags: opts.tags ?? [] });
    return this;
  }
}

export type BlockOptions = {
  tags?: TeacherTag[];
  sameRegion?: boolean;
  page?: number;
  x?: number;
  w?: number;
};

/** `$...$` marks inline math. */
export function inlinesOf(text: string): Inline[] {
  return text
    .split(/(\$[^$]*\$)/)
    .filter(Boolean)
    .map((part) =>
      part.startsWith('$')
        ? { kind: 'math', latex: part.slice(1, -1) }
        : { kind: 'text', text: part },
    );
}
