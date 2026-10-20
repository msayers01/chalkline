import type { Doc } from '@chalkline/ir';
import { fixtures } from '@chalkline/ir/fixtures';
import {
  recognizeRegions,
  simulateSession,
  structureSession,
  type ProbeOptions,
  type ValidateReport,
} from '@chalkline/worker-recognition';

/**
 * Documents that came through the recognition pipeline: each fixture written
 * on a simulated board, recognized, probed and structured, once by the
 * heuristic structurer and once by a model answering with the true
 * structure. Whatever the pipeline builds must compile like a hand-written
 * document.
 */
export async function boardDocs(
  probe: ProbeOptions,
): Promise<{ docs: Record<string, Doc>; probes: Record<string, ValidateReport> }> {
  const docs: Record<string, Doc> = {};
  const probes: Record<string, ValidateReport> = {};
  for (const [name, build] of Object.entries(fixtures)) {
    const lesson = build();
    const session = simulateSession(lesson);
    const { blocks } = await recognizeRegions(session.regions, session.recognizer);
    const identity = { id: lesson.id, sessionId: lesson.sessionId, version: 1, meta: lesson.meta };
    for (const [path, model] of [
      ['heuristic', undefined],
      ['model', session.oracle],
    ] as const) {
      const result = await structureSession({
        blocks,
        identity,
        pass: 'final',
        ...(model ? { model } : {}),
        // The probe runs once per fixture; both paths see the same blocks.
        ...(path === 'heuristic' ? { probe } : {}),
      });
      docs[`board-${path}-${name}`] = result.doc;
      if (result.report.validate) probes[name] = result.report.validate;
    }
  }
  return { docs, probes };
}
