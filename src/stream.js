"use strict";

const crypto = require("node:crypto");

const events = require("./events");
const events2 = require("./events2");

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const STREAM_PATH = "/api/v1/stream";
const HEARTBEAT_MS = 15000;

function acceptKey(key) {
	return crypto
		.createHash("sha1")
		.update(key + WS_GUID)
		.digest("base64");
}

function defaultVerify(db, token) {
	if (!token) return false;
	try {
		const auth = require("./auth");
		const rows = db
			.prepare("SELECT token_hash FROM device_session WHERE revoked_at IS NULL")
			.all();
		if (rows.length === 0) return true;
		const hashed = auth.hashToken(token);
		return rows.some((row) => {
			try {
				return auth.tokensEqual(hashed, row.token_hash);
			} catch {
				return false;
			}
		});
	} catch {
		return true;
	}
}

function encodeText(str) {
	const body = Buffer.from(str, "utf8");
	const len = body.length;
	let head;
	if (len < 126) {
		head = Buffer.from([0x81, len]);
	} else if (len < 65536) {
		head = Buffer.alloc(3);
		head[0] = 0x81;
		head[1] = 126;
		head.writeUInt16BE(len, 2);
	} else {
		head = Buffer.alloc(9);
		head[0] = 0x81;
		head[1] = 127;
		head.writeBigUInt64BE(BigInt(len), 1);
	}
	return Buffer.concat([head, body]);
}

function decodeFrames(state, chunk) {
	state.buf = Buffer.concat([state.buf, chunk]);
	const out = [];
	for (;;) {
		if (state.buf.length < 2) return out;
		const fin = (state.buf[0] & 0x80) !== 0;
		const opcode = state.buf[0] & 0x0f;
		const masked = (state.buf[1] & 0x80) !== 0;
		let len = state.buf[1] & 0x7f;
		let off = 2;
		if (len === 126) {
			if (state.buf.length < 4) return out;
			len = state.buf.readUInt16BE(2);
			off = 4;
		} else if (len === 127) {
			if (state.buf.length < 10) return out;
			len = Number(state.buf.readBigUInt64BE(2));
			off = 10;
		}
		const keyLen = masked ? 4 : 0;
		if (state.buf.length < off + keyLen + len) return out;
		let payload = state.buf.subarray(off + keyLen, off + keyLen + len);
		if (masked) {
			const key = state.buf.subarray(off, off + 4);
			const raw = Buffer.alloc(len);
			for (let i = 0; i < len; i++) raw[i] = payload[i] ^ key[i % 4];
			payload = raw;
		}
		state.buf = state.buf.subarray(off + keyLen + len);
		if (opcode === 0x8) {
			out.push({ close: true });
			return out;
		}
		if (opcode === 0x9) {
			out.push({ pong: payload });
			continue;
		}
		if (opcode === 0xa) continue;
		if (opcode === 0x1 || opcode === 0x2 || opcode === 0x0) {
			state.frag = Buffer.concat([state.frag, payload]);
			if (!fin) continue;
			out.push({ text: state.frag.toString("utf8") });
			state.frag = Buffer.alloc(0);
		}
	}
}

function reject(socket, code, message) {
	socket.write(
		`HTTP/1.1 ${code} ${message}\r\nconnection: close\r\ncontent-type: text/plain\r\ncontent-length: ${message.length}\r\n\r\n${message}`,
	);
	socket.destroy();
}

function attach(server, opts) {
	const o = opts || {};
	const db = o.db || null;
	const log = o.log || events.createLog();
	const verify = o.verify || defaultVerify;
	const heartbeatMs = o.heartbeatMs == null ? HEARTBEAT_MS : o.heartbeatMs;
	const clients = new Set();

	function send(socket, obj) {
		if (socket.destroyed) return;
		socket.write(encodeText(JSON.stringify(obj)));
	}

	function broadcast(obj) {
		const frame = encodeText(JSON.stringify(obj));
		for (const socket of clients) {
			if (!socket.destroyed) socket.write(frame);
		}
	}

	function publish(type, data) {
		const event = events2.recordEvent(db, log, type, data);
		broadcast(event);
		return event;
	}

	function onUpgrade(req, socket, head) {
		let url;
		try {
			url = new URL(req.url, "http://localhost");
		} catch {
			return;
		}
		if (url.pathname !== STREAM_PATH) return;
		if (
			String(req.headers.upgrade || "").toLowerCase() !== "websocket" ||
			!req.headers["sec-websocket-key"]
		) {
			reject(socket, 400, "websocket upgrade required");
			return;
		}
		const token = url.searchParams.get("token") || "";
		const since = url.searchParams.get("since") || "";
		let ok = false;
		try {
			ok = verify(db, token);
		} catch {
			ok = false;
		}
		if (!ok) {
			reject(socket, 401, "unauthorized");
			return;
		}
		socket.write(
			"HTTP/1.1 101 Switching Protocols\r\n" +
				"Upgrade: websocket\r\n" +
				"Connection: Upgrade\r\n" +
				`Sec-WebSocket-Accept: ${acceptKey(req.headers["sec-websocket-key"])}\r\n\r\n`,
		);
		const state = { buf: Buffer.alloc(0), frag: Buffer.alloc(0) };
		clients.add(socket);
		for (const event of events2.replayEvents(db, log, since))
			send(socket, event);
		if (head && head.length > 0) {
			for (const msg of decodeFrames(state, head)) {
				if (msg.close) {
					socket.destroy();
					return;
				}
			}
		}
		socket.on("data", (chunk) => {
			for (const msg of decodeFrames(state, chunk)) {
				if (msg.close) {
					socket.destroy();
					return;
				}
				if (msg.pong) {
					const body = Buffer.from(msg.pong);
					const head = Buffer.from([0x8a, body.length]);
					socket.write(Buffer.concat([head, body]));
				}
			}
		});
		socket.on("close", () => clients.delete(socket));
		socket.on("error", () => clients.delete(socket));
	}

	server.on("upgrade", onUpgrade);

	const beat =
		heartbeatMs > 0
			? setInterval(() => {
					broadcast({
						id: "hb-" + Date.now(),
						type: "daemon.heartbeat",
						at: Date.now(),
					});
				}, heartbeatMs)
			: null;
	if (beat) beat.unref();

	function close() {
		server.removeListener("upgrade", onUpgrade);
		if (beat) clearInterval(beat);
		for (const socket of clients) socket.destroy();
		clients.clear();
	}

	return { clients, log, broadcast, publish, close, path: STREAM_PATH };
}

module.exports = {
	STREAM_PATH,
	HEARTBEAT_MS,
	attach,
	encodeText,
	decodeFrames,
	defaultVerify,
};
