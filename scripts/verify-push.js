"use strict";

const assert = require("node:assert");
const { DatabaseSync } = require("node:sqlite");
const push = require("../src/push");

const FAKE_TOKEN = "a".repeat(64);
const FAKE_TOKEN_TWO = "b".repeat(64);

function savedEnv() {
	return {
		APNS_TEAM_ID: process.env.APNS_TEAM_ID,
		APNS_KEY_ID: process.env.APNS_KEY_ID,
		APNS_KEY_PATH: process.env.APNS_KEY_PATH,
		APNS_TOPIC: process.env.APNS_TOPIC,
		APNS_MODE: process.env.APNS_MODE,
	};
}

function restoreEnv(saved) {
	for (const k of Object.keys(saved)) {
		if (saved[k] === undefined) delete process.env[k];
		else process.env[k] = saved[k];
	}
}

function clearPushEnv() {
	delete process.env.APNS_TEAM_ID;
	delete process.env.APNS_KEY_ID;
	delete process.env.APNS_KEY_PATH;
	delete process.env.APNS_TOPIC;
	delete process.env.APNS_MODE;
}

function setFakeEnv() {
	process.env.APNS_TEAM_ID = "36V92GAJBT";
	process.env.APNS_KEY_ID = "FAKEKEY1";
	process.env.APNS_KEY_PATH = "/tmp/fake-apns.p8";
	process.env.APNS_TOPIC = "com.zanishlabs.zot";
	process.env.APNS_MODE = "development";
}

async function main() {
	const saved = savedEnv();
	try {
		clearPushEnv();
		const empty = push.loadPushConfig({});
		assert.strictEqual(empty.configured, false, "empty env is not configured");
		assert.strictEqual(
			push.isPushConfigured(empty),
			false,
			"helper reports false",
		);
		const skipped = await push.sendPush(
			{ token: FAKE_TOKEN, title: "hi", body: "hello" },
			{ env: {} },
		);
		assert.strictEqual(skipped.ok, false, "skipped result is not ok");
		assert.strictEqual(
			skipped.skipped,
			"apns-not-configured",
			"skipped names apns",
		);
		assert.strictEqual(
			skipped.configured,
			false,
			"skipped carries configured false",
		);
		assert.strictEqual(skipped.token, FAKE_TOKEN, "skipped echoes token");
		console.log("PASS skipped shape when unconfigured");

		setFakeEnv();
		const cfg = push.loadPushConfig(process.env);
		assert.strictEqual(cfg.configured, true, "fake env is configured");
		assert.strictEqual(
			cfg.topic,
			"com.zanishlabs.zot",
			"topic defaults to app id",
		);
		assert.strictEqual(cfg.mode, "development", "mode defaults to development");
		assert.strictEqual(push.isPushConfigured(cfg), true, "helper reports true");
		const queued = await push.sendPush({
			token: FAKE_TOKEN,
			title: "hi",
			body: "hello",
		});
		assert.strictEqual(queued.ok, true, "queued result is ok");
		assert.strictEqual(queued.queued, true, "queued flag is true");
		assert.strictEqual(
			queued.configured,
			true,
			"queued carries configured true",
		);
		assert.strictEqual(
			queued.topic,
			"com.zanishlabs.zot",
			"queued carries topic",
		);
		assert.strictEqual(queued.mode, "development", "queued carries mode");
		assert.strictEqual(queued.token, FAKE_TOKEN, "queued echoes token");
		assert.ok(queued.id, "queued carries id");
		console.log("PASS queued shape when configured");

		const bad = await push.sendPush({ token: "nope" }, { env: process.env });
		assert.strictEqual(bad.ok, false, "bad token is not ok");
		assert.strictEqual(bad.skipped, "invalid-token", "bad token names reason");
		console.log("PASS invalid token is rejected");

		const db = new DatabaseSync(":memory:");
		const reg = push.registerToken(db, {
			token: FAKE_TOKEN,
			deviceId: "dev one",
			platform: "ios",
		});
		assert.strictEqual(reg.token, FAKE_TOKEN, "register echoes token");
		push.registerToken(db, { token: FAKE_TOKEN_TWO, deviceId: "dev two" });
		const rows = push.listTokens(db);
		assert.strictEqual(rows.length, 2, "two tokens are stored");
		assert.ok(
			rows.some((r) => r.token === FAKE_TOKEN),
			"first token is listed",
		);
		push.removeToken(db, FAKE_TOKEN_TWO);
		assert.strictEqual(push.listTokens(db).length, 1, "remove deletes one row");
		assert.throws(
			() => push.registerToken(db, { token: "bad" }),
			/invalid token/,
			"bad register throws",
		);
		db.close();
		console.log("PASS token table register list remove");

		const bulk = await push.sendBulk(
			[{ token: FAKE_TOKEN, title: "one" }, { token: "bad" }],
			{ env: process.env },
		);
		assert.strictEqual(bulk.length, 2, "bulk keeps input length");
		assert.strictEqual(bulk[0].queued, true, "bulk first is queued");
		assert.strictEqual(
			bulk[1].skipped,
			"invalid-token",
			"bulk second names reason",
		);
		console.log("PASS bulk keeps queued plus invalid shapes");

		const parsed = push.parseRegisterBody({
			token: FAKE_TOKEN,
			deviceId: "d1",
		});
		assert.strictEqual(parsed.ok, true, "register body parses");
		assert.strictEqual(parsed.platform, "ios", "register defaults to ios");
		const rejected = push.parseRegisterBody({ token: "bad" });
		assert.strictEqual(rejected.ok, false, "bad register body fails");
		console.log("PASS register body validates token");
	} finally {
		restoreEnv(saved);
	}
}

main().catch((err) => {
	console.error(err && err.message ? err.message : String(err));
	process.exit(1);
});
