// The shell renderer. It reads state, writes the shell chrome, and delegates
// each surface to its view module. Views never fetch and never hold mutable
// state of their own; the keyed reconcilers in dom.js keep node identity.

import { announce } from "./dom.js";
import { relTime, shortDuration, shortId, stateLabel, titleOf } from "./format.js";
import { selectPendingCount, selectRun } from "./store.js";
import { createActivityView } from "./views/activity.js";
import { createChatView } from "./views/chat.js";
import { createPairingView } from "./views/pairing.js";

const VIEW_TITLES = {
	chat: "Chat",
	approvals: "Approvals",
	activity: "Activity",
	pairing: "Pairing",
};

const CONN_TEXT = {
	boot: "connecting",
	connecting: "connecting",
	live: "live",
	reconnecting: "reconnecting",
	offline: "offline",
	auth: "auth failed",
};

const STATUS_KINDS = {
	boot: "connecting",
	connecting: "connecting",
	live: "live",
	reconnecting: "reconnecting",
	offline: "offline",
	auth: "auth",
};

/**
 * @param {Document} doc
 * @param {object} actions
 * @param {{onVariant?: (variant: string) => void}} [hooks]
 */
export function createRenderer(doc, actions, hooks = {}) {
	const app = doc.getElementById("app");
	const status = doc.getElementById("status");
	const retryCount = doc.getElementById("retryCount");
	const retryNow = doc.getElementById("retryNow");
	const viewTitle = doc.getElementById("viewTitle");
	const daemon = doc.getElementById("daemon");
	const build = doc.getElementById("build");
	const variantSwitch = doc.getElementById("variantSwitch");
	const runsCount = doc.getElementById("runsCount");
	const approvalsCount = doc.getElementById("approvalsCount");
	const navs = Array.from(doc.querySelectorAll("nav#sidebar a[data-view]"));
	const live = doc.getElementById("live");
	const inspector = doc.getElementById("inspector");
	const inspectorTitle = doc.getElementById("inspectorTitle");
	const inspectorTabs = doc.getElementById("inspectorTabs");
	const inspectorBody = doc.getElementById("inspectorBody");
	const inspectorClose = doc.getElementById("inspectorClose");
	const inspectorGoApprove = doc.getElementById("inspectorGoApprove");

	const chat = createChatView(doc, actions);
	const activity = createActivityView(doc, actions);
	const pairing = createPairingView(doc, actions);

	let lastAnnounced = "";
	let lastConn = "";

	if (retryNow) retryNow.addEventListener("click", () => actions.retryNow());
	if (variantSwitch) {
		variantSwitch.addEventListener("change", () => actions.variant(variantSwitch.value));
	}
	if (inspectorClose) inspectorClose.addEventListener("click", () => actions.inspectorToggle(false));
	if (inspectorTabs) {
		inspectorTabs.addEventListener("click", (event) => {
			const target = event.target instanceof Element ? event.target.closest("button[data-tab]") : null;
			if (target) actions.inspectorTab(target.getAttribute("data-tab") || "details");
		});
	}
	if (inspectorGoApprove) inspectorGoApprove.addEventListener("click", () => actions.goApprove());
	for (const nav of navs) {
		nav.addEventListener("click", (event) => {
			event.preventDefault();
			actions.route(nav.getAttribute("data-view") || "chat");
		});
	}

	/**
	 * @param {object} state
	 */
	function renderTopbar(state) {
		const kind = STATUS_KINDS[state.conn.status] || "connecting";
		let text = CONN_TEXT[state.conn.status] || "connecting";
		if (state.conn.status === "reconnecting" && state.conn.attempt > 0) text = "reconnecting " + state.conn.attempt;
		if (state.conn.status === "auth" && (state.auth.status === "none" || state.auth.status === "unknown")) text = "unpaired";
		if (status) {
			status.textContent = text;
			status.dataset.kind = kind;
		}
		if (retryCount) retryCount.textContent = state.conn.attempt > 0 ? "retry " + state.conn.attempt : "";
		if (viewTitle) viewTitle.textContent = VIEW_TITLES[state.ui.view] || "Chat";
		if (daemon) {
			const d = state.daemon;
			const stateWord = d.status === "ready" ? "ready" : d.status === "starting" ? "starting" : d.status === "unreachable" ? "unreachable" : "unknown";
			daemon.dataset.kind = d.status || "unknown";
			daemon.textContent = stateWord + (d.version ? " · v" + d.version : "") + (d.uptimeMs ? " · " + shortDuration(d.uptimeMs) : "");
		}
		if (build) {
			if (state.builds.error || !state.builds.hash) {
				build.dataset.kind = "unknown";
				build.textContent = "build unknown";
			} else {
				build.dataset.kind = "fresh";
				build.textContent = "build " + state.builds.hash.slice(0, 7);
			}
		}
		if (variantSwitch && variantSwitch.value !== state.ui.variant) variantSwitch.value = state.ui.variant;
	}

	/**
	 * @param {object} state
	 */
	function renderSidebar(state) {
		const pending = selectPendingCount(state);
		const total = state.runs.order.length;
		for (const nav of navs) {
			const view = nav.getAttribute("data-view");
			if (view === state.ui.view) nav.setAttribute("aria-current", "page");
			else nav.removeAttribute("aria-current");
		}
		if (approvalsCount) {
			approvalsCount.hidden = pending === 0;
			approvalsCount.textContent = pending + " pending";
		}
		if (runsCount) runsCount.textContent = String(total);
	}

	/**
	 * @param {object} state
	 */
	function renderInspector(state) {
		if (!inspector) return;
		const run = selectRun(state, state.ui.selectedRunId);
		inspector.dataset.collapsed = state.ui.inspectorOpen ? "false" : "true";
		if (inspectorTitle) inspectorTitle.textContent = run ? titleOf(run) : "Inspector";
		if (inspectorTabs) {
			for (const tab of inspectorTabs.querySelectorAll("button[data-tab]")) {
				const active = tab.getAttribute("data-tab") === state.ui.inspectorTab;
				tab.setAttribute("aria-selected", active ? "true" : "false");
			}
		}
		if (inspectorGoApprove) inspectorGoApprove.hidden = true;
		if (!inspectorBody) return;
		if (!run) {
			if (inspectorBody.dataset.signature === "empty") return;
			inspectorBody.dataset.signature = "empty";
			const p = doc.createElement("p");
			p.className = "empty";
			p.textContent = "select a run";
			inspectorBody.replaceChildren(p);
			return;
		}
		renderInspectorDetails(run, state, inspectorBody, doc);
	}

	/**
	 * @param {object} run
	 * @param {object} state
	 * @param {HTMLElement} body
	 * @param {Document} document_
	 */
	function renderInspectorDetails(run, state, body, document_) {
		const rows = [
			["id", shortId(run.id)],
			["state", stateLabel(run.state)],
			["attempt", String(Number(run.attempt) || 1)],
			["created", relTime(run.createdAt) || "—"],
			["updated", relTime(run.updatedAt) || "—"],
		];
		if (run.pendingTool) rows.push(["waiting on", run.pendingTool]);
		const signature = JSON.stringify([rows, state.ui.inspectorTab, run.toolEvents.length]);
		if (body.dataset.signature === signature) return;
		body.dataset.signature = signature;
		body.replaceChildren();
		if (state.ui.inspectorTab === "events") {
			const list = document_.createElement("div");
			list.className = "toolEventList";
			if (run.toolEvents.length === 0) {
				const p = document_.createElement("p");
				p.className = "empty";
				p.textContent = "no tool events yet";
				list.appendChild(p);
			}
			for (const event of run.toolEvents) {
				const row = document_.createElement("div");
				row.className = "toolEvent";
				row.dataset.tool = event.tool;
				row.dataset.source = event.source;
				const name = document_.createElement("span");
				name.className = "toolEventName";
				name.textContent = event.tool + (event.source === "request" ? " · request" : " · " + (event.resultRef || event.argsHash.slice(0, 8) || "result"));
				const when = document_.createElement("span");
				when.className = "toolEventWhen";
				when.textContent = relTime(event.createdAt) || "";
				row.appendChild(name);
				row.appendChild(when);
				list.appendChild(row);
			}
			body.appendChild(list);
			return;
		}
		const dl = document_.createElement("dl");
		dl.className = "details";
		for (const [key, value] of rows) {
			const row = document_.createElement("div");
			row.className = "detailRow";
			const dt = document_.createElement("dt");
			dt.textContent = key;
			const dd = document_.createElement("dd");
			dd.textContent = value;
			row.appendChild(dt);
			row.appendChild(dd);
			dl.appendChild(row);
		}
		body.appendChild(dl);
		const promptLabel = document_.createElement("p");
		promptLabel.className = "muted";
		promptLabel.textContent = "prompt";
		body.appendChild(promptLabel);
		const prompt = document_.createElement("pre");
		prompt.className = "inspectorPrompt";
		prompt.textContent = run.prompt || "—";
		body.appendChild(prompt);
	}

	/**
	 * @param {object} state
	 * @param {number} now
	 */
	function update(state, now = Date.now()) {
		if (app) {
			app.dataset.view = state.ui.view;
			app.dataset.conn = state.conn.status;
			app.dataset.variant = state.ui.variant;
		}
		renderTopbar(state);
		renderSidebar(state);
		renderInspector(state);
		chat.update(state, now);
		activity.update(state, now);
		pairing.update(state, now);
		if (live) {
			if (state.conn.status !== lastConn) {
				if (state.conn.status === "live") lastAnnounced = announce(live, "connection live");
				else if (state.conn.status === "reconnecting") lastAnnounced = announce(live, "connection lost, reconnecting");
				else if (state.conn.status === "offline") lastAnnounced = announce(live, "browser offline");
				else if (state.conn.status === "auth" && state.auth.status === "rejected") lastAnnounced = announce(live, "daemon rejected the token");
				lastConn = state.conn.status;
			}
		}
		return lastAnnounced;
	}

	return { update };
}
