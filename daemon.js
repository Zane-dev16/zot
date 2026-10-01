"use strict";

// Legacy entry point. Canonical boot lives in src/daemon2.js.
// This shim execs the canonical daemon so old commands keep working.

if (require.main === module) {
	const path = require("node:path");
	const { spawnSync } = require("node:child_process");
	const target = path.join(__dirname, "src", "daemon2.js");
	const r = spawnSync(process.execPath, [target, ...process.argv.slice(2)], {
		stdio: "inherit",
		env: process.env,
	});
	process.exit(r.status === null ? 1 : r.status);
} else {
	module.exports = require("./src/daemon2");
}
