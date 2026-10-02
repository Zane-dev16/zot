"use strict";

// ChatOps outbound plus inbound plan.
// Data shapes are ChatMessage { text, channel } and InboundMessage { target, text, channel, sender }.
// Queue holds ChatQueueItem { id, target, text, channel, status, createdAt }.
// Log holds ChatLogEntry { id, direction, target, text, ok, status, at }.

const crypto = require("node:crypto");

const INBOUND_ROUTE = "/api/v1/chatops/inbound";
const INBOUND_SECRET_ENV = "CHATOPS_INBOUND_SECRET";

const ENV_KEYS = {
	slack: "CHATOPS_SLACK_WEBHOOK",
	telegram: "CHATOPS_TELEGRAM_WEBHOOK",
	discord: "CHATOPS_DISCORD_WEBHOOK",
};

let seq = 0;
const queue = [];
const log = [];
const MAX_LOG = 200;

function getWebhookUrl(target, env) {
	const key = ENV_KEYS[target];
	if (!key) return "";
	const src = env || process.env;
	const v = src[key];
	return typeof v === "string" ? v : "";
}

function isOutboundConfigured(target, env) {
	return getWebhookUrl(target, env).length > 0;
}

function buildPayload(target, msg) {
	const text = msg && typeof msg.text === "string" ? msg.text : "";
	const channel = msg && typeof msg.channel === "string" ? msg.channel : "";
	if (target === "slack") return { text: text, channel: channel };
	if (target === "telegram") return { text: text, chat_id: channel };
	if (target === "discord") return { content: text };
	throw new Error("unknown chatops target " + target);
}

async function postWebhook(url, payload, fetchFn) {
	if (!url) return { ok: false, skipped: "webhook-not-configured" };
	const run = fetchFn || fetch;
	const res = await run(url, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(payload),
	});
	return { ok: res.ok, status: res.status };
}

const targets = {
	slack: (url, msg, fetchFn) =>
		postWebhook(url, buildPayload("slack", msg), fetchFn),
	telegram: (url, msg, fetchFn) =>
		postWebhook(url, buildPayload("telegram", msg), fetchFn),
	discord: (url, msg, fetchFn) =>
		postWebhook(url, buildPayload("discord", msg), fetchFn),
};

function resolveSendArgs(webhookUrlOrOpts, fetchFn) {
	if (typeof webhookUrlOrOpts === "string")
		return { url: webhookUrlOrOpts, fetchFn: fetchFn };
	const opts = webhookUrlOrOpts || {};
	return { url: opts.webhookUrl || "", fetchFn: opts.fetchFn || fetchFn };
}

async function sendChatops(target, message, webhookUrlOrOpts, fetchFn) {
	const fn = targets[target];
	if (!fn) throw new Error("unknown chatops target " + target);
	const args = resolveSendArgs(webhookUrlOrOpts, fetchFn);
	const url = args.url || getWebhookUrl(target);
	return fn(url, message, args.fetchFn);
}

function listTargets() {
	return Object.keys(targets);
}

// Inbound boundary guards go here. Inner queue logic trusts the parsed shape.
function checkInboundSecret(provided, expected) {
	if (typeof provided !== "string" || typeof expected !== "string")
		return false;
	if (provided.length === 0 || expected.length === 0) return false;
	const a = Buffer.from(provided, "utf8");
	const b = Buffer.from(expected, "utf8");
	if (a.length !== b.length) return false;
	return crypto.timingSafeEqual(a, b);
}

function parseInbound(body) {
	const b = body || {};
	const target = b.target;
	if (target !== "slack" && target !== "telegram" && target !== "discord") {
		throw new Error("unknown chatops target " + String(target));
	}
	if (typeof b.text !== "string" || b.text.length === 0) {
		throw new Error("text is required");
	}
	return {
		target: target,
		text: b.text,
		channel: typeof b.channel === "string" ? b.channel : "",
		sender: typeof b.sender === "string" ? b.sender : "",
		id: typeof b.id === "string" ? b.id : "",
	};
}

function enqueueChatops(item) {
	seq += 1;
	const row = {
		id: "q" + seq,
		target: item.target,
		text: item.text,
		channel: item.channel || "",
		status: "queued",
		createdAt: Date.now(),
	};
	queue.push(row);
	return row;
}

function listQueue() {
	return queue.slice();
}

function clearQueue() {
	queue.length = 0;
	seq = 0;
}

function logChatops(entry) {
	const row = {
		id: "l" + (log.length + 1),
		direction: entry.direction,
		target: entry.target,
		text: entry.text || "",
		ok: entry.ok === true,
		status: entry.status === undefined ? null : entry.status,
		at: Date.now(),
	};
	log.push(row);
	if (log.length > MAX_LOG) log.splice(0, log.length - MAX_LOG);
	return row;
}

function listLog() {
	return log.slice();
}

function clearLog() {
	log.length = 0;
}

function expectedSecret(opts) {
	if (opts && typeof opts.expectedSecret === "string")
		return opts.expectedSecret;
	return process.env[INBOUND_SECRET_ENV] || "";
}

// Route plan stays here so api.js can adopt it without a chatops import cycle.
// Method is POST. Path is INBOUND_ROUTE. Secret rides in x-chatops-secret.
function planInboundRoute() {
	return {
		method: "POST",
		path: INBOUND_ROUTE,
		secretEnv: INBOUND_SECRET_ENV,
		secretHeader: "x-chatops-secret",
		body: { target: "slack", text: "hello", channel: "", sender: "" },
	};
}

function handleInbound(body, providedSecret, opts) {
	const expected = expectedSecret(opts);
	if (!checkInboundSecret(providedSecret, expected)) {
		return { ok: false, status: 401, error: "unauthorized" };
	}
	let msg;
	try {
		msg = parseInbound(body);
	} catch (e) {
		return { ok: false, status: 400, error: e.message };
	}
	const row = enqueueChatops(msg);
	logChatops({
		direction: "in",
		target: msg.target,
		text: msg.text,
		ok: true,
		status: 202,
	});
	return { ok: true, status: 202, queued: row };
}

module.exports = {
	INBOUND_ROUTE,
	INBOUND_SECRET_ENV,
	ENV_KEYS,
	getWebhookUrl,
	isOutboundConfigured,
	buildPayload,
	postWebhook,
	targets,
	sendChatops,
	listTargets,
	checkInboundSecret,
	parseInbound,
	enqueueChatops,
	listQueue,
	clearQueue,
	logChatops,
	listLog,
	clearLog,
	planInboundRoute,
	handleInbound,
};
