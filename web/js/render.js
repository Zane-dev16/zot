// The shell renderer. It reads state, writes the shell chrome (topbar, sidebar,
// active view, live region), and delegates each surface to its view module.
// Views never fetch and never hold mutable state; dom.js keyed reconcilers keep
// node identity so focus survives a re-render.

import { announce } from "./dom.js";
import { shortDuration, stateLabel, titleOf } from "./format.js";
import { selectActivity, selectApprovals, selectChatRuns, selectPendingCount } from "./store.js";
import { createActivityView } from "./views/activity.js";
import { createApprovalsView } from "./views/approvals.js";
import { createChatView } from "./views/chat.js";
import { createInspectorView } from "./views/inspector.js";
import { createPairingView } from "./views/pairing.js";
import { applyVariantHook } from "./views/variants/index.js";

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
 */
export function createRenderer(doc, actions) {
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
	const sidebar = doc.getElementById("sidebar");
	const navs = Array.from(doc.querySelectorAll("nav#sidebar a[data-view]"));
	const sections = {
		chat: doc.getElementById("view-chat"),
		approvals: doc.getElementById("view-approvals"),
		activity: doc.getElementById("view-activity"),
		pairing: doc.getElementById("view-pairing"),
	};
	const live = doc.getElementById("live");

	const chat = createChatView(doc, actions);
	const approvals = createApprovalsView(doc, actions);
	const activity = createActivityView(doc, actions);
	const pairing = createPairingView(doc, actions);
	const inspector = createInspectorView(doc, actions);

	let lastAnnounced = "";
	let lastConn = "";
	// The variant hook runs once per variant change; console and tty have none.
	let lastVariant = "";
	// Run-state announcements are baselined once the first run list lands, so a
	// fresh boot's replay never reads 100 historical state frames aloud.
	let liveHydrated = false;
	const lastRunStates = new Map();
	let lastLoadError = "";

	if (retryNow) retryNow.addEventListener("click", () => actions.retryNow());
	if (variantSwitch) variantSwitch.addEventListener("change", () => actions.variant(variantSwitch.value));
	for (const nav of navs) {
		nav.addEventListener("click", (event) => {
			event.preventDefault();
			actions.route(nav.getAttribute("data-view") || "chat");
		});
	}

	// Arrow-key navigation across the four views, with a roving tabindex so the
	// sidebar is one tab stop and the arrows are the fast path.
	if (sidebar) {
		sidebar.addEventListener("keydown", (event) => {
			const keys = ["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End"];
			if (!keys.includes(event.key)) return;
			const current = event.target instanceof Element ? event.target.closest("a[data-view]") : null;
			if (!current || navs.length === 0) return;
			event.preventDefault();
			const index = navs.indexOf(current);
			let next = index;
			if (event.key === "ArrowDown" || event.key === "ArrowRight") next = (index + 1) % navs.length;
			else if (event.key === "ArrowUp" || event.key === "ArrowLeft") next = (index - 1 + navs.length) % navs.length;
			else if (event.key === "Home") next = 0;
			else next = navs.length - 1;
			// Arrows move focus only; Enter (or a click) follows the route, so a
			// screen reader lands on the new view's heading instead of being
			// yanked there mid-exploration.
			navs[next].focus();
		});
	}

	/**
	 * @param {object} state
	 */
	function renderTopbar(state) {
		const kind = STATUS_KINDS[state.conn.status] || "connecting";
		let text = CONN_TEXT[state.conn.status] || "connecting";
		if (state.conn.status === "reconnecting" && state.conn.attempt > 0) text = "reconnecting " + state.conn.attempt;
		if (state.conn.status === "auth") {
			text = state.auth.status === "rejected" ? "auth failed" : "unpaired";
		}
		if (status) {
			status.textContent = text;
			status.dataset.kind = kind;
		}
		if (retryCount) retryCount.textContent = state.conn.attempt > 0 ? "retry " + state.conn.attempt : "";
		if (viewTitle) viewTitle.textContent = VIEW_TITLES[state.ui.view] || "Chat";
		if (daemon) {
			const d = state.daemon;
			const word =
				d.status === "ready" ? "ready" : d.status === "starting" ? "starting" : d.status === "unreachable" ? "unreachable" : "unknown";
			daemon.dataset.kind = d.status || "unknown";
			daemon.textContent = word + (d.version ? " · v" + d.version : "") + (d.uptimeMs ? " · " + shortDuration(d.uptimeMs) : "");
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
		for (const nav of navs) {
			const view = nav.getAttribute("data-view");
			const active = view === state.ui.view;
			if (active) nav.setAttribute("aria-current", "page");
			else nav.removeAttribute("aria-current");
			// Roving tabindex: Tab reaches the sidebar once, arrows move within it.
			nav.tabIndex = active ? 0 : -1;
		}
		if (approvalsCount) {
			approvalsCount.hidden = pending === 0;
			approvalsCount.textContent = pending + " pending";
		}
		if (runsCount) runsCount.textContent = String(state.runs.order.length);
	}

	/**
	 * @param {object} state
	 */
	function renderViews(state) {
		for (const [name, section] of Object.entries(sections)) {
			if (!section) continue;
			if (name === state.ui.view) section.dataset.active = "true";
			else delete section.dataset.active;
		}
	}

	/**
	 * Runs rendered in the active view: only what the operator can see is worth
	 * announcing, and it bounds how many messages one event tick can emit.
	 * @param {object} state
	 * @returns {Array<object>}
	 */
	function visibleRuns(state) {
		if (state.ui.view === "approvals") return selectApprovals(state);
		if (state.ui.view === "activity") return selectActivity(state);
		if (state.ui.view === "chat") return selectChatRuns(state);
		return [];
	}

	/**
	 * @param {object} run
	 * @returns {string}
	 */
	function runAnnouncement(run) {
		const label = titleOf(run).slice(0, 48);
		if (run.state === "waiting_tool") {
			return "run " + label + (run.pendingTool ? " is waiting on " + run.pendingTool : " needs approval");
		}
		return "run " + label + " " + (stateLabel(run.state) || "updated");
	}

	/**
	 * Polite announcements: connection changes, visible run-state transitions,
	 * and load errors. Token text never reaches the live region.
	 * @param {object} state
	 */
	function renderLive(state) {
		if (!live) return;
		if (state.conn.status !== lastConn) {
			lastConn = state.conn.status;
			if (state.conn.status === "live") lastAnnounced = announce(live, "connection live");
			else if (state.conn.status === "reconnecting") lastAnnounced = announce(live, "connection lost, reconnecting");
			else if (state.conn.status === "offline") lastAnnounced = announce(live, "browser offline");
			else if (state.conn.status === "auth" && state.auth.status === "rejected") lastAnnounced = announce(live, "daemon rejected the token");
		}

		const load = state.runs.load;
		if (!liveHydrated) {
			if (load.status !== "ready") return;
			for (const run of selectChatRuns(state)) lastRunStates.set(run.id, run.state);
			liveHydrated = true;
			return;
		}

		const messages = [];
		for (const run of visibleRuns(state)) {
			const previous = lastRunStates.get(run.id);
			if (previous !== undefined && previous !== run.state) messages.push(runAnnouncement(run));
			lastRunStates.set(run.id, run.state);
		}
		if (messages.length) lastAnnounced = announce(live, messages.slice(0, 2).join(" · "));

		if (load.status === "error" && load.error && load.error !== lastLoadError) {
			lastLoadError = load.error;
			lastAnnounced = announce(live, "could not load runs: " + load.error);
		} else if (load.status !== "error") {
			lastLoadError = "";
		}
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
		if (state.ui.variant !== lastVariant) {
			lastVariant = state.ui.variant;
			applyVariantHook(doc, lastVariant);
		}
		renderTopbar(state);
		renderSidebar(state);
		renderViews(state);
		chat.update(state, now);
		approvals.update(state, now);
		activity.update(state, now);
		pairing.update(state, now);
		inspector.update(state, now);
		renderLive(state);
		return lastAnnounced;
	}

	return { update };
}
