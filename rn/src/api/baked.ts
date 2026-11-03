// S6: baked pair config for automation, as a seam the native adapter fills.
// ios/BakedPair.swift reads -ZOT_BAKED / ZOT_BAKED plus -ZOT_SERVER_URL /
// -ZOT_PAIR_CODE from launch args or environment. On the RN side
// bakedNative.ts applies the same precedence to the constants that
// rn/ios/ZotRN/ZotNative.swift exports, and index.js:13 registers the resulting
// source here before the first render, so App's once-guard sees it
// synchronously. When the native module is missing (jest, or a build without
// it) readZotLaunchInfo() returns null, no source is registered, and the hook
// stays inert. Kept mockable so screens can prove the once-guard without a
// device.

import { normalizeBaseURL } from './client.ts';

export const BAKED_SERVER_ENV = 'ZOT_SERVER_URL';
export const BAKED_CODE_ENV = 'ZOT_PAIR_CODE';
export const BAKED_FLAG_ENV = 'ZOT_BAKED';

export type BakedPairConfig = {
  serverURL: string;
  code: string;
};

export type BakedPairSource = {
  isBaked: boolean;
  config(): BakedPairConfig | null;
};

let source: BakedPairSource | null = null;

/** Seam the native launch-args adapter registers through (bakedNative.ts). */
export function setBakedPairSource(next: BakedPairSource | null): void {
  source = next;
}

export function getBakedPairSource(): BakedPairSource | null {
  return source;
}

// Mirrors ios/ContentView.swift:68-76: no source, or not baked, or a config
// missing either field all mean "do nothing".
export function readBakedPairConfig(): BakedPairConfig | null {
  if (source === null) return null;
  if (!source.isBaked) return null;
  const config = source.config();
  if (config === null) return null;
  const serverURL = normalizeBaseURL(config.serverURL ?? '');
  const code = String(config.code ?? '').trim();
  if (serverURL === '' || code === '') return null;
  return { serverURL, code };
}

export type BakedOnceGuard = {
  shouldRun(): boolean;
};

// Same once-guard as `bakedDidRun` (ios/ContentView.swift:10,71): the pair
// attempt happens at most once per app session, even across re-renders.
export function createBakedOnceGuard(): BakedOnceGuard {
  let ran = false;
  return {
    shouldRun(): boolean {
      if (ran) return false;
      ran = true;
      return true;
    },
  };
}
