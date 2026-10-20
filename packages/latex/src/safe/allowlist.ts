/**
 * What recognized or teacher-typed math may contain. Anything not listed here
 * is rejected by `sanitizeMath()`; the block then becomes an image fallback
 * upstream, or a placeholder at render time.
 *
 * Adding an entry is a security-relevant change: it must be a pure
 * typesetting command available with amsmath + unicode-math, it must never
 * read or write files, define or expand macros, or change catcodes, and the
 * compile matrix's allowlist document must still compile.
 */

export type ArgMode = 'math' | 'text';

export type MacroRole =
  /** `\left`, `\right`: the next token must be a delimiter; pairs must balance. */
  | 'left'
  | 'right'
  | 'middle'
  /** `\big(` and friends: the next token must be a delimiter. */
  | 'sizer'
  /** `\limits`, `\nolimits`: must follow a big operator. */
  | 'limits'
  /** `\not`: must precede a relation. */
  | 'negation';

export type MacroSpec = {
  /** unified-latex/xparse signature: `m` mandatory, `o` optional, `s` star. Empty for none. */
  signature: string;
  /** Mode of each `m`/`o` argument, in order. Defaults to math. */
  argModes?: readonly ArgMode[];
  role?: MacroRole;
};

const none: MacroSpec = { signature: '' };
const one: MacroSpec = { signature: 'm' };
const two: MacroSpec = { signature: 'm m' };
const textArg: MacroSpec = { signature: 'm', argModes: ['text'] };

function all(names: readonly string[], spec: MacroSpec): [string, MacroSpec][] {
  return names.map((n) => [n, spec]);
}

export const GREEK = [
  'alpha',
  'beta',
  'gamma',
  'delta',
  'epsilon',
  'varepsilon',
  'zeta',
  'eta',
  'theta',
  'vartheta',
  'iota',
  'kappa',
  'varkappa',
  'lambda',
  'mu',
  'nu',
  'xi',
  'pi',
  'varpi',
  'rho',
  'varrho',
  'sigma',
  'varsigma',
  'tau',
  'upsilon',
  'phi',
  'varphi',
  'chi',
  'psi',
  'omega',
  'Gamma',
  'Delta',
  'Theta',
  'Lambda',
  'Xi',
  'Pi',
  'Sigma',
  'Upsilon',
  'Phi',
  'Psi',
  'Omega',
] as const;

export const BINARY_OPERATORS = [
  'pm',
  'mp',
  'times',
  'div',
  'cdot',
  'ast',
  'star',
  'circ',
  'bullet',
  'cap',
  'cup',
  'sqcap',
  'sqcup',
  'vee',
  'wedge',
  'land',
  'lor',
  'setminus',
  'oplus',
  'ominus',
  'otimes',
  'oslash',
  'odot',
  'dagger',
  'ddagger',
  'amalg',
  'wr',
  'diamond',
  'triangleleft',
  'triangleright',
  'bigcirc',
  'uplus',
  'bmod',
] as const;

export const RELATIONS = [
  'leq',
  'geq',
  'le',
  'ge',
  'neq',
  'ne',
  'equiv',
  'approx',
  'approxeq',
  'cong',
  'sim',
  'simeq',
  'asymp',
  'propto',
  'prec',
  'succ',
  'preceq',
  'succeq',
  'll',
  'gg',
  'subset',
  'supset',
  'subseteq',
  'supseteq',
  'subsetneq',
  'supsetneq',
  'sqsubseteq',
  'sqsupseteq',
  'in',
  'ni',
  'notin',
  'perp',
  'parallel',
  'nparallel',
  'mid',
  'nmid',
  'models',
  'vdash',
  'dashv',
  'doteq',
  'leqslant',
  'geqslant',
  'lesssim',
  'gtrsim',
  'nleq',
  'ngeq',
  'nless',
  'ngtr',
  'nsim',
  'ncong',
  'to',
  'gets',
  'leftarrow',
  'rightarrow',
  'Leftarrow',
  'Rightarrow',
  'leftrightarrow',
  'Leftrightarrow',
  'longleftarrow',
  'longrightarrow',
  'Longleftarrow',
  'Longrightarrow',
  'longleftrightarrow',
  'Longleftrightarrow',
  'iff',
  'implies',
  'impliedby',
  'mapsto',
  'longmapsto',
  'nearrow',
  'searrow',
  'swarrow',
  'nwarrow',
  'hookleftarrow',
  'hookrightarrow',
  'leftharpoonup',
  'rightharpoonup',
  'rightleftharpoons',
] as const;

