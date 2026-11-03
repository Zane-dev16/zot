// S6: baked pair native adapter. Ports ios/BakedPair.swift line for line:
// the flavor is on when "-ZOT_BAKED" appears in argv or ZOT_BAKED == "1"; each
// value resolves in the Swift precedence order `-flag value`, then `-flag=value`,
// then environment. Registered into the existing setBakedPairSource() seam at
// app startup (index.js), before the first render.
//
// The 6-digit code gate stays downstream in sessionController.pair(), exactly
// like ios/ContentView.swift:78-94; this adapter only transports the values.

import type { BakedPairConfig, BakedPairSource } from "./baked.ts";
import {
	BAKED_CODE_ENV,
	BAKED_FLAG_ENV,
	BAKED_SERVER_ENV,
	setBakedPairSource,
} from "./baked.ts";
import { readZotLaunchInfo } from "./zotNative.ts";
import type { ZotLaunchInfo } from "./zotNative.ts";

export const BAKED_FLAG = "-ZOT_BAKED";
export const BAKED_SERVER_FLAG = "-ZOT_SERVER_URL";
export const BAKED_CODE_FLAG = "-ZOT_PAIR_CODE";

/** BakedPair.isBaked: argv contains the flag, or the env value is exactly "1". */
export function isBakedLaunch(info: ZotLaunchInfo): boolean {
	if (info.arguments.includes(BAKED_FLAG)) return true;
	return info.environment[BAKED_FLAG_ENV] === "1";
}

/**
 * BakedPair.value(flag:env:): `-flag value`, then `-flag=value`, then env.
 * A flag present without a following value falls through to the next form.
 */
export function launchValue(
	flag: string,
	envKey: string,
	info: ZotLaunchInfo,
): string | null {
	const index = info.arguments.indexOf(flag);
	if (index !== -1 && index + 1 < info.arguments.length) {
		return info.arguments[index + 1];
	}
	const prefix = flag + "=";
	const hit = info.arguments.find(argument => argument.startsWith(prefix));
	if (hit !== undefined) return hit.slice(prefix.length);
	const env = info.environment[envKey];
	return typeof env === "string" ? env : null;
}

/** BakedPair.config(): baked, plus a non-empty server and code, or null. */
export function bakedConfigFromLaunch(
	info: ZotLaunchInfo,
): BakedPairConfig | null {
	if (!isBakedLaunch(info)) return null;
	const serverURL = launchValue(BAKED_SERVER_FLAG, BAKED_SERVER_ENV, info);
	if (serverURL === null || serverURL === "") return null;
	const code = launchValue(BAKED_CODE_FLAG, BAKED_CODE_ENV, info);
	if (code === null || code === "") return null;
	return { serverURL, code };
}

export function createBakedPairSource(info: ZotLaunchInfo): BakedPairSource {
	return {
		isBaked: isBakedLaunch(info),
		config: () => bakedConfigFromLaunch(info),
	};
}

/**
 * Register the native source (or an injected one) through setBakedPairSource.
 * Returns the source, or null when no native module/launch info exists.
 */
export function registerNativeBakedPairSource(
	info?: ZotLaunchInfo | null,
): BakedPairSource | null {
	const launch = info === undefined ? readZotLaunchInfo() : info;
	if (launch === null) return null;
	const source = createBakedPairSource(launch);
	setBakedPairSource(source);
	return source;
}
