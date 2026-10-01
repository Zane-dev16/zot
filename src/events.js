"use strict";

const EVENT_TYPES = [
	"run.created",
	"run.state",
	"run.token",
	"tool.request",
	"tool.result",
	"run.done",
	"daemon.heartbeat",
];

const EVENT_DDL = [
	"CREATE TABLE IF NOT EXISTS tool_event(",
	"  id INTEGER PRIMARY KEY AUTOINCREMENT,",
	"  run_id TEXT NOT NULL REFERENCES agent_run(id) ON DELETE CASCADE,",
	"  tool TEXT NOT NULL,",
	"  args_hash TEXT NOT NULL,",
	"  result_ref TEXT,",
	"  created_at INTEGER NOT NULL",
	");",
].join("\n");

function createLog() {
	return { seq: 0, items: [] };
}

function isKnownType(type) {
	return EVENT_TYPES.indexOf(type) !== -1;
}

function append(log, type, data) {
	if (!isKnownType(type)) throw new Error("unknown event type " + type);
	log.seq += 1;
	const event = Object.assign(
		{ id: String(log.seq), seq: log.seq, type, at: Date.now() },
		data || {},
	);
	log.items.push(event);
	return event;
}

function since(log, sinceId) {
	const n = sinceId == null || sinceId === "" ? 0 : Number(sinceId);
	return log.items.filter((e) => e.seq > n);
}

function appendToolEvent(log, fields) {
	return append(
		log,
		fields.kind === "request" ? "tool.request" : "tool.result",
		{
			runId: fields.runId,
			tool: fields.tool,
			argsHash: fields.argsHash,
			resultRef: fields.resultRef == null ? null : String(fields.resultRef),
		},
	);
}

module.exports = {
	EVENT_TYPES,
	EVENT_DDL,
	createLog,
	isKnownType,
	append,
	since,
	appendToolEvent,
};
