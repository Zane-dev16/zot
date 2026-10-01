"use strict";

// Eval harness. Dataset is [{ input, expect }]. Score counts how many
// fn(input) results contain expect. runEval returns { pass, total,
// score } and throws below threshold so scripts fail loudly.
function runEval(dataset, fn, threshold) {
	if (!Array.isArray(dataset)) throw new Error("dataset must be an array");
	if (typeof fn !== "function") throw new Error("fn must be a function");
	const t = threshold == null ? 1 : threshold;
	let pass = 0;
	const details = [];
	for (const item of dataset) {
		const got = String(fn(item.input));
		const ok = got.indexOf(String(item.expect)) !== -1;
		if (ok) pass += 1;
		details.push({
			input: item.input,
			expect: item.expect,
			got: got.slice(0, 200),
			ok,
		});
	}
	return {
		pass,
		total: dataset.length,
		score: dataset.length ? pass / dataset.length : 1,
		details,
		threshold: t,
	};
}

function assertThreshold(result) {
	if (result.score < result.threshold) {
		throw new Error(
			"eval regression: " +
				result.pass +
				"/" +
				result.total +
				" below " +
				result.threshold,
		);
	}
	return result;
}

module.exports = { runEval, assertThreshold };
