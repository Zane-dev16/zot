// One reducer owns every byte of client state (ADR-5). Pure functions only:
// no DOM, no localStorage, no fetch. main.js performs the effects and dispatches
// results back in, and the renderer subscribes once.

export const TERMINAL_STATES = new Set(["done", "failed", "cancelled"]);
export const APPROVABLE_STATES = new Set(["queued", "waiting_tool"]);

const CHAT_CAP = 12;
const ACTIVITY_CAP = 30;
const SEEN_CAP = 4000;

/**
 * @param {object} [overrides] shallow per-section overrides for tests
 * @returns {object} initial client state
 */
export function initialState(overrides = {}) {
	const base = {
		ui: {
			view: "pairing",
			variant: "console",
			selectedRunId: null,
			inspectorOpen: false,
			inspectorTab: "details",
			chatCap: CHAT_CAP,
			activityFilter: "all",
		},
		conn: { status: "boot", attempt: 0, backoffMs: 1000, lastFrameAt: 0, error: null },
		auth: { status: "unknown", token: "", error: null },
		builds: { hash: "", moduleCount: 0, error: null },
		daemon: { status: "unknown", version: "", uptimeMs: 0, error: null },
		runs: { byId: {}, order: [], load: { status: "idle", error: null, at: 0, stamp: 0 } },
		approvals: { pending: {}, error: {} },
		pairing: { status: "idle", code: "", expiresAt: 0, device: null, error: null, attempts: [] },
		chat: { hint: "" },
		stream: { seen: {}, lastFrameAt: 0, cursor: "" },
	};
	const next = { ...base };
	for (const [section, value] of Object.entries(overrides)) {
		next[section] = value && typeof value === "object" && !Array.isArray(value) ? { ...base[section], ...value } : value;
	}
	return next;
}

/**
 * A shell run for an id we have only seen in a stream frame.
 * @param {string} id
 * @param {number} [createdAt]
 * @returns {object}
 */
export function blankRun(id, createdAt = 0) {
	return {
		id: String(id),
		title: "",
		titleSource: "pending",
		prompt: "",
		state: "",
		attempt: 1,
		createdAt: Number(createdAt) || 0,
		updatedAt: Number(createdAt) || 0,
		finishedAt: null,
		lastHeartbeat: null,
		ownerDeviceId: null,
		tokensText: "",
		pendingTool: null,
		toolNote: "",
		toolEvents: [],
	};
}

/**
 * @param {object} state
 * @param {object} action
 * @returns {object} next state (the same object when nothing changed)
 */
