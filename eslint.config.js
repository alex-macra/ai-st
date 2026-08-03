import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

// Linting is deliberately not type-aware. The tsconfigs already run strict with
// noUncheckedIndexedAccess and exactOptionalPropertyTypes, and `npm run
// typecheck` in each workspace is the authority on type errors. This config
// covers what the compiler does not: unused code, unsafe patterns, and the
// rules of hooks.
export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.venv/**',
      '**/coverage/**',
      'test-results/**',
      'playwright-report/**',
      '**/*-snapshots/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    rules: {
      // Underscore marks a binding kept for signature or destructuring shape.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      // `declare global { namespace Express { ... } }` is the only way to
      // augment the Request type. Runtime namespaces stay banned.
      '@typescript-eslint/no-namespace': ['error', { allowDeclarations: true }],
    },
  },

  {
    files: ['**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
  },

  {
    files: ['frontend/src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: {
      globals: { ...globals.browser },
    },
    rules: reactHooks.configs.recommended.rules,
  },

  {
    files: [
      'api/**/*.ts',
      'e2e/**/*.ts',
      'scripts/**/*.mjs',
      'preprocessor/**/*.ts',
      '*.config.ts',
      '*.config.js',
    ],
    languageOptions: {
      globals: { ...globals.node },
    },
  },

  {
    files: ['**/__tests__/**/*.{ts,tsx}', '**/*.test.{ts,tsx}', '**/*.spec.ts'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
  },
);
