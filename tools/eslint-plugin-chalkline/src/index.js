import { noRawLatexInterpolation } from './no-raw-latex-interpolation.js';

/** Chalkline's own lint rules. */
const plugin = {
  meta: { name: '@chalkline/eslint-plugin', version: '0.1.0' },
  rules: {
    'no-raw-latex-interpolation': noRawLatexInterpolation,
  },
};

export default plugin;