export function reduce(state, action) {
	if (!action || typeof action.type !== "string") return state;
	switch (action.type) {
		case "ui.route":
			return withUi(state, { view: String(action.view) });

		case "ui.variant":
			return withUi(state, { variant: String(action.variant) });

		case "ui.select":
			return withUi(state, {
				selectedRunId: action.id == null ? null : String(action.id),
				inspectorOpen: action.id != null,
			});

		case "ui.inspectorToggle":
			return withUi(state, { inspectorOpen: action.open === undefined ? !state.ui.inspectorOpen : Boolean(action.open) });

		case "ui.inspectorTab":
			return withUi(state, { inspectorTab: String(action.tab) });

		case "ui.activityFilter":
			return withUi(state, { activityFilter: String(action.filter) });

		case "conn.set": {
			const conn = {
				...state.conn,
				status: action.status ? String(action.status) : state.conn.status,
				attempt: action.attempt === undefined ? state.conn.attempt : Number(action.attempt) || 0,
				error: action.error === undefined ? state.conn.error : action.error,
			};
			if (action.backoffMs !== undefined) conn.backoffMs = Number(action.backoffMs) || conn.backoffMs;
			return { ...state, conn };
		}

		case "conn.frame":
			return { ...state, conn: { ...state.conn, lastFrameAt: Number(action.at) || 0 } };

		case "auth.boot": {
			const token = typeof action.token === "string" ? action.token.trim() : "";
			return {
				...state,
				auth: { status: token ? "hasToken" : "none", token, error: null },
			};
		}

		case "auth.token": {
			const token = typeof action.token === "string" ? action.token.trim() : "";
			if (!token) return state;
			return { ...state, auth: { status: "hasToken", token, error: null } };
		}

		case "auth.error":
			return { ...state, auth: { ...state.auth, error: String(action.error || "") } };

		case "auth.rejected":
			return { ...state, auth: { ...state.auth, status: "rejected", error: String(action.error || "unauthorized") } };

		case "auth.signOut":
			return {
				...state,
				auth: { status: "none", token: "", error: null },
				runs: { byId: {}, order: [], load: { status: "idle", error: null, at: 0, stamp: state.runs.load.stamp } },
				stream: { ...state.stream, seen: {} },
			};

		case "auth.verify":
			return state.auth.status === "verified" ? state : { ...state, auth: { ...state.auth, status: "verified", error: null } };

		case "builds.loaded":
			return {
				...state,
				builds: { hash: String(action.hash || ""), moduleCount: Number(action.moduleCount) || 0, error: null },
			};

		case "builds.error":
			return { ...state, builds: { hash: "", moduleCount: 0, error: String(action.error || "unknown build") } };

		case "daemon.loaded":
			return {
				...state,
				daemon: {
					status: String(action.status || "unknown"),
					version: String(action.version || ""),
					uptimeMs: Number(action.uptimeMs) || 0,
					error: null,
				},
			};

		case "daemon.error":
			return { ...state, daemon: { status: "unreachable", version: "", uptimeMs: 0, error: String(action.error || "unreachable") } };

		case "runs.loadStart": {
			const stamp = Number(action.stamp) || 0;
			return { ...state, runs: { ...state.runs, load: { status: "loading", error: null, at: state.runs.load.at, stamp } } };
		}

		case "runs.loadOk": {
			const stamp = Number(action.stamp) || 0;
			if (stamp && stamp < state.runs.load.stamp) return state;
			const merged = mergeRuns(state.runs, Array.isArray(action.runs) ? action.runs : []);
			return {
				...state,
				runs: { ...merged, load: { status: "ready", error: null, at: Number(action.at) || 0, stamp: state.runs.load.stamp } },
			};
		}

		case "runs.loadErr": {
			const stamp = Number(action.stamp) || 0;
			if (stamp && stamp < state.runs.load.stamp) return state;
			return {
				...state,
				runs: {
					...state.runs,
					load: {
						status: "error",
						error: String(action.error || "load failed"),
						at: state.runs.load.at,
						stamp: state.runs.load.stamp,
					},
				},
			};
		}

		case "run.upsert": {
			const merged = mergeRuns(state.runs, [action.run]);
			return { ...state, runs: merged };
		}

		case "run.patch": {
			const id = action.id == null ? "" : String(action.id);
			if (!id) return state;
			const at = Number(action.at) || 0;
			const patch = { ...(action.patch || {}) };
			const prev = state.runs.byId[id];
			if (!prev) {
				// A frame for an id we have never seen: keep a shell until a REST
				// fetch fills title and prompt (the label uses the fallback).
				if (!patch.createdAt) patch.createdAt = at;
				patch.titleSource = patch.titleSource || "pending";
			}
			if (at) patch.updatedAt = at;
			const merged = mergeRuns(state.runs, [{ id, ...patch }]);
			return { ...state, runs: merged };
		}

		case "run.tokens": {
			const id = action.id == null ? "" : String(action.id);
			if (!id) return state;
			const prev = state.runs.byId[id] || blankRun(id);
			const next = { ...prev, tokensText: prev.tokensText + String(action.text == null ? "" : action.text) };
			return { ...state, runs: { ...state.runs, byId: { ...state.runs.byId, [id]: next } } };
		}

		case "run.toolRequest": {
			const id = action.id == null ? "" : String(action.id);
			if (!id) return state;
			const prev = state.runs.byId[id] || blankRun(id, action.at);
			const tool = String(action.tool || "tool");
			const next = {
				...prev,
				state: "waiting_tool",
				pendingTool: tool,
				toolNote: "waiting on " + tool,
				updatedAt: Number(action.at) || prev.updatedAt,
				toolEvents: appendEvent(prev.toolEvents, {
					id: action.eventId == null ? "" : String(action.eventId),
					tool,
					source: "request",
					createdAt: Number(action.at) || 0,
				}),
			};
			return { ...state, runs: withRun(state.runs, next) };
		}

		case "run.toolResult": {
			const id = action.id == null ? "" : String(action.id);
			if (!id) return state;
			const prev = state.runs.byId[id] || blankRun(id, action.at);
			const tool = String(action.tool || "tool");
			const next = {
				...prev,
				pendingTool: null,
				toolNote: "tool " + tool + (action.ok === false ? " failed" : " done"),
				updatedAt: Number(action.at) || prev.updatedAt,
				toolEvents: appendEvent(prev.toolEvents, {
					id: action.eventId == null ? "" : String(action.eventId),
					tool,
					source: "result",
					ok: action.ok !== false,
					createdAt: Number(action.at) || 0,
				}),
			};
			return { ...state, runs: withRun(state.runs, next) };
		}

		case "run.eventsLoaded": {
			const id = action.id == null ? "" : String(action.id);
			if (!id || !Array.isArray(action.events)) return state;
			const prev = state.runs.byId[id];
			if (!prev) return state;
			const events = [...prev.toolEvents];
			for (const ev of action.events) {
				if (!ev) continue;
				if (events.some((e) => e.id && e.id === ev.id)) continue;
				events.push({
					id: String(ev.id || ""),
					tool: String(ev.tool || "tool"),
					source: ev.resultRef === "request" ? "request" : "result",
					resultRef: ev.resultRef || "",
					argsHash: ev.argsHash || "",
					createdAt: Number(ev.createdAt) || 0,
				});
			}
			return { ...state, runs: { ...state.runs, byId: { ...state.runs.byId, [id]: { ...prev, toolEvents: events } } } };
		}

		case "chat.hint":
			return { ...state, chat: { hint: String(action.hint == null ? "" : action.hint) } };

		case "stream.frame": {
			const frame = action.frame;
			if (!frame || typeof frame !== "object" || !frame.type) return state;
			const at = Number(frame.at) || 0;
			if (frame.type === "daemon.heartbeat") {
				// Heartbeats carry no seq and must never become a cursor.
				return { ...state, conn: { ...state.conn, lastFrameAt: at || state.conn.lastFrameAt }, stream: { ...state.stream, lastFrameAt: at || state.stream.lastFrameAt } };
			}
			const key = frame.id == null ? "" : "id:" + String(frame.id);
			if (key && state.stream.seen[key]) {
				return { ...state, conn: { ...state.conn, lastFrameAt: at || state.conn.lastFrameAt } };
			}
			let seen = state.stream.seen;
			if (key) {
				seen = { ...seen, [key]: 1 };
				const size = Object.keys(seen).length;
				if (size > SEEN_CAP) seen = prune(seen, SEEN_CAP / 2);
			}
			const framed = {
				...state,
				conn: { ...state.conn, lastFrameAt: at || state.conn.lastFrameAt },
				stream: { ...state.stream, seen, lastFrameAt: at || state.stream.lastFrameAt },
			};
			const id = frame.runId == null ? "" : String(frame.runId);
			const eventId = frame.id == null ? "" : String(frame.id);
			switch (frame.type) {
				case "run.created": {
					if (!id) return framed;
					const createdAt = at || 0;
					const existing = state.runs.byId[id];
					return reduce(framed, {
						type: "run.upsert",
						run: {
							id,
							title: typeof frame.title === "string" ? frame.title : "",
							titleSource: frame.title ? "server" : "pending",
							state: frame.state ? String(frame.state) : existing ? existing.state : "",
							createdAt: existing && existing.createdAt ? existing.createdAt : createdAt,
							updatedAt: createdAt || (existing ? existing.updatedAt : 0),
						},
					});
				}
				case "run.state":
					return reduce(framed, {
						type: "run.patch",
						id,
						at,
						patch: { state: String(frame.state || "") },
					});
				case "run.done":
					return reduce(framed, {
						type: "run.patch",
						id,
						at,
						patch: { state: String(frame.state || "done"), pendingTool: null, finishedAt: at || null },
					});
				case "run.token":
					return reduce(framed, { type: "run.tokens", id, text: frame.token });
				case "tool.request":
					return reduce(framed, { type: "run.toolRequest", id, tool: frame.tool, at, eventId });
				case "tool.result":
					return reduce(framed, { type: "run.toolResult", id, tool: frame.tool, ok: frame.ok !== false, at, eventId });
				default:
					return framed;
			}
		}

		case "approve.begin": {
			const id = String(action.id || "");
			if (!id) return state;
			return { ...state, approvals: { ...state.approvals, pending: { ...state.approvals.pending, [id]: "pending" }, error: without(state.approvals.error, id) } };
		}

		case "approve.settle": {
			const id = String(action.id || "");
			if (!id) return state;
			const base = {
				...state,
				approvals: { ...state.approvals, pending: without(state.approvals.pending, id) },
			};
			if (action.run) base.runs = mergeRuns(base.runs, [action.run]);
			if (action.error) base.approvals = { ...base.approvals, error: { ...base.approvals.error, [id]: String(action.error) } };
			return base;
		}

		default:
			return state;
	}
}

