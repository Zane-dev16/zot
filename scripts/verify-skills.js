"use strict";
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const skills = require("../src/skills");

const dir = path.join(__dirname, "..", "skills");
const loaded = skills.loadSkills(dir);
assert.ok(
	loaded.tools.some((t) => t.name === "local.echo"),
	"disk skills include local.echo",
);
assert.ok(
	loaded.tools.some((t) => t.name === "mcp.ping"),
	"disk skills include mcp.ping",
);
console.log("PASS disk loader finds local echo and mcp stub");

const echo = skills.execSkill("local.echo", { text: "hi" });
assert.strictEqual(echo.text, "hi", "local echo returns input text");
console.log("PASS local echo keeps working");

const stub = skills.execSkill("mcp.ping", { text: "hi" });
assert.strictEqual(stub.ok, true, "mcp stub keeps ok shape");
assert.strictEqual(stub.mcp, "mcp.ping", "mcp stub keeps tool name");
console.log("PASS canned mcp stub shape kept");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "zot-skills-"));
const serverPath = path.join(tmp, "pong.js");
fs.writeFileSync(
	serverPath,
	'"use strict";\n' +
		'const fs = require("node:fs");\n' +
		'const s = fs.readFileSync(0, "utf8");\n' +
		'process.stdout.write("pong:" + s);\n',
);
const slowPath = path.join(tmp, "slow.js");
fs.writeFileSync(
	slowPath,
	'"use strict";\nsetTimeout(() => process.stdout.write("late"), 2000);\n',
);
const pongDef = {
	name: "mcp.pong",
	mcp: { command: process.execPath, args: [serverPath] },
};
const slowDef = {
	name: "mcp.slow",
	mcp: { command: process.execPath, args: [slowPath] },
};

assert.strictEqual(
	skills.findTool([pongDef], "mcp.pong"),
	pongDef,
	"registry finds tool by name",
);
assert.strictEqual(
	skills.findTool([pongDef], "mcp.missing"),
	null,
	"registry returns null for unknown tool",
);
console.log("PASS registry lookup by name");

assert.deepStrictEqual(
	skills.mcpAllowlist([pongDef, slowDef, { name: "local.echo" }]),
	[process.execPath],
	"allowlist collects one entry per command",
);
assert.strictEqual(
	skills.isMcpAllowed(process.execPath, [process.execPath]),
	true,
	"allowlist accepts listed command",
);
assert.strictEqual(
	skills.isMcpAllowed(process.execPath, ["other"]),
	false,
	"allowlist rejects unlisted command",
);
console.log("PASS allowlist accepts listed command only");

const spawned = skills.execMcpSync(
	pongDef,
	{ text: "hi" },
	{ timeoutMs: 3000 },
);
assert.strictEqual(spawned.ok, true, "spawn reaches ok");
assert.strictEqual(
	spawned.result,
	'pong:{"text":"hi"}',
	"spawn returns server stdout",
);
console.log("PASS stdio spawn returns server stdout");

const denied = skills.execMcpSync(
	pongDef,
	{ text: "hi" },
	{ allowlist: ["other"], timeoutMs: 3000 },
);
assert.strictEqual(denied.ok, false, "denied spawn reaches not ok");
assert.strictEqual(
	denied.error,
	"mcp command not allowed",
	"denied spawn names allowlist",
);
console.log("PASS unlisted command is denied");

const timed = skills.execMcpSync(slowDef, {}, { timeoutMs: 100 });
assert.strictEqual(timed.ok, false, "slow spawn reaches not ok");
assert.ok(timed.error, "slow spawn reports an error");
console.log("PASS slow server hits timeout");

const bad = skills.execMcpSync({ name: "mcp.bad" }, {}, { timeoutMs: 1000 });
assert.strictEqual(bad.ok, false, "bad definition reaches not ok");
assert.strictEqual(
	bad.error,
	"bad mcp definition",
	"bad definition names the cause",
);
console.log("PASS bad definition fails clean");

const routed = skills.execSkillToolSync(
	[pongDef],
	"local.echo",
	{ text: "yo" },
	{},
);
assert.strictEqual(routed.result, "yo", "routed echo returns text");
const routedMcp = skills.execSkillToolSync(
	[pongDef],
	"mcp.pong",
	{ text: "hi" },
	{
		timeoutMs: 3000,
	},
);
assert.strictEqual(
	routedMcp.result,
	'pong:{"text":"hi"}',
	"routed mcp spawns server",
);
console.log("PASS single entry keeps echo and spawns mcp");

fs.rmSync(tmp, { recursive: true, force: true });
console.log("ALL PASS");
