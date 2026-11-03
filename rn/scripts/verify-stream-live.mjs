// Live end-to-end check of rn/src/api/client.ts + rn/src/api/stream.ts against a
// real zot daemon (src/daemon2.js). Boots the daemon on an isolated PORT + ZOT_DB,
// then proves: pair-confirm -> list -> stream live -> reconnect with the saved
// since cursor -> replay from since=0 -> 15s heartbeat -> bad token rejected ->
// a completed run over the live socket. Always kills the daemon.
//
// Node runs the TS modules directly (type stripping). Transport and socket stay
// injectable in the modules, so this exercises the same code the app ships.
//
// The stream is plain ws:// because the daemon is a LAN local-first service paired
// over http (ios/Info.plist ATS exceptions) and the browser client does the same
// (web/app.js:238 maps https -> wss, http -> ws). Not a TLS downgrade.
//
// Completed runs are covered over the live socket too. src/stream.js now writes
// the 4-byte extended-length header correctly (fixed at ebe24f0), so a run.token
// frame (>=126 bytes serialized) and the following run.done must both arrive
// without aborting the connection. That is Leg 5 below: it used to run detached
// from any stream client while the encoder bug stood.

import assert from "node:assert";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createRun, listRuns, pairConfirm } from "../src/api/client.ts";
import {
	connectStream,
	createMemoryCursorStore,
	HEARTBEAT_MS,
	streamURL,
} from "../src/api/stream.ts";

const PORT = Number(process.env.PORT || 18787);
const HOST = "127.0.0.1:" + PORT;
const BASE = "http://" + HOST;
const TOOL_PROMPT = "tool: shell echo hi";

function sleep(ms) {
	return new Promise(resolve => {
		setTimeout(resolve, ms);
	});
}

