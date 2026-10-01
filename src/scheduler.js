"use strict";

function isJobDue(job, nowMs) {
	const now = nowMs === undefined ? Date.now() : nowMs;
	if (!job || typeof job !== "object") return false;
	if (job.enabled === false || job.enabled === 0) return false;
	if (!Number.isFinite(job.nextRunAt)) return false;
	return job.nextRunAt <= now;
}

function claimJob(stored, expectedNextRunAt, nowMs, computeNext) {
	const now = nowMs === undefined ? Date.now() : nowMs;
	if (!stored || typeof stored !== "object")
		return { claimed: false, job: stored };
	if (stored.nextRunAt !== expectedNextRunAt)
		return { claimed: false, job: stored };
	if (!isJobDue(stored, now)) return { claimed: false, job: stored };
	if (typeof computeNext !== "function") {
		throw new Error("computeNext must be a function");
	}
	const nextRunAt = computeNext(stored, now);
	if (!Number.isFinite(nextRunAt) || nextRunAt <= now) {
		throw new Error("computeNext must return a future timestamp");
	}
	return { claimed: true, job: { ...stored, nextRunAt } };
}

function tickJobs(jobs, nowMs, computeNext) {
	const now = nowMs === undefined ? Date.now() : nowMs;
	if (!Array.isArray(jobs)) throw new Error("jobs must be an array");
	if (typeof computeNext !== "function") {
		throw new Error("computeNext must be a function");
	}
	const claimed = [];
	const pending = [];
	for (const job of jobs) {
		if (!isJobDue(job, now)) {
			pending.push(job);
			continue;
		}
		const res = claimJob(job, job.nextRunAt, now, computeNext);
		if (res.claimed) claimed.push(res.job);
		else pending.push(job);
	}
	return { claimed, pending };
}

function computeNextRunAtInterval(intervalMs) {
	if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
		throw new Error("intervalMs must be positive");
	}
	return (job, nowMs) => {
		const now = nowMs === undefined ? Date.now() : nowMs;
		const base = Number.isFinite(job.nextRunAt) ? job.nextRunAt : now;
		let next = base + intervalMs;
		while (next <= now) next += intervalMs;
		return next;
	};
}

function markJobRun(job, runId, nowMs) {
	const now = nowMs === undefined ? Date.now() : nowMs;
	if (!job || typeof job !== "object") throw new Error("job must be an object");
	return { ...job, lastRunId: runId, updatedAt: now };
}

module.exports = {
	isJobDue,
	claimJob,
	tickJobs,
	computeNextRunAtInterval,
	markJobRun,
};
