import type { Conventions } from '@chalkline/conventions';
import type { CalloutKind } from '@chalkline/ir';
import { joinLatex, tex, type SafeLatex } from '@chalkline/latex';

/**
 * Preamble modules. Each is constant LaTeX chosen by conventions; none
 * contains document content. Packages loaded here must be on the allowlist
 * in `packages.ts` (checked by test/preamble.test.ts).
 */

export type ElementStyle = {
  /** Callout kinds drawn in a box; the rest are set as labelled paragraphs. */
  boxed: readonly CalloutKind[];
  /** Body columns; two columns load multicol. */
  columns: 1 | 2;
};

const NL = tex`
`;

function page(c: Conventions): SafeLatex {
  const paper = c.paperSize === 'a4' ? tex`a4paper,margin=2.5cm` : tex`letterpaper,margin=1in`;
  return tex`\usepackage[${paper},headheight=15pt]{geometry}`;
}

/**
 * Text fonts lack many characters teachers and recognizers produce (Greek in
 * text, arrows, relation symbols, Cyrillic). A missing glyph would print as
 * nothing and break PDF/UA, so text falls back to the matching math font,
 * then to FreeSerif / FreeSans, which ship with TeX Live.
 */
function fonts(c: Conventions): SafeLatex {
  const faces: Record<Conventions['font'], { text: SafeLatex; math: SafeLatex; last: SafeLatex }> =
    {
      latinModern: {
        text: tex`Latin Modern Roman`,
        math: tex`Latin Modern Math`,
        last: tex`FreeSerif`,
      },
      pagella: {
        text: tex`TeX Gyre Pagella`,
        math: tex`TeX Gyre Pagella Math`,
        last: tex`FreeSerif`,
      },
      termes: { text: tex`TeX Gyre Termes`, math: tex`TeX Gyre Termes Math`, last: tex`FreeSerif` },
      sans: { text: tex`Fira Sans`, math: tex`Fira Math`, last: tex`FreeSans` },
    };
  const face = faces[c.font];
  // article has no 14pt option: large print sets 14/17 on a 12pt class.
  const largePrint =
    c.fontSize === 14
      ? tex`
\renewcommand{\normalsize}{\fontsize{14pt}{17pt}\selectfont}
\AtBeginDocument{\normalsize}`
      : tex``;
  return tex`\usepackage{amsmath}
\usepackage{fontspec}
\usepackage{unicode-math}
\directlua{luaotfload.add_fallback("clfallback", {"${face.math}:mode=node;", "file:${face.last}.otf:mode=node;"})}
\setmainfont{${face.text}}[RawFeature={fallback=clfallback}]
\setmathfont{${face.math}}${largePrint}`;
}

/** English uses the format's patterns. Other languages switch hyphenation off rather than hyphenate wrongly. */
function hyphenation(c: Conventions): SafeLatex {
  if (c.lang === 'en') return tex``;
  return tex`\hyphenpenalty=10000
\exhyphenpenalty=10000
\emergencystretch=3em`;
}

const graphics = tex`\usepackage{xcolor}
\definecolor{clBlue}{HTML}{1F4E9C}
\definecolor{clRed}{HTML}{B3261E}
\definecolor{clGreen}{HTML}{1E6B34}
\definecolor{clOrange}{HTML}{A65200}
\definecolor{clPurple}{HTML}{6B3FA0}
\definecolor{clBrown}{HTML}{7A4A1E}
\usepackage{graphicx}
\usepackage{array}
\usepackage{booktabs}
\usepackage{tcolorbox}`;

const headers = tex`\usepackage{fancyhdr}
\usepackage{lastpage}
\pagestyle{fancy}
\fancyhf{}
\renewcommand{\headrulewidth}{0.4pt}
\NewDocumentCommand{\clheader}{mm}{\fancyhead[L]{\small #1}\fancyhead[R]{\small #2}}
\NewDocumentCommand{\clfooter}{m}{\fancyfoot[C]{\small #1}}`;

// \maketitle works once per document; later titles (Exit Ticket copies) are set by hand.
const title = tex`\newif\ifcltitled
\NewDocumentCommand{\cltitle}{mm}{%
  \ifcltitled
    \begin{center}{\Large #1\par}\smallskip{#2\par}\end{center}%
  \else
    \title{#1}\author{#2}\date{}%
    \maketitle\thispagestyle{fancy}\vspace{-2em}\global\cltitledtrue
  \fi}
\NewDocumentCommand{\clquizheader}{mmm}{%
  \par\noindent #1: \rule{6cm}{0.4pt}\hfill #2: \rule{3cm}{0.4pt}\hfill #3: \rule{2cm}{0.4pt}\par\bigskip}`;

