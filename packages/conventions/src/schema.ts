import { schema } from '@chalkline/ir';
import { z } from 'zod';

/**
 * Notation and formatting rules. Conventions never change meaning: they are
 * applied to parsed math, and only where the target is unambiguous.
 */

export const HeaderField = z.enum([
  'course',
  'teacher',
  'date',
  'unit',
  'lessonTitle',
  'pageXofY',
  'logo',
]);
export type HeaderField = z.infer<typeof HeaderField>;

export const Conventions = z.object({
  paperSize: z.enum(['letter', 'a4']),
  font: z.enum(['latinModern', 'pagella', 'termes', 'sans']),
  /** 14 is large print. */
  fontSize: z.union([z.literal(10), z.literal(11), z.literal(12), z.literal(14)]),
  header: z.array(HeaderField),
  problemNumbering: z.enum(['continuous', 'restartEachSection']),
  equationNumbers: z.enum(['none', 'all', 'referenced']),
  multiplicationSign: z.enum(['asWritten', 'cdot', 'times']),
  decimalSeparator: z.enum(['point', 'comma']),
  vectors: z.enum(['asWritten', 'arrow', 'bold']),
  derivatives: z.enum(['asWritten', 'prime', 'leibniz']),
  differentialD: z.enum(['italic', 'upright']),
  finalAnswers: z.enum(['boxed', 'plain']),
  inkColor: z.enum(['monochrome', 'keepColors']),
  units: z.enum(['plain', 'siunitx']),
  lang: schema.Lang,
});
export type Conventions = z.infer<typeof Conventions>;
export type ConventionKey = keyof Conventions;

export const PartialConventions = Conventions.partial();
export type PartialConventions = z.infer<typeof PartialConventions>;

export const CONVENTION_KEYS = Conventions.keyof().options;

/** Product defaults (see the product design document, "Conventions"). */
export const DEFAULT_CONVENTIONS: Conventions = {
  paperSize: 'letter',
  font: 'latinModern',
  fontSize: 11,
  header: ['course', 'date', 'pageXofY'],
  problemNumbering: 'continuous',
  equationNumbers: 'none',
  multiplicationSign: 'asWritten',
  decimalSeparator: 'point',
  vectors: 'asWritten',
  derivatives: 'asWritten',
  differentialD: 'italic',
  finalAnswers: 'boxed',
  inkColor: 'keepColors',
  units: 'siunitx',
  lang: 'en',
};
