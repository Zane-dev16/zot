"use strict";

const crypto = require("crypto");
const path = require("path");
const events = require("./events");

const DEFAULT_ALLOWLIST = ["read_file", "write_file", "shell"];
const NETWORK_TOOLS = ["fetch"];
const TIMEOUT_DEFAULT_MS = 10000;
const LEASE_TTL_MS = 60000;

const LEASE_TRANSITIONS = { held: ["done", "expired"], done: [], expired: [] };

function stableStringify(value) {
	if (value === null || typeof value !== "object") return JSON.stringify(value);
	if (Array.isArray(value))
		return "[" + value.map(stableStringify).join(",") + "]";
	const keys = Object.keys(value).sort();
	return (
		"{" +
		keys
			.map((k) => JSON.stringify(k) + ":" + stableStringify(value[k]))
			.join(",") +
		"}"
	);
}

function hashArgs(args) {
	return crypto
		.createHash("sha256")
		.update(stableStringify(args))
		.digest("hex");
}

function isAllowed(tool, allowlist) {
	return (allowlist || DEFAULT_ALLOWLIST).indexOf(tool) !== -1;
}

function needsNetworkFlag(tool) {
	return NETWORK_TOOLS.indexOf(tool) !== -1;
}

function resolveInRoot(root, target) {
	const abs = path.resolve(root, target);
	const norm = path.normalize(abs);
	const base = path.normalize(path.resolve(root));
	if (norm !== base && norm.indexOf(base + path.sep) !== 0) {
		throw new Error("path escapes jail");
	}
	return norm;
}

function validateArgs(tool, args) {
	if (!args || typeof args !== "object") return "args must be an object";
	if (tool === "shell") {
		if (typeof args.command !== "string" || !args.command)
			return "shell needs command";
		return null;
	}
	if (tool === "read_file" || tool === "write_file") {
		if (typeof args.path !== "string" || !args.path)
			return "file tools need path";
		if (tool === "write_file" && typeof args.content !== "string")
			return "write_file needs content";
		return null;
	}
	return null;
}

function canLeaseTransition(from, to) {
	return (LEASE_TRANSITIONS[from] || []).indexOf(to) !== -1;
}

function transitionLease(lease, to, now) {
	if (!canLeaseTransition(lease.state, to))
		throw new Error("bad lease transition");
	const next = Object.assign({}, lease, { state: to });
	if (to !== "held") next.releasedAt = now == null ? Date.now() : now;
	return next;
}

function acquireLease(existing, input) {
	const now = input.now == null ? Date.now() : input.now;
	const ttl = input.ttlMs == null ? LEASE_TTL_MS : input.ttlMs;
	if (!existing) {
		return {
			action: "insert",
			lease: {
				id: input.id,
				runId: input.runId,
				tool: input.tool,
				argsHash: input.argsHash,
				state: "held",
				acquiredAt: now,
				expiresAt: now + ttl,
				releasedAt: null,
			},
		};
	}
	if (existing.state === "done") return { action: "reuse", lease: existing };
	if (existing.state === "expired") {
		return {
			action: "reacquire",
			lease: Object.assign({}, existing, {
				state: "held",
				acquiredAt: now,
				expiresAt: now + ttl,
				releasedAt: null,
			}),
		};
	}
	if (existing.expiresAt <= now) {
		return {
			action: "reacquire",
			lease: Object.assign({}, existing, {
				state: "held",
				acquiredAt: now,
				expiresAt: now + ttl,
				releasedAt: null,
			}),
		};
	}
	return { action: "deny", lease: existing, reason: "lease-held" };
}

function withTimeout(promise, ms) {
	let timer = null;
	const timeout = new Promise((_, reject) => {
		timer = setTimeout(() => reject(new Error("tool timeout")), ms);
	});
	return Promise.race([promise, timeout]).then(
		(value) => {
			clearTimeout(timer);
			return value;
		},
		(err) => {
			clearTimeout(timer);
			throw err;
		},
	);
}

function persistToolEvent(db, fields, now) {
	const at = now == null ? Date.now() : now;
	return db
		.prepare(
			"INSERT INTO tool_event(run_id, tool, args_hash, result_ref, created_at) VALUES (?, ?, ?, ?, ?)",
		)
		.run(
			fields.runId,
			fields.tool,
			fields.argsHash,
			fields.resultRef || null,
			at,
		);
}

