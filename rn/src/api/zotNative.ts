// Raw bridge to the app-target native module `ZotNative` (rn/ios/ZotRN).
// It is a legacy RCT_EXTERN_MODULE module: launch args/env are exported as
// constants, push methods are promises. Kept in one place so the push and baked
// adapters resolve the module identically, and so jest (where NativeModules is
// empty) always sees null instead of throwing.

import { NativeModules } from "react-native";

export type ZotNativeModule = {
	requestPushRegistration?: () => Promise<boolean>;
	getStashedPushToken?: () => Promise<string | null>;
	launchArguments?: unknown;
	launchEnvironment?: unknown;
};

export type ZotLaunchInfo = {
	arguments: string[];
	environment: Record<string, string>;
};

export function getZotNativeModule(): ZotNativeModule | null {
	// SAFETY: NativeModules is an untyped host object; every field we read is
	// checked for its real runtime type before use (see readZotLaunchInfo).
	const modules = NativeModules as unknown as Record<string, unknown>;
	const candidate = modules.ZotNative;
	if (candidate === null || typeof candidate !== "object") return null;
	return candidate as ZotNativeModule;
}

function stringList(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value.filter((item): item is string => typeof item === "string");
}

function stringMap(value: unknown): Record<string, string> {
	if (value === null || typeof value !== "object") return {};
	const out: Record<string, string> = {};
	for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
		if (typeof item === "string") out[key] = item;
	}
	return out;
}

/** Launch args/env as plain strings, or null when the native module is absent. */
export function readZotLaunchInfo(
	module: ZotNativeModule | null = getZotNativeModule(),
): ZotLaunchInfo | null {
	if (module === null) return null;
	return {
		arguments: stringList(module.launchArguments),
		environment: stringMap(module.launchEnvironment),
	};
}
