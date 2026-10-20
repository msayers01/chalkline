import type { z } from 'zod';
import type * as S from './schema.js';

export type Lang = z.infer<typeof S.Lang>;
export type Rect = z.infer<typeof S.Rect>;
export type InkColor = z.infer<typeof S.InkColor>;
export type BlockStatus = z.infer<typeof S.BlockStatus>;
export type ExcludedReason = z.infer<typeof S.ExcludedReason>;
export type Provenance = z.infer<typeof S.Provenance>;
export type Recognition = z.infer<typeof S.Recognition>;
export type Decided = z.infer<typeof S.Decided>;
export type BlockFlag = z.infer<typeof S.BlockFlag>;
export type TextStyle = z.infer<typeof S.TextStyle>;
export type Inline = z.infer<typeof S.Inline>;
export type TextInline = Extract<Inline, { kind: 'text' }>;
export type MathInline = Extract<Inline, { kind: 'math' }>;

export type Paragraph = z.infer<typeof S.Paragraph>;
export type DisplayMath = z.infer<typeof S.DisplayMath>;
export type PlotSpec = z.infer<typeof S.PlotSpec>;
export type FigureSource = z.infer<typeof S.FigureSource>;
export type Figure = z.infer<typeof S.Figure>;
export type TableCell = z.infer<typeof S.TableCell>;
export type Table = z.infer<typeof S.Table>;
export type ListItem = z.infer<typeof S.ListItem>;
export type List = z.infer<typeof S.List>;
export type ImageFallback = z.infer<typeof S.ImageFallback>;
export type ContentBlock = z.infer<typeof S.ContentBlock>;
export type Answer = z.infer<typeof S.Answer>;
export type Solution = z.infer<typeof S.Solution>;
export type ProblemPart = z.infer<typeof S.ProblemPart>;
export type Problem = z.infer<typeof S.Problem>;
export type CalloutKind = z.infer<typeof S.CalloutKind>;
export type Callout = z.infer<typeof S.Callout>;
export type Block = z.infer<typeof S.Block>;
export type Section = z.infer<typeof S.Section>;
export type DocMeta = z.infer<typeof S.DocMeta>;
export type Doc = z.infer<typeof S.Doc>;

/** Any node that carries a block id, including nested ones (parts, answers, solutions). */
export type AnyBlock = Block | ProblemPart | Answer;
export type BlockType = AnyBlock['type'];
