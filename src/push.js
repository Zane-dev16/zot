"use strict";

// Push domain model. Config decides skipped or queued. Tokens live in sqlite.
// Transport stays stubbed until a real key is installed.

const crypto = require("node:crypto");

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

// Boundary. Parse env once into a typed config. Trust the result inside.
function loadPushConfig(env) {
	const src = env || process.env;
	const teamId = clean(src.APNS_TEAM_ID);
	const keyId = clean(src.APNS_KEY_ID);
	const keyPath = clean(src.APNS_KEY_PATH);
	const topic = clean(src.APNS_TOPIC) || DEFAULT_TOPIC;
	const mode = normalizeMode(src.APNS_MODE);
	const configured = Boolean(teamId && keyId && keyPath);
	return {
		teamId,
		keyId,
		keyPath,
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

// Core transition. Unconfigured returns skipped. Configured returns queued.
// No network happens here. Real APNs send replaces the queued branch later.
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
	return {
		ok: true,
		queued: true,
		configured: true,
		id: crypto.randomUUID(),
		token,
		topic: config.topic,
		mode: config.mode,
		payload: buildApnsPayload(message),
	};
}

async function sendBulk(messages, opts) {
	const out = [];
	const list = messages || [];
	for (const m of list) out.push(await sendPush(m, opts));
	return out;
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
	parseRegisterBody,
	ensurePushTables,
	registerToken,
	listTokens,
	removeToken,
	buildApnsPayload,
	sendPush,
	sendBulk,
};
