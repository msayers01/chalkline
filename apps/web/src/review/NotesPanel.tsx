import type { ContentBlock, Inline } from '@chalkline/ir';
import { useEffect, useId, useMemo, useState } from 'react';
import { messageFor, regionFailureText } from '../errors.js';
import type { Health } from '../session/api.js';
import type { HandoutOptions, RegionView, SessionView } from '../session/session.js';

/**
 * What the board has become so far: each piece of writing as it was read,
 * and the handout made from it. A first, plain version of the review side.
 */
export function NotesPanel(props: {
  view: SessionView;
  health: Health | null;
  healthProblem: string | null;
  onFinish: () => void;
  onRetry: () => void;
  onNewBoard: () => void;
  onMakeHandout: (options: HandoutOptions) => void;
}) {
  const { view, health } = props;
  const live = view.regions.filter((r) => r.status !== 'replaced');
  const waiting = live.filter((r) => r.status === 'waiting' || r.status === 'retrying').length;
  const recognized = live.filter((r) => r.status === 'recognized').length;
  const problem = view.problem ?? props.healthProblem ?? undefined;

  return (
    <aside className="notes" aria-label="Notes">
      <header className="notes-header">
        <h1>Notes</h1>
        <p className="status" aria-live="polite">
          {statusLine(view, recognized)}
        </p>
      </header>

      {problem ? <p className="banner">{messageFor(problem)}</p> : null}
      {health ? <SetupHints health={health} /> : null}

      <div className="actions">
        <button type="button" onClick={props.onFinish} disabled={view.openRegions === 0}>
          Read it now
        </button>
        <button type="button" onClick={props.onRetry} disabled={waiting === 0 && !problem}>
          Try again{waiting ? ` (${waiting})` : ''}
        </button>
        <button type="button" onClick={props.onNewBoard}>
          New board
        </button>
      </div>

      <ol className="regions" aria-label="Writing, in order">
        {live.length === 0 ? (
          <li className="empty">
            Write on the board. Each group of writing appears here about two seconds after you stop.
          </li>
        ) : (
          live.map((r) => <RegionItem key={r.id} region={r} />)
        )}
      </ol>

      <HandoutForm
        health={health}
        disabled={recognized === 0}
        working={view.handout.state === 'working'}
        onMake={props.onMakeHandout}
      />
      <Handout view={view} hasTex={health?.tex ?? false} />
    </aside>
  );
}

function statusLine(view: SessionView, recognized: number): string {
  if (view.openRegions > 0) return 'Writing…';
  const reading = view.regions.filter((r) => r.status === 'recognizing').length;
  if (reading > 0) return `Reading ${reading} ${reading === 1 ? 'piece' : 'pieces'}…`;
  return recognized ? `${recognized} ${recognized === 1 ? 'piece' : 'pieces'} read` : 'Ready';
}

function SetupHints({ health }: { health: Health }) {
  const hints: string[] = [];
  if (health.recognition === 'off') {
    hints.push(
      'Handwriting recognition is off: add MATHPIX_APP_ID and MATHPIX_APP_KEY to .env.local and restart.',
    );
  } else if (health.recognition === 'recorded') {
    hints.push(
      'The server only replays saved recognitions. Set PROVIDERS=record in .env.local to read new writing.',
    );
  }
  if (!health.tex)
    hints.push('TeX Live is not installed, so handouts come out as .tex files only.');
  if (hints.length === 0) return null;
  return (
    <ul className="hints">
      {hints.map((h) => (
        <li key={h}>{h}</li>
      ))}
    </ul>
  );
}

const STATUS_TEXT: Record<RegionView['status'], string> = {
  recognizing: 'Reading',
  retrying: 'Trying again',
  waiting: 'Waiting',
  recognized: 'Read',
  replaced: 'Replaced',
};

function RegionItem({ region }: { region: RegionView }) {
  const note =
    region.status === 'waiting' && region.failure
      ? messageFor(region.failure)
      : region.failure
        ? regionFailureText(region.failure)
        : undefined;
  return (
    <li className={`region region-${region.status}`}>
      <span className="chip">{STATUS_TEXT[region.status]}</span>
      {region.blocks.map(({ block }) => (
        <div key={block.id} className={`block block-${block.status}`}>
          {block.status === 'check' ? <span className="chip chip-check">Check</span> : null}
          <code>{previewOf(block)}</code>
        </div>
      ))}
      {note ? <p className="note">{note}</p> : null}
    </li>
  );
}

