# Chalkline

Chalkline (working name) turns what a teacher writes on a smartboard into typeset LaTeX handouts: lecture notes, practice worksheets, answer keys and more. Math teachers are the primary audience.

- Product design: [`docs/01-product-design.md`](docs/01-product-design.md)
- Architecture: [`docs/02-architecture.md`](docs/02-architecture.md)
- Guide for coding agents (invariants, layout, commands): [`CLAUDE.md`](CLAUDE.md)

## Status: v0.2 in progress (Built-in Board pipeline)

v0.1 built the document engine: the document model, the one safe path from content to LaTeX, conventions, presets and a compile gate that proves every generated document compiles to a tagged PDF/UA-2 file. v0.2 adds everything between board ink and that document: grouping strokes into regions, recognition, cleanup, AI structuring behind guard checks with a heuristic fallback, and compile probes. The review screen and the board itself (the web app) come next.

| Area                            | State                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/ir`                   | Document model as Zod schemas, patch operations (teacher edits pin blocks; system edits to pinned content become proposals), ULIDs, the preset "select" step (view tree), fixtures                                                                                                                                                                                                     |
| `packages/latex`                | `safe/`: `escapeText()`, `sanitizeMath()` (unified-latex AST, allowlist, ban list, structural checks), the `tex` tagged template and `SafeLatex` brand. Renderer with `% blk:` markers, source maps, placeholders for rejected math, unsupported-character reports. Log parser that maps overfull boxes and errors to blocks                                                           |
| `packages/conventions`          | Convention schema and defaults, resolution chain (preset → school → class → teacher, school locks), math AST transforms: multiplication sign, decimal separator, vectors, differential d (derivative notation is suggestion-only)                                                                                                                                                      |
| `packages/presets`              | All nine presets: Lecture Notes, Guided Notes (and its filled copy), Worked Examples, Practice Worksheet, Answer Key, Quiz, Study Sheet, Exit Ticket, Board Snapshot. Tagged-PDF package allowlist checked against the LaTeX Tagging Project status; preamble modules; labels in en, es, fr, de, pt                                                                                    |
| `packages/lesson`               | A plain-text lesson format ([syntax](packages/lesson/README.md)) for writing lessons by hand, used by `pnpm preview` and tests                                                                                                                                                                                                                                                         |
| `packages/ink`                  | Board ink: stroke grouping into regions, settle detection (clock-free, so replays are deterministic), erase-and-rewrite correction tracking, splitting regions to fit the recognizer's 512 KB request limit                                                                                                                                                                            |
| `packages/providers`            | Mathpix `v3/strokes` and `v3/text` client (data retention opted out), Claude structured-output client (the final pass opts into server-side refusal fallback), recorded providers keyed by a hash of the request so tests never need keys                                                                                                                                              |
| `apps/worker-recognition`       | The four pipeline stages: post-processing (text and math split, repairs, sanitizing, status by confidence, image fallbacks), structuring (prompt, output schema, guard checks, one retry, heuristic structurer, teacher tags and pinned blocks), compile probe with bisection, and the document builder. A board simulator drives it end to end. The queue consumer is not written yet |
| `apps/worker-compile`           | Sandboxed latexmk/LuaLaTeX runner (bubblewrap, no network, no shell escape, paranoid file access, time limit, output cap), compile cache key, pinned TeX Live 2026 toolchain scripts and Dockerfile. The queue consumer is not written yet                                                                                                                                             |
| `tools/preview`                 | `pnpm preview`: a lesson file to `.tex` and PDF with any presets and conventions, optionally through the board pipeline first                                                                                                                                                                                                                                                          |
| `tools/eslint-plugin-chalkline` | `chalkline/no-raw-latex-interpolation`                                                                                                                                                                                                                                                                                                                                                 |
| `tools/compile-matrix`          | Every preset × fixture × key convention variant, an every-allowlisted-command document, random sanitizer output, and documents built by the recognition pipeline from simulated board sessions (with the compile probe running against real TeX), compiled in the sandbox and validated with veraPDF (PDF/UA-2)                                                                        |

Not started yet (see the release plan in the product design): the web app (board, review screen, library), local-first sync, the API and database, Companion Capture, HTML and Word renderers, and the lesson corpus with replay scoring.

## Getting started

Requirements: Node 22.12+ (24 LTS in production), pnpm 10 (`corepack enable`).

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm test            # unit, property and snapshot tests
pnpm test:snap       # .tex snapshots only; `pnpm test:snap -u` when an output change is intended
```

The compile matrix needs TeX Live 2026 with the packages in `apps/worker-compile/toolchain/texlive-packages.txt`, plus bubblewrap for the sandbox and veraPDF for PDF/UA-2 checks:

```bash
apps/worker-compile/toolchain/install-texlive.sh /opt/texlive   # about 2 minutes
apps/worker-compile/toolchain/install-verapdf.sh /opt/verapdf   # needs Java 11+
pnpm compile-matrix              # full matrix
pnpm compile-matrix --quick      # default conventions only
```

`TEXLIVE_BIN` and `VERAPDF` override the tool locations. Outputs (`.tex`, `.pdf`, `.log`, `summary.json`) land in `tools/compile-matrix/out/`.

### Previewing a lesson

Write a lesson in the [lesson format](packages/lesson/README.md) (or start from `tools/preview/examples/quadratics.lesson`) and render it:

