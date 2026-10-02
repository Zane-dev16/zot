"use strict";

// Wake word interface.
// Data shape is WakeConfig plus VoiceTranscript.
// VoiceTranscript holds text plus deviceId plus at plus lang.

const state = { listening: false, wakeWord: "zot", hits: 0 };

const MAX_TEXT_LEN = 2000;

const MIC_NOTE =
	"No mic source is wired. Type one phrase on the test device and paste it as text.";

function startListening(config) {
	const c = config || {};
	state.listening = true;
	if (c.wakeWord) state.wakeWord = c.wakeWord;
	return {
		listening: state.listening,
		wakeWord: state.wakeWord,
		hits: state.hits,
	};
}

function stopListening() {
	state.listening = false;
	return {
		listening: state.listening,
		wakeWord: state.wakeWord,
		hits: state.hits,
	};
}

function normText(v) {
	return typeof v === "string" ? v.trim() : "";
}

// Pure wake check with no state change.
function matchWakeWord(text, wakeWord) {
	const w = wakeWord || state.wakeWord;
	if (typeof text !== "string") return false;
	if (!w) return false;
	return text.toLowerCase().indexOf(String(w).toLowerCase()) !== -1;
}

// Stateful wake check. Counts one hit per match.
function onTranscript(text, wakeWord) {
	const hit = matchWakeWord(text, wakeWord);
	if (hit) state.hits += 1;
	return hit;
}

function parseVoiceTranscript(input) {
	const src = typeof input === "string" ? { text: input } : input;
	if (!src || typeof src !== "object")
		return { ok: false, reason: "bad-input" };
	const text = normText(src.text);
	if (!text) return { ok: false, reason: "empty-text" };
	if (text.length > MAX_TEXT_LEN) return { ok: false, reason: "text-too-long" };
	let deviceId = null;
	if (src.deviceId !== undefined && src.deviceId !== null) {
		if (typeof src.deviceId !== "string" || !src.deviceId.trim()) {
			return { ok: false, reason: "bad-device-id" };
		}
		deviceId = src.deviceId.trim();
	}
	let at = Date.now();
	if (src.at !== undefined && src.at !== null) {
		if (!Number.isFinite(src.at) || src.at <= 0) {
			return { ok: false, reason: "bad-at" };
		}
		at = Math.floor(src.at);
	}
	let lang = "en";
	if (src.lang !== undefined && src.lang !== null) {
		if (typeof src.lang !== "string" || !src.lang.trim()) {
			return { ok: false, reason: "bad-lang" };
		}
		lang = src.lang.trim();
	}
	return { ok: true, transcript: { text, deviceId, at, lang } };
}

// Strip the first wake word so the run prompt holds the command.
function commandFromTranscript(transcript, wakeWord) {
	const raw = typeof transcript === "string" ? transcript : transcript.text;
	const text = normText(raw);
	const w = wakeWord || state.wakeWord;
	if (!matchWakeWord(text, w)) return text;
	const lower = text.toLowerCase();
	const needle = String(w).toLowerCase();
	const i = lower.indexOf(needle);
	const cut = (text.slice(0, i) + " " + text.slice(i + needle.length))
		.replace(/\s+/g, " ")
		.trim();
	return cut || text;
}

// Build the input that runs.createRun expects.
function toVoiceRunInput(input, opts) {
	const parsed = parseVoiceTranscript(input);
	if (!parsed.ok) throw new Error(parsed.reason);
	const o = opts || {};
	const w = o.wakeWord || state.wakeWord;
	const command = commandFromTranscript(parsed.transcript.text, w);
	let ownerDeviceId = parsed.transcript.deviceId;
	if (typeof o.ownerDeviceId === "string" && o.ownerDeviceId) {
		ownerDeviceId = o.ownerDeviceId;
	}
	return {
		title: command.slice(0, 60),
		prompt: command,
		ownerDeviceId: ownerDeviceId || null,
	};
}

// One call feed from transcript to wake match to run input.
function ingestVoiceTranscript(input, opts) {
	const parsed = parseVoiceTranscript(input);
	if (!parsed.ok) return parsed;
	const o = opts || {};
	const w = o.wakeWord || state.wakeWord;
	const hit = matchWakeWord(parsed.transcript.text, w);
	if (hit) state.hits += 1;
	return {
		ok: true,
		hit,
		transcript: parsed.transcript,
		runInput: hit ? toVoiceRunInput(parsed.transcript, o) : null,
	};
}

function getVoiceState() {
	return {
		listening: state.listening,
		wakeWord: state.wakeWord,
		hits: state.hits,
	};
}

module.exports = {
	MAX_TEXT_LEN,
	MIC_NOTE,
	startListening,
	stopListening,
	matchWakeWord,
	onTranscript,
	parseVoiceTranscript,
	commandFromTranscript,
	toVoiceRunInput,
	ingestVoiceTranscript,
	getVoiceState,
};
