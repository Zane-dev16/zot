// Per-variant layout hooks (M5). One flag, three consoles; css/variants.css
// carries the geometry and only the deltas CSS cannot express live here.
//
//   console  docked three-pane shell - the base markup, no hook
//   ledger   44px icon rail - needs the glyph + label span (ledger.js)
//   tty      top tab row, two equal panes - pure #app[data-variant] selectors
//
// Hooks are idempotent, so flipping #variantSwitch at runtime is safe and no
// variant ever renames or adds a screenshot selector (ADR-2).

import { mountLedgerRail } from "./ledger.js";

const HOOKS = {
	console: null,
	ledger: mountLedgerRail,
	tty: null,
};

/**
 * @param {Document} doc
 * @param {string} variant
 * @returns {void}
 */
export function applyVariantHook(doc, variant) {
	const hook = HOOKS[variant];
	if (typeof hook === "function") hook(doc);
}
