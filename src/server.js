"use strict";

// Deprecated. Canonical boot lives in src/daemon2.js.
// Use npm start or node src/daemon2.js instead.

console.warn("zot: src/server.js is deprecated. Use src/daemon2.js.");

module.exports = require("./daemon2");

if (require.main === module) {
	require("./daemon2").boot();
}
