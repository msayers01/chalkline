import { monotonicFactory } from 'ulid';

/**
 * IDs are ULIDs generated where the thing is created (the client for ops,
 * regions and strokes). A monotonic factory keeps ids created within the same
 * millisecond sortable.
 */
const factory = monotonicFactory();

export function newId(now: number = Date.now()): string {
  return factory(now);
}

/**
 * Deterministic id source for tests and fixtures: ids sort in creation order
 * and are stable across runs.
 */
export function sequentialIds(prefix = '01J0000000000000000'): () => string {
  if (prefix.length > 20) throw new Error('prefix must leave room for a counter');
  let n = 0;
  const width = 26 - prefix.length;
  return () => {
    n += 1;
    return prefix + encodeCrockford(n, width);
  };
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function encodeCrockford(value: number, width: number): string {
  let out = '';
  let rest = value;
  for (let i = 0; i < width; i += 1) {
    out = (CROCKFORD[rest % 32] ?? '0') + out;
    rest = Math.floor(rest / 32);
  }
  if (rest > 0) throw new Error('id counter overflow');
  return out;
}
