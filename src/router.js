"use strict";

// Model router. Data shape is { id, provider, echo } per model.
// Route picks override when known else the default. Exec is a stub
// that logs the model id so tests can assert routing without network.
const MODELS = {
	echo: { id: "echo", provider: "local", echo: true },
	"echo-large": { id: "echo-large", provider: "local", echo: true },
};

const DEFAULT_MODEL = "echo";

function route(prompt, override) {
	if (typeof override === "string" && MODELS[override]) return MODELS[override];
	return MODELS[DEFAULT_MODEL];
}

function exec(model, prompt) {
	const m = typeof model === "string" ? MODELS[model] : model;
	const id = m && m.id ? m.id : DEFAULT_MODEL;
	return {
		model: id,
		text: "echo[" + id + "]: " + String(prompt).slice(0, 500),
	};
}

module.exports = { MODELS, DEFAULT_MODEL, route, exec };
