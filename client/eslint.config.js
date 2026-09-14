import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'public/**', 'eslint.config.js'],
  },
  ...tseslint.configs.recommended,
);
