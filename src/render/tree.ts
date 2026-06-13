/**
 * Semantic, model-aware tree. Roots come from the model's entry-point hint (or
 * nodes nothing depends on); children are a node's dependency edges (input/call).
 * The shape logic (roots, children, xref targets) lives in pure functions in
 * model/graph.ts; this module only emits DOM from them. Children render lazily
 * on expand, data arrays are summarized, id-references are clickable cross-links.
 * Cycle-safe via an ancestor set.
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

export interface TreeController {
  /** Highlight the primary row for `id` (and scroll to it) if rendered. */
  focus(id: string): void;
}

export function renderTree(
  model: Model,
  index: ModelIndex,
  host: HTMLElement,
  onSelect: (node: ModelNode) => void,
): TreeController {
  clear(host);
  const primaryRow = new Map<string, HTMLElement>();
  let selected: HTMLElement | null = null;

  const select = (node: ModelNode, row: HTMLElement): void => {
    selected?.classList.remove('selected');
    row.classList.add('selected');
    selected = row;
    onSelect(node);
  };

  /** Build one node subtree. `ancestors` guards cycles; `autoExpand` opens it. */
  const buildNode = (
    node: ModelNode,
    edge: ModelEdge | null,
    ancestors: Set<string>,
    autoExpand: boolean,
  ): HTMLElement => {
    const deps = dependencyEdges(index, node.id);
    const outs = outputEdges(index, node.id);
    const isCycle = ancestors.has(node.id);
    const expandable = !isCycle && (deps.length > 0 || outs.length > 0);

    const caret = el('button', {
      class: 'caret',
      type: 'button',
      'aria-label': expandable ? 'Toggle children' : 'Leaf node',
    }, [expandable ? '▸' : '·']);

    const label = el('span', { class: 'node-label' }, [
      edge && el('span', { class: 'port' }, [`${edge.port}: `]),
      el('span', { class: 'node-name' }, [node.blockName]),
      node.id !== node.blockName && el('span', { class: 'node-id' }, [` #${node.id}`]),
      el('span', { class: 'node-type' }, [` ${node.type}`]),
      node.synthetic && el('span', { class: 'tag-synth' }, [' synthetic']),
      isCycle && el('span', { class: 'tag-cycle' }, [' ↻ cycle']),
    ]);

    const row = el('div', { class: 'node-row', dataset: { kind: node.kind } }, [caret, kindBadge(node.kind), label]);
    row.addEventListener('click', (e) => {
      if (e.target === caret) return;
      select(node, row);
    });
    if (!primaryRow.has(node.id)) primaryRow.set(node.id, row);

    const childWrap = el('div', { class: 'children', hidden: true });
    let built = false;
    const buildChildren = (): void => {
      if (built || !expandable) return;
      built = true;
      const next = new Set(ancestors).add(node.id);
      for (const dep of deps) {
        const target = index.byId.get(dep.to);
        if (target) childWrap.append(buildNode(target, dep, next, false));
      }
      for (const out of outs) childWrap.append(buildProduces(out));
    };
    const setOpen = (open: boolean): void => {
      if (open) buildChildren();
      childWrap.hidden = !open;
      caret.textContent = open ? '▾' : '▸';
    };
    caret.addEventListener('click', () => { if (expandable) setOpen(childWrap.hidden); });

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

  const focusAndSelect = (node: ModelNode): void => {
    const row = primaryRow.get(node.id);
    if (row) {
      row.scrollIntoView({ block: 'center', behavior: 'smooth' });
      row.classList.add('flash');
      setTimeout(() => row.classList.remove('flash'), 800);
      select(node, row);
    } else {
      onSelect(node); // not rendered (collapsed elsewhere) — at least inspect it
    }
  };

  // Build the forest, auto-expanding each root's first level directly (no
  // synthetic click events).
  const forest = el('div', { class: 'tree' });
  for (const root of computeRoots(model, index)) {
    forest.append(buildNode(root, null, new Set(), true));
  }
  host.append(forest);

  return { focus: (id) => { const n = index.byId.get(id); if (n) focusAndSelect(n); } };
}
