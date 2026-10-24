"use strict";
const assert = require("node:assert");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const PORT = 18921;

function req(port, method, urlPath, body, token) {
	return new Promise((resolve, reject) => {
		const payload = body === undefined ? null : JSON.stringify(body);
		const headers = {};
		if (payload !== null) {
			headers["content-type"] = "application/json";
			headers["content-length"] = Buffer.byteLength(payload);
		}
		if (token) headers.authorization = "Bearer " + token;
		const r = http.request(
			{ host: "127.0.0.1", port, path: urlPath, method, headers, timeout: 5000 },
			(res) => {
				let data = "";
				res.on("data", (c) => {
					data += c;
				});
				res.on("end", () => {
					let json = null;
					try {
						json = data ? JSON.parse(data) : null;
					} catch {
						json = null;
					}
					resolve({ status: res.statusCode, json, text: data });
				});
			},
		);
		r.on("error", reject);
		r.on("timeout", () => r.destroy(new Error("request timeout")));
		if (payload !== null) r.write(payload);
		r.end();
	});
}

async function waitReady(port) {
	let last = null;
	for (let i = 0; i < 75; i += 1) {
		try {
			const r = await req(port, "GET", "/healthz");
			last = r.text;
			if (r.status === 200 && r.json && r.json.state === "ready") return;
		} catch {}
		await new Promise((r) => setTimeout(r, 200));
	}
	throw new Error("daemon never reached ready: " + String(last).slice(0, 200));
}

async function waitState(port, id, token, want, timeoutMs) {
	const start = Date.now();
	for (;;) {
		const r = await req(port, "GET", "/api/v1/runs/" + id, undefined, token);
		assert.strictEqual(r.status, 200, "run fetch is 200");
		const state = r.json && r.json.run && r.json.run.state;
		if (want.indexOf(state) !== -1) return state;
		if (Date.now() - start > timeoutMs)
			throw new Error("timed out waiting for " + want.join("/") + " got " + state);
		await new Promise((r) => setTimeout(r, 300));
	}
}

async function main() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zot-client-"));
	const dbPath = path.join(dir, "zot.db");
	let pid = null;
	let child = null;
	try {
		child = spawn(process.execPath, [path.join(__dirname, "..", "src", "daemon2.js")], {
			env: { ...process.env, PORT: String(PORT), ZOT_DB: dbPath },
			stdio: "ignore",
		});
		pid = child.pid;
		child.on("error", () => {});
		await waitReady(PORT);

		const started = await req(PORT, "POST", "/api/v1/pair/start", {
			label: "verify",
			kind: "ios",
		});
		assert.strictEqual(started.status, 200, "pair start is 200");
		assert.ok(started.json && typeof started.json.code === "string", "code is string");
		console.log("PASS pair start returns code");

		const confirmed = await req(PORT, "POST", "/api/v1/pair/confirm", {
			code: started.json.code,
		});
		assert.strictEqual(confirmed.status, 201, "pair confirm is 201");
		assert.ok(confirmed.json && typeof confirmed.json.token === "string", "token is string");
		console.log("PASS pair confirm returns token");
		const token = confirmed.json.token;

		const unauth = await req(PORT, "GET", "/api/v1/runs");
		assert.strictEqual(unauth.status, 401, "unauth runs is 401");
		console.log("PASS unauthenticated runs returns 401");

		const list = await req(PORT, "GET", "/api/v1/runs", undefined, token);
		assert.strictEqual(list.status, 200, "auth runs is 200");
		assert.ok(list.json && Array.isArray(list.json.runs), "runs is array");
		console.log("PASS authenticated runs list returns array");

		const created = await req(
			PORT,
			"POST",
			"/api/v1/runs",
			{ title: "hello", prompt: "hello verify" },
			token,
		);
		assert.strictEqual(created.status, 201, "run create is 201");
		const runId = created.json && created.json.run && created.json.run.id;
		assert.ok(typeof runId === "string", "run id is string");
		await waitState(PORT, runId, token, ["done"], 15000);
		console.log("PASS echo run reaches done");

		const events = await req(PORT, "GET", "/api/v1/runs/" + runId + "/events?since=0", undefined, token);
		assert.strictEqual(events.status, 200, "events is 200");
		assert.ok(events.json && Array.isArray(events.json.events), "events is array");
		assert.ok(events.json.events.length >= 1, "at least one event");
		console.log("PASS run events returns at least one event");

		const toolCreated = await req(
			PORT,
			"POST",
			"/api/v1/runs",
			{ title: "tool", prompt: "tool: shell echo hi" },
			token,
		);
		assert.strictEqual(toolCreated.status, 201, "tool run create is 201");
		const toolId = toolCreated.json.run.id;
		await waitState(PORT, toolId, token, ["waiting_tool"], 15000);
		const approved = await req(PORT, "POST", "/api/v1/runs/" + toolId + "/approve", {}, token);
		assert.strictEqual(approved.status, 200, "approve is 200");
		await waitState(PORT, toolId, token, ["done"], 15000);
		console.log("PASS tool run waits then approves to done");

		const badPush = await req(PORT, "POST", "/api/v1/push/tokens", { token: "bad" }, token);
		assert.strictEqual(badPush.status, 400, "bad push token is 400");
		const goodPush = await req(
			PORT,
			"POST",
			"/api/v1/push/tokens",
			{ token: "a".repeat(64), deviceId: "dev-1" },
			token,
		);
		assert.strictEqual(goodPush.status, 201, "good push token is 201");
		console.log("PASS push tokens validates body");

		console.log("ALL PASS");
	} finally {
		if (pid) {
			try {
				process.kill(pid, "SIGTERM");
			} catch {}
		}
		if (child) {
			await new Promise((r) => {
				const t = setTimeout(r, 2000);
				t.unref();
				child.on("exit", () => {
					clearTimeout(t);
					r();
				});
			});
		}
		fs.rmSync(dir, { recursive: true, force: true });
	}
}

main().catch((err) => {
	console.error(err && err.message ? err.message : String(err));
	process.exit(1);
});
