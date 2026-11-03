// S5: APNs push token registration, ported from ios/ApiClient.swift:95-101
// (registerPushToken) and ios/ContentView.swift:61-66,99-101 (upload the stashed
// hex once observed and again after each load/foreground).
//
// Server contract: src/api.js POST /api/v1/push/tokens needs a bearer token and
// answers 201. src/push.js:212 validates the 64-hex shape before storing, so the
// client refuses to send anything else. Nothing here throws: a missing token,
// an unpaired session or a failed upload must never break the session flow.

import { AppState, NativeEventEmitter } from "react-native";

import type { Transport } from "./client.ts";
import { defaultTransport, normalizeBaseURL } from "./client.ts";
import { getZotNativeModule } from "./zotNative.ts";

/** Same event name the Swift module posts (ios/ZotApp.swift `.zotPushToken`). */
export const PUSH_TOKEN_EVENT = "zotPushToken";
/** Native-owned UserDefaults key (ios/ZotApp.swift "ZotPushToken"). */
export const PUSH_TOKEN_DEFAULTS_KEY = "ZotPushToken";
export const PUSH_TOKENS_PATH = "/api/v1/push/tokens";
export const PUSH_TOKEN_PATTERN = /^[0-9a-f]{64}$/;
export const INVALID_PUSH_HOST_ERROR =
	"Invalid host. Add http:// and check host.";
export const PUSH_UPLOAD_FALLBACK = "Push token upload failed.";

export type PushTokenSkipReason = "no-token" | "invalid-token" | "unpaired";

export type PushTokenResult =
	| { ok: true; status: number }
	| { ok: false; skipped: PushTokenSkipReason }
	| { ok: false; status?: number; error: string };

export type RegisterPushTokenOptions = {
	transport?: Transport;
	/** Bearer token from the pair handshake; no auth means no upload. */
	authToken?: string | null;
};

/** Trim + lowercase, then require the 64-hex shape src/push.js stores. */
export function normalizePushToken(raw: unknown): string | null {
	if (typeof raw !== "string") return null;
	const token = raw.trim().toLowerCase();
	return PUSH_TOKEN_PATTERN.test(token) ? token : null;
}

function errorFromResponse(
	status: number,
	text: string,
	json: unknown,
): string {
	const value =
		json !== null && typeof json === "object"
			? (json as { error?: unknown }).error
			: undefined;
	if (typeof value === "string" && value !== "") return value;
	const trimmed = text.trim();
	if (trimmed !== "" && trimmed.length < 300) return trimmed;
	return `${PUSH_UPLOAD_FALLBACK.replace(/\.$/, "")} (status ${status}).`;
}

async function parseBody(
	res: Awaited<ReturnType<Transport>>,
): Promise<{ status: number; text: string; json: unknown }> {
	const text = await res.text();
	let json: unknown = null;
	if (text !== "") {
		try {
			json = JSON.parse(text);
		} catch {
			json = null;
		}
	}
	return { status: res.status, text, json };
}

/**
 * POST {token, platform:"ios"} with the bearer header. Accepts 200/201 and
 * surfaces `{error}` bodies from the daemon. Never throws.
 */
export async function registerPushToken(
	host: string,
	token: string | null | undefined,
	options: RegisterPushTokenOptions = {},
): Promise<PushTokenResult> {
	if (token === null || token === undefined || token.trim() === "") {
		return { ok: false, skipped: "no-token" };
	}
	const normalized = normalizePushToken(token);
	if (normalized === null) return { ok: false, skipped: "invalid-token" };

	const authToken = options.authToken ?? null;
	if (authToken === null || authToken.trim() === "") {
		return { ok: false, skipped: "unpaired" };
	}

	const base = normalizeBaseURL(host);
	if (base === "") return { ok: false, error: INVALID_PUSH_HOST_ERROR };

	const transport = options.transport ?? defaultTransport;
	try {
		const res = await transport(base + PUSH_TOKENS_PATH, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer " + authToken,
			},
			body: JSON.stringify({ token: normalized, platform: "ios" }),
		});
		const { status, text, json } = await parseBody(res);
		if (status === 200 || status === 201) return { ok: true, status };
		return { ok: false, status, error: errorFromResponse(status, text, json) };
	} catch (err) {
		const message =
			err instanceof Error && err.message !== ""
				? err.message
				: PUSH_UPLOAD_FALLBACK;
		return { ok: false, error: message };
	}
}

