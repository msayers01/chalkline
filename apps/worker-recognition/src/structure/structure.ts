import { ProviderError, type JsonModel, type StructuringModelId } from '@chalkline/providers';
import type { DocMeta } from '@chalkline/ir';
import { checkOutput } from './guards.js';
import { heuristicStructure } from './heuristic.js';
import type { StructureItem } from './input.js';
import { normalize, type Structure } from './normalize.js';
import { SYSTEM_PROMPT, userMessage } from './prompt.js';
import { StructureOutput } from './schema.js';

/**
 * Runs one structuring pass: the model when there is one, behind the guards,
 * with one retry; the heuristic structurer otherwise. Never throws for a
 * provider problem: a lesson always gets a structure.
 */

/** Incremental passes run during class on the fast model; the final pass at session end. */
export type StructurePass = 'incremental' | 'final';

const PASSES: Record<StructurePass, { model: StructuringModelId; effort: 'low' | 'medium' }> = {
  incremental: { model: 'claude-haiku-5-5', effort: 'low' },
  final: { model: 'claude-sonnet-5-5', effort: 'medium' },
};

export type StructureReport = {
  by: Structure['by'];
  model?: StructuringModelId;
  attempts: number;
  /** Why the heuristic structurer was used. */
  fallback?: 'empty' | 'noModel' | 'unavailable' | 'refused' | 'invalid' | 'guards';
  /** Guard violations across attempts (counts only; the messages name ids). */
  violations: number;
};

export type StructureOptions = {
  model?: JsonModel;
  pass: StructurePass;
  meta: Pick<DocMeta, 'title' | 'course' | 'lang'>;
};

export async function structureItems(
  items: readonly StructureItem[],
  options: StructureOptions,
): Promise<{ structure: Structure; report: StructureReport }> {
  const heuristic = (fallback: StructureReport['fallback'], attempts = 0, violations = 0) => ({
    structure: normalize(heuristicStructure(items), items, 'heuristic'),
    report: {
      by: 'heuristic' as const,
      attempts,
      violations,
      ...(fallback ? { fallback } : {}),
      ...(attempts ? { model: PASSES[options.pass].model } : {}),
    },
  });
  if (items.length === 0) return heuristic('empty');
  if (!options.model) return heuristic('noModel');

  const { model, effort } = PASSES[options.pass];
  let problems: string[] = [];
  let violations = 0;
  let lastFailure: 'invalid' | 'guards' = 'invalid';
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    let result;
    try {
      result = await options.model.complete({
        model,
        effort,
        system: SYSTEM_PROMPT,
        user: userMessage(items, options.meta, problems),
        schema: StructureOutput,
        maxTokens: Math.min(32_000, 4_000 + 60 * items.length),
      });
    } catch (e) {
      if (e instanceof ProviderError) return heuristic('unavailable', attempt, violations);
      throw e;
    }
    if (result.kind === 'refused') return heuristic('refused', attempt, violations);
    if (result.kind === 'invalid') {
      problems = [
        result.reason === 'maxTokens' ? 'the answer was cut off' : 'the answer was not valid',
      ];
      lastFailure = 'invalid';
      continue;
    }
    problems = checkOutput(result.output, items);
    if (problems.length === 0) {
      return {
        structure: normalize(result.output, items, 'ai'),
        report: { by: 'ai', model, attempts: attempt, violations },
      };
    }
    violations += problems.length;
    lastFailure = 'guards';
  }
  return heuristic(lastFailure, 2, violations);
}
