"use strict";

// Verify router fallback. Each log line names one behavior.
// Run offline with empty key to cover the fallback path.

const assert = require("node:assert");
const router = require("../src/router");

async function main() {
	const saved = process.env.OPENAI_API_KEY;
	delete process.env.OPENAI_API_KEY;
	try {
		assert.strictEqual(
			router.route("hi", "echo").id,
			"echo",
			"route picks known override",
		);
		assert.strictEqual(
			router.route("hi", "nope").id,
			router.DEFAULT_MODEL,
			"route falls back to default",
		);
		const out = router.exec("echo", "hello");
		assert.strictEqual(out.model, "echo", "exec tags echo model");
		assert.strictEqual(
			out.text,
			"echo[echo]: hello",
			"exec returns literal echo text",
		);
		let logged = "";
		const orig = console.log;
		console.log = (msg) => {
			logged += String(msg);
		};
		try {
			router.exec("echo-large", "hi");
		} finally {
			console.log = orig;
		}
		assert.ok(logged.includes("echo-large"), "exec logs model id");
		assert.strictEqual(
			router.isLiveConfigured(),
			false,
			"live flag false without key",
		);
		assert.strictEqual(
			router.isLiveConfigured("openai-mini"),
			false,
			"live model false without key",
		);
		const live = await router.execAsync("openai-mini", "hi fallback");
		assert.strictEqual(live.model, "openai-mini", "fallback keeps live id");
		assert.strictEqual(
			live.text,
			"echo[openai-mini]: hi fallback",
			"fallback returns echo text",
		);
		const echoAsync = await router.execAsync("echo", "hello");
		assert.strictEqual(
			echoAsync.text,
			"echo[echo]: hello",
			"async echo matches sync echo",
		);
		assert.strictEqual(
			router.MODELS["openai-mini"].provider,
			"openai",
			"live entry names provider",
		);
		console.log("PASS route picks override");
		console.log("PASS exec echo literal");
		console.log("PASS exec logs model id");
		console.log("PASS fallback without key");
		console.log("PASS async echo matches sync");
	} finally {
		if (saved == null) delete process.env.OPENAI_API_KEY;
		else process.env.OPENAI_API_KEY = saved;
	}
}

main().catch((err) => {
	console.error(err && err.message ? err.message : String(err));
	process.exit(1);
});
