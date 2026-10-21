import {
  b64Vecs,
  type Editor,
  type TLDrawShape,
  type TLHighlightShape,
  type TLShape,
} from 'tldraw';
import type { BoardAdapter, BoardEvent, BoardStroke } from '../BoardAdapter.js';
import { inkColorOf, strokeWidthOf, timedPoints } from '../strokes.js';

type InkShape = TLDrawShape | TLHighlightShape;

const isInk = (shape: TLShape): shape is InkShape =>
  shape.type === 'draw' || shape.type === 'highlight';

/**
 * The board on tldraw. A stroke is reported when its draw or highlight
 * shape becomes complete (pen up); deleting one (eraser, delete, undo) is
 * reported as an erase. Only changes made on this device count: shapes
 * restored from the board's own storage after a reload are not new ink.
 */
export class TldrawBoardAdapter implements BoardAdapter {
  private readonly listeners = new Set<(event: BoardEvent) => void>();
  /** When each in-progress shape started, on the session clock. */
  private readonly started = new Map<string, number>();
  private readonly cleanups: (() => void)[] = [];

  constructor(
    private readonly editor: Editor,
    readonly clock: () => number,
  ) {
    const effects = editor.sideEffects;
    this.cleanups.push(
      effects.registerAfterCreateHandler('shape', (shape, source) => {
        if (source !== 'user' || !isInk(shape)) return;
        if (shape.props.isComplete) this.ended(shape, this.clock());
        else this.started.set(shape.id, this.clock());
      }),
      effects.registerAfterChangeHandler('shape', (prev, next, source) => {
        if (source !== 'user' || !isInk(prev) || !isInk(next)) return;
        if (!prev.props.isComplete && next.props.isComplete) this.ended(next, this.clock());
      }),
      effects.registerAfterDeleteHandler('shape', (shape, source) => {
        if (source !== 'user' || !isInk(shape)) return;
        this.started.delete(shape.id);
        this.emit({ kind: 'erased', boardKeys: [shape.id] });
      }),
    );
  }

  subscribe(listener: (event: BoardEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispose(): void {
    for (const cleanup of this.cleanups) cleanup();
    this.listeners.clear();
  }

  private ended(shape: InkShape, now: number): void {
    const t0 = this.started.get(shape.id) ?? now;
    this.started.delete(shape.id);
    const stroke = this.strokeOf(shape, t0, now);
    if (stroke) this.emit({ kind: 'strokeEnded', stroke });
  }

  private strokeOf(shape: InkShape, t0: number, t1: number): BoardStroke | undefined {
    const transform = this.editor.getShapePageTransform(shape);
    const path = shape.props.segments.flatMap((segment) =>
      b64Vecs.decodePoints(segment.path, segment.dim).map((v) => {
        const p = transform.applyToPoint(v);
        return { x: p.x, y: p.y, ...(segment.dim === 2 ? {} : { z: v.z }) };
      }),
    );
    if (path.length === 0) return undefined;
    const pageId = this.editor.getAncestorPageId(shape);
    const page = Math.max(
      0,
      this.editor.getPages().findIndex((p) => p.id === pageId),
    );
    return {
      boardKey: shape.id,
      page,
      tool: shape.type === 'highlight' ? 'highlighter' : 'pen',
      color: inkColorOf(shape.props.color),
      width: strokeWidthOf(shape.props.size, shape.props.scale),
      points: timedPoints(path, t0, t1),
    };
  }

  private emit(event: BoardEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}
