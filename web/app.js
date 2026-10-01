"use strict";

(() => {
	var logEl = document.getElementById("log");
	var boxEl = document.getElementById("box");
	var statusEl = document.getElementById("status");
	var tokenEl = document.getElementById("token");
	var formEl = document.getElementById("composer");
	var retryNowEl = document.getElementById("retryNow");
	var retryCountEl = document.getElementById("retryCount");
	var activityEl = document.getElementById("activity");
	var refreshEl = document.getElementById("refreshActivity");
	var activityErrorEl = document.getElementById("activityError");

	tokenEl.value = localStorage.getItem("zot.token") || "";

	var lastId = localStorage.getItem("zot.since") || "";
	var seen = {};
	var socket = null;
	var backoff = 1000;
	var attempt = 0;
	var retryTimer = null;
	var offline = false;
	var authFailed = false;

	// RunView is the live model for one run block.
	// RunView holds id plus title plus tokens plus state plus pendingTool.
	// State mirrors server run.state plus tool events plus REST.
	var views = {};

	// Approval is a state machine transition.
	// waiting_tool moves to running on approve.
	// waiting_tool moves to cancelled on cancel.
	var APPROVAL = {
		waiting_tool: { approve: "running", cancel: "cancelled" },
	};

	function approvalTarget(state, action) {
		var row = APPROVAL[state];
		if (!row) return null;
		return row[action] || null;
	}

	function canModerate(state) {
		return Object.hasOwn(APPROVAL, state);
	}

	function authToken() {
		return localStorage.getItem("zot.token") || "";
	}

	function authHeaders() {
		return { authorization: "Bearer " + authToken() };
	}

	function setStatus(text, kind) {
		statusEl.textContent = text;
		if (kind) statusEl.setAttribute("data-kind", kind);
		if (retryCountEl) {
			retryCountEl.textContent = attempt > 0 ? "retry " + attempt : "";
		}
	}

	function remember(event) {
		if (event.id == null) return;
		lastId = String(event.id);
		localStorage.setItem("zot.since", lastId);
	}

	function renderApproval(id) {
		var view = views[id];
		if (!view) return;
		if (canModerate(view.state)) {
			view.approvalRow.style.display = "flex";
		} else {
			view.approvalRow.style.display = "none";
		}
	}

	function runBlock(id) {
		var view = views[id];
		if (view) return view;
		var el = document.createElement("article");
		var title = document.createElement("h2");
		title.textContent = String(id);
		var tokens = document.createElement("p");
		tokens.className = "tokens";
		var state = document.createElement("p");
		state.className = "state";
		state.textContent = "";
		var row = document.createElement("div");
		row.className = "approvalRow";
		row.style.display = "none";
		var approveBtn = document.createElement("button");
		approveBtn.type = "button";
		approveBtn.textContent = "Approve";
		var cancelBtn = document.createElement("button");
		cancelBtn.type = "button";
		cancelBtn.textContent = "Cancel";
		cancelBtn.className = "danger";
		row.appendChild(approveBtn);
		row.appendChild(cancelBtn);
		el.appendChild(title);
		el.appendChild(tokens);
		el.appendChild(state);
		el.appendChild(row);
		logEl.appendChild(el);
		view = {
			id: String(id),
			title: String(id),
			tokens: "",
			state: "",
			pendingTool: null,
			el: el,
			titleEl: title,
			tokensEl: tokens,
			stateEl: state,
			approvalRow: row,
			approveBtn: approveBtn,
			cancelBtn: cancelBtn,
			busy: false,
		};
		approveBtn.addEventListener("click", () => {
			doApproval(view.id, "approve");
		});
		cancelBtn.addEventListener("click", () => {
			doApproval(view.id, "cancel");
		});
		views[id] = view;
		return view;
	}

	function doApproval(id, action) {
		var view = views[id];
		if (!view || view.busy) return;
		if (!canModerate(view.state)) return;
		view.busy = true;
		view.approveBtn.disabled = true;
		view.cancelBtn.disabled = true;
		view.stateEl.textContent =
			action === "approve" ? "approving" : "cancelling";
		fetch("/api/v1/runs/" + encodeURIComponent(id) + "/" + action, {
			method: "POST",
			headers: authHeaders(),
		})
			.then((res) => {
				if (!res.ok) throw new Error(action + " failed " + res.status);
				return res.json();
			})
			.then((data) => {
				var st = data && data.run && data.run.state;
				var target = st || approvalTarget(view.state, action);
				view.busy = false;
				view.approveBtn.disabled = false;
				view.cancelBtn.disabled = false;
				if (target) {
					view.state = target;
					view.pendingTool = null;
					view.stateEl.textContent = target;
				} else {
					view.stateEl.textContent = action + " ok";
				}
				renderApproval(id);
			})
			.catch((err) => {
				view.busy = false;
				view.approveBtn.disabled = false;
				view.cancelBtn.disabled = false;
				view.stateEl.textContent = String(
					(err && err.message) || "approval failed",
				);
			});
	}

	function onEvent(event) {
		if (!event || !event.type) return;
		if (event.id != null && seen[event.id]) return;
		if (event.id != null) seen[event.id] = true;
		remember(event);
		if (event.type === "daemon.heartbeat") return;
		var id = event.runId || event.id;
		if (id == null) return;
		var view = runBlock(String(id));
		if (event.type === "run.created") {
			view.title = event.title || String(id);
			view.titleEl.textContent = view.title;
			if (event.state) {
				view.state = event.state;
				view.stateEl.textContent = event.state;
				renderApproval(view.id);
			}
		} else if (event.type === "run.token") {
			view.tokens += event.token || "";
			view.tokensEl.textContent = view.tokens;
		} else if (event.type === "run.state") {
			view.state = event.state || view.state;
			view.stateEl.textContent = event.state || view.state;
			if (view.state !== "waiting_tool") view.pendingTool = null;
			renderApproval(view.id);
		} else if (event.type === "run.done") {
			view.state = event.state || "done";
			view.pendingTool = null;
			view.stateEl.textContent = view.state;
			renderApproval(view.id);
		} else if (event.type === "tool.request") {
			view.state = "waiting_tool";
			view.pendingTool = event.tool || null;
			view.stateEl.textContent =
				"tool " + (event.tool || "") + " waiting approval";
			renderApproval(view.id);
		} else if (event.type === "tool.result") {
			view.stateEl.textContent = "tool " + (event.tool || "") + " done";
		}
		view.el.scrollIntoView({ block: "nearest" });
		backoff = 1000;
	}

	function streamUrl() {
		var proto = location.protocol === "https:" ? "wss:" : "ws:";
		var url =
			proto +
			"//" +
			location.host +
			"/api/v1/stream?token=" +
			encodeURIComponent(authToken());
		if (lastId) url += "&since=" + encodeURIComponent(lastId);
		return url;
	}

	function probeAuthFailure() {
		return fetch("/api/v1/runs", { headers: authHeaders() }).then(
			(res) => res.status === 401,
			() => false,
		);
	}

	function scheduleReconnect() {
		if (retryTimer) clearTimeout(retryTimer);
		retryTimer = setTimeout(() => {
			retryTimer = null;
			connect();
		}, backoff);
		backoff = Math.min(backoff * 2, 10000);
	}

	function handleClose() {
		if (offline) {
			setStatus("offline", "offline");
			return;
		}
		attempt += 1;
		setStatus("reconnecting attempt " + attempt, "reconnecting");
		probeAuthFailure().then((isAuth) => {
			if (isAuth) {
				authFailed = true;
				if (retryTimer) clearTimeout(retryTimer);
				retryTimer = null;
				setStatus("auth failed", "auth");
			}
		});
		scheduleReconnect();
	}

	function connect() {
		if (offline) {
			setStatus("offline", "offline");
			return;
		}
		if (retryTimer) {
			clearTimeout(retryTimer);
			retryTimer = null;
		}
		if (socket) {
			try {
				socket.close();
			} catch (err) {
				// socket already gone
			}
			socket = null;
		}
		if (!authFailed) setStatus("connecting", "connecting");
		socket = new WebSocket(streamUrl());
		socket.onopen = () => {
			setStatus("live", "live");
			backoff = 1000;
			attempt = 0;
			authFailed = false;
			if (retryCountEl) retryCountEl.textContent = "";
		};
		socket.onmessage = (msg) => {
			try {
				onEvent(JSON.parse(msg.data));
			} catch (err) {
				// one bad frame must not kill the stream
			}
		};
		socket.onclose = () => {
			socket = null;
			if (authFailed) return;
			handleClose();
		};
		socket.onerror = () => {
			try {
				socket.close();
			} catch (err) {
				// close handler schedules the retry
			}
		};
	}

	function renderActivityRuns(list) {
		activityEl.textContent = "";
		var items = (list || []).slice(0, 30);
		if (items.length === 0) {
			var empty = document.createElement("li");
			empty.textContent = "no runs";
			activityEl.appendChild(empty);
			return;
		}
		items.forEach((run) => {
			var li = document.createElement("li");
			var btn = document.createElement("button");
			btn.type = "button";
			btn.className = "activityRun";
			var when = run.updatedAt ? new Date(run.updatedAt).toLocaleString() : "";
			btn.textContent =
				(run.title || run.id) + " " + (run.state || "") + " " + when;
			btn.addEventListener("click", () => {
				toggleActivityDetail(run.id, li);
			});
			li.appendChild(btn);
			activityEl.appendChild(li);
		});
	}

	function toggleActivityDetail(id, li) {
		var existing = li.querySelector(".activityEvents");
		if (existing) {
			existing.remove();
			return;
		}
		var box = document.createElement("div");
		box.className = "activityEvents";
		box.textContent = "loading";
		li.appendChild(box);
		fetch("/api/v1/runs/" + encodeURIComponent(id) + "/events", {
			headers: authHeaders(),
		})
			.then((res) => {
				if (!res.ok) throw new Error("events failed " + res.status);
				return res.json();
			})
			.then((data) => {
				var evs = (data && data.events) || [];
				if (evs.length === 0) {
					box.textContent = "no tool events";
					return;
				}
				box.textContent = "";
				var ul = document.createElement("ul");
				evs.forEach((ev) => {
					var row = document.createElement("li");
					var tool = ev.tool || "tool";
					var ref = ev.result_ref || ev.resultRef || "";
					row.textContent = ref ? tool + " " + ref : tool;
					ul.appendChild(row);
				});
				box.appendChild(ul);
			})
			.catch((err) => {
				box.textContent = String((err && err.message) || "events failed");
			});
	}

	function loadActivity() {
		if (!activityErrorEl) return;
		activityErrorEl.textContent = "";
		fetch("/api/v1/runs", { headers: authHeaders() })
			.then((res) => {
				if (res.status === 401) throw new Error("auth failed");
				if (!res.ok) throw new Error("runs failed " + res.status);
				return res.json();
			})
			.then((data) => {
				renderActivityRuns(data.runs);
			})
			.catch((err) => {
				activityErrorEl.textContent = String(
					(err && err.message) || "runs failed",
				);
			});
	}

	document.getElementById("saveToken").addEventListener("click", () => {
		localStorage.setItem("zot.token", tokenEl.value.trim());
		authFailed = false;
		attempt = 0;
		backoff = 1000;
		connect();
	});

	if (retryNowEl) {
		retryNowEl.addEventListener("click", () => {
			backoff = 1000;
			authFailed = false;
			if (!offline) attempt = 0;
			connect();
		});
	}

	window.addEventListener("offline", () => {
		offline = true;
		if (retryTimer) {
			clearTimeout(retryTimer);
			retryTimer = null;
		}
		setStatus("offline", "offline");
		if (socket) {
			try {
				socket.close();
			} catch (err) {
				// socket already gone
			}
		}
	});

	window.addEventListener("online", () => {
		if (!offline) return;
		offline = false;
		backoff = 1000;
		authFailed = false;
		connect();
	});

	formEl.addEventListener("submit", (ev) => {
		ev.preventDefault();
		var prompt = boxEl.value.trim();
		if (!prompt) return;
		boxEl.value = "";
		fetch("/api/v1/runs", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: "Bearer " + authToken(),
			},
			body: JSON.stringify({ title: prompt.slice(0, 60), prompt: prompt }),
		}).catch(() => {
			setStatus("post failed, stream still live", "live");
		});
	});

	if (refreshEl) {
		refreshEl.addEventListener("click", loadActivity);
	}

	loadActivity();
	connect();
})();
