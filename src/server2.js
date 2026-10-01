"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const { openDb, DATA_DIR, version } = require("./db");
const { reconcile } = require("./daemon2");
const { createHandler } = require("./api");

const PORT = Number(process.env.PORT || 8787);
const HOST = "127.0.0.1";
const HEARTBEAT_MS = 5 * 1000;

const MIME = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
	".ico": "image/x-icon",
};

function newId() {
	return crypto.randomUUID();
}

function daemonState(db, bootId) {
	const row = db.prepare("SELECT state FROM daemon WHERE id = ?").get(bootId);
	return row ? row.state : "unknown";
}

function serveWeb(req, res) {
	const webDir = path.join(__dirname, "..", "web");
	let rel = req.url.split("?")[0];
	if (rel === "/") rel = "/index.html";
	const file = path.normalize(path.join(webDir, rel));
	if (
		!file.startsWith(webDir) ||
		!fs.existsSync(file) ||
		fs.statSync(file).isDirectory()
	) {
		res.writeHead(404, { "content-type": "text/plain" });
		res.end("not found");
		return;
	}
	res.writeHead(200, {
		"content-type": MIME[path.extname(file)] || "application/octet-stream",
	});
	fs.createReadStream(file).pipe(res);
}

function createServer(db, bootId, startedAt) {
	const handleApi = createHandler(db);
	return http.createServer((req, res) => {
		const url = req.url.split("?")[0];
		if (req.method === "GET" && url === "/healthz") {
			const body = JSON.stringify({
				version: version(),
				state: daemonState(db, bootId),
				startedAt,
				uptimeMs: Date.now() - startedAt,
			});
			res.writeHead(200, { "content-type": "application/json" });
			res.end(body);
			return;
		}
		if (handleApi(req, res)) return;
		if (req.method === "GET") {
			serveWeb(req, res);
			return;
		}
		res.writeHead(404, { "content-type": "application/json" });
		res.end(JSON.stringify({ error: "not found" }));
	});
}

function boot(opts) {
	const o = opts || {};
	const port = o.port || PORT;
	const db = openDb(o.dbPath);
	const bootId = newId();
	const startedAt = Date.now();
	reconcile(db, bootId, startedAt);
	const server = createServer(db, bootId, startedAt);
	const beat = setInterval(() => {
		db.prepare("UPDATE daemon SET heartbeat_at = ? WHERE id = ?").run(
			Date.now(),
			bootId,
		);
	}, HEARTBEAT_MS);
	beat.unref();

	function shutdown() {
		try {
			db.prepare("UPDATE daemon SET state = 'draining' WHERE id = ?").run(
				bootId,
			);
		} catch {
			// db already closed
		}
		clearInterval(beat);
		server.close(() => {
			db.close();
			process.exit(0);
		});
		setTimeout(() => {
			try {
				db.close();
			} catch {
				// already closed
			}
			process.exit(0);
		}, 1000).unref();
	}
	process.on("SIGTERM", shutdown);
	process.on("SIGINT", shutdown);

	if (require.main === module || o.listen !== false) {
		server.listen(port, HOST, () => {
			console.log(`zot server2 on http://${HOST}:${port} boot ${bootId}`);
		});
	}
	return { db, server, bootId, startedAt, shutdown };
}

if (require.main === module) {
	boot();
}

module.exports = { boot, createServer };
