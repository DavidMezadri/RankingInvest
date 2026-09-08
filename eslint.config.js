import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.netlify/**',
      '**/coverage/**',
      'supabase/.temp/**',
      'supabase/.branches/**',
      // Código Deno, fora de qualquer tsconfig: o lint type-aware falharia com
      // "file not found in project". O Prettier continua formatando.
      'supabase/functions/**',
      // Arquivo gerado pelo `supabase gen types`.
      'packages/core/src/db.types.ts',
    ],
  },

  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  tseslint.configs.stylisticTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Num app financeiro, promise não aguardada silenciosamente é a origem
      // mais provável de saldo inconsistente na tela.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      // O domínio é cheio de union discriminada (EnvResult, OrderQuote,
      // resultado de rejeição de ordem), que `interface` não expressa.
      // Padronizar em `type` evita misturar os dois estilos no mesmo módulo.
      '@typescript-eslint/consistent-type-definitions': ['error', 'type'],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
    },
  },

  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: {
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.flat.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },

  {
    // Scripts de terminal: `console.log` é o mecanismo de saída deles, não um
    // resquício de depuração esquecido.
    files: ['scripts/**'],
    rules: { 'no-console': 'off' },
  },

  {
    // Configuração e scripts operacionais: JavaScript puro, fora de qualquer
    // tsconfig. Sem desligar o lint type-aware aqui, o ESLint reclama que o
    // arquivo não pertence a nenhum projeto.
    files: ['**/*.js', '**/*.mjs'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      globals: globals.node,
    },
  },
);
