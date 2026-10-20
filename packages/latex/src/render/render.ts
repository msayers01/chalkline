import {
  mathTransformsFor,
  type Conventions,
  type MathTransform,
  type TransformNote,
} from '@chalkline/conventions';
import type {
  Answer,
  Callout,
  ContentBlock,
  DisplayMath,
  Figure,
  ImageFallback,
  Inline,
  InkColor,
  List,
  Paragraph,
  Solution,
  Table,
  ViewBlock,
  ViewDoc,
  ViewPart,
} from '@chalkline/ir';
import {
  EMPTY,
  assetPath,
  blockMarker,
  escapeText,
  inkColorName,
  joinLatex,
  sanitizeMath,
  tex,
  texId,
  texInt,
  type SafeLatex,
  type SanitizeErrorCode,
} from '../safe/index.js';
import { isCoveredText } from './coverage.js';
import type { Labels, LatexTemplate } from './template.js';

export type SourceMapEntry = {
  blockId: string;
  /** 1-based, inclusive; the first line is the block's `% blk:` marker. */
  startLine: number;
  endLine: number;
};

export type RenderIssue =
  | { blockId: string; code: 'mathRejected'; reason: SanitizeErrorCode }
  /** Text the fonts may not cover; `blockId` is null for titles and header fields. */
  | { blockId: string | null; code: 'unsupportedCharacter' };

export type BlockNote = TransformNote & { blockId: string };

export type AssetUse = { ref: string; path: string };

export type LatexRendering = {
  tex: SafeLatex;
  sourceMap: SourceMapEntry[];
  /** Math that failed the sanitizer at render time and was replaced by a placeholder. */
  issues: RenderIssue[];
  /** Convention changes the engine made, for review to mark and revert. */
  applied: BlockNote[];
  /** Convention changes the engine was unsure about, listed in review. */
  suggestions: BlockNote[];
  assets: AssetUse[];
};

/**
 * Renders a view tree to a complete .tex file. Pure and deterministic: the
 * same view, template and conventions always give byte-identical output.
 */
export function renderLatex(
  view: ViewDoc,
  template: LatexTemplate,
  conventions: Conventions,
): LatexRendering {
  const r = new Renderer(template, conventions);
  return r.document(view);
}

const NEWLINE = tex`
`;

/** Collects output lines and the source map. Line numbers are 1-based. */
class Writer {
  private readonly chunks: SafeLatex[] = [];
  private lineCount = 0;
  readonly sourceMap: SourceMapEntry[] = [];

  /** Appends text. Empty text is dropped: a blank line inside math or an argument would end the paragraph. */
  line(text: SafeLatex): void {
    if (text.length === 0) return;
    this.chunks.push(text);
    this.lineCount += 1 + (text.match(/\n/g)?.length ?? 0);
  }

  blank(): void {
    if (this.chunks.length > 0 && this.chunks[this.chunks.length - 1] !== EMPTY) {
      this.chunks.push(EMPTY);
      this.lineCount += 1;
    }
  }

  block(id: string, body: () => void): void {
    this.line(blockMarker(id));
    const startLine = this.lineCount;
    body();
    this.sourceMap.push({ blockId: id, startLine, endLine: this.lineCount });
  }

  toString(): SafeLatex {
    return joinLatex(this.chunks, NEWLINE);
  }
}

class Renderer {
  private readonly w = new Writer();
  private readonly labels: Labels;
  private readonly transforms: MathTransform[];
  private readonly issues: RenderIssue[] = [];
  private readonly applied: BlockNote[] = [];
  private readonly suggestions: BlockNote[] = [];
  private readonly assets: AssetUse[] = [];

  constructor(
    private readonly template: LatexTemplate,
    private readonly conventions: Conventions,
  ) {
    this.labels = template.labels;
    this.transforms = mathTransformsFor(conventions);
  }

