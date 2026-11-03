// Minimal ambient types for the two node built-ins the iOS config test reads.
// @types/node is installed but deliberately not in tsconfig "types": pulling it
// in program-wide makes setTimeout return NodeJS.Timeout and breaks the
// injected clock types in stream.test.ts. Only what iosConfig.test.ts uses is
// declared here, plus __dirname, which jest provides (CJS transform).

declare module 'node:fs' {
  const fs: {
    readFileSync(file: string, encoding: 'utf8'): string;
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