/**
 * @param {object} runs section
 * @param {Array<object|null|undefined>} rows
 * @returns {object} runs section with a union merge
 */
export function mergeRuns(runs, rows) {
	let byId = runs.byId;
	let order = runs.order;
	let touched = false;
	const incoming = [];
	for (const row of rows || []) {
		if (!row || row.id == null) continue;
		incoming.push(row);
	}
	if (incoming.length === 0) return runs;
	byId = { ...byId };
	order = order.slice();
	for (const row of incoming) {
		const id = String(row.id);
		const prev = byId[id];
		const merged = { ...blankRun(id), ...(prev || {}), ...row, id };
		// Client-only fields survive a REST row that does not carry them.
		merged.tokensText = row.tokensText !== undefined ? row.tokensText : prev ? prev.tokensText : "";
		merged.pendingTool = row.pendingTool !== undefined ? row.pendingTool : prev ? prev.pendingTool : null;
		merged.toolNote = row.toolNote !== undefined ? row.toolNote : prev ? prev.toolNote : "";
		merged.toolEvents = row.toolEvents !== undefined ? row.toolEvents : prev ? prev.toolEvents : [];
		if (!row.title && prev && prev.title) {
			merged.title = prev.title;
			merged.titleSource = prev.titleSource;
		}
		if (row.title) merged.titleSource = "server";
		byId[id] = merged;
		if (order.indexOf(id) === -1) {
			order.push(id);
			touched = true;
		}
	}
	if (touched) order.sort((a, b) => createdAtOf(byId, b) - createdAtOf(byId, a));
	return { ...runs, byId, order };
}

