// Pairing view, first slice: the manual device-token card that the existing
// screenshot harness already drives (#auth > #token + #saveToken). The in-browser
// pairing machine (start → code → confirm) lands in its own milestone and reuses
// this same card; the token itself is never rendered, logged, or put in a URL.

/**
 * @param {Document} doc
 * @param {{saveToken: (token: string) => void, signOut: () => void}} actions
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

	if (save) {
		save.addEventListener("click", () => actions.saveToken(token ? token.value : ""));
	}
	if (token) {
		token.addEventListener("keydown", (event) => {
			if (event.key === "Enter") {
				event.preventDefault();
				actions.saveToken(token.value);
			}
		});
	}
	if (signOut) signOut.addEventListener("click", () => actions.signOut());
	if (pairStart) pairStart.disabled = true;
	if (pairConfirm) pairConfirm.disabled = true;
	if (pairCode) {
		pairCode.dataset.kind = "empty";
		pairCode.textContent = "------";
	}
	if (pairExpiry) pairExpiry.textContent = "";

	return {
		/**
		 * @param {object} state
		 */
		update(state) {
			const authState = state.auth;
			const neverPaired = authState.status === "none" || authState.status === "unknown";
			const rejected = authState.status === "rejected";
			const paired = authState.status === "hasToken" || authState.status === "verified";
			if (fallback) fallback.open = !paired;
			if (tokenError) {
				tokenError.textContent = rejected ? authState.error || "the daemon rejected that token" : "";
			}
			if (status) {
				if (rejected) {
					status.dataset.kind = "error";
					status.textContent = "the daemon rejected that token — paste a new one below";
				} else if (paired) {
					status.dataset.kind = "paired";
					status.textContent = "token saved";
				} else if (neverPaired) {
					status.dataset.kind = "idle";
					status.textContent = "not paired — paste a device token below";
				}
			}
			if (deviceSummary) {
				deviceSummary.textContent = paired ? "a device token is saved" : "";
			}
			if (auth) auth.dataset.paired = paired ? "true" : "false";
		},
	};
}
