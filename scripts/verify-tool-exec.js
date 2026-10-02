"use strict";
const assert = require("node:assert");
const { DatabaseSync } = require("node:sqlite");
const { migrate } = require("../src/db");
const runner = require("../src/runner");
const runs = require("../src/runs");

const db = new DatabaseSync(":memory:");
db.exec("PRAGMA foreign_keys = ON;");
migrate(db);
const id = runner.insertRun(db, "t", "tool: shell echo hi", "echo", 1000);
assert.strictEqual(runner.pollOnce(db, { now: 1001 }).paused, true);
assert.strictEqual(
	db.prepare("SELECT state FROM agent_run WHERE id = ?").get(id).state,
	"waiting_tool",
);
const row = db.prepare("SELECT * FROM agent_run WHERE id = ?").get(id);
const shaped = {
	id: row.id,
	title: row.title,
	prompt: row.prompt,
	state: row.state,
	attempt: row.attempt,
	createdAt: row.created_at,
	updatedAt: row.updated_at,
	finishedAt: row.finished_at,
	lastHeartbeat: row.last_heartbeat,
	ownerDeviceId: row.owner_device_id,
};
const next = runs.approve(shaped);
db.prepare("UPDATE agent_run SET state = ?, updated_at = ? WHERE id = ?").run(
	next.state,
	next.updatedAt,
	id,
);
const resumed = runner.pollOnce(db, { now: 1002 });
assert.strictEqual(resumed.ok, true);
assert.strictEqual(
	db.prepare("SELECT state FROM agent_run WHERE id = ?").get(id).state,
	"done",
);
const ev = db
	.prepare("SELECT result_ref FROM tool_event WHERE run_id = ?")
	.all(id);
assert.ok(ev.some((e) => (e.result_ref || "").includes("hi")));
console.log("tool exec approve resume reaches done with hi in tool_event");
