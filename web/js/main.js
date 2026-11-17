// Boot and effects. main.js owns every side effect (fetch, websocket, timers,
// localStorage) and dispatches results into the single store; render.js and the
// view modules are the only DOM writers.

import * as api from "./api.js";
import { firstLine } from "./format.js";
import { createRenderer } from "./render.js";
import { createStream } from "./stream.js";
import { createStore, initialState, selectCanFetch, selectCursor, selectDetailQueue, selectPairWaitMs, selectRun } from "./store.js";

const TOKEN_KEY = "zot.token";
const SINCE_KEY = "zot.since";
const VARIANT_KEY = "zot.variant";
const DEFAULT_VARIANT = "console";
const VIEWS = ["chat", "approvals", "activity", "pairing"];
const VARIANTS = ["console", "ledger", "tty"];
const HEALTH_POLL_MS = 15000;
const TICK_MS = 5000;
// The pairing code counts down in whole seconds; nothing else on the console
// needs a 1 s clock, so this interval only runs work while pairing is active.
const PAIR_TICK_MS = 1000;

/** @returns {string} */
function readStorage(key) {
	try {
		return localStorage.getItem(key) || "";
	} catch {
		return "";
	}
}

/**
 * @param {string} key
 * @param {string} value
 */
function writeStorage(key, value) {
	try {
		if (value) localStorage.setItem(key, value);
		else localStorage.removeItem(key);
	} catch {
		// private mode: the session still works, it just will not survive reload
	}
}

/** @returns {string} view named by the URL hash, or "" */
function hashView() {
	const match = /^#\/([a-z]+)/.exec(typeof location === "undefined" ? "" : location.hash || "");
	if (!match) return "";
	return VIEWS.includes(match[1]) ? match[1] : "";
}

/** @returns {string} */
function queryVariant() {
	if (typeof location === "undefined") return "";
	try {
		const value = new URLSearchParams(location.search).get("variant") || "";
		return VARIANTS.includes(value) ? value : "";
	} catch {
		return "";
	}
}

const store = createStore(initialState());
const getState = () => store.getState();
const doc = document;

let loadStamp = 0;
let healthTimer = null;
let hintTimer = null;
let stream = null;
let rendering = false;
let persistedCursor = "";
const inflightDetails = new Set();
const inflightEvents = new Set();
let focusReturn = null;

/** @type {{route: Function, variant: Function, saveToken: Function, signOut: Function, refreshRuns: Function, send: Function, approve: Function, cancel: Function, select: Function, inspectorToggle: Function, inspectorTab: Function, goApprove: Function, retryNow: Function, filter: Function, pairStart: Function, pairConfirm: Function, pairRetry: Function}} */
const actions = {
	/**
	 * @param {string} view
	 */
	route(view) {
		const next = VIEWS.includes(view) ? view : "chat";
		store.dispatch({ type: "ui.route", view: next });
		const target = "#/" + next;
		if (location.hash !== target) location.hash = target;
		const title = doc.getElementById("viewTitle");
		if (title && typeof title.focus === "function") title.focus();
	},

	/**
	 * @param {string} variant
	 */
	variant(variant) {
		const next = VARIANTS.includes(variant) ? variant : DEFAULT_VARIANT;
		writeStorage(VARIANT_KEY, next);
		store.dispatch({ type: "ui.variant", variant: next });
	},

	/**
	 * @param {string} raw
	 */
	saveToken(raw) {
		const token = String(raw == null ? "" : raw).trim();
		if (!token) {
			store.dispatch({ type: "auth.error", error: "paste a device token first" });
			return;
		}
		writeStorage(TOKEN_KEY, token);
		store.dispatch({ type: "auth.token", token });
		actions.route("chat");
		connect();
		refreshRuns();
	},

	signOut() {
		writeStorage(TOKEN_KEY, "");
		writeStorage(SINCE_KEY, "");
		persistedCursor = "";
		if (stream) stream.close();
		store.dispatch({ type: "auth.signOut" });
		store.dispatch({ type: "conn.set", status: "auth", attempt: 0 });
		actions.route("pairing");
	},

	refreshRuns() {
		return refreshRuns();
	},

	/**
	 * @param {string} prompt
	 */
	send(prompt) {
		return send(prompt);
	},

	/**
	 * @param {string} id
	 */
	approve(id) {
		return transition(id, "approve");
	},

	/**
	 * @param {string} id
	 */
	cancel(id) {
		return transition(id, "cancel");
	},

	/**
	 * @param {string} id
	 * @param {Element|null} [origin] node focus returns to when the pane closes
	 */
	select(id, origin) {
		const run = selectRun(getState(), id);
		focusReturn = origin || null;
		store.dispatch({ type: "ui.select", id });
		store.dispatch({ type: "ui.inspectorTab", tab: run && run.toolEvents.length > 0 ? "events" : "details" });
		if (run && run.toolEvents.length > 0) loadEvents(id);
	},

	/**
	 * @param {boolean} open
	 */
	inspectorToggle(open) {
		const state = getState();
		const next = open === undefined ? !state.ui.inspectorOpen : Boolean(open);
		store.dispatch({ type: "ui.inspectorToggle", open: next });
		if (!next && focusReturn && typeof focusReturn.focus === "function" && focusReturn.isConnected) {
			focusReturn.focus();
			focusReturn = null;
		}
	},

	closeInspector() {
		actions.inspectorToggle(false);
	},

	/**
	 * @param {string} tab
	 */
	inspectorTab(tab) {
		store.dispatch({ type: "ui.inspectorTab", tab: tab === "events" ? "events" : "details" });
	},

	loadEventsFromSelection() {
		const state = getState();
		if (state.ui.selectedRunId) loadEvents(state.ui.selectedRunId);
	},

	/**
	 * @param {string} [id]
	 */
	goApprove(id) {
		if (id) actions.select(id, null);
		actions.route("approvals");
	},

	retryNow() {
		store.dispatch({ type: "conn.set", status: "connecting", attempt: 0 });
		loadHealthz();
		refreshRuns();
		if (stream) stream.retryNow();
	},

	/**
	 * @param {string} filter
	 */
	filter(filter) {
		store.dispatch({ type: "ui.activityFilter", filter });
	},

	pairStart() {
		return pairStart();
	},

	pairConfirm() {
		return pairConfirm();
	},

	pairRetry() {
		store.dispatch({ type: "pair.reset" });
	},
};

