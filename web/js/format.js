// Formatting helpers. Pure functions only: no DOM, no clock reads outside the
// optional `now` argument, so the offline reducer test can exercise them.

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * First non-empty line of a prompt, trimmed.
 * @param {unknown} value
 * @returns {string}
 */
export function firstLine(value) {
	const text = String(value == null ? "" : value);
	for (const line of text.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (trimmed) return trimmed;
	}
	return "";
}

/**
 * Short id for display (first 8 chars). Always labelled by format.titleOf.
 * @param {unknown} id
 * @returns {string}
 */
export function shortId(id) {
	return String(id == null ? "" : id).slice(0, 8);
}

/**
 * A label that is never a bare UUID: the prompt's first line is the fallback,
 * and only an empty prompt falls back to `run · <short id>`.
 * @param {object|null|undefined} run
 * @returns {string}
 */
export function titleFallback(run) {
	const source = firstLine(run && run.prompt);
	if (source) return source.slice(0, 60);
	return "run · " + (shortId(run && run.id) || "unknown");
}

/**
 * The label a row shows. Server titles win; otherwise a labelled fallback.
 * @param {object|null|undefined} run
 * @returns {string}
 */
export function titleOf(run) {
	const title = run && typeof run.title === "string" ? run.title.trim() : "";
	if (title) return title;
	return titleFallback(run);
}

/**
 * Relative time, e.g. "12s ago". Empty string for a missing timestamp.
 * @param {number|null|undefined} at epoch milliseconds
 * @param {number} now epoch milliseconds
 * @returns {string}
 */
export function relTime(at, now = Date.now()) {
	const ms = Number(at);
	if (!Number.isFinite(ms) || ms <= 0) return "";
	const delta = Math.max(0, Number(now) - ms);
	if (delta < SECOND) return "just now";
	if (delta < MINUTE) return Math.floor(delta / SECOND) + "s ago";
	if (delta < HOUR) return Math.floor(delta / MINUTE) + "m ago";
	if (delta < DAY) return Math.floor(delta / HOUR) + "h ago";
	return Math.floor(delta / DAY) + "d ago";
}

/**
 * Compact duration for the daemon chip, e.g. "12s", "4m", "2h".
 * @param {number|null|undefined} ms
 * @returns {string}
 */
export function shortDuration(ms) {
	const n = Number(ms);
	if (!Number.isFinite(n) || n < 0) return "";
	if (n < MINUTE) return Math.max(0, Math.floor(n / SECOND)) + "s";
	if (n < HOUR) return Math.floor(n / MINUTE) + "m";
	return Math.floor(n / HOUR) + "h";
}

/**
 * Countdown clock, e.g. "4:37" for 277000ms. Never negative.
 * @param {number|null|undefined} ms
 * @returns {string}
 */
export function clock(ms) {
	const n = Number(ms);
	if (!Number.isFinite(n) || n <= 0) return "0:00";
	const total = Math.floor(n / SECOND);
	const minutes = Math.floor(total / 60);
	const seconds = total % 60;
	return minutes + ":" + String(seconds).padStart(2, "0");
}

/** Canonical state words. The badge repeats the word; color is never alone. */
const STATE_LABELS = {
	queued: "queued",
	running: "running",
	waiting_tool: "waiting_tool",
	done: "done",
	failed: "failed",
	cancelled: "cancelled",
};

/**
 * Human label for a run state (unknown states pass through as-is).
 * @param {unknown} state
 * @returns {string}
 */
export function stateLabel(state) {
	const key = String(state == null ? "" : state);
	return STATE_LABELS[key] || key || "unknown";
}
