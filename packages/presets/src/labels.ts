import type { Lang } from '@chalkline/ir';
import type { Labels } from '@chalkline/latex';

/**
 * Document words in each supported language. Dates are formatted from fixed
 * tables, not Intl, so output does not depend on the runtime's ICU data.
 */

const MONTHS: Record<Lang, readonly string[]> = {
  en: [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ],
  es: [
    'enero',
    'febrero',
    'marzo',
    'abril',
    'mayo',
    'junio',
    'julio',
    'agosto',
    'septiembre',
    'octubre',
    'noviembre',
    'diciembre',
  ],
  fr: [
    'janvier',
    'février',
    'mars',
    'avril',
    'mai',
    'juin',
    'juillet',
    'août',
    'septembre',
    'octobre',
    'novembre',
    'décembre',
  ],
  de: [
    'Januar',
    'Februar',
    'März',
    'April',
    'Mai',
    'Juni',
    'Juli',
    'August',
    'September',
    'Oktober',
    'November',
    'Dezember',
  ],
  pt: [
    'janeiro',
    'fevereiro',
    'março',
    'abril',
    'maio',
    'junho',
    'julho',
    'agosto',
    'setembro',
    'outubro',
    'novembro',
    'dezembro',
  ],
};

function dateParts(iso: string): { y: number; m: number; d: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) throw new Error('expected yyyy-mm-dd');
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
}

function formatter(lang: Lang): (iso: string) => string {
  return (iso) => {
    const { y, m, d } = dateParts(iso);
    const month = MONTHS[lang][m - 1] ?? String(m);
    switch (lang) {
      case 'en':
        return `${month} ${d}, ${y}`;
      case 'fr':
        return `${d === 1 ? '1er' : d} ${month} ${y}`;
      case 'de':
        return `${d}. ${month} ${y}`;
      case 'es':
      case 'pt':
        return `${d} de ${month} de ${y}`;
    }
  };
}

type Words = Omit<Labels, 'formatDate' | 'points'> & { point: string; pointsWord: string };

const WORDS: Record<Lang, Words> = {
  en: {
    definition: 'Definition',
    theorem: 'Theorem',
    note: 'Note',
    example: 'Example',
    announcement: 'Announcement',
    solution: 'Solution',
    answer: 'Answer',
    point: 'point',
    pointsWord: 'points',
    name: 'Name',
    date: 'Date',
    score: 'Score',
    page: 'Page',
    pageOf: 'of',
    imageAlt: 'Handwritten work from the board, kept as an image',
    figureAlt: 'Figure from the board',
    mathPlaceholder: 'This expression could not be typeset; see the original notes.',
  },
  es: {
    definition: 'Definición',
    theorem: 'Teorema',
    note: 'Nota',
    example: 'Ejemplo',
    announcement: 'Aviso',
    solution: 'Solución',
    answer: 'Respuesta',
    point: 'punto',
    pointsWord: 'puntos',
    name: 'Nombre',
    date: 'Fecha',
    score: 'Puntuación',
    page: 'Página',
    pageOf: 'de',
    imageAlt: 'Trabajo manuscrito de la pizarra, conservado como imagen',
    figureAlt: 'Figura de la pizarra',
    mathPlaceholder: 'No se pudo componer esta expresión; consulte las notas originales.',
  },
  fr: {
    definition: 'Définition',
    theorem: 'Théorème',
    note: 'Remarque',
    example: 'Exemple',
    announcement: 'Annonce',
    solution: 'Solution',
    answer: 'Réponse',
    point: 'point',
    pointsWord: 'points',
    name: 'Nom',
    date: 'Date',
    score: 'Note',
    page: 'Page',
    pageOf: 'sur',
    imageAlt: 'Travail manuscrit du tableau, conservé en image',
    figureAlt: 'Figure du tableau',
    mathPlaceholder: 'Cette expression n’a pas pu être composée ; voir les notes originales.',
  },
  de: {
    definition: 'Definition',
    theorem: 'Satz',
    note: 'Hinweis',
    example: 'Beispiel',
    announcement: 'Ankündigung',
    solution: 'Lösung',
    answer: 'Antwort',
    point: 'Punkt',
    pointsWord: 'Punkte',
    name: 'Name',
    date: 'Datum',
    score: 'Punktzahl',
    page: 'Seite',
    pageOf: 'von',
    imageAlt: 'Handschrift von der Tafel, als Bild übernommen',
    figureAlt: 'Abbildung von der Tafel',
    mathPlaceholder: 'Dieser Ausdruck konnte nicht gesetzt werden; siehe Originalnotizen.',
  },
  pt: {
    definition: 'Definição',
    theorem: 'Teorema',
    note: 'Nota',
    example: 'Exemplo',
    announcement: 'Aviso',
    solution: 'Solução',
    answer: 'Resposta',
    point: 'ponto',
    pointsWord: 'pontos',
    name: 'Nome',
    date: 'Data',
    score: 'Pontuação',
    page: 'Página',
    pageOf: 'de',
    imageAlt: 'Trabalho manuscrito do quadro, mantido como imagem',
    figureAlt: 'Figura do quadro',
    mathPlaceholder: 'Não foi possível compor esta expressão; veja as notas originais.',
  },
};

