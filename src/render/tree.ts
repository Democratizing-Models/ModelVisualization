/**
 * Semantic, model-aware tree. Roots come from the model's entry-point hint (or
 * nodes nothing depends on); children are a node's dependency edges (input/call).
 * The shape logic (roots, children, xref targets) lives in pure functions in
 * model/graph.ts; this module only emits DOM from them. Children render lazily
 * on expand, data arrays are summarized, id-references are clickable cross-links.
 * Cycle-safe via an ancestor set.
 *
 * Accessibility: implements the WAI-ARIA Tree View pattern — role=tree/treeitem/
 * group, aria-expanded/-selected/-level, roving tabindex, and Arrow/Enter/Space/
 * Home/End keyboard navigation.
 */
import {
  computeRoots,
  dependencyEdges,
  outputEdges,
  type Model,
  type ModelNode,
  type ModelEdge,
  type ModelIndex,
} from '../model/index.js';
import { el, clear, kindBadge } from './dom.js';
import { summarizeValue } from './format.js';

/** Max children rendered per expand (high-fan-out guard; rest via search). */
const CHILD_CAP = 200;

export interface TreeController {
  /** Highlight the primary row for `id` (and scroll to it) if rendered. */
  focus(id: string): void;
}

export function renderTree(
  model: Model,
  index: ModelIndex,
  host: HTMLElement,
  onSelect: (node: ModelNode) => void,
  /** Precomputed roots (caller already has them); falls back to computeRoots. */
  roots: ModelNode[] = computeRoots(model, index),
): TreeController {
  clear(host);
  const primaryRow = new Map<string, HTMLElement>();
  let selected: HTMLElement | null = null;
  // The single row in the tab order (roving tabindex). All others are -1.
  let tabStop: HTMLElement | null = null;
  // Cached list of keyboard-navigable (visible) rows; rebuilt only when the set
  // of expanded nodes changes, not on every keystroke.
  let visibleCache: HTMLElement[] | null = null;
  const invalidateVisible = (): void => { visibleCache = null; };

  const setTabStop = (row: HTMLElement): void => {
    if (tabStop === row) return;
    tabStop?.setAttribute('tabindex', '-1');
    row.setAttribute('tabindex', '0');
    tabStop = row;
  };

  const select = (node: ModelNode, row: HTMLElement): void => {
    selected?.classList.remove('selected');
    selected?.setAttribute('aria-selected', 'false');
    row.classList.add('selected');
    row.setAttribute('aria-selected', 'true');
    selected = row;
    setTabStop(row);
    onSelect(node);
  };

  /** Build one node subtree. `ancestors` guards cycles; `autoExpand` opens it. */
  const buildNode = (
    node: ModelNode,
    edge: ModelEdge | null,
    ancestors: Set<string>,
    autoExpand: boolean,
    level: number,
  ): HTMLElement => {
    const deps = dependencyEdges(index, node.id);
    const outs = outputEdges(index, node.id);
    const isCycle = ancestors.has(node.id);
    const expandable = !isCycle && (deps.length > 0 || outs.length > 0);

    const caret = el('button', {
      class: 'caret',
      type: 'button',
      tabindex: '-1',          // row (treeitem) is the tab/keyboard target
      'aria-hidden': 'true',   // expand state is exposed via the row's aria-expanded
    }, [expandable ? '▸' : '·']);

    // Full plain-text label for the hover tooltip; the visible label truncates
    // with a CSS ellipsis (see .node-label) so long names don't overflow the pane.
    const labelText = `${edge ? `${edge.port}: ` : ''}${node.blockName}`
      + `${node.id !== node.blockName ? ` #${node.id}` : ''} ${node.type}`
      + `${node.synthetic ? ' synthetic' : ''}${isCycle ? ' ↻ cycle' : ''}`;
    const label = el('span', { class: 'node-label', title: labelText }, [
      edge && el('span', { class: 'port' }, [`${edge.port}: `]),
      el('span', { class: 'node-name' }, [node.blockName]),
      node.id !== node.blockName && el('span', { class: 'node-id' }, [` #${node.id}`]),
      el('span', { class: 'node-type' }, [` ${node.type}`]),
      node.synthetic && el('span', { class: 'tag-synth' }, [' synthetic']),
      isCycle && el('span', { class: 'tag-cycle' }, [' ↻ cycle']),
    ]);

    const row = el('div', {
      class: 'node-row', dataset: { kind: node.kind },
      role: 'treeitem', tabindex: '-1',
      'aria-level': String(level),
      'aria-selected': 'false',
    }, [caret, kindBadge(node.kind), label]);
    if (expandable) row.setAttribute('aria-expanded', 'false');
    row.addEventListener('click', (e) => {
      if (e.target === caret) return;
      select(node, row);
    });
    if (!primaryRow.has(node.id)) primaryRow.set(node.id, row);

    const childWrap = el('div', { class: 'children', role: 'group', hidden: true });
    let built = false;
    const buildChildren = (): void => {
      if (built || !expandable) return;
      built = true;
      const next = new Set(ancestors).add(node.id);
      const total = deps.length + outs.length;
      // Cap how many children render at once so a single high-fan-out node can't
      // build thousands of rows synchronously; the rest are reachable via search.
      let rendered = 0;
      for (const dep of deps) {
        if (rendered >= CHILD_CAP) break;
        const target = index.byId.get(dep.to);
        if (target) { childWrap.append(buildNode(target, dep, next, false, level + 1)); rendered++; }
      }
      for (const out of outs) {
        if (rendered >= CHILD_CAP) break;
        childWrap.append(buildProduces(out)); rendered++;
      }
      if (total > CHILD_CAP) {
        // aria-hidden: a non-treeitem note inside role=group would break the tree
        // structure; the hidden children aren't keyboard-reachable here anyway.
        childWrap.append(el('p', { class: 'tree-note', 'aria-hidden': 'true' },
          [`+${total - CHILD_CAP} more not shown — use search`]));
      }
    };
    const setOpen = (open: boolean): void => {
      if (open) buildChildren();
      childWrap.hidden = !open;
      caret.textContent = open ? '▾' : '▸';
      if (expandable) row.setAttribute('aria-expanded', String(open));
      invalidateVisible(); // visibility of descendants changed

    };
    caret.addEventListener('click', () => { if (expandable) setOpen(childWrap.hidden !== false); });
    // Expose open/close + expandable to the keyboard handler.
    rowOps.set(row, { node, expandable, isOpen: () => !childWrap.hidden, setOpen });

    const wrap = el('div', { class: 'node-wrap' }, [row]);
    if (node.values !== undefined) {
      wrap.append(el('div', { class: 'values' }, [summarizeValue(node.values)]));
    }
    wrap.append(childWrap);
    if (autoExpand && expandable) setOpen(true);
    return wrap;
  };

  /** A produced-output row: a clickable cross-link, not an expandable subtree. */
  const buildProduces = (edge: ModelEdge): HTMLElement => {
    const target = index.byId.get(edge.to);
    const link = el('button', { class: 'xref', type: 'button' }, [
      `⇒ ${edge.port}: ${target?.blockName ?? edge.to}`,
    ]);
    link.addEventListener('click', () => { if (target) focusAndSelect(target); });
    return el('div', { class: 'produces' }, [link]);
  };

  /** Expand any collapsed ancestors so a (built) row is actually visible. */
  const revealAncestors = (row: HTMLElement): void => {
    for (let p = row.parentElement; p && p !== forest; p = p.parentElement) {
      if (p.classList.contains('children') && (p as HTMLElement).hidden) {
        const owner = p.parentElement?.querySelector<HTMLElement>(':scope > .node-row');
        if (owner) rowOps.get(owner)?.setOpen(true);
      }
    }
  };

  const focusAndSelect = (node: ModelNode): void => {
    const row = primaryRow.get(node.id);
    if (row) {
      revealAncestors(row); // don't land "selected" on a row hidden in a collapsed subtree
      row.scrollIntoView({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
      row.classList.add('flash');
      setTimeout(() => row.classList.remove('flash'), 800);
      select(node, row);
    } else {
      onSelect(node); // not rendered (collapsed elsewhere) — at least inspect it
    }
  };

  // Per-row expand/collapse ops, keyed for the keyboard handler.
  const rowOps = new Map<HTMLElement, {
    node: ModelNode; expandable: boolean; isOpen: () => boolean; setOpen: (open: boolean) => void;
  }>();

  // Build the forest. Auto-expand each root's first level (no synthetic clicks)
  // — but only when there are few roots: a degenerate model where computeRoots
  // falls back to ALL nodes must not build thousands of rows + their children
  // synchronously. Cap the rendered root count and note any overflow.
  const ROOT_CAP = 200;
  const AUTO_EXPAND_MAX = 24;
  const autoExpand = roots.length <= AUTO_EXPAND_MAX;
  const forest = el('div', { class: 'tree', role: 'tree', 'aria-label': 'Model tree' });
  for (const root of roots.slice(0, ROOT_CAP)) {
    forest.append(buildNode(root, null, new Set(), autoExpand, 1));
  }
  host.append(forest);
  if (roots.length > ROOT_CAP) {
    host.append(el('p', { class: 'tree-note' }, [`+${roots.length - ROOT_CAP} more roots not shown`]));
  }

  // --- keyboard navigation (WAI-ARIA tree pattern) -----------------------
  /** Treeitems currently visible (no collapsed ancestor), in DOM order. Cached;
   *  invalidated on expand/collapse so a held arrow key doesn't re-walk the DOM. */
  const visibleRows = (): HTMLElement[] => {
    if (visibleCache) return visibleCache;
    visibleCache = [...forest.querySelectorAll<HTMLElement>('.node-row[role="treeitem"]')].filter((r) => {
      for (let p = r.parentElement; p && p !== forest; p = p.parentElement) {
        if (p.classList.contains('children') && (p as HTMLElement).hidden) return false;
      }
      return true;
    });
    return visibleCache;
  };

  const focusRow = (row: HTMLElement | undefined): void => {
    if (!row) return;
    setTabStop(row);
    row.focus();
  };
  const parentRow = (row: HTMLElement): HTMLElement | undefined => {
    for (let p = row.parentElement; p && p !== forest; p = p.parentElement) {
      if (p.classList.contains('children')) {
        return p.parentElement?.querySelector<HTMLElement>(':scope > .node-row') ?? undefined;
      }
    }
    return undefined;
  };

  forest.addEventListener('keydown', (ev) => {
    const row = (ev.target as HTMLElement)?.closest<HTMLElement>('.node-row[role="treeitem"]');
    if (!row) return;
    const ops = rowOps.get(row);
    const rows = visibleRows();
    const i = rows.indexOf(row);
    switch (ev.key) {
      case 'ArrowDown': ev.preventDefault(); focusRow(rows[i + 1]); break;
      case 'ArrowUp': ev.preventDefault(); focusRow(rows[i - 1]); break;
      case 'Home': ev.preventDefault(); focusRow(rows[0]); break;
      case 'End': ev.preventDefault(); focusRow(rows[rows.length - 1]); break;
      case 'ArrowRight':
        ev.preventDefault();
        if (ops?.expandable && !ops.isOpen()) ops.setOpen(true);
        else if (ops?.expandable) focusRow(rows[i + 1]);
        break;
      case 'ArrowLeft':
        ev.preventDefault();
        if (ops?.expandable && ops.isOpen()) ops.setOpen(false);
        else focusRow(parentRow(row));
        break;
      case 'Enter': case ' ':
        ev.preventDefault();
        if (ops) select(ops.node, row);
        break;
    }
  });

  // Seed the roving tab stop on the first row so the tree is keyboard-reachable.
  const first = forest.querySelector<HTMLElement>('.node-row[role="treeitem"]');
  if (first) setTabStop(first);

  return { focus: (id) => { const n = index.byId.get(id); if (n) focusAndSelect(n); } };
}

function prefersReducedMotion(): boolean {
  return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}
