// S6 placeholder: baked pair config for automation.
// ios/BakedPair.swift reads -ZOT_BAKED / ZOT_BAKED plus -ZOT_SERVER_URL /
// -ZOT_PAIR_CODE from launch args or environment. RN cannot read either without
// a native module, so T5 will register that module through setBakedPairSource()
// and nothing else has to change. Until then the source is null and the hook is
// inert. Kept mockable so screens can prove the once-guard today.

import { normalizeBaseURL } from "./client.ts";

export const BAKED_SERVER_ENV = "ZOT_SERVER_URL";
export const BAKED_CODE_ENV = "ZOT_PAIR_CODE";
export const BAKED_FLAG_ENV = "ZOT_BAKED";

export type BakedPairConfig = {
	serverURL: string;
	code: string;
};

export type BakedPairSource = {
	isBaked: boolean;
	config(): BakedPairConfig | null;
};

let source: BakedPairSource | null = null;

/** T5 hook point: register the native launch-args module here. */
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
	const serverURL = normalizeBaseURL(config.serverURL ?? "");
	const code = String(config.code ?? "").trim();
	if (serverURL === "" || code === "") return null;
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
