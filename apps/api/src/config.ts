import {
  AnthropicJsonModel,
  MathpixClient,
  RecordedJsonModel,
  RecordedRecognizer,
  RecordingStore,
} from '@chalkline/providers';
import { bubblewrapAvailable, findTexBin } from '@chalkline/worker-compile';
import type { BoardDeps } from './board.js';

/**
 * Providers and TeX from the environment (`.env.local` at the repository
 * root, loaded by main.ts). Same modes as `providersFromEnv`:
 *
 * - `PROVIDERS=recorded` (default): replay recordings only, so new
 *   handwriting is not recognized;
 * - `PROVIDERS=record`: call Mathpix (and Claude) for anything not
 *   recorded yet and save the response, so redrawing the same strokes is free;
 * - `PROVIDERS=live`: always call the providers.
 *
 * Keys stay in this process; the browser never sees them.
 */
export function depsFromEnv(env: NodeJS.ProcessEnv, recordingsDir: string): BoardDeps {
  const mode = env.PROVIDERS ?? 'recorded';
  if (mode !== 'recorded' && mode !== 'record' && mode !== 'live') {
    throw new Error(`PROVIDERS must be recorded, record or live (got ${mode})`);
  }
  const store = new RecordingStore(recordingsDir, mode === 'record' ? 'record' : 'replay');
  const mathpix =
    env.MATHPIX_APP_ID && env.MATHPIX_APP_KEY
      ? new MathpixClient({ appId: env.MATHPIX_APP_ID, appKey: env.MATHPIX_APP_KEY })
      : undefined;
  const claude = env.ANTHROPIC_API_KEY ? new AnthropicJsonModel() : undefined;

  const deps: BoardDeps =
    mode === 'recorded'
      ? { recognition: 'recorded', recognizer: new RecordedRecognizer(store) }
      : mathpix
        ? {
            recognition: mode,
            recognizer: mode === 'record' ? new RecordedRecognizer(store, mathpix) : mathpix,
          }
        : { recognition: 'off' };
  if (claude) deps.model = mode === 'live' ? claude : new RecordedJsonModel(store, claude);

  const texBin = findTexBin(env);
  if (texBin) deps.compile = { texBin, sandbox: bubblewrapAvailable(env) ? 'bwrap' : 'none' };
  return deps;
}