async function executeTool(input) {
	const allowlist = input.allowlist || DEFAULT_ALLOWLIST;
	const timeoutMs =
		input.timeoutMs == null ? TIMEOUT_DEFAULT_MS : input.timeoutMs;
	const outcome = { ok: false, error: null, result: null, lease: null };

	const leaseStep = acquireLease(input.existingLease || null, {
		id: input.leaseId,
		runId: input.runId,
		tool: input.tool,
		argsHash: hashArgs(input.args),
		now: input.now,
		ttlMs: input.ttlMs,
	});
	if (leaseStep.action === "deny") {
		outcome.error = leaseStep.reason;
		return outcome;
	}
	if (leaseStep.action === "reuse") {
		outcome.ok = true;
		outcome.lease = leaseStep.lease;
		outcome.result = { reused: true };
		return outcome;
	}
	outcome.lease = leaseStep.lease;

	if (!isAllowed(input.tool, allowlist)) {
		outcome.error = "tool not allowed";
		return outcome;
	}
	if (needsNetworkFlag(input.tool) && !input.allowNetwork) {
		outcome.error = "network tools need explicit flag";
		return outcome;
	}
	const argError = validateArgs(input.tool, input.args);
	if (argError) {
		outcome.error = argError;
		return outcome;
	}
	if (
		input.root &&
		(input.tool === "read_file" || input.tool === "write_file")
	) {
		try {
			resolveInRoot(input.root, input.args.path);
		} catch (err) {
			outcome.error = err.message;
			return outcome;
		}
	}

	if (input.log) {
		events.appendToolEvent(input.log, {
			runId: input.runId,
			tool: input.tool,
			argsHash: outcome.lease.argsHash,
			kind: "request",
		});
	}
	if (input.db) {
		persistToolEvent(
			input.db,
			{
				runId: input.runId,
				tool: input.tool,
				argsHash: outcome.lease.argsHash,
				resultRef: "request",
			},
			input.now,
		);
	}
	try {
		const raw = input.executor({
			tool: input.tool,
			args: input.args,
			root: input.root,
			lease: outcome.lease,
		});
		const result = await withTimeout(Promise.resolve(raw), timeoutMs);
		outcome.ok = true;
		outcome.result = result;
		outcome.lease = transitionLease(outcome.lease, "done", input.now);
		if (input.log) {
			events.appendToolEvent(input.log, {
				runId: input.runId,
				tool: input.tool,
				argsHash: outcome.lease.argsHash,
				resultRef:
					typeof result === "string"
						? result.slice(0, 200)
						: stableStringify(result).slice(0, 200),
			});
		}
		if (input.db) {
			persistToolEvent(
				input.db,
				{
					runId: input.runId,
					tool: input.tool,
					argsHash: outcome.lease.argsHash,
					resultRef:
						typeof result === "string"
							? result.slice(0, 200)
							: stableStringify(result).slice(0, 200),
				},
				input.now,
			);
		}
	} catch (err) {
		outcome.error = err && err.message ? err.message : String(err);
		const timedOut = outcome.error === "tool timeout";
		outcome.lease = transitionLease(
			outcome.lease,
			timedOut ? "expired" : "done",
			input.now,
		);
		if (input.log) {
			events.appendToolEvent(input.log, {
				runId: input.runId,
				tool: input.tool,
				argsHash: outcome.lease.argsHash,
				resultRef: "error:" + outcome.error.slice(0, 200),
			});
		}
		if (input.db) {
			persistToolEvent(
				input.db,
				{
					runId: input.runId,
					tool: input.tool,
					argsHash: outcome.lease.argsHash,
					resultRef: "error:" + outcome.error.slice(0, 200),
				},
				input.now,
			);
		}
	}
	return outcome;
}

const LEASE_DDL = [
	"CREATE TABLE IF NOT EXISTS tool_lease(",
	"  id TEXT PRIMARY KEY,",
	"  run_id TEXT NOT NULL REFERENCES agent_run(id) ON DELETE CASCADE,",
	"  tool TEXT NOT NULL,",
	"  args_hash TEXT NOT NULL,",
	"  state TEXT NOT NULL,",
	"  acquired_at INTEGER NOT NULL,",
	"  expires_at INTEGER NOT NULL,",
	"  released_at INTEGER,",
	"  UNIQUE(run_id, args_hash)",
	");",
].join("\n");

module.exports = {
	DEFAULT_ALLOWLIST,
	NETWORK_TOOLS,
	TIMEOUT_DEFAULT_MS,
	LEASE_TTL_MS,
	LEASE_DDL,
	hashArgs,
	isAllowed,
	needsNetworkFlag,
	resolveInRoot,
	validateArgs,
	canLeaseTransition,
	transitionLease,
	acquireLease,
	withTimeout,
	persistToolEvent,
	executeTool,
};
