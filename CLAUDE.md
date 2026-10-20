# CLAUDE.md — Chalkline

Chalkline turns what a teacher writes on a smartboard (in our own Built-in Board, or in OneNote and similar apps via Companion Capture) into typeset LaTeX handouts: lecture notes, worksheets, answer keys and more. It is a local-first TypeScript web app (Edge/Chrome on Windows first) with cloud recognition and sandboxed LaTeX compilation.

Design references (read before large changes):
- Product design: `docs/01-product-design.md`
- Architecture: `docs/02-architecture.md`

If code and these docs disagree, stop and ask; do not silently pick one. Keep this file in sync when commands, layout or invariants change.

**Current state (v0.1, Foundations):** `packages/ir`, `packages/conventions`, `packages/latex`, `packages/presets`, `apps/worker-compile` (runner + toolchain only), `tools/eslint-plugin-chalkline` and `tools/compile-matrix` exist. Everything else in the layout below is planned. Decisions taken while building v0.1 (no babel, text font fallback, callouts without amsthm, select step in `ir`) are listed in `README.md`.

---

## Non-negotiable invariants

These protect the product's three promises: never lose content, never invent math, always compile. Breaking one is a bug even if tests pass.

1. **The IR is the source of truth.** Never store, edit or diff LaTeX as primary data. LaTeX, HTML and DOCX are renderings of `packages/ir`. Teacher edits are IR patches.
2. **Math comes only from the recognizer or the teacher.** The structuring model may return block ids, types, parent ids, order, section titles and figure alt text — nothing else. All of this is enforced in `apps/worker-recognition/src/structure/guards.ts`. Never widen the output schema to include math or free text without a design review.
3. **One path from content to LaTeX.** Text goes through `escapeText()` and math through `sanitizeMath()` (parse to AST → macro allowlist → convention transforms → serialize), both in `packages/latex/src/safe/`. No template literal may interpolate content directly; the ESLint rule `chalkline/no-raw-latex-interpolation` enforces this (LaTeX is built only with the `tex` tagged template over `SafeLatex` values; `safe/` itself and the plain-text `presets/src/labels.ts` are exempt). Never add `\input`, `\include`, `\write`, `\openin`, `\openout`, `\read`, `\csname`, `\catcode`, `\def`, `\let`, `\directlua` or `\usepackage` to the allowlist (`BANNED_MACROS` in `safe/allowlist.ts`; a test keeps the lists disjoint).
4. **Always compile.** Every new math block is validated alone before it enters a document; failures become `ImageFallback` blocks. A compile failure on generated LaTeX in production is a page-worthy incident, not a user error.
5. **Rendering is deterministic.** Same IR + preset + conventions ⇒ byte-identical `.tex`. No timestamps, random ids, `Date.now()`, or hash-ordered iteration in renderers.
6. **Local first.** Write the op to IndexedDB *before* updating UI state. Never delete local data until the server has acknowledged its sequence number **and** the session has ended.
7. **Capture worker rules.** Call `VideoFrame.close()` on every frame, including dropped ones (unclosed frames stall capture). The pipeline is frame-driven: no `setTimeout`/`setInterval` for pacing inside the capture worker (background tabs throttle timers).
8. **Screen frames never leave the browser.** Only cropped regions of new writing are uploaded.
9. **Every job is idempotent.** Recognize, structure and compile jobs are keyed (region id, or `sha256(tex + assets + texlive version)`); retries must never bill or write twice.
10. **Tenant isolation lives in the database.** Every table holding workspace data has `workspace_id` and an RLS policy added *in the same migration*, plus a case in `packages/db/test/rls.spec.ts`.
11. **Never log content.** Logs, traces, Sentry events and analytics carry ids only — no recognized text, LaTeX, images or stroke data.
12. **Teacher edits win.** An edited or moved block is `pinned`; later recognition/structuring passes may propose, never overwrite.
13. **Never reload during class.** The service worker defers activation while any session is `capturing` or `paused`.
14. **Tagged-PDF-safe presets only.** Preamble modules may use only packages on the allowlist in `packages/presets/src/packages.ts`, each verified against the LaTeX Tagging Project status for the pinned TeX Live release. `titlesec` is banned.

---

## Repository layout

