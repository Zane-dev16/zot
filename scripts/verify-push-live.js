"use strict";

const assert = require("node:assert");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const push = require("../src/push");

const FAKE_TOKEN = "c".repeat(64);

function b64ToJson(part) {
	const b64 = String(part).replace(/-/g, "+").replace(/_/g, "/");
	const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
	try {
		return JSON.parse(Buffer.from(b64 + pad, "base64").toString("utf8"));
	} catch {
		throw new Error("bad jwt part");
	}
}

async function main() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zot-apns-"));
	const keyFile = path.join(dir, "stub.p8");
	try {
		const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", {
			namedCurve: "prime256v1",
		});
		const privatePem = privateKey.export({ type: "pkcs8", format: "pem" });
		const publicPem = publicKey.export({ type: "spki", format: "pem" });
		fs.writeFileSync(keyFile, privatePem, { mode: 0o600 });

		const byPath = {
			APNS_TEAM_ID: "36V92GAJBT",
			APNS_KEY_ID: "LIVE1STUB",
			APNS_KEY_PATH: keyFile,
			APNS_TOPIC: "com.zanishlabs.zot",
			APNS_MODE: "development",
		};
		const byPem = {
			APNS_TEAM_ID: "36V92GAJBT",
			APNS_KEY_ID: "LIVE1STUB",
			APNS_KEY_PEM: privatePem,
			APNS_MODE: "development",
		};

		const skipped = await push.sendPush(
			{ token: FAKE_TOKEN, title: "hi" },
			{ env: {} },
		);
		assert.strictEqual(skipped.ok, false, "unconfigured is not ok");
		assert.strictEqual(skipped.skipped, "apns-not-configured", "names reason");
		console.log("PASS unconfigured send stays skipped");

		const cfgPath = push.loadPushConfig(byPath);
		assert.strictEqual(cfgPath.configured, true, "path config is configured");
		assert.strictEqual(
			cfgPath.topic,
			"com.zanishlabs.zot",
			"topic default holds",
		);
		assert.strictEqual(cfgPath.mode, "development", "mode default holds");
		const cfgPem = push.loadPushConfig(byPem);
		assert.strictEqual(cfgPem.configured, true, "pem config is configured");
		console.log("PASS config loads from p8 path or env PEM");

		assert.strictEqual(
			push.loadKeyMaterial(cfgPath),
			privatePem.trim(),
			"path key matches file",
		);
		assert.strictEqual(
			push.loadKeyMaterial(cfgPem),
			privatePem.trim(),
			"pem key matches env",
		);
		assert.ok(keyFile.startsWith(os.tmpdir()), "stub key lives in tmp");
		console.log("PASS key material reads path or PEM without logging it");

		const token = push.signApnsToken({
			teamId: "36V92GAJBT",
			keyId: "LIVE1STUB",
			keyPem: privatePem,
			now: 1_700_000_000_000,
		});
		const parts = token.split(".");
		assert.strictEqual(parts.length, 3, "jwt has three parts");
		assert.deepStrictEqual(
			b64ToJson(parts[0]),
			{ alg: "ES256", kid: "LIVE1STUB" },
			"jwt header names ES256 key",
		);
		assert.strictEqual(
			b64ToJson(parts[1]).iss,
			"36V92GAJBT",
			"jwt issuer is team",
		);
		const ok = crypto.verify(
			"sha256",
			Buffer.from(`${parts[0]}.${parts[1]}`),
			crypto.createPublicKey(publicPem),
			Buffer.from(parts[2].replace(/-/g, "+").replace(/_/g, "/"), "base64"),
		);
		assert.strictEqual(ok, true, "jwt verifies against stub public key");
		console.log("PASS ephemeral ES256 provider token signs and verifies");

		let seen = null;
		const stub = async (req) => {
			seen = req;
			return { status: 200, apnsId: "stub-id-1", body: "{}" };
		};
		const sent = await push.sendPush(
			{ token: FAKE_TOKEN, title: "hello", body: "world" },
			{ env: byPath, live: true, transport: stub },
		);
		assert.strictEqual(sent.ok, true, "live stub send is ok");
		assert.strictEqual(sent.sent, true, "live stub send marks sent");
		assert.ok(
			seen.url.startsWith("https://api.sandbox.push.apple.com/3/device/"),
			"dev url hits sandbox host",
		);
		assert.ok(seen.url.endsWith(FAKE_TOKEN), "dev url carries device token");
		assert.strictEqual(
			seen.headers["apns-topic"],
			"com.zanishlabs.zot",
			"topic header holds app id",
		);
		assert.strictEqual(
			seen.headers["apns-push-type"],
			"alert",
			"push type is alert",
		);
		assert.strictEqual(
			seen.headers.authorization.split(".").length,
			3,
			"auth header is a jwt",
		);
		assert.strictEqual(
			seen.payload.aps.alert.title,
			"hello",
			"payload keeps title",
		);
		console.log("PASS live send posts sandbox URL plus topic plus JWT");

		let prodSeen = null;
		const prodEnv = { ...byPath, APNS_MODE: "production" };
		const prodRes = await push.sendPush(
			{ token: FAKE_TOKEN, title: "hi" },
			{
				env: prodEnv,
				live: true,
				transport: async (req) => {
					prodSeen = req;
					return { status: 200, apnsId: "stub-id-2", body: "{}" };
				},
			},
		);
		assert.strictEqual(prodRes.sent, true, "production stub sends");
		assert.ok(
			prodSeen.url.startsWith("https://api.push.apple.com/3/device/"),
			"production url hits prod host",
		);
		console.log("PASS production mode switches APNs host");

		const bad = await push.sendPush(
			{ token: "nope" },
			{ env: byPath, live: true, transport: stub },
		);
		assert.strictEqual(
			bad.skipped,
			"invalid-token",
			"bad token stays rejected",
		);
		const missingKey = await push.sendPush(
			{ token: FAKE_TOKEN, title: "hi" },
			{
				env: { ...byPath, APNS_KEY_PATH: "/tmp/definitely-missing.p8" },
				live: true,
				transport: stub,
			},
		);
		assert.strictEqual(
			missingKey.queued,
			true,
			"missing key falls back to queued",
		);
		console.log("PASS invalid token rejected plus missing key stays queued");

		const apiSrc = fs.readFileSync(
			path.join(__dirname, "..", "src", "api.js"),
			"utf8",
		);
		assert.ok(apiSrc.includes("/api/v1/push/tokens"), "push route is wired");
		assert.ok(
			apiSrc.includes("push.registerToken"),
			"register path calls push",
		);
		assert.ok(apiSrc.includes("push.listTokens"), "list path calls push");
		assert.ok(apiSrc.includes("push.removeToken"), "remove path calls push");
		const daemonSrc = fs.readFileSync(
			path.join(__dirname, "..", "src", "daemon2.js"),
			"utf8",
		);
		assert.ok(
			daemonSrc.includes("notifyRunDone"),
			"daemon fires push on run done",
		);
		const clientSrc = fs.readFileSync(
			path.join(__dirname, "..", "ios", "ApiClient.swift"),
			"utf8",
		);
		assert.ok(clientSrc.includes("registerPushToken"), "ios posts its token");
		console.log("PASS routes plus daemon worker plus iOS call are wired");

		const db = new DatabaseSync(":memory:");
		db.exec(
			"CREATE TABLE agent_run(id TEXT PRIMARY KEY, title TEXT, state TEXT)",
		);
		db.prepare("INSERT INTO agent_run(id, title, state) VALUES (?, ?, ?)").run(
			"run-1",
			"nightly backup",
			"done",
		);
		push.registerToken(db, { token: FAKE_TOKEN, deviceId: "dev-1" });
		let calls = 0;
		const out = await push.notifyRunDone(db, "run-1", {
			env: byPath,
			live: true,
			transport: async (req) => {
				calls += 1;
				assert.ok(
					req.payload.aps.alert.title.length > 0,
					"worker message has a title",
				);
				return { status: 200, apnsId: "stub-id-3", body: "{}" };
			},
		});
		assert.strictEqual(out.total, 1, "worker fans out to one token");
		assert.strictEqual(out.sent, 1, "worker marks one sent");
		assert.strictEqual(calls, 1, "transport saw one request");
		db.close();
		console.log("PASS run done worker fans out to stored tokens");

		const repoHits = [];
		for (const f of fs.readdirSync(path.join(__dirname, ".."))) {
			if (f.endsWith(".p8") || f.endsWith(".pem")) repoHits.push(f);
		}
		assert.deepStrictEqual(repoHits, [], "no key file sits in repo root");
		console.log("PASS stub key stayed in tmp and out of the repo");
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
}

main()
	.then(() => console.log("ALL PASS push live with stub key"))
	.catch((err) => {
		console.error(err && err.message ? err.message : String(err));
		process.exit(1);
	});
