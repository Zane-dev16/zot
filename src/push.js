"use strict";

// Push domain model. Config decides skipped or queued. Tokens live in sqlite.
// Key based APNs transport sends over HTTP2 when a key is installed.
// Without opts.live or opts.transport sendPush stays a queued stub.

const crypto = require("node:crypto");
const fs = require("node:fs");

const DEFAULT_TOPIC = "com.zanishlabs.zot";
const DEFAULT_MODE = "development";
const SKIPPED = "apns-not-configured";

function clean(v) {
	if (typeof v !== "string") return "";
	return v.trim();
}

function normalizeMode(v) {
	const m = clean(v).toLowerCase();
	if (m === "production") return "production";
	return DEFAULT_MODE;
}

function normalizePem(raw) {
	if (typeof raw !== "string") return "";
	const withLines = raw.replace(/\\n/g, "\n");
	return withLines.trim();
}

// Boundary. Parse env once into a typed config. Trust the result inside.
function loadPushConfig(env) {
	const src = env || process.env;
	const teamId = clean(src.APNS_TEAM_ID);
	const keyId = clean(src.APNS_KEY_ID);
	const keyPath = clean(src.APNS_KEY_PATH);
	const keyPem = normalizePem(src.APNS_KEY_PEM || "");
	const topic = clean(src.APNS_TOPIC) || DEFAULT_TOPIC;
	const mode = normalizeMode(src.APNS_MODE);
	const configured = Boolean(teamId && keyId && (keyPath || keyPem));
	return {
		teamId,
		keyId,
		keyPath,
		keyPem,
		topic,
		mode,
		configured,
		reason: configured ? null : SKIPPED,
	};
}

function isPushConfigured(config) {
	if (config && typeof config.configured === "boolean")
		return config.configured;
	return loadPushConfig().configured;
}

// Boundary. Read key from env PEM first, then from the p8 file path.
// Returns the PEM string or null. Never throws and never logs the key.
function loadKeyMaterial(config) {
	const c = config || loadPushConfig();
	if (c.keyPem) return c.keyPem;
	if (c.keyPath) {
		try {
			const raw = fs.readFileSync(c.keyPath, "utf8");
			const pem = normalizePem(raw);
			return pem || null;
		} catch {
			return null;
		}
	}
	return null;
}

function base64urlEncode(input) {
	const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
	return buf
		.toString("base64")
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/g, "");
}

// Pure. Sign an APNs provider token with ES256. Throws on a bad key.
function signApnsToken(args) {
	const a = args || {};
	const teamId = clean(a.teamId);
	const keyId = clean(a.keyId);
	const keyPem = normalizePem(a.keyPem || "");
	if (!teamId || !keyId || !keyPem)
		throw new Error("missing apns signing input");
	const now = Number.isFinite(a.now) ? a.now : Date.now();
	const iat = Math.floor(now / 1000);
	const header = base64urlEncode(JSON.stringify({ alg: "ES256", kid: keyId }));
	const payload = base64urlEncode(JSON.stringify({ iss: teamId, iat }));
	const data = `${header}.${payload}`;
	const key = crypto.createPrivateKey(keyPem);
	const sig = crypto.sign("sha256", Buffer.from(data), key);
	return `${data}.${base64urlEncode(sig)}`;
}

function apnsHost(mode) {
	if (mode === "production") return "https://api.push.apple.com";
	return "https://api.sandbox.push.apple.com";
}

// Pure. Build one APNs request from a validated token plus provider token.
function buildApnsRequest(token, config, providerToken, payload) {
	const t = normalizeToken(token);
	if (!t) throw new Error("invalid-token");
	if (!config || !config.configured) throw new Error(SKIPPED);
	if (!providerToken) throw new Error("missing provider token");
	const url = `${apnsHost(config.mode)}/3/device/${t}`;
	return {
		url,
		token: t,
		topic: config.topic,
		mode: config.mode,
		headers: {
			authorization: `bearer ${providerToken}`,
			"apns-topic": config.topic,
			"apns-push-type": "alert",
			"apns-priority": "10",
		},
		payload: payload || { aps: { alert: {} } },
	};
}

