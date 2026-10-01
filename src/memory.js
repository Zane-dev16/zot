"use strict";

const crypto = require("node:crypto");

function newId() {
	if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
	return crypto.randomBytes(16).toString("hex");
}

function createMemoryItem({ id, runId, key, value, now }) {
	const at = now === undefined ? Date.now() : now;
	if (typeof key !== "string" || key.length === 0) {
		throw new Error("key must be a nonempty string");
	}
	if (typeof value !== "string") throw new Error("value must be a string");
	if (runId !== null && runId !== undefined && typeof runId !== "string") {
		throw new Error("runId must be a string or null");
	}
	return {
		id: id || newId(),
		runId: runId === undefined ? null : runId,
		key,
		value,
		createdAt: at,
		updatedAt: at,
	};
}

function matchesScope(item, runId, includeGlobal) {
	const global = includeGlobal === undefined ? true : includeGlobal;
	if (!item || typeof item !== "object") return false;
	if (runId === undefined || runId === null) {
		if (item.runId === null || item.runId === undefined) return true;
		return global;
	}
	if (item.runId === runId) return true;
	if (global && (item.runId === null || item.runId === undefined)) return true;
	return false;
}

function scoreMatch(item, q) {
	const key = item.key.toLowerCase();
	const value = item.value.toLowerCase();
	if (key === q) return 0;
	if (key.startsWith(q)) return 1;
	if (key.includes(q)) return 2;
	if (value.includes(q)) return 3;
	return 4;
}

function recall(items, query, opts) {
	const o = opts || {};
	const runId = o.runId === undefined ? null : o.runId;
	const includeGlobal = o.includeGlobal === undefined ? true : o.includeGlobal;
	const limit = o.limit === undefined ? 20 : o.limit;
	if (!Array.isArray(items)) throw new Error("items must be an array");
	if (typeof query !== "string" || query.length === 0) return [];
	const q = query.toLowerCase();
	const out = [];
	for (const item of items) {
		if (typeof item.key !== "string" || typeof item.value !== "string")
			continue;
		if (!matchesScope(item, runId, includeGlobal)) continue;
		if (
			!item.key.toLowerCase().includes(q) &&
			!item.value.toLowerCase().includes(q)
		) {
			continue;
		}
		out.push(item);
	}
	out.sort((a, b) => {
		const sa = scoreMatch(a, q);
		const sb = scoreMatch(b, q);
		if (sa !== sb) return sa - sb;
		return b.updatedAt - a.updatedAt;
	});
	return out.slice(0, limit);
}

function upsertMemory(items, entry, now) {
	if (!Array.isArray(items)) throw new Error("items must be an array");
	const at = now === undefined ? Date.now() : now;
	const runId = entry.runId === undefined ? null : entry.runId;
	const idx = items.findIndex(
		(it) => it.key === entry.key && (it.runId || null) === (runId || null),
	);
	if (idx === -1) {
		return [...items, createMemoryItem({ ...entry, runId, now: at })];
	}
	const next = items.slice();
	next[idx] = { ...items[idx], value: entry.value, updatedAt: at };
	return next;
}

function escapeLike(s) {
	return s.replace(/[\\%_]/g, (c) => "\\" + c);
}

function buildLikeQuery(query, opts) {
	const o = opts || {};
	if (typeof query !== "string" || query.length === 0) {
		throw new Error("query must be a nonempty string");
	}
	const pattern = "%" + escapeLike(query) + "%";
	let sql =
		"SELECT id, run_id, key, value, created_at, updated_at FROM memory_item " +
		"WHERE (key LIKE ? ESCAPE '\\' OR value LIKE ? ESCAPE '\\')";
	const params = [pattern, pattern];
	if (o.runId !== undefined && o.runId !== null) {
		if (o.includeGlobal === false) {
			sql += " AND run_id = ?";
			params.push(o.runId);
		} else {
			sql += " AND (run_id = ? OR run_id IS NULL)";
			params.push(o.runId);
		}
	}
	sql += " ORDER BY updated_at DESC LIMIT ?";
	params.push(o.limit === undefined ? 20 : o.limit);
	return { sql, params };
}

function buildFtsQuery(query, opts) {
	const o = opts || {};
	if (typeof query !== "string" || query.length === 0) {
		throw new Error("query must be a nonempty string");
	}
	let sql = "SELECT rowid FROM memory_fts WHERE memory_fts MATCH ?";
	const params = [query];
	if (o.limit !== undefined) {
		sql += " LIMIT ?";
		params.push(o.limit);
	}
	return { sql, params };
}

module.exports = {
	createMemoryItem,
	matchesScope,
	recall,
	upsertMemory,
	escapeLike,
	buildLikeQuery,
	buildFtsQuery,
};
