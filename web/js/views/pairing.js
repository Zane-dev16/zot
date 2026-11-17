// Pairing view: the whole self-pair machine (#pairStart → #pairCode →
// #pairConfirm) plus the manual device-token paste fallback the screenshot
// harness has always driven (#auth > #token + #saveToken).
//
// The machine is plan §5: idle|requesting|code|confirming|paired|expired|
// mismatch|no-pending|rate-limited|error, named on #pairStatus[data-kind] so the
// harness can assert the cause. The token is never rendered, logged, or put in a
// URL, query, or hash; only localStorage["zot.token"] holds it.

import { clock, relTime } from "../format.js";

const EMPTY_CODE = "------";

/**
 * One human sentence per machine state (exact copy from plan §5).
 * @param {string} status
 * @param {object} pairing
 * @param {{waitSecs: number, now: number, hasToken: boolean}} ctx
 * @returns {string}
 */
function copyFor(status, pairing, ctx) {
	switch (status) {
		case "requesting":
			return "asking the daemon for a code…";
		case "code":
			return "code " + pairing.code + " · expires in " + clock((Number(pairing.expiresAt) || 0) - ctx.now);
		case "confirming":
			return "confirming…";
		case "paired":
			return "paired · " + deviceKind(pairing.device) + " · token saved";
		case "expired":
			return "that code expired (5 minutes). Start again.";
		case "mismatch":
			return "another pairing replaced this code — the daemon only keeps one pending code. Start again.";
		case "no-pending":
			return "the daemon has no pending pairing (restarted, or someone already confirmed). Start again.";
		case "rate-limited":
			return "too many pairing attempts (5 per minute). Wait " + ctx.waitSecs + "s.";
		case "error":
			return pairing.error || "could not reach the daemon";
		default:
			return ctx.hasToken ? "a device token is saved — sign out to pair again" : "not paired — pair this browser or paste a token below";
	}
}

/**
 * @param {object|null|undefined} device
 * @returns {string}
 */
function deviceKind(device) {
	if (device && typeof device.kind === "string" && device.kind) return device.kind;
	if (device && typeof device.label === "string" && device.label) return device.label;
	return "browser";
}

/**
 * Start is offered whenever the machine is not mid-flight or already paired;
 * a rate-limited state also waits out the client's own countdown.
 * @param {string} status
 * @param {number} waitMs
 * @returns {boolean}
 */
function canStart(status, waitMs) {
	if (waitMs > 0) return false;
	return status === "idle" || status === "expired" || status === "mismatch" || status === "no-pending" || status === "rate-limited" || status === "error";
}

/**
 * @param {Document} doc
 * @param {{saveToken: (token: string) => void, signOut: () => void, pairStart: () => void, pairConfirm: () => void, pairRetry: () => void, route: (view: string) => void}} actions
 */
export function createPairingView(doc, actions) {
	const auth = doc.getElementById("auth");
	const token = doc.getElementById("token");
	const save = doc.getElementById("saveToken");
	const signOut = doc.getElementById("signOut");
	const fallback = doc.getElementById("pairFallback");
	const status = doc.getElementById("pairStatus");
	const tokenError = doc.getElementById("tokenError");
	const deviceSummary = doc.getElementById("deviceSummary");
	const pairStart = doc.getElementById("pairStart");
	const pairConfirm = doc.getElementById("pairConfirm");
	const pairCode = doc.getElementById("pairCode");
	const pairExpiry = doc.getElementById("pairExpiry");
	const pairDone = doc.getElementById("pairDone");
	const pairRetry = doc.getElementById("pairRetry");

	let lastAuthStatus = "";

	if (save) save.addEventListener("click", () => actions.saveToken(token ? token.value : ""));
	if (token) {
		token.addEventListener("keydown", (event) => {
			if (event.key === "Enter") {
				event.preventDefault();
				actions.saveToken(token.value);
			}
		});
	}
	if (signOut) signOut.addEventListener("click", () => actions.signOut());
	if (pairStart) pairStart.addEventListener("click", () => actions.pairStart());
	if (pairConfirm) pairConfirm.addEventListener("click", () => actions.pairConfirm());
	if (pairDone) pairDone.addEventListener("click", () => actions.route("chat"));
	if (pairRetry) pairRetry.addEventListener("click", () => actions.pairRetry());

	return {
		/**
		 * @param {object} state
		 * @param {number} now
		 */
		update(state, now = Date.now()) {
			const pairing = state.pairing;
			const authState = state.auth;
			const machine = pairing.status;
			const hasToken = authState.status === "hasToken" || authState.status === "verified";
			const rejected = authState.status === "rejected";
			const waitMs = machine === "rate-limited" ? Math.max(0, (Number(pairing.waitUntil) || 0) - now) : 0;
			const waitSecs = Math.ceil(waitMs / 1000);

			if (auth) auth.dataset.paired = hasToken ? "true" : "false";
			// The paste fallback starts open so the first screenshot still shows
			// the token field, and reopens whenever the token is cleared.
			if (authState.status !== lastAuthStatus) {
				lastAuthStatus = authState.status;
				if (fallback) fallback.open = !hasToken;
			}

			if (status) {
				status.dataset.kind = machine;
				status.textContent = copyFor(machine, pairing, { waitSecs, now, hasToken });
			}
			if (pairRetry) pairRetry.hidden = machine !== "error";

			if (pairCode) {
				if (machine === "code" && /^\d{6}$/.test(pairing.code)) {
					pairCode.dataset.kind = "code";
					pairCode.textContent = pairing.code;
					pairCode.setAttribute("aria-label", "pairing code " + pairing.code);
				} else {
					pairCode.dataset.kind = "empty";
					pairCode.textContent = EMPTY_CODE;
					pairCode.removeAttribute("aria-label");
				}
			}

			if (pairExpiry) {
				pairExpiry.textContent =
					machine === "code" && pairing.expiresAt ? "expires in " + clock(pairing.expiresAt - now) : "";
			}

			if (pairStart) pairStart.disabled = !canStart(machine, waitMs);
			if (pairConfirm) pairConfirm.disabled = machine !== "code";
			if (pairDone) pairDone.hidden = machine !== "paired";

			if (tokenError) tokenError.textContent = rejected ? authState.error || "the daemon rejected that token" : "";

			if (deviceSummary) {
				deviceSummary.textContent =
					machine === "paired"
						? "paired · " + deviceKind(pairing.device) + " · " + (relTime(pairing.device && pairing.device.createdAt, now) || "just now")
						: hasToken
							? "a device token is saved"
							: "";
			}
		},
	};
}
