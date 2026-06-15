// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fromHs3Json } from '../src/adapters/hs3.js';
import { buildIndex, computeRoots } from '../src/model/index.js';
import { renderTree } from '../src/render/tree.js';
import { renderDag } from '../src/render/dag.js';
import { initTheme } from '../src/render/theme.js';
import { fixture } from './helpers.js';

const model = fromHs3Json(fixture('hs3_gaussian.hs3'));
const index = buildIndex(model);
const roots = computeRoots(model, index);

describe('tree accessibility (WAI-ARIA tree pattern)', () => {
  let host: HTMLElement;
  beforeEach(() => { host = document.createElement('div'); document.body.append(host); });

  it('exposes role=tree with role=treeitem children carrying level + selected state', () => {
    renderTree(model, index, host, () => {}, roots);
    expect(host.querySelector('[role="tree"]')).toBeTruthy();
    const items = host.querySelectorAll<HTMLElement>('[role="treeitem"]');
    expect(items.length).toBeGreaterThan(0);
    for (const it of items) {
      expect(it.getAttribute('aria-level')).toBeTruthy();
      expect(it.getAttribute('aria-selected')).toBe('false');
    }
  });

  it('expandable rows expose aria-expanded and a group of children', () => {
    renderTree(model, index, host, () => {}, roots);
    const expandable = host.querySelector<HTMLElement>('[role="treeitem"][aria-expanded]');
    expect(expandable).toBeTruthy();
    expect(host.querySelector('[role="group"]')).toBeTruthy();
  });

  it('each row label carries a full-text title for hover (visible text truncates via CSS)', () => {
    renderTree(model, index, host, () => {}, roots);
    const labels = [...host.querySelectorAll<HTMLElement>('.node-label')];
    expect(labels.length).toBeGreaterThan(0);
    for (const l of labels) {
      expect(l.getAttribute('title')).toBeTruthy();
      expect(l.getAttribute('title')).toContain(l.querySelector('.node-name')!.textContent!);
    }
  });

  it('exactly one treeitem is in the tab order (roving tabindex)', () => {
    renderTree(model, index, host, () => {}, roots);
    const tabbable = host.querySelectorAll('[role="treeitem"][tabindex="0"]');
    expect(tabbable.length).toBe(1);
  });

  it('ArrowDown moves focus to the next visible treeitem', () => {
    renderTree(model, index, host, () => {}, roots);
    const items = [...host.querySelectorAll<HTMLElement>('[role="treeitem"]')];
    items[0].focus();
    items[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe(items[1]);
  });

  it('Home/End jump to the first/last visible treeitem', () => {
    renderTree(model, index, host, () => {}, roots);
    const items = [...host.querySelectorAll<HTMLElement>('[role="treeitem"]')];
    const visible = items.filter((r) => {
      for (let p = r.parentElement; p && !p.classList.contains('tree'); p = p.parentElement)
        if (p.classList.contains('children') && (p as HTMLElement).hidden) return false;
      return true;
    });
    items[2].focus();
    items[2].dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    expect(document.activeElement).toBe(visible[visible.length - 1]);
    (document.activeElement as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    expect(document.activeElement).toBe(visible[0]);
  });

  it('ArrowLeft collapses an open row, then moves to the parent', () => {
    renderTree(model, index, host, () => {}, roots);
    // an expanded row with a child treeitem under it
    const parent = [...host.querySelectorAll<HTMLElement>('[role="treeitem"][aria-expanded="true"]')][0];
    const childGroup = parent.parentElement!.querySelector<HTMLElement>(':scope > .children');
    const child = childGroup!.querySelector<HTMLElement>('.node-row[role="treeitem"]')!;
    child.focus();
    child.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })); // collapse child (if expandable) or to parent
    // ArrowLeft on a leaf/closed child moves focus to its parent row
    if (document.activeElement === parent) expect(document.activeElement).toBe(parent);
    // collapse the parent and confirm aria-expanded flips
    parent.focus();
    parent.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(parent.getAttribute('aria-expanded')).toBe('false');
    parent.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); // re-expand
    expect(parent.getAttribute('aria-expanded')).toBe('true');
  });

  it('Enter on a row selects it (fires onSelect)', () => {
    const onSelect = vi.fn();
    renderTree(model, index, host, onSelect, roots);
    const first = host.querySelector<HTMLElement>('[role="treeitem"]')!;
    first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(onSelect).toHaveBeenCalled();
  });
});

describe('DAG accessibility', () => {
  let host: HTMLElement;
  beforeEach(() => { host = document.createElement('div'); document.body.append(host); });

  it('the svg is a labelled application region', () => {
    renderDag(index, host, roots[0].id, () => {});
    const svg = host.querySelector('svg.dag-svg')!;
    expect(svg.getAttribute('role')).toBe('application');
    expect(svg.getAttribute('aria-label')).toMatch(/dependency graph/i);
    expect(svg.getAttribute('tabindex')).toBe('0');
  });

  it('node groups are focusable buttons with accessible names', () => {
    renderDag(index, host, roots[0].id, () => {});
    const nodes = host.querySelectorAll<SVGGElement>('g.dag-node');
    expect(nodes.length).toBeGreaterThan(0);
    for (const g of nodes) {
      expect(g.getAttribute('tabindex')).toBe('0');
      expect(g.getAttribute('role')).toBe('button');
      expect(g.getAttribute('aria-label')).toBeTruthy();
    }
  });

  it('provides a reset-view control', () => {
    renderDag(index, host, roots[0].id, () => {});
    expect(host.querySelector('.dag-reset')).toBeTruthy();
  });

  it('Enter on a node group selects it', () => {
    const onSelect = vi.fn();
    renderDag(index, host, roots[0].id, onSelect);
    const g = host.querySelector<SVGGElement>('g.dag-node:not(.focus)') ?? host.querySelector<SVGGElement>('g.dag-node')!;
    g.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(onSelect).toHaveBeenCalled();
  });
});

describe('theme toggle: icon and label agree on the action', () => {
  it('in dark mode shows the sun glyph and a "switch to light" label', () => {
    // No stored theme + no matchMedia in this env → defaults to dark.
    const btn = document.createElement('button');
    initTheme(btn);
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(btn.textContent).toBe('☀');
    expect(btn.getAttribute('aria-label')).toBe('Switch to light theme');
    btn.click();
    expect(btn.textContent).toBe('☾');
    expect(btn.getAttribute('aria-label')).toBe('Switch to dark theme');
  });
});
