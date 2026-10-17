import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'playwright-report/**', 'test-results/**', 'public/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
      ecmaVersion: 2023,
      sourceType: 'module',
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-console': ['error', { allow: ['warn', 'error', 'info'] }],
      eqeqeq: ['error', 'smart'],
      // Запрет заглушек в main (раздел 11 ТЗ).
      'no-warning-comments': ['error', { terms: ['todo', 'fixme', 'xxx'], location: 'anywhere' }],
    },
  },
  {
    files: [
      'src/core/sim*.ts',
      'src/core/rng.ts',
      'src/core/loop.ts',
      'src/physics/**/*.ts',
      'src/ai/**/*.ts',
      'src/race/**/*.ts',
      'src/combat/**/*.ts',
    ],
    rules: {
      // Детерминизм симуляции: никакого Math.random и Date.now — только seed-рандом и счётчик шагов.
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'Используйте Rng из src/core/rng.ts (детерминизм по seed).' },
        { object: 'Date', property: 'now', message: 'В симуляции время — это номер шага, а не часы.' },
      ],
    },
  },
);