const BOX_OPTIONS = tex`colback=white,colframe=black!55,boxrule=0.6pt,arc=2pt,left=6pt,right=6pt,top=4pt,bottom=4pt,before skip=8pt,after skip=8pt`;

function callout(name: SafeLatex, boxed: boolean): SafeLatex {
  const heading = tex`\noindent\textbf{#1\IfBlankF{#2}{: #2}.}\ \ignorespaces`;
  if (boxed) {
    return tex`\NewDocumentEnvironment{${name}}{mm}{\begin{tcolorbox}[${BOX_OPTIONS}]${heading}}{\end{tcolorbox}}`;
  }
  return tex`\NewDocumentEnvironment{${name}}{mm}{\par\medskip${heading}}{\par\medskip}`;
}

function elements(style: ElementStyle): SafeLatex {
  const kinds: [CalloutKind, SafeLatex][] = [
    ['definition', tex`cldefinition`],
    ['theorem', tex`cltheorem`],
    ['note', tex`clnote`],
    ['example', tex`clexample`],
    ['announcement', tex`clannouncement`],
  ];
  const callouts = kinds.map(([kind, name]) => callout(name, style.boxed.includes(kind)));
  return tex`${joinLatex(callouts, NL)}
\NewDocumentEnvironment{clproblem}{mm}{\par\medskip\noindent\textbf{#1.}\IfBlankF{#2}{ \textit{(#2)}}\ \ignorespaces}{\par}
\NewDocumentEnvironment{clparts}{}{\begin{enumerate}[label=(\alph*)]}{\end{enumerate}}
\NewDocumentEnvironment{clsolution}{m}{\par\smallskip\noindent\textit{#1.}\ \ignorespaces}{\par\smallskip}
\NewDocumentCommand{\clanswer}{mm}{\par\smallskip\noindent\textit{#1:}\ #2\par}
\NewDocumentCommand{\clanswerboxed}{mm}{\par\smallskip\noindent\textit{#1:}\ \fbox{#2}\par}
\NewDocumentCommand{\clanswerspace}{m}{\par\vspace{#1\baselineskip}}
\NewDocumentCommand{\clplaceholder}{m}{\fbox{\textit{#1}}}
\NewDocumentCommand{\clblank}{m}{\par\noindent\fbox{\parbox[t][#1\baselineskip][t]{\dimexpr\linewidth-2\fboxsep-2\fboxrule\relax}{\mbox{}}}\par}
\NewDocumentCommand{\clcutline}{}{\par\vspace{1.5em}\noindent\makebox[\linewidth]{\dotfill}\par\vspace{1.5em}}
\NewDocumentEnvironment{clkeep}{}{\par\noindent\begin{minipage}{\linewidth}\setlength{\parskip}{0.5\baselineskip}}{\end{minipage}\par}
${columns(style)}
\setlength{\parindent}{0pt}
\setlength{\parskip}{0.5\baselineskip}`;
}

function columns(style: ElementStyle): SafeLatex {
  if (style.columns === 1) return tex`\NewDocumentEnvironment{clcolumns}{}{}{}`;
  return tex`\usepackage{multicol}
\setlength{\columnsep}{1.5em}
\NewDocumentEnvironment{clcolumns}{}{\begin{multicols}{2}\raggedright}{\end{multicols}}`;
}

/** hyperref goes last; the tagging code loads its PDF management first. */
const links = tex`\usepackage{hyperref}
\hypersetup{hidelinks}`;

export function buildPreamble(c: Conventions, style: ElementStyle): SafeLatex {
  const parts = [
    page(c),
    fonts(c),
    hyphenation(c),
    graphics,
    headers,
    title,
    elements(style),
    links,
  ];
  return joinLatex(
    parts.filter((p) => p !== tex``),
    NL,
  );
}

export function classOptions(c: Conventions): SafeLatex {
  const size: Record<Conventions['fontSize'], SafeLatex> = {
    10: tex`10pt`,
    11: tex`11pt`,
    12: tex`12pt`,
    14: tex`12pt`,
  };
  return size[c.fontSize];
}