```bash
pnpm preview tools/preview/examples/quadratics.lesson                    # notes, worksheet, key
pnpm preview my.lesson --preset all --set font=pagella --set paperSize=a4
pnpm preview my.lesson --board heuristic   # through the board pipeline first
pnpm preview my.lesson --board claude      # ... structured by Claude (ANTHROPIC_API_KEY)
```

PDFs need the TeX Live install above; without it, `.tex` files are written. `--board` writes the lesson on a simulated board (one region per statement or step, labels as a teacher would write them), recognizes it, and structures it with the heuristic structurer, with a model that knows the right answer (`ideal`), or with Claude, so you can compare what each makes of the same lesson.

## Decisions taken while building

These refine the design documents; they are recorded in the architecture document too. Please review them.

1. **No babel in v1.** babel's tagging status is "unchecked" as a whole and French is "currently-incompatible", so presets do not load it. Labels ("Example", "Ejemplo") and dates are localized by the renderer, the PDF language comes from `\DocumentMetadata{lang=...}`, and non-English documents switch hyphenation off rather than hyphenate with English patterns. Revisit per language as the Tagging Project marks them compatible.
2. **Text font fallback.** Latin Modern and TeX Gyre text fonts lack Greek, arrows, relation symbols and Cyrillic, which recognized text often contains; a missing glyph prints as nothing and fails PDF/UA-2. Text now falls back to the matching math font, then FreeSerif/FreeSans. Characters outside the covered ranges (CJK, emoji) are reported as `unsupportedCharacter` render issues so review can flag them.
3. **Callouts without amsthm.** Definitions, theorems, examples and the other callouts are environments defined by the preset (boxed with simple `tcolorbox` boxes where the preset wants it). The renderer emits a small fixed vocabulary (`CONTRACT` in `packages/latex/src/render/template.ts`) and presets decide the look.
4. **The select step lives in `packages/ir`** (`selectView`), so the LaTeX, HTML and Word renderers share one view tree.
5. **Derivative notation is suggestion-only.** Converting between prime and Leibniz notation needs the independent variable, which the board rarely states unambiguously.
6. **`\square` and `\blacksquare` are not allowlisted:** unicode-math does not define them (the compile matrix caught it).

From the recognition pipeline (v0.2):

7. **Short local ids for the model.** The structuring model sees blocks as `b1`, `b2`, ... rather than ULIDs: fewer tokens and no copying mistakes. Guards check the response against those ids and map them back.
8. **Board headings become section titles.** A short line the teacher wrote as a heading gets the role `heading`; its text becomes the section title and the section takes its id. The model writes a title of its own only where there is no heading, and it is reduced to plain text.
9. **Stable container ids.** A problem, part, solution or callout takes an id derived from the block that starts it, so every structuring pass gives the same ids and patches keep pointing at the right block. Labels the teacher wrote ("3.", "(b)", "Solution:", "Def.") are removed, because presets print their own; "(5 points)" becomes the problem's points.
10. **Teacher exclusions stay on the block.** Excluding a block does not move it: an excluded first line still anchors its problem, and an excluded problem stays excluded across passes.
11. **The compile probe runs before structuring**, on leaf blocks, so a block that fails is already an image when it is placed. A compile without a verdict (timeout, no TeX) changes nothing.
12. **Status comes from `confidence_rate`.** Mathpix's `confidence` is the probability that the whole output is exactly right, which falls with length and would send every long derivation to review; `confidence_rate` is per character. The thresholds (0.85 and 0.6) still need tuning on the corpus.
13. **No figure alt text yet.** The model sees no crops in v0.2, so it marks drawings as figures and leaves alt text to the teacher (flagged as unconfirmed).

## Known gaps

- **Compile time.** A 3-page handout takes about 11 s in the sandbox with Latin Modern and about 17 s with Fira Sans in large print (4-core container, warm font caches). latexmk runs several LuaLaTeX passes for tagging and page references. The architecture targets p95 under 15 s for 10 pages, so the worker needs work here: a warm pool, a persistent per-job cache of `.aux` files between edits of the same document, and fewer passes.
- **Not run in this environment:** the Docker image build and the GitHub Actions workflow. The toolchain scripts they call were run end to end here (fresh TeX Live 2026 install, compile, veraPDF), but the image and CI need a first green run.
- **Units convention** (`siunitx`) is in the schema but no transform reads it yet; `equationNumbers: 'referenced'` behaves like `none` until the IR has references; the `logo` header field is ignored until workspaces carry a logo asset.
- **Image assets** are only referenced: the compile matrix uses grey placeholders. Raster cleanup, SVG-to-PDF for board ink and standalone plot compilation are not built.
- **Recognition worker wiring.** The pipeline runs as library calls; the queue consumer, retries with backoff for up to 10 minutes, the Claude vision backup recognizer and rendering region crops (strokes to PNG) are not built.
- **Structuring passes rebuild the document** from its blocks. Teacher edits, exclusions, placements, points and pinned section titles are kept, but the order of blocks a teacher moved is not yet protected, and typed blocks inside a structured block keep their parent but not their exact position.
- **The heuristic structurer** treats the blocks after a problem as its solution until the next labelled block, as the architecture describes, so unlabelled lecture text written after a problem is pulled into it. It cannot see crossed-out work; only the model can.
- **No recordings or prompt evaluation yet.** Without provider keys here, the Claude prompt has been checked for shape (schema, guards, retries) but not evaluated on real board sessions, and no recorded provider responses are checked in. That needs the lesson corpus.
