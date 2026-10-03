"use strict";

// Verify approvals gate plus router second provider fallback.
// Run offline. Network is stubbed, never touched.

const assert = require("node:assert");
const { DatabaseSync } = require("node:sqlite");
const { migrate } = require("../src/db");
const runner = require("../src/runner");
const runs = require("../src/runs");
const tools = require("../src/tools");
const router = require("../src/router");

function freshDb() {
	const db = new DatabaseSync(":memory:");
	db.exec("PRAGMA foreign_keys = ON;");
	migrate(db);
	return db;
}

function approveRow(db, id, now) {
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
}

function toolRefs(db, id) {
	return db
		.prepare("SELECT result_ref FROM tool_event WHERE run_id = ?")
		.all(id)
		.map((r) => r.result_ref || "");
}

async function main() {
	const db = freshDb();
	const okId = runner.insertRun(db, "ok", "tool: shell echo hi", "echo", 1000);
	assert.strictEqual(runner.pollOnce(db, { now: 1001 }).paused, true);
	assert.strictEqual(
		db.prepare("SELECT state FROM agent_run WHERE id = ?").get(okId).state,
		"waiting_tool",
		"tool run pauses for approval",
	);
	approveRow(db, okId, 1002);
	const resumed = runner.pollOnce(db, { now: 1003 });
	assert.strictEqual(resumed.ok, true, "approved tool run executes");
	assert.strictEqual(
		db.prepare("SELECT state FROM agent_run WHERE id = ?").get(okId).state,
		"done",
	);
	assert.ok(
		toolRefs(db, okId).some((r) => r.includes("hi")),
		"tool result lands in tool_event",
	);
	console.log("PASS approved shell run reaches done with output logged");

	const denyDirect = tools.execToolSync({ tool: "fetch", args: {} });
	assert.strictEqual(denyDirect.ok, false, "fetch denied off allowlist");
	assert.strictEqual(denyDirect.denied, true, "deny carries denied flag");
	assert.ok(tools.isDenied(denyDirect), "isDenied names the outcome");
	assert.ok(
		tools.denyRef(denyDirect).indexOf("deny:") === 0,
		"deny ref uses deny prefix",
	);
	console.log("PASS off allowlist tool returns flagged deny");

	const netDirect = tools.execToolSync({
		tool: "fetch",
		args: {},
		allowlist: ["fetch"],
	});
	assert.strictEqual(netDirect.denied, true, "network tool needs flag");
	console.log("PASS network tool without flag returns flagged deny");

	const asyncDeny = await tools.executeTool({
		tool: "fetch",
		args: {},
		runId: "r1",
		leaseId: "l1",
		now: 1000,
	});
	assert.strictEqual(asyncDeny.ok, false, "async deny fails closed");
	assert.strictEqual(asyncDeny.denied, true, "async deny keeps flag");
	console.log("PASS async executeTool denies closed with flag");

	const denyId = runner.insertRun(
		db,
		"deny",
		'tool: fetch {"url": "https://example.com"}',
		"echo",
		2000,
	);
	assert.strictEqual(runner.pollOnce(db, { now: 2001 }).paused, true);
	approveRow(db, denyId, 2002);
	const deniedRun = runner.pollOnce(db, { now: 2003 });
	assert.strictEqual(deniedRun.ok, false, "denied tool run does not succeed");
	assert.strictEqual(
		db.prepare("SELECT state FROM agent_run WHERE id = ?").get(denyId).state,
		"failed",
	);
	assert.ok(
		toolRefs(db, denyId).some((r) => r.indexOf("deny:") === 0),
		"deny lands in tool_event with deny prefix",
	);
	console.log("PASS approved deny run fails with deny log");

	assert.deepStrictEqual(router.fallbackOrder("openai-mini"), [
		"openai-mini",
		"anthropic-mini",
	]);
	assert.deepStrictEqual(router.fallbackOrder("anthropic-mini"), [
		"anthropic-mini",
		"openai-mini",
	]);
	assert.strictEqual(router.providerKeyEnv("openai"), "OPENAI_API_KEY");
	assert.strictEqual(router.providerKeyEnv("anthropic"), "ANTHROPIC_API_KEY");
	console.log("PASS fallback order tries requested provider first");

	const savedOpenai = process.env.OPENAI_API_KEY;
	const savedAnthropic = process.env.ANTHROPIC_API_KEY;
	const savedFetch = globalThis.fetch;
	delete process.env.OPENAI_API_KEY;
	delete process.env.ANTHROPIC_API_KEY;
	try {
		assert.strictEqual(router.isLiveConfigured(), false);
		assert.strictEqual(router.isLiveConfigured("openai-mini"), false);
		assert.strictEqual(router.isLiveConfigured("anthropic-mini"), false);
		const off1 = await router.execAsync("openai-mini", "hi fallback");
		assert.strictEqual(off1.model, "openai-mini", "offline keeps openai id");
		assert.strictEqual(off1.text, "echo[openai-mini]: hi fallback");
		const off2 = await router.execAsync("anthropic-mini", "hi fallback");
		assert.strictEqual(
			off2.model,
			"anthropic-mini",
			"offline keeps anthropic id",
		);
		console.log("PASS offline both providers fall back to echo");
		process.env.OPENAI_API_KEY = "fake-openai";
		process.env.ANTHROPIC_API_KEY = "fake-anthropic";
		assert.strictEqual(router.isLiveConfigured(), true);
		globalThis.fetch = async (url) => {
			if (String(url).includes("api.openai.com"))
				throw new Error("openai down");
			return {
				ok: true,
				json: async () => ({ content: [{ text: "stub-hi" }] }),
			};
		};
		const fb = await router.execAsync("openai-mini", "hi route");
		assert.strictEqual(
			fb.model,
			"anthropic-mini",
			"dead primary routes to second",
		);
		assert.strictEqual(fb.text, "stub-hi", "second provider text wins");
		console.log("PASS dead primary falls through to second provider");
	} finally {
		if (savedOpenai == null) delete process.env.OPENAI_API_KEY;
		else process.env.OPENAI_API_KEY = savedOpenai;
		if (savedAnthropic == null) delete process.env.ANTHROPIC_API_KEY;
		else process.env.ANTHROPIC_API_KEY = savedAnthropic;
		globalThis.fetch = savedFetch;
	}
	console.log("ALL PASS");
}

main().catch((err) => {
	console.error(err && err.message ? err.message : String(err));
	process.exit(1);
});
