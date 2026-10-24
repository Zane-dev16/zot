import {
	ApiError,
	createMemoryTokenStore,
	createRun,
	listRuns,
	normalizeBaseURL,
	pairConfirm,
} from "../src/api/client";
import type { Transport, TransportInit } from "../src/api/client";

type Call = {
	url: string;
	method: TransportInit["method"];
	headers: Record<string, string>;
	body?: string;
};

function fakeTransport(status: number, payload: unknown) {
	const calls: Call[] = [];
	const transport: Transport = async (url, init) => {
		calls.push({
			url,
			method: init.method,
			headers: init.headers,
			body: init.body,
		});
		return {
			status,
			text: async () => (payload === null ? "" : JSON.stringify(payload)),
		};
	};
	return { calls, transport };
}

async function rejection(promise: Promise<unknown>): Promise<ApiError> {
	try {
		await promise;
	} catch (err) {
		return err as ApiError;
	}
	throw new Error("expected the call to reject");
}

describe("normalizeBaseURL", () => {
	test("adds http:// to a bare host", () => {
		expect(normalizeBaseURL("192.168.68.56:8787")).toBe(
			"http://192.168.68.56:8787",
		);
	});

	test("keeps an explicit scheme", () => {
		expect(normalizeBaseURL("https://zot.example.ts.net")).toBe(
			"https://zot.example.ts.net",
		);
	});

	test("strips trailing slashes and surrounding whitespace", () => {
		expect(normalizeBaseURL("  127.0.0.1:8787// ")).toBe("http://127.0.0.1:8787");
		expect(normalizeBaseURL("http://10.0.0.2:8787/")).toBe("http://10.0.0.2:8787");
		expect(normalizeBaseURL("")).toBe("");
	});
});

describe("pairConfirm", () => {
	test("posts the documented body with no auth header (200)", async () => {
		const fake = fakeTransport(200, { token: "tok-200" });
		const token = await pairConfirm("192.168.68.56:8787", " 123456 ", {
			transport: fake.transport,
		});

		expect(token).toBe("tok-200");
		expect(fake.calls).toHaveLength(1);
		expect(fake.calls[0].url).toBe(
			"http://192.168.68.56:8787/api/v1/pair/confirm",
		);
		expect(fake.calls[0].method).toBe("POST");
		expect(fake.calls[0].headers).toEqual({
			"Content-Type": "application/json",
		});
		expect("Authorization" in fake.calls[0].headers).toBe(false);
		expect(fake.calls[0].body).toBe(
			'{"code":"123456","label":"iphone","kind":"ios"}',
		);
	});

	test("accepts 201 as well", async () => {
		const fake = fakeTransport(201, { token: "tok-201" });
		const token = await pairConfirm("127.0.0.1:8787", "654321", {
			transport: fake.transport,
		});
		expect(token).toBe("tok-201");
	});

	test("surfaces an {error} body verbatim", async () => {
		const fake = fakeTransport(400, { error: "bad or expired code" });
		const err = await rejection(
			pairConfirm("127.0.0.1:8787", "000000", { transport: fake.transport }),
		);
		expect(err).toBeInstanceOf(ApiError);
		expect(err.message).toBe("bad or expired code");
		expect(err.status).toBe(400);
	});
});

describe("memory token store", () => {
	test("round-trips a token and clears it on delete", async () => {
		const store = createMemoryTokenStore();
		expect(await store.loadToken()).toBe(null);

		await store.saveToken("tok-roundtrip");
		expect(await store.loadToken()).toBe("tok-roundtrip");

		await store.deleteToken();
		expect(await store.loadToken()).toBe(null);
	});

	test("hydrates from an existing token", async () => {
		const store = createMemoryTokenStore("tok-stored");
		expect(await store.loadToken()).toBe("tok-stored");
	});
});

describe("listRuns", () => {
	test("sends the Bearer header and returns the parsed array", async () => {
		const fake = fakeTransport(200, {
			runs: [{ id: "r1", title: "hello", prompt: "say hi", state: "done" }],
		});
		const runs = await listRuns("http://10.0.0.2:8787/", "tok-list", {
			transport: fake.transport,
		});

		expect(runs).toEqual([
			{ id: "r1", title: "hello", prompt: "say hi", state: "done" },
		]);
		expect(fake.calls).toHaveLength(1);
		expect(fake.calls[0].url).toBe("http://10.0.0.2:8787/api/v1/runs");
		expect(fake.calls[0].method).toBe("GET");
		expect(fake.calls[0].headers.Authorization).toBe("Bearer tok-list");
		expect(fake.calls[0].body).toBeUndefined();
	});

	test("returns an empty array for a fresh daemon", async () => {
		const fake = fakeTransport(200, { runs: [] });
		expect(
			await listRuns("127.0.0.1:8787", "tok-list", {
				transport: fake.transport,
			}),
		).toEqual([]);
	});
});

describe("createRun", () => {
	test("posts {title, prompt} with the Bearer header", async () => {
		const fake = fakeTransport(201, {
			run: { id: "r2", title: "deploy", prompt: "run the tests", state: "running" },
		});
		const run = await createRun(
			"127.0.0.1:8787",
			"tok-create",
			{ title: "deploy", prompt: "run the tests" },
			{ transport: fake.transport },
		);

		expect(run).toEqual({
			id: "r2",
			title: "deploy",
			prompt: "run the tests",
			state: "running",
		});
		expect(fake.calls[0].url).toBe("http://127.0.0.1:8787/api/v1/runs");
		expect(fake.calls[0].method).toBe("POST");
		expect(fake.calls[0].headers.Authorization).toBe("Bearer tok-create");
		expect(fake.calls[0].body).toBe(
			'{"title":"deploy","prompt":"run the tests"}',
		);
	});
});
