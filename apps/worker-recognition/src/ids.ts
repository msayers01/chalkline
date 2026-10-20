import { createHash } from 'node:crypto';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * A stable id derived from another one: the same base and salt always give the
 * same id, so a retried job or a re-run structuring pass produces the same
 * blocks, and patches that reference them stay valid. The base's time prefix
 * is kept so derived ids still sort by writing time.
 */
export function derivedId(base: string, salt: string): string {
  const digest = createHash('sha256').update(`${base}:${salt}`).digest();
  let tail = '';
  for (let i = 0; i < 16; i += 1) tail += CROCKFORD[(digest[i] ?? 0) % 32];
  return base.slice(0, 10) + tail;
}
