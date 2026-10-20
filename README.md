# Chalkline

Chalkline (working name) turns what a teacher writes on a smartboard into typeset LaTeX handouts: lecture notes, practice worksheets, answer keys and more. Math teachers are the primary audience.

- Product design: [`docs/01-product-design.md`](docs/01-product-design.md)
- Architecture: [`docs/02-architecture.md`](docs/02-architecture.md)
- Guide for coding agents (invariants, layout, commands): [`CLAUDE.md`](CLAUDE.md)

## Status: v0.1, Foundations (compile gate)

This first slice builds the document engine that everything else feeds: the document model, the one safe path from content to LaTeX, conventions, the first three presets, and the compile pipeline that proves every generated document compiles to a tagged PDF/UA-2 file.

| Area                            | State                                                                                                                                                                                                                                                                                                                        |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/ir`                   | Document model as Zod schemas, patch operations (teacher edits pin blocks; system edits to pinned content become proposals), ULIDs, the preset "select" step (view tree), fixtures                                                                                                                                           |
| `packages/latex`                | `safe/`: `escapeText()`, `sanitizeMath()` (unified-latex AST, allowlist, ban list, structural checks), the `tex` tagged template and `SafeLatex` brand. Renderer with `% blk:` markers, source maps, placeholders for rejected math, unsupported-character reports. Log parser that maps overfull boxes and errors to blocks |
| `packages/conventions`          | Convention schema and defaults, resolution chain (preset → school → class → teacher, school locks), math AST transforms: multiplication sign, decimal separator, vectors, differential d (derivative notation is suggestion-only)                                                                                            |
| `packages/presets`              | Lecture Notes, Practice Worksheet, Answer Key; tagged-PDF package allowlist checked against the LaTeX Tagging Project status; preamble modules; labels in en, es, fr, de, pt                                                                                                                                                 |
| `apps/worker-compile`           | Sandboxed latexmk/LuaLaTeX runner (bubblewrap, no network, no shell escape, paranoid file access, time limit, output cap), compile cache key, pinned TeX Live 2026 toolchain scripts and Dockerfile. The queue consumer is not written yet                                                                                   |
| `tools/eslint-plugin-chalkline` | `chalkline/no-raw-latex-interpolation`                                                                                                                                                                                                                                                                                       |
| `tools/compile-matrix`          | Every preset × fixture × key convention variant, an every-allowlisted-command document and random sanitizer output, compiled in the sandbox and validated with veraPDF (PDF/UA-2)                                                                                                                                            |

Not started yet (see the release plan in the product design): the web app and board, local-first sync, the API and database, recognition and structuring workers, HTML/Word renderers, and the remaining six presets.

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

## Decisions taken while building v0.1

These refine the design documents; they are recorded in the architecture document too. Please review them.

1. **No babel in v1.** babel's tagging status is "unchecked" as a whole and French is "currently-incompatible", so presets do not load it. Labels ("Example", "Ejemplo") and dates are localized by the renderer, the PDF language comes from `\DocumentMetadata{lang=...}`, and non-English documents switch hyphenation off rather than hyphenate with English patterns. Revisit per language as the Tagging Project marks them compatible.
2. **Text font fallback.** Latin Modern and TeX Gyre text fonts lack Greek, arrows, relation symbols and Cyrillic, which recognized text often contains; a missing glyph prints as nothing and fails PDF/UA-2. Text now falls back to the matching math font, then FreeSerif/FreeSans. Characters outside the covered ranges (CJK, emoji) are reported as `unsupportedCharacter` render issues so review can flag them.
3. **Callouts without amsthm.** Definitions, theorems, examples and the other callouts are environments defined by the preset (boxed with simple `tcolorbox` boxes where the preset wants it). The renderer emits a small fixed vocabulary (`CONTRACT` in `packages/latex/src/render/template.ts`) and presets decide the look.
4. **The select step lives in `packages/ir`** (`selectView`), so the LaTeX, HTML and Word renderers share one view tree.
5. **Derivative notation is suggestion-only.** Converting between prime and Leibniz notation needs the independent variable, which the board rarely states unambiguously.
6. **`\square` and `\blacksquare` are not allowlisted:** unicode-math does not define them (the compile matrix caught it).

## Known gaps

- **Compile time.** A 3-page handout takes about 11 s in the sandbox with Latin Modern and about 17 s with Fira Sans in large print (4-core container, warm font caches). latexmk runs several LuaLaTeX passes for tagging and page references. The architecture targets p95 under 15 s for 10 pages, so the worker needs work here: a warm pool, a persistent per-job cache of `.aux` files between edits of the same document, and fewer passes.
- **Not run in this environment:** the Docker image build and the GitHub Actions workflow. The toolchain scripts they call were run end to end here (fresh TeX Live 2026 install, compile, veraPDF), but the image and CI need a first green run.
- **Units convention** (`siunitx`) is in the schema but no transform reads it yet; `equationNumbers: 'referenced'` behaves like `none` until the IR has references; the `logo` header field is ignored until workspaces carry a logo asset.
- **Image assets** are only referenced: the compile matrix uses grey placeholders. Raster cleanup, SVG-to-PDF for board ink and standalone plot compilation are not built.
