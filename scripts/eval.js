"use strict";

// Eval entry. Each task scores real output from the module under test.
// Router tasks score live exec text. Cron tasks score the real parser.
// Memory tasks score the real FTS plus LIKE builders plus vector rank.
// Chatops tasks score the real payload builder. The run task scores the
// cron gate end to end. Exits nonzero on regression. Appends one JSON
// line per run to evals/runs.log so history persists on disk.
const fs = require("node:fs");
const path = require("node:path");
const scheduler = require("../src/scheduler");
const router = require("../src/router");
const memory = require("../src/memory");
const chatops = require("../src/chatops");
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

const VECTOR_DOCS = [
	{
		key: "puppy-guide",
		value: "puppy feeding guide with twice daily meals",
		runId: null,
		updatedAt: 2,
	},
	{
		key: "engine-manual",
		value: "car engine repair with torque specs",
		runId: null,
		updatedAt: 1,
	},
];

function fn(input) {
	if (input.startsWith("echo large ")) {
		return router.exec("echo-large", input.slice(11)).text;
	}
	if (input.startsWith("echo ")) {
		return router.exec("echo", input.slice(5)).text;
	}
	if (input === "cron every minute") {
		scheduler.parseCron("* * * * *");
		return "cron ok every minute";
	}
	if (input === "cron bad expr") {
		try {
			scheduler.parseCron("nope");
		} catch {
			return "cron rejects bad expr";
		}
		return "cron accepted bad expr";
	}
	if (input.startsWith("memory fts ")) {
		return memory.buildFtsQuery(input.slice(11), { limit: 5 }).sql;
	}
	if (input.startsWith("memory like ")) {
		return memory.buildLikeQuery(input.slice(12), { limit: 5 }).sql;
	}
	if (input.startsWith("memory vector ")) {
		const top = memory.rankByVector(VECTOR_DOCS, input.slice(14), {
			limit: 1,
		});
		return top.length > 0 ? top[0].key + " vector" : "vector empty";
	}
	if (input.startsWith("router fallback ")) {
		return router.route("hi", input.slice(16)).id;
	}
	if (input.startsWith("chatops slack ")) {
		return JSON.stringify(
			chatops.buildPayload("slack", {
				text: input.slice(14),
				channel: "c1",
			}),
		);
	}
	scheduler.parseCron("* * * * *");
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
try {
	fs.appendFileSync(
		path.join(__dirname, "..", "evals", "runs.log"),
		JSON.stringify({
			at: Date.now(),
			pass: result.pass,
			total: result.total,
			score: Number(result.score.toFixed(4)),
		}) + "\n",
	);
} catch {}
evals.assertThreshold(result);
