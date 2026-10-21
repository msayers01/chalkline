import type { InkColor } from '@chalkline/ir';
import type { StrokePoint } from '@chalkline/ink';

/**
 * Everything the app needs from a whiteboard engine. All board access goes
 * through this interface; only `board/tldraw/` knows tldraw exists, so the
 * engine stays replaceable.
 */

/** A finished stroke, in page coordinates. `boardKey` is the engine's own id for it. */
export type BoardStroke = {
  boardKey: string;
  page: number;
  tool: 'pen' | 'highlighter';
  color: InkColor;
  width: number;
  points: StrokePoint[];
};

export type BoardEvent =
  | { kind: 'strokeEnded'; stroke: BoardStroke }
  /** Strokes removed by the eraser, delete or undo. */
  | { kind: 'erased'; boardKeys: string[] };

export interface BoardAdapter {
  /** Subscribes to stroke and erase events; returns an unsubscribe function. */
  subscribe(listener: (event: BoardEvent) => void): () => void;
  /** Milliseconds since the session started, on the same clock as stroke point times. */
  readonly clock: () => number;
}
