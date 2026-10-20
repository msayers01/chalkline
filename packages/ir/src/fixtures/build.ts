import { sequentialIds } from '../ids.js';
import type {
  Answer,
  Block,
  Callout,
  CalloutKind,
  ContentBlock,
  DisplayMath,
  Doc,
  DocMeta,
  Figure,
  FigureSource,
  ImageFallback,
  Inline,
  InkColor,
  List,
  Paragraph,
  Problem,
  ProblemPart,
  Provenance,
  Section,
  Solution,
  Table,
} from '../types.js';

/**
 * Small builder for hand-written IR documents in tests and fixtures. Ids are
 * sequential so fixtures are stable across runs (snapshot tests depend on it).
 */
export class DocBuilder {
  private readonly nextId: () => string;
  private page = 0;
  private clock = 0;

  constructor(prefix?: string) {
    this.nextId = sequentialIds(prefix);
  }

  id(): string {
    return this.nextId();
  }

  /** Text run. */
  t(text: string, extra: { bold?: boolean; italic?: boolean; color?: InkColor } = {}): Inline {
    const { color, ...style } = extra;
    return {
      kind: 'text',
      text,
      ...(Object.keys(style).length ? { style } : {}),
      ...(color ? { color } : {}),
    };
  }

  /** Inline math run. */
  m(latex: string, color?: InkColor): Inline {
    return { kind: 'math', latex, ...(color ? { color } : {}) };
  }

  newPage(): void {
    this.page += 1;
  }

  private base(confidence = 0.97) {
    this.clock += 4000;
    const provenance: Provenance = {
      source: 'board',
      regionIds: [this.id()],
      page: this.page,
      bbox: { x: 40, y: (this.clock / 4000) * 60, w: 600, h: 50 },
      t0: this.clock - 3000,
      t1: this.clock,
    };
    return {
      id: this.id(),
      status: confidence >= 0.85 ? ('ready' as const) : ('check' as const),
      provenance,
      recognition: { engine: 'mathpix-strokes', confidence, rawRef: `raw/${this.clock}` },
      decided: { typeBy: 'ai' as const, pinned: false },
    };
  }

  p(...inlines: (Inline | string)[]): Paragraph {
    return { ...this.base(), type: 'paragraph', inlines: inlines.map((i) => this.inline(i)) };
  }

  math(...lines: string[]): DisplayMath {
    return { ...this.base(), type: 'displayMath', lines };
  }

  /** Display math recognized with low confidence (status Check). */
  mathCheck(...lines: string[]): DisplayMath {
    return { ...this.base(0.7), type: 'displayMath', lines };
  }

  figure(source: FigureSource, altText?: string, caption?: string): Figure {
    return {
      ...this.base(),
      type: 'figure',
      figure: source,
      ...(altText !== undefined ? { altText } : {}),
      altTextConfirmed: altText !== undefined,
      ...(caption !== undefined ? { caption } : {}),
    };
  }

  table(rows: (Inline | string)[][], headerRow = true): Table {
    return {
      ...this.base(),
      type: 'table',
      headerRow,
      rows: rows.map((row) => row.map((cell) => ({ inlines: [this.inline(cell)] }))),
    };
  }

  list(ordered: boolean, ...items: (Inline | string | (Inline | string)[])[]): List {
    return {
      ...this.base(),
      type: 'list',
      ordered,
      items: items.map((item) => ({
        inlines: (Array.isArray(item) ? item : [item]).map((i) => this.inline(i)),
      })),
    };
  }

  image(assetRef: string, reason: ImageFallback['reason'], altText?: string): ImageFallback {
    return {
      ...this.base(0.4),
      status: 'image',
      type: 'imageFallback',
      assetRef,
      reason,
      ...(altText !== undefined ? { altText } : {}),
    };
  }

  answer(...inlines: (Inline | string)[]): Answer {
    return { ...this.base(), type: 'answer', inlines: inlines.map((i) => this.inline(i)) };
  }

  solution(...steps: ContentBlock[]): Solution {
    return { ...this.base(), type: 'solution', steps };
  }

  part(prompt: ContentBlock[], extra: { solution?: Solution; answer?: Answer } = {}): ProblemPart {
    return { ...this.base(), type: 'part', prompt, ...extra };
  }

  problem(
    prompt: ContentBlock[],
    extra: { parts?: ProblemPart[]; solution?: Solution; answer?: Answer; points?: number } = {},
  ): Problem {
    const { parts = [], ...rest } = extra;
    return { ...this.base(), type: 'problem', prompt, parts, ...rest };
  }

  callout(
    kind: CalloutKind,
    body: ContentBlock[],
    extra: { title?: string; solution?: Solution } = {},
  ): Callout {
    return { ...this.base(), type: 'callout', kind, body, ...extra };
  }

  section(title: string | undefined, ...blocks: Block[]): Section {
    return { id: this.id(), ...(title !== undefined ? { title } : {}), blocks };
  }

  doc(meta: DocMeta, ...sections: Section[]): Doc {
    return { id: this.id(), sessionId: this.id(), version: 1, meta, sections };
  }

  private inline(value: Inline | string): Inline {
    return typeof value === 'string' ? this.t(value) : value;
  }
}

/** Marks a block excluded, as structuring would for crossed-out work. */
export function excluded<T extends Block>(
  block: T,
  reason: NonNullable<Block['excludedReason']>,
): T {
  return { ...block, status: 'excluded', excludedReason: reason, statusBeforeExclusion: 'ready' };
}

/** Adds the teacher's "Key result" tag, which Guided Notes turns into a blank. */
export function keyResult<T extends Block>(block: T): T {
  return { ...block, flags: [...(block.flags ?? []), 'keyResult'] };
}
