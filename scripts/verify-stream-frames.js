"use strict";
// WebSocket text-frame regression check for the daemon stream (src/stream.js).
//
// Two distinct encodeText regressions, with different blast radii.
//
// Regression 1 (fixed at ebe24f0), payloads of 126..65535 bytes: encodeText
// allocated a 3-byte header for the 16-bit extended-length path (RFC 6455 5.2
// wants 4: 0x81, 126, then 2 length bytes). Every outbound frame whose payload
// was 126 bytes or more threw ERR_OUT_OF_RANGE. A run.token event is ~131
// bytes. The replay loop runs inside onUpgrade with no try/catch around it, so
// replaying such a frame could kill the daemon with exit 1; a live broadcast
// threw inside the publishing call instead.
//
// Regression 2 (fixed here), payloads of 65536 bytes or more: the >= 65536
// branch allocated 9 bytes and wrote the 64-bit length at offset 1, overwriting
// the 0x7F marker. RFC 6455 5.2 wants a 10-byte header: 0x81, 0x7F, then 8
// big-endian length bytes. It was reachable, not latent: POST /api/v1/jobs
// accepts an unbounded name (src/api.js:657-666), so one scheduler tick
// publishing a run.created with that title (src/runner.js:244-258) put a 70 KiB
// payload on the wire.
//
// Nothing threw on that 64-bit path. The old header for a 70,116-byte body was
// `81 00 00 00 00 00 01 11 e4` + body: the overwritten marker made the decoder
// read a ZERO-LENGTH text frame, so it consumed the first 2 bytes and left the
// other 7 of the 9 header bytes in its buffer to misparse as the next frame's
// header. Both 64-bit paths therefore corrupted the client rather than the
// daemon:
//   - LIVE/BROADCAST (src/stream.js broadcast via publish): every connected
//     socket desynced in place. The daemon stayed healthy and the DB recorded
//     the run, while the client silently lost the events that followed, e.g.
//     run.token and run.done.
//   - REPLAY (src/stream.js onUpgrade): the replayed frame itself desynced the
//     client before its cursor could advance, so it reconnected onto the same
//     corrupt frame forever (the shipped RN client logged 22 reconnect cycles
//     in 6s with its cursor frozen).
// Nothing in either 64-bit path crashes the daemon; that damage is client-side.
//
// Headers are parsed here by hand instead of trusting decodeFrames, so an
// encoder and decoder that agree on the same wrong layout cannot pass.

const assert = require("node:assert");
const path = require("node:path");

const stream = require(path.join(__dirname, "..", "src", "stream.js"));

const OPCODE_TEXT = 0x1;

function freshState() {
	return { buf: Buffer.alloc(0), frag: Buffer.alloc(0) };
}

/**
 * Parse a server text frame header by hand, per RFC 6455 5.2.
 * @param {Buffer} buf
 * @returns {{opcode: number, fin: boolean, masked: boolean, len: number, headerLength: number}}
 */
function readHeader(buf) {
	const fin = (buf[0] & 0x80) !== 0;
	const opcode = buf[0] & 0x0f;
	const masked = (buf[1] & 0x80) !== 0;
	let marker = buf[1] & 0x7f;
	let headerLength = 2;
	let len = marker;
	if (marker === 126) {
		headerLength = 4;
		len = buf.readUInt16BE(2);
	} else if (marker === 127) {
		headerLength = 10;
		len = Number(buf.readBigUInt64BE(2));
	}
	return { opcode, fin, masked, len, headerLength };
}

/**
 * Decode every complete frame in one buffer into its text payloads.
 * @param {Buffer} buf
 * @returns {string[]}
 */
function decodeAll(buf) {
	const out = [];
	for (const msg of stream.decodeFrames(freshState(), buf)) {
		assert.ok(msg.text !== undefined, "decoded frame is text, not close/pong");
		out.push(msg.text);
	}
	return out;
}

/**
 * Parse a frame payload as JSON, failing the check with context on bad bytes.
 * @param {string} text
 * @param {string} label
 * @returns {unknown}
 */
function parseJSON(text, label) {
	try {
		return JSON.parse(text);
	} catch (err) {
		throw new Error(label + " is not valid JSON: " + err.message);
	}
}

/**
 * Header size RFC 6455 5.2 assigns to a payload of this byte length.
 * @param {number} bodyLen
 * @returns {number}
 */
function expectedHeaderLength(bodyLen) {
	if (bodyLen < 126) return 2;
	if (bodyLen < 65536) return 4;
	return 10;
}

/**
 * Encode bodyLen copies of `fill`, assert the canonical server frame shape and
 * that the module's own decoder reads the payload back.
 * @param {number} bodyLen
 * @returns {Buffer}
 */
