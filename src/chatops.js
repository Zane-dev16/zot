"use strict";

// ChatOps webhook fanout for Slack, Telegram, Discord.
// Data shape is ChatMessage { text, channel }. Registry avoids per vendor branches.

async function postWebhook(url, payload) {
	if (!url) return { ok: false, skipped: "webhook-not-configured" };
	const res = await fetch(url, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(payload),
	});
	return { ok: res.ok, status: res.status };
}

const targets = {
	slack: (url, msg) =>
		postWebhook(url, { text: msg.text, channel: msg.channel }),
	telegram: (url, msg) =>
		postWebhook(url, { text: msg.text, chat_id: msg.channel }),
	discord: (url, msg) => postWebhook(url, { content: msg.text }),
};

async function sendChatops(target, message, webhookUrl) {
	const fn = targets[target];
	if (!fn) throw new Error("unknown chatops target " + target);
	return fn(webhookUrl, message);
}

function listTargets() {
	return Object.keys(targets);
}

module.exports = { sendChatops, listTargets, targets };
