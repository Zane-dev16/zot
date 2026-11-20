// The only module that knows server field names. Every function takes the
// bearer token explicitly so nothing here reads localStorage or the DOM.
//
// Allowed endpoints (the console consumes nothing else):
//   GET  /healthz
//   GET  /build.json                     (static manifest, not an api route)
//   GET  /api/v1/runs
//   POST /api/v1/runs
//   GET  /api/v1/runs/:id
//   POST /api/v1/runs/:id/approve
//   POST /api/v1/runs/:id/cancel
//   GET  /api/v1/runs/:id/events?since=N
//   POST /api/v1/pair/start
//   POST /api/v1/pair/confirm

export class ApiError extends Error {
	/**
	 * @param {string} message
	 * @param {number} status 0 means the request never reached the daemon
	 * @param {unknown} [data] parsed response body when it was JSON
	 */
	constructor(message, status, data) {
		super(message);
		this.name = "ApiError";
		this.status = Number(status) || 0;
		this.data = data === undefined ? null : data;
	}
}

/**
 * @param {string} path
 * @param {{method?: string, token?: string, body?: unknown, signal?: AbortSignal}} [options]
 * @returns {Promise<any>}
 */
async function request(path, options = {}) {
	const { method = "GET", token, body, signal } = options;
	const headers = {};
	if (body !== undefined) headers["content-type"] = "application/json";
	if (token) headers.authorization = "Bearer " + token;
	let res;
	try {
		res = await fetch(path, {
			method,
			headers,
			body: body === undefined ? undefined : JSON.stringify(body),
			signal,
			cache: "no-store",
		});
	} catch (err) {
		if (err && err.name === "AbortError") throw err;
		throw new ApiError("could not reach the daemon", 0, null);
	}
	let data = null;
	try {
		data = await res.json();
	} catch {
		data = null;
	}
	if (!res.ok) {
		const message = data && typeof data.error === "string" ? data.error : "request failed " + res.status;
		throw new ApiError(message, res.status, data);
	}
	return data;
}

/**
 * Normalise one run row from any endpoint to camelCase client shape.
 * @param {object|null|undefined} raw
 * @returns {object|null}
 */
export function normaliseRun(raw) {
	if (!raw || typeof raw !== "object") return null;
	const run = {
		id: String(raw.id),
		title: typeof raw.title === "string" ? raw.title : "",
		prompt: typeof raw.prompt === "string" ? raw.prompt : "",
		state: typeof raw.state === "string" ? raw.state : "",
		attempt: Number.isFinite(Number(raw.attempt)) ? Number(raw.attempt) : 1,
		createdAt: Number(raw.createdAt) || 0,
		updatedAt: Number(raw.updatedAt) || 0,
		finishedAt: raw.finishedAt == null ? null : Number(raw.finishedAt),
		lastHeartbeat: raw.lastHeartbeat == null ? null : Number(raw.lastHeartbeat),
		ownerDeviceId: raw.ownerDeviceId == null ? null : String(raw.ownerDeviceId),
	};
	if (raw.model != null) run.model = String(raw.model);
	return run;
}

/**
 * Normalise one tool_event row (snake_case from REST) to the client shape.
 * @param {object|null|undefined} raw
 * @returns {object|null}
 */
export function normaliseEvent(raw) {
	if (!raw || typeof raw !== "object") return null;
	const resultRef = raw.resultRef !== undefined ? raw.resultRef : raw.result_ref;
	const argsHash = raw.argsHash !== undefined ? raw.argsHash : raw.args_hash;
	const createdAt = raw.createdAt !== undefined ? raw.createdAt : raw.created_at;
	return {
		id: raw.id == null ? "" : String(raw.id),
		runId: raw.runId !== undefined && raw.runId !== null ? String(raw.runId) : raw.run_id == null ? "" : String(raw.run_id),
		tool: typeof raw.tool === "string" ? raw.tool : String(raw.tool || "tool"),
		argsHash: argsHash == null ? "" : String(argsHash),
		resultRef: resultRef == null ? "" : String(resultRef),
		createdAt: Number(createdAt) || 0,
	};
}

/** @returns {Promise<{version: string, state: string, startedAt: number, uptimeMs: number}>} */
export async function healthz() {
	const data = await request("/healthz");
	return {
		version: String((data && data.version) || ""),
		state: String((data && data.state) || ""),
		startedAt: Number(data && data.startedAt) || 0,
		uptimeMs: Number(data && data.uptimeMs) || 0,
	};
}

/** @returns {Promise<{version: number, moduleCount: number, sourceHash: string}>} */
export async function buildManifest() {
	const data = await request("/build.json");
	return {
		version: Number(data && data.version) || 0,
		moduleCount: Number(data && data.moduleCount) || 0,
		sourceHash: String((data && data.sourceHash) || ""),
	};
}

/** @param {string} token @returns {Promise<object[]>} */
export async function listRuns(token) {
	const data = await request("/api/v1/runs", { token });
	const rows = Array.isArray(data && data.runs) ? data.runs : [];
	return rows.map(normaliseRun).filter(Boolean);
}

/** @param {string} token @param {string} id @returns {Promise<object>} */
export async function getRun(token, id) {
	const data = await request("/api/v1/runs/" + encodeURIComponent(id), { token });
	return normaliseRun(data && data.run);
}

/**
 * @param {string} token
 * @param {{title: string, prompt: string}} input
 * @returns {Promise<object>}
 */
export async function createRun(token, input) {
	const data = await request("/api/v1/runs", {
		method: "POST",
		token,
		body: { title: input.title, prompt: input.prompt },
	});
	return normaliseRun(data && data.run);
}

/** @param {string} token @param {string} id @returns {Promise<object>} */
export async function approveRun(token, id) {
	const data = await request("/api/v1/runs/" + encodeURIComponent(id) + "/approve", {
		method: "POST",
		token,
	});
	return normaliseRun(data && data.run);
}

/** @param {string} token @param {string} id @returns {Promise<object>} */
export async function cancelRun(token, id) {
	const data = await request("/api/v1/runs/" + encodeURIComponent(id) + "/cancel", {
		method: "POST",
		token,
	});
	return normaliseRun(data && data.run);
}

/**
 * @param {string} token
 * @param {string} id
 * @param {number} [since]
 * @returns {Promise<object[]>}
 */
export async function listEvents(token, id, since = 0) {
	const query = "?since=" + encodeURIComponent(String(Number(since) || 0));
	const data = await request("/api/v1/runs/" + encodeURIComponent(id) + "/events" + query, { token });
	const rows = Array.isArray(data && data.events) ? data.events : [];
	return rows.map(normaliseEvent).filter(Boolean);
}

/**
 * @param {string} label
 * @param {"browser"|"ios"} kind
 * @returns {Promise<{code: string, expiresAt: number}>}
 */
export async function pairStart(label = "browser", kind = "browser") {
	const data = await request("/api/v1/pair/start", {
		method: "POST",
		body: { label, kind },
	});
	return { code: String((data && data.code) || ""), expiresAt: Number(data && data.expiresAt) || 0 };
}

/**
 * @param {string} code
 * @returns {Promise<{token: string, device: object|null}>}
 */
export async function pairConfirm(code) {
	const data = await request("/api/v1/pair/confirm", {
		method: "POST",
		body: { code: String(code) },
	});
	return {
		token: String((data && data.token) || ""),
		device: (data && data.device) || null,
	};
}
