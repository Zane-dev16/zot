// Shared test fakes for the RN client. Kept outside __tests__ so jest does not
// treat it as a suite.

import type {
	HttpResponseLike,
	Transport,
	TransportInit,
} from "../src/api/client.ts";
import type { StreamEvent, SocketLike, SocketFactory } from "../src/api/stream.ts";

export type RecordedCall = {
	url: string;
	method: TransportInit["method"];
	headers: Record<string, string>;
	body?: string;
};

export type FakeResponse = {
	status: number;
	payload: unknown;
};

export function jsonResponse(status: number, payload: unknown): HttpResponseLike {
	return {
		status,
		async text() {
			return payload === null ? "" : JSON.stringify(payload);
		},
	};
}

export type FakeTransport = {
	calls: RecordedCall[];
	transport: Transport;
};

export type FakeRouter = (call: RecordedCall) => FakeResponse;

// Routes requests by method + path; anything unhandled answers 404 {error}.
export function fakeRouterTransport(router: FakeRouter): FakeTransport {
	const calls: RecordedCall[] = [];
	const transport: Transport = async (url, init) => {
		const call: RecordedCall = {
			url,
			method: init.method,
			headers: init.headers,
			body: init.body,
		};
		calls.push(call);
		const res = router(call);
		return jsonResponse(res.status, res.payload);
	};
	return { calls, transport };
}

export function pathOf(url: string): string {
	const index = url.indexOf("/", url.indexOf("://") + 3);
	return index === -1 ? url : url.slice(index);
}

export type FakeSocket = {
	url: string;
	socket: SocketLike;
	closed: boolean;
	open(): void;
	message(event: StreamEvent | string): void;
	fail(): void;
	serverClose(): void;
};

export type FakeSocketPool = {
	created: FakeSocket[];
	factory: SocketFactory;
	last(): FakeSocket;
};

// Every socket the stream opens, in order, with helpers to drive it.
export function makeSocketPool(): FakeSocketPool {
	const created: FakeSocket[] = [];
	const factory: SocketFactory = (url: string) => {
		const fake: FakeSocket = {
			url,
			socket: {
				onopen: null,
				onmessage: null,
				onerror: null,
				onclose: null,
				close() {
					fake.closed = true;
				},
			},
			closed: false,
			open() {
				fake.socket.onopen?.({});
			},
			message(event: StreamEvent | string) {
				const data =
					typeof event === "string" ? event : JSON.stringify(event);
				fake.socket.onmessage?.({ data });
			},
			fail() {
				fake.socket.onerror?.({});
			},
			serverClose() {
				fake.socket.onclose?.({});
			},
		};
		created.push(fake);
		return fake.socket;
	};
	return {
		created,
		factory,
		last() {
			const last = created[created.length - 1];
			if (last === undefined) throw new Error("no socket was created");
			return last;
		},
	};
}

export type Clock = {
	setTimeoutFn: (fn: () => void, ms: number) => number;
	clearTimeoutFn: (handle: number | null) => void;
	tick(ms: number): void;
	pending(): number;
};

// Deterministic timer stand-in for the stream's injected clock.
export function makeClock(): Clock {
	let nextId = 1;
	const timers = new Map<number, { at: number; fn: () => void }>();
	let now = 0;
	return {
		setTimeoutFn(fn, ms) {
			const id = nextId;
			nextId += 1;
			timers.set(id, { at: now + ms, fn });
			return id;
		},
		clearTimeoutFn(handle) {
			if (handle === null) return;
			timers.delete(handle);
		},
		tick(ms) {
			now += ms;
			const due = [...timers.entries()]
				.filter(([, timer]) => timer.at <= now)
				.sort((a, b) => a[1].at - b[1].at);
			for (const [id, timer] of due) {
				timers.delete(id);
				timer.fn();
			}
		},
		pending() {
			return timers.size;
		},
	};
}

export async function waitFor(
	condition: () => boolean,
	timeoutMs = 2000,
): Promise<void> {
	const started = Date.now();
	for (;;) {
		if (condition()) return;
		if (Date.now() - started > timeoutMs) {
			throw new Error("timed out waiting for condition");
		}
		await new Promise<void>(resolve => {
			setTimeout(() => resolve(), 5);
		});
	}
}
