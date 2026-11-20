// Chat view: the thread of the newest runs plus the composer.
// Chat is read-only about run transitions (ADR-3): an approvable run shows a
// `.runNeedsApproval` link into the Approvals view, never its own buttons.

import { flashOnChange, h, keyed } from "../dom.js";
import { relTime, shortId, stateLabel, titleOf } from "../format.js";
import { APPROVABLE_STATES, selectChatRuns } from "../store.js";

/**
 * @param {Document} doc
 * @param {{send: (prompt: string) => void, goApprove: (id: string) => void, select: (id: string, origin?: Element|null) => void, route: (view: string) => void}} actions
 */
export function createChatView(doc, actions) {
	const log = doc.getElementById("log");
	const form = doc.getElementById("composer");
	const box = doc.getElementById("box");
	const hint = doc.getElementById("composerHint");
	const older = doc.getElementById("chatOlder");
	const error = doc.getElementById("chatError");
	const empty = doc.getElementById("chatEmpty");

	if (form) {
		form.addEventListener("submit", (event) => {
			event.preventDefault();
			const prompt = box ? box.value.trim() : "";
			if (!prompt) {
				if (hint) hint.textContent = "type a prompt first";
				return;
			}
			if (box) box.value = "";
			actions.send(prompt);
		});
	}

	if (older) {
		older.addEventListener("click", (event) => {
			const link = event.target instanceof Element ? event.target.closest("a") : null;
			if (!link) return;
			event.preventDefault();
			actions.route("activity");
		});
	}

	/**
	 * @param {object} run
	 * @returns {HTMLElement}
	 */
	function createArticle(run) {
		const title = h("span", { class: "runTitle" });
		const badge = h("span", { class: "runBadge" });
		const meta = h("span", { class: "runMeta" });
		const tokens = h("p", { class: "runTokens" });
		const toolNote = h("p", { class: "runToolNote" });
		const needs = h("button", {
			class: "runNeedsApproval",
			type: "button",
			text: "needs approval · open",
			hidden: true,
			onclick: () => actions.goApprove(run.id),
		});
		const details = h("button", {
			class: "btn btn-ghost inspectorOpen",
			type: "button",
			text: "Details",
			"aria-label": "Show details for " + titleOf(run),
			onclick: (event) => actions.select(run.id, event.currentTarget),
		});
		return h(
			"article",
			{
				dataset: { runId: run.id, state: "" },
				onclick: (event) => {
					if (event.target instanceof Element && event.target.closest("button")) return;
					actions.select(run.id, event.currentTarget);
				},
			},
			h("div", { class: "runHead" }, title, badge, meta, details),
			tokens,
			toolNote,
			needs,
		);
	}

	/**
	 * @param {HTMLElement} node
	 * @param {object} run
	 * @param {number} now
	 */
	function updateArticle(node, run, now) {
		const previous = node.dataset.state;
		node.dataset.state = run.state || "";
		flashOnChange(node, previous, run.state);
		const title = node.querySelector(".runTitle");
		const badge = node.querySelector(".runBadge");
		const meta = node.querySelector(".runMeta");
		const tokens = node.querySelector(".runTokens");
		const toolNote = node.querySelector(".runToolNote");
		const needs = node.querySelector(".runNeedsApproval");
		if (title) title.textContent = titleOf(run);
		if (badge) {
			badge.dataset.state = run.state || "";
			badge.textContent = stateLabel(run.state);
		}
		if (meta) {
			const updated = relTime(run.updatedAt, now);
			const parts = ["attempt " + (Number(run.attempt) || 1)];
			if (updated) parts.push("updated " + updated);
			parts.push(shortId(run.id));
			meta.textContent = parts.join(" · ");
		}
		if (tokens) tokens.textContent = run.tokensText || "";
		if (toolNote) toolNote.textContent = run.toolNote || "";
		if (needs) {
			needs.hidden = !APPROVABLE_STATES.has(run.state);
			if (run.pendingTool) needs.textContent = "waiting on " + run.pendingTool + " · open";
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
			if (hint) hint.textContent = state.chat.hint || "";
			const load = state.runs.load;
			if (error) error.textContent = load.status === "error" ? load.error || "load failed" : "";
			const runs = selectChatRuns(state);
			if (empty) {
				let copy = "";
				if (runs.length === 0) {
					const known = state.runs.order.length;
					const paired = state.auth.status === "hasToken" || state.auth.status === "verified";
					if (known > 0) copy = "";
					else if (load.status === "loading") copy = "loading runs…";
					else if (load.status === "error") copy = "could not load runs — check the daemon and retry";
					else if (!paired) copy = "not paired yet — pair the browser to start";
					else copy = "no runs yet — type a prompt below";
				}
				empty.hidden = copy === "";
				if (copy) empty.textContent = copy;
			}
			if (!log) return;
			keyed(
				log,
				runs,
				(run) => run.id,
				createArticle,
				(node, run) => updateArticle(node, run, now),
			);
		},
	};
}
