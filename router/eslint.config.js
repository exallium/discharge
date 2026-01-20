const js = require('@eslint/js');
const tseslint = require('typescript-eslint');

module.exports = tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      '.next/**',
      'mcp-server/**',
      'jest.config.js',
      'eslint.config.js',
      'next.config.js',
      'postcss.config.js',
      'tailwind.config.ts',
      'playwright.config.ts',
      'tests/**',
    ],
  }
);