/** Commands that may be followed by `\limits` / `\nolimits`. */
export const BIG_OPERATORS = [
  'sum',
  'prod',
  'coprod',
  'int',
  'iint',
  'iiint',
  'oint',
  'bigcup',
  'bigcap',
  'bigvee',
  'bigwedge',
  'bigoplus',
  'bigotimes',
  'bigodot',
  'bigsqcup',
  'biguplus',
  'lim',
  'limsup',
  'liminf',
  'max',
  'min',
  'sup',
  'inf',
  'det',
  'gcd',
  'Pr',
] as const;

export const FUNCTION_NAMES = [
  'sin',
  'cos',
  'tan',
  'cot',
  'sec',
  'csc',
  'arcsin',
  'arccos',
  'arctan',
  'sinh',
  'cosh',
  'tanh',
  'coth',
  'log',
  'ln',
  'lg',
  'exp',
  'deg',
  'arg',
  'dim',
  'ker',
  'hom',
] as const;

/** Commands that produce a delimiter (valid after `\left`, `\right`, `\big`, ...). */
export const DELIMITER_MACROS = [
  'langle',
  'rangle',
  'lvert',
  'rvert',
  'lVert',
  'rVert',
  'vert',
  'Vert',
  'lfloor',
  'rfloor',
  'lceil',
  'rceil',
  'lbrace',
  'rbrace',
  'lbrack',
  'rbrack',
  'uparrow',
  'downarrow',
  'updownarrow',
  'Uparrow',
  'Downarrow',
  'Updownarrow',
  'backslash',
  '{',
  '}',
  '|',
] as const;

/** Characters that are delimiters on their own. `.` is the empty delimiter. */
export const DELIMITER_CHARS = ['(', ')', '[', ']', '|', '/', '.'] as const;

const SYMBOLS = [
  'infty',
  'partial',
  'nabla',
  'forall',
  'exists',
  'nexists',
  'emptyset',
  'varnothing',
  'neg',
  'lnot',
  'angle',
  'measuredangle',
  'sphericalangle',
  'triangle',
  'checkmark',
  'prime',
  'backprime',
  'ell',
  'hbar',
  'hslash',
  'Re',
  'Im',
  'aleph',
  'beth',
  'wp',
  'top',
  'bot',
  'therefore',
  'because',
  'imath',
  'jmath',
  'surd',
  'flat',
  'natural',
  'sharp',
  'clubsuit',
  'diamondsuit',
  'heartsuit',
  'spadesuit',
  'dots',
  'ldots',
  'cdots',
  'vdots',
  'ddots',
  'dotsc',
  'dotsb',
  'dotsm',
  'dotsi',
  'dotso',
  'colon',
  'quad',
  'qquad',
  'displaystyle',
  'textstyle',
  'scriptstyle',
  'scriptscriptstyle',
] as const;

/** Control symbols: a backslash followed by one non-letter. */
const CONTROL_SYMBOLS = [',', ';', ':', '!', ' ', '>', '%', '#', '&', '$', '_'] as const;

const ACCENTS = [
  'hat',
  'widehat',
  'tilde',
  'widetilde',
  'bar',
  'overline',
  'underline',
  'vec',
  'overrightarrow',
  'overleftarrow',
  'overleftrightarrow',
  'dot',
  'ddot',
  'dddot',
  'acute',
  'grave',
  'breve',
  'check',
  'mathring',
  'overbrace',
  'underbrace',
] as const;

export const MATH_FONTS = [
  'mathbf',
  'mathrm',
  'mathit',
  'mathsf',
  'mathtt',
  'mathcal',
  'mathbb',
  'mathfrak',
  'mathscr',
  'boldsymbol',
  'symbf',
  'symbfit',
  'symup',
  'symrm',
] as const;

/** Text-mode argument commands, allowed in math. */
export const TEXT_COMMANDS = [
  'text',
  'textrm',
  'textbf',
  'textit',
  'textsf',
  'texttt',
  'textnormal',
  'mbox',
] as const;

