"use strict";

const assert = require("node:assert");
const { EventEmitter } = require("node:events");
const voice = require("../src/voice");
const runs = require("../src/runs");
const api = require("../src/api");
const auth = require("../src/auth");
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
		assert.strictEqual(handled, true, "voice path is handled");
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

async function main() {
	const parsed = voice.parseVoiceTranscript("  zot start my run  ");
	assert.strictEqual(parsed.ok, true, "plain text parses");
	assert.strictEqual(
		parsed.transcript.text,
		"zot start my run",
		"text is trimmed",
	);
	assert.strictEqual(
		parsed.transcript.deviceId,
		null,
		"device defaults to null",
	);
	assert.strictEqual(parsed.transcript.lang, "en", "lang defaults to en");
	console.log("PASS parse keeps trimmed text plus defaults");

	const empty = voice.parseVoiceTranscript("   ");
	assert.strictEqual(empty.ok, false, "blank text fails");
	assert.strictEqual(empty.reason, "empty-text", "blank names empty text");
	console.log("PASS parse rejects blank text");

	assert.strictEqual(
		voice.matchWakeWord("Hey ZOT run this", "zot"),
		true,
		"match ignores case",
	);
	assert.strictEqual(
		voice.matchWakeWord("hello there", "zot"),
		false,
		"miss returns false",
	);
	console.log("PASS wake match is case insensitive");

	const before = voice.getVoiceState().hits;
	assert.strictEqual(voice.onTranscript("zot go", "zot"), true, "wake hits");
	assert.strictEqual(
		voice.getVoiceState().hits,
		before + 1,
		"hit count grows by one",
	);
	console.log("PASS onTranscript counts one hit");

	assert.strictEqual(
		voice.commandFromTranscript("zot start my run", "zot"),
		"start my run",
		"command strips wake word",
	);
	assert.strictEqual(
		voice.commandFromTranscript("hello there", "zot"),
		"hello there",
		"command keeps miss text",
	);
	console.log("PASS command strips wake word once");

	const runInput = voice.toVoiceRunInput(
		{ text: "zot build the report", deviceId: "dev1" },
		{ wakeWord: "zot" },
	);
	assert.strictEqual(
		runInput.prompt,
		"build the report",
		"run prompt holds command",
	);
	assert.strictEqual(
		runInput.title,
		"build the report",
		"run title holds command",
	);
	assert.strictEqual(runInput.ownerDeviceId, "dev1", "run keeps device id");
	console.log("PASS run input feeds title prompt device");

	const fed = voice.ingestVoiceTranscript("zot build the report", {
		wakeWord: "zot",
	});
	assert.strictEqual(fed.ok, true, "ingest parses");
	assert.strictEqual(fed.hit, true, "ingest hits on wake word");
	assert.strictEqual(
		fed.runInput.prompt,
		"build the report",
		"ingest builds prompt",
	);
	const run = runs.createRun({
		id: "voice-run-1",
		title: fed.runInput.title,
		prompt: fed.runInput.prompt,
		ownerDeviceId: fed.runInput.ownerDeviceId,
	});
	assert.strictEqual(run.state, "queued", "voice run starts queued");
	assert.strictEqual(run.prompt, "build the report", "voice run keeps prompt");
	console.log("PASS ingest hit creates queued run");

	const miss = voice.ingestVoiceTranscript("hello there", { wakeWord: "zot" });
	assert.strictEqual(miss.ok, true, "miss parses");
	assert.strictEqual(miss.hit, false, "miss names no hit");
	assert.strictEqual(miss.runInput, null, "miss builds no run");
	console.log("PASS ingest miss builds no run");

	assert.ok(
		typeof voice.MIC_NOTE === "string" && voice.MIC_NOTE.length > 0,
		"mic note exists",
	);
	assert.ok(voice.MIC_NOTE.toLowerCase().includes("mic"), "mic note names mic");
	console.log("PASS mic stub names mic testing");

	const seeded = seedDb();
	const handler = api.createHandler(seeded.db);
	const unauthed = await callApi(handler, {
		method: "POST",
		path: "/api/v1/voice/ingest",
		body: { text: "zot build the report" },
	});
	assert.strictEqual(unauthed.status, 401, "missing token is rejected");
	console.log("PASS voice route needs auth");

	const bad = await callApi(handler, {
		method: "POST",
		path: "/api/v1/voice/ingest",
		token: seeded.token,
		body: { text: "   " },
	});
	assert.strictEqual(bad.status, 400, "blank voice text fails");
	console.log("PASS voice route rejects blank text");

	const countBefore = seeded.db
		.prepare("SELECT COUNT(*) AS n FROM agent_run")
		.get().n;
	const missRes = await callApi(handler, {
		method: "POST",
		path: "/api/v1/voice/ingest",
		token: seeded.token,
		body: { text: "hello there" },
	});
	assert.strictEqual(missRes.status, 200, "wake miss returns 200");
	assert.strictEqual(missRes.body.hit, false, "wake miss names hit false");
	assert.strictEqual(
		missRes.body.transcript.text,
		"hello there",
		"wake miss echoes transcript",
	);
	const countAfterMiss = seeded.db
		.prepare("SELECT COUNT(*) AS n FROM agent_run")
		.get().n;
	assert.strictEqual(countAfterMiss, countBefore, "wake miss creates no run");
	console.log("PASS voice miss returns hit false with no run");

	const hitRes = await callApi(handler, {
		method: "POST",
		path: "/api/v1/voice/ingest",
		token: seeded.token,
		body: { text: "zot build the report", deviceId: "dev1" },
	});
	assert.strictEqual(hitRes.status, 201, "wake hit returns 201");
	assert.strictEqual(hitRes.body.hit, true, "wake hit names hit true");
	assert.strictEqual(
		hitRes.body.run.state,
		"queued",
		"voice run returns queued state",
	);
	assert.strictEqual(
		hitRes.body.run.prompt,
		"build the report",
		"voice run strips wake word",
	);
	assert.strictEqual(
		hitRes.body.run.ownerDeviceId,
		"dev1",
		"voice run keeps device id",
	);
	const stored = seeded.db
		.prepare("SELECT * FROM agent_run WHERE id = ?")
		.get(hitRes.body.run.id);
	assert.ok(stored, "voice run is stored");
	assert.strictEqual(stored.state, "queued", "stored run is queued");
	console.log("PASS voice hit queues run with stripped prompt");

	const fallbackRes = await callApi(handler, {
		method: "POST",
		path: "/api/v1/voice/ingest",
		token: seeded.token,
		body: { text: "zot go" },
	});
	assert.strictEqual(fallbackRes.status, 201, "fallback hit returns 201");
	assert.strictEqual(
		fallbackRes.body.run.ownerDeviceId,
		"dev1",
		"missing device falls back to session",
	);
	console.log("PASS voice hit defaults owner to session");

	const limited = seedDb();
	const limitedHandler = api.createHandler(limited.db);
	let last = null;
	for (let i = 0; i < 35; i += 1) {
		last = await callApi(limitedHandler, {
			method: "POST",
			path: "/api/v1/voice/ingest",
			token: limited.token,
			body: { text: "hello there" },
		});
	}
	assert.strictEqual(last.status, 429, "burst over limit is rejected");
	console.log("PASS voice route rate limits burst traffic");

	seeded.db.close();
	limited.db.close();
}

main().catch((err) => {
	console.error(err && err.message ? err.message : String(err));
	process.exit(1);
});
