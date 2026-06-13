/** Tiny DOM construction helpers shared across render modules. */

type Child = Node | string | null | undefined | false;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, unknown> = {},
  children: Child[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = String(value);
    else if (key === 'dataset') Object.assign(node.dataset, value as Record<string, string>);
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    } else if (key in node) {
      (node as unknown as Record<string, unknown>)[key] = value;
    } else {
      node.setAttribute(key, String(value));
    }
  }
  for (const child of children) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(child));
  }
  return node;
}

export function clear(node: Element): void {
  node.replaceChildren();
}

const PALETTE = 8;

/** Stable colour for a node kind: hash the kind string into the theme-aware
 *  palette (--p0..--p7), so any format's kinds get distinct colours with no
 *  per-kind config. `unknown` is muted. Returns a CSS value (a `var(...)`). */
export function kindColor(kind: string): string {
  if (kind === 'unknown') return 'var(--fg-dim)';
  let h = 0;
  for (let i = 0; i < kind.length; i++) h = (h * 31 + kind.charCodeAt(i)) | 0;
  return `var(--p${((h % PALETTE) + PALETTE) % PALETTE})`;
}

/** A small colored chip labeling a node kind. */
export function kindBadge(kind: string): HTMLSpanElement {
  const badge = el('span', { class: 'kind-badge', dataset: { kind }, title: kind }, [kind]);
  badge.style.background = kindColor(kind);
  return badge;
}
