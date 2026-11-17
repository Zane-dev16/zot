// Approvals view: the attention queue, and the ONLY place that performs a run
// transition (ADR-3). Rows are the runs an operator can move: `waiting_tool`
// (approve → running, cancel → cancelled) and `queued` (approve → running),
// most recently updated first so blocking work sorts itself to the top.

import { h, keyed } from "../dom.js";
import { relTime, shortId, stateLabel, titleOf } from "../format.js";
import { selectApprovals } from "../store.js";

/**
 * @param {Document} doc
 * @param {{approve: (id: string) => void, cancel: (id: string) => void, select: (id: string, origin?: Element|null) => void, refreshRuns: () => void}} actions
 */
export function createApprovalsView(doc, actions) {
	const list = doc.getElementById("approvals");
	const error = doc.getElementById("approvalsError");
	const empty = doc.getElementById("approvalsEmpty");
	const refresh = doc.getElementById("approvalsRefresh");

	if (refresh) refresh.addEventListener("click", () => actions.refreshRuns());

	/**
	 * @param {object} run
	 * @returns {HTMLElement}
	 */
	function createRow(run) {
		const approve = h("button", {
			class: "btn",
			type: "button",
			dataset: { action: "approve" },
			text: "Approve",
			onclick: () => actions.approve(run.id),
		});
		const cancel = h("button", {
			class: "btn",
			type: "button",
			dataset: { action: "cancel" },
			text: "Cancel",
			onclick: () => actions.cancel(run.id),
		});
		return h(
			"li",
			{
				dataset: { runId: run.id, state: "" },
				onclick: (event) => {
					if (event.target instanceof Element && event.target.closest("button")) return;
					actions.select(run.id, event.currentTarget);
				},
			},
			h(
				"div",
				{ class: "approvalTitle" },
				h("span", { class: "runTitle" }),
				h("span", { class: "runBadge" }),
				h("span", { class: "runMeta" }),
			),
			h("p", { class: "approvalNote" }),
			h("div", { class: "approvalRow" }, approve, cancel),
		);
	}

	/**
	 * @param {HTMLElement} node
	 * @param {object} run
	 * @param {object} state
	 * @param {number} now
	 */
	function updateRow(node, run, state, now) {
		const busy = Boolean(state.approvals.pending[run.id]);
		const failure = state.approvals.error[run.id] || "";
		node.dataset.state = run.state || "";
		const title = node.querySelector(".runTitle");
		const badge = node.querySelector(".runBadge");
		const meta = node.querySelector(".runMeta");
		const note = node.querySelector(".approvalNote");
		const approve = node.querySelector('[data-action="approve"]');
		const cancel = node.querySelector('[data-action="cancel"]');
		if (title) title.textContent = titleOf(run);
		if (badge) {
			badge.dataset.state = run.state || "";
			badge.textContent = stateLabel(run.state);
		}
		if (meta) {
			const updated = relTime(run.updatedAt, now);
			meta.textContent = shortId(run.id) + (updated ? " · updated " + updated : "");
		}
		if (note) {
			const parts = [];
			if (run.pendingTool) parts.push("waiting on " + run.pendingTool);
			if (busy) parts.push("working…");
			if (failure) parts.push(failure);
			note.textContent = parts.join(" · ");
			note.dataset.kind = failure ? "error" : busy ? "busy" : "note";
		}
		if (approve) {
			approve.textContent = run.pendingTool ? "Approve " + run.pendingTool : "Approve";
			approve.disabled = busy;
			approve.setAttribute("aria-label", (run.pendingTool ? "Approve " + run.pendingTool : "Approve") + " run " + shortId(run.id));
		}
		if (cancel) {
			cancel.disabled = busy;
			cancel.setAttribute("aria-label", "Cancel run " + shortId(run.id));
		}
	}

	return {
		/**
		 * @param {object} state
		 * @param {number} now
		 */
		update(state, now) {
			const load = state.runs.load;
			const rows = selectApprovals(state);
			if (error) {
				const message = load.status === "error" ? load.error || "load failed" : "";
				error.textContent = message;
			}
			if (empty) empty.hidden = rows.length > 0 || state.runs.order.length === 0;
			if (!list) return;
			keyed(
				list,
				rows,
				(run) => run.id,
				createRow,
				(node, run) => updateRow(node, run, state, now),
			);
		},
	};
}