const renderer = createRenderer(doc, actions);

store.subscribe((state) => {
	if (rendering) return;
	rendering = true;
	try {
		renderer.update(state);
	} finally {
		rendering = false;
	}
	persistCursor(state);
	drainDetailQueue();
});

/**
 * Persist the replay cursor, but only a numeric seq ever gets stored: a
 * heartbeat id ("hb-<ms>") must never become zot.since.
 * @param {object} state
 */
function persistCursor(state) {
	const cursor = selectCursor(state);
	if (!cursor || cursor === persistedCursor) return;
	persistedCursor = cursor;
	writeStorage(SINCE_KEY, cursor);
}

/**
 * Reconcile one run's tool events from REST (snake_case normalised in api.js).
 * The store merges; a live-seeded event is never duplicated.
 * @param {string} id
 */
function loadEvents(id) {
	const state = getState();
	if (!id || !selectCanFetch(state) || inflightEvents.has(id)) return;
	inflightEvents.add(id);
	api.listEvents(state.auth.token, id, 0)
		.then((events) => store.dispatch({ type: "run.eventsLoaded", id, events }))
		.catch((err) => {
			if (err && err.status === 401) rejectAuth("the daemon rejected that token");
		})
		.finally(() => inflightEvents.delete(id));
}

/** Fill title/prompt for ids the stream named before REST did (one fetch each). */
function drainDetailQueue() {
	const state = getState();
	if (!selectCanFetch(state)) return;
	for (const id of selectDetailQueue(state)) {
		if (inflightDetails.has(id)) continue;
		inflightDetails.add(id);
		store.dispatch({ type: "run.detailStart", id });
		api.getRun(state.auth.token, id)
			.then((run) => {
				if (run) store.dispatch({ type: "run.detailOk", id, run });
				else store.dispatch({ type: "run.detailErr", id });
			})
			.catch((err) => {
				if (err && err.status === 401) rejectAuth("the daemon rejected that token");
				store.dispatch({ type: "run.detailErr", id, error: (err && err.message) || "detail failed" });
			})
			.finally(() => inflightDetails.delete(id));
	}
}

/**
 * @param {string} error
 */
function rejectAuth(error) {
	store.dispatch({ type: "auth.rejected", error });
	store.dispatch({ type: "conn.set", status: "auth" });
	// A rejected token means pairing is the only useful surface: route there so
	// #tokenError can explain it (plan §7.2).
	actions.route("pairing");
}

