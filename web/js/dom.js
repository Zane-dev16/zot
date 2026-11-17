// Tiny DOM helpers. The renderer (render.js and the view modules) is the only
// place that writes DOM; everything here is a thin factory so no component
// needs innerHTML.

/**
 * Create an element.
 * @param {string} tag
 * @param {Record<string, unknown>} [props] text/class/dataset/on* or attributes
 * @param {...(Node|string|null|undefined|false)} children
 * @returns {HTMLElement}
 */
export function h(tag, props = {}, ...children) {
	const el = document.createElement(tag);
	for (const [key, value] of Object.entries(props || {})) {
		if (value == null || value === false) continue;
		if (key === "class") el.className = String(value);
		else if (key === "text") el.textContent = String(value);
		else if (key === "dataset") Object.assign(el.dataset, value);
		else if (key.startsWith("on") && typeof value === "function")
			el.addEventListener(key.slice(2).toLowerCase(), value);
		else if (key in el && key !== "role" && key !== "for")
			el[key] = value;
		else el.setAttribute(key, value === true ? "" : String(value));
	}
	append(el, children);
	return el;
}

/** Append children, flattening arrays and skipping empty values. */
export function append(parent, children) {
	for (const child of children) {
		if (child == null || child === false || child === "") continue;
		if (Array.isArray(child)) append(parent, child);
		else if (child instanceof Node) parent.appendChild(child);
		else parent.appendChild(document.createTextNode(String(child)));
	}
	return parent;
}

/** Remove every child of an element. */
export function clear(el) {
	while (el.firstChild) el.removeChild(el.firstChild);
	return el;
}

const KEYS = new WeakMap();

/**
 * Reconcile a keyed child list in place, preserving node identity (and focus)
 * for keys that survive. New nodes are inserted at their index; stale nodes are
 * removed.
 * @param {Element} container
 * @param {Array<object>} items
 * @param {(item: object) => string} keyOf
 * @param {(item: object) => Element} create
 * @param {(node: Element, item: object) => void} update
 */
export function keyed(container, items, keyOf, create, update) {
	const previous = new Map();
	for (const node of Array.from(container.children)) {
		const key = KEYS.get(node);
		if (key !== undefined) previous.set(key, node);
	}
	let index = 0;
	for (const item of items) {
		const key = String(keyOf(item));
		let node = previous.get(key);
		if (node) previous.delete(key);
		else {
			node = create(item);
			KEYS.set(node, key);
		}
		update(node, item);
		const want = container.children[index] || null;
		if (want !== node) container.insertBefore(node, want);
		index += 1;
	}
	for (const node of previous.values()) node.remove();
	while (container.children.length > index) container.lastElementChild.remove();
}

/**
 * Write a polite announcement into a live region, but only when it changes.
 * @param {Element|null} region
 * @param {string} message
 * @returns {string} the last announced message
 */
export function announce(region, message) {
	if (!region) return message;
	if (region.dataset.last === message) return message;
	region.dataset.last = message;
	region.textContent = message;
	return message;
}
