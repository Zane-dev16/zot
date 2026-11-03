/* eslint-env jest */
/**
 * Jest setup for the RN client. Native modules are stubbed here so screens can
 * render headless on a Linux host (no Xcode, no simulator): the keychain is a
 * plain in-memory stub and AsyncStorage is a Map-backed stub with the same
 * three calls the app makes. Individual tests may still override either module
 * with jest.mock().
 */

jest.mock('react-native-keychain', () => ({
  setGenericPassword: jest.fn(async () => ({
    service: 'zot-token',
    storage: 'test',
  })),
  getGenericPassword: jest.fn(async () => false),
  resetGenericPassword: jest.fn(async () => true),
}));

// The provider renders nothing until the native insets event arrives, so the
// package's own jest mock (CJS) is used for the whole suite.
jest.mock('react-native-safe-area-context', () =>
  require('react-native-safe-area-context/jest/mock').default,
);

// The package ships its own jest mock as ESM (lib/module), which jest cannot
// transform under node_modules; this stub covers the storage surface the app uses.
jest.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map();
  return {
    __esModule: true,
    default: {
      getItem: jest.fn(async key => (store.has(key) ? store.get(key) : null)),
      setItem: jest.fn(async (key, value) => {
        store.set(key, value);
      }),
      removeItem: jest.fn(async key => {
        store.delete(key);
      }),
      clear: jest.fn(async () => {
        store.clear();
      }),
    },
  };
});
