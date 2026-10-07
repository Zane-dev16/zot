"use strict";
const fs = require("node:fs");
const s = fs.readFileSync(0, "utf8");
process.stdout.write("echo:" + s);
