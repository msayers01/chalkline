export { RECOGNITION_PARAMS } from './params.js';
export { TEACHER_TAGS } from './types.js';
export type { BoardBlock, TeacherTag } from './types.js';
export { derivedId } from './ids.js';
export {
  confidenceOf,
  postprocessRegion,
  regionAssetRef,
  statusFor,
} from './postprocess/postprocess.js';
export type {
  PostprocessNote,
  PostprocessResult,
  RegionInput,
  RegionOutcome,
} from './postprocess/postprocess.js';
export { repairMath } from './postprocess/repair.js';
export type { RepairName, RepairResult } from './postprocess/repair.js';
export { displayLines, pieces } from './postprocess/segments.js';
export type { Piece, Run } from './postprocess/segments.js';
export { buildDoc } from './structure/apply.js';
export type { DocIdentity } from './structure/apply.js';
export { checkOutput, plainTitle } from './structure/guards.js';
export { heuristicStructure } from './structure/heuristic.js';
export { buildItems, placementsFromDoc, readingOrder } from './structure/input.js';
export type { Pinned, Placement, StructureItem } from './structure/input.js';
export { detectLabel, stripLabel } from './structure/labels.js';
export { normalize } from './structure/normalize.js';
export type { Structure } from './structure/normalize.js';
export { SYSTEM_PROMPT, userMessage } from './structure/prompt.js';
export { PARENT_ROLES, ROLES, StructureOutput } from './structure/schema.js';
export type { Role } from './structure/schema.js';
export { structureItems } from './structure/structure.js';
export type { StructureOptions, StructurePass, StructureReport } from './structure/structure.js';
export { bisect, hasMath, probeKey, validateBlocks } from './validate/probe.js';
export type { ProbeCompile, ProbeOptions, ProbeOutcome, ValidateReport } from './validate/probe.js';
export { mergeWithPrevious, recognizeRegions, structureSession } from './pipeline.js';
export type { RegionReport, SessionInput, SessionReport } from './pipeline.js';
export { simulateSession, textOf } from './simulate.js';
export type { SimulatedSession, Write } from './simulate.js';
