// Pure TS API client for the zot daemon (plan seams S1, S2, S3).
// No React imports: every function runs under plain node with an injected transport.

export type AgentRun = {
	id: string;
	title: string;
	prompt: string;
	state: string;
};

export type TokenStore = {
	saveToken(token: string): Promise<void>;
	loadToken(): Promise<string | null>;
	deleteToken(): Promise<void>;
};

export type HttpResponseLike = {
	status: number;
	text(): Promise<string>;
};

export type TransportInit = {
	method: "GET" | "POST";
	headers: Record<string, string>;
	body?: string;
};

export type Transport = (
	url: string,
	init: TransportInit,
) => Promise<HttpResponseLike>;

export class ApiError extends Error {
	status: number;

	constructor(message: string, status: number) {
		super(message);
		this.name = "ApiError";
		this.status = status;
	}
}

// Port of ios/ApiClient.swift `normalizeBaseURL`: trim, drop trailing slashes,
// default to plain http when no scheme is given.
export function normalizeBaseURL(raw: string): string {
	let base = raw.trim();
	while (base.endsWith("/")) base = base.slice(0, -1).trim();
	if (base === "") return "";
	if (!base.includes("://")) base = "http://" + base;
	return base;
}

export const defaultTransport: Transport = (url, init) => {
	const fetchFn = (globalThis as unknown as { fetch?: Transport }).fetch;
	if (!fetchFn) throw new ApiError("fetch is not available", 0);
	return fetchFn(url, init);
};

export function createMemoryTokenStore(
	initial: string | null = null,
): TokenStore {
	let token = initial;
	return {
		async saveToken(next) {
			token = next;
		},
		async loadToken() {
			return token;
		},
		async deleteToken() {
			token = null;
		},
	};
}

type RequestOptions = {
	transport?: Transport;
};

type ParsedResponse = {
	status: number;
	text: string;
	json: unknown;
};

function joinURL(host: string, path: string): string {
	const base = normalizeBaseURL(host);
	if (base === "") {
		throw new ApiError("Invalid host. Add http:// and check host.", 0);
	}
	return base + path;
}

async function readResponse(res: HttpResponseLike): Promise<ParsedResponse> {
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

function errorBody(json: unknown): string | null {
	if (json === null || typeof json !== "object") return null;
	const value = (json as { error?: unknown }).error;
	return typeof value === "string" && value !== "" ? value : null;
}

function failure(
	status: number,
	text: string,
	json: unknown,
	fallback: string,
): ApiError {
	const message = errorBody(json);
	if (message !== null) return new ApiError(message, status);
	const trimmed = text.trim();
	if (trimmed !== "" && trimmed.length < 300) return new ApiError(trimmed, status);
	return new ApiError(fallback, status);
}

function toAgentRun(value: unknown): AgentRun {
	const run = value as Record<string, unknown> | null;
	if (
		run === null ||
		typeof run !== "object" ||
		typeof run.id !== "string" ||
		typeof run.title !== "string" ||
		typeof run.prompt !== "string" ||
		typeof run.state !== "string"
	) {
		throw new ApiError("Malformed run in response", 0);
	}
	return {
		id: run.id,
		title: run.title,
		prompt: run.prompt,
		state: run.state,
	};
}

// S1: pair handshake. No auth header. 200 or 201, decodes {token}.
export async function pairConfirm(
	host: string,
	code: string,
	options: RequestOptions & { label?: string } = {},
): Promise<string> {
	const transport = options.transport ?? defaultTransport;
	const res = await transport(joinURL(host, "/api/v1/pair/confirm"), {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			code: code.trim(),
			label: options.label ?? "iphone",
			kind: "ios",
		}),
	});
	const { status, text, json } = await readResponse(res);
	if (status !== 200 && status !== 201) {
		throw failure(
			status,
			text,
			json,
			`Pair failed (status ${status}). Check code and host.`,
		);
	}
	const token = (json as { token?: unknown } | null)?.token;
	if (typeof token !== "string" || token === "") {
		throw new ApiError("Pair response missing token", status);
	}
	return token;
}

function authHeaders(token: string): Record<string, string> {
	return {
		"Content-Type": "application/json",
		Authorization: "Bearer " + token,
	};
}

// S3: GET /api/v1/runs -> {runs:[AgentRun]}
export async function listRuns(
	host: string,
	token: string,
	options: RequestOptions = {},
): Promise<AgentRun[]> {
	const transport = options.transport ?? defaultTransport;
	const res = await transport(joinURL(host, "/api/v1/runs"), {
		method: "GET",
		headers: authHeaders(token),
	});
	const { status, text, json } = await readResponse(res);
	if (status !== 200) {
		throw failure(status, text, json, `Runs fetch failed (status ${status}).`);
	}
	const runs = (json as { runs?: unknown } | null)?.runs;
	if (!Array.isArray(runs)) throw new ApiError("Malformed runs response", status);
	return runs.map(toAgentRun);
}

// S3: POST /api/v1/runs {title, prompt} -> {run}
export async function createRun(
	host: string,
	token: string,
	input: { title: string; prompt: string },
	options: RequestOptions = {},
): Promise<AgentRun> {
	const transport = options.transport ?? defaultTransport;
	const res = await transport(joinURL(host, "/api/v1/runs"), {
		method: "POST",
		headers: authHeaders(token),
		body: JSON.stringify({ title: input.title, prompt: input.prompt }),
	});
	const { status, text, json } = await readResponse(res);
	if (status !== 200 && status !== 201) {
		throw failure(status, text, json, `Run create failed (status ${status}).`);
	}
	const run = (json as { run?: unknown } | null)?.run;
	if (run === undefined) throw new ApiError("Malformed run response", status);
	return toAgentRun(run);
}
