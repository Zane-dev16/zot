// Live end-to-end check of rn/src/api/client.ts against a real zot daemon.
// Boots the daemon on an isolated PORT + ZOT_DB, then proves:
// pair -> persist token -> list -> create -> unpair. Always kills the daemon.

import assert from "node:assert";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

import {
	createMemoryTokenStore,
	createRun,
	listRuns,
	pairConfirm,
} from "../src/api/client.ts";

const PORT = Number(process.env.PORT || 18922);
const HOST = "127.0.0.1:" + PORT;

function req(method, urlPath, body) {
	return new Promise((resolve, reject) => {
		const payload = body === undefined ? null : JSON.stringify(body);
		const headers = {};
		if (payload !== null) {
			headers["content-type"] = "application/json";
			headers["content-length"] = Buffer.byteLength(payload);
		}
		const r = http.request(
			{ host: "127.0.0.1", port: PORT, path: urlPath, method, headers, timeout: 5000 },
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

async function waitReady() {
	let last = null;
	for (let i = 0; i < 75; i += 1) {
		try {
			const r = await req("GET", "/healthz");
			last = r.text;
			if (r.status === 200 && r.json && r.json.state === "ready") return;
		} catch {}
		await new Promise((r) => setTimeout(r, 200));
	}
	throw new Error("daemon never reached ready: " + String(last).slice(0, 200));
}

async function main() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zot-rn-live-"));
	const dbPath = path.join(dir, "zot.db");
	let pid = null;
	let child = null;
	let passed = 0;
	try {
		child = spawn(
			process.execPath,
			[path.join(import.meta.dirname, "..", "..", "src", "daemon2.js")],
			{
				env: { ...process.env, PORT: String(PORT), ZOT_DB: dbPath },
				stdio: "ignore",
			},
		);
		pid = child.pid;
		child.on("error", () => {});
		await waitReady();
		console.log("PASS daemon ready on " + HOST);
		passed += 1;

		const started = await req("POST", "/api/v1/pair/start", {
			label: "rn-live",
			kind: "ios",
		});
		assert.strictEqual(started.status, 200, "pair start status");
		const code = started.json && started.json.code;
		assert.match(code, /^[0-9]{6}$/, "pair code is 6 digits");
		console.log("PASS pair start returns a 6-digit code (" + code + ")");
		passed += 1;

		// Bare host on purpose: the client must normalize it to http://.
		const token = await pairConfirm(HOST, code);
		assert.match(token, /^[0-9a-f]{64}$/, "token is 32-byte hex");
		console.log("PASS pairConfirm minted a 64-hex token with no auth header");
		passed += 1;

		const store = createMemoryTokenStore();
		await store.saveToken(token);
		assert.strictEqual(await store.loadToken(), token, "token round-trips");
		console.log("PASS token round-trips through the token store");
		passed += 1;

		const empty = await listRuns(HOST, token);
		assert.deepStrictEqual(empty, [], "fresh daemon has no runs");
		console.log("PASS listRuns sends Bearer auth and returns []");
		passed += 1;

		const created = await createRun(HOST, token, {
			title: "rn verify",
			prompt: "hello from the rn client",
		});
		assert.strictEqual(typeof created.id, "string", "run id is string");
		assert.strictEqual(created.title, "rn verify", "run title echoed");
		assert.strictEqual(created.prompt, "hello from the rn client", "run prompt echoed");
		assert.strictEqual(typeof created.state, "string", "run has a state");
		console.log("PASS createRun posted {title, prompt} and got run " + created.id);
		passed += 1;

		const runs = await listRuns(HOST, token);
		assert.deepStrictEqual(runs, [created], "list contains exactly the created run");
		console.log("PASS listRuns returns the created run with the AgentRun shape");
		passed += 1;

		await store.deleteToken();
		assert.strictEqual(await store.loadToken(), null, "token cleared");
		console.log("PASS deleteToken clears the token");
		passed += 1;

		console.log(
			"ALL PASS (" + passed + " checks) against live daemon " + HOST,
		);
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
