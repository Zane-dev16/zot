// Activity view: the dense ledger of the newest runs. Rows select in the
// inspector; the filter is client-side over the same list, so `all` is the
// default and every row is present for the screenshot harness.

import { h, keyed } from "../dom.js";
import { relTime, shortId, stateLabel, titleOf } from "../format.js";
import { selectActivity } from "../store.js";

const FILTERS = ["all", "waiting_tool", "running", "failed", "done"];

/**
 * @param {Document} doc
 * @param {{refreshRuns: () => void, select: (id: string) => void, filter: (filter: string) => void}} actions
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
		for (const button of filter.querySelectorAll("button[data-filter]")) {
			if (!button.hasAttribute("aria-pressed")) button.setAttribute("aria-pressed", "false");
		}
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
				const known = state.runs.order.length;
				empty.hidden = rows.length > 0 || known === 0;
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
