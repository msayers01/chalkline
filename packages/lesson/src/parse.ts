import {
  sequentialIds,
  type Answer,
  type Block,
  type BlockFlag,
  type Callout,
  type CalloutKind,
  type ContentBlock,
  type Doc,
  type DocMeta,
  type Inline,
  type Lang,
  type Problem,
  type ProblemPart,
  type Section,
  type Solution,
} from '@chalkline/ir';

/**
 * The lesson format: a small, Markdown-like way to write a lesson by hand.
 * See README.md in this package for the full syntax. Parsing is strict:
 * anything ambiguous is an error with a line number, never a guess.
 */

export type LessonError = { line: number; message: string };

export type ParsedLesson =
  | {
      ok: true;
      doc: Doc;
      /** 1-based source line where each block starts, for messages that point back at the file. */
      lines: ReadonlyMap<string, number>;
    }
  | { ok: false; errors: LessonError[] };

const CALLOUTS: readonly CalloutKind[] = [
  'definition',
  'theorem',
  'note',
  'example',
  'announcement',
];
const LANGS: readonly Lang[] = ['en', 'es', 'fr', 'de', 'pt'];
const TAGS = new Set(['key', 'check', 'crossed-out', 'excluded']);

type Tags = { key: boolean; check: boolean; excluded: 'crossedOut' | 'teacher' | undefined };

class LessonSyntaxError extends Error {
  constructor(
    readonly line: number,
    message: string,
  ) {
    super(message);
  }
}

export function parseLesson(source: string): ParsedLesson {
  try {
    return new Parser(source).parse();
  } catch (e) {
    if (e instanceof LessonSyntaxError)
      return { ok: false, errors: [{ line: e.line, message: e.message }] };
    throw e;
  }
}

type Container =
  | { kind: 'callout'; callout: Callout; line: number; inSolution: boolean }
  | {
      kind: 'problem';
      problem: Problem;
      line: number;
      part: ProblemPart | undefined;
      inSolution: boolean;
    };

class Parser {
  private readonly lines: string[];
  private readonly nextId = sequentialIds('01JPRV00000000000000');
  private readonly lineOf = new Map<string, number>();
  private i = 0;
  private clock = 0;
  private sections: Section[] = [];
  private container: Container | undefined;

  constructor(source: string) {
    this.lines = source.replace(/\r\n?/g, '\n').split('\n');
  }

  parse(): ParsedLesson {
    const meta = this.frontMatter();
    while (this.i < this.lines.length) this.statement();
    if (this.container)
      throw new LessonSyntaxError(
        this.container.line,
        `"::: ${this.container.kind === 'problem' ? 'problem' : this.container.callout.kind}" is never closed with ":::"`,
      );
    const doc: Doc = {
      id: this.nextId(),
      sessionId: this.nextId(),
      version: 1,
      meta,
      sections: this.sections,
    };
    return { ok: true, doc, lines: this.lineOf };
  }

  // -- structure -------------------------------------------------------------

  private frontMatter(): DocMeta {
    const fields = new Map<string, string>();
    if (this.lines[0]?.trim() === '---') {
      this.i = 1;
      while (this.i < this.lines.length && this.lines[this.i]?.trim() !== '---') {
        const raw = this.lines[this.i] ?? '';
        if (raw.trim()) {
          const m = /^\s*([a-z]+)\s*:\s*(.*?)\s*$/i.exec(raw);
          if (!m)
            throw new LessonSyntaxError(
              this.i + 1,
              'front matter lines look like "title: Solving quadratics"',
            );
          fields.set((m[1] ?? '').toLowerCase(), m[2] ?? '');
        }
        this.i += 1;
      }
      if (this.i >= this.lines.length)
        throw new LessonSyntaxError(1, 'front matter starts with "---" but never ends');
      this.i += 1;
    }
    const lang = (fields.get('lang') ?? 'en') as Lang;
    if (!LANGS.includes(lang))
      throw new LessonSyntaxError(1, `lang must be one of ${LANGS.join(', ')}`);
    const date = fields.get('date') ?? '2026-01-01';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
      throw new LessonSyntaxError(1, 'date must look like 2026-10-20');
    const unit = fields.get('unit');
    return {
      title: fields.get('title') ?? 'Untitled lesson',
      course: fields.get('course') ?? '',
      teacher: fields.get('teacher') ?? '',
      date,
      lang,
      ...(unit ? { unit } : {}),
    };
  }

