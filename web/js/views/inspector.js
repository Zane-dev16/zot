// Inspector: read-only detail for the selected run. Details and tool events
// live one tab apart, and the pane never mutates a run (the Approvals view owns
// every transition; this pane only links there).

import { relTime, shortId, stateLabel, titleOf } from "../format.js";
import { APPROVABLE_STATES, selectRun } from "../store.js";

// Views whose rows can be selected. Pairing has nothing to select, so the pane
// is not laid out there at all: the shell gives its column back (see
// layout.css `#app[data-inspector="hidden"]`) instead of spending 380px on
// "select a run". Chat, Approvals, and Activity restore it.
const SELECTABLE_VIEWS = new Set(["chat", "approvals", "activity"]);

/**
 * Whether the active view has anything an operator can select.
 * @param {unknown} view
 * @returns {boolean}
 */
export function viewSupportsSelection(view) {
	return SELECTABLE_VIEWS.has(String(view == null ? "" : view));
}

/**
 * @param {Document} doc
 * @param {{inspectorToggle: (open: boolean) => void, inspectorTab: (tab: string) => void, goApprove: (id: string) => void, loadEvents: (id: string) => void}} actions
 */
export function createInspectorView(doc, actions) {
	const inspector = doc.getElementById("inspector");
	const title = doc.getElementById("inspectorTitle");
	const tabs = doc.getElementById("inspectorTabs");
	const body = doc.getElementById("inspectorBody");
	const close = doc.getElementById("inspectorClose");
	const goApprove = doc.getElementById("inspectorGoApprove");

	if (close) close.addEventListener("click", () => actions.inspectorToggle(false));
	if (tabs) {
		tabs.addEventListener("click", (event) => {
			const target = event.target instanceof Element ? event.target.closest("button[data-tab]") : null;
			if (!target) return;
			const tab = target.getAttribute("data-tab") || "details";
			actions.inspectorTab(tab);
			if (tab === "events") actions.loadEventsFromSelection();
		});
		// WAI-ARIA tabs: Left/Right/Home/End move between Details and Events.
		tabs.addEventListener("keydown", (event) => {
			const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
			if (!keys.includes(event.key)) return;
			const buttons = Array.from(tabs.querySelectorAll("button[data-tab]"));
			const current = event.target instanceof Element ? event.target.closest("button[data-tab]") : null;
			if (!buttons.length || !current) return;
			event.preventDefault();
			const index = buttons.indexOf(current);
			let next = index;
			if (event.key === "ArrowLeft") next = (index - 1 + buttons.length) % buttons.length;
			else if (event.key === "ArrowRight") next = (index + 1) % buttons.length;
			else if (event.key === "Home") next = 0;
			else next = buttons.length - 1;
			const tab = buttons[next].getAttribute("data-tab") || "details";
			buttons[next].focus();
			actions.inspectorTab(tab);
			if (tab === "events") actions.loadEventsFromSelection();
		});
	}
	if (goApprove) {
		goApprove.addEventListener("click", () => actions.goApprove());
	}

	/**
	 * @param {object} run
	 * @returns {Array<[string, string]>}
	 */
	function details(run) {
		const rows = [
			["id", shortId(run.id)],
			["state", stateLabel(run.state)],
			["attempt", String(Number(run.attempt) || 1)],
			["updated", relTime(run.updatedAt) || "—"],
			["created", relTime(run.createdAt) || "—"],
			["finished", relTime(run.finishedAt) || "—"],
			["heartbeat", relTime(run.lastHeartbeat) || "—"],
			["owner", run.ownerDeviceId ? shortId(run.ownerDeviceId) : "—"],
		];
		if (run.model) rows.push(["model", String(run.model)]);
		if (run.pendingTool) rows.push(["waiting on", run.pendingTool]);
		return rows;
	}

	/**
	 * @param {object} run
	 * @param {object} state
	 * @param {number} now
	 */
	function renderBody(run, state, now) {
		if (!body) return;
		if (!run) {
			if (body.dataset.signature === "empty") return;
			body.dataset.signature = "empty";
			body.dataset.state = "empty";
			const p = doc.createElement("p");
			p.className = "empty";
			p.textContent = "select a run";
			body.replaceChildren(p);
			return;
		}
		const tab = state.ui.inspectorTab === "events" ? "events" : "details";
		const detail = (state.runs.detail || {})[run.id] || "";
		const detailError = (state.runs.detailErrors || {})[run.id] || "";
		const signature = JSON.stringify([run.id, run.state, run.attempt, run.updatedAt, tab, run.toolEvents.length, run.prompt, detail, detailError]);
		if (body.dataset.signature === signature) return;
		body.dataset.signature = signature;
		body.dataset.state = detail === "loading" ? "loading" : detail === "error" ? "error" : "ready";
		body.replaceChildren();
		if (detail === "loading") {
			const note = doc.createElement("p");
			note.className = "empty";
			note.textContent = "loading run details…";
			body.appendChild(note);
		} else if (detail === "error") {
			const note = doc.createElement("p");
			note.className = "inspectorError";
			note.setAttribute("role", "alert");
			note.textContent = "could not load this run — " + (detailError || "retry from the list");
			body.appendChild(note);
		}
		if (tab === "events") {
			if (run.toolEvents.length === 0) {
				const p = doc.createElement("p");
				p.className = "empty";
				p.textContent = "no tool events for this run yet";
				body.appendChild(p);
				return;
			}
			for (const event of run.toolEvents) {
				const row = doc.createElement("div");
				row.className = "toolEvent";
				row.dataset.tool = event.tool;
				row.dataset.source = event.source;
				const name = doc.createElement("span");
				name.className = "toolEventName";
				name.textContent = event.tool;
				const ref = doc.createElement("span");
				ref.className = "toolEventRef";
				const refText = event.resultRef || (event.argsHash ? "args " + event.argsHash.slice(0, 8) : event.source);
				ref.textContent = refText.length > 42 ? refText.slice(0, 42) + "…" : refText;
				const when = doc.createElement("span");
				when.className = "toolEventWhen";
				when.textContent = relTime(event.createdAt, now) || "";
				row.appendChild(name);
				row.appendChild(ref);
				row.appendChild(when);
				body.appendChild(row);
			}
			return;
		}
		const dl = doc.createElement("dl");
		dl.className = "details";
		for (const [key, value] of details(run)) {
			const row = doc.createElement("div");
			row.className = "detailRow";
			const dt = doc.createElement("dt");
			dt.textContent = key;
			const dd = doc.createElement("dd");
			dd.textContent = value;
			row.appendChild(dt);
			row.appendChild(dd);
			dl.appendChild(row);
		}
		body.appendChild(dl);
		const promptLabel = doc.createElement("p");
		promptLabel.className = "muted";
		promptLabel.textContent = "prompt";
		body.appendChild(promptLabel);
		const prompt = doc.createElement("pre");
		prompt.className = "inspectorPrompt";
		prompt.textContent = run.prompt || "—";
		body.appendChild(prompt);
	}

	return {
		/**
		 * @param {object} state
		 * @param {number} now
		 */
		update(state, now) {
			if (!inspector) return;
			const run = selectRun(state, state.ui.selectedRunId);
			inspector.hidden = !viewSupportsSelection(state.ui.view);
			inspector.dataset.collapsed = state.ui.inspectorOpen ? "false" : "true";
			if (title) title.textContent = run ? titleOf(run) : "Inspector";
			if (tabs) {
				for (const tab of tabs.querySelectorAll("button[data-tab]")) {
					const active = tab.getAttribute("data-tab") === state.ui.inspectorTab;
					tab.setAttribute("aria-selected", active ? "true" : "false");
				}
			}
			if (goApprove) {
				const approvable = Boolean(run) && APPROVABLE_STATES.has(run.state);
				goApprove.hidden = !approvable;
				if (approvable) goApprove.textContent = run.pendingTool ? "open in Approvals · " + run.pendingTool : "open in Approvals";
			}
			renderBody(run, state, now);
		},
	};
}