/**
 * Insert or replace one run, sorting only when the id is new so a state change
 * never reorders rows under the cursor.
 * @param {object} runs
 * @param {object} run
 * @returns {object}
 */
function withRun(runs, run) {
	const id = String(run.id);
	const prev = runs.byId[id];
	const merged = { ...blankRun(id), ...(prev || {}), ...run, id };
	const byId = { ...runs.byId, [id]: merged };
	let order = runs.order;
	if (!prev) {
		order = [...runs.order, id].sort((a, b) => createdAtOf(byId, b) - createdAtOf(byId, a));
	}
	return { ...runs, byId, order };
}

/** @returns {number} */
function createdAtOf(byId, id) {
	const run = byId[id];
	return run ? Number(run.createdAt) || 0 : 0;
}

/** @returns {object} */
function withUi(state, patch) {
	return { ...state, ui: { ...state.ui, ...patch } };
}

/** @returns {object} */
function without(map, key) {
	if (!map || !(key in map)) return map;
	const next = { ...map };
	delete next[key];
	return next;
}

/** @returns {object} */
function prune(seen, keep) {
	const keys = Object.keys(seen);
	const trimmed = keys.slice(Math.max(0, keys.length - keep));
	const next = {};
	for (const key of trimmed) next[key] = 1;
	return next;
}

/** @returns {Array<object>} */
function appendEvent(events, event) {
	const list = Array.isArray(events) ? events.slice() : [];
	if (event.id && list.some((e) => e.id === event.id)) return list;
	list.push(event);
	return list.slice(-200);
}

// --- selectors ------------------------------------------------------------

/** @returns {object|null} */
export function selectRun(state, id) {
	if (!id) return null;
	return state.runs.byId[String(id)] || null;
}

/** @returns {Array<object>} newest first */
export function selectOrderedRuns(state) {
	return state.runs.order.map((id) => state.runs.byId[id]).filter(Boolean);
}

/** @returns {Array<object>} newest chatCap runs, oldest first */
export function selectChatRuns(state) {
	const cap = Number(state.ui.chatCap) || CHAT_CAP;
	return selectOrderedRuns(state).slice(0, cap).reverse();
}

/** @returns {Array<object>} approvable runs, most recently updated first */
export function selectApprovals(state) {
	return selectOrderedRuns(state)
		.filter((run) => APPROVABLE_STATES.has(run.state))
		.sort((a, b) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0));
}

/** @returns {Array<object>} newest ACTIVITY_CAP runs matching the filter */
export function selectActivity(state) {
	const filter = state.ui.activityFilter || "all";
	const rows = selectOrderedRuns(state).slice(0, ACTIVITY_CAP);
	if (filter === "all") return rows;
	return rows.filter((run) => run.state === filter);
}

/** @returns {number} */
export function selectPendingCount(state) {
	return selectApprovals(state).length;
}

/**
 * No REST call may be made unless a token exists (root fix for the stuck
 * "auth failed" line from a pre-token activity load).
 * @returns {boolean}
 */
export function selectCanFetch(state) {
	return state.auth.status === "hasToken" || state.auth.status === "verified";
}

/**
 * @param {object} state
 * @returns {string} cursor to send as `since`, or "" when none is known
 */
export function selectCursor(state) {
	return String(state.stream.cursor || "");
}

/**
 * @param {object} [seed]
 * @returns {{getState: () => object, dispatch: (action: object) => void, subscribe: (fn: (state: object, action: object) => void) => () => void}}
 */
export function createStore(seed = initialState()) {
	let state = seed;
	const subscribers = new Set();
	return {
		getState() {
			return state;
		},
		dispatch(action) {
			const next = reduce(state, action);
			if (next === state) return;
			const previous = state;
			state = next;
			for (const fn of subscribers) fn(state, action, previous);
		},
		subscribe(fn) {
			subscribers.add(fn);
			return () => subscribers.delete(fn);
		},
	};
}
