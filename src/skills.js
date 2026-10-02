"use strict";

// Skills plus MCP loader. A skill is one JSON file in skills/:
// { name, description, tools: [{ name, command }] }.
// An MCP server is a skill entry with { mcp: { command, args } }.
// Loader is synchronous and never throws. Executor runs local echo
// tools and canned MCP stubs through the same switch.
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const MCP_TIMEOUT_MS = 5000;
const MCP_MAX_BUFFER = 512 * 1024;
const MCP_MAX_TEXT = 2000;

function loadSkills(dir) {
	const out = { tools: [], errors: [] };
	let files = [];
	try {
		files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
	} catch {
		return out;
	}
	for (const f of files) {
		try {
			const raw = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
			const tools = Array.isArray(raw.tools) ? raw.tools : [];
			for (const t of tools) {
				if (t && typeof t.name === "string" && t.name) out.tools.push(t);
			}
		} catch (err) {
			out.errors.push(
				f + ": " + (err && err.message ? err.message : String(err)),
			);
		}
	}
	return out;
}

function skillToolNames(dir) {
	return loadSkills(dir).tools.map((t) => t.name);
}

function execSkill(tool, args) {
	if (tool === "local.echo") return { text: String((args && args.text) || "") };
	if (tool.indexOf("mcp.") === 0)
		return { mcp: tool, ok: true, args: args || {} };
	return null;
}

function findTool(tools, name) {
	if (!Array.isArray(tools) || typeof name !== "string") return null;
	for (const t of tools) {
		if (t && t.name === name) return t;
	}
	return null;
}

function mcpAllowlist(tools) {
	if (!Array.isArray(tools)) return [];
	const out = [];
	for (const t of tools) {
		if (t && t.mcp && typeof t.mcp.command === "string" && t.mcp.command) {
			if (out.indexOf(t.mcp.command) === -1) out.push(t.mcp.command);
		}
	}
	return out;
}

function isMcpAllowed(command, allowlist) {
	if (typeof command !== "string" || !command) return false;
	if (!Array.isArray(allowlist)) return false;
	return allowlist.indexOf(command) !== -1;
}

function execMcpSync(toolDef, args, opts) {
	const o = opts || {};
	const timeoutMs = o.timeoutMs == null ? MCP_TIMEOUT_MS : o.timeoutMs;
	const def = toolDef && toolDef.mcp ? toolDef.mcp : null;
	if (!def || typeof def.command !== "string" || !def.command) {
		return { ok: false, error: "bad mcp definition", result: null };
	}
	const argv = Array.isArray(def.args) ? def.args : [];
	for (const a of argv) {
		if (typeof a !== "string") {
			return { ok: false, error: "bad mcp definition", result: null };
		}
	}
	const allowlist = Array.isArray(o.allowlist) ? o.allowlist : [def.command];
	if (!isMcpAllowed(def.command, allowlist)) {
		return { ok: false, error: "mcp command not allowed", result: null };
	}
	let input = "{}";
	try {
		input = JSON.stringify(args == null ? {} : args);
	} catch {
		return { ok: false, error: "args not serializable", result: null };
	}
	const r = spawnSync(def.command, argv, {
		input,
		timeout: timeoutMs,
		maxBuffer: MCP_MAX_BUFFER,
		encoding: "utf8",
		shell: false,
	});
	if (r.error) {
		return {
			ok: false,
			error: r.error.message || String(r.error),
			result: null,
		};
	}
	if (r.signal) {
		return { ok: false, error: "mcp timeout or signal", result: null };
	}
	if (r.status !== 0) {
		const tail = String(r.stderr || r.stdout || "").slice(0, 200);
		return { ok: false, error: tail || "mcp exit nonzero", result: null };
	}
	return {
		ok: true,
		error: null,
		result: String(r.stdout || "").slice(0, MCP_MAX_TEXT),
	};
}

function execSkillToolSync(tools, tool, args, opts) {
	if (tool === "local.echo") {
		return { ok: true, error: null, result: String((args && args.text) || "") };
	}
	if (typeof tool === "string" && tool.indexOf("mcp.") === 0) {
		const def = findTool(tools, tool);
		if (!def || !def.mcp) return { mcp: tool, ok: true, args: args || {} };
		return execMcpSync(def, args, opts);
	}
	return null;
}

module.exports = {
	loadSkills,
	skillToolNames,
	execSkill,
	findTool,
	mcpAllowlist,
	isMcpAllowed,
	execMcpSync,
	execSkillToolSync,
	MCP_TIMEOUT_MS,
};