function checkTextFrame(bodyLen) {
	const body = "a".repeat(bodyLen);
	const frame = stream.encodeText(body);
	const head = readHeader(frame);
	const expectedHeader = expectedHeaderLength(bodyLen);

	assert.strictEqual(
		frame.length,
		bodyLen + expectedHeader,
		`len ${bodyLen}: buffer is body + ${expectedHeader}-byte header`,
	);
	assert.strictEqual(frame.length, bodyLen + head.headerLength, "header length agrees");
	assert.strictEqual(frame[0], 0x81, `len ${bodyLen}: FIN + text opcode is 0x81`);
	assert.strictEqual(head.opcode, OPCODE_TEXT, "opcode is text");
	assert.strictEqual(head.fin, true, "frame is final");
	assert.strictEqual(head.masked, false, "server frames are unmasked");
	assert.strictEqual(head.len, bodyLen, "declared length equals body length");
	assert.strictEqual(frame.subarray(head.headerLength).toString("utf8"), body, "payload is intact");

	if (bodyLen < 126) {
		assert.strictEqual(frame[1], bodyLen, `len ${bodyLen}: 7-bit length in byte 1`);
		assert.deepStrictEqual([...frame.subarray(0, 2)], [0x81, bodyLen], "7-bit header bytes");
	} else if (bodyLen < 65536) {
		// The bug: this was Buffer.alloc(3) and threw at 126 bytes.
		assert.deepStrictEqual(
			[...frame.subarray(0, 4)],
			[0x81, 126, bodyLen >> 8, bodyLen & 0xff],
			`len ${bodyLen}: 4-byte header 0x81,126,big-endian length`,
		);
		// A client may see the header split across chunks.
		assert.deepStrictEqual(decodeAll(frame.subarray(0, 2)), [], "partial header waits");
		assert.deepStrictEqual(decodeAll(frame.subarray(0, 3)), [], "3 of 4 header bytes wait");
	} else {
		// The >= 64 KiB bug: this was Buffer.alloc(9) with the length written at
		// offset 1, so the marker byte became 0 and the frame read as 0-length.
		const lenBytes = [...frame.subarray(2, 10)];
		const expectedLenBytes = [];
		for (let shift = 56n; shift >= 0n; shift -= 8n) {
			expectedLenBytes.push(Number((BigInt(bodyLen) >> shift) & 0xffn));
		}
		assert.deepStrictEqual(
			[...frame.subarray(0, 2)],
			[0x81, 0x7f],
			`len ${bodyLen}: 64-bit header starts 0x81,0x7f (the marker was overwritten)`,
		);
		assert.deepStrictEqual(
			lenBytes,
			expectedLenBytes,
			`len ${bodyLen}: 8-byte big-endian length at offset 2`,
		);
		assert.strictEqual(
			Number(frame.readBigUInt64BE(2)),
			bodyLen,
			`len ${bodyLen}: 64-bit length field reads back`,
		);
		// The client sees exactly this on a 64 KiB body: a header split at 9 of
		// its 10 bytes must not be mistaken for a complete frame.
		assert.deepStrictEqual(decodeAll(frame.subarray(0, 9)), [], "9 of 10 header bytes wait");
		assert.deepStrictEqual(
			decodeAll(frame.subarray(0, 10)),
			[],
			"header with no payload waits",
		);
	}

	assert.deepStrictEqual(decodeAll(frame), [body], `len ${bodyLen}: decodeFrames round-trips`);
	return frame;
}

/**
 * Build a run.token event shaped like src/events.js append() output.
 * @param {number} tokenChars
 * @returns {string}
 */
function runTokenEventJSON(tokenChars) {
	return JSON.stringify({
		id: "12",
		seq: 12,
		type: "run.token",
		at: 1750000000000,
		runId: "run-7f3c1a9e-2b44-4d5e-9f10-0a1b2c3d4e5f",
		token: "x".repeat(tokenChars),
	});
}

