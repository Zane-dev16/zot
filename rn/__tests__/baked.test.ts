import {
	createBakedOnceGuard,
	readBakedPairConfig,
	setBakedPairSource,
} from "../src/api/baked";

afterEach(() => {
	setBakedPairSource(null);
});

describe("baked pair placeholder (ios/BakedPair.swift)", () => {
	test("is inert until a native source is registered (T5)", () => {
		expect(readBakedPairConfig()).toBe(null);
	});

	test("returns null when the app is not launched in baked mode", () => {
		setBakedPairSource({
			isBaked: false,
			config: () => ({ serverURL: "192.168.68.56:8787", code: "123456" }),
		});
		expect(readBakedPairConfig()).toBe(null);
	});

	test("normalizes the server URL and trims the code", () => {
		setBakedPairSource({
			isBaked: true,
			config: () => ({ serverURL: " 192.168.68.56:8787/ ", code: " 123456 " }),
		});
		expect(readBakedPairConfig()).toEqual({
			serverURL: "http://192.168.68.56:8787",
			code: "123456",
		});
	});

	test("rejects a config missing either field", () => {
		setBakedPairSource({
			isBaked: true,
			config: () => ({ serverURL: "", code: "123456" }),
		});
		expect(readBakedPairConfig()).toBe(null);

		setBakedPairSource({
			isBaked: true,
			config: () => ({ serverURL: "127.0.0.1:8787", code: "" }),
		});
		expect(readBakedPairConfig()).toBe(null);

		setBakedPairSource({ isBaked: true, config: () => null });
		expect(readBakedPairConfig()).toBe(null);
	});
});

describe("once guard (bakedDidRun, ios/ContentView.swift:10,71)", () => {
	test("runs at most once per guard", () => {
		const guard = createBakedOnceGuard();
		expect(guard.shouldRun()).toBe(true);
		expect(guard.shouldRun()).toBe(false);
		expect(guard.shouldRun()).toBe(false);
	});

	test("a fresh guard may run again (new app session)", () => {
		expect(createBakedOnceGuard().shouldRun()).toBe(true);
		expect(createBakedOnceGuard().shouldRun()).toBe(true);
	});
});