  document(view: ViewDoc): LatexRendering {
    const { w, template, labels } = this;
    const meta = view.meta;
    for (const field of [meta.title, meta.course, meta.teacher, meta.unit ?? ''])
      this.checkText(null, field);
    for (const section of view.sections) this.checkText(null, section.title ?? '');

    w.line(
      tex`% Chalkline handout: ${template.presetName} (preset ${template.presetId} v${texInt(template.presetVersion)}).`,
    );
    w.line(tex`% Document ${texId(view.docId)}, version ${texInt(view.version)}.`);
    w.line(tex`% Compile with LuaLaTeX, TeX Live 2025 or later: latexmk -lualatex main.tex`);
    w.line(
      tex`\DocumentMetadata{lang=${langTag(meta.lang)}, pdfversion=2.0, pdfstandard=ua-2, tagging=on, tagging-setup={math/setup=mathml-SE}}`,
    );
    w.line(tex`\documentclass[${template.classOptions}]{article}`);
    w.line(template.preamble);
    w.line(tex`\hypersetup{pdftitle={${escapeText(meta.title)}}, pdfdisplaydoctitle=true}`);
    const [left, right, footer] = this.headerParts(view);
    w.line(tex`\clheader{${left}}{${right}}`);
    w.line(tex`\clfooter{${footer}}`);
    w.blank();
    w.line(tex`\begin{document}`);
    w.line(tex`\cltitle{${escapeText(meta.title)}}{${this.details(view)}}`);
    if (template.titleBlock === 'quiz') {
      w.line(
        tex`\clquizheader{${escapeText(labels.name)}}{${escapeText(labels.date)}}{${escapeText(labels.score)}}`,
      );
    }

    for (const section of view.sections) {
      w.blank();
      if (section.title !== undefined) w.line(tex`\section*{${escapeText(section.title)}}`);
      for (const block of section.blocks) {
        w.blank();
        this.viewBlock(block);
      }
    }

    w.blank();
    w.line(tex`\end{document}`);

    return {
      tex: tex`${w.toString()}${NEWLINE}`,
      sourceMap: [...w.sourceMap].sort((a, b) => a.startLine - b.startLine),
      issues: this.issues,
      applied: this.applied,
      suggestions: this.suggestions,
      assets: this.assets,
    };
  }

  private headerParts(view: ViewDoc): [SafeLatex, SafeLatex, SafeLatex] {
    const { meta } = view;
    const fields = new Set(this.conventions.header);
    const left: string[] = [];
    const right: string[] = [];
    if (fields.has('course')) left.push(meta.course);
    if (fields.has('unit') && meta.unit) left.push(meta.unit);
    if (fields.has('lessonTitle')) right.push(meta.title);
    if (fields.has('teacher')) right.push(meta.teacher);
    if (fields.has('date')) right.push(this.labels.formatDate(meta.date));
    const footer = fields.has('pageXofY')
      ? tex`${escapeText(this.labels.page)} \thepage\ ${escapeText(this.labels.pageOf)} \pageref{LastPage}`
      : EMPTY;
    return [escapeText(left.join(' · ')), escapeText(right.join(' · ')), footer];
  }

  private details(view: ViewDoc): SafeLatex {
    const { meta } = view;
    const parts = [meta.course, meta.teacher, this.labels.formatDate(meta.date), meta.unit].filter(
      (p): p is string => !!p,
    );
    return escapeText(parts.join(' · '));
  }

  private viewBlock(view: ViewBlock): void {
    switch (view.kind) {
      case 'content':
        this.content(view.block);
        return;
      case 'problem':
        this.w.block(view.block.id, () => {
          const points =
            view.block.points !== undefined
              ? escapeText(this.labels.points(view.block.points))
              : EMPTY;
          this.w.line(tex`\begin{clproblem}{${texInt(view.number)}}{${points}}`);
          this.contents(view.block.prompt);
          if (view.parts.length > 0) {
            this.w.line(tex`\begin{clparts}`);
            for (const part of view.parts) this.part(part);
            this.w.line(tex`\end{clparts}`);
          }
          this.work(view.solution, view.answer, view.answerLines);
          this.w.line(tex`\end{clproblem}`);
        });
        return;
      case 'callout':
        this.callout(view.block, view.solution);
        return;
      case 'solution':
        this.solution(view.block);
        return;
    }
  }

  private part(view: ViewPart): void {
    this.w.block(view.part.id, () => {
      this.w.line(tex`\item`);
      this.contents(view.part.prompt);
      this.work(view.solution, view.answer, view.answerLines);
    });
  }

  private work(
    solution: Solution | undefined,
    answer: Answer | undefined,
    answerLines: number | undefined,
  ): void {
    if (solution) this.solution(solution);
    if (answer) this.answer(answer);
    if (answerLines !== undefined) this.w.line(tex`\clanswerspace{${texInt(answerLines)}}`);
  }

