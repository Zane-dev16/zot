"use strict";
const assert = require("node:assert");
const fs = require("node:fs");
const http = require("node:http");
const { EventEmitter } = require("node:events");
const api = require("../src/api");
const auth = require("../src/auth");
const daemon2 = require("../src/daemon2");
const runner = require("../src/runner");
const scheduler = require("../src/scheduler");
const { openDb } = require("../src/db");

function callApi(handler, opts) {
	return new Promise((resolve, reject) => {
		const req = new EventEmitter();
		req.method = opts.method;
		req.url = opts.path;
		req.headers = {};
		if (opts.token) req.headers.authorization = "Bearer " + opts.token;
		const res = {
			status: 0,
			writeHead(status) {
				this.status = status;
			},
			end(data) {
				try {
					resolve({
						status: this.status,
						body: data ? JSON.parse(data) : null,
					});
				} catch (e) {
					reject(e);
				}
			},
		};
		let handled = false;
		try {
			handled = handler(req, res);
		} catch (e) {
			reject(e);
			return;
		}
		assert.strictEqual(handled, true, "job path is handled");
		const payload = opts.body === undefined ? null : JSON.stringify(opts.body);
		setImmediate(() => {
			if (payload === null) req.emit("end");
			else {
				req.emit("data", Buffer.from(payload));
				req.emit("end");
			}
		});
	});
}

function seedDb() {
	const db = openDb(":memory:");
	const token = auth.generateToken();
	const now = Date.now();
	db.prepare(
		"INSERT INTO device_session(id, label, kind, token_hash, created_at, last_seen_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?, NULL)",
	).run("dev1", "test device", "ios", auth.hashToken(token), now, now);
	return { db, token };
}

function getHealth(port) {
	return new Promise((resolve, reject) => {
		http
			.get(
				{ host: "127.0.0.1", port, path: "/healthz", timeout: 2000 },
				(res) => {
					let data = "";
					res.on("data", (c) => {
						data += c;
					});
					res.on("end", () => resolve({ status: res.statusCode, body: data }));
				},
			)
			.on("error", reject);
	});
}

