"use strict";

const crypto = require("node:crypto");
const auth = require("./auth");
const runs = require("./runs");
const memory = require("./memory");

function send(res, status, obj) {
	const body = JSON.stringify(obj);
	res.writeHead(status, { "content-type": "application/json" });
	res.end(body);
}

function readBody(req, limit) {
	const max = limit || 1024 * 1024;
	return new Promise((resolve, reject) => {
		let size = 0;
		const chunks = [];
		req.on("data", (c) => {
			size += c.length;
			if (size > max) {
				reject(new Error("body too large"));
				req.destroy();
				return;
			}
			chunks.push(c);
		});
		req.on("end", () => {
			if (chunks.length === 0) {
				resolve(null);
				return;
			}
			try {
				resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
			} catch {
				reject(new Error("invalid json"));
			}
		});
		req.on("error", reject);
	});
}

function bearer(req) {
	const h = req.headers && req.headers.authorization;
	if (typeof h !== "string") return null;
	const m = h.match(/^Bearer (.+)$/);
	return m ? m[1] : null;
}

function nonEmpty(v) {
	return typeof v === "string" && v.length > 0;
}

function mapRun(r) {
	if (!r) return null;
	return {
		id: r.id,
		title: r.title,
		prompt: r.prompt,
		state: r.state,
		attempt: r.attempt,
		createdAt: r.created_at,
		updatedAt: r.updated_at,
		finishedAt: r.finished_at === undefined ? null : r.finished_at,
		lastHeartbeat: r.last_heartbeat,
		ownerDeviceId: r.owner_device_id === undefined ? null : r.owner_device_id,
	};
}

function toRunShape(row) {
	return {
		id: row.id,
		title: row.title,
		prompt: row.prompt,
		state: row.state,
		attempt: row.attempt,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		finishedAt: row.finished_at,
		lastHeartbeat: row.last_heartbeat,
		ownerDeviceId: row.owner_device_id,
	};
}

function mapJob(r) {
	return {
		id: r.id,
		name: r.name,
		cron: r.cron,
		prompt: r.prompt,
		enabled: r.enabled === 1 || r.enabled === true,
		nextRunAt: r.next_run_at,
		lastRunId: r.last_run_id === undefined ? null : r.last_run_id,
	};
}

function mapDevice(r) {
	return {
		id: r.id,
		label: r.label,
		kind: r.kind,
		createdAt: r.created_at,
		lastSeenAt: r.last_seen_at,
		revokedAt: r.revoked_at === undefined ? null : r.revoked_at,
	};
}

function mapMemory(r) {
	return {
		id: r.id,
		runId: r.run_id === undefined ? null : r.run_id,
		key: r.key,
		value: r.value,
		createdAt: r.created_at,
		updatedAt: r.updated_at,
	};
}

function newId() {
	return crypto.randomUUID();
}

