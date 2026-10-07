"use strict";

// Memory recall storage. Prefer SQLite FTS5 via memory_fts. Use buildLikeQuery
// when FTS5 is unavailable. Vector recall ranks by cosine over local hash
// embeddings and runs behind FTS with no extra deps. Both builders are pure
// and return { sql, params }. Vector scoring is pure JS over fetched rows.
const crypto = require("node:crypto");

const EMBED_DIM = 64;

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
		embedding: embedMemoryValue(key, value, EMBED_DIM),
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
	next[idx] = {
		...items[idx],
		value: entry.value,
		embedding: embedMemoryValue(items[idx].key, entry.value, EMBED_DIM),
		updatedAt: at,
	};
	return next;
}

function fnv1a(str) {
	let h = 0x811c9dc5;
	for (let i = 0; i < str.length; i++) {
		h ^= str.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return h >>> 0;
}

function tokenize(text) {
	const m = String(text || "")
		.toLowerCase()
		.match(/[a-z0-9]+/g);
	return m || [];
}

function embedText(text, dim) {
	const d = dim === undefined ? EMBED_DIM : dim;
	if (!Number.isInteger(d) || d <= 0 || d > 512) {
		throw new Error("dim must be an integer between 1 and 512");
	}
	const vec = new Array(d).fill(0);
	for (const tok of tokenize(text)) vec[fnv1a(tok) % d] += 1;
	let norm = 0;
	for (const v of vec) norm += v * v;
	norm = Math.sqrt(norm);
	if (norm === 0) return vec;
	return vec.map((v) => v / norm);
}

function embedMemoryValue(key, value, dim) {
	return embedText(String(key || "") + "\n" + String(value || ""), dim);
}

function serializeEmbedding(vec) {
	if (!Array.isArray(vec)) throw new Error("vec must be an array");
	return JSON.stringify(vec.map((v) => Number(v.toFixed(6))));
}

function parseEmbedding(s) {
	if (Array.isArray(s)) return s;
	if (typeof s !== "string" || s.length === 0) return null;
	try {
		const v = JSON.parse(s);
		if (!Array.isArray(v)) return null;
		return v;
	} catch {
		return null;
	}
}

function cosineSimilarity(a, b) {
	if (!Array.isArray(a) || !Array.isArray(b)) return 0;
	const n = Math.min(a.length, b.length);
	let dot = 0;
	for (let i = 0; i < n; i++) dot += a[i] * b[i];
	return dot;
}

function itemVector(item, dim) {
	if (!item || typeof item !== "object") return null;
	const stored = parseEmbedding(item.embedding);
	if (stored) return stored;
	if (typeof item.key === "string" && typeof item.value === "string") {
		return embedMemoryValue(item.key, item.value, dim);
	}
	return null;
}

function rankByVector(items, query, opts) {
	const o = opts || {};
	const d = o.dim === undefined ? EMBED_DIM : o.dim;
	const runId = o.runId === undefined ? null : o.runId;
	const includeGlobal = o.includeGlobal === undefined ? true : o.includeGlobal;
	const limit = o.limit === undefined ? 20 : o.limit;
	const minScore = o.minScore === undefined ? 0 : o.minScore;
	if (!Array.isArray(items)) throw new Error("items must be an array");
	if (typeof query !== "string" || query.length === 0) return [];
	const qv = embedText(query, d);
	const scored = [];
	for (const item of items) {
		if (!matchesScope(item, runId, includeGlobal)) continue;
		const v = itemVector(item, d);
		if (!v) continue;
		const score = cosineSimilarity(qv, v);
		if (score <= minScore) continue;
		scored.push({ item, score });
	}
	scored.sort((a, b) => b.score - a.score);
	return scored.slice(0, limit).map((s) => s.item);
}

function buildVectorSelect(opts) {
	const o = opts || {};
	let sql =
		"SELECT id, run_id, key, value, embedding, created_at, updated_at FROM memory_item " +
		"WHERE embedding IS NOT NULL";
	const params = [];
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
	params.push(o.limit === undefined ? 200 : o.limit);
	return { sql, params };
}

function ensureEmbeddingColumn(db) {
	const cols = db
		.prepare("PRAGMA table_info(memory_item)")
		.all()
		.map((r) => r.name);
	if (cols.includes("embedding")) return false;
	db.exec("ALTER TABLE memory_item ADD COLUMN embedding TEXT");
	return true;
}

function backfillEmbeddings(db, dim) {
	const d = dim === undefined ? EMBED_DIM : dim;
	ensureEmbeddingColumn(db);
	const rows = db
		.prepare("SELECT id, key, value FROM memory_item WHERE embedding IS NULL")
		.all();
	const upd = db.prepare("UPDATE memory_item SET embedding = ? WHERE id = ?");
	for (const r of rows) {
		upd.run(serializeEmbedding(embedMemoryValue(r.key, r.value, d)), r.id);
	}
	return rows.length;
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
	EMBED_DIM,
	createMemoryItem,
	matchesScope,
	recall,
	upsertMemory,
	escapeLike,
	buildLikeQuery,
	buildFtsQuery,
	buildVectorSelect,
	rankByVector,
	backfillEmbeddings,
	ensureEmbeddingColumn,
	embedText,
	embedMemoryValue,
	serializeEmbedding,
	parseEmbedding,
	cosineSimilarity,
};
