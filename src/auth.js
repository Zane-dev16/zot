"use strict";

const crypto = require("node:crypto");

const TOKEN_BYTES = 32;
const PAIR_CODE_EXPIRY_MS = 5 * 60 * 1000;
const PAIR_WINDOW_MS = 60 * 1000;
const PAIR_MAX_ATTEMPTS = 5;

function assertTokenString(token) {
	if (typeof token !== "string" || token.length === 0) {
		throw new Error("token must be a nonempty string");
	}
}

function hashToken(token) {
	assertTokenString(token);
	return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

function tokensEqual(a, b) {
	if (typeof a !== "string" || typeof b !== "string") return false;
	const ba = Buffer.from(a, "utf8");
	const bb = Buffer.from(b, "utf8");
	if (ba.length !== bb.length) return false;
	return crypto.timingSafeEqual(ba, bb);
}

function verifyToken(token, storedHash) {
	if (typeof storedHash !== "string" || storedHash.length === 0) return false;
	let candidate;
	try {
		candidate = hashToken(token);
	} catch {
		return false;
	}
	return tokensEqual(candidate, storedHash);
}

function generateToken() {
	return crypto.randomBytes(TOKEN_BYTES).toString("hex");
}

function generatePairCode() {
	return String(crypto.randomInt(0, 1000000)).padStart(6, "0");
}

function isPairCodeExpired(startedAt, nowMs) {
	const now = nowMs === undefined ? Date.now() : nowMs;
	if (!Number.isFinite(startedAt) || !Number.isFinite(now)) return true;
	if (startedAt > now) return true;
	return now - startedAt > PAIR_CODE_EXPIRY_MS;
}

function newId() {
	if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
	return crypto.randomBytes(16).toString("hex");
}

function createDeviceSession({ id, label, kind, tokenHash, now }) {
	const at = now === undefined ? Date.now() : now;
	if (typeof label !== "string" || label.length === 0) {
		throw new Error("label must be a nonempty string");
	}
	if (kind !== "browser" && kind !== "ios") {
		throw new Error('kind must be "browser" or "ios"');
	}
	if (typeof tokenHash !== "string" || !/^[0-9a-f]{64}$/.test(tokenHash)) {
		throw new Error("tokenHash must be sha256 hex");
	}
	return {
		id: id || newId(),
		label,
		kind,
		tokenHash,
		createdAt: at,
		lastSeenAt: at,
		revokedAt: null,
	};
}

function isSessionActive(session) {
	return !!session && session.revokedAt === null;
}

function touchSession(session, now) {
	const at = now === undefined ? Date.now() : now;
	return { ...session, lastSeenAt: at };
}

function revokeSession(session, now) {
	const at = now === undefined ? Date.now() : now;
	if (session.revokedAt !== null) return session;
	return { ...session, revokedAt: at };
}

function startPairing({ label, kind, now }) {
	const at = now === undefined ? Date.now() : now;
	if (typeof label !== "string" || label.length === 0) {
		throw new Error("label must be a nonempty string");
	}
	if (kind !== "browser" && kind !== "ios") {
		throw new Error('kind must be "browser" or "ios"');
	}
	const code = generatePairCode();
	return {
		code,
		label,
		kind,
		startedAt: at,
		expiresAt: at + PAIR_CODE_EXPIRY_MS,
	};
}

function confirmPairing({ code, expectedCode, startedAt, label, kind, now }) {
	const at = now === undefined ? Date.now() : now;
	if (typeof code !== "string" || typeof expectedCode !== "string") {
		throw new Error("code must be a string");
	}
	if (isPairCodeExpired(startedAt, at)) {
		throw new Error("pair code expired");
	}
	if (!tokensEqual(code, expectedCode)) {
		throw new Error("pair code mismatch");
	}
	const token = generateToken();
	const session = createDeviceSession({
		label,
		kind,
		tokenHash: hashToken(token),
		now: at,
	});
	return { token, session };
}

function isRateLimited(attemptsAt, nowMs, max, windowMs) {
	const now = nowMs === undefined ? Date.now() : nowMs;
	const limit = max === undefined ? PAIR_MAX_ATTEMPTS : max;
	const window = windowMs === undefined ? PAIR_WINDOW_MS : windowMs;
	if (!Array.isArray(attemptsAt)) return false;
	let count = 0;
	for (const t of attemptsAt) {
		if (Number.isFinite(t) && t > now - window && t <= now) count += 1;
	}
	return count >= limit;
}

module.exports = {
	TOKEN_BYTES,
	PAIR_CODE_EXPIRY_MS,
	PAIR_WINDOW_MS,
	PAIR_MAX_ATTEMPTS,
	hashToken,
	tokensEqual,
	verifyToken,
	generateToken,
	generatePairCode,
	isPairCodeExpired,
	createDeviceSession,
	isSessionActive,
	touchSession,
	revokeSession,
	startPairing,
	confirmPairing,
	isRateLimited,
};
