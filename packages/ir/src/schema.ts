import { z } from 'zod';

/**
 * Zod schemas for the document model. These are the boundary validators for
 * HTTP, SSE, IndexedDB reads and model output; the TypeScript types in
 * `types.ts` are inferred from them so the two can never drift.
 */

export const Lang = z.enum(['en', 'es', 'fr', 'de', 'pt']);

/** ULIDs: 26 Crockford base32 characters. */
export const Id = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/, 'expected a ULID');

/**
 * Asset references end up in file names inside the compile bundle, so they are
 * restricted to a conservative character set.
 */
export const AssetRef = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, 'invalid asset reference');

export const Rect = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  w: z.number().finite().nonnegative(),
  h: z.number().finite().nonnegative(),
});

export const InkColor = z.enum([
  'black',
  'blue',
  'red',
  'green',
  'orange',
  'purple',
  'brown',
  'white',
]);

export const BlockStatus = z.enum(['ready', 'check', 'image', 'excluded']);

/** `interfaceText`: app menus or toolbars that slipped into a capture, filtered by structuring. */
export const ExcludedReason = z.enum([
  'crossedOut',
  'teacher',
  'personalData',
  'projectedSource',
  'interfaceText',
]);

export const Provenance = z.object({
  source: z.enum(['board', 'capture', 'import', 'typed', 'tool']),
  regionIds: z.array(Id),
  page: z.number().int().nonnegative(),
  bbox: Rect,
  /** Writing time window, milliseconds since session start. */
  t0: z.number().nonnegative(),
  t1: z.number().nonnegative(),
});

export const Recognition = z.object({
  engine: z.string().min(1).max(64),
  confidence: z.number().min(0).max(1),
  rawRef: z.string().min(1).max(256),
});

export const Decided = z.object({
  typeBy: z.enum(['teacherTag', 'ai', 'heuristic', 'teacher']),
  pinned: z.boolean(),
});

/**
 * `personalName`: structuring found a name that must not be published without approval.
 * `keyResult`: the teacher's "Key result" quick tag (Guided Notes blanks these).
 */
export const BlockFlag = z.enum(['personalName', 'keyResult']);

const blockBaseShape = {
  id: Id,
  status: BlockStatus,
  provenance: Provenance,
  recognition: Recognition.optional(),
  decided: Decided,
  excludedReason: ExcludedReason.optional(),
  /** Status to restore when an excluded block is included again. */
  statusBeforeExclusion: BlockStatus.exclude(['excluded']).optional(),
  flags: z.array(BlockFlag).optional(),
};

export const TextStyle = z.object({
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
});

export const Inline = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('text'),
    text: z.string().max(20_000),
    style: TextStyle.optional(),
    color: InkColor.optional(),
  }),
  z.object({
    kind: z.literal('math'),
    /** Recognizer or teacher LaTeX. Rendered only through `sanitizeMath()`. */
    latex: z.string().max(4_000),
    color: InkColor.optional(),
  }),
]);

export const Paragraph = z.object({
  ...blockBaseShape,
  type: z.literal('paragraph'),
  inlines: z.array(Inline),
});

export const DisplayMath = z.object({
  ...blockBaseShape,
  type: z.literal('displayMath'),
  /** One equation, or the lines of a derivation in board order. */
  lines: z.array(z.string().max(4_000)).min(1),
  color: InkColor.optional(),
});

export const PlotSpec = z.object({
  /** Function expressions as typed in the plotter, e.g. `x^2 - 3`. */
  functions: z.array(z.object({ expr: z.string().max(200) })).min(1),
  xMin: z.number().finite(),
  xMax: z.number().finite(),
  yMin: z.number().finite(),
  yMax: z.number().finite(),
  grid: z.boolean(),
});

export const FigureSource = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('vector'), assetRef: AssetRef }),
  z.object({ kind: z.literal('raster'), assetRef: AssetRef }),
  z.object({ kind: z.literal('plot'), assetRef: AssetRef, spec: PlotSpec }),
]);

export const Figure = z.object({
  ...blockBaseShape,
  type: z.literal('figure'),
  figure: FigureSource,
  altText: z.string().max(500).optional(),
  altTextConfirmed: z.boolean(),
  caption: z.string().max(500).optional(),
});

export const TableCell = z.object({ inlines: z.array(Inline) });

export const Table = z.object({
  ...blockBaseShape,
  type: z.literal('table'),
  rows: z.array(z.array(TableCell).min(1)).min(1),
  headerRow: z.boolean(),
});

export const ListItem = z.object({ inlines: z.array(Inline) });

export const List = z.object({
  ...blockBaseShape,
  type: z.literal('list'),
  ordered: z.boolean(),
  items: z.array(ListItem).min(1),
});

export const ImageFallback = z.object({
  ...blockBaseShape,
  type: z.literal('imageFallback'),
  assetRef: AssetRef,
  reason: z.enum(['lowConfidence', 'validationFailed', 'recognizerUnavailable', 'projected']),
  altText: z.string().max(500).optional(),
});

/** Leaf content: blocks that never contain other blocks. */
export const ContentBlock = z.discriminatedUnion('type', [
  Paragraph,
  DisplayMath,
  Figure,
  Table,
  List,
  ImageFallback,
]);

export const Answer = z.object({
  ...blockBaseShape,
  type: z.literal('answer'),
  inlines: z.array(Inline).min(1),
});

export const Solution = z.object({
  ...blockBaseShape,
  type: z.literal('solution'),
  steps: z.array(ContentBlock),
});

export const ProblemPart = z.object({
  ...blockBaseShape,
  type: z.literal('part'),
  prompt: z.array(ContentBlock),
  solution: Solution.optional(),
  answer: Answer.optional(),
});

export const Problem = z.object({
  ...blockBaseShape,
  type: z.literal('problem'),
  prompt: z.array(ContentBlock),
  parts: z.array(ProblemPart),
  solution: Solution.optional(),
  answer: Answer.optional(),
  points: z.number().int().positive().max(1000).optional(),
});

export const CalloutKind = z.enum(['definition', 'theorem', 'note', 'example', 'announcement']);

export const Callout = z.object({
  ...blockBaseShape,
  type: z.literal('callout'),
  kind: CalloutKind,
  title: z.string().max(200).optional(),
  body: z.array(ContentBlock),
  /** Only examples carry a worked solution. */
  solution: Solution.optional(),
});

export const Block = z.discriminatedUnion('type', [
  Paragraph,
  DisplayMath,
  Figure,
  Table,
  List,
  ImageFallback,
  Problem,
  Solution,
  Callout,
]);

export const Section = z.object({
  id: Id,
  title: z.string().max(200).optional(),
  /** Set once a teacher edits the title; structuring passes may then only propose. */
  titlePinned: z.boolean().optional(),
  blocks: z.array(Block),
});

/** ISO calendar date (yyyy-mm-dd), produced by the server in the school's time zone. */
export const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected yyyy-mm-dd');

export const DocMeta = z.object({
  title: z.string().max(200),
  course: z.string().max(200),
  teacher: z.string().max(200),
  date: IsoDate,
  unit: z.string().max(200).optional(),
  lang: Lang,
});

export const Doc = z.object({
  id: Id,
  sessionId: Id,
  version: z.number().int().nonnegative(),
  meta: DocMeta,
  sections: z.array(Section),
});
