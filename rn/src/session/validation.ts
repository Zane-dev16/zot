// Pure screen/session validation helpers. Ports ios/ContentView.swift:78-94
// (pair gate) and :115-125 (composer -> run title).

export const PAIR_CODE_LENGTH = 6;
export const PAIR_CODE_ERROR = "Code must be 6 digits.";
export const INVALID_HOST_ERROR = "Invalid host. Add http:// and check host.";
/** ios/ContentView.swift:120 sends String(prompt.prefix(40)) as the title. */
export const RUN_TITLE_MAX = 40;

const PAIR_CODE_PATTERN = /^[0-9]{6}$/;

export function normalizePairCode(raw: string): string {
	return raw.trim();
}

export function isValidPairCode(raw: string): boolean {
	return PAIR_CODE_PATTERN.test(normalizePairCode(raw));
}

export function deriveRunTitle(prompt: string): string {
	const text = prompt.trim();
	return text.length <= RUN_TITLE_MAX ? text : text.slice(0, RUN_TITLE_MAX);
}