  private statement(): void {
    const line = this.lines[this.i] ?? '';
    const trimmed = line.trim();
    const lineNo = this.i + 1;

    if (trimmed === '') {
      this.i += 1;
      return;
    }

    const heading = /^#\s+(.+)$/.exec(trimmed);
    if (heading) {
      if (this.container)
        throw new LessonSyntaxError(
          lineNo,
          'close the open ":::" block before starting a new section',
        );
      this.sections.push({ id: this.nextId(), title: heading[1] ?? '', blocks: [] });
      this.i += 1;
      return;
    }

    if (trimmed.startsWith(':::')) {
      this.containerLine(trimmed, lineNo);
      this.i += 1;
      return;
    }

    if (this.container?.kind === 'problem') {
      const part = /^\(?([a-z])\)\s*(.*)$/.exec(trimmed);
      if (part && trimmed.startsWith('(')) {
        this.startPart(lineNo);
        this.i += 1;
        if (part[2]) this.content(part[2], lineNo);
        return;
      }
    }

    const solution = /^solution\s*:\s*(.*)$/i.exec(trimmed);
    if (solution) {
      this.startSolution(lineNo);
      this.i += 1;
      if (solution[1]) this.content(solution[1], lineNo);
      return;
    }

    const answer = /^answer\s*:\s*(.*)$/i.exec(trimmed);
    if (answer) {
      this.answer(answer[1] ?? '', lineNo);
      this.i += 1;
      return;
    }

    this.contentBlock();
  }

  private containerLine(trimmed: string, lineNo: number): void {
    if (trimmed === ':::') {
      if (!this.container)
        throw new LessonSyntaxError(lineNo, '":::" closes a block, but none is open');
      this.container = undefined;
      return;
    }
    if (this.container)
      throw new LessonSyntaxError(
        lineNo,
        '":::" blocks cannot be nested; close the open one first',
      );
    const { text, tags } = splitTags(trimmed.slice(3).trim(), lineNo);
    const m = /^([a-z]+)\b\s*(.*)$/i.exec(text);
    const kind = (m?.[1] ?? '').toLowerCase();
    const rest = (m?.[2] ?? '').trim();

    if (kind === 'problem') {
      let points: number | undefined;
      if (rest) {
        const p = /^(\d{1,4})\s*(?:points?|pts?)?$/i.exec(rest);
        if (!p) throw new LessonSyntaxError(lineNo, 'write points as "::: problem 5 points"');
        points = Number(p[1]);
      }
      const problem: Problem = {
        ...this.base(lineNo, tags),
        type: 'problem',
        prompt: [],
        parts: [],
        ...(points ? { points } : {}),
      };
      this.place(problem);
      this.container = {
        kind: 'problem',
        problem,
        line: lineNo,
        part: undefined,
        inSolution: false,
      };
      return;
    }
    if ((CALLOUTS as readonly string[]).includes(kind)) {
      const callout: Callout = {
        ...this.base(lineNo, tags),
        type: 'callout',
        kind: kind as CalloutKind,
        body: [],
        ...(rest ? { title: rest } : {}),
      };
      this.place(callout);
      this.container = { kind: 'callout', callout, line: lineNo, inSolution: false };
      return;
    }
    throw new LessonSyntaxError(
      lineNo,
      `unknown block "${kind}"; use problem, ${CALLOUTS.join(', ')}`,
    );
  }

