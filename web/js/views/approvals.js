// Approvals view: the attention queue, and the ONLY place that performs a run
// transition (ADR-3). Rows are the runs an operator can move: `waiting_tool`
// (approve → running, cancel → cancelled) and `queued` (approve → running),
// most recently updated first so blocking work sorts itself to the top.

import { flashOnChange, h, keyed } from "../dom.js";
import { clip, firstLine, relTime, shortId, stateLabel, titleOf } from "../format.js";
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

	if (list) {
		list.addEventListener("keydown", (event) => {
			const keys = ["ArrowDown", "ArrowUp", "Home", "End"];
			if (!keys.includes(event.key)) return;
			const rows = Array.from(list.querySelectorAll("li[data-run-id]"));
			const current = event.target instanceof Element ? event.target.closest("li[data-run-id]") : null;
			if (!rows.length || !current) return;
			const index = rows.indexOf(current);
			let next = index;
			if (event.key === "ArrowDown") next = Math.min(rows.length - 1, index + 1);
			else if (event.key === "ArrowUp") next = Math.max(0, index - 1);
			else if (event.key === "Home") next = 0;
			else next = rows.length - 1;
			const target = rows[next].querySelector("button");
			if (target) {
				event.preventDefault();
				target.focus();
			}
		});
	}

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
		const details = h("button", {
			class: "btn btn-ghost inspectorOpen",
			type: "button",
			text: "Details",
			"aria-label": "Show details for " + titleOf(run),
			onclick: (event) => actions.select(run.id, event.currentTarget),
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
			h("p", { class: "approvalPrompt", hidden: true }),
			h("p", { class: "approvalNote" }),
			h("div", { class: "approvalRow" }, approve, cancel, details),
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
		const previous = node.dataset.state;
		node.dataset.state = run.state || "";
		flashOnChange(node, previous, run.state);
		const title = node.querySelector(".runTitle");
		const badge = node.querySelector(".runBadge");
		const meta = node.querySelector(".runMeta");
		const prompt = node.querySelector(".approvalPrompt");
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
		// The line the operator is approving: the run's own prompt, never the
		// tool's arguments (the API carries no args field). Empty prompts omit it.
		if (prompt) {
			const line = firstLine(run.prompt);
			prompt.hidden = line === "";
			prompt.textContent = clip(line, 160);
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
		const details = node.querySelector(".inspectorOpen");
		if (details) details.setAttribute("aria-label", "Show details for " + titleOf(run));
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
			if (empty) {
				const known = state.runs.order.length;
				let copy = "nothing is waiting on you";
				if (rows.length === 0 && known === 0) {
					copy = load.status === "loading" ? "loading runs…" : load.status === "error" ? "could not load runs — use Refresh to retry" : "nothing is waiting on you";
				}
				empty.hidden = rows.length > 0;
				empty.textContent = copy;
			}
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