// Thin shell. POST one request over HTTP2. Resolves status plus body.
function defaultApnsTransport(request) {
	const http2 = require("node:http2");
	return new Promise((resolve, reject) => {
		let origin = "";
		let path = "";
		try {
			const u = new URL(request.url);
			origin = u.origin;
			path = u.pathname;
		} catch (e) {
			reject(e);
			return;
		}
		const client = http2.connect(origin);
		client.on("error", (e) => reject(e));
		const req = client.request(
			{
				":method": "POST",
				":path": path,
				...request.headers,
			},
			{ endStream: false },
		);
		let status = 0;
		let apnsId = null;
		const chunks = [];
		req.on("response", (headers) => {
			status = Number(headers[":status"] || 0);
			apnsId = headers["apns-id"] || null;
		});
		req.on("data", (c) => chunks.push(c));
		req.on("end", () => {
			client.close();
			resolve({
				status,
				apnsId,
				body: Buffer.concat(chunks).toString("utf8"),
			});
		});
		req.on("error", (e) => {
			client.close();
			reject(e);
		});
		req.end(JSON.stringify(request.payload || {}));
	});
}

function isValidToken(token) {
	return typeof token === "string" && /^[0-9a-fA-F]{64}$/.test(token.trim());
}

function normalizeToken(token) {
	if (!isValidToken(token)) return null;
	return token.trim().toLowerCase();
}

// Boundary. Validate register input before storage. Reject bad shapes here.
function parseRegisterBody(body) {
	const token = body && body.token ? normalizeToken(body.token) : null;
	if (!token) return { ok: false, error: "invalid token" };
	const deviceId =
		body && typeof body.deviceId === "string" ? body.deviceId.trim() : "";
	const platform =
		body && typeof body.platform === "string" && body.platform.trim()
			? body.platform.trim().toLowerCase()
			: "ios";
	if (platform !== "ios") return { ok: false, error: "invalid platform" };
	return { ok: true, token, deviceId, platform };
}

function ensurePushTables(db) {
	db.exec(
		"CREATE TABLE IF NOT EXISTS push_token(" +
			"token TEXT PRIMARY KEY, " +
			"device_id TEXT, " +
			"platform TEXT NOT NULL DEFAULT 'ios', " +
			"created_at INTEGER NOT NULL, " +
			"updated_at INTEGER NOT NULL)",
	);
}

function registerToken(db, entry) {
	const parsed = parseRegisterBody(entry);
	if (!parsed.ok) throw new Error(parsed.error);
	ensurePushTables(db);
	const now = Date.now();
	db.prepare(
		"INSERT INTO push_token(token, device_id, platform, created_at, updated_at) " +
			"VALUES (?, ?, ?, ?, ?) " +
			"ON CONFLICT(token) DO UPDATE SET device_id = excluded.device_id, platform = excluded.platform, updated_at = excluded.updated_at",
	).run(parsed.token, parsed.deviceId || null, parsed.platform, now, now);
	return {
		token: parsed.token,
		deviceId: parsed.deviceId,
		platform: parsed.platform,
	};
}

function listTokens(db) {
	ensurePushTables(db);
	return db
		.prepare(
			"SELECT token, device_id, platform, created_at, updated_at FROM push_token ORDER BY created_at ASC",
		)
		.all()
		.map((r) => ({
			token: r.token,
			deviceId: r.device_id,
			platform: r.platform,
			createdAt: r.created_at,
			updatedAt: r.updated_at,
		}));
}

function removeToken(db, token) {
	const t = normalizeToken(token);
	if (!t) throw new Error("invalid token");
	ensurePushTables(db);
	db.prepare("DELETE FROM push_token WHERE token = ?").run(t);
	return { ok: true, token: t };
}

function buildApnsPayload(message) {
	const title =
		message && typeof message.title === "string"
			? message.title.slice(0, 200)
			: "";
	const body =
		message && typeof message.body === "string"
			? message.body.slice(0, 2000)
			: "";
	const alert = {};
	if (title) alert.title = title;
	if (body) alert.body = body;
	const aps = { alert };
	if (message && Number.isFinite(message.badge)) aps.badge = message.badge;
	if (message && typeof message.sound === "string" && message.sound)
		aps.sound = message.sound;
	return { aps };
}