function main() {
	const cases = [0, 125, 126, 131, 300, 65535, 65536, 70000];
	for (const len of cases) checkTextFrame(len);
	console.log(
		"PASS encodeText/decodeFrames round-trip len " + cases.join(", ") + " with exact header bytes",
	);

	// The exact regression: 126 bytes used to throw ERR_OUT_OF_RANGE.
	let frame126;
	assert.doesNotThrow(() => {
		frame126 = stream.encodeText("a".repeat(126));
	}, "len 126 does not throw ERR_OUT_OF_RANGE");
	assert.strictEqual(frame126.length, 130, "len 126 frame is 126 body + 4 header");
	assert.strictEqual(frame126[3], 126, "len 126 low byte is 126");
	console.log("PASS len 126 no longer throws (ERR_OUT_OF_RANGE regression)");

	// Byte length, not character count, picks the path: 63 'e-acute' = 126 bytes.
	const multibyte = "\u00e9".repeat(63);
	const multibyteFrame = stream.encodeText(multibyte);
	assert.strictEqual(Buffer.byteLength(multibyte, "utf8"), 126, "63 two-byte chars = 126 bytes");
	assert.strictEqual(multibyteFrame.length, 130, "multibyte body takes the 16-bit path");
	assert.deepStrictEqual(
		[...multibyteFrame.subarray(0, 4)],
		[0x81, 126, 0, 126],
		"multibyte header is 4 bytes",
	);
	assert.deepStrictEqual(decodeAll(multibyteFrame), [multibyte], "multibyte round-trips");
	console.log("PASS 126 UTF-8 bytes from multibyte text use the 16-bit path");

	// The reachable 64-bit victim: a scheduler job name is unbounded
	// (src/api.js:657-666) and runner.publish sends run.created with that title
	// (src/runner.js:244-258), so a 70 KiB title is one HTTP POST away. It used to
	// go out as 81 00 <7 length bytes> + body, which every client reads as a
	// zero-length text frame followed by 7 bytes of garbage header (the 9-byte
	// allocation minus the 2 bytes the decoder read as that frame's header).
	const hugeTitle = "j".repeat(70000);
	const hugeJSON = JSON.stringify({
		id: "21",
		seq: 21,
		type: "run.created",
		at: 1750000000000,
		runId: "run-4c2b7d61-9f8a-4e3d-8b1c-2f6a5d4e3c2b",
		title: hugeTitle,
	});
	const hugeBytes = Buffer.byteLength(hugeJSON, "utf8");
	assert.ok(hugeBytes > 65536, "run.created body is " + hugeBytes + " bytes, over 64 KiB");
	const hugeFrame = stream.encodeText(hugeJSON);
	assert.strictEqual(hugeFrame.length, hugeBytes + 10, "huge frame is body + 10-byte header");
	assert.deepStrictEqual(
		[...hugeFrame.subarray(0, 2)],
		[0x81, 0x7f],
		"huge frame header does not start 81 00 (the overwritten marker)",
	);
	assert.strictEqual(
		Number(hugeFrame.readBigUInt64BE(2)),
		hugeBytes,
		"huge frame 64-bit length is the body byte count",
	);
	const hugeDecoded = decodeAll(hugeFrame);
	assert.strictEqual(hugeDecoded.length, 1, "huge frame decodes to one message, not zero");
	assert.strictEqual(
		parseJSON(hugeDecoded[0], "decoded huge run.created").title.length,
		70000,
		"huge run.created title survives the wire intact",
	);
	console.log(
		"PASS 64 KiB+ run.created (" +
			hugeBytes +
			" bytes) sends 81 7f + 8-byte BE length and round-trips intact",
	);

	// Realistic broadcast payload: the run.token frame that killed the daemon.
	// A run.token event measured ~131 bytes on the wire; 11 token chars lands exactly there.
	for (const tokenChars of [11, 60, 200]) {
		const json = runTokenEventJSON(tokenChars);
		const bytes = Buffer.byteLength(json, "utf8");
		if (tokenChars === 11) {
			assert.strictEqual(bytes, 131, "the measured real-world run.token event is 131 bytes");
		}
		assert.ok(bytes >= 126 && bytes < 65536, "event JSON " + bytes + " takes the 16-bit path");
		const frame = stream.encodeText(json);
		const head = readHeader(frame);
		assert.strictEqual(frame[1], 126, "event frame uses the 16-bit marker");
		assert.strictEqual(head.len, bytes, "event frame length field is the byte length");
		assert.strictEqual(frame.length, bytes + 4, "event frame is body + 4");
		const decoded = decodeAll(frame);
		assert.strictEqual(decoded.length, 1, "event frame decodes to one message");
		assert.deepStrictEqual(
			parseJSON(decoded[0], "decoded event"),
			parseJSON(json, "source event"),
			"event JSON round-trips",
		);
	}

	const eventJSON = runTokenEventJSON(11);
	const eventBytes = Buffer.byteLength(eventJSON, "utf8");
	const replayed = decodeAll(stream.encodeText(eventJSON).subarray(0, eventBytes + 4));
	assert.strictEqual(
		parseJSON(replayed[0], "replayed event").type,
		"run.token",
		"replay client reads run.token",
	);
	console.log(
		"PASS realistic run.token JSON (" + eventBytes + " bytes) broadcasts and replays intact",
	);

	// Back-to-back frames in one chunk must not bleed into each other.
	const first = stream.encodeText(runTokenEventJSON(60));
	const second = stream.encodeText(runTokenEventJSON(180));
	const both = decodeAll(Buffer.concat([first, second]));
	assert.strictEqual(both.length, 2, "two 16-bit frames in one chunk decode separately");
	assert.strictEqual(
		parseJSON(both[0], "first frame").token.length,
		60,
		"first frame keeps its payload",
	);
	assert.strictEqual(
		parseJSON(both[1], "second frame").token.length,
		180,
		"second frame keeps its payload",
	);
	console.log("PASS two 16-bit frames in one socket chunk decode independently");

	console.log("ALL PASS");
}

main();
