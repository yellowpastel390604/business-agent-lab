/** Tiny DOM helpers shared by the extension pages. */

export const $ = id => document.getElementById(id);

/**
 * Creates an element: el('a', { href, class: 'x', textContent: 'hi' }, child1, child2).
 * `class` sets className; every other prop is assigned as a property. Null children are skipped.
 */
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v; else node[k] = v;
  }
  for (const child of children) if (child != null) node.append(child);
  return node;
}
