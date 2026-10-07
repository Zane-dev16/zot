"use strict";

// Verify vector recall plus eval depth plus chat log persistence.
// Each log line names one behavior. Uses temp file DBs only.
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const memory = require("../src/memory");
const chatops = require("../src/chatops");
const { openDb } = require("../src/db");

async function main() {
	const a = memory.embedText("puppy feeding guide");
	const b = memory.embedText("puppy feeding guide");
	assert.strictEqual(a.length, 64);
	assert.deepStrictEqual(a, b);
	let norm = 0;
	for (const v of a) norm += v * v;
	assert.ok(Math.abs(Math.sqrt(norm) - 1) < 1e-6);
	console.log("PASS embed is deterministic dim 64 and normalized");

	assert.strictEqual(memory.cosineSimilarity(a, b).toFixed(4), "1.0000");
	const other = memory.embedText("car engine torque specs");
	assert.ok(memory.cosineSimilarity(a, other) < 0.5);
	console.log("PASS cosine is 1 for self and low for unrelated text");

	const round = memory.parseEmbedding(memory.serializeEmbedding(a));
	assert.deepStrictEqual(
		round.map((v) => Number(v.toFixed(4))),
		a.map((v) => Number(v.toFixed(4))),
	);
	console.log("PASS embedding serializes and parses back");

	const docs = [
		{
			key: "puppy-guide",
			value: "puppy feeding guide",
			runId: null,
			updatedAt: 2,
		},
		{
			key: "engine-manual",
			value: "car engine repair",
			runId: null,
			updatedAt: 1,
		},
	];
	const top = memory.rankByVector(docs, "how do I feed the puppy", {
		limit: 2,
	});
	assert.strictEqual(top[0].key, "puppy-guide");
	console.log("PASS vector rank puts overlapping doc first behind FTS");

	const fts = memory.buildFtsQuery("puppy", { limit: 5 });
	assert.ok(fts.sql.indexOf("memory_fts") !== -1);
	const like = memory.buildLikeQuery("hello", { limit: 5 });
	assert.ok(like.sql.indexOf("LIKE") !== -1);
	const vsel = memory.buildVectorSelect({ limit: 5 });
	assert.ok(vsel.sql.indexOf("embedding") !== -1);
	console.log("PASS fts plus like plus vector builders all return sql");

	const legacy = new DatabaseSync(":memory:");
	legacy.exec(
		"CREATE TABLE memory_item(id TEXT PRIMARY KEY, run_id TEXT, key TEXT NOT NULL, value TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)",
	);
	assert.strictEqual(memory.ensureEmbeddingColumn(legacy), true);
	assert.strictEqual(memory.ensureEmbeddingColumn(legacy), false);
	legacy
		.prepare(
			"INSERT INTO memory_item(id, key, value, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
		)
		.run("1", "puppy guide", "feed the puppy twice daily", 1, 1);
	assert.strictEqual(memory.backfillEmbeddings(legacy), 1);
	const emb = legacy
		.prepare("SELECT embedding FROM memory_item WHERE id = ?")
		.get("1").embedding;
	assert.strictEqual(JSON.parse(emb).length, 64);
	console.log("PASS legacy db gains embedding column and backfills one row");

	const fresh = openDb(":memory:");
	const cols = fresh
		.prepare("PRAGMA table_info(memory_item)")
		.all()
		.map((r) => r.name);
	assert.ok(cols.indexOf("embedding") !== -1);
	const item = memory.createMemoryItem({
		key: "puppy guide",
		value: "feed twice daily",
		runId: null,
	});
	fresh
		.prepare(
			"INSERT INTO memory_item(id, run_id, key, value, embedding, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
		)
		.run(
			item.id,
			item.runId,
			item.key,
			item.value,
			memory.serializeEmbedding(item.embedding),
			item.createdAt,
			item.updatedAt,
		);
	const found = fresh
		.prepare("SELECT rowid FROM memory_fts WHERE memory_fts MATCH ?")
		.all("puppy");
	assert.ok(found.length >= 1);
	const cand = fresh.prepare(vsel.sql).all(...vsel.params);
	const ranked = memory.rankByVector(
		cand.map((r) => ({
			key: r.key,
			value: r.value,
			embedding: r.embedding,
			runId: r.run_id,
			updatedAt: r.updated_at,
		})),
		"how do I feed the puppy",
		{ limit: 5 },
	);
	assert.strictEqual(ranked[0].key, "puppy guide");
	console.log(
		"PASS fresh db stores embedding and fts plus vector both find it",
	);

	const tasks = JSON.parse(
		fs.readFileSync(path.join(__dirname, "..", "evals", "tasks.json"), "utf8"),
	);
	assert.ok(tasks.length >= 8, "tasks grow beyond toy 3");
	const kinds = new Set(tasks.map((t) => String(t.input).split(" ")[0]));
	assert.ok(
		kinds.size >= 4,
		"tasks cover router plus cron plus memory plus chatops",
	);
	console.log(
		"PASS eval tasks are " +
			tasks.length +
			" across " +
			kinds.size +
			" prefixes",
	);

	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zot-vector-"));
	const dbPath = path.join(dir, "zot.db");
	const db1 = openDb(dbPath);
	chatops.ensureChatLogTable(db1);
	const rowId = chatops.persistChatLog(db1, {
		direction: "out",
		target: "slack",
		text: "eval summary",
		ok: true,
		status: 200,
		at: Date.now(),
	});
	assert.ok(Number(rowId) >= 1);
	chatops.clearQueue();
	chatops.enqueueChatops({
		target: "slack",
		text: "hello persist",
		channel: "c1",
	});
	const drained = await chatops.drainChatopsQueue(db1, {
		sendFn: async () => ({ ok: true, status: 200 }),
	});
	assert.strictEqual(drained.length, 1);
	assert.strictEqual(drained[0].ok, true);
	db1.close();
	const db2 = openDb(dbPath);
	const rows = db2
		.prepare("SELECT direction, target, text FROM chat_log ORDER BY id ASC")
		.all();
	assert.ok(rows.length >= 2);
	assert.ok(rows.some((r) => r.text === "eval summary"));
	assert.ok(rows.some((r) => r.text === "hello persist"));
	db2.close();
	fs.rmSync(dir, { recursive: true, force: true });
	console.log("PASS chat log rows persist across db reopen");

	console.log("ALL PASS");
}

main().catch((err) => {
	console.error(err && err.message ? err.message : String(err));
	process.exit(1);
});