/** Injected in tests; the real module is resolved lazily via NativeModules. */
export type PushTokenNative = {
	requestPushRegistration(): Promise<boolean>;
	getStashedPushToken(): Promise<string | null>;
	addPushTokenListener(listener: (token: string) => void): () => void;
};

type NativeEventEmitterTarget = ConstructorParameters<
	typeof NativeEventEmitter
>[0];

export function getNativePushTokenModule(): PushTokenNative | null {
	const module = getZotNativeModule();
	if (module === null) return null;
	const request = module.requestPushRegistration;
	const stashed = module.getStashedPushToken;
	if (typeof request !== "function" || typeof stashed !== "function") {
		return null;
	}
	return {
		requestPushRegistration: () => request(),
		getStashedPushToken: () => stashed(),
		addPushTokenListener(listener) {
			// SAFETY: the raw module satisfies the NativeEventEmitter contract at
			// runtime (it is an RCTEventEmitter); RN types only expose the narrow
			// NativeModule surface, so the cast is confined to this constructor.
			const emitter = new NativeEventEmitter(
				module as unknown as NativeEventEmitterTarget,
			);
			const subscription = emitter.addListener(
				PUSH_TOKEN_EVENT,
				(payload: unknown) => {
					if (typeof payload === "string") listener(payload);
				},
			);
			return () => {
				subscription.remove();
			};
		},
	};
}

export type AppStateLike = {
	currentState?: string | null;
	addEventListener(
		type: "change",
		handler: (state: string) => void,
	): { remove(): void };
};

function defaultAppState(): AppStateLike | null {
	// SAFETY: React Native's AppState class exposes addEventListener with this
	// shape at runtime; the narrowed type only describes what this module calls.
	const candidate = AppState as unknown as AppStateLike | undefined;
	if (candidate === undefined) return null;
	return typeof candidate.addEventListener === "function" ? candidate : null;
}

export type PushTokenTarget = { host: string; authToken: string | null };

export type PushTokenSync = {
	/** Ask iOS for notification permission + APNs registration. Never throws. */
	request(): Promise<boolean>;
	/** Read the stashed native hex, normalize it and upload it. Never throws. */
	sync(target: PushTokenTarget): Promise<PushTokenResult>;
	/** Upload on every foreground and on every native token event. */
	start(getTarget: () => PushTokenTarget): () => void;
};

export type PushTokenSyncDeps = {
	transport?: Transport;
	/** undefined resolves the real module; null disables native push entirely. */
	native?: PushTokenNative | null;
	appState?: AppStateLike | null;
};

/**
 * Mirrors ContentView's load/pushUp + the `.zotPushToken` observer: the native
 * module stashes the APNs hex in UserDefaults, this reads it on each trigger.
 */
export function createPushTokenSync(
	deps: PushTokenSyncDeps = {},
): PushTokenSync {
	const transport = deps.transport;
	const native =
		deps.native === undefined ? getNativePushTokenModule() : deps.native;
	const appState = deps.appState === undefined ? defaultAppState() : deps.appState;

	async function sync(target: PushTokenTarget): Promise<PushTokenResult> {
		if (native === null) return { ok: false, skipped: "no-token" };
		let stashed: string | null = null;
		try {
			stashed = await native.getStashedPushToken();
		} catch {
			return { ok: false, skipped: "no-token" };
		}
		return registerPushToken(target.host, stashed, {
			transport,
			authToken: target.authToken,
		});
	}

	return {
		async request(): Promise<boolean> {
			if (native === null) return false;
			try {
				return Boolean(await native.requestPushRegistration());
			} catch {
				return false;
			}
		},
		sync,
		start(getTarget: () => PushTokenTarget): () => void {
			const disposers: Array<() => void> = [];
			if (appState !== null) {
				const subscription = appState.addEventListener("change", state => {
					if (state === "active") sync(getTarget()).catch(() => {});
				});
				disposers.push(() => {
					subscription.remove();
				});
			}
			if (native !== null) {
				const remove = native.addPushTokenListener(() => {
					sync(getTarget()).catch(() => {});
				});
				disposers.push(remove);
			}
			return () => {
				for (const dispose of disposers) dispose();
			};
		},
	};
}
