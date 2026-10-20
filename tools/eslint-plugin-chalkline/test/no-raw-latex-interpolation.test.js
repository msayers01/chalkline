import { RuleTester } from '@typescript-eslint/rule-tester';
import { afterAll, describe, it } from 'vitest';
import plugin from '../src/index.js';

RuleTester.afterAll = afterAll;
RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const ruleTester = new RuleTester();

ruleTester.run('no-raw-latex-interpolation', plugin.rules['no-raw-latex-interpolation'], {
  valid: [
    'const a = tex`\\section{${title}}`;',
    'const b = tex`\\begin{document}`;',
    'const c = `plain string without interpolation`;',
    "const d = 'a' + 'b';",
    'const e = joinLatex([a, b], tex`\\\\`);',
    'const f = x as string;',
  ],
  invalid: [
    { code: 'const a = `\\section{${title}}`;', errors: [{ messageId: 'rawTemplate' }] },
    { code: 'const a = String.raw`\\section{${title}}`;', errors: [{ messageId: 'rawTemplate' }] },
    { code: 'const a = html`<b>${title}</b>`;', errors: [{ messageId: 'rawTemplate' }] },
    { code: "const a = '\\\\textbf{' + title + '}';", errors: [{ messageId: 'rawConcat' }] },
    { code: 'const a = title + `\\\\par`;', errors: [{ messageId: 'rawConcat' }] },
    { code: 'const a = title as SafeLatex;', errors: [{ messageId: 'unsafeCast' }] },
    {
      code: 'const a = <SafeLatex>title;',
      filename: 'file.ts',
      errors: [{ messageId: 'unsafeCast' }],
    },
  ],
});
