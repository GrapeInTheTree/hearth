// Shared ESLint v9 flat config.
// Enforces white-label rule (no hardcoded brand strings) and config/env discipline.

import js from '@eslint/js';
import importX from 'eslint-plugin-import-x';
import promise from 'eslint-plugin-promise';
import unicorn from 'eslint-plugin-unicorn';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // Ignore generated/external paths
  {
    ignores: [
      '**/dist/**',
      '**/build/**',
      '**/out/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/node_modules/**',
      '**/*.tsbuildinfo',
      '**/prisma/migrations/**',
      // Prisma 7 prisma-client generator output. These TS files are
      // regenerated on every `prisma generate` and follow the model
      // PascalCase naming from schema.prisma — they're not source we
      // maintain.
      '**/src/generated/**',
      '**/.changeset/**',
    ],
  },

  // Base recommended rules
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  // Plugin: import order
  {
    plugins: { 'import-x': importX },
    rules: {
      'import-x/order': [
        'error',
        {
          groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
          'newlines-between': 'always',
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],
      'import-x/no-cycle': ['error', { maxDepth: 10 }],
      'import-x/no-self-import': 'error',
      'import-x/no-useless-path-segments': 'error',
    },
  },

  // Plugin: unicorn (selective)
  {
    plugins: { unicorn },
    rules: {
      'unicorn/filename-case': ['error', { cases: { kebabCase: true, camelCase: true } }],
      'unicorn/no-array-for-each': 'off',
      'unicorn/prefer-node-protocol': 'error',
      'unicorn/prefer-top-level-await': 'error',
      'unicorn/no-null': 'off',
      'unicorn/prevent-abbreviations': 'off',
    },
  },

  // Plugin: promise
  {
    plugins: { promise },
    rules: {
      'promise/no-multiple-resolved': 'error',
      'promise/no-return-wrap': 'error',
      'promise/param-names': 'error',
    },
  },

  // Project-wide rules
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
      parserOptions: {
        projectService: true,
      },
    },
    rules: {
      // White-label enforcement: ban hardcoded brand strings outside i18n/test/docs
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[object.name='process'][property.name='env']",
          message:
            'Use the typed `env` export from src/config/env.ts. Direct process.env access is forbidden.',
        },
        {
          selector: 'Literal[value=/Fannie|FanX|Kayen|MEE6|Carl-bot|Dyno|Tickety/i]',
          message: 'Hardcoded brand strings are forbidden. Use i18n templates or branding config.',
        },
      ],

      // No console — use pino logger
      'no-console': 'error',

      // TypeScript hygiene
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { fixStyle: 'separate-type-imports' },
      ],
      '@typescript-eslint/no-unnecessary-condition': 'warn',
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: true, allowBoolean: true },
      ],
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: { arguments: false } },
      ],

      // General hygiene
      eqeqeq: ['error', 'always'],
      'no-var': 'error',
      'prefer-const': 'error',
      'no-param-reassign': ['error', { props: true }],
      'no-implicit-coercion': 'error',
      'object-shorthand': 'error',
      'prefer-template': 'error',
    },
  },

  // Allow brand strings & process.env in i18n/branding/test/scripts/configs/eslint-config
  {
    files: [
      '**/i18n/**',
      '**/branding.ts',
      '**/env.ts',
      '**/*.test.ts',
      '**/*.spec.ts',
      '**/tests/**',
      '**/scripts/**',
      '**/*.config.*',
      '**/eslint.config.*',
      '**/eslint-config/**',
    ],
    rules: {
      'no-restricted-syntax': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },

  // Allow console in scripts, healthcheck, and the env-loader (which runs before logger is ready)
  {
    files: ['**/scripts/**', '**/healthcheck/**', '**/config/env.ts'],
    rules: { 'no-console': 'off' },
  },

  // Database bootstrap legitimately reads NODE_ENV for Prisma log mode
  {
    files: ['**/packages/database/src/client.ts'],
    rules: {
      'no-restricted-syntax': 'off',
      '@typescript-eslint/dot-notation': 'off',
    },
  },

  // Disable typed linting for tests + config files + plain JS files (outside main tsconfig project)
  {
    files: [
      '**/tests/**',
      '**/*.test.ts',
      '**/*.spec.ts',
      '**/*.config.{ts,mjs,js}',
      '**/eslint-config/**/*.js',
      '**/*.mjs',
      '**/*.cjs',
    ],
    ...tseslint.configs.disableTypeChecked,
    rules: {
      ...tseslint.configs.disableTypeChecked.rules,
    },
  },
);
