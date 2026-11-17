// Activity view: the dense ledger of the newest runs. Rows select in the
// inspector; the filter is client-side over the same list, so `all` is the
// default and every row is present for the screenshot harness.
//
// Explicit states (M4): loading, empty (per filter), and error are separate
// messages, and #activityError keeps a stale list visible rather than blanking
// the ledger. Keyboard: Up/Down/Home/End walk the rows, Left/Right walk the
// filter chips.

import { h, keyed } from "../dom.js";
import { relTime, shortId, stateLabel, titleOf } from "../format.js";
import { selectActivity } from "../store.js";

const FILTERS = ["all", "waiting_tool", "running", "failed", "done"];

const EMPTY_COPY = {
	all: "no runs yet",
	waiting_tool: "nothing is waiting on you",
	running: "nothing is running",
	failed: "no failed runs",
	done: "nothing has finished yet",
};

/**
 * @param {object} load runs.load
 * @param {string} filter
 * @param {number} known
 * @param {number} shown
 * @returns {string}
 */
function emptyCopy(load, filter, known, shown) {
	if (shown > 0) return "";
	if (known === 0) {
		if (load.status === "loading") return "loading runs…";
		if (load.status === "error") return "could not load runs — use Refresh to retry";
		return EMPTY_COPY.all;
	}
	return EMPTY_COPY[filter] || EMPTY_COPY.all;
}

/**
 * @param {Document} doc
 * @param {{refreshRuns: () => void, select: (id: string, origin?: Element|null) => void, filter: (filter: string) => void}} actions
 */
export function createActivityView(doc, actions) {
	const list = doc.getElementById("activity");
	const count = doc.getElementById("activityCount");
	const error = doc.getElementById("activityError");
	const empty = doc.getElementById("activityEmpty");
	const refresh = doc.getElementById("refreshActivity");
	const filter = doc.getElementById("activityFilter");

	if (refresh) refresh.addEventListener("click", () => actions.refreshRuns());

	if (filter) {
		filter.addEventListener("click", (event) => {
			const target = event.target instanceof Element ? event.target.closest("button[data-filter]") : null;
			if (!target) return;
			const value = target.getAttribute("data-filter") || "all";
			if (!FILTERS.includes(value)) return;
			actions.filter(value);
		});
		filter.addEventListener("keydown", (event) => {
			const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
			if (!keys.includes(event.key)) return;
			const chips = Array.from(filter.querySelectorAll("button[data-filter]"));
			const current = event.target instanceof Element ? event.target.closest("button[data-filter]") : null;
			if (!chips.length || !current) return;
			event.preventDefault();
			const index = chips.indexOf(current);
			let next = index;
			if (event.key === "ArrowLeft") next = (index - 1 + chips.length) % chips.length;
			else if (event.key === "ArrowRight") next = (index + 1) % chips.length;
			else if (event.key === "Home") next = 0;
			else next = chips.length - 1;
			chips[next].focus();
			actions.filter(chips[next].getAttribute("data-filter") || "all");
		});
		for (const button of filter.querySelectorAll("button[data-filter]")) {
			if (!button.hasAttribute("aria-pressed")) button.setAttribute("aria-pressed", "false");
		}
	}

	if (list) {
		list.addEventListener("keydown", (event) => {
			const keys = ["ArrowDown", "ArrowUp", "Home", "End"];
			if (!keys.includes(event.key)) return;
			const buttons = Array.from(list.querySelectorAll("button.activityRun"));
			const current = event.target instanceof Element ? event.target.closest("button.activityRun") : null;
			if (!buttons.length || !current) return;
			event.preventDefault();
			const index = buttons.indexOf(current);
			let next = index;
			if (event.key === "ArrowDown") next = Math.min(buttons.length - 1, index + 1);
			else if (event.key === "ArrowUp") next = Math.max(0, index - 1);
			else if (event.key === "Home") next = 0;
			else next = buttons.length - 1;
			buttons[next].focus();
		});
	}

	/**
	 * @param {object} run
	 * @returns {HTMLElement}
	 */
	function createRow(run) {
		const button = h("button", {
			class: "activityRun",
			type: "button",
			"aria-label": "Show tool events for " + titleOf(run),
			onclick: (event) => actions.select(run.id, event.currentTarget),
		});
		return h("li", { dataset: { runId: run.id, state: "" } }, button);
	}

	/**
	 * @param {HTMLElement} node
	 * @param {object} run
	 * @param {number} now
	 */
	function updateRow(node, run, now) {
		node.dataset.state = run.state || "";
		const button = node.querySelector("button.activityRun");
		if (!button) return;
		button.setAttribute("aria-label", "Show tool events for " + titleOf(run));
		const updated = relTime(run.updatedAt, now);
		const parts = [stateLabel(run.state) || "unknown", titleOf(run), shortId(run.id), "attempt " + (Number(run.attempt) || 1)];
		if (updated) parts.push(updated);
		button.textContent = parts.join(" · ");
	}

	return {
		/**
		 * @param {object} state
		 * @param {number} now
		 */
		update(state, now) {
			const load = state.runs.load;
			if (error) error.textContent = load.status === "error" ? load.error || "load failed" : "";
			if (filter) {
				for (const button of filter.querySelectorAll("button[data-filter]")) {
					const active = (button.getAttribute("data-filter") || "all") === state.ui.activityFilter;
					button.setAttribute("aria-pressed", active ? "true" : "false");
				}
			}
			const rows = selectActivity(state);
			if (count) count.textContent = rows.length ? rows.length + " shown" : "";
			if (empty) {
				const copy = emptyCopy(load, state.ui.activityFilter, state.runs.order.length, rows.length);
				empty.hidden = copy === "";
				if (copy) empty.textContent = copy;
			}
			if (!list) return;
			keyed(
				list,
				rows,
				(run) => run.id,
				createRow,
				(node, run) => updateRow(node, run, now),
			);
		},
	};
}
