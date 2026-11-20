#!/usr/bin/env node
// Write the committed web/build.json manifest. This is the whole "build":
// no bundler, no npm, no generated bundle in git (ADR-1). The manifest records
// the module count, per-file digests and one sourceHash; scripts/verify-web.mjs
// recomputes all of it and refuses a stale manifest.
//
// Usage: node scripts/build-web.mjs

import { writeFileSync } from "node:fs";
import path from "node:path";
import { WEB_DIR, buildManifest, scanWeb } from "./lib/webbuild.mjs";

const scan = scanWeb(WEB_DIR);
const manifest = buildManifest(scan);
const target = path.join(WEB_DIR, "build.json");
writeFileSync(target, JSON.stringify(manifest, null, "\t") + "\n");
console.log(
	`PASS build web (${manifest.moduleCount} modules, sourceHash ${manifest.sourceHash.slice(0, 12)})`,
);