  private startPart(lineNo: number): void {
    const c = this.container;
    if (c?.kind !== 'problem')
      throw new LessonSyntaxError(lineNo, 'parts like "(a)" belong inside "::: problem"');
    const part: ProblemPart = { ...this.base(lineNo, noTags()), type: 'part', prompt: [] };
    c.problem.parts.push(part);
    c.part = part;
    c.inSolution = false;
  }

  private startSolution(lineNo: number): void {
    const c = this.container;
    if (!c || (c.kind === 'callout' && c.callout.kind !== 'example')) {
      throw new LessonSyntaxError(
        lineNo,
        '"Solution:" belongs inside "::: problem" or "::: example"',
      );
    }
    const solution: Solution = { ...this.base(lineNo, noTags()), type: 'solution', steps: [] };
    if (c.kind === 'callout') {
      if (c.callout.solution)
        throw new LessonSyntaxError(lineNo, 'this example already has a solution');
      c.callout.solution = solution;
    } else {
      const owner = c.part ?? c.problem;
      if (owner.solution)
        throw new LessonSyntaxError(lineNo, 'this problem or part already has a solution');
      owner.solution = solution;
    }
    c.inSolution = true;
  }

  private answer(text: string, lineNo: number): void {
    const c = this.container;
    if (c?.kind !== 'problem')
      throw new LessonSyntaxError(lineNo, '"Answer:" belongs inside "::: problem"');
    const owner = c.part ?? c.problem;
    if (owner.answer)
      throw new LessonSyntaxError(lineNo, 'this problem or part already has an answer');
    const { text: body, tags } = splitTags(text, lineNo);
    if (!body.trim())
      throw new LessonSyntaxError(lineNo, '"Answer:" needs the answer on the same line');
    const answer: Answer = {
      ...this.base(lineNo, tags),
      type: 'answer',
      inlines: parseInlines(body, lineNo),
    };
    owner.answer = answer;
    c.inSolution = false;
  }

  // -- content ---------------------------------------------------------------

  /** Content that starts on the rest of a directive line ("(a) Solve $x$."). */
  private content(text: string, lineNo: number): void {
    const { text: body, tags } = splitTags(text, lineNo);
    if (/^\$\$.*\$\$$/.test(body.trim())) {
      this.add(this.displayMath([body.trim().slice(2, -2).trim()], lineNo, tags));
      return;
    }
    this.add({
      ...this.base(lineNo, tags),
      type: 'paragraph',
      inlines: parseInlines(body, lineNo),
    });
  }

