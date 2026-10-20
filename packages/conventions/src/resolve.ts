import {
  CONVENTION_KEYS,
  type ConventionKey,
  type Conventions,
  type PartialConventions,
} from './schema.js';

export type ConventionLayer = 'preset' | 'school' | 'class' | 'teacher';

export type ConventionChain = {
  preset: Conventions;
  school?: PartialConventions;
  /** Settings the school has locked: class and teacher layers cannot change them. */
  schoolLocks?: readonly ConventionKey[];
  class?: PartialConventions;
  /** The teacher's override for this preset. */
  teacher?: PartialConventions;
};

export type ResolvedConventions = {
  conventions: Conventions;
  /** Which layer each value came from, for the settings UI. */
  sources: Record<ConventionKey, ConventionLayer>;
  locked: ConventionKey[];
};

/**
 * Resolves conventions most-specific-wins: preset default, then school, then
 * class, then the teacher's override. A setting the school locks stops the
 * chain at the school layer.
 */
export function resolveConventions(chain: ConventionChain): ResolvedConventions {
  const locked = new Set(chain.schoolLocks ?? []);
  const values: Record<string, unknown> = { ...chain.preset };
  const sources = Object.fromEntries(CONVENTION_KEYS.map((k) => [k, 'preset'])) as Record<
    ConventionKey,
    ConventionLayer
  >;

  const layers: [ConventionLayer, PartialConventions | undefined][] = [
    ['school', chain.school],
    ['class', chain.class],
    ['teacher', chain.teacher],
  ];
  for (const [layer, settings] of layers) {
    if (!settings) continue;
    for (const key of CONVENTION_KEYS) {
      const value = settings[key];
      if (value === undefined) continue;
      if (layer !== 'school' && locked.has(key)) continue;
      values[key] = Array.isArray(value) ? [...value] : value;
      sources[key] = layer;
    }
  }

  return {
    conventions: values as Conventions,
    sources,
    locked: CONVENTION_KEYS.filter((k) => locked.has(k)),
  };
}
