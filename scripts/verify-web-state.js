#!/usr/bin/env node
// Offline reducer test for the client state model (M1). No daemon, no browser:
// recorded stream frames and REST payloads go straight through reduce(), and the
// merge rules that the UI depends on are asserted here.
//
// Runs as CommonJS; web/package.json marks web/** as ES modules, so the imports
// below load the same modules the browser loads.
//
// Usage: node scripts/verify-web-state.js

"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const WEB_JS = path.join(__dirname, "..", "web", "js");

async function main() {
	const store = await import(pathToFileURL(path.join(WEB_JS, "store.js")).href);
	const api = await import(pathToFileURL(path.join(WEB_JS, "api.js")).href);
	const format = await import(pathToFileURL(path.join(WEB_JS, "format.js")).href);
	const {
		initialState,
		reduce,
		selectActivity,
		selectApprovals,
		selectCanFetch,
		selectChatRuns,
		selectCursor,
		selectDetailQueue,
		selectOrderedRuns,
	} = store;

	let passed = 0;
	function pass(name) {
		passed += 1;
		console.log("PASS state " + name);
	}

	function withToken(extra) {
		return initialState({ auth: { status: "hasToken", token: "t" }, ...(extra || {}) });
	}

	// 1. A REST title must survive the frames that follow it. The interactive
	//    POST publishes no run.created, so the title comes from the POST body.
	{
		let s = withToken();
		s = reduce(s, {
			type: "run.upsert",
			run: { id: "r1", title: "hello verify", titleSource: "server", state: "queued", prompt: "hello verify", createdAt: 1000 },
		});
		s = reduce(s, { type: "stream.frame", frame: { id: "1", seq: 1, type: "run.state", runId: "r1", state: "running", at: 1200 } });
		const run = s.runs.byId.r1;
		assert.equal(run.title, "hello verify");
		assert.equal(run.titleSource, "server");
		assert.equal(run.state, "running");
		pass("merge: a server title survives a later state frame");
	}

	// 2. GET /runs is a union: a run the stream delivered before the snapshot
	//    must not be dropped by an older list.
	{
		let s = withToken();
		s = reduce(s, { type: "stream.frame", frame: { id: "2", seq: 2, type: "run.state", runId: "new", state: "running", at: 5000 } });
		s = reduce(s, {
			type: "runs.loadOk",
			stamp: 1,
			at: 6000,
			runs: [{ id: "old", title: "older run", state: "done", createdAt: 1000, updatedAt: 1100 }],
		});
		assert.deepEqual(s.runs.order, ["new", "old"]);
		assert.ok(s.runs.byId.new);
		assert.equal(s.runs.byId.old.title, "older run");
		assert.equal(s.runs.load.status, "ready");
		pass("merge: list snapshots union with stream-known ids, newest first");
	}

	// 3. Order is createdAt desc and stable: a state change never moves a row.
	{
		let s = withToken();
		s = reduce(s, { type: "run.upsert", run: { id: "a", createdAt: 2000, state: "running" } });
		s = reduce(s, { type: "run.upsert", run: { id: "b", createdAt: 1000, state: "queued" } });
		s = reduce(s, { type: "stream.frame", frame: { id: "3", seq: 3, type: "run.state", runId: "b", state: "running", at: 9000 } });
		assert.deepEqual(s.runs.order, ["a", "b"]);
		s = reduce(s, { type: "run.upsert", run: { id: "c", createdAt: 3000, state: "queued" } });
		assert.deepEqual(s.runs.order, ["c", "a", "b"]);
		pass("order: state changes never reorder rows");
	}

	// 4. An unknown id from the stream queues exactly one detail fetch, and the
	//    fetched row supplies the real title.
	{
		let s = withToken();
		s = reduce(s, { type: "stream.frame", frame: { id: "4", seq: 4, type: "run.state", runId: "u1", state: "running", at: 3000 } });
		s = reduce(s, { type: "stream.frame", frame: { id: "5", seq: 5, type: "run.state", runId: "u1", state: "waiting_tool", at: 3100 } });
		assert.deepEqual(selectDetailQueue(s), ["u1"]);
		assert.equal(s.runs.byId.u1.titleSource, "pending");
		assert.equal(format.titleOf(selectChatRuns(s)[0]), "run · u1");
		s = reduce(s, { type: "run.detailStart", id: "u1" });
		assert.deepEqual(selectDetailQueue(s), []);
		s = reduce(s, { type: "run.detailOk", id: "u1", run: { id: "u1", title: "tool approval", prompt: "tool: shell echo hi", state: "waiting_tool", createdAt: 2900 } });
		assert.equal(s.runs.byId.u1.title, "tool approval");
		assert.equal(s.runs.byId.u1.titleSource, "server");
		assert.equal(s.runs.byId.u1.state, "waiting_tool");
		pass("detail: one queued GET per unknown id, title filled from REST");
	}

	// 5. Replay is idempotent: the same seq twice appends tokens once.
	{
		let s = withToken();
		const frame = { id: "6", seq: 6, type: "run.token", runId: "r1", token: "echo[echo]: hi", at: 1000 };
		s = reduce(s, { type: "stream.frame", frame });
		s = reduce(s, { type: "stream.frame", frame });
		assert.equal(s.runs.byId.r1.tokensText, "echo[echo]: hi");
		pass("replay: a repeated frame appends nothing");
	}

	// 6. The cursor only ever moves on a numeric seq. Heartbeats have none.
	{
		let s = withToken();
		s = reduce(s, { type: "stream.frame", frame: { id: "hb-1794936983", type: "daemon.heartbeat", at: 1794936983 } });
		assert.equal(selectCursor(s), "");
		assert.deepEqual(Object.keys(s.stream.seen), []);
		s = reduce(s, { type: "stream.frame", frame: { id: "7", seq: 7, type: "run.token", runId: "r1", token: "x", at: 1000 } });
		assert.equal(selectCursor(s), "7");
		s = reduce(s, { type: "stream.frame", frame: { id: "hb-1794936984", type: "daemon.heartbeat", at: 1794936984 } });
		assert.equal(selectCursor(s), "7");
		pass("cursor: heartbeats never become zot.since");
	}

	// 7. Token text is capped in the store, keeping the tail.
	{
		let s = withToken();
		s = reduce(s, { type: "run.tokens", id: "r1", text: "a".repeat(70 * 1024) });
		const text = s.runs.byId.r1.tokensText;
		assert.ok(text.startsWith("…truncated\n"));
		assert.ok(text.length <= 64 * 1024 + 12);
		assert.ok(text.endsWith("a".repeat(100)));
		pass("tokens: capped at 64 KiB keeping the tail");
	}

	// 8. A stale 401 cannot overwrite a newer success.
	{
		let s = withToken();
		s = reduce(s, { type: "runs.loadStart", stamp: 1 });
		s = reduce(s, { type: "runs.loadStart", stamp: 2 });
		s = reduce(s, { type: "runs.loadOk", stamp: 2, at: 2000, runs: [{ id: "r1", title: "ok", state: "done", createdAt: 1000 }] });
		s = reduce(s, { type: "runs.loadErr", stamp: 1, error: "auth failed", status: 401 });
		assert.equal(s.runs.load.status, "ready");
		assert.equal(s.runs.load.error, null);
		assert.ok(s.runs.byId.r1);
		assert.equal(s.auth.status, "hasToken");
		pass("race: a stale 401 cannot overwrite a newer success");
	}

	// 9. No REST before a token, and a success clears an earlier error.
	{
		let s = initialState();
		assert.equal(selectCanFetch(s), false);
		s = reduce(s, { type: "auth.boot", token: "" });
		assert.equal(selectCanFetch(s), false);
		s = reduce(s, { type: "auth.boot", token: "t" });
		assert.equal(selectCanFetch(s), true);
		s = reduce(s, { type: "runs.loadStart", stamp: 1 });
		s = reduce(s, { type: "runs.loadErr", stamp: 1, error: "runs failed 500", status: 500 });
		assert.equal(s.runs.load.error, "runs failed 500");
		s = reduce(s, { type: "runs.loadStart", stamp: 2 });
		s = reduce(s, { type: "runs.loadOk", stamp: 2, at: 3000, runs: [] });
		assert.equal(s.runs.load.status, "ready");
		assert.equal(s.runs.load.error, null);
		pass("auth: no REST without a token; success clears the error");
	}

	// 10. Only the api module knows server field names.
	{
		const ev = api.normaliseEvent({ id: "tool-1", run_id: "r1", tool: "shell", args_hash: "abc123def", result_ref: "request", created_at: 5 });
		assert.deepEqual(ev, { id: "tool-1", runId: "r1", tool: "shell", argsHash: "abc123def", resultRef: "request", createdAt: 5 });
		// run rows are already camelCase (mapRun); tool_event rows are snake_case.
		const run = api.normaliseRun({ id: "r1", title: "t", prompt: "p", state: "done", attempt: 2, createdAt: 1, updatedAt: 2 });
		assert.equal(run.createdAt, 1);
		assert.equal(run.updatedAt, 2);
		pass("api: snake_case rows normalise once, in api.js");
	}

	// 11. Approvals cover queued and waiting_tool (approve also accepts queued).
	{
		let s = withToken();
		s = reduce(s, { type: "run.upsert", run: { id: "q", state: "queued", createdAt: 1000, updatedAt: 1000 } });
		s = reduce(s, { type: "run.upsert", run: { id: "w", state: "waiting_tool", createdAt: 2000, updatedAt: 2000 } });
		s = reduce(s, { type: "run.upsert", run: { id: "d", state: "done", createdAt: 3000, updatedAt: 3000 } });
		assert.deepEqual(
			selectApprovals(s).map((run) => run.id),
			["w", "q"],
		);
		assert.equal(selectActivity(s).length, 3);
		pass("approvals: queued and waiting_tool are the attention queue");
	}

	console.log("PASS web state (" + passed + " checks)");
}

main().catch((err) => {
	console.error("FAIL web state: " + (err && err.message ? err.message : String(err)));
	if (err && err.stack) console.error(err.stack.split("\n").slice(0, 6).join("\n"));
	process.exit(1);
});
