import js from '@eslint/js';
import chalkline from '@chalkline/eslint-plugin';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig(
  {
    ignores: ['**/node_modules/**', '**/dist/**', '**/coverage/**', 'tools/compile-matrix/out/**'],
  },
  js.configs.recommended,
  tseslint.configs.strict,
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      // Logs carry ids only; libraries do not log at all.
      'no-console': 'error',
    },
  },
  {
    // Invariant 3: one path from content to LaTeX. safe/ implements that path.
    // labels.ts builds plain text that is escaped where it is used.
    files: ['packages/latex/src/**/*.ts', 'packages/presets/src/**/*.ts'],
    ignores: ['packages/latex/src/safe/**', 'packages/presets/src/labels.ts'],
    plugins: { chalkline },
    rules: {
      'chalkline/no-raw-latex-interpolation': 'error',
    },
  },
  {
    files: ['tools/**/*.{js,ts}', '**/test/**/*.{js,ts}', '*.config.{js,ts}'],
    rules: {
      'no-console': 'off',
    },
  },
);
