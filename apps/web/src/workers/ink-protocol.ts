import {
  CorrectionTracker,
  RegionGrouper,
  type GrouperEvent,
  type InkRegion,
  type Stroke,
} from '@chalkline/ink';
import { newId } from '@chalkline/ir';

/**
 * Messages between the session (main thread) and the ink worker, and the
 * worker's logic. `now` is the session clock in every message, so grouping
 * never reads a clock of its own.
 */

export type InkIn =
  | { kind: 'stroke'; stroke: Stroke; now: number }
  | { kind: 'erase'; strokeIds: string[]; now: number }
  | { kind: 'tick'; now: number }
  /** Closes every open region (end of writing). */
  | { kind: 'flush'; now: number };

export type InkOut =
  /** A settled region, with `replaces` set when it is a correction. */
  { kind: 'closed'; region: InkRegion } | { kind: 'open'; count: number };

/** Region grouping plus correction tracking; one per session. */
export class InkCore {
  private readonly grouper: RegionGrouper;
  private readonly corrections = new CorrectionTracker();

  constructor(newRegionId: () => string = () => newId()) {
    this.grouper = new RegionGrouper(newRegionId);
  }

  handle(message: InkIn): InkOut[] {
    const events =
      message.kind === 'stroke'
        ? this.grouper.addStroke(message.stroke, message.now)
        : message.kind === 'erase'
          ? this.grouper.erase(message.strokeIds, message.now)
          : message.kind === 'tick'
            ? this.grouper.tick(message.now)
            : this.grouper.flush();
    const out = events.flatMap((e) => this.settle(e, message.now));
    if (message.kind !== 'tick' || out.length > 0) {
      out.push({ kind: 'open', count: this.grouper.openRegionCount() });
    }
    return out;
  }

  private settle(event: GrouperEvent, now: number): InkOut[] {
    if (event.kind === 'closed') {
      return [{ kind: 'closed', region: this.corrections.committed(event.region, now) }];
    }
    this.corrections.strokesErased(event.regionId, event.strokeIds.length, now);
    return [];
  }
}
