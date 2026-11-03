module.exports = {
  root: true,
  extends: '@react-native',
  overrides: [
    {
      // Live verification scripts are node ESM; the default parser options
      // treat them as ES5 scripts (scripts/*.mjs is outside eslint's default
      // extension set, so this only bites explicit lints).
      files: ['*.mjs', 'scripts/**/*.mjs'],
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
      },
      env: {
        node: true,
        es2022: true,
      },
      rules: {
        'no-console': 'off',
      },
    },
  ],
};
