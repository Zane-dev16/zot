"use strict";

// Runner loop plus scheduler tick. Both are poll functions the daemon
// calls on an interval. Tool exec stays synchronous via execFileSync.
const crypto = require("node:crypto");
const runs = require("./runs");
const scheduler = require("./scheduler");
const router = require("./router");
const tools = require("./tools");

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

function resumeApprovedOnce(db, opts) {
	const o = opts || {};
	const now = o.now == null ? Date.now() : o.now;
	const row = db
		.prepare(
			"SELECT id, prompt FROM agent_run WHERE state = 'running' AND prompt LIKE 'tool:%' ORDER BY updated_at ASC LIMIT 1",
		)
		.get();
	if (!row) return null;
	const parsed = tools.parseToolPrompt(row.prompt);
	if (!parsed) return null;
	const outcome = tools.execToolSync({
		tool: parsed.tool,
		args: parsed.args,
		root: o.root,
	});
	let text = "error:" + String(outcome.error || "failed").slice(0, 200);
	if (outcome.ok)
		text = String(outcome.result == null ? "" : outcome.result).slice(0, 200);
	if (!outcome.ok && tools.isDenied(outcome)) text = tools.denyRef(outcome);
	try {
		db.exec(tools.LEASE_DDL);
		db.prepare(
			"INSERT INTO tool_event(run_id, tool, args_hash, result_ref, created_at) VALUES (?, ?, ?, ?, ?)",
		).run(row.id, parsed.tool, tools.hashArgs(parsed.args), text, now);
	} catch {
		// tool_event write is best effort
	}
	try {
		db.prepare(
			"UPDATE tool_lease SET state = 'done', released_at = ? WHERE run_id = ? AND state = 'held'",
		).run(now, row.id);
	} catch {
		// lease update is best effort
	}
	const done = outcome.ok;
	db.prepare(
		"UPDATE agent_run SET state = ?, updated_at = ?, finished_at = ? WHERE id = ?",
	).run(done ? "done" : "failed", now, now, row.id);
	if (o.publish) {
		o.publish("tool.result", { runId: row.id, tool: parsed.tool, ok: done });
		o.publish("run.done", { runId: row.id, state: done ? "done" : "failed" });
	}
	return { id: row.id, ok: done, tool: parsed.tool };
}

function pollOnce(db, opts) {
	const o = opts || {};
	const now = o.now == null ? Date.now() : o.now;
	ensureModelColumn(db);
	const resumed = resumeApprovedOnce(db, o);
	if (resumed) return resumed;
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
	const parsed = tools.parseToolPrompt(prompt);
	if (parsed) {
		const tool = parsed.tool;
		db.prepare(
			"UPDATE agent_run SET state = 'waiting_tool', updated_at = ? WHERE id = ?",
		).run(now, row.id);
		try {
			db.exec(require("./tools").LEASE_DDL);
			db.prepare(
				"INSERT OR IGNORE INTO tool_lease(id, run_id, tool, args_hash, state, acquired_at, expires_at, released_at) VALUES (?, ?, ?, ?, 'held', ?, ?, NULL)",
			).run(
				newId(),
				row.id,
				tool,
				tools.hashArgs(parsed.args),
				now,
				now + 60000,
			);
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
	scheduler.ensureSchedulerRunTable(db);
	let jobs;
	try {
		jobs = db.prepare("SELECT * FROM scheduler_job WHERE enabled = 1").all();
	} catch {
		return [];
	}
	const shaped = [];
	for (const j of jobs) {
		const item = {
			id: j.id,
			nextRunAt: j.next_run_at,
			enabled: j.enabled === 1,
			cron: j.cron,
		};
		try {
			scheduler.parseCron(item.cron);
		} catch {
			continue;
		}
		shaped.push(item);
	}
	let claimed = [];
	try {
		claimed = scheduler.tickJobs(
			shaped,
			now,
			scheduler.computeNextRunAtCron(),
		).claimed;
	} catch {
		return [];
	}
	const created = [];
	for (const job of claimed) {
		const row = db
			.prepare("SELECT prompt, name, cron FROM scheduler_job WHERE id = ?")
			.get(job.id);
		if (!row) continue;
		const id = insertRun(
			db,
			row ? row.name : job.id,
			row ? row.prompt : "",
			router.DEFAULT_MODEL,
			now,
		);
		db.prepare(
			"UPDATE scheduler_job SET next_run_at = ?, last_run_id = ? WHERE id = ?",
		).run(job.nextRunAt, id, job.id);
		try {
			scheduler.recordJobRun(db, job.id, id, row.cron, now);
		} catch {}
		if (o.publish)
			o.publish("run.created", { runId: id, title: row ? row.name : job.id });
		created.push(id);
	}
	return created;
}

module.exports = {
	RUNNER_INTERVAL_MS,
	SCHEDULER_INTERVAL_MS,
	ensureModelColumn,
	insertRun,
	resumeApprovedOnce,
	pollOnce,
	tickScheduler,
};