export function labelsFor(lang: Lang): Labels {
  const { point, pointsWord, ...words } = WORDS[lang];
  return {
    ...words,
    points: (n) => `${n} ${n === 1 ? point : pointsWord}`,
    formatDate: formatter(lang),
  };
}

/** Title suffixes that tell a worksheet or key apart from the notes. */
export const TITLE_SUFFIX = {
  practice: { en: 'Practice', es: 'Práctica', fr: 'Exercices', de: 'Übungen', pt: 'Prática' },
  answerKey: {
    en: 'Answer Key',
    es: 'Solucionario',
    fr: 'Corrigé',
    de: 'Lösungen',
    pt: 'Gabarito',
  },
  guidedNotes: {
    en: 'Guided Notes',
    es: 'Apuntes guiados',
    fr: 'Notes guidées',
    de: 'Lückentext',
    pt: 'Notas guiadas',
  },
  guidedNotesFilled: {
    en: 'Guided Notes (filled)',
    es: 'Apuntes guiados (completos)',
    fr: 'Notes guidées (complétées)',
    de: 'Lückentext (ausgefüllt)',
    pt: 'Notas guiadas (preenchidas)',
  },
  workedExamples: {
    en: 'Worked Examples',
    es: 'Ejemplos resueltos',
    fr: 'Exemples corrigés',
    de: 'Musterlösungen',
    pt: 'Exemplos resolvidos',
  },
  quiz: { en: 'Quiz', es: 'Prueba', fr: 'Interrogation', de: 'Test', pt: 'Teste' },
  studySheet: {
    en: 'Study Sheet',
    es: 'Hoja de repaso',
    fr: 'Fiche de révision',
    de: 'Lernzettel',
    pt: 'Folha de revisão',
  },
  exitTicket: {
    en: 'Exit Ticket',
    es: 'Ticket de salida',
    fr: 'Billet de sortie',
    de: 'Abschlusskarte',
    pt: 'Bilhete de saída',
  },
  boardSnapshot: {
    en: 'Board',
    es: 'Pizarra',
    fr: 'Tableau',
    de: 'Tafelbild',
    pt: 'Quadro',
  },
} as const satisfies Record<string, Record<Lang, string>>;

/** The document title with a preset's suffix ("Solving quadratics — Answer Key"). Plain text; escaped by the renderer. */
export function titleWithSuffix(
  title: string,
  suffix: keyof typeof TITLE_SUFFIX,
  lang: Lang,
): string {
  return `${title} — ${TITLE_SUFFIX[suffix][lang]}`;
}
