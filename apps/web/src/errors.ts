/**
 * Teacher-facing copy for problem `type` codes from the API and for local
 * failures. Plain and specific; no jargon.
 */
const COPY: Record<string, string> = {
  network:
    "Can't reach the Chalkline server. Start it with `pnpm dev` and your writing will be sent again.",
  'recognition-not-configured':
    'Handwriting recognition is off. Add your Mathpix keys to .env.local and restart `pnpm dev`, then press "Try again".',
  'invalid-request': 'Something on this board could not be sent. Try drawing it again.',
  'invalid-response': 'The server sent back something unexpected. Try again in a moment.',
  'export-not-found': 'That handout is no longer available. Make it again.',
  internal: 'Something went wrong on the server. Try again in a moment.',
  storage:
    "This browser can't save your board (private windows sometimes block it). Open Chalkline in a normal window so nothing you write is lost.",
};

export function messageFor(code: string): string {
  return COPY[code] ?? COPY.internal ?? '';
}

/** Region recognition failures, from the recognizer's failure code. */
export function regionFailureText(code: string): string {
  if (code.startsWith('missing_recording')) {
    return 'Not recognized: the server only replays saved recognitions (PROVIDERS=recorded).';
  }
  if (code === 'network' || code.startsWith('http_5') || code === 'http_429') {
    return "The recognition service didn't answer; kept as a picture of your writing.";
  }
  if (code === 'http_401' || code === 'http_403') {
    return 'The Mathpix keys were refused. Check them in .env.local.';
  }
  return 'Could not be read; kept as a picture of your writing.';
}
