"use strict";

// Thin wrapper. Canonical boot lives in daemon2.js.
// This file exists so old server2 commands keep working.

const daemon2 = require("./daemon2");

function boot(opts) {
	return daemon2.boot(opts);
}

if (require.main === module) {
	boot();
}

module.exports = { boot, createServer: daemon2.createServer };