```
apps/
  web/                    React 19 + Vite PWA: board, session, review, library, admin
    src/board/            BoardAdapter + tldraw implementation, tools, math tools
    src/capture/          Companion Capture UI, control pill (Document PiP)
    src/review/           Review screen, MathLive editor, preset switcher
    src/workers/          capture.worker.ts, ink.worker.ts, sync.worker.ts
  api/                    Fastify REST + SSE, share pages, export orchestration
  worker-recognition/     Mathpix + Anthropic calls, post-processing, structuring, validation probes
  worker-compile/         Dockerfile (pinned TeX Live), latexmk/LuaLaTeX runner, pandoc, rsvg
    toolchain/            install-texlive.sh, texlive-packages.txt, texmf.cnf, install-verapdf.sh
packages/
  ir/                     IR types, Zod schemas, patch ops, provenance
  latex/                  IR → .tex renderer, safe/ (escape + sanitizer), source maps, overflow fixes
  presets/                Built-in presets, preamble modules, package allowlist
  conventions/            Convention resolution chain + math AST transforms
  html/                   IR → HTML (preview + share pages, MathJax 4)
  docx/                   IR → Pandoc JSON
  capture/                Pure frame-analysis algorithms (diff, stability, alignment, ink map, regions)
  ink/                    Stroke grouping and settle detection
  sync/                   Op log (Dexie), batching, idempotent upload, SSE client
  providers/              Mathpix + Anthropic clients and recorded fakes
  db/                     Migrations, RLS policies, query helpers
  ui/                     Shared accessible components (Radix + Tailwind)
infra/                    AWS CDK stacks (us-east-2, eu-central-1)
corpus/                   Lesson corpus manifest + ground truth (media lives in S3)
tools/replay/             Headless replay harness and scoring
tools/compile-matrix/     pnpm compile-matrix: presets × fixtures × conventions, allowlist and random docs, veraPDF
tools/eslint-plugin-chalkline/  chalkline/no-raw-latex-interpolation
```

Pure logic belongs in `packages/*` so it can be tested in Node without a browser. `apps/*` wire it to I/O.

---

## Commands

Available in v0.1: `install`, `typecheck`, `lint`, `format`, `test`, `test:snap`, `compile-matrix`. The rest are planned with the packages they belong to.

```bash
pnpm install
pnpm dev                    # docker compose (Postgres, MinIO, compile image) + web + api + workers
pnpm dev:web                # web only, against staging API (read-only test workspace)

pnpm typecheck
pnpm lint                   # includes chalkline/no-raw-latex-interpolation
pnpm test                   # Vitest unit + property tests, all packages
pnpm test --filter @chalkline/latex
pnpm test:snap              # .tex snapshot tests; use `-u` only when the output change is intended
pnpm test:integration       # Testcontainers: API, queue, workers, RLS attack tests
pnpm test:e2e               # Playwright on Edge + Chrome
pnpm compile-matrix         # every preset × fixture × key conventions in the compile image + veraPDF UA-2
pnpm compile-matrix --quick # default conventions only; TEXLIVE_BIN / VERAPDF override tool paths
pnpm corpus:score --subset smoke   # ~15 lessons, a few minutes; use --subset full before releases

pnpm db:migrate
pnpm db:new <name>          # creates a migration skeleton with an RLS policy stub
```

Providers default to **recorded fakes** (`PROVIDERS=recorded`). `PROVIDERS=live` needs `MATHPIX_APP_ID`, `MATHPIX_APP_KEY` and `ANTHROPIC_API_KEY` in `.env.local` (never commit; never expose to the browser). The tldraw production key is `VITE_TLDRAW_LICENSE_KEY` and is only needed for production builds.

---

## What to run for which change

| You changed | Also run |
| --- | --- |
| `packages/latex`, `presets`, `conventions` | `test:snap`, `compile-matrix` |
| `packages/capture`, `ink`, recognition or structuring | `corpus:score --subset smoke`; scores may not drop more than 0.5 points |
| `packages/db` or any query | `test:integration` (includes RLS attack tests) |
| Board, capture UI, review UI | `test:e2e` for the affected flow; axe checks run inside e2e |
| `packages/sync` or the service worker | e2e offline/reconnect specs |
| Compile Dockerfile or TeX Live pin | `compile-matrix` and full veraPDF run |

When you update snapshots, say in the PR which output changed and why.

---

## Coding conventions

