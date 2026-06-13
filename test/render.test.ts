// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { fromHs3Json } from '../src/adapters/hs3.js';
import { buildIndex, type ModelNode } from '../src/model/index.js';
import { renderTree } from '../src/render/tree.js';
import { renderInspector } from '../src/render/inspector.js';
import { initTheme } from '../src/render/theme.js';
import { fixture } from './helpers.js';

const model = fromHs3Json(fixture('hs3_gaussian.json'));
const index = buildIndex(model);

describe('renderTree', () => {
  let host: HTMLElement;
  beforeEach(() => {
    host = document.createElement('div');
    document.body.append(host);
  });

  it('renders a forest of node rows with kind badges', () => {
    renderTree(model, index, host, () => {});
    expect(host.querySelector('.tree')).toBeTruthy();
    expect(host.querySelectorAll('.kind-badge').length).toBeGreaterThan(0);
    expect(host.textContent).toContain('analysis');
  });

  it('invokes onSelect with the node when a row is clicked', () => {
    let picked: ModelNode | null = null;
    renderTree(model, index, host, (n) => { picked = n; });
    host.querySelector<HTMLElement>('.node-row')!.click();
    expect(picked).not.toBeNull();
    expect((picked as unknown as ModelNode).id).toBeTypeOf('string');
  });

  it('expands lazily when a caret is clicked', () => {
    renderTree(model, index, host, () => {});
    const collapsed = host.querySelectorAll('.children:not([hidden])').length;
    const caret = [...host.querySelectorAll<HTMLButtonElement>('.caret')].find((c) => c.textContent === '▸');
    caret?.click();
    expect(host.querySelectorAll('.children:not([hidden])').length).toBeGreaterThan(collapsed);
  });
});

describe('renderInspector', () => {
  it('shows fields, edges and raw source for a node', () => {
    const host = document.createElement('div');
    const node = model.nodes.find((n) => n.id === 'likelihood')!;
    renderInspector(model, index, node, host, () => {});
    expect(host.querySelector('h2')?.textContent).toBe('likelihood');
    expect(host.textContent).toContain('Depends on');
    expect(host.querySelector('.insp-raw pre')).toBeTruthy();
  });

  it('navigates via an edge cross-link', () => {
    const host = document.createElement('div');
    const node = model.nodes.find((n) => n.id === 'likelihood')!;
    let navigated: string | null = null;
    renderInspector(model, index, node, host, (id) => { navigated = id; });
    host.querySelector<HTMLButtonElement>('.insp-edges .xref')!.click();
    expect(navigated).not.toBeNull();
  });

  it('keeps the Raw source section expanded across node selections', () => {
    const host = document.createElement('div');
    const raw = (): HTMLDetailsElement => host.querySelector<HTMLDetailsElement>('.insp-raw')!;
    const show = (id: string): void =>
      renderInspector(model, index, model.nodes.find((n) => n.id === id)!, host, () => {});

    show('likelihood');
    expect(raw().open).toBe(false);
    raw().open = true;
    raw().dispatchEvent(new Event('toggle')); // user expands it

    show('model'); // select a different node — inspector rebuilds
    expect(raw().open).toBe(true);

    // reset module state so it doesn't leak into other tests
    raw().open = false;
    raw().dispatchEvent(new Event('toggle'));
  });
});

describe('initTheme', () => {
  it('applies a theme and toggles on click', () => {
    const btn = document.createElement('button');
    initTheme(btn as HTMLButtonElement);
    const first = document.documentElement.dataset.theme;
    expect(first === 'light' || first === 'dark').toBe(true);
    btn.click();
    expect(document.documentElement.dataset.theme).not.toBe(first);
  });
});
