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

// Colour for a node kind: assign palette slots (--p0..--p7) in FIRST-SEEN order
// rather than hashing, so the distinct kinds within one model get distinct
// colours (a hash collides different kinds onto the same slot — the bug that
// made dense models like best-estimation look samey). Reset per model via
// resetKindColors() so assignment is fresh and deterministic for each render.
const kindSlot = new Map<string, number>();

/** Clear the kind→colour assignment; call once before rendering a new model. */
export function resetKindColors(): void {
  kindSlot.clear();
}

/** Theme-aware colour for a node kind. `unknown` is muted. Returns a CSS
 *  `var(...)`. Format-agnostic: any kind string gets a slot on first sight. */
export function kindColor(kind: string): string {
  if (kind === 'unknown') return 'var(--fg-dim)';
  let slot = kindSlot.get(kind);
  if (slot === undefined) {
    slot = kindSlot.size % PALETTE;
    kindSlot.set(kind, slot);
  }
  return `var(--p${slot})`;
}

/** A small colored chip labeling a node kind. */
export function kindBadge(kind: string): HTMLSpanElement {
  const badge = el('span', { class: 'kind-badge', dataset: { kind }, title: kind }, [kind]);
  badge.style.background = kindColor(kind);
  return badge;
}
