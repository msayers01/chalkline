/**
 * pnpm --filter @chalkline/api dev
 *
 * The local API for the board, on 127.0.0.1 only. Reads provider keys from
 * `.env.local` at the repository root.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { depsFromEnv } from './config.js';
import { buildServer } from './server.js';

const root = join(import.meta.dirname, '..', '..', '..');
const envFile = join(root, '.env.local');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const deps = depsFromEnv(process.env, join(root, '.local', 'recordings'));
const app = buildServer(deps, { logger: true });
const port = Number(process.env.CHALKLINE_API_PORT ?? 8787);
await app.listen({ host: '127.0.0.1', port });

app.log.info(
  {
    recognition: deps.recognition,
    claude: deps.model !== undefined,
    tex: deps.compile !== undefined,
    sandbox: deps.compile?.sandbox ?? null,
  },
  'board API ready',
);
if (deps.recognition === 'off') {
  app.log.warn(
    'Handwriting recognition is off: set MATHPIX_APP_ID and MATHPIX_APP_KEY in .env.local',
  );
} else if (deps.recognition === 'recorded') {
  app.log.warn('PROVIDERS=recorded replays recordings only; set PROVIDERS=record in .env.local');
}
