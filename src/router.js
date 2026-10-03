"use strict";

// Model router. Data shape is id plus provider plus echo flag.
// Route picks override when known else the default.
// Exec stays sync echo so runner and eval work offline.
// ExecAsync tries live providers in fallback order with echo fallback.

const MODELS = {
	echo: { id: "echo", provider: "local", echo: true },
	"echo-large": { id: "echo-large", provider: "local", echo: true },
	"openai-mini": {
		id: "openai-mini",
		provider: "openai",
		echo: false,
		upstreamModel: "gpt-4o-mini",
	},
	"anthropic-mini": {
		id: "anthropic-mini",
		provider: "anthropic",
		echo: false,
		upstreamModel: "claude-3-5-haiku-latest",
	},
};

const DEFAULT_MODEL = "echo";

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_TIMEOUT_MS = 15000;

const PROVIDER_KEY_ENV = {
	openai: "OPENAI_API_KEY",
	anthropic: "ANTHROPIC_API_KEY",
};

function route(_prompt, override) {
	if (typeof override === "string" && MODELS[override]) return MODELS[override];
	return MODELS[DEFAULT_MODEL];
}

function resolveModel(model) {
	if (typeof model === "string" && MODELS[model]) return MODELS[model];
	if (model && typeof model.id === "string" && MODELS[model.id])
		return MODELS[model.id];
	return MODELS[DEFAULT_MODEL];
}

function logModel(id) {
	console.log("[router] model " + id);
}

function providerKeyEnv(provider) {
	return PROVIDER_KEY_ENV[provider] || "";
}

function providerApiKey(provider) {
	const name = providerKeyEnv(provider);
	if (!name) return "";
	return process.env[name] || "";
}

function liveModels() {
	return Object.values(MODELS).filter((m) => !m.echo);
}

function fallbackOrder(model) {
	const first = resolveModel(model).id;
	const rest = liveModels()
		.map((m) => m.id)
		.filter((id) => id !== first);
	return [first].concat(rest);
}

function isLiveConfigured(model) {
	if (model == null)
		return liveModels().some((m) => providerApiKey(m.provider));
	const m = resolveModel(model);
	if (m.echo) return false;
	return providerApiKey(m.provider) !== "";
}

function exec(model, prompt) {
	const m = resolveModel(model);
	logModel(m.id);
	return {
		model: m.id,
		text: "echo[" + m.id + "]: " + String(prompt).slice(0, 500),
	};
}

function liveTimeoutMs(opts) {
	const fromOpts = opts && Number(opts.timeoutMs);
	if (Number.isFinite(fromOpts) && fromOpts > 0) return fromOpts;
	const fromEnv = Number(process.env.ZOT_MODEL_TIMEOUT_MS);
	if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;
	return DEFAULT_TIMEOUT_MS;
}

async function postOpenAI(upstreamModel, prompt, apiKey, timeoutMs) {
	const ctrl = new AbortController();
	const timer = setTimeout(() => {
		ctrl.abort();
	}, timeoutMs);
	try {
		const res = await fetch(OPENAI_URL, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer " + apiKey,
			},
			body: JSON.stringify({
				model: upstreamModel,
				messages: [{ role: "user", content: String(prompt).slice(0, 4000) }],
			}),
			signal: ctrl.signal,
		});
		if (!res.ok) throw new Error("openai status " + res.status);
		const data = await res.json();
		const text =
			data && data.choices && data.choices[0] && data.choices[0].message
				? data.choices[0].message.content
				: "";
		if (typeof text !== "string" || text.length === 0)
			throw new Error("openai empty reply");
		return text;
	} finally {
		clearTimeout(timer);
	}
}

async function postAnthropic(upstreamModel, prompt, apiKey, timeoutMs) {
	const ctrl = new AbortController();
	const timer = setTimeout(() => {
		ctrl.abort();
	}, timeoutMs);
	try {
		const res = await fetch(ANTHROPIC_URL, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"x-api-key": apiKey,
				"anthropic-version": ANTHROPIC_VERSION,
			},
			body: JSON.stringify({
				model: upstreamModel,
				max_tokens: 512,
				messages: [{ role: "user", content: String(prompt).slice(0, 4000) }],
			}),
			signal: ctrl.signal,
		});
		if (!res.ok) throw new Error("anthropic status " + res.status);
		const data = await res.json();
		const block = data && Array.isArray(data.content) ? data.content[0] : null;
		const text = block && typeof block.text === "string" ? block.text : "";
		if (!text) throw new Error("anthropic empty reply");
		return text;
	} finally {
		clearTimeout(timer);
	}
}

function upstreamModelFor(m) {
	if (m.provider === "anthropic")
		return process.env.ZOT_ANTHROPIC_MODEL || m.upstreamModel;
	return process.env.ZOT_OPENAI_MODEL || m.upstreamModel || "gpt-4o-mini";
}

async function postProvider(m, prompt, apiKey, timeoutMs) {
	const upstream = upstreamModelFor(m);
	if (m.provider === "anthropic")
		return postAnthropic(upstream, prompt, apiKey, timeoutMs);
	return postOpenAI(upstream, prompt, apiKey, timeoutMs);
}

async function execAsync(model, prompt, opts) {
	const m = resolveModel(model);
	if (m.echo) return exec(m, prompt);
	const timeoutMs = liveTimeoutMs(opts);
	for (const id of fallbackOrder(m.id)) {
		const cand = MODELS[id];
		const key = providerApiKey(cand.provider);
		if (!key) continue;
		try {
			const text = await postProvider(cand, prompt, key, timeoutMs);
			logModel(cand.id);
			return { model: cand.id, text: text };
		} catch {}
	}
	return exec(m, prompt);
}

module.exports = {
	MODELS,
	DEFAULT_MODEL,
	route,
	exec,
	execAsync,
	isLiveConfigured,
	providerKeyEnv,
	providerApiKey,
	fallbackOrder,
};