/** Fetch the run list. Never called without a token (selectCanFetch gate). */
async function refreshRuns() {
	const state = getState();
	if (!selectCanFetch(state)) return;
	const stamp = ++loadStamp;
	store.dispatch({ type: "runs.loadStart", stamp });
	try {
		const runs = await api.listRuns(state.auth.token);
		store.dispatch({ type: "runs.loadOk", runs, stamp, at: Date.now() });
		store.dispatch({ type: "auth.verify" });
	} catch (err) {
		if (err && err.status === 401) rejectAuth("the daemon rejected that token");
		store.dispatch({
			type: "runs.loadErr",
			stamp,
			error: err && err.status === 401 ? "auth failed" : (err && err.message) || "load failed",
			status: err && err.status,
		});
	}
}

/**
 * Ask the daemon for a pairing code: POST /api/v1/pair/start, always as the
 * browser kind the allowlist accepts ("browser" | "ios").
 */
async function pairStart() {
	const state = getState();
	if (selectPairWaitMs(state, Date.now()) > 0) return;
	store.dispatch({ type: "pair.start", at: Date.now() });
	try {
		const { code, expiresAt } = await api.pairStart("browser", "browser");
		store.dispatch({ type: "pair.code", code, expiresAt });
	} catch (err) {
		store.dispatch({
			type: "pair.error",
			status: (err && err.status) || 0,
			message: (err && err.message) || "could not reach the daemon",
			at: Date.now(),
		});
	}
}

/**
 * Confirm the code this page is showing: POST /api/v1/pair/confirm. A success
 * is the only path that writes the token, and it stays in localStorage.
 */
async function pairConfirm() {
	const state = getState();
	const code = state.pairing.code;
	if (!code) return;
	store.dispatch({ type: "pair.confirm", at: Date.now() });
	try {
		const { token, device } = await api.pairConfirm(code);
		if (!token) throw new api.ApiError("the daemon returned no token", 0, null);
		writeStorage(TOKEN_KEY, token);
		store.dispatch({ type: "auth.token", token });
		store.dispatch({ type: "pair.paired", device });
		connect();
		refreshRuns();
	} catch (err) {
		store.dispatch({
			type: "pair.error",
			status: (err && err.status) || 0,
			message: (err && err.message) || "could not reach the daemon",
			at: Date.now(),
		});
	}
}

/** @param {string} prompt */
async function send(prompt) {
	const state = getState();
	if (!selectCanFetch(state)) {
		store.dispatch({ type: "chat.hint", hint: "auth required" });
		return;
	}
	store.dispatch({ type: "chat.hint", hint: "sending…" });
	try {
		const run = await api.createRun(state.auth.token, {
			title: firstLine(prompt).slice(0, 60),
			prompt,
		});
		if (run) store.dispatch({ type: "run.upsert", run });
		store.dispatch({ type: "chat.hint", hint: "queued · waiting" });
		refreshRuns();
	} catch (err) {
		if (err && err.status === 401) rejectAuth("the daemon rejected that token");
		store.dispatch({ type: "chat.hint", hint: (err && err.message) || "could not send" });
		return;
	}
	if (hintTimer) clearTimeout(hintTimer);
	hintTimer = setTimeout(() => store.dispatch({ type: "chat.hint", hint: "" }), 5000);
}

/**
 * @param {string} id
 * @param {"approve"|"cancel"} kind
 */
async function transition(id, kind) {
	const state = getState();
	if (!selectCanFetch(state) || !id) return;
	store.dispatch({ type: "approve.begin", id });
	try {
		const run = kind === "approve" ? await api.approveRun(state.auth.token, id) : await api.cancelRun(state.auth.token, id);
		store.dispatch({ type: "approve.settle", id, run });
	} catch (err) {
		if (err && err.status === 401) {
			rejectAuth("the daemon rejected that token");
			store.dispatch({ type: "approve.settle", id, error: "not authorized" });
			return;
		}
		if (err && err.status === 409) {
			store.dispatch({ type: "approve.settle", id, error: "state changed — reloaded" });
			try {
				const run = await api.getRun(state.auth.token, id);
				if (run) store.dispatch({ type: "run.upsert", run });
			} catch {
				// the honest message above stands
			}
			return;
		}
		store.dispatch({ type: "approve.settle", id, error: (err && err.message) || "approval failed" });
	}
}

