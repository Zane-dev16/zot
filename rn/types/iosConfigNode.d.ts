// Minimal ambient types for the two node built-ins the iOS config test reads.
//
// @types/node IS installed (26.6.5, pulled in transitively — @jest/console
// depends on `@types/node: "*"`, as do @types/graceful-fs and jest-util), so
// this is not a workaround for a missing package. It is deliberately kept out
// of the program: @react-native/typescript-config sets `types: ["jest"]`, and
// adding "node" changes setTimeout's global type from `number` to `Timeout`.
// That breaks the injected clock types in __tests__/stream.test.ts:28-29, which
// pass `(fn, ms) => number` as SetTimeoutFn. Verified: with
// `"types": ["jest", "node"]`, tsc fails exactly there.
//
// So only what iosConfig.test.ts needs is declared here, plus __dirname, which
// jest provides (CJS transform).

declare module 'node:fs' {
  const fs: {
    readFileSync(file: string, encoding: 'utf8'): string;
    existsSync(file: string): boolean;
  };
  export default fs;
}

declare module 'node:path' {
  const path: {
    join(...parts: string[]): string;
  };
  export default path;
}

declare const __dirname: string;
