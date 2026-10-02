"use strict";

const assert = require("node:assert");
const voice = require("../src/voice");
const runs = require("../src/runs");

function main() {
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
}

main();
