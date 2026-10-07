"use strict";
const assert = require("node:assert");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { migrate } = require("../src/db");
const chatops = require("../src/chatops");
const { createHandler } = require("../src/api");
const runner = require("../src/runner");
const runs = require("../src/runs");
const skills = require("../src/skills");

const SKILLS_DIR = path.join(__dirname, "..", "skills");
const SECRET = "live-test-secret-9";

function fakePost(handleApi, urlPath, headers, bodyObj) {
	return new Promise((resolve, reject) => {
		const handlers = {};
		const req = {
			url: urlPath,
			method: "POST",
			headers: headers || {},
			on: (evt, fn) => {
				handlers[evt] = fn;
				return req;
			},
			destroy: () => {},
		};
		const res = {
			status: 0,
			headersSent: false,
			writeHead: (status) => {
				res.status = status;
				res.headersSent = true;
			},
			end: (body) => {
				let json = null;
				try {
					json = JSON.parse(String(body || ""));
				} catch {}
				resolve({ status: res.status, json: json });
			},
		};
		try {
			const handled = handleApi(req, res);
			assert.strictEqual(handled, true);
		} catch (e) {
			reject(e);
			return;
		}
		process.nextTick(() => {
			try {
				if (bodyObj !== undefined) {
					const raw = Buffer.from(JSON.stringify(bodyObj), "utf8");
					handlers.data(raw);
				}
				handlers.end();
			} catch (e) {
				reject(e);
			}
		});
	});
}

async function main() {
	const prev = process.env[chatops.INBOUND_SECRET_ENV];
	process.env[chatops.INBOUND_SECRET_ENV] = SECRET;
	chatops.clearQueue();
	chatops.clearLog();
	try {
		const loaded = skills.loadSkills(SKILLS_DIR);
		const names = loaded.tools.map((t) => t.name).sort();
		assert.ok(names.indexOf("local.echo") !== -1);
		assert.ok(names.indexOf("mcp.ping") !== -1);
		assert.ok(names.indexOf("mcp.echo") !== -1);
		console.log("PASS disk loader finds echo ping and real echo server");
		const def = skills.findTool(loaded.tools, "mcp.echo");
		assert.ok(def && def.mcp && def.mcp.command);
		const allowlist = skills.mcpAllowlist(loaded.tools);
		assert.ok(allowlist.indexOf(def.mcp.command) !== -1);
		const spawned = skills.execSkillToolSync(
			loaded.tools,
			"mcp.echo",
			{ text: "hi" },
			{ allowlist: allowlist, timeoutMs: 3000 },
		);
		assert.strictEqual(spawned.ok, true);
		assert.ok(String(spawned.result).indexOf("echo:") === 0);
		assert.ok(String(spawned.result).indexOf("hi") !== -1);
		console.log("PASS real mcp server spawns and echoes input");

		const db = new DatabaseSync(":memory:");
		db.exec("PRAGMA foreign_keys = ON;");
		migrate(db);
		const id = runner.insertRun(
			db,
			"t",
			'tool: mcp.echo {"text":"hi"}',
			"echo",
			1000,
		);
		const paused = runner.pollOnce(db, { now: 1001 });
		assert.strictEqual(paused.paused, true);
		assert.strictEqual(paused.tool, "mcp.echo");
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
		db.prepare(
			"UPDATE agent_run SET state = ?, updated_at = ? WHERE id = ?",
		).run(next.state, next.updatedAt, id);
		const resumed = runner.pollOnce(db, { now: 1002, mcpTimeoutMs: 3000 });
		assert.strictEqual(resumed.ok, true);
		assert.strictEqual(resumed.tool, "mcp.echo");
		assert.strictEqual(
			db.prepare("SELECT state FROM agent_run WHERE id = ?").get(id).state,
			"done",
		);
		const events = db
			.prepare("SELECT result_ref FROM tool_event WHERE run_id = ?")
			.all(id);
		assert.ok(
			events.some((e) => String(e.result_ref || "").indexOf("echo:") !== -1),
		);
		console.log("PASS runner routes skill tool through allowlist to done");
		db.close();

		const apiDb = new DatabaseSync(":memory:");
		apiDb.exec("PRAGMA foreign_keys = ON;");
		migrate(apiDb);
		const handleApi = createHandler(apiDb);
		const good = await fakePost(
			handleApi,
			"/api/v1/chatops/inbound",
			{ "x-chatops-secret": SECRET },
			{ target: "slack", text: "hello" },
		);
		assert.strictEqual(good.status, 202);
		assert.strictEqual(good.json.ok, true);
		assert.strictEqual(good.json.queued.target, "slack");
		assert.strictEqual(chatops.listQueue().length, 1);
		console.log("PASS inbound route accepts good secret with 202");
		const bad = await fakePost(
			handleApi,
			"/api/v1/chatops/inbound",
			{ "x-chatops-secret": "wrong" },
			{ target: "slack", text: "hello" },
		);
		assert.strictEqual(bad.status, 401);
		assert.strictEqual(chatops.listQueue().length, 1);
		console.log("PASS inbound route rejects bad secret with 401");
		const logged = apiDb.prepare("SELECT COUNT(*) AS n FROM chat_log").get().n;
		assert.ok(logged >= 1);
		console.log("PASS inbound success persists one chat log row");

		const drained = await chatops.drainChatopsQueue(apiDb, {
			sendFn: async () => ({ ok: true, status: 200 }),
		});
		assert.strictEqual(drained.length, 1);
		assert.strictEqual(drained[0].ok, true);
		assert.strictEqual(chatops.listQueue().length, 0);
		const outRows = apiDb
			.prepare("SELECT direction, ok FROM chat_log ORDER BY id DESC LIMIT 1")
			.get();
		assert.strictEqual(outRows.direction, "out");
		assert.strictEqual(outRows.ok, 1);
		console.log("PASS daemon drain sends queue and persists out row");
		apiDb.close();
		console.log("ALL PASS");
	} finally {
		if (prev === undefined) delete process.env[chatops.INBOUND_SECRET_ENV];
		else process.env[chatops.INBOUND_SECRET_ENV] = prev;
		chatops.clearQueue();
		chatops.clearLog();
	}
}

main().catch((err) => {
	console.error(err && err.message ? err.message : String(err));
	process.exit(1);
});
