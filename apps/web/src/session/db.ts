import type { InkRegion, Stroke } from '@chalkline/ink';
import { Dexie, type EntityTable } from 'dexie';
import type { BoardBlock } from './api.js';

/**
 * The local store. Every stroke is written here the moment it ends, before
 * anything else happens with it, and nothing is ever deleted: erased
 * strokes are marked, replaced regions keep their row.
 */

export type SessionRow = {
  id: string;
  /** Wall-clock start (ms since epoch); stroke and region times count from here. */
  startedAt: number;
  /** 1 for the session the board opens with. */
  current: 0 | 1;
};

export type StrokeRow = {
  id: string;
  sessionId: string;
  /** The board engine's id for the stroke, to resolve erasures. */
  boardKey: string;
  stroke: Stroke;
  erased: boolean;
};

/**
 * - `recognizing`: sent, waiting for the answer;
 * - `retrying`: the service failed in a way worth retrying; sent again soon;
 * - `waiting`: recognition is off or the server is unreachable;
 * - `recognized`: has blocks (possibly an image of the ink, see `failure`);
 * - `replaced`: rewritten by a correction; its blocks no longer count.
 */
export type RegionStatus = 'recognizing' | 'retrying' | 'waiting' | 'recognized' | 'replaced';

export type RegionRow = {
  id: string;
  sessionId: string;
  region: InkRegion;
  status: RegionStatus;
  blocks: BoardBlock[];
  attempts: number;
  /** The last failure code, from the recognizer or the API. */
  failure?: string;
  /** The region's ink drawn as a PNG (base64), used when a block stays an image. */
  crop?: string;
};

export class BoardDb extends Dexie {
  sessions!: EntityTable<SessionRow, 'id'>;
  strokes!: EntityTable<StrokeRow, 'id'>;
  regions!: EntityTable<RegionRow, 'id'>;

  constructor(name = 'chalkline') {
    super(name);
    this.version(1).stores({
      sessions: 'id, current',
      strokes: 'id, sessionId, boardKey',
      regions: 'id, sessionId',
    });
  }
}
