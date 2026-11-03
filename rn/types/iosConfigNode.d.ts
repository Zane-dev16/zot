// Minimal ambient types for the two node built-ins the iOS config test reads.
// @types/node is not a dependency, and is deliberately kept out of the
// program: pulling node's globals in would change setTimeout's type and break
// the injected clock types in stream.test.ts. Only what iosConfig.test.ts needs
// is declared here, plus __dirname, which jest provides (CJS transform).

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
