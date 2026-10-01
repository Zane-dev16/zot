"use strict";

const events = require("./events");

const STREAM_DDL = [
	"CREATE TABLE IF NOT EXISTS stream_event(",
	"  seq INTEGER PRIMARY KEY AUTOINCREMENT,",
	"  type TEXT NOT NULL,",
	"  run_id TEXT,",
	"  body TEXT NOT NULL,",
	"  created_at INTEGER NOT NULL",
	");",
	"CREATE INDEX IF NOT EXISTS idx_stream_event_run ON stream_event(run_id);",
].join("\n");

const REPLAY_LIMIT = 200;

function ensureEventsTable(db) {
	db.exec(STREAM_DDL);
}

function recordEvent(db, log, type, data) {
	const event = events.append(log, type, data || {});
	if (!db) return event;
	try {
		ensureEventsTable(db);
		db.prepare(
			"INSERT INTO stream_event(type, run_id, body, created_at) VALUES (?, ?, ?, ?)",
		).run(
			event.type,
			event.runId == null ? null : String(event.runId),
			JSON.stringify(event),
			event.at,
		);
	} catch {
		// memory log is the source of truth when the database is unavailable
	}
	return event;
}

function mapToolRow(row) {
	return {
		id: "tool-" + row.id,
		type: row.result_ref === "request" ? "tool.request" : "tool.result",
		runId: row.run_id,
		tool: row.tool,
		argsHash: row.args_hash,
		resultRef: row.result_ref,
		at: row.created_at,
	};
}

function readPersistent(db, limit) {
	const n = limit == null ? REPLAY_LIMIT : limit;
	ensureEventsTable(db);
	const stored = db
		.prepare(
			"SELECT seq, type, run_id, body, created_at FROM stream_event ORDER BY seq ASC LIMIT ?",
		)
		.all(n)
		.map((row) => {
			try {
				const parsed = JSON.parse(row.body);
				if (parsed.id == null) parsed.id = String(row.seq);
				return parsed;
			} catch {
				return {
					id: String(row.seq),
					type: row.type,
					runId: row.run_id,
					at: row.created_at,
				};
			}
		});
	const tools = db
		.prepare(
			"SELECT id, run_id, tool, args_hash, result_ref, created_at FROM tool_event ORDER BY id ASC LIMIT ?",
		)
		.all(n)
		.map(mapToolRow);
	const merged = stored.concat(tools);
	merged.sort((a, b) => {
		if (a.at !== b.at) return a.at - b.at;
		const x = String(a.id);
		const y = String(b.id);
		return x < y ? -1 : x > y ? 1 : 0;
	});
	return merged.slice(-n);
}

function replayEvents(db, log, sinceId, limit) {
	const mem = events.since(log, sinceId);
	if (!db) return mem;
	if (log.items.length === 0) {
		try {
			return readPersistent(db, limit);
		} catch {
			return mem;
		}
	}
	if (mem.length > 0) return mem;
	const n =
		sinceId == null || sinceId === ""
			? 0
			: Number(String(sinceId).split("-").pop());
	if (!Number.isFinite(n) || n >= log.items[0].seq - 1) return mem;
	try {
		return readPersistent(db, limit).concat(mem);
	} catch {
		return mem;
	}
}

module.exports = {
	STREAM_DDL,
	REPLAY_LIMIT,
	ensureEventsTable,
	recordEvent,
	mapToolRow,
	readPersistent,
	replayEvents,
};
