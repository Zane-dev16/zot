module.exports = {
  root: true,
  extends: '@react-native',
  overrides: [
    {
      // Live verification scripts are node ESM. `eslint .` does lint
      // scripts/*.mjs, but the default parser options treat them as ES5
      // scripts, so they need the module plus es2022 parser here.
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