  private contentBlock(): void {
    const lineNo = this.i + 1;
    const trimmed = (this.lines[this.i] ?? '').trim();

    if (trimmed.startsWith('$$')) {
      this.add(this.displayBlock());
      return;
    }
    const figure = /^!\[(.*)\]\(([A-Za-z0-9_-]{1,64})\)\s*(\{[^}]*\})?$/.exec(trimmed);
    if (figure) {
      const tags = splitTags(figure[3] ?? '', lineNo).tags;
      const alt = figure[1] ?? '';
      this.add({
        ...this.base(lineNo, tags),
        type: 'figure',
        figure: { kind: 'raster', assetRef: figure[2] ?? '' },
        ...(alt ? { altText: alt } : {}),
        altTextConfirmed: alt !== '',
      });
      this.i += 1;
      return;
    }
    if (trimmed.startsWith('|')) {
      this.add(this.table());
      return;
    }
    if (/^(?:[-*]|\d+[.)])\s+/.test(trimmed)) {
      this.add(this.list());
      return;
    }
    this.add(this.paragraph());
  }

  private displayBlock(): ContentBlock {
    const lineNo = this.i + 1;
    const first = (this.lines[this.i] ?? '').trim();
    const { text: single, tags: singleTags } = splitTags(first, lineNo);
    if (single.length > 4 && single.endsWith('$$')) {
      this.i += 1;
      return this.displayMath([single.slice(2, -2).trim()], lineNo, singleTags);
    }
    if (single !== '$$')
      throw new LessonSyntaxError(
        lineNo,
        'display math is "$$ x = 1 $$" on one line, or "$$" on its own line around the lines of a derivation',
      );
    const body: string[] = [];
    this.i += 1;
    while (this.i < this.lines.length) {
      const raw = (this.lines[this.i] ?? '').trim();
      const closing = splitTags(raw, this.i + 1);
      if (closing.text === '$$') {
        this.i += 1;
        if (body.length === 0) throw new LessonSyntaxError(lineNo, 'empty $$ block');
        return this.displayMath(body, lineNo, closing.tags);
      }
      if (raw) body.push(raw);
      this.i += 1;
    }
    throw new LessonSyntaxError(lineNo, '"$$" is never closed');
  }

  private displayMath(lines: string[], lineNo: number, tags: Tags): ContentBlock {
    return { ...this.base(lineNo, tags), type: 'displayMath', lines };
  }

  private paragraph(): ContentBlock {
    const lineNo = this.i + 1;
    const parts: string[] = [];
    while (this.i < this.lines.length) {
      const raw = (this.lines[this.i] ?? '').trim();
      if (!raw || this.startsSomethingElse(raw)) break;
      parts.push(raw);
      this.i += 1;
    }
    const { text, tags } = splitTags(parts.join(' '), lineNo);
    return { ...this.base(lineNo, tags), type: 'paragraph', inlines: parseInlines(text, lineNo) };
  }

  private list(): ContentBlock {
    const lineNo = this.i + 1;
    const ordered = /^\d+[.)]\s+/.test((this.lines[this.i] ?? '').trim());
    const items: { inlines: Inline[] }[] = [];
    while (this.i < this.lines.length) {
      const raw = (this.lines[this.i] ?? '').trim();
      const m = ordered ? /^\d+[.)]\s+(.*)$/.exec(raw) : /^[-*]\s+(.*)$/.exec(raw);
      if (!m) break;
      items.push({ inlines: parseInlines(m[1] ?? '', this.i + 1) });
      this.i += 1;
    }
    return { ...this.base(lineNo, noTags()), type: 'list', ordered, items };
  }

  private table(): ContentBlock {
    const lineNo = this.i + 1;
    const rows: string[][] = [];
    let headerRow = false;
    while (this.i < this.lines.length) {
      const raw = (this.lines[this.i] ?? '').trim();
      if (!raw.startsWith('|')) break;
      const cells = raw
        .replace(/^\||\|$/g, '')
        .split('|')
        .map((c) => c.trim());
      if (cells.every((c) => /^:?-{3,}:?$/.test(c))) {
        if (rows.length !== 1)
          throw new LessonSyntaxError(
            this.i + 1,
            'the |---| separator goes right after the header row',
          );
        headerRow = true;
      } else {
        rows.push(cells);
      }
      this.i += 1;
    }
    return {
      ...this.base(lineNo, noTags()),
      type: 'table',
      headerRow,
      rows: rows.map((cells) => cells.map((cell) => ({ inlines: parseInlines(cell, lineNo) }))),
    };
  }

  private startsSomethingElse(raw: string): boolean {
    if (/^(#\s|:::|\$\$|!\[|\||(?:[-*]|\d+[.)])\s)/.test(raw)) return true;
    if (/^(solution|answer)\s*:/i.test(raw)) return true;
    return this.container?.kind === 'problem' && /^\([a-z]\)/.test(raw);
  }

  /** Puts a content block wherever the parser currently is. */
  private add(block: ContentBlock): void {
    const c = this.container;
    if (!c) {
      this.place(block);
      return;
    }
    if (c.kind === 'callout') {
      if (c.inSolution && c.callout.solution) c.callout.solution.steps.push(block);
      else c.callout.body.push(block);
      return;
    }
    const owner = c.part ?? c.problem;
    if (c.inSolution && owner.solution) owner.solution.steps.push(block);
    else if (owner.answer)
      throw new LessonSyntaxError(
        this.lineOf.get(block.id) ?? 0,
        'content after "Answer:" must start a new part or close the problem',
      );
    else owner.prompt.push(block);
  }

  /** Adds a top-level block, opening an untitled section if none exists yet. */
  private place(block: Block): void {
    let section = this.sections[this.sections.length - 1];
    if (!section) {
      section = { id: this.nextId(), blocks: [] };
      this.sections.push(section);
    }
    section.blocks.push(block);
  }

  private base(lineNo: number, tags: Tags) {
    this.clock += 1000;
    const id = this.nextId();
    this.lineOf.set(id, lineNo);
    const flags: BlockFlag[] = tags.key ? ['keyResult'] : [];
    const status = tags.excluded
      ? ('excluded' as const)
      : tags.check
        ? ('check' as const)
        : ('ready' as const);
    return {
      id,
      status,
      provenance: {
        source: 'typed' as const,
        regionIds: [],
        page: 0,
        bbox: { x: 0, y: lineNo * 20, w: 600, h: 20 },
        t0: this.clock,
        t1: this.clock,
      },
      decided: { typeBy: 'teacher' as const, pinned: false },
      ...(flags.length ? { flags } : {}),
      ...(tags.excluded
        ? { excludedReason: tags.excluded, statusBeforeExclusion: 'ready' as const }
        : {}),
    };
  }
}

function noTags(): Tags {
  return { key: false, check: false, excluded: undefined };
}

/** Strips a trailing "{key, check}" tag list. */
function splitTags(text: string, lineNo: number): { text: string; tags: Tags } {
  const m = /^(.*?)\s*\{([a-z,\s-]+)\}\s*$/.exec(text);
  if (!m) return { text, tags: noTags() };
  const names = (m[2] ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  for (const name of names) {
    if (!TAGS.has(name))
      throw new LessonSyntaxError(
        lineNo,
        `unknown tag {${name}}; use {key}, {check}, {crossed-out} or {excluded}`,
      );
  }
  return {
    text: m[1] ?? '',
    tags: {
      key: names.includes('key'),
      check: names.includes('check'),
      excluded: names.includes('crossed-out')
        ? 'crossedOut'
        : names.includes('excluded')
          ? 'teacher'
          : undefined,
    },
  };
}

/**
 * Inline content: text with $math$, **bold** and *italic*. `\$` is a literal
 * dollar sign in text; inside math, backslash sequences are kept as written.
 */
export function parseInlines(text: string, lineNo = 0): Inline[] {
  const out: Inline[] = [];
  let buf = '';
  let bold = false;
  let italic = false;
  const flush = () => {
    if (!buf) return;
    const style = { ...(bold ? { bold: true } : {}), ...(italic ? { italic: true } : {}) };
    out.push({ kind: 'text', text: buf, ...(bold || italic ? { style } : {}) });
    buf = '';
  };

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '\\' && text[i + 1] === '$') {
      buf += '$';
      i += 1;
      continue;
    }
    if (ch === '$') {
      let j = i + 1;
      let math = '';
      while (j < text.length && text[j] !== '$') {
        if (text[j] === '\\' && j + 1 < text.length) {
          math += text.slice(j, j + 2);
          j += 2;
          continue;
        }
        math += text[j];
        j += 1;
      }
      if (j >= text.length)
        throw new LessonSyntaxError(
          lineNo,
          'a "$" opens math but nothing closes it (write \\$ for a dollar sign)',
        );
      flush();
      out.push({ kind: 'math', latex: math.trim() });
      i = j;
      continue;
    }
    if (ch === '*' && text[i + 1] === '*') {
      flush();
      bold = !bold;
      i += 1;
      continue;
    }
    if (ch === '*') {
      flush();
      italic = !italic;
      continue;
    }
    buf += ch;
  }
  if (bold || italic) throw new LessonSyntaxError(lineNo, 'a "*" or "**" is never closed');
  flush();
  return out;
}