async function http(method, route, body, token) {
	const headers = {};
	if (body !== undefined) headers["content-type"] = "application/json";
	if (token) headers.authorization = "Bearer " + token;
	const res = await fetch(BASE + route, {
		method,
		headers,
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	const text = await res.text();
	let json = null;
	try {
		json = text === "" ? null : JSON.parse(text);
	} catch {
		json = null;
	}
	return { status: res.status, json, text };
}

async function waitReady() {
	let last = null;
	for (let i = 0; i < 75; i += 1) {
		try {
			const res = await http("GET", "/healthz");
			last = res.text;
			if (res.status === 200 && res.json && res.json.state === "ready") return;
		} catch {
			// daemon still starting
		}
		await sleep(200);
	}
	throw new Error("daemon never reached ready: " + String(last).slice(0, 200));
}

async function waitFor(condition, timeoutMs, label) {
	const started = Date.now();
	for (;;) {
		if (condition()) return;
		if (Date.now() - started > timeoutMs) {
			throw new Error("timed out waiting for " + label);
		}
		await sleep(50);
	}
}

function eventTypes(events, runId) {
	return events
		.filter(event => runId === undefined || event.runId === runId)
		.map(event => event.type);
}

async function main() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zot-rn-stream-"));
	const dbPath = path.join(dir, "zot.db");
	let child = null;
	let pid = null;
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
		console.log("PASS daemon ready on " + BASE);
		passed += 1;

		const started = await http("POST", "/api/v1/pair/start", {
			label: "rn-stream-live",
			kind: "ios",
		});
		assert.strictEqual(started.status, 200, "pair start status");
		const code = started.json && started.json.code;
		assert.match(code, /^[0-9]{6}$/, "pair code is 6 digits");

		const token = await pairConfirm(HOST, code);
		assert.match(token, /^[0-9a-f]{64}$/, "token is 32-byte hex");
		console.log("PASS pairConfirm minted a 64-hex token (T1 client)");
		passed += 1;

		const empty = await listRuns(HOST, token);
		assert.deepStrictEqual(empty, [], "fresh daemon has no runs");
		console.log("PASS listRuns returns [] with Bearer auth");
		passed += 1;

		assert.strictEqual(HEARTBEAT_MS, 15000, "client heartbeat matches server");
		assert.strictEqual(
			streamURL("192.168.68.56:8787", "tok", "12"),
			"ws://192.168.68.56:8787/api/v1/stream?token=tok&since=12",
		);
		console.log("PASS streamURL builds the documented ws URL");
		passed += 1;

		// Leg 1: live stream. Connect first, then create a run so its events
		// must cross the socket (nothing is replayed here).
		const cursor = createMemoryCursorStore();
		const live = [];
		const liveStatuses = [];
		const liveHandle = connectStream(HOST, token, {
			cursorStore: cursor,
			onEvent: event => live.push(event),
			onStatus: status => liveStatuses.push(status),
		});
		let firstToolRun = null;
		try {
			await liveHandle.start();
			await waitFor(() => liveStatuses.includes("live"), 5000, "stream live");
			firstToolRun = await createRun(HOST, token, {
				title: "rn live tool run",
				prompt: TOOL_PROMPT,
			});
			await waitFor(
				() => eventTypes(live, firstToolRun.id).includes("tool.request"),
				10000,
				"live tool.request for " + firstToolRun.id,
			);
			assert.ok(
				eventTypes(live, firstToolRun.id).includes("run.state"),
				"live run.state arrived",
			);
			const saved = await cursor.load();
			assert.ok(saved !== null && saved !== "", "cursor persisted");
			console.log(
				"PASS live stream delivered " +
					eventTypes(live, firstToolRun.id).join(",") +
					" (cursor " +
					saved +
					")",
			);
			passed += 1;
		} finally {
			liveHandle.stop();
		}

		const savedCursor = await cursor.load();
		const waiting = await listRuns(HOST, token);
		const firstState =
			(waiting.find(run => run.id === firstToolRun.id) || {}).state || "";
		assert.strictEqual(firstState, "waiting_tool", "tool run waits for approval");
		console.log("PASS listRuns agrees the run is waiting_tool");
		passed += 1;

		// Leg 2: resume from the persisted cursor; nothing stale replays and a
		// new run still arrives live.
		const resumed = [];
		const resumeHandle = connectStream(HOST, token, {
			cursorStore: createMemoryCursorStore(savedCursor),
			onEvent: event => resumed.push(event),
		});
		try {
			await resumeHandle.start();
			await sleep(400);
			assert.deepStrictEqual(
				eventTypes(resumed),
				[],
				"resume from cursor replayed nothing",
			);
			const secondRun = await createRun(HOST, token, {
				title: "rn resumed run",
				prompt: TOOL_PROMPT,
			});
			await waitFor(
				() => eventTypes(resumed, secondRun.id).includes("run.state"),
				10000,
				"live run.state for " + secondRun.id,
			);
			assert.ok(
				!resumed.some(event => event.runId === firstToolRun.id),
				"resumed stream did not replay the first run",
			);
			console.log(
				"PASS resume from since=" +
					savedCursor +
					" delivered live run.state for " +
					secondRun.id,
			);
			passed += 1;
		} finally {
			resumeHandle.stop();
		}

		// Leg 3: replay from since=0 over the recorded events, plus one full
		// 15s heartbeat window to prove the cadence and the watchdog tolerance.
		const replayed = [];
		const heartbeatCursor = createMemoryCursorStore("0");
		const replayHandle = connectStream(HOST, token, {
			cursorStore: heartbeatCursor,
			onEvent: event => replayed.push(event),
		});
		try {
			await replayHandle.start();
			await waitFor(
				() => eventTypes(replayed, firstToolRun.id).includes("tool.request"),
				10000,
				"replayed events for " + firstToolRun.id,
			);
			assert.ok(
				eventTypes(replayed, firstToolRun.id).includes("run.state"),
				"replay carried run.state",
			);
			console.log(
				"PASS replay from since=0 delivered " +
					eventTypes(replayed, firstToolRun.id).join(","),
			);
			passed += 1;

			const before = replayed.length;
			await waitFor(
				() =>
					replayed
						.slice(before)
						.some(event => event.type === "daemon.heartbeat"),
				HEARTBEAT_MS + 8000,
				"a daemon.heartbeat frame",
			);
			assert.strictEqual(replayHandle.status(), "live", "stream still live");
			assert.deepStrictEqual(
				eventTypes(replayed).filter(type => type === "daemon.heartbeat"),
				["daemon.heartbeat"],
				"exactly one heartbeat inside one window",
			);
			console.log(
				"PASS 15s heartbeat frame arrived and the socket stayed live",
			);
			passed += 1;
		} finally {
			replayHandle.stop();
		}

		// Leg 4: the daemon rejects a token that is not paired.
		const badStatuses = [];
		const badEvents = [];
		const badHandle = connectStream(HOST, "0".repeat(64), {
			cursorStore: createMemoryCursorStore(),
			onEvent: event => badEvents.push(event),
			onStatus: status => badStatuses.push(status),
			reconnectMinMs: 50,
		});
		try {
			await badHandle.start();
			await waitFor(
				() => badStatuses.includes("reconnecting"),
				5000,
				"the daemon to reject the bad token",
			);
			assert.deepStrictEqual(badEvents, [], "no events without auth");
			assert.ok(!badStatuses.includes("live"), "bad token never went live");
			console.log("PASS unpaired token rejected (401): never live, no events");
			passed += 1;
		} finally {
			badHandle.stop();
		}

		// Leg 5: a plain run completes while a live stream client is attached.
		// run.token serializes to >=126 bytes, which is the extended-length frame
		// the encoder used to corrupt; the socket must survive it and run.done.
		const doneEvents = [];
		const doneCursor = createMemoryCursorStore();
		const doneHandle = connectStream(HOST, token, {
			cursorStore: doneCursor,
			onEvent: event => doneEvents.push(event),
		});
		let created = null;
		try {
			await doneHandle.start();
			await waitFor(
				() => doneHandle.status() === "live",
				5000,
				"stream live for the completion run",
			);
			created = await createRun(HOST, token, {
				title: "rn stream verify",
				prompt: "hello from the rn stream tracer",
			});
			await waitFor(
				() => eventTypes(doneEvents, created.id).includes("run.done"),
				15000,
				"live run.done for " + created.id,
			);
			const doneTypes = eventTypes(doneEvents, created.id);
			assert.ok(doneTypes.includes("run.state"), "live run.state arrived");
			assert.ok(doneTypes.includes("run.token"), "run.token frame arrived");
			const tokenEvent = doneEvents.find(
				event => event.runId === created.id && event.type === "run.token",
			);
			assert.ok(tokenEvent, "run.token event carries the run id");
			assert.strictEqual(
				typeof tokenEvent.token,
				"string",
				"run.token carries text",
			);
			const frameBytes = JSON.stringify(tokenEvent).length;
			assert.ok(
				frameBytes >= 126,
				"run.token exercised the extended-length header (" +
					frameBytes +
					" bytes)",
			);
			assert.strictEqual(
				doneHandle.status(),
				"live",
				"socket survived the completed run",
			);
			const doneCursorValue = await doneCursor.load();
			assert.ok(
				doneCursorValue !== null && doneCursorValue !== "",
				"completion cursor persisted",
			);
			console.log(
				"PASS live stream carried a completed run: " +
					doneTypes.join(",") +
					" (run.token frame " +
					frameBytes +
					" bytes)",
			);
			passed += 1;
		} finally {
			doneHandle.stop();
		}

		// T1 write path agrees on the same daemon, and every run is listed.
		const runs = await listRuns(HOST, token);
		const createdRow = runs.find(run => run.id === created.id);
		assert.strictEqual(
			createdRow ? createdRow.state : "missing",
			"done",
			"created run reached done",
		);
		assert.ok(runs.length >= 3, "list shows every run");
		console.log(
			"PASS createRun -> listRuns: " +
				runs.length +
				" runs, " +
				created.id +
				" is done",
		);
		passed += 1;

		console.log("ALL PASS (" + passed + " checks) against live daemon " + BASE);
	} finally {
		if (pid) {
			try {
				process.kill(pid, "SIGTERM");
			} catch {
				// already gone
			}
		}
		if (child) {
			await new Promise(resolve => {
				const timer = setTimeout(resolve, 2000);
				timer.unref();
				child.on("exit", () => {
					clearTimeout(timer);
					resolve();
				});
			});
		}
		fs.rmSync(dir, { recursive: true, force: true });
	}
}

main().catch(err => {
	console.error(err && err.message ? err.message : String(err));
	process.exitCode = 1;
});
