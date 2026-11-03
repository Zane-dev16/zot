import React from "react";
import ReactTestRenderer from "react-test-renderer";

import type { AgentRun } from "../src/api/client";
import { PairScreen } from "../src/screens/PairScreen";
import type { RunsScreenProps } from "../src/screens/RunsScreen";
import { RunsScreen, statusLabel } from "../src/screens/RunsScreen";

type Renderer = ReactTestRenderer.ReactTestRenderer;

async function render(element: React.ReactElement): Promise<Renderer> {
	let renderer: Renderer | null = null;
	await ReactTestRenderer.act(() => {
		renderer = ReactTestRenderer.create(element);
	});
	if (renderer === null) throw new Error("renderer was not created");
	return renderer;
}

function texts(renderer: Renderer): string[] {
	return renderer.root
		.findAllByType("Text" as unknown as React.ElementType)
		.map(node => String(node.props.children));
}

function text(renderer: Renderer, testID: string): string {
	const node = renderer.root.findByProps({ testID });
	return String(node.props.children);
}

const RUNS: AgentRun[] = [
	{ id: "r1", title: "hello", prompt: "say hi", state: "done" },
	{ id: "r2", title: "deploy", prompt: "ship it", state: "waiting_tool" },
];

function runsProps(overrides: Partial<RunsScreenProps> = {}): RunsScreenProps {
	return {
		runs: RUNS,
		error: "",
		status: "live",
		title: "",
		prompt: "",
		busy: false,
		onChangeTitle: jest.fn(),
		onChangePrompt: jest.fn(),
		onSend: jest.fn(),
		onRefresh: jest.fn(),
		onUnpair: jest.fn(),
		...overrides,
	};
}

describe("PairScreen (ios/ContentView.swift:20-36)", () => {
	const base = {
		host: "http://192.168.68.56:8787",
		code: "",
		error: "",
		busy: false,
		onChangeHost: jest.fn(),
		onChangeCode: jest.fn(),
		onPair: jest.fn(),
	};

	test("shows the server field, the numeric code field and the footnote", async () => {
		const renderer = await render(<PairScreen {...base} />);
		const host = renderer.root.findByProps({ testID: "pair-host" });
		const code = renderer.root.findByProps({ testID: "pair-code" });

		expect(host.props.value).toBe("http://192.168.68.56:8787");
		expect(code.props.keyboardType).toBe("number-pad");
		expect(code.props.maxLength).toBe(6);
		expect(
			texts(renderer).some(value =>
				value.includes("Ask the browser UI for the code."),
			),
		).toBe(true);
	});

	test("forwards typing and the Pair press", async () => {
		const onChangeHost = jest.fn();
		const onChangeCode = jest.fn();
		const onPair = jest.fn();
		const renderer = await render(
			<PairScreen
				{...base}
				onChangeHost={onChangeHost}
				onChangeCode={onChangeCode}
				onPair={onPair}
			/>,
		);

		await ReactTestRenderer.act(() => {
			renderer.root.findByProps({ testID: "pair-host" }).props.onChangeText(
				"127.0.0.1:8787",
			);
			renderer.root.findByProps({ testID: "pair-code" }).props.onChangeText(
				"123456",
			);
			renderer.root.findByProps({ testID: "pair-submit" }).props.onPress();
		});

		expect(onChangeHost).toHaveBeenCalledWith("127.0.0.1:8787");
		expect(onChangeCode).toHaveBeenCalledWith("123456");
		expect(onPair).toHaveBeenCalledTimes(1);
	});

	test("renders exactly one error line when pairing fails", async () => {
		const renderer = await render(
			<PairScreen {...base} error="bad or expired code" />,
		);
		expect(text(renderer, "pair-error")).toBe("bad or expired code");
	});

	test("renders no error line when there is no error", async () => {
		const renderer = await render(<PairScreen {...base} />);
		expect(renderer.root.findAllByProps({ testID: "pair-error" })).toHaveLength(
			0,
		);
	});
});

describe("RunsScreen (ios/ContentView.swift:38-66)", () => {
	test("lists every run with its title and state", async () => {
		const renderer = await render(<RunsScreen {...runsProps()} />);
		const rendered = texts(renderer);

		expect(rendered).toContain("hello");
		expect(rendered).toContain("done");
		expect(rendered).toContain("deploy");
		expect(rendered).toContain("waiting_tool");
		expect(renderer.root.findAllByProps({ testID: "runs-empty" })).toHaveLength(
			0,
		);
	});

	test("shows the empty state for a fresh daemon", async () => {
		const renderer = await render(<RunsScreen {...runsProps({ runs: [] })} />);
		expect(text(renderer, "runs-empty")).toBe("No runs yet.");
	});

	test("shows the stream status", async () => {
		const renderer = await render(
			<RunsScreen {...runsProps({ status: "reconnecting" })} />,
		);
		expect(text(renderer, "runs-status")).toBe("reconnecting");
		expect(statusLabel("live")).toBe("live");
		expect(statusLabel("auth")).toBe("auth failed");
		expect(statusLabel("connecting")).toBe("connecting");
		expect(statusLabel("stopped")).toBe("idle");
	});

	test("composer forwards title and prompt edits", async () => {
		const onChangeTitle = jest.fn();
		const onChangePrompt = jest.fn();
		const renderer = await render(
			<RunsScreen
				{...runsProps({ onChangeTitle, onChangePrompt })}
			/>,
		);

		await ReactTestRenderer.act(() => {
			renderer.root
				.findByProps({ testID: "composer-title" })
				.props.onChangeText("deploy");
			renderer.root
				.findByProps({ testID: "composer-prompt" })
				.props.onChangeText("run the tests");
		});

		expect(onChangeTitle).toHaveBeenCalledWith("deploy");
		expect(onChangePrompt).toHaveBeenCalledWith("run the tests");
	});

	test("Send, Refresh and Unpair press through", async () => {
		const onSend = jest.fn();
		const onRefresh = jest.fn();
		const onUnpair = jest.fn();
		const renderer = await render(
			<RunsScreen {...runsProps({ onSend, onRefresh, onUnpair })} />,
		);

		await ReactTestRenderer.act(() => {
			renderer.root.findByProps({ testID: "composer-send" }).props.onPress();
			renderer.root.findByProps({ testID: "runs-refresh" }).props.onPress();
			renderer.root.findByProps({ testID: "runs-unpair" }).props.onPress();
		});

		expect(onSend).toHaveBeenCalledTimes(1);
		expect(onRefresh).toHaveBeenCalledTimes(1);
		expect(onUnpair).toHaveBeenCalledTimes(1);
	});

	test("renders the single error line under the composer", async () => {
		const renderer = await render(
			<RunsScreen {...runsProps({ error: "Fetch failed. Check LAN and token." })} />,
		);
		expect(text(renderer, "runs-error")).toBe(
			"Fetch failed. Check LAN and token.",
		);
	});
});
