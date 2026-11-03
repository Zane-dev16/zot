import React from "react";
import { Text } from "react-native";
import ReactTestRenderer from "react-test-renderer";

import { createMemoryTokenStore } from "../src/api/client";
import type { StreamEvent, StreamHandle } from "../src/api/stream";
import { createMemoryCursorStore } from "../src/api/stream";
import { SessionProvider, useSessionState } from "../src/session/SessionProvider";
import { fakeRouterTransport, waitFor } from "../test-support/fakes";

const RUN = { id: "r1", title: "hello", prompt: "say hi", state: "queued" };

function daemon() {
	return fakeRouterTransport(call => {
		if (call.method === "GET" && call.url.includes("/api/v1/runs")) {
			return { status: 200, payload: { runs: [RUN] } };
		}
		return { status: 404, payload: { error: "not found" } };
	});
}

type Captured = {
	host: string;
	token: string;
	events: StreamEvent[];
	stopped: boolean;
	handle: StreamHandle;
	push(event: StreamEvent): void;
};

function fakeConnector() {
	const captured: Captured[] = [];
	const connectStreamFn = (
		host: string,
		token: string,
		options: { onEvent?: (event: StreamEvent) => void } = {},
	): StreamHandle => {
		const entry: Captured = {
			host,
			token,
			events: [],
			stopped: false,
			handle: {
				async start() {},
				stop() {
					entry.stopped = true;
				},
				status: (): "stopped" => "stopped",
				since: (): string | null => null,
			},
			push(event: StreamEvent): void {
				entry.events.push(event);
				options.onEvent?.(event);
			},
		};
		captured.push(entry);
		return entry.handle;
	};
	return { captured, connectStreamFn };
}

function StatusProbe(): React.ReactElement {
	const { state } = useSessionState();
	const run = state.runs[0];
	return (
		<Text testID="probe">
			{(state.token ?? "logged-out") +
				"|" +
				state.status +
				"|" +
				(run === undefined ? "no-run" : run.state)}
		</Text>
	);
}

function probeText(renderer: ReactTestRenderer.ReactTestRenderer): string {
	return String(renderer.root.findByProps({ testID: "probe" }).props.children);
}

type Mounted = { renderer: ReactTestRenderer.ReactTestRenderer };
let mounted: Mounted | null = null;

async function mount(deps: Parameters<typeof SessionProvider>[0]["deps"]) {
	let renderer: ReactTestRenderer.ReactTestRenderer | null = null;
	await ReactTestRenderer.act(async () => {
		renderer = ReactTestRenderer.create(
			<SessionProvider deps={deps}>
				<StatusProbe />
			</SessionProvider>,
		);
	});
	if (renderer === null) throw new Error("no renderer");
	const created: Mounted = { renderer };
	mounted = created;
	return created;
}

afterEach(async () => {
	const current = mounted;
	mounted = null;
	if (current === null) return;
	await ReactTestRenderer.act(async () => {
		current.renderer.unmount();
	});
});

describe("SessionProvider", () => {
	test("hydrates the token and opens the stream with it", async () => {
		const fake = daemon();
		const connector = fakeConnector();
		const { renderer } = await mount({
			tokenStore: createMemoryTokenStore("tok-1"),
			transport: fake.transport,
			connectStreamFn: connector.connectStreamFn,
			pollMs: 0,
		});

		expect(probeText(renderer)).toBe("tok-1|stopped|queued");
		expect(connector.captured).toHaveLength(1);
		expect(connector.captured[0].token).toBe("tok-1");
		expect(connector.captured[0].host).toBe("http://192.168.68.56:8787");

		await ReactTestRenderer.act(async () => {
			renderer.unmount();
		});
		mounted = null;
		expect(connector.captured[0].stopped).toBe(true);
	});

	test("folds stream events into the rendered run list", async () => {
		const fake = daemon();
		const connector = fakeConnector();
		const { renderer } = await mount({
			tokenStore: createMemoryTokenStore("tok-1"),
			transport: fake.transport,
			connectStreamFn: connector.connectStreamFn,
			pollMs: 0,
		});

		await ReactTestRenderer.act(async () => {
			connector.captured[0].push({
				id: "1",
				type: "run.done",
				runId: "r1",
				state: "done",
			});
		});
		expect(probeText(renderer)).toBe("tok-1|stopped|done");
	});

	test("does not connect without a token", async () => {
		const fake = daemon();
		const connector = fakeConnector();
		const { renderer } = await mount({
			tokenStore: createMemoryTokenStore(),
			transport: fake.transport,
			connectStreamFn: connector.connectStreamFn,
			pollMs: 0,
		});

		expect(probeText(renderer)).toBe("logged-out|stopped|no-run");
		expect(connector.captured).toHaveLength(0);
	});

	test("polls as a fallback while the stream is not live", async () => {
		const fake = daemon();
		const connector = fakeConnector();
		await mount({
			tokenStore: createMemoryTokenStore("tok-1"),
			transport: fake.transport,
			connectStreamFn: connector.connectStreamFn,
			cursorStore: createMemoryCursorStore(),
			pollMs: 25,
		});

		const initial = fake.calls.length;
		await ReactTestRenderer.act(async () => {
			await waitFor(() => fake.calls.length > initial);
		});
		expect(fake.calls.length).toBeGreaterThan(initial);
	});
});