function previewOf(block: ContentBlock): string {
  switch (block.type) {
    case 'paragraph':
      return inlineText(block.inlines);
    case 'displayMath':
      return block.lines.map((l) => `\\[ ${l} \\]`).join('\n');
    case 'imageFallback':
      return '(kept as a picture of the writing)';
    case 'figure':
      return '(drawing)';
    case 'list':
      return block.items.map((i) => `• ${inlineText(i.inlines)}`).join('\n');
    case 'table':
      return block.rows.map((row) => row.map((c) => inlineText(c.inlines)).join(' | ')).join('\n');
    default:
      return '';
  }
}

function inlineText(inlines: readonly Inline[]): string {
  return inlines.map((i) => (i.kind === 'math' ? `\\(${i.latex}\\)` : i.text)).join('');
}

function HandoutForm(props: {
  health: Health | null;
  disabled: boolean;
  working: boolean;
  onMake: (options: HandoutOptions) => void;
}) {
  const ids = { preset: useId(), structurer: useId(), title: useId() };
  const presets = props.health?.presets ?? [{ id: 'lecture-notes', name: 'Lecture Notes' }];
  const [preset, setPreset] = useState('lecture-notes');
  const [structurer, setStructurer] = useState<HandoutOptions['structurer']>('heuristic');
  const [title, setTitle] = useState('Board notes');

  return (
    <form
      className="handout-form"
      onSubmit={(e) => {
        e.preventDefault();
        props.onMake({ preset, structurer, title: title.trim() || 'Board notes' });
      }}
    >
      <h2>Handout</h2>
      <label htmlFor={ids.title}>Title</label>
      <input
        id={ids.title}
        value={title}
        maxLength={200}
        onChange={(e) => setTitle(e.target.value)}
      />
      <label htmlFor={ids.preset}>Kind of handout</label>
      <select id={ids.preset} value={preset} onChange={(e) => setPreset(e.target.value)}>
        {presets.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <label htmlFor={ids.structurer}>Organize with</label>
      <select
        id={ids.structurer}
        value={structurer}
        onChange={(e) => setStructurer(e.target.value as HandoutOptions['structurer'])}
      >
        <option value="heuristic">Built-in rules</option>
        <option value="claude" disabled={!props.health?.claude}>
          Claude{props.health?.claude ? '' : ' (needs ANTHROPIC_API_KEY)'}
        </option>
      </select>
      <button type="submit" className="primary" disabled={props.disabled || props.working}>
        {props.working ? 'Making handout…' : 'Make handout'}
      </button>
    </form>
  );
}

function Handout({ view, hasTex }: { view: SessionView; hasTex: boolean }) {
  const handout = view.handout;
  const tex = handout.state === 'done' ? handout.result.tex : undefined;
  const texUrl = useMemo(
    () =>
      tex === undefined ? undefined : URL.createObjectURL(new Blob([tex], { type: 'text/x-tex' })),
    [tex],
  );
  useEffect(() => () => (texUrl ? URL.revokeObjectURL(texUrl) : undefined), [texUrl]);

  if (handout.state === 'failed') return <p className="banner">{messageFor(handout.code)}</p>;
  if (handout.state !== 'done') return null;
  const { result } = handout;
  const { counts } = result;
  const compileError = result.compile?.error;
  return (
    <section className="handout" aria-label="Handout">
      <p>
        {counts.ready} ready, {counts.check} to check, {counts.image} kept as pictures
        {counts.excluded ? `, ${counts.excluded} left out` : ''}.
        {result.structuredBy.by === 'ai'
          ? ' Organized by Claude.'
          : ' Organized by built-in rules.'}
        {result.compile ? ` Typeset in ${result.compile.seconds} s.` : ''}
      </p>
      {compileError ? (
        <p className="banner">
          The PDF could not be typeset ({compileError}). The .tex file is below.
        </p>
      ) : null}
      {!hasTex ? <p className="note">Install TeX Live to get a PDF here.</p> : null}
      <div className="actions">
        {handout.pdfUrl ? (
          <a className="button" href={handout.pdfUrl} target="_blank" rel="noreferrer">
            Open PDF
          </a>
        ) : null}
        {texUrl ? (
          <a className="button" href={texUrl} download={`${result.preset}.tex`}>
            Download .tex
          </a>
        ) : null}
      </div>
      {handout.pdfUrl ? <iframe className="pdf" title="Handout PDF" src={handout.pdfUrl} /> : null}
      <details>
        <summary>LaTeX source</summary>
        <pre className="tex">{result.tex}</pre>
      </details>
    </section>
  );
}
