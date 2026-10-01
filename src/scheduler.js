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

const CRON_RANGES = [
	[0, 59],
	[0, 23],
	[1, 31],
	[1, 12],
	[0, 7],
];

function parseCronField(field, min, max) {
	if (typeof field !== "string" || field.length === 0) {
		throw new Error("cron field must be a nonempty string");
	}
	const values = new Set();
	const parts = field.split(",");
	for (const part of parts) {
		const [base, stepRaw] = part.split("/");
		const step = stepRaw === undefined ? 1 : Number(stepRaw);
		if (!Number.isInteger(step) || step <= 0) {
			throw new Error("bad cron step: " + part);
		}
		let lo;
		let hi;
		if (base === "*") {
			lo = min;
			hi = max;
		} else if (base.includes("-")) {
			const [aRaw, bRaw] = base.split("-");
			lo = Number(aRaw);
			hi = Number(bRaw);
		} else {
			lo = Number(base);
			hi = lo;
		}
		if (!Number.isInteger(lo) || !Number.isInteger(hi)) {
			throw new Error("bad cron field: " + part);
		}
		if (lo < min || hi > max || lo > hi) {
			throw new Error("cron field out of range: " + part);
		}
		for (let v = lo; v <= hi; v += step) values.add(v);
	}
	return values;
}

function parseCron(expr) {
	if (typeof expr !== "string") throw new Error("cron must be a string");
	const fields = expr.trim().split(/\s+/);
	if (fields.length !== 5) throw new Error("cron must have 5 fields");
	const out = fields.map((f, i) =>
		parseCronField(f, CRON_RANGES[i][0], CRON_RANGES[i][1]),
	);
	const [minute, hour, dom, month, dow] = out;
	if (dow.has(7)) {
		dow.delete(7);
		dow.add(0);
	}
	return {
		minute,
		hour,
		dom,
		month,
		dow,
		domIsStar: fields[2] === "*",
		dowIsStar: fields[4] === "*",
	};
}

function isCronMatch(sched, date) {
	const d = date instanceof Date ? date : new Date(date);
	const minute = d.getUTCMinutes();
	const hour = d.getUTCHours();
	const dom = d.getUTCDate();
	const month = d.getUTCMonth() + 1;
	const dow = d.getUTCDay();
	if (!sched.minute.has(minute)) return false;
	if (!sched.hour.has(hour)) return false;
	if (!sched.month.has(month)) return false;
	const domOk = sched.dom.has(dom);
	const dowOk = sched.dow.has(dow);
	if (sched.domIsStar && sched.dowIsStar) return true;
	if (sched.domIsStar) return dowOk;
	if (sched.dowIsStar) return domOk;
	return domOk || dowOk;
}

function nextCronRunAt(exprOrSched, fromMs) {
	const now = fromMs === undefined ? Date.now() : fromMs;
	if (!Number.isFinite(now)) throw new Error("fromMs must be a number");
	const sched =
		typeof exprOrSched === "string" ? parseCron(exprOrSched) : exprOrSched;
	if (!sched || typeof sched !== "object") throw new Error("bad schedule");
	let t = Math.floor(now / 60000) * 60000 + 60000;
	const limit = 366 * 24 * 60;
	for (let i = 0; i < limit; i++) {
		if (isCronMatch(sched, new Date(t))) return t;
		t += 60000;
	}
	throw new Error("no cron run found within a year");
}

function computeNextRunAtCron(cronExpr) {
	if (cronExpr !== undefined && typeof cronExpr !== "string") {
		throw new Error("cronExpr must be a string");
	}
	return (job, nowMs) => {
		const expr = job && typeof job.cron === "string" ? job.cron : cronExpr;
		if (typeof expr !== "string") throw new Error("job.cron must be a string");
		return nextCronRunAt(expr, nowMs);
	};
}

module.exports = {
	isJobDue,
	claimJob,
	tickJobs,
	computeNextRunAtInterval,
	markJobRun,
	parseCron,
	isCronMatch,
	nextCronRunAt,
	computeNextRunAtCron,
};