function createHandler(db) {
	let pending = null;
	let pairAttempts = [];

	function pairLimited() {
		const now = Date.now();
		pairAttempts = pairAttempts.filter((t) => t > now - auth.PAIR_WINDOW_MS);
		if (auth.isRateLimited(pairAttempts, now)) return true;
		pairAttempts.push(now);
		return false;
	}

	function findSession(token) {
		if (!nonEmpty(token)) return null;
		const rows = db
			.prepare(
				"SELECT id, label, kind, token_hash, created_at, last_seen_at, revoked_at FROM device_session WHERE revoked_at IS NULL",
			)
			.all();
		for (const row of rows) {
			if (auth.verifyToken(token, row.token_hash)) return row;
		}
		return null;
	}

	function requireAuth(req, res) {
		const session = findSession(bearer(req));
		if (!session) {
			send(res, 401, { error: "unauthorized" });
			return null;
		}
		db.prepare("UPDATE device_session SET last_seen_at = ? WHERE id = ?").run(
			Date.now(),
			session.id,
		);
		return session;
	}

	async function dispatch(req, res) {
		const u = new URL(req.url, "http://x");
		const path = u.pathname.replace(/\/+$/, "") || "/";
		const method = req.method;

		const KNOWN = [
			/^\/api\/v1\/runs$/,
			/^\/api\/v1\/runs\/[^/]+$/,
			/^\/api\/v1\/runs\/[^/]+\/cancel$/,
			/^\/api\/v1\/runs\/[^/]+\/approve$/,
			/^\/api\/v1\/runs\/[^/]+\/events$/,
			/^\/api\/v1\/memory$/,
			/^\/api\/v1\/memory\/[^/]+$/,
			/^\/api\/v1\/jobs$/,
			/^\/api\/v1\/jobs\/[^/]+$/,
			/^\/api\/v1\/devices$/,
			/^\/api\/v1\/devices\/[^/]+$/,
			/^\/api\/v1\/pair\/start$/,
			/^\/api\/v1\/pair\/confirm$/,
		];
		if (!KNOWN.some((r) => r.test(path))) {
			send(res, 404, { error: "not found" });
			return;
		}

		if (method === "POST" && path === "/api/v1/pair/start") {
			if (pairLimited()) {
				send(res, 429, { error: "rate limited" });
				return;
			}
			let body = null;
			try {
				body = await readBody(req);
			} catch (e) {
				send(res, 400, { error: e.message });
				return;
			}
			const label = (body && body.label) || "ios device";
			const kind = (body && body.kind) || "ios";
			try {
				pending = auth.startPairing({ label, kind });
			} catch (e) {
				send(res, 400, { error: e.message });
				return;
			}
			send(res, 200, { code: pending.code, expiresAt: pending.expiresAt });
			return;
		}

		const session = requireAuth(req, res);
		if (!session) return;

		if (method === "GET" && path === "/api/v1/runs") {
			const rows = db
				.prepare("SELECT * FROM agent_run ORDER BY created_at DESC LIMIT 100")
				.all();
			send(res, 200, { runs: rows.map(mapRun) });
			return;
		}

		if (method === "POST" && path === "/api/v1/runs") {
			let body = null;
			try {
				body = await readBody(req);
			} catch (e) {
				send(res, 400, { error: e.message });
				return;
			}
			if (!body || !nonEmpty(body.title) || !nonEmpty(body.prompt)) {
				send(res, 400, { error: "title and prompt are required" });
				return;
			}
			const run = runs.createRun({
				id: newId(),
				title: body.title,
				prompt: body.prompt,
				ownerDeviceId: body.ownerDeviceId || null,
			});
			db.prepare(
				"INSERT INTO agent_run(id, title, prompt, state, attempt, created_at, updated_at, finished_at, last_heartbeat, owner_device_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
			).run(
				run.id,
				run.title,
				run.prompt,
				run.state,
				run.attempt,
				run.createdAt,
				run.updatedAt,
				run.finishedAt,
				run.lastHeartbeat,
				run.ownerDeviceId,
			);
			send(res, 201, { run: mapRun(toDbRow(run)) });
			return;
		}

		let m = path.match(/^\/api\/v1\/runs\/([^/]+)\/cancel$/);
		if (method === "POST" && m) {
			const id = decodeURIComponent(m[1]);
			const row = db.prepare("SELECT * FROM agent_run WHERE id = ?").get(id);
			if (!row) {
				send(res, 404, { error: "not found" });
				return;
			}
			let next;
			try {
				next = runs.cancel(toRunShape(row));
			} catch {
				send(res, 409, { error: "bad run transition" });
				return;
			}
			db.prepare(
				"UPDATE agent_run SET state = ?, updated_at = ?, finished_at = ? WHERE id = ?",
			).run(next.state, next.updatedAt, next.finishedAt, id);
			send(res, 200, {
				run: mapRun(db.prepare("SELECT * FROM agent_run WHERE id = ?").get(id)),
			});
			return;
		}

		m = path.match(/^\/api\/v1\/runs\/([^/]+)\/approve$/);
		if (method === "POST" && m) {
			const id = decodeURIComponent(m[1]);
			const row = db.prepare("SELECT * FROM agent_run WHERE id = ?").get(id);
			if (!row) {
				send(res, 404, { error: "not found" });
				return;
			}
			let next;
			try {
				next = runs.approve(toRunShape(row));
			} catch {
				send(res, 409, { error: "bad run transition" });
				return;
			}
			db.prepare(
				"UPDATE agent_run SET state = ?, updated_at = ? WHERE id = ?",
			).run(next.state, next.updatedAt, id);
			send(res, 200, {
				run: mapRun(db.prepare("SELECT * FROM agent_run WHERE id = ?").get(id)),
			});
			return;
		}

		m = path.match(/^\/api\/v1\/runs\/([^/]+)\/events$/);
		if (method === "GET" && m) {
			const id = decodeURIComponent(m[1]);
			const row = db.prepare("SELECT id FROM agent_run WHERE id = ?").get(id);
			if (!row) {
				send(res, 404, { error: "not found" });
				return;
			}
			const since = u.searchParams.get("since");
			const n = since === null || since === "" ? 0 : Number(since);
			const rows =
				Number.isFinite(n) && n > 0
					? db
							.prepare(
								"SELECT id, run_id, tool, args_hash, result_ref, created_at FROM tool_event WHERE run_id = ? AND id > ? ORDER BY id ASC LIMIT 200",
							)
							.all(id, n)
					: db
							.prepare(
								"SELECT id, run_id, tool, args_hash, result_ref, created_at FROM tool_event WHERE run_id = ? ORDER BY id ASC LIMIT 200",
							)
							.all(id);
			send(res, 200, { events: rows });
			return;
		}

		m = path.match(/^\/api\/v1\/runs\/([^/]+)$/);
		if (method === "GET" && m) {
			const id = decodeURIComponent(m[1]);
			const row = db.prepare("SELECT * FROM agent_run WHERE id = ?").get(id);
			if (!row) {
				send(res, 404, { error: "not found" });
				return;
			}
			send(res, 200, { run: mapRun(row) });
			return;
		}

		if (method === "GET" && path === "/api/v1/memory") {
			const key = u.searchParams.get("key");
			const q = u.searchParams.get("q");
			const runId = u.searchParams.get("runId");
			const limit = Math.min(Number(u.searchParams.get("limit")) || 20, 100);
			if (key) {
				const rows = db
					.prepare(
						"SELECT * FROM memory_item WHERE key = ? ORDER BY updated_at DESC LIMIT ?",
					)
					.all(key, limit);
				send(res, 200, { items: rows.map(mapMemory) });
				return;
			}
			if (q) {
				const { sql, params } = memory.buildLikeQuery(q, { runId, limit });
				const rows = db.prepare(sql).all(...params);
				send(res, 200, { items: rows.map(mapMemory) });
				return;
			}
			const rows = db
				.prepare("SELECT * FROM memory_item ORDER BY updated_at DESC LIMIT ?")
				.all(limit);
			send(res, 200, { items: rows.map(mapMemory) });
			return;
		}

		m = path.match(/^\/api\/v1\/memory\/([^/]+)$/);
		if (method === "PUT" && m) {
			const key = decodeURIComponent(m[1]);
			if (!key) {
				send(res, 400, { error: "key is required" });
				return;
			}
			let body = null;
			try {
				body = await readBody(req);
			} catch (e) {
				send(res, 400, { error: e.message });
				return;
			}
			if (!body || typeof body.value !== "string") {
				send(res, 400, { error: "value must be a string" });
				return;
			}
			const runId = body.runId === undefined ? null : body.runId;
			const now = Date.now();
			const existing = db
				.prepare("SELECT * FROM memory_item WHERE key = ?")
				.all(key)
				.find((r) => (r.run_id || null) === (runId || null));
			if (!existing) {
				const item = memory.createMemoryItem({
					runId,
					key,
					value: body.value,
					now,
				});
				db.prepare(
					"INSERT INTO memory_item(id, run_id, key, value, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
				).run(
					item.id,
					item.runId,
					item.key,
					item.value,
					item.createdAt,
					item.updatedAt,
				);
				send(res, 200, {
					item: mapMemory(
						db.prepare("SELECT * FROM memory_item WHERE id = ?").get(item.id),
					),
				});
				return;
			}
			db.prepare(
				"UPDATE memory_item SET value = ?, updated_at = ? WHERE id = ?",
			).run(body.value, now, existing.id);
			send(res, 200, {
				item: mapMemory(
					db.prepare("SELECT * FROM memory_item WHERE id = ?").get(existing.id),
				),
			});
			return;
		}

		if (method === "GET" && path === "/api/v1/jobs") {
			const rows = db
				.prepare("SELECT * FROM scheduler_job ORDER BY name ASC")
				.all();
			send(res, 200, { jobs: rows.map(mapJob) });
			return;
		}

		if (method === "POST" && path === "/api/v1/jobs") {
			let body = null;
			try {
				body = await readBody(req);
			} catch (e) {
				send(res, 400, { error: e.message });
				return;
			}
			if (
				!body ||
				!nonEmpty(body.name) ||
				!nonEmpty(body.cron) ||
				!nonEmpty(body.prompt)
			) {
				send(res, 400, { error: "name, cron and prompt are required" });
				return;
			}
			const id = newId();
			const now = Date.now();
			db.prepare(
				"INSERT INTO scheduler_job(id, name, cron, prompt, enabled, next_run_at, last_run_id) VALUES (?, ?, ?, ?, ?, ?, NULL)",
			).run(
				id,
				body.name,
				body.cron,
				body.prompt,
				body.enabled === false ? 0 : 1,
				now,
			);
			send(res, 201, {
				job: mapJob(
					db.prepare("SELECT * FROM scheduler_job WHERE id = ?").get(id),
				),
			});
			return;
		}

		m = path.match(/^\/api\/v1\/jobs\/([^/]+)$/);
		if (m && (method === "PATCH" || method === "DELETE")) {
			const id = decodeURIComponent(m[1]);
			const row = db
				.prepare("SELECT * FROM scheduler_job WHERE id = ?")
				.get(id);
			if (!row) {
				send(res, 404, { error: "not found" });
				return;
			}
			if (method === "DELETE") {
				db.prepare("DELETE FROM scheduler_job WHERE id = ?").run(id);
				send(res, 200, { ok: true });
				return;
			}
			let body = null;
			try {
				body = await readBody(req);
			} catch (e) {
				send(res, 400, { error: e.message });
				return;
			}
			const patch = body || {};
			const fields = [];
			const vals = [];
			if (patch.name !== undefined) {
				if (!nonEmpty(patch.name)) {
					send(res, 400, { error: "name must be a nonempty string" });
					return;
				}
				fields.push("name = ?");
				vals.push(patch.name);
			}
			if (patch.cron !== undefined) {
				if (!nonEmpty(patch.cron)) {
					send(res, 400, { error: "cron must be a nonempty string" });
					return;
				}
				fields.push("cron = ?");
				vals.push(patch.cron);
			}
			if (patch.prompt !== undefined) {
				if (!nonEmpty(patch.prompt)) {
					send(res, 400, { error: "prompt must be a nonempty string" });
					return;
				}
				fields.push("prompt = ?");
				vals.push(patch.prompt);
			}
			if (patch.enabled !== undefined) {
				fields.push("enabled = ?");
				vals.push(patch.enabled ? 1 : 0);
			}
			if (patch.nextRunAt !== undefined) {
				if (!Number.isFinite(patch.nextRunAt)) {
					send(res, 400, { error: "nextRunAt must be a timestamp" });
					return;
				}
				fields.push("next_run_at = ?");
				vals.push(patch.nextRunAt);
			}
			if (fields.length > 0) {
				db.prepare(
					`UPDATE scheduler_job SET ${fields.join(", ")} WHERE id = ?`,
				).run(...vals, id);
			}
			send(res, 200, {
				job: mapJob(
					db.prepare("SELECT * FROM scheduler_job WHERE id = ?").get(id),
				),
			});
			return;
		}

		if (method === "GET" && path === "/api/v1/devices") {
			const rows = db
				.prepare("SELECT * FROM device_session ORDER BY created_at ASC")
				.all();
			send(res, 200, { devices: rows.map(mapDevice) });
			return;
		}

		if (method === "POST" && path === "/api/v1/pair/confirm") {
			if (pairLimited()) {
				send(res, 429, { error: "rate limited" });
				return;
			}
			let body = null;
			try {
				body = await readBody(req);
			} catch (e) {
				send(res, 400, { error: e.message });
				return;
			}
			if (!pending) {
				send(res, 400, { error: "no pending pairing" });
				return;
			}
			try {
				const out = auth.confirmPairing({
					code: body && body.code,
					expectedCode: pending.code,
					startedAt: pending.startedAt,
					label: pending.label,
					kind: pending.kind,
				});
				db.prepare(
					"INSERT INTO device_session(id, label, kind, token_hash, created_at, last_seen_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?, NULL)",
				).run(
					out.session.id,
					out.session.label,
					out.session.kind,
					out.session.tokenHash,
					out.session.createdAt,
					out.session.lastSeenAt,
				);
				pending = null;
				send(res, 201, {
					token: out.token,
					device: mapDevice(
						db
							.prepare("SELECT * FROM device_session WHERE id = ?")
							.get(out.session.id),
					),
				});
			} catch (e) {
				send(res, 400, { error: e.message });
			}
			return;
		}

		m = path.match(/^\/api\/v1\/devices\/([^/]+)$/);
		if (method === "DELETE" && m) {
			const id = decodeURIComponent(m[1]);
			const row = db
				.prepare("SELECT id FROM device_session WHERE id = ?")
				.get(id);
			if (!row) {
				send(res, 404, { error: "not found" });
				return;
			}
			db.prepare("UPDATE device_session SET revoked_at = ? WHERE id = ?").run(
				Date.now(),
				id,
			);
			send(res, 200, { ok: true });
			return;
		}

		send(res, 404, { error: "not found" });
	}

	function handleApi(req, res) {
		const u = new URL(req.url, "http://x");
		if (!u.pathname.startsWith("/api/v1")) return false;
		dispatch(req, res).catch((e) => {
			if (!res.headersSent) send(res, 500, { error: e.message || "internal" });
			else res.end();
		});
		return true;
	}

	return handleApi;
}

function toDbRow(run) {
	return {
		id: run.id,
		title: run.title,
		prompt: run.prompt,
		state: run.state,
		attempt: run.attempt,
		created_at: run.createdAt,
		updated_at: run.updatedAt,
		finished_at: run.finishedAt,
		last_heartbeat: run.lastHeartbeat,
		owner_device_id: run.ownerDeviceId,
	};
}

module.exports = { createHandler };
