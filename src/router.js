"use strict";

// Model router. Data shape is id plus provider plus echo flag.
// Route picks override when known else the default.
// Exec stays sync echo so runner and eval work offline.
// ExecAsync adds one live provider with timeout and echo fallback.

const MODELS = {
	echo: { id: "echo", provider: "local", echo: true },
	"echo-large": { id: "echo-large", provider: "local", echo: true },
	"openai-mini": {
		id: "openai-mini",
		provider: "openai",
		echo: false,
		upstreamModel: "gpt-4o-mini",
	},
};

const DEFAULT_MODEL = "echo";

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_TIMEOUT_MS = 15000;

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

function isLiveConfigured(model) {
	const key = process.env.OPENAI_API_KEY || "";
	if (!key) return false;
	if (model == null) return true;
	return !resolveModel(model).echo;
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

async function execAsync(model, prompt, opts) {
	const m = resolveModel(model);
	if (m.echo) return exec(m, prompt);
	const apiKey = process.env.OPENAI_API_KEY || "";
	if (!apiKey) return exec(m, prompt);
	logModel(m.id);
	const upstream =
		process.env.ZOT_OPENAI_MODEL || m.upstreamModel || "gpt-4o-mini";
	const text = await postOpenAI(upstream, prompt, apiKey, liveTimeoutMs(opts));
	return { model: m.id, text: text };
}

module.exports = {
	MODELS,
	DEFAULT_MODEL,
	route,
	exec,
	execAsync,
	isLiveConfigured,
};
