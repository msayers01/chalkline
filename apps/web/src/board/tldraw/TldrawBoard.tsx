import { useEffect, useState } from 'react';
import { Tldraw, type Editor } from 'tldraw';
import 'tldraw/tldraw.css';
import type { BoardAdapter } from '../BoardAdapter.js';
import { TldrawBoardAdapter } from './adapter.js';

/**
 * The Built-in Board. Each session has its own board, kept by tldraw in
 * IndexedDB under the session id, so a reload or crash keeps the ink.
 */
export function TldrawBoard(props: {
  sessionId: string;
  clock: () => number;
  /** Connects the board; returns a function that disconnects it. */
  onReady: (board: BoardAdapter) => (() => void) | undefined;
}) {
  const { clock, onReady } = props;
  const [editor, setEditor] = useState<Editor | null>(null);

  useEffect(() => {
    if (!editor) return;
    const adapter = new TldrawBoardAdapter(editor, clock);
    const detach = onReady(adapter);
    return () => {
      detach?.();
      adapter.dispose();
    };
  }, [editor, clock, onReady]);

  return (
    <Tldraw
      persistenceKey={`chalkline-board-${props.sessionId}`}
      onMount={(mounted) => {
        mounted.setCurrentTool('draw');
        setEditor(mounted);
      }}
      {...(import.meta.env.VITE_TLDRAW_LICENSE_KEY
        ? { licenseKey: import.meta.env.VITE_TLDRAW_LICENSE_KEY as string }
        : {})}
    />
  );
}
