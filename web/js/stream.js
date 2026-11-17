// WebSocket transport. One socket, backoff 1s→10s, stale-frame watchdog, and
// a since cursor. It never touches the store: frames go out through onFrame and
// every status change through onStatus, so main.js owns the dispatch.
//
// The server protocol (src/stream.js, unchanged) authenticates the upgrade with
// `?token=`; the console never puts the token in the page URL, query, or hash.

const BACKOFF_MIN = 1000;
const BACKOFF_MAX = 10000;
const STALE_AFTER_MS = 35000;
const WATCHDOG_MS = 5000;

/**
 * @param {{
 *   getToken: () => string,
 *   getCursor: () => string,
 *   onFrame: (frame: object) => void,
 *   onStatus: (status: {status: string, attempt: number, backoffMs?: number}) => void,
 *   onCloseWhileLive?: () => void,
 *   location?: Location,
 *   WebSocketImpl?: typeof WebSocket,
 * }} options
 */
export function createStream(options) {
	const getToken = options.getToken;
	const getCursor = options.getCursor || (() => "");
	const onFrame = options.onFrame;
	const onStatus = options.onStatus;
	const onCloseWhileLive = options.onCloseWhileLive || (() => {});
	const loc = options.location || location;
	const Socket = options.WebSocketImpl || WebSocket;

	let socket = null;
	let retryTimer = null;
	let watchdog = null;
	let attempt = 0;
	let backoffMs = BACKOFF_MIN;
	let live = false;
	let paused = false;
	let closedByUs = false;

	function streamUrl() {
		const proto = loc.protocol === "https:" ? "wss:" : "ws:";
		let url = proto + "//" + loc.host + "/api/v1/stream?token=" + encodeURIComponent(getToken());
		const cursor = getCursor();
		if (cursor) url += "&since=" + encodeURIComponent(cursor);
		return url;
	}

	function clearRetry() {
		if (retryTimer) {
			clearTimeout(retryTimer);
			retryTimer = null;
		}
	}

	function destroySocket() {
		if (!socket) return;
		const dying = socket;
		socket = null;
		dying.onopen = null;
		dying.onmessage = null;
		dying.onclose = null;
		dying.onerror = null;
		try {
			dying.close();
		} catch {
			// already gone
		}
	}

	function scheduleReconnect() {
		clearRetry();
		const wait = backoffMs;
		backoffMs = Math.min(backoffMs * 2, BACKOFF_MAX);
		retryTimer = setTimeout(() => {
			retryTimer = null;
			connect();
		}, wait);
	}

	function startWatchdog() {
		stopWatchdog();
		if (typeof setInterval !== "function") return;
		watchdog = setInterval(() => {
			if (!live || !socket) return;
			if (lastFrameAt && Date.now() - lastFrameAt > STALE_AFTER_MS) {
				// A half-dead socket: force a clean reconnect instead of waiting forever.
				live = false;
				destroySocket();
				attempt += 1;
				onStatus({ status: "reconnecting", attempt, backoffMs });
				scheduleReconnect();
			}
		}, WATCHDOG_MS);
	}

	function stopWatchdog() {
		if (watchdog) {
			clearInterval(watchdog);
			watchdog = null;
		}
	}

	let lastFrameAt = 0;

	/** Open (or re-open) the socket. */
	function connect() {
		if (paused) return;
		const token = getToken();
		if (!token) {
			onStatus({ status: "auth", attempt: 0 });
			return;
		}
		clearRetry();
		destroySocket();
		live = false;
		closedByUs = false;
		onStatus({ status: attempt > 0 ? "reconnecting" : "connecting", attempt, backoffMs });
		let ws;
		try {
			ws = new Socket(streamUrl());
		} catch {
			attempt += 1;
			onStatus({ status: "reconnecting", attempt, backoffMs });
			scheduleReconnect();
			return;
		}
		socket = ws;
		ws.onopen = () => {
			if (socket !== ws) return;
			live = true;
			attempt = 0;
			backoffMs = BACKOFF_MIN;
			lastFrameAt = Date.now();
			onStatus({ status: "live", attempt: 0, backoffMs });
			startWatchdog();
		};
		ws.onmessage = (message) => {
			if (socket !== ws) return;
			let frame = null;
			try {
				frame = JSON.parse(message.data);
			} catch {
				return;
			}
			if (!frame || typeof frame !== "object") return;
			lastFrameAt = Date.now();
			onFrame(frame);
		};
		ws.onclose = () => {
			if (socket !== ws) return;
			socket = null;
			const wasLive = live;
			live = false;
			stopWatchdog();
			if (closedByUs || paused) return;
			if (wasLive) onCloseWhileLive();
			attempt += 1;
			onStatus({ status: "reconnecting", attempt, backoffMs });
			scheduleReconnect();
		};
		ws.onerror = () => {
			if (socket !== ws) return;
			try {
				ws.close();
			} catch {
				// close handler schedules the retry
			}
		};
	}

	/** Close without scheduling a retry. */
	function close() {
		closedByUs = true;
		live = false;
		clearRetry();
		stopWatchdog();
		destroySocket();
	}

	/** Stop retrying; used while the browser reports offline. */
	function pause() {
		paused = true;
		close();
	}

	/** Resume after `online`. */
	function resume() {
		paused = false;
		attempt = 0;
		backoffMs = BACKOFF_MIN;
		connect();
	}

	/** Drop the socket and reconnect now with a fresh backoff. */
	function retryNow() {
		closedByUs = true;
		clearRetry();
		stopWatchdog();
		destroySocket();
		closedByUs = false;
		attempt = 0;
		backoffMs = BACKOFF_MIN;
		connect();
	}

	return { connect, close, pause, resume, retryNow };
}
