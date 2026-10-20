import type { Inline } from '@chalkline/ir';
import type { Role } from './schema.js';

/**
 * Labels teachers write in front of things ("3.", "(b)", "Solution:",
 * "Def."), in the five supported languages. The heuristic structurer uses
 * them to find structure; once a block has its role, the label is removed,
 * since every preset prints its own numbering and labels.
 */

const END = String.raw`(?=[\s.:,)]|$)`;

const words = (...list: string[]) => list.join('|');

const PATTERNS: readonly [LabelKind, RegExp][] = [
  [
    'problem',
    new RegExp(
      [
        String.raw`^(?:(?:${words('problem', 'exercise', 'question', 'problema', 'ejercicio', 'pregunta', 'exercice', 'problème', 'aufgabe', 'frage', 'exercício', 'questão')})${END}\.?\s*(?:#?\s*\d{1,3}[a-z]?)?\s*[.):]?`,
        String.raw`(?:ex|q)\.?\s*#?\s*\d{1,3}[a-z]?\s*[.):]?`,
        // A bare number needs its period or parenthesis, and "3.5" is not a label.
        String.raw`\d{1,3}\s*[.)](?=\s|$))\s*`,
      ].join('|'),
      'iu',
    ),
  ],
  ['part', /^\(?(?:[a-h]|i{1,3}|iv|vi{0,3})\)\s*/u],
  [
    'solution',
    new RegExp(
      String.raw`^(?:${words('solution', 'soln', 'sol', 'solución', 'solução', 'lösung', 'resolución', 'résolution')})${END}\.?\s*:?\s*`,
      'iu',
    ),
  ],
  [
    'answer',
    new RegExp(
      String.raw`^(?:${words('answer', 'ans', 'respuesta', 'réponse', 'antwort', 'resposta')})${END}\.?\s*:?\s*`,
      'iu',
    ),
  ],
  [
    'definition',
    new RegExp(
      String.raw`^(?:${words('definition', 'defn', 'def', 'definición', 'définition', 'definição')})${END}\.?\s*:?\s*`,
      'iu',
    ),
  ],
  [
    'theorem',
    new RegExp(
      String.raw`^(?:${words('theorem', 'thm', 'teorema', 'théorème', 'satz')})${END}\.?\s*:?\s*`,
      'iu',
    ),
  ],
  [
    'note',
    new RegExp(
      String.raw`^(?:${words('note', 'remark', 'nb', 'n\\.b', 'nota', 'observación', 'remarque', 'bemerkung', 'hinweis', 'observação')})${END}\.?\s*:?\s*`,
      'iu',
    ),
  ],
  [
    'example',
    new RegExp(
      String.raw`^(?:${words('example', 'ex', 'e\\.g', 'ejemplo', 'exemple', 'beispiel', 'exemplo')})${END}\.?\s*\d{0,3}\s*:?\s*`,
      'iu',
    ),
  ],
];

/** Announcements are recognized, never stripped: "Quiz on Friday" keeps its first word. */
const ANNOUNCEMENT = new RegExp(
  String.raw`^(?:${words('reminder', 'homework', 'hw', 'quiz', 'exam', 'due', 'tarea', 'examen', 'devoir', 'contrôle', 'hausaufgabe', 'prüfung', 'lição de casa', 'prova')})${END}`,
  'iu',
);

export type LabelKind = Extract<
  Role,
  'problem' | 'part' | 'solution' | 'answer' | 'definition' | 'theorem' | 'note' | 'example'
>;

export type Label = { kind: LabelKind | 'announcement'; length: number };

/** The label a block's text starts with, if any. */
export function detectLabel(inlines: readonly Inline[]): Label | undefined {
  const first = inlines[0];
  if (first?.kind !== 'text') return undefined;
  const text = first.text.normalize('NFC').trimStart();
  for (const [kind, pattern] of PATTERNS) {
    const m = pattern.exec(text);
    if (m) return { kind, length: m[0].length };
  }
  if (ANNOUNCEMENT.test(text)) return { kind: 'announcement', length: 0 };
  return undefined;
}

/** Points written with a problem: "(5 points)", "[3 pts]". */
const POINTS = /\s*[([]\s*(\d{1,3})\s*(?:points?|pts?|marks?|puntos|punkte|pontos)\s*[)\]]\s*/iu;

/**
 * Removes the label matching `role` from the start of a block's text, and
 * points from a problem. `labelOnly` is set (and the inlines left as they
 * were) when nothing but the label was written.
 */
export function stripLabel(
  inlines: readonly Inline[],
  role: Role,
): { inlines: Inline[]; points?: number; labelOnly: boolean } {
  let out = [...inlines];
  let points: number | undefined;
  const label = detectLabel(out);
  const first = out[0];
  if (label && label.kind === role && label.length > 0 && first?.kind === 'text') {
    const rest = first.text.normalize('NFC').trimStart().slice(label.length);
    out = rest ? [{ ...first, text: rest }, ...out.slice(1)] : out.slice(1);
  }
  if (role === 'problem') {
    out = out.map((inline) => {
      if (inline.kind !== 'text' || points !== undefined) return inline;
      const m = POINTS.exec(inline.text);
      if (!m) return inline;
      points = Number(m[1]);
      return { ...inline, text: inline.text.replace(POINTS, ' ').trim() };
    });
  }
  out = out.filter((i) => i.kind === 'math' || i.text.trim());
  const withPoints = points !== undefined && points > 0 ? { points } : {};
  if (out.length === 0) return { inlines: [...inlines], ...withPoints, labelOnly: true };
  return { inlines: out, ...withPoints, labelOnly: false };
}