async function main() {
	assert.throws(() => scheduler.parseCron("bad cron"), "bad cron throws");
	console.log("PASS parseCron rejects bad cron text");

	const seeded = seedDb();
	const handler = api.createHandler(seeded.db);

	const bad = await callApi(handler, {
		method: "POST",
		path: "/api/v1/jobs",
		token: seeded.token,
		body: { name: "bad", cron: "bad cron", prompt: "hi" },
	});
	assert.strictEqual(bad.status, 400, "bad cron create fails");
	assert.strictEqual(
		bad.body.error,
		"bad cron expression",
		"bad cron names reason",
	);
	const stored = seeded.db
		.prepare("SELECT COUNT(*) AS n FROM scheduler_job")
		.get().n;
	assert.strictEqual(stored, 0, "bad cron stores no row");
	console.log("PASS POST jobs rejects bad cron with no stored row");

	const good = await callApi(handler, {
		method: "POST",
		path: "/api/v1/jobs",
		token: seeded.token,
		body: { name: "nightly", cron: "* * * * *", prompt: "run report" },
	});
	assert.strictEqual(good.status, 201, "good cron creates job");
	assert.ok(
		Number.isFinite(good.body.job.nextRunAt),
		"next run is a timestamp",
	);
	assert.ok(good.body.job.nextRunAt > Date.now(), "next run is in the future");
	assert.strictEqual(good.body.job.runCount, 0, "new job has empty history");
	console.log("PASS POST jobs stores good cron with future next run");

	const jobId = good.body.job.id;
	const patchBad = await callApi(handler, {
		method: "PATCH",
		path: "/api/v1/jobs/" + jobId,
		token: seeded.token,
		body: { cron: "nope" },
	});
	assert.strictEqual(patchBad.status, 400, "bad cron patch fails");
	const kept = seeded.db
		.prepare("SELECT cron FROM scheduler_job WHERE id = ?")
		.get(jobId);
	assert.strictEqual(kept.cron, "* * * * *", "failed patch keeps old cron");
	console.log("PASS PATCH jobs rejects bad cron and keeps old value");

	const before = seeded.db
		.prepare("SELECT next_run_at FROM scheduler_job WHERE id = ?")
		.get(jobId).next_run_at;
	const patchOk = await callApi(handler, {
		method: "PATCH",
		path: "/api/v1/jobs/" + jobId,
		token: seeded.token,
		body: { cron: "0 0 1 1 *" },
	});
	assert.strictEqual(patchOk.status, 200, "good cron patch applies");
	assert.strictEqual(patchOk.body.job.cron, "0 0 1 1 *", "patch swaps cron");
	assert.ok(patchOk.body.job.nextRunAt > Date.now(), "recomputed run is future");
	assert.notStrictEqual(
		patchOk.body.job.nextRunAt,
		before,
		"patch recomputes next run",
	);
	console.log("PASS PATCH jobs swaps cron and recomputes next run");

	seeded.db
		.prepare("UPDATE scheduler_job SET next_run_at = ? WHERE id = ?")
		.run(Date.now() - 1000, jobId);
	const seen = [];
	const created = runner.tickScheduler(seeded.db, {
		now: Date.now(),
		publish: (type, data) => seen.push({ type, data }),
	});
	assert.strictEqual(created.length, 1, "due job fires once");
	const job = seeded.db
		.prepare("SELECT * FROM scheduler_job WHERE id = ?")
		.get(jobId);
	assert.ok(job.next_run_at > Date.now(), "fired job advances next run");
	assert.strictEqual(job.last_run_id, created[0], "fired job links run");
	const hist = seeded.db
		.prepare("SELECT * FROM scheduler_run WHERE job_id = ?")
		.all(jobId);
	assert.strictEqual(hist.length, 1, "fired job writes one history row");
	assert.strictEqual(hist[0].run_id, created[0], "history links the run");
	assert.ok(
		seen.some((e) => e.type === "run.created"),
		"fire publishes run dot created",
	);
	console.log(
		"PASS tickScheduler fires due job once with history row and event",
	);

	const second = runner.tickScheduler(seeded.db, { now: Date.now() });
	assert.strictEqual(second.length, 0, "advanced job does not refire");
	const hist2 = seeded.db
		.prepare("SELECT COUNT(*) AS n FROM scheduler_run WHERE job_id = ?")
		.get(jobId).n;
	assert.strictEqual(hist2, 1, "no refire writes no extra history");
	console.log("PASS tickScheduler does not refire before next run");

	const list = await callApi(handler, {
		method: "GET",
		path: "/api/v1/jobs",
		token: seeded.token,
	});
	assert.strictEqual(list.status, 200, "job list returns 200");
	const listed = list.body.jobs.find((j) => j.id === jobId);
	assert.strictEqual(listed.runCount, 1, "job list carries run count");
	assert.strictEqual(
		listed.recentRuns.length,
		1,
		"job list carries recent runs",
	);
	console.log("PASS GET jobs carries run count plus recent runs");

	const runnerSrc = fs.readFileSync(require.resolve("../src/runner"), "utf8");
	assert.ok(
		runnerSrc.includes("scheduler.tickJobs"),
		"runner routes through tickJobs",
	);
	console.log("PASS runner routes scheduler tick through tickJobs");

	const daemonSrc = fs.readFileSync(require.resolve("../src/daemon2"), "utf8");
	assert.ok(daemonSrc.includes("stream.attach"), "daemon boot attaches stream");
	assert.ok(
		daemonSrc.includes("runner.tickScheduler"),
		"daemon boot ticks scheduler",
	);
	console.log("PASS daemon2 boot wires stream attach plus scheduler tick");

	const live = daemon2.boot({ dbPath: ":memory:", port: 0, listen: true });
	await new Promise((resolve) => live.server.on("listening", resolve));
	const port = live.server.address().port;
	let health = null;
	for (let i = 0; i < 25; i += 1) {
		try {
			health = await getHealth(port);
			if (health.status === 200) break;
		} catch {
			await new Promise((r) => setTimeout(r, 100));
		}
	}
	assert.ok(health && health.status === 200, "live boot serves healthz");
	assert.ok(health.body.includes('"state":"ready"'), "live boot reaches ready");
	assert.ok(
		live.stream && live.stream.path === "/api/v1/stream",
		"live boot holds stream",
	);
	console.log(
		"PASS live daemon boot serves healthz ready with stream attached",
	);
	live.stream.close();
	live.server.close();
	live.db.close();

	seeded.db.close();
}

main().catch((err) => {
	console.error(err && err.stack ? err.stack : String(err));
	process.exit(1);
});
