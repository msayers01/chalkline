import type { InkIn, InkOut } from '../workers/ink-protocol.js';
import type { InkChannel } from './session.js';

/** The ink worker, as a channel for `BoardSession`. */
export function inkWorkerChannel(): InkChannel {
  const worker = new Worker(new URL('../workers/ink.worker.ts', import.meta.url), {
    type: 'module',
  });
  return {
    send: (message: InkIn) => worker.postMessage(message),
    listen: (listener: (message: InkOut) => void) => {
      worker.onmessage = (event: MessageEvent<InkOut>) => listener(event.data);
    },
    close: () => worker.terminate(),
  };
}
