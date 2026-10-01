"use strict";

// Skills plus MCP loader. A skill is one JSON file in skills/:
// { name, description, tools: [{ name, command }] }.
// An MCP server is a skill entry with { mcp: { command, args } }.
// Loader is synchronous and never throws. Executor runs local echo
// tools and canned MCP stubs through the same switch.
const fs = require("node:fs");
const path = require("node:path");

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

module.exports = { loadSkills, skillToolNames, execSkill };