  private solution(solution: Solution): void {
    this.w.block(solution.id, () => {
      this.w.line(tex`\begin{clsolution}{${escapeText(this.labels.solution)}}`);
      this.contents(solution.steps);
      this.w.line(tex`\end{clsolution}`);
    });
  }

  private answer(answer: Answer): void {
    this.w.block(answer.id, () => {
      const label = escapeText(this.labels.answer);
      const body = this.inlines(answer.id, answer.inlines);
      if (this.conventions.finalAnswers === 'boxed')
        this.w.line(tex`\clanswerboxed{${label}}{${body}}`);
      else this.w.line(tex`\clanswer{${label}}{${body}}`);
    });
  }

  private callout(callout: Callout, solution: Solution | undefined): void {
    const env = CALLOUT_ENV[callout.kind];
    this.w.block(callout.id, () => {
      const label = escapeText(this.labels[callout.kind]);
      const title = callout.title !== undefined ? escapeText(callout.title) : EMPTY;
      this.w.line(tex`\begin{${env}}{${label}}{${title}}`);
      this.contents(callout.body);
      if (solution) this.solution(solution);
      this.w.line(tex`\end{${env}}`);
    });
  }

  private contents(blocks: ContentBlock[]): void {
    for (const block of blocks) this.content(block);
  }

  private content(block: ContentBlock): void {
    this.w.block(block.id, () => {
      switch (block.type) {
        case 'paragraph':
          this.paragraph(block);
          return;
        case 'displayMath':
          this.displayMath(block);
          return;
        case 'figure':
          this.figure(block);
          return;
        case 'imageFallback':
          this.imageFallback(block);
          return;
        case 'table':
          this.table(block);
          return;
        case 'list':
          this.list(block);
          return;
      }
    });
  }

  private paragraph(block: Paragraph): void {
    this.w.line(this.inlines(block.id, block.inlines));
    this.w.blank();
  }

  private inlines(blockId: string, inlines: Inline[]): SafeLatex {
    return joinLatex(inlines.map((inline) => this.inline(blockId, inline)));
  }

  private inline(blockId: string, inline: Inline): SafeLatex {
    if (inline.kind === 'text') {
      this.checkText(blockId, inline.text);
      let out = escapeText(inline.text);
      if (inline.style?.italic) out = tex`\textit{${out}}`;
      if (inline.style?.bold) out = tex`\textbf{${out}}`;
      return this.colored(out, inline.color);
    }
    const math = this.math(blockId, inline.latex, false);
    if (!math) return tex`\clplaceholder{${escapeText(this.labels.mathPlaceholder)}}`;
    return this.colored(tex`\(${math.latex}\)`, inline.color);
  }

  private checkText(blockId: string | null, text: string): void {
    if (isCoveredText(text)) return;
    if (this.issues.some((i) => i.code === 'unsupportedCharacter' && i.blockId === blockId)) return;
    this.issues.push({ blockId, code: 'unsupportedCharacter' });
  }

  private colored(content: SafeLatex, color: InkColor | undefined): SafeLatex {
    if (
      !color ||
      color === 'black' ||
      color === 'white' ||
      this.conventions.inkColor === 'monochrome'
    )
      return content;
    return tex`\textcolor{${inkColorName(color)}}{${content}}`;
  }

  /** Sanitizes one math string, recording notes and failures against the block. */
  private math(
    blockId: string,
    latex: string,
    align: boolean,
  ): { latex: SafeLatex; aligned: boolean } | undefined {
    const result = sanitizeMath(latex, { transforms: this.transforms, alignAtRelation: align });
    if (!result.ok) {
      this.issues.push({ blockId, code: 'mathRejected', reason: result.error.code });
      return undefined;
    }
    this.checkText(blockId, latex);
    for (const note of result.applied) this.applied.push({ blockId, ...note });
    for (const note of result.suggestions) this.suggestions.push({ blockId, ...note });
    return { latex: result.latex, aligned: result.aligned };
  }

