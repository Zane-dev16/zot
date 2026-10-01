"use strict";

(() => {
	var logEl = document.getElementById("log");
	var boxEl = document.getElementById("box");
	var statusEl = document.getElementById("status");
	var tokenEl = document.getElementById("token");
	var formEl = document.getElementById("composer");

	tokenEl.value = localStorage.getItem("zot.token") || "";

	var lastId = localStorage.getItem("zot.since") || "";
	var seen = {};
	var socket = null;
	var backoff = 1000;
	var runs = {};

	function setStatus(text) {
		statusEl.textContent = text;
	}

	function remember(event) {
		if (event.id == null) return;
		lastId = String(event.id);
		localStorage.setItem("zot.since", lastId);
	}

	function runBlock(id) {
		var el = runs[id];
		if (!el) {
			el = document.createElement("article");
			var title = document.createElement("h2");
			var tokens = document.createElement("p");
			tokens.className = "tokens";
			var state = document.createElement("p");
			state.className = "state";
			el.appendChild(title);
			el.appendChild(tokens);
			el.appendChild(state);
			logEl.appendChild(el);
			runs[id] = el;
		}
		return el;
	}

	function onEvent(event) {
		if (!event || !event.type) return;
		if (event.id != null && seen[event.id]) return;
		if (event.id != null) seen[event.id] = true;
		remember(event);
		if (event.type === "daemon.heartbeat") return;
		var id = event.runId || event.id;
		if (id == null) return;
		var el = runBlock(String(id));
		if (event.type === "run.created") {
			el.querySelector("h2").textContent = event.title || String(id);
		} else if (event.type === "run.token") {
			el.querySelector(".tokens").textContent += event.token || "";
		} else if (event.type === "run.state" || event.type === "run.done") {
			el.querySelector(".state").textContent = event.state || event.type;
		} else if (event.type === "tool.request") {
			el.querySelector(".state").textContent = "tool " + event.tool;
		}
		el.scrollIntoView({ block: "nearest" });
		backoff = 1000;
	}

	function streamUrl() {
		var proto = location.protocol === "https:" ? "wss:" : "ws:";
		var token = localStorage.getItem("zot.token") || "";
		var url =
			proto +
			"//" +
			location.host +
			"/api/v1/stream?token=" +
			encodeURIComponent(token);
		if (lastId) url += "&since=" + encodeURIComponent(lastId);
		return url;
	}

	function connect() {
		if (socket) {
			try {
				socket.close();
			} catch (err) {
				// socket already gone
			}
		}
		setStatus("connecting");
		socket = new WebSocket(streamUrl());
		socket.onopen = () => {
			setStatus("live");
			backoff = 1000;
		};
		socket.onmessage = (msg) => {
			try {
				onEvent(JSON.parse(msg.data));
			} catch (err) {
				// one bad frame must not kill the stream
			}
		};
		socket.onclose = () => {
			setStatus("reconnecting");
			setTimeout(connect, backoff);
			backoff = Math.min(backoff * 2, 10000);
		};
		socket.onerror = () => {
			try {
				socket.close();
			} catch (err) {
				// close handler schedules the retry
			}
		};
	}

	document.getElementById("saveToken").addEventListener("click", () => {
		localStorage.setItem("zot.token", tokenEl.value.trim());
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
				authorization: "Bearer " + (localStorage.getItem("zot.token") || ""),
			},
			body: JSON.stringify({ prompt: prompt }),
		}).catch(() => {
			setStatus("post failed, stream still live");
		});
	});

	connect();
})();
