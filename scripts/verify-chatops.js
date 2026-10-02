"use strict";

// Verify chatops without live sends. Each log line names one behavior.

const assert = require("node:assert");
const chatops = require("../src/chatops");

async function main() {
	assert.deepStrictEqual(
		chatops.buildPayload("slack", { text: "hi", channel: "c1" }),
		{
			text: "hi",
			channel: "c1",
		},
	);
	console.log("PASS slack payload keeps text and channel");

	assert.deepStrictEqual(
		chatops.buildPayload("telegram", { text: "hi", channel: "c1" }),
		{
			text: "hi",
			chat_id: "c1",
		},
	);
	console.log("PASS telegram payload maps channel to chat id");

	assert.deepStrictEqual(
		chatops.buildPayload("discord", { text: "hi", channel: "c1" }),
		{
			content: "hi",
		},
	);
	console.log("PASS discord payload uses content");

	assert.throws(
		() => chatops.buildPayload("nope", { text: "hi" }),
		/unknown chatops target/,
	);
	console.log("PASS unknown target throws");

	assert.strictEqual(
		chatops.getWebhookUrl("slack", { CHATOPS_SLACK_WEBHOOK: "https://x/y" }),
		"https://x/y",
	);
	assert.strictEqual(chatops.getWebhookUrl("slack", {}), "");
	assert.strictEqual(
		chatops.isOutboundConfigured("slack", {
			CHATOPS_SLACK_WEBHOOK: "https://x/y",
		}),
		true,
	);
	assert.strictEqual(chatops.isOutboundConfigured("slack", {}), false);
	console.log("PASS webhook url reads env key per target");

	let seen = null;
	const stub = async (url, opts) => {
		seen = { url: url, body: String(opts.body) };
		return { ok: true, status: 200 };
	};
	const sent = await chatops.sendChatops(
		"slack",
		{ text: "hi", channel: "c1" },
		{ webhookUrl: "https://x/y", fetchFn: stub },
	);
	assert.strictEqual(sent.ok, true);
	assert.strictEqual(seen.body, JSON.stringify({ text: "hi", channel: "c1" }));
	console.log("PASS send uses stub fetch and posts slack shape");

	const skipped = await chatops.sendChatops(
		"slack",
		{ text: "hi" },
		{ webhookUrl: "", fetchFn: stub },
	);
	assert.strictEqual(skipped.ok, false);
	assert.strictEqual(skipped.skipped, "webhook-not-configured");
	console.log("PASS send without url returns skipped");

	await assert.rejects(
		chatops.sendChatops(
			"nope",
			{ text: "hi" },
			{ webhookUrl: "https://x/y", fetchFn: stub },
		),
		/unknown chatops target/,
	);
	console.log("PASS send to unknown target throws");

	assert.strictEqual(chatops.checkInboundSecret("s3", "s3"), true);
	assert.strictEqual(chatops.checkInboundSecret("s3", "other"), false);
	assert.strictEqual(chatops.checkInboundSecret("", ""), false);
	assert.strictEqual(chatops.checkInboundSecret("s3", ""), false);
	console.log("PASS secret check accepts exact match only");

	assert.deepStrictEqual(
		chatops.parseInbound({
			target: "telegram",
			text: "run it",
			channel: "c9",
			sender: "u7",
		}),
		{ target: "telegram", text: "run it", channel: "c9", sender: "u7", id: "" },
	);
	assert.throws(
		() => chatops.parseInbound({ target: "slack", text: "" }),
		/text is required/,
	);
	assert.throws(
		() => chatops.parseInbound({ target: "nope", text: "hi" }),
		/unknown chatops target/,
	);
	console.log("PASS inbound parse keeps target text channel sender");

	chatops.clearQueue();
	chatops.clearLog();
	const good = chatops.handleInbound({ target: "slack", text: "hello" }, "s3", {
		expectedSecret: "s3",
	});
	assert.strictEqual(good.ok, true);
	assert.strictEqual(good.status, 202);
	assert.strictEqual(good.queued.target, "slack");
	assert.strictEqual(good.queued.status, "queued");
	assert.strictEqual(chatops.listQueue().length, 1);
	assert.strictEqual(chatops.listLog().length, 1);
	assert.strictEqual(chatops.listLog()[0].direction, "in");
	console.log("PASS inbound with good secret enqueues and logs");

	chatops.clearQueue();
	chatops.clearLog();
	const bad = chatops.handleInbound(
		{ target: "slack", text: "hello" },
		"wrong",
		{ expectedSecret: "s3" },
	);
	assert.strictEqual(bad.ok, false);
	assert.strictEqual(bad.status, 401);
	assert.strictEqual(chatops.listQueue().length, 0);
	console.log("PASS inbound with bad secret returns 401 without enqueue");

	const plan = chatops.planInboundRoute();
	assert.strictEqual(plan.method, "POST");
	assert.strictEqual(plan.path, "/api/v1/chatops/inbound");
	assert.strictEqual(plan.secretEnv, "CHATOPS_INBOUND_SECRET");
	console.log("PASS inbound plan names method path and secret env");

	assert.deepStrictEqual(chatops.listTargets().sort(), [
		"discord",
		"slack",
		"telegram",
	]);
	console.log("PASS targets list names all three vendors");
}

main().catch((err) => {
	console.error(err && err.message ? err.message : String(err));
	process.exit(1);
});