  private displayMath(block: DisplayMath): void {
    const numbered = this.conventions.equationNumbers === 'all';
    const placeholder = tex`\text{${escapeText(this.labels.mathPlaceholder)}}`;
    const color =
      block.color &&
      block.color !== 'black' &&
      block.color !== 'white' &&
      this.conventions.inkColor === 'keepColors'
        ? inkColorName(block.color)
        : undefined;
    if (color) this.w.line(tex`\begingroup\color{${color}}`);

    if (block.lines.length === 1) {
      const math = this.math(block.id, block.lines[0] ?? '', false);
      this.w.line(numbered ? tex`\begin{equation}` : tex`\[`);
      this.w.line(math ? math.latex : placeholder);
      this.w.line(numbered ? tex`\end{equation}` : tex`\]`);
    } else {
      // Align a derivation at its first relation when every line has one.
      const probe = block.lines.map((line) =>
        sanitizeMath(line, { transforms: this.transforms, alignAtRelation: true }),
      );
      const align = probe.every((r) => r.ok && r.aligned);
      const lines = block.lines.map(
        (line) => this.math(block.id, line, align)?.latex ?? placeholder,
      );
      const env = align
        ? numbered
          ? tex`align`
          : tex`align*`
        : numbered
          ? tex`gather`
          : tex`gather*`;
      this.w.line(tex`\begin{${env}}`);
      this.w.line(
        joinLatex(
          lines,
          tex` \\
`,
        ),
      );
      this.w.line(tex`\end{${env}}`);
    }

    if (color) this.w.line(tex`\endgroup`);
  }

  private figure(block: Figure): void {
    const extension = block.figure.kind === 'raster' ? 'png' : 'pdf';
    const path = assetPath(block.figure.assetRef, extension);
    this.assets.push({ ref: block.figure.assetRef, path });
    this.checkText(block.id, block.altText ?? '');
    this.checkText(block.id, block.caption ?? '');
    const alt = escapeText(block.altText ?? this.labels.figureAlt);
    this.w.line(tex`\begin{center}`);
    this.w.line(tex`\includegraphics[width=0.6\linewidth,alt={${alt}}]{${path}}`);
    if (block.caption !== undefined) {
      this.w.line(tex`\par{\small ${escapeText(block.caption)}}`);
    }
    this.w.line(tex`\end{center}`);
  }

  private imageFallback(block: ImageFallback): void {
    const path = assetPath(block.assetRef, 'png');
    this.assets.push({ ref: block.assetRef, path });
    const alt = escapeText(block.altText ?? this.labels.imageAlt);
    this.w.line(tex`\begin{center}`);
    this.w.line(tex`\includegraphics[width=0.8\linewidth,alt={${alt}}]{${path}}`);
    this.w.line(tex`\end{center}`);
  }

  private table(block: Table): void {
    const columns = Math.max(...block.rows.map((r) => r.length));
    const spec = joinLatex(Array.from({ length: columns }, () => tex`l`));
    const row = (cells: Table['rows'][number]) => {
      const rendered = Array.from({ length: columns }, (_, i) => {
        const cell = cells[i];
        return cell ? this.inlines(block.id, cell.inlines) : EMPTY;
      });
      return tex`${joinLatex(rendered, tex` & `)} \\`;
    };
    this.w.line(tex`\begin{center}`);
    if (block.headerRow) this.w.line(tex`\tagpdfsetup{table/header-rows={1}}`);
    this.w.line(tex`\begin{tabular}{${spec}}`);
    this.w.line(tex`\toprule`);
    block.rows.forEach((cells, i) => {
      this.w.line(row(cells));
      if (i === 0 && block.headerRow) this.w.line(tex`\midrule`);
    });
    this.w.line(tex`\bottomrule`);
    this.w.line(tex`\end{tabular}`);
    this.w.line(tex`\end{center}`);
  }

  private list(block: List): void {
    const env = block.ordered ? tex`enumerate` : tex`itemize`;
    this.w.line(tex`\begin{${env}}`);
    for (const item of block.items) this.w.line(tex`\item ${this.inlines(block.id, item.inlines)}`);
    this.w.line(tex`\end{${env}}`);
  }
}

const CALLOUT_ENV: Record<Callout['kind'], SafeLatex> = {
  definition: tex`cldefinition`,
  theorem: tex`cltheorem`,
  note: tex`clnote`,
  example: tex`clexample`,
  announcement: tex`clannouncement`,
};

const LANG_TAGS: Record<ViewDoc['meta']['lang'], SafeLatex> = {
  en: tex`en`,
  es: tex`es`,
  fr: tex`fr`,
  de: tex`de`,
  pt: tex`pt`,
};

function langTag(lang: ViewDoc['meta']['lang']): SafeLatex {
  return LANG_TAGS[lang];
}
