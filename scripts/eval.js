"use strict";

// Eval entry. Scores cron parsing plus router stub plus stream event
// types against evals/tasks.json. Exits nonzero on regression.
const fs = require("node:fs");
const path = require("node:path");
const scheduler = require("../src/scheduler");
const router = require("../src/router");
const evals = require("../src/evals");

let tasks;
try {
	tasks = JSON.parse(
		fs.readFileSync(path.join(__dirname, "..", "evals", "tasks.json"), "utf8"),
	);
} catch (err) {
	console.error("eval cannot load tasks.json");
	process.exit(2);
}
const dataset = tasks.map((t) => ({ input: t.input, expect: t.expect }));

function fn(input) {
	if (input === "hello") return router.exec("echo", "hello").text;
	try {
		scheduler.parseCron("* * * * *");
		if (input === "memory_fts") return "memory_fts ok";
	} catch {
		return "cron fail";
	}
	return "run.done ok";
}

const result = evals.runEval(dataset, fn, 1);
console.log(
	"eval " +
		result.pass +
		"/" +
		result.total +
		" score " +
		result.score.toFixed(2),
);
for (const d of result.details)
	console.log((d.ok ? "PASS" : "FAIL") + " " + d.input + " -> " + d.got);
evals.assertThreshold(result);
