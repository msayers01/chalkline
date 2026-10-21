import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import type { BoardAdapter } from './board/BoardAdapter.js';
import { TldrawBoard } from './board/tldraw/TldrawBoard.js';
import { messageFor } from './errors.js';
import { NotesPanel } from './review/NotesPanel.js';
import { HttpBoardApi, type Health } from './session/api.js';
import { renderRegionPng } from './session/crops.js';
import { BoardDb } from './session/db.js';
import { inkWorkerChannel } from './session/ink-channel.js';
import { BoardSession, TICK_MS } from './session/session.js';

const api = new HttpBoardApi();
const db = new BoardDb();

async function openSession(fresh: boolean): Promise<BoardSession> {
  return BoardSession.open(
    { db, api, ink: inkWorkerChannel(), renderCrop: renderRegionPng },
    { fresh },
  );
}

export function App() {
  const [session, setSession] = useState<BoardSession | null>(null);
  const [storageFailed, setStorageFailed] = useState(false);
  const [health, setHealth] = useState<Health | null>(null);
  const [healthProblem, setHealthProblem] = useState<string | null>(null);

  // Open the current session once; IndexedDB must work or nothing is safe to write.
  useEffect(() => {
    let opened: BoardSession | undefined;
    let cancelled = false;
    void navigator.storage?.persist?.();
    openSession(false).then(
      (s) => {
        if (cancelled) s.dispose();
        else setSession((opened = s));
      },
      () => setStorageFailed(true),
    );
    return () => {
      cancelled = true;
      opened?.dispose();
    };
  }, []);

  const checkHealth = useCallback(() => {
    api.health().then(
      (h) => {
        setHealth(h);
        setHealthProblem(null);
      },
      () => setHealthProblem('network'),
    );
  }, []);
  useEffect(checkHealth, [checkHealth]);

  // Regions settle on the clock: tell the ink worker the time.
  useEffect(() => {
    if (!session) return;
    const id = setInterval(() => session.tick(), TICK_MS);
    return () => clearInterval(id);
  }, [session]);

  useWakeLock(session !== null);

  const attach = useCallback((board: BoardAdapter) => session?.attach(board), [session]);

  const newBoard = useCallback(async () => {
    session?.dispose();
    setSession(null);
    try {
      setSession(await openSession(true));
    } catch {
      setStorageFailed(true);
    }
  }, [session]);

  if (storageFailed) {
    return (
      <div className="blocking" role="alert">
        <p>{messageFor('storage')}</p>
      </div>
    );
  }
  if (!session) return <div className="loading">Opening your board…</div>;

  return (
    <div className="app">
      <main className="board" aria-label="Board">
        <TldrawBoard
          key={session.sessionId}
          sessionId={session.sessionId}
          clock={session.clock}
          onReady={attach}
        />
      </main>
      <SessionNotes
        session={session}
        health={health}
        healthProblem={healthProblem}
        onRecheck={checkHealth}
        onNewBoard={() => void newBoard()}
      />
    </div>
  );
}

function SessionNotes(props: {
  session: BoardSession;
  health: Health | null;
  healthProblem: string | null;
  onRecheck: () => void;
  onNewBoard: () => void;
}) {
  const view = useSyncExternalStore(props.session.subscribe, props.session.getView);
  return (
    <NotesPanel
      view={view}
      health={props.health}
      healthProblem={props.healthProblem}
      onFinish={() => props.session.finishWriting()}
      onRetry={() => {
        props.onRecheck();
        props.session.retry();
      }}
      onNewBoard={props.onNewBoard}
      onMakeHandout={(options) => void props.session.makeHandout(options)}
    />
  );
}

/** Keeps the panel from dimming while the board is open; re-acquired when the tab returns. */
function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | undefined;
    const acquire = () => {
      if (document.visibilityState !== 'visible') return;
      navigator.wakeLock.request('screen').then(
        (l) => (lock = l),
        () => undefined,
      );
    };
    acquire();
    document.addEventListener('visibilitychange', acquire);
    return () => {
      document.removeEventListener('visibilitychange', acquire);
      void lock?.release();
    };
  }, [active]);
}
