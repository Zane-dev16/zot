"use strict";

const HEARTBEAT_INTERVAL_MS = 5000;
const STALE_AFTER_MS = 60000;
const MAX_ATTEMPTS = 5;

const STATES = [
	"queued",
	"running",
	"waiting_tool",
	"done",
	"failed",
	"cancelled",
];

const TRANSITIONS = {
	queued: ["running", "cancelled"],
	running: ["waiting_tool", "done", "failed", "cancelled"],
	waiting_tool: ["running", "failed", "cancelled"],
	done: [],
	failed: [],
	cancelled: [],
};

const TERMINAL = ["done", "failed", "cancelled"];

function canTransition(from, to) {
	return (TRANSITIONS[from] || []).indexOf(to) !== -1;
}

function transition(run, to, now) {
	if (!canTransition(run.state, to)) throw new Error("bad run transition");
	const at = now == null ? Date.now() : now;
	const next = Object.assign({}, run, { state: to, updatedAt: at });
	if (TERMINAL.indexOf(to) !== -1) next.finishedAt = at;
	return next;
}

function createRun(input) {
	const now = input.now == null ? Date.now() : input.now;
	return {
		id: input.id,
		title: input.title,
		prompt: input.prompt,
		state: "queued",
		attempt: 0,
		createdAt: now,
		updatedAt: now,
		finishedAt: null,
		lastHeartbeat: now,
		ownerDeviceId: input.ownerDeviceId == null ? null : input.ownerDeviceId,
	};
}

function claim(run, id, now) {
	if (!run || run.id !== id) return { ok: false, reason: "not-found" };
	if (run.state !== "queued") return { ok: false, reason: "not-queued" };
	return { ok: true, run: transition(run, "running", now) };
}

function heartbeat(run, now) {
	const at = now == null ? Date.now() : now;
	if (run.state !== "running" && run.state !== "waiting_tool") return run;
	return Object.assign({}, run, { lastHeartbeat: at, updatedAt: at });
}

function isStale(run, now, thresholdMs) {
	const at = now == null ? Date.now() : now;
	const limit = thresholdMs == null ? STALE_AFTER_MS : thresholdMs;
	if (run.state !== "running" && run.state !== "waiting_tool") return false;
	return at - run.lastHeartbeat > limit;
}

function requeue(run, now) {
	const at = now == null ? Date.now() : now;
	if (run.state !== "running" && run.state !== "waiting_tool") return run;
	if (run.attempt >= MAX_ATTEMPTS) return transition(run, "failed", at);
	return Object.assign({}, run, {
		state: "queued",
		attempt: run.attempt + 1,
		updatedAt: at,
	});
}

function requeueStale(runs, now, thresholdMs) {
	return runs.map((r) => (isStale(r, now, thresholdMs) ? requeue(r, now) : r));
}

function approve(run, now) {
	return transition(run, "running", now);
}

function cancel(run, now) {
	return transition(run, "cancelled", now);
}

function finish(run, ok, now) {
	return transition(run, ok ? "done" : "failed", now);
}

function claimQueuedRow(db, id, now) {
	const at = now == null ? Date.now() : now;
	const row = db
		.prepare("SELECT id, state FROM agent_run WHERE id = ?")
		.get(id);
	const verdict = claim(row, id, at);
	if (!verdict.ok) return verdict;
	const info = db
		.prepare(
			"UPDATE agent_run SET state = 'running', updated_at = ? WHERE id = ? AND state = 'queued'",
		)
		.run(at, id);
	if (info.changes !== 1) return { ok: false, reason: "raced" };
	return verdict;
}

function heartbeatRow(db, id, now) {
	const at = now == null ? Date.now() : now;
	db.prepare(
		"UPDATE agent_run SET last_heartbeat = ?, updated_at = ? WHERE id = ? AND state IN ('running','waiting_tool')",
	).run(at, at, id);
}

function requeueStaleRows(db, now, thresholdMs) {
	const at = now == null ? Date.now() : now;
	const limit = thresholdMs == null ? STALE_AFTER_MS : thresholdMs;
	const cutoff = at - limit;
	const stale = db
		.prepare(
			"SELECT id, attempt FROM agent_run WHERE state IN ('running','waiting_tool') AND last_heartbeat < ?",
		)
		.all(cutoff);
	for (const row of stale) {
		if (row.attempt >= MAX_ATTEMPTS) {
			db.prepare(
				"UPDATE agent_run SET state = 'failed', updated_at = ?, finished_at = ? WHERE id = ?",
			).run(at, at, row.id);
		} else {
			db.prepare(
				"UPDATE agent_run SET state = 'queued', attempt = attempt + 1, updated_at = ? WHERE id = ?",
			).run(at, row.id);
		}
	}
	return stale.length;
}

module.exports = {
	HEARTBEAT_INTERVAL_MS,
	STALE_AFTER_MS,
	MAX_ATTEMPTS,
	STATES,
	TRANSITIONS,
	canTransition,
	transition,
	createRun,
	claim,
	heartbeat,
	isStale,
	requeue,
	requeueStale,
	approve,
	cancel,
	finish,
	claimQueuedRow,
	heartbeatRow,
	requeueStaleRows,
};