async function loadHealthz() {
	try {
		const health = await api.healthz();
		store.dispatch({
			type: "daemon.loaded",
			status: health.state || "unknown",
			version: health.version,
			uptimeMs: health.uptimeMs,
		});
	} catch (err) {
		store.dispatch({ type: "daemon.error", error: (err && err.message) || "unreachable" });
	}
}

async function loadBuild() {
	try {
		const manifest = await api.buildManifest();
		store.dispatch({ type: "builds.loaded", hash: manifest.sourceHash, moduleCount: manifest.moduleCount });
	} catch (err) {
		store.dispatch({ type: "builds.error", error: (err && err.message) || "build unknown" });
	}
}

/** Probe the token when the socket closes while it had been live. */
async function probeAuth() {
	const state = getState();
	if (!selectCanFetch(state)) return;
	try {
		await api.listRuns(state.auth.token);
	} catch (err) {
		if (err && err.status === 401) {
			rejectAuth("the daemon rejected that token");
			if (stream) stream.close();
		}
	}
}

function connect() {
	if (!stream) {
		stream = createStream({
			getToken: () => getState().auth.token,
			getCursor: () => selectCursor(getState()),
			onFrame: (frame) => store.dispatch({ type: "stream.frame", frame }),
			onStatus: (status) => {
				store.dispatch({
					type: "conn.set",
					status: status.status,
					attempt: status.attempt,
					backoffMs: status.backoffMs,
				});
				if (status.status === "live") loadHealthz();
			},
			onCloseWhileLive: () => probeAuth(),
		});
	}
	stream.connect();
}

function boot() {
	const variant = queryVariant() || readStorage(VARIANT_KEY) || DEFAULT_VARIANT;
	store.dispatch({ type: "ui.variant", variant: VARIANTS.includes(variant) ? variant : DEFAULT_VARIANT });
	const token = readStorage(TOKEN_KEY).trim();
	store.dispatch({ type: "auth.boot", token });
	// Only a numeric cursor is a valid replay cursor. A legacy "hb-<ms>" value
	// is dropped instead of being sent as `since`.
	const storedCursor = readStorage(SINCE_KEY).trim();
	if (/^\d+$/.test(storedCursor)) {
		persistedCursor = storedCursor;
		store.dispatch({ type: "stream.cursor", cursor: storedCursor });
	} else if (storedCursor) {
		writeStorage(SINCE_KEY, "");
	}
	const initialView = hashView() || (token ? "chat" : "pairing");
	store.dispatch({ type: "ui.route", view: initialView });
	loadBuild();
	loadHealthz();
	if (healthTimer) clearInterval(healthTimer);
	healthTimer = setInterval(loadHealthz, HEALTH_POLL_MS);
	if (token) {
		connect();
		refreshRuns();
	} else {
		store.dispatch({ type: "conn.set", status: "auth", attempt: 0 });
	}
	renderer.update(getState());
	if (typeof setInterval === "function") setInterval(() => renderer.update(getState()), TICK_MS);
	// Pairing countdowns: expire the displayed code at expiresAt and release a
	// locally-tracked rate-limit wait. The interval is a no-op otherwise.
	if (typeof setInterval === "function") {
		setInterval(() => {
			const state = getState();
			if (state.pairing.status !== "code" && state.pairing.status !== "rate-limited") return;
			store.dispatch({ type: "pair.tick", now: Date.now() });
			renderer.update(getState());
		}, PAIR_TICK_MS);
	}
}

window.addEventListener("hashchange", () => {
	const view = hashView();
	if (!view) return;
	if (view !== getState().ui.view) {
		store.dispatch({ type: "ui.route", view });
		// Focus follows the route so a keyboard/screen-reader operator lands on
		// the new view's heading instead of staying in the sidebar.
		const title = doc.getElementById("viewTitle");
		if (title && typeof title.focus === "function") title.focus();
	}
});

window.addEventListener("offline", () => {
	store.dispatch({ type: "conn.set", status: "offline", attempt: 0 });
	if (stream) stream.pause();
});

window.addEventListener("online", () => {
	store.dispatch({ type: "conn.set", status: "connecting", attempt: 0 });
	if (stream) stream.resume();
	else if (getState().auth.token) connect();
	loadHealthz();
});

window.addEventListener("keydown", (event) => {
	if (event.key !== "Escape") return;
	if (!getState().ui.inspectorOpen) return;
	event.preventDefault();
	actions.closeInspector();
});

boot();
