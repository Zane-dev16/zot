#!/usr/bin/env node
// The web gate: one command proves the console offline, before any browser runs.
//
//   1. every module parses as an ES module
//   2. the import graph is closed, relative-only, and reachable from js/main.js
//   3. web/build.json exists and its sourceHash matches the sources (no stale
//      manifest can pass silently; a missing one fails, never SKIPs)
//   4. the screenshot selector contract is present in the sources
//   5. web/** loads no external asset
//   6. the console layout contract: a 13ch state column on both list surfaces,
//      and a state flash that prefers-reduced-motion switches off
//
// Usage: node scripts/verify-web.mjs
// Exit: 0 all checks pass, 1 any check fails (each failure names its file).

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
	ENTRY_REL,
	MANIFEST_REL,
	WEB_DIR,
	analyseGraph,
	computeSourceHash,
	fileDigests,
	scanWeb,
} from "./lib/webbuild.mjs";

// The screenshot contract from the rework plan (§4.7). Every handle here is
// asserted by scripts/verify-shots.sh or the skill; dropping one must fail the
// gate offline instead of in a browser 30 seconds later.
const SELECTOR_CONTRACT = [
	"#app",
	"#status",
	"#retryCount",
	"#retryNow",
	"#daemon",
	"#build",
	"#variantSwitch",
	"#navChat",
	"#navApprovals",
	"#navActivity",
	"#navPairing",
	"#approvalsCount",
	"#runsCount",
	"#view-chat",
	"#view-approvals",
	"#view-activity",
	"#view-pairing",
	"#viewTitle",
	"#chatOlder",
	"#log",
	"#chatError",
	"#chatEmpty",
	"#composer",
	"#box",
	"#send",
	"#composerHint",
	".runTitle",
	".runHead",
	".runBadge",
	".runMeta",
	".runTokens",
	".runToolNote",
	".runNeedsApproval",
	".inspectorOpen",
	".approvalRow",
	".approvalPrompt",
	'data-action="approve"',
	'data-action="cancel"',
	"#approvals",
	"#approvalsRefresh",
	"#approvalsError",
	"#approvalsEmpty",
	"#activityFilter",
	"#activityCount",
	"#activity",
	"#activityEmpty",
	"#activityError",
	"#refreshActivity",
	".activityRun",
	".activityState",
	"#auth",
	"#token",
	"#saveToken",
	"#pairStart",
	"#pairCode",
	"#pairExpiry",
	"#pairConfirm",
	"#pairStatus",
	"#pairNote",
	"#deviceSummary",
	"#pairFallback",
	"#pairRetry",
	"#pairDone",
	"#tokenError",
	"#signOut",
	"#inspector",
	"#inspectorTitle",
	"#inspectorTabs",
	"#inspectorBody",
	"#inspectorClose",
	"#inspectorGoApprove",
	".toolEvent",
	"#live",
	"data-flash",
	"data-inspector",
	"Device token",
	"Show tool events for",
];

const failures = [];

/** @param {string} message */
function fail(message) {
	failures.push(message);
}

const scan = scanWeb(WEB_DIR);
if (scan.files.length === 0) fail(`no web sources found under ${WEB_DIR}`);

// 1. ESM parse --------------------------------------------------------------
const modules = scan.files.filter((file) => file.rel.startsWith("js/") && file.kind === "js");
if (modules.length === 0) fail("no modules under web/js");
for (const file of modules) {
	const check = spawnSync(process.execPath, ["--input-type=module", "--check"], {
		input: file.text,
		encoding: "utf8",
	});
	if (check.error) {
		fail(`web/${file.rel}: could not run the module syntax check (${check.error.message})`);
	} else if (check.status !== 0) {
		const detail = String(check.stderr || "")
			.split("\n")
			.filter((line) => line.trim() && !line.includes("--input-type=module"))
			.slice(0, 4)
			.join(" ");
		fail(`web/${file.rel}: not a valid ES module (${detail || "syntax error"})`);
	}
}

// 2. import graph -----------------------------------------------------------
const graph = analyseGraph(scan);
for (const error of graph.errors) fail(`web/${error}`);
if (!graph.reachable.includes(ENTRY_REL)) fail(`web/${ENTRY_REL} is not reachable`);

