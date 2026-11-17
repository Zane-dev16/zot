// Web build primitives (ADR-1: no bundler). One walk of web/** plus a narrow
// import-specifier regex: the module graph must be closed, relative-only, and
// fully reachable from web/js/main.js, and one path+content hash identifies the
// sources the committed web/build.json claims to describe.

import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, "..", "..");
export const WEB_DIR = path.join(REPO_ROOT, "web");
export const ENTRY_REL = "js/main.js";
export const MANIFEST_REL = "build.json";

const SCAN_EXT = new Set([".html", ".js", ".css"]);

/** @returns {string[]} relative paths under web/ with a scanned extension */
function walk(dir, prefix = "") {
	const out = [];
	for (const name of readdirSync(dir).sort()) {
		if (name.startsWith(".")) continue;
		const abs = path.join(dir, name);
		const rel = prefix ? prefix + "/" + name : name;
		const stat = statSync(abs);
		if (stat.isDirectory()) out.push(...walk(abs, rel));
		else if (SCAN_EXT.has(path.extname(name))) out.push(rel);
	}
	return out;
}

/**
 * Read every source file that the build describes.
 * @param {string} [root] web directory (tests may point elsewhere)
 * @returns {{root: string, files: Array<{rel: string, abs: string, text: string, kind: string}>}}
 */
export function scanWeb(root = WEB_DIR) {
	const files = walk(root).map((rel) => {
		const abs = path.join(root, rel);
		return { rel, abs, text: readFileSync(abs, "utf8"), kind: path.extname(rel).slice(1) };
	});
	return { root, files };
}

/**
 * Every module specifier in a module body.
 * @param {string} text
 * @returns {string[]}
 */
export function extractSpecifiers(text) {
	const found = [];
	const patterns = [
		/\bfrom\s*["']([^"']+)["']/g,
		/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
		/(?:^|[;\s])import\s*["']([^"']+)["']/g,
	];
	for (const pattern of patterns) {
		let match;
		while ((match = pattern.exec(text)) !== null) found.push(match[1]);
	}
	return found;
}

/**
 * @param {string} root
 * @param {string} fromRel
 * @param {string} specifier
 * @returns {{rel: string}|{error: string}}
 */
export function resolveSpecifier(root, fromRel, specifier) {
	if (!specifier.startsWith("./") && !specifier.startsWith("../")) {
		return { error: `bare specifier "${specifier}" (the console must never need node_modules)` };
	}
	const abs = path.normalize(path.resolve(path.dirname(path.join(root, fromRel)), specifier));
	if (!abs.startsWith(root + path.sep)) {
		return { error: `"${specifier}" resolves outside web/` };
	}
	const rel = path.relative(root, abs).split(path.sep).join("/");
	if (path.extname(abs) !== ".js") {
		return { error: `"${specifier}" is not a .js module (the daemon MIME map only serves .js)` };
	}
	try {
		if (!statSync(abs).isFile()) return { error: `"${specifier}" is not a file` };
	} catch {
		return { error: `"${specifier}" does not exist (${rel})` };
	}
	return { rel };
}

/**
 * Import graph for every module under web/js.
 * @param {{root: string, files: Array<{rel: string, text: string, kind: string}>}} scan
 * @returns {{errors: string[], modules: string[], edges: Record<string, string[]>, reachable: string[]}}
 */
export function analyseGraph(scan) {
	const modules = scan.files.filter((file) => file.rel.startsWith("js/") && file.kind === "js").map((file) => file.rel).sort();
	const byRel = new Map(scan.files.map((file) => [file.rel, file]));
	const errors = [];
	const edges = {};
	for (const rel of modules) {
		const file = byRel.get(rel);
		const imports = [];
		for (const specifier of extractSpecifiers(file.text)) {
			const resolved = resolveSpecifier(scan.root, rel, specifier);
			if (resolved.error) errors.push(`${rel}: ${resolved.error}`);
			else imports.push(resolved.rel);
		}
		edges[rel] = Array.from(new Set(imports));
	}
	const entry = ENTRY_REL;
	if (!modules.includes(entry)) {
		errors.push(`entry ${entry} is missing`);
		return { errors, modules, edges, reachable: [] };
	}
	const reachable = new Set();
	const queue = [entry];
	while (queue.length > 0) {
		const rel = queue.shift();
		if (reachable.has(rel)) continue;
		reachable.add(rel);
		for (const next of edges[rel] || []) queue.push(next);
	}
	for (const rel of modules) {
		if (!reachable.has(rel)) errors.push(`${rel} is not reachable from ${entry}`);
	}
	return { errors, modules, edges, reachable: Array.from(reachable).sort() };
}

/**
 * @param {{files: Array<{rel: string, text: string}>}} scan
 * @returns {Record<string, string>} rel path -> "sha256:<hex>"
 */
export function fileDigests(scan) {
	const digests = {};
	for (const file of scan.files) {
		digests[file.rel] = "sha256:" + createHash("sha256").update(file.text).digest("hex");
	}
	return digests;
}

/**
 * Path- and content-derived hash: identical on any clone, independent of the
 * manifest's build time.
 * @param {{files: Array<{rel: string, text: string}>}} scan
 * @returns {string}
 */
export function computeSourceHash(scan) {
	const lines = scan.files
		.map((file) => file.rel + "\u0000" + createHash("sha256").update(file.text).digest("hex"))
		.sort();
	return createHash("sha256").update(lines.join("\n") + "\n").digest("hex");
}

/**
 * Build the manifest object that web/build.json must contain.
 * @param {{root: string, files: Array<{rel: string, text: string, kind: string}>}} scan
 * @param {string} [builtAt] ISO timestamp (excluded from sourceHash)
 * @returns {object}
 */
export function buildManifest(scan, builtAt = new Date().toISOString()) {
	const graph = analyseGraph(scan);
	return {
		version: 1,
		moduleCount: graph.modules.length,
		sourceHash: computeSourceHash(scan),
		files: fileDigests(scan),
		builtAt,
	};
}
