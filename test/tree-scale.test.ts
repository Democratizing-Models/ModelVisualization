// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { buildIndex, type Model, type ModelNode } from '../src/model/index.js';
import { renderTree } from '../src/render/tree.js';

/** A model with `n` independent root nodes (nothing depends on anything). */
function flatModel(n: number): { model: Model; roots: ModelNode[] } {
  const nodes: ModelNode[] = Array.from({ length: n }, (_, i) => ({
    id: `n${i}`, blockName: `n${i}`, kind: 'unknown', type: 't', raw: {},
  }));
  const model: Model = { format: 'hs3', meta: {}, roots: [], diagnostics: [], nodes, edges: [] };
  return { model, roots: nodes };
}

describe('tree forest does not render unbounded roots synchronously', () => {
  it('caps rendered root rows and notes the overflow', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const { model, roots } = flatModel(500);
    renderTree(model, buildIndex(model), host, () => {}, roots);

    const items = host.querySelectorAll('[role="treeitem"]');
    expect(items.length).toBeLessThanOrEqual(200);
    expect(host.querySelector('.tree-note')?.textContent).toMatch(/more roots not shown/);
  });

  it('renders every root when under the cap (no note)', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const { model, roots } = flatModel(10);
    renderTree(model, buildIndex(model), host, () => {}, roots);

    expect(host.querySelectorAll('[role="treeitem"]').length).toBe(10);
    expect(host.querySelector('.tree-note')).toBeNull();
  });
});

describe('high-fan-out node caps rendered children', () => {
  it('renders at most CHILD_CAP (200) children for one node + a note', () => {
    const host = document.createElement('div');
    document.body.append(host);
    // root r depends on 250 children c0..c249
    const childIds = Array.from({ length: 250 }, (_, i) => `c${i}`);
    const nodes: ModelNode[] = [
      { id: 'r', blockName: 'r', kind: 'unknown', type: 't', raw: {} },
      ...childIds.map((id) => ({ id, blockName: id, kind: 'unknown' as const, type: 't', raw: {} })),
    ];
    const model: Model = {
      format: 'hs3', meta: {}, roots: [], diagnostics: [], nodes,
      edges: childIds.map((id) => ({ from: 'r', to: id, role: 'input' as const, port: id })),
    };
    renderTree(model, buildIndex(model), host, () => {}, [nodes[0]]);

    // r auto-expands (1 root); children capped at 200 → 1 (r) + 200 rendered
    const items = host.querySelectorAll('[role="treeitem"]');
    expect(items.length).toBe(201);
    expect(host.querySelector('.children .tree-note')?.textContent).toMatch(/\+50 more/);
  });
});

describe('keyboard nav respects collapse (visible-row cache invalidation)', () => {
  // a (root, depends on c) and b (root); c is a's child. roots = [a, b].
  const model: Model = {
    format: 'hs3', meta: {}, roots: [], diagnostics: [],
    nodes: ['a', 'b', 'c'].map((id) => ({ id, blockName: id, kind: 'unknown', type: 't', raw: {} })),
    edges: [{ from: 'a', to: 'c', role: 'input', port: 'x' }],
  };
  const roots = [model.nodes[0], model.nodes[1]]; // a, b

  it('ArrowDown after collapsing a node skips its now-hidden children', () => {
    const host = document.createElement('div');
    document.body.append(host);
    renderTree(model, buildIndex(model), host, () => {}, roots);

    const rowA = host.querySelector<HTMLElement>('.node-row[role="treeitem"]')!;
    expect(rowA.getAttribute('aria-expanded')).toBe('true'); // auto-expanded (c visible)
    rowA.focus();
    rowA.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(rowA.getAttribute('aria-expanded')).toBe('false');

    rowA.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    const active = document.activeElement as HTMLElement;
    expect(active).not.toBe(rowA);
    // the focused row must not sit inside a collapsed (hidden) subtree
    let inHidden = false;
    for (let p = active.parentElement; p && !p.classList.contains('tree'); p = p.parentElement) {
      if (p.classList.contains('children') && (p as HTMLElement).hidden) inHidden = true;
    }
    expect(inHidden).toBe(false);
  });
});
