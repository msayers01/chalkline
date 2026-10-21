import { InkCore, type InkIn, type InkOut } from './ink-protocol.js';

/**
 * The ink worker: groups strokes into settled regions off the main thread,
 * so drawing never waits on grouping. Clock-free: the session sends the
 * time with every message.
 */
const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<InkIn>) => void) | null;
  postMessage(message: InkOut): void;
};

const core = new InkCore();
scope.onmessage = (event) => {
  for (const out of core.handle(event.data)) scope.postMessage(out);
};
