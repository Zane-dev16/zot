// Ledger variant hook. The 44px icon rail needs two things CSS cannot do on
// its own: a glyph per view, and a label wrapper that can be visually clipped
// (not display:none) so the link keeps its accessible name while the rail is
// collapsed. Everything else about the ledger - rail geometry, table rows,
// slide-over inspector - is css/variants.css keyed off #app[data-variant].

const GLYPHS = {
	chat: "▤",
	approvals: "⚠",
	activity: "≡",
	pairing: "⚙",
};

/**
 * Add the rail glyph + label span to every sidebar link. Idempotent: a second
 * call (variant switched back and forth) finds the spans and does nothing.
 * @param {Document} doc
 */
export function mountLedgerRail(doc) {
	const nav = doc.getElementById("sidebar");
	if (!nav || nav.dataset.rail === "ledger") return;
	for (const link of nav.querySelectorAll("a[data-view]")) {
		if (link.querySelector(".railLabel")) continue;
		const label = doc.createElement("span");
		label.className = "railLabel";
		// The visible text is the anchor's leading text node; the trailing
		// badge spans (#approvalsCount, #runsCount) stay where they are.
		while (link.firstChild && link.firstChild.nodeType === 3) {
			label.appendChild(link.firstChild);
		}
		label.textContent = label.textContent.trim();
		const icon = doc.createElement("span");
		icon.className = "railIcon";
		icon.setAttribute("aria-hidden", "true");
		icon.textContent = GLYPHS[link.getAttribute("data-view") || ""] || "·";
		link.insertBefore(icon, link.firstChild);
		link.insertBefore(label, icon.nextSibling);
	}
	nav.dataset.rail = "ledger";
}