// 3. manifest freshness -----------------------------------------------------
const manifestPath = path.join(WEB_DIR, MANIFEST_REL);
let manifest = null;
try {
	manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
} catch (err) {
	fail(`web/${MANIFEST_REL} is missing or unreadable (${err.code || err.message}); run node scripts/build-web.mjs`);
}
if (manifest) {
	const sourceHash = computeSourceHash(scan);
	if (manifest.version !== 1) fail(`web/${MANIFEST_REL}: unsupported version ${JSON.stringify(manifest.version)}`);
	if (manifest.sourceHash !== sourceHash) {
		const expected = fileDigests(scan);
		const committed = manifest.files && typeof manifest.files === "object" ? manifest.files : {};
		const changed = [];
		for (const [rel, digest] of Object.entries(expected)) {
			if (!committed[rel]) changed.push(rel + " (added)");
			else if (committed[rel] !== digest) changed.push(rel);
		}
		for (const rel of Object.keys(committed)) if (!expected[rel]) changed.push(rel + " (removed)");
		const detail = changed.length > 0 ? changed.slice(0, 6).join(", ") : "sourceHash mismatch";
		fail(`web build manifest is stale (${detail}); run node scripts/build-web.mjs`);
	}
	if (manifest.moduleCount !== graph.modules.length) {
		fail(
			`web build manifest is stale (moduleCount ${JSON.stringify(manifest.moduleCount)} != ${graph.modules.length}); run node scripts/build-web.mjs`,
		);
	}
}

// 4. selector contract ------------------------------------------------------
// A handle counts as present when the markup (or a view module) actually
// creates/uses it: id="x" in HTML, getElementById("x") in JS, or #x in CSS.
// Removing a handle from both markup and code fails here, offline.
/**
 * @param {string} token
 * @returns {string[]} acceptable spellings
 */
function spellings(token) {
	if (token.startsWith("#")) {
		const id = token.slice(1);
		return [`id="${id}"`, `getElementById("${id}")`, `#${id}`];
	}
	if (token.startsWith(".")) {
		const cls = token.slice(1);
		return [`class="${cls}"`, `class: "${cls}"`, `"${cls}"`, `.${cls}`];
	}
	return [token];
}
const corpus = scan.files.map((file) => file.text).join("\n");
for (const token of SELECTOR_CONTRACT) {
	const options = spellings(token);
	if (!options.some((option) => corpus.includes(option))) {
		fail(`selector contract: ${token} is missing from web/** (looked for ${options.join(" | ")})`);
	}
}

// 5. no external assets -----------------------------------------------------
const EXTERNAL = [
	/\b(?:href|src)\s*=\s*["'](?:https?:)?\/\//i,
	/\burl\(\s*["']?(?:https?:)?\/\//i,
];
for (const file of scan.files) {
	for (const pattern of EXTERNAL) {
		if (pattern.test(file.text)) {
			fail(`web/${file.rel}: external asset reference (${String(file.text.match(pattern)?.[0] || "").trim()}); the console must load with the network off`);
		}
	}
}

// 6. M6 console contract ----------------------------------------------------
// The state gutter is a fixed 13ch on both list surfaces, and the state flash
// is the one motion cue, so reduced-motion users must be able to switch it off
// in CSS. Both live in components.css (the console base); tty restates the
// columns, but a missing base rule would otherwise hide behind it. The browser
// harness measures the geometry; catching a dropped declaration here names the
// file before a browser starts.
const components = scan.files.find((file) => file.rel === "css/components.css");
const componentsCss = components ? components.text : "";
if (!componentsCss) fail("css/components.css is missing; the console base styling has nowhere to live");
if (!componentsCss.includes("grid-template-columns: 13ch minmax(0, 1fr) auto auto")) {
	fail("css/components.css: run headers lost their 13ch state column (grid-template-columns: 13ch minmax(0, 1fr) auto auto)");
}
if (!/flex:\s*0 0 13ch/.test(componentsCss)) {
	fail("css/components.css: activity rows lost their fixed state column (flex: 0 0 13ch)");
}
const reducedBlock = (componentsCss.match(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\n\}/) || [""])[0];
if (!/\[data-flash="true"\]/.test(reducedBlock) || !/animation:\s*none/.test(reducedBlock)) {
	fail('css/components.css: [data-flash="true"] is not switched off under prefers-reduced-motion');
}

// Report --------------------------------------------------------------------
if (failures.length > 0) {
	for (const message of failures) console.error("FAIL " + message);
	process.exit(1);
}
console.log(`PASS web modules parse (${graph.modules.length} ES modules)`);
console.log(`PASS web import graph (${graph.reachable.length} modules reachable from ${ENTRY_REL})`);
console.log(`PASS web build manifest fresh (sourceHash ${computeSourceHash(scan).slice(0, 12)})`);
console.log(`PASS web selector contract (${SELECTOR_CONTRACT.length} handles)`);
console.log("PASS web state column + reduced-motion flash contract");
console.log(`PASS web no external assets (${scan.files.length} files scanned)`);
console.log("PASS web gate");
