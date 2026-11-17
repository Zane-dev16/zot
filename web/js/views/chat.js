// Chat view: the thread of the newest runs plus the composer.
// Chat never performs a run transition (ADR-3); approvable runs link to the
// approvals surface instead. Until that surface ships, the legacy approval row
// stays inside each article so the pre-existing screenshot harness keeps a
// handle on Approve/Cancel.

import { h, keyed } from "../dom.js";
import { relTime, shortId, stateLabel, titleOf } from "../format.js";
import { APPROVABLE_STATES, selectChatRuns } from "../store.js";

/**
 * @param {Document} doc
 * @param {{send: (prompt: string) => void, approve: (id: string) => void, cancel: (id: string) => void, route: (view: string, id?: string|null) => void}} actions
 */
export function createChatView(doc, actions) {
	const log = doc.getElementById("log");
	const form = doc.getElementById("composer");
	const box = doc.getElementById("box");
	const hint = doc.getElementById("composerHint");
	const older = doc.getElementById("chatOlder");

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
		const approvalRow = h("div", { class: "approvalRow", hidden: true }, approve, cancel);
		const article = h(
			"article",
			{
				dataset: { runId: run.id, state: "" },
				onclick: (event) => {
					if (event.target instanceof Element && event.target.closest("button")) return;
					actions.select(run.id);
				},
			},
			h("div", { class: "runHead" }, title, badge, meta),
			tokens,
			toolNote,
			approvalRow,
		);
		return article;
	}

	/**
	 * @param {HTMLElement} node
	 * @param {object} run
	 * @param {number} now
	 */
	function updateArticle(node, run, now) {
		node.dataset.state = run.state || "";
		const title = node.querySelector(".runTitle");
		const badge = node.querySelector(".runBadge");
		const meta = node.querySelector(".runMeta");
		const tokens = node.querySelector(".runTokens");
		const toolNote = node.querySelector(".runToolNote");
		const approvalRow = node.querySelector(".approvalRow");
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
		if (approvalRow) {
			const approvable = APPROVABLE_STATES.has(run.state);
			approvalRow.hidden = !approvable;
			const approve = approvalRow.querySelector('[data-action="approve"]');
			const cancel = approvalRow.querySelector('[data-action="cancel"]');
			const busy = false;
			if (approve) {
				approve.textContent = run.pendingTool ? "Approve " + run.pendingTool : "Approve";
				approve.disabled = busy;
			}
			if (cancel) cancel.disabled = busy;
		}
	}

	return {
		/**
		 * @param {object} state
		 * @param {number} now
		 */
		update(state, now) {
			if (hint) hint.textContent = state.chat.hint || "";
			if (!log) return;
			const runs = selectChatRuns(state);
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