export const MATH_MACROS: ReadonlyMap<string, MacroSpec> = new Map<string, MacroSpec>([
  ...all(GREEK, none),
  ...all(BINARY_OPERATORS, none),
  ...all(RELATIONS, none),
  ...all(BIG_OPERATORS, none),
  ...all(FUNCTION_NAMES, none),
  ...all(SYMBOLS, none),
  ...all(CONTROL_SYMBOLS, none),
  ...all(DELIMITER_MACROS, none),
  ...all(ACCENTS, one),
  ...all(MATH_FONTS, one),
  ...all(TEXT_COMMANDS, textArg),
  ...all(
    ['frac', 'dfrac', 'tfrac', 'binom', 'dbinom', 'tbinom', 'overset', 'underset', 'stackrel'],
    two,
  ),
  ['sqrt', { signature: 'o m' }],
  ['boxed', one],
  ['operatorname', { signature: 's m' }],
  ['pmod', one],
  ['pod', one],
  ['mod', one],
  ['left', { signature: '', role: 'left' }],
  ['right', { signature: '', role: 'right' }],
  ['middle', { signature: '', role: 'middle' }],
  ...all(
    [
      'big',
      'Big',
      'bigg',
      'Bigg',
      'bigl',
      'bigr',
      'Bigl',
      'Bigr',
      'biggl',
      'biggr',
      'Biggl',
      'Biggr',
      'bigm',
      'Bigm',
    ],
    { signature: '', role: 'sizer' },
  ),
  ['limits', { signature: '', role: 'limits' }],
  ['nolimits', { signature: '', role: 'limits' }],
  ['not', { signature: '', role: 'negation' }],
]);

/** Commands allowed inside a text-mode argument such as `\text{...}`. */
export const TEXT_MACROS: ReadonlyMap<string, MacroSpec> = new Map<string, MacroSpec>([
  ...all(['%', '#', '&', '$', '_', '{', '}', ',', ' '], none),
  // What escapeText() emits for characters without a control symbol.
  ...all(['textbackslash', 'textasciicircum', 'textasciitilde', 'textasciigrave'], none),
  ...all(['textbf', 'textit', 'textrm', 'textsf', 'texttt', 'emph'], textArg),
]);

export type EnvironmentSpec = {
  /** `&` allowed at the environment's top level. */
  alignment: boolean;
  /** `\\` allowed at the environment's top level. */
  lineBreaks: boolean;
  /** Takes a column specification (`array`); its letters set the column count. */
  columns?: boolean;
  /** Most cells a row may have. Unset: no limit, or taken from the column spec. */
  maxColumns?: number;
};

// amsmath matrices allow MaxMatrixCols (10) columns; cases has two.
const grid: EnvironmentSpec = { alignment: true, lineBreaks: true, maxColumns: 10 };

export const MATH_ENVIRONMENTS: ReadonlyMap<string, EnvironmentSpec> = new Map<
  string,
  EnvironmentSpec
>([
  ['matrix', grid],
  ['pmatrix', grid],
  ['bmatrix', grid],
  ['Bmatrix', grid],
  ['vmatrix', grid],
  ['Vmatrix', grid],
  ['smallmatrix', { alignment: true, lineBreaks: true }],
  ['cases', { alignment: true, lineBreaks: true, maxColumns: 2 }],
  ['aligned', { alignment: true, lineBreaks: true }],
  ['gathered', { alignment: false, lineBreaks: true }],
  ['array', { alignment: true, lineBreaks: true, columns: true }],
]);

/**
 * Never allowed, whatever else changes. `test/allowlist.test.ts` asserts the
 * allowlists and this list stay disjoint.
 */
export const BANNED_MACROS = [
  'input',
  'include',
  'includeonly',
  'InputIfFileExists',
  'write',
  'immediate',
  'openin',
  'openout',
  'read',
  'readline',
  'closein',
  'closeout',
  'csname',
  'endcsname',
  'catcode',
  'lccode',
  'uccode',
  'sfcode',
  'mathcode',
  'delcode',
  'def',
  'edef',
  'gdef',
  'xdef',
  'let',
  'futurelet',
  'newcommand',
  'renewcommand',
  'providecommand',
  'DeclareRobustCommand',
  'NewDocumentCommand',
  'RenewDocumentCommand',
  'expandafter',
  'noexpand',
  'string',
  'scantokens',
  'lowercase',
  'uppercase',
  'directlua',
  'luaexec',
  'luadirect',
  'latelua',
  'special',
  'pdfliteral',
  'usepackage',
  'RequirePackage',
  'documentclass',
  'makeatletter',
  'makeatother',
  'endinput',
  'jobname',
  'global',
  'outer',
  'afterassignment',
  'aftergroup',
  'begingroup',
  'endgroup',
  'loop',
  'repeat',
  'href',
  'url',
  'includegraphics',
  'verb',
  'color',
  'textcolor',
  'tag',
  'label',
  'ref',
  'eqref',
  'hypersetup',
  'DocumentMetadata',
] as const;
