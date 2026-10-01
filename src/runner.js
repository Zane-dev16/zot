"use strict";

// Runner loop plus scheduler tick. Both are poll functions the daemon
// calls on an interval. They stay synchronous except for stub exec.
const crypto = require("node:crypto");
const runs = require("./runs");
const scheduler = require("./scheduler");
const router = require("./router");

const RUNNER_INTERVAL_MS = 1000;
const SCHEDULER_INTERVAL_MS = 15000;

function newId() {
	return crypto.randomUUID();
}

function ensureModelColumn(db) {
	try {
		db.prepare("SELECT model FROM agent_run LIMIT 1").get();
	} catch {
		try {
			db.exec("ALTER TABLE agent_run ADD COLUMN model TEXT");
		} catch {
			// concurrent boot already added it
		}
	}
}

function insertRun(db, title, prompt, model, now) {
	const at = now == null ? Date.now() : now;
	const id = newId();
	const m = typeof model === "string" && model ? model : router.DEFAULT_MODEL;
	db.prepare(
		"INSERT INTO agent_run(id, title, prompt, state, attempt, created_at, updated_at, finished_at, last_heartbeat, owner_device_id, model) VALUES (?, ?, ?, 'queued', 0, ?, ?, NULL, ?, NULL, ?)",
	).run(id, title, prompt, at, at, at, m);
	return id;
}

function pollOnce(db, opts) {
	const o = opts || {};
	const now = o.now == null ? Date.now() : o.now;
	ensureModelColumn(db);
	const row = db
		.prepare(
			"SELECT id, prompt, model FROM agent_run WHERE state = 'queued' ORDER BY created_at ASC LIMIT 1",
		)
		.get();
	if (!row) return null;
	const claimed = runs.claimQueuedRow(db, row.id, now);
	if (!claimed.ok) return null;
	const model = row.model || router.DEFAULT_MODEL;
	if (o.publish) o.publish("run.state", { runId: row.id, state: "running" });
	const prompt = String(row.prompt || "");
	if (prompt.indexOf("tool:") === 0) {
		const tool = prompt.slice(5).split(/\s/)[0] || "shell";
		db.prepare(
			"UPDATE agent_run SET state = 'waiting_tool', updated_at = ? WHERE id = ?",
		).run(now, row.id);
		try {
			db.exec(require("./tools").LEASE_DDL);
			db.prepare(
				"INSERT OR IGNORE INTO tool_lease(id, run_id, tool, args_hash, state, acquired_at, expires_at, released_at) VALUES (?, ?, ?, ?, 'held', ?, ?, NULL)",
			).run(newId(), row.id, tool, "pending-approval", now, now + 60000);
		} catch {
			// lease table write is best effort here
		}
		if (o.publish) o.publish("tool.request", { runId: row.id, tool });
		return { id: row.id, paused: true, tool };
	}
	const out = router.exec(model, prompt);
	try {
		db.prepare(
			"INSERT INTO tool_event(run_id, tool, args_hash, result_ref, created_at) VALUES (?, 'model.exec', ?, ?, ?)",
		).run(row.id, model, out.text.slice(0, 200), now);
	} catch {
		// tool_event write is best effort
	}
	db.prepare(
		"UPDATE agent_run SET state = 'done', updated_at = ?, finished_at = ? WHERE id = ?",
	).run(now, now, row.id);
	if (o.publish) {
		o.publish("run.token", { runId: row.id, token: out.text });
		o.publish("run.done", { runId: row.id, state: "done" });
	}
	return { id: row.id, paused: false, model };
}

function tickScheduler(db, opts) {
	const o = opts || {};
	const now = o.now == null ? Date.now() : o.now;
	ensureModelColumn(db);
	let jobs;
	try {
		jobs = db.prepare("SELECT * FROM scheduler_job WHERE enabled = 1").all();
	} catch {
		return [];
	}
	const shaped = jobs.map((j) => ({
		id: j.id,
		nextRunAt: j.next_run_at,
		enabled: j.enabled === 1,
		cron: j.cron,
	}));
	const compute = scheduler.computeNextRunAtCron();
	const due = shaped.filter((j) => scheduler.isJobDue(j, now));
	const created = [];
	for (const job of due) {
		let next;
		try {
			next = scheduler.nextCronRunAt(job.cron, now);
		} catch {
			continue;
		}
		const row = db
			.prepare("SELECT prompt, name FROM scheduler_job WHERE id = ?")
			.get(job.id);
		const id = insertRun(
			db,
			row ? row.name : job.id,
			row ? row.prompt : "",
			router.DEFAULT_MODEL,
			now,
		);
		db.prepare(
			"UPDATE scheduler_job SET next_run_at = ?, last_run_id = ? WHERE id = ?",
		).run(next, id, job.id);
		if (o.publish)
			o.publish("run.created", { runId: id, title: row ? row.name : job.id });
		created.push(id);
	}
	void compute;
	return created;
}

module.exports = {
	RUNNER_INTERVAL_MS,
	SCHEDULER_INTERVAL_MS,
	ensureModelColumn,
	insertRun,
	pollOnce,
	tickScheduler,
};