// Core transition. Unconfigured returns skipped. Configured without live
// returns queued. Live uses the key and the transport for a real send.
async function sendPush(message, opts) {
	const o = opts || {};
	const config = o.config || loadPushConfig(o.env);
	const raw = message && message.token ? String(message.token) : "";
	const token = normalizeToken(raw);
	if (!token) {
		return {
			ok: false,
			skipped: "invalid-token",
			configured: config.configured,
			token: raw || null,
		};
	}
	if (!config.configured) {
		return { ok: false, skipped: SKIPPED, configured: false, token };
	}
	const payload = buildApnsPayload(message);
	const id = crypto.randomUUID();
	const wantsLive = Boolean(o.live || o.transport);
	if (!wantsLive) {
		return {
			ok: true,
			queued: true,
			configured: true,
			id,
			token,
			topic: config.topic,
			mode: config.mode,
			payload,
		};
	}
	const keyPem = loadKeyMaterial(config);
	if (!keyPem) {
		return {
			ok: true,
			queued: true,
			configured: true,
			id,
			token,
			topic: config.topic,
			mode: config.mode,
			payload,
		};
	}
	try {
		const providerToken =
			o.providerToken ||
			signApnsToken({
				teamId: config.teamId,
				keyId: config.keyId,
				keyPem,
				now: o.now,
			});
		const request = buildApnsRequest(token, config, providerToken, payload);
		const transport = o.transport || defaultApnsTransport;
		const res = await transport(request);
		if (res && res.status === 200) {
			return {
				ok: true,
				sent: true,
				configured: true,
				id,
				token,
				topic: config.topic,
				mode: config.mode,
				apnsId: res.apnsId || null,
			};
		}
		return {
			ok: false,
			error: `apns status ${res ? res.status : "unknown"}`,
			status: res ? res.status : null,
			configured: true,
			token,
		};
	} catch (e) {
		return {
			ok: false,
			error: String((e && e.message) || e).slice(0, 200),
			configured: true,
			token,
		};
	}
}

async function sendBulk(messages, opts) {
	const out = [];
	const list = messages || [];
	for (const m of list) out.push(await sendPush(m, opts));
	return out;
}

function runDoneMessage(run) {
	const title =
		run && run.state === "failed" ? "Zot run failed" : "Zot run done";
	const name = run && run.title ? String(run.title).slice(0, 120) : "";
	return {
		title,
		body: name ? `${title}: ${name}` : title,
		sound: "default",
	};
}

// Worker. Fan out one run done event to every stored token.
async function notifyRunDone(db, runId, opts) {
	const o = opts || {};
	let run = null;
	if (runId && typeof runId === "object" && runId.id) {
		run = {
			id: runId.id,
			title: runId.title || "",
			state: runId.state || "done",
		};
	} else {
		const id = String(runId || "");
		try {
			const row = db
				.prepare("SELECT id, title, state FROM agent_run WHERE id = ?")
				.get(id);
			if (row) run = { id: row.id, title: row.title || "", state: row.state };
		} catch {
			run = null;
		}
		if (!run) {
			if (!id) return { ok: false, skipped: "unknown-run" };
			run = { id, title: "", state: "done" };
		}
	}
	const tokens = listTokens(db);
	if (tokens.length === 0) {
		return {
			ok: true,
			sent: 0,
			total: 0,
			runId: run.id,
			state: run.state,
			skipped: "no-tokens",
		};
	}
	const base = runDoneMessage(run);
	const results = await sendBulk(
		tokens.map((t) => ({
			token: t.token,
			title: base.title,
			body: base.body,
			sound: base.sound,
		})),
		o,
	);
	let sent = 0;
	let queued = 0;
	for (const r of results) {
		if (r.sent) sent += 1;
		else if (r.queued) queued += 1;
	}
	return {
		ok: true,
		runId: run.id,
		state: run.state,
		total: results.length,
		sent,
		queued,
		results,
	};
}

if (require.main === module) {
	sendPush({ token: "test", title: "hi", body: "hello" }).then((r) => {
		console.log(JSON.stringify(r));
	});
}

module.exports = {
	DEFAULT_TOPIC,
	DEFAULT_MODE,
	loadPushConfig,
	isPushConfigured,
	loadKeyMaterial,
	signApnsToken,
	apnsHost,
	buildApnsRequest,
	defaultApnsTransport,
	parseRegisterBody,
	ensurePushTables,
	registerToken,
	listTokens,
	removeToken,
	buildApnsPayload,
	sendPush,
	sendBulk,
	runDoneMessage,
	notifyRunDone,
};