- TypeScript `strict`, no `any` (use `unknown` + narrowing). ESM, named exports.
- Validate with Zod at every boundary: HTTP, SSE, IndexedDB reads, provider responses, model output.
- API errors are RFC 9457 problem details with stable `type` codes; the web app maps codes to teacher-facing copy in `apps/web/src/errors.ts`.
- Mutations take an `Idempotency-Key`; document writes use `If-Match` with the IR version.
- IDs are ULIDs generated where the thing is created (client for ops/regions/strokes).
- Feature flags come from the session config and are read once per session; never change behavior mid-lesson.
- Prefer small pure functions with tests over clever classes. Put tunable thresholds (stability window, settle time, confidence cutoffs) in `packages/capture/src/params.ts` or `packages/ink/src/params.ts`, never inline.
- Copy for teachers: plain, calm, specific ("OneNote is minimized — capture will resume when it's visible"). No jargon like "OCR", "IR" or "pipeline" in the UI.

---

## Board and smartboard UX rules

- Canvas sets `touch-action: none`; block page pinch-zoom, swipe navigation, pull-to-refresh, text selection and the context menu on the board.
- No hover-only or right-click-only functionality; long-press is never destructive.
- Touch targets ≥ 56 px on the board; toolbar docks bottom by default, left/right optional, mirrored for left-handed use.
- Panel mode: one contact draws, two fingers pan/zoom, palm-sized contact erases. Pen mode: pen draws, fingers pan. Two separated single contacts draw two strokes.
- Use coalesced and predicted pointer events; budget is p95 < 25 ms ink latency on the reference PC.
- Hold a Screen Wake Lock while capturing on the Built-in Board.
- All board access goes through `BoardAdapter`; do not import tldraw outside `apps/web/src/board/tldraw/`.

---

## Browser API gotchas

- `getDisplayMedia` and `documentPictureInPicture.requestWindow()` both require a user gesture; only one Document PiP window can exist per browser.
- Companion Capture and the pill are Chromium-only; feature-detect and show the "Use Edge or Chrome" path elsewhere.
- Listen for the video track's `ended` event (teacher clicked "Stop sharing") and surface a one-tap resume.
- `navigator.storage.persist()` at first sign-in; handle IndexedDB being unavailable (some private windows) with a blocking explanation, never silent data loss.
- opencv.js is lazy-loaded only when Companion Capture starts.
- Mathpix `v3/strokes` request bodies are limited to 512 KB; `packages/ink` splits large regions along line boundaries.

## LaTeX engine gotchas

- unified-latex only parses an argument as math when the command's `renderInfo.inMathMode` is set, and never re-parses bare groups or script arguments; `sanitizeMath()` configures every allowlisted command and re-parses those groups. Add a signature for every new allowlisted command.
- `\_` and `_` are both macros named `_` in the AST; scripts have an empty `escapeToken`.
- LuaTeX treats every Unicode letter as a letter, so `\cdot` followed by `é` is one undefined command; the serializer separates them.
- An empty line anywhere inside math or a command argument ends the paragraph and breaks the compile; the renderer's writer never emits one except through `blank()`.
- `enumitem` cannot be loaded under tagging; kernel list keys (`\begin{enumerate}[label=(\alph*)]`) work without it.
- New preamble packages: check the Tagging Project status, add to `packages/presets/src/packages.ts` and `apps/worker-compile/toolchain/texlive-packages.txt`, then run the compile matrix.

---

## Glossary

- **Session** — one lesson. States: ready, capturing, paused, ended, in_review, published.
- **Built-in Board / Companion Capture / Import** — the three capture modes.
- **Region** — a settled group of new writing (strokes or a crop) sent for recognition once.
- **Settle** — no change in a region for the settle/stability window.
- **Commit / retract / correction** — region accepted; region removed; region replaced by rewriting after an erase within 20 s.
- **IR** — the document model in `packages/ir`. **Block** — a node in it, with `status` ready | check | image | excluded.
- **Preset** — template + structure rules + conventions. **Convention** — a notation/formatting rule resolved preset → school → class → teacher override (school can lock).
- **Writer lease** — which device may capture a session; 60 s, renewed by heartbeat, transferred only by explicit take-over.
- **Pill** — the always-on-top Document PiP control window during Companion Capture.

---

## Definition of done

- Invariants above still hold; new code paths have tests at the right layer.
- Relevant commands from "What to run" pass locally or in CI.
- UI changes are keyboard-accessible, pass axe, and work at 56 px targets on a touch panel.
- No content in logs; no provider keys in client bundles.
- Docs updated (this file, and the design/architecture docs if behavior or structure changed).
