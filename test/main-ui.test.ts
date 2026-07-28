/**
 * App entry (`src/main.ts`), interaction: node search, keyboard shortcuts,
 * resizable panes, the responsive pane tabs, and the model/diagnostics dialog.
 *
 * Most cases drive a hand-built model rather than a bundled sample, so the graph
 * under test is exactly the one the case needs (three nodes, two of them sharing
 * a type, one diagnostic of each level).
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { mount, showModel, model, key, type MountedApp } from './app-harness.js';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const search = (app: MountedApp): HTMLInputElement => app.$<HTMLInputElement>('node-search');

/** Submit the search box the way a keyboard does. */
function submitSearch(app: MountedApp, query: string): void {
  const box = search(app);
  box.value = query;
  key(box, 'Enter');
}

describe('node search', () => {
  it('focuses the node whose id was typed', async () => {
    const app = await mount();
    await showModel(app);
    submitSearch(app, 'beta');
    expect(app.status()).toBe('Focused "beta"');
    expect(app.$('inspector-pane').textContent).toContain('beta');
  });

  /**
   * Regression: stepping through matches hung off `change`, which a browser does
   * not fire when the value has not been edited — so a second Enter did nothing
   * while the status bar promised it would step. Only the first match of a common
   * substring was ever reachable.
   */
  it('steps to the next match on each Enter, and wraps', async () => {
    const app = await mount();
    await showModel(app);
    submitSearch(app, 'a'); // matches alpha, beta, gamma
    expect(app.status()).toContain('match 1 of 3');
    expect(app.status()).toContain('press Enter again for the next');

    key(search(app), 'Enter');
    expect(app.status()).toContain('Focused "beta" — match 2 of 3');
    key(search(app), 'Enter');
    expect(app.status()).toContain('Focused "gamma" — match 3 of 3');
    key(search(app), 'Enter');
    expect(app.status()).toContain('Focused "alpha" — match 1 of 3');
  });

  it('re-selects rather than steps when the value is merely committed', async () => {
    const app = await mount();
    await showModel(app);
    submitSearch(app, 'a');
    expect(app.status()).toContain('match 1 of 3');
    // `change` fires on blur and on picking a suggestion, and also alongside the
    // Enter above — it must not double-step.
    search(app).dispatchEvent(new Event('change'));
    expect(app.status()).toContain('match 1 of 3');
  });

  it('matches on type, so a whole kind of node can be found at once', async () => {
    const app = await mount();
    await showModel(app);
    submitSearch(app, 'poisson');
    expect(app.status()).toBe('Focused "gamma"');
  });

  it('reports a query that matches nothing', async () => {
    const app = await mount();
    await showModel(app);
    submitSearch(app, 'zzz');
    expect(app.status()).toBe('Error: No node matching "zzz"');
    expect(app.level()).toBe('error');
  });

  it('ignores an empty query', async () => {
    const app = await mount();
    await showModel(app);
    const before = app.status();
    submitSearch(app, '   ');
    expect(app.status()).toBe(before);
  });

  it('surfaces the inspector, so a selection is visible on a narrow screen', async () => {
    const app = await mount();
    await showModel(app);
    app.layout.dataset.activePane = 'tree';
    submitSearch(app, 'beta');
    expect(app.layout.dataset.activePane).toBe('inspector');
  });

  it('starts a fresh match list for a new query', async () => {
    const app = await mount();
    await showModel(app);
    submitSearch(app, 'a');
    key(search(app), 'Enter'); // now on match 2
    submitSearch(app, 'poisson');
    expect(app.status()).toBe('Focused "gamma"');
  });

  it('resets the box and the match list when a new model is loaded', async () => {
    const app = await mount();
    await showModel(app);
    submitSearch(app, 'a');
    await showModel(app, model({ nodes: [], edges: [] }));
    expect(search(app).value).toBe('');
    expect(search(app).disabled).toBe(true); // nothing to search in
  });
});

describe('search suggestions', () => {
  it('offers every node of a small model', async () => {
    const app = await mount();
    await showModel(app);
    const options = [...app.$('node-search-list').querySelectorAll('option')].map((o) => o.value);
    expect(options).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('narrows to what matches, after the keystroke settles', async () => {
    const app = await mount();
    await showModel(app);
    vi.useFakeTimers();
    const box = search(app);
    box.value = 'poiss';
    box.dispatchEvent(new Event('input'));
    // Debounced: matching scans every node, so it must not run per keystroke.
    expect([...app.$('node-search-list').querySelectorAll('option')]).toHaveLength(3);
    vi.advanceTimersByTime(200);
    const options = [...app.$('node-search-list').querySelectorAll('option')].map((o) => o.value);
    expect(options).toEqual(['gamma']);
  });

  it('restores the full list when the box is emptied', async () => {
    const app = await mount();
    await showModel(app);
    vi.useFakeTimers();
    const box = search(app);
    box.value = 'poiss';
    box.dispatchEvent(new Event('input'));
    vi.advanceTimersByTime(200);
    box.value = '';
    box.dispatchEvent(new Event('input'));
    vi.advanceTimersByTime(200);
    expect([...app.$('node-search-list').querySelectorAll('option')]).toHaveLength(3);
  });
});

describe('keyboard shortcuts', () => {
  it('jumps to the search box on "/"', async () => {
    const app = await mount();
    await showModel(app);
    key(document.body, '/');
    expect(document.activeElement).toBe(search(app));
  });

  it('does nothing on "/" while nothing is loaded', async () => {
    const app = await mount();
    key(document.body, '/');
    expect(document.activeElement).not.toBe(search(app));
  });

  it('never hijacks a "/" typed into a field', async () => {
    const app = await mount();
    await showModel(app);
    const text = app.$<HTMLTextAreaElement>('paste-text');
    text.focus();
    key(text, '/');
    expect(document.activeElement).toBe(text);
  });

  it('leaves "/" alone when it is part of a shortcut', async () => {
    const app = await mount();
    await showModel(app);
    key(document.body, '/', { metaKey: true });
    expect(document.activeElement).not.toBe(search(app));
  });

  it('clears and leaves the search box on Escape', async () => {
    const app = await mount();
    await showModel(app);
    const box = search(app);
    box.focus();
    box.value = 'beta';
    key(box, 'Escape');
    expect(box.value).toBe('');
    expect(document.activeElement).not.toBe(box);
  });
});

describe('resizable panes', () => {
  const width = (app: MountedApp, v: string): string => app.layout.style.getPropertyValue(v);
  const splitter = (edge: string): HTMLElement =>
    document.querySelector<HTMLElement>(`.splitter[data-edge="${edge}"]`)!;

  it('widens the tree pane with the arrow keys, and remembers it', async () => {
    const app = await mount();
    key(splitter('tree'), 'ArrowRight');
    expect(width(app, '--tree-w')).toBe('336px');
    expect(splitter('tree').getAttribute('aria-valuenow')).toBe('336');
    expect(app.storage.getItem('mv-tree-w')).toBe('336');
  });

  it('takes a bigger step with Shift', async () => {
    const app = await mount();
    key(splitter('tree'), 'ArrowRight', { shiftKey: true });
    expect(width(app, '--tree-w')).toBe('368px');
  });

  it('grows the inspector towards the left, since it is measured from the right', async () => {
    const app = await mount();
    key(splitter('inspector'), 'ArrowLeft');
    expect(width(app, '--insp-w')).toBe('396px');
    key(splitter('inspector'), 'ArrowRight');
    expect(width(app, '--insp-w')).toBe('380px');
  });

  it('restores a remembered width on load', async () => {
    const app = await mount({ storage: { 'mv-tree-w': '480' } });
    expect(width(app, '--tree-w')).toBe('480px');
    expect(splitter('tree').getAttribute('aria-valuenow')).toBe('480');
  });

  it('clamps a remembered width that is out of range', async () => {
    const wide = await mount({ storage: { 'mv-tree-w': '5000' } });
    expect(width(wide, '--tree-w')).toBe('720px');
    const narrow = await mount({ storage: { 'mv-insp-w': '10' } });
    expect(width(narrow, '--insp-w')).toBe('180px');
  });

  it('resets to the default on Home', async () => {
    const app = await mount({ storage: { 'mv-tree-w': '480' } });
    key(splitter('tree'), 'Home');
    expect(width(app, '--tree-w')).toBe('320px');
  });

  it('follows the pointer between press and release, and not outside it', async () => {
    const app = await mount();
    const sep = splitter('tree');
    sep.dispatchEvent(new PointerEvent('pointermove', { clientX: 500, bubbles: true }));
    expect(width(app, '--tree-w')).toBe(''); // no drag in progress

    sep.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, bubbles: true, cancelable: true }));
    expect(document.body.style.userSelect).toBe('none');
    sep.dispatchEvent(new PointerEvent('pointermove', { clientX: 500, bubbles: true }));
    expect(width(app, '--tree-w')).toBe('500px');

    sep.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, bubbles: true }));
    expect(document.body.style.userSelect).toBe('');
    sep.dispatchEvent(new PointerEvent('pointermove', { clientX: 300, bubbles: true }));
    expect(width(app, '--tree-w')).toBe('500px');
  });
});

describe('pane tabs', () => {
  it('switches the visible pane and keeps aria-selected in step', async () => {
    const app = await mount();
    const tabs = [...document.querySelectorAll<HTMLButtonElement>('.pane-tab')];
    const graph = tabs.find((t) => t.dataset.pane === 'dag')!;
    graph.click();
    expect(app.layout.dataset.activePane).toBe('dag');
    expect(tabs.map((t) => t.getAttribute('aria-selected'))).toEqual(['false', 'true', 'false']);
  });
});

describe('the model dialog', () => {
  const withDiagnostics = () => model({
    meta: { hs3_version: '0.2' },
    diagnostics: [
      { level: 'warn', msg: 'beta looks odd', nodeId: 'beta' },
      { level: 'info', msg: 'just so you know' },
      { level: 'error', msg: 'the model as a whole is wrong' },
    ],
  });

  it('opens from the format badge, which says what it does', async () => {
    const app = await mount();
    await showModel(app);
    const badge = app.$<HTMLButtonElement>('format-badge');
    expect(badge.getAttribute('aria-label')).toContain('open info, metadata, and diagnostics');
    badge.click();
    expect(app.$<HTMLDialogElement>('model-dialog').open).toBe(true);
  });

  it('summarises the model and shows its metadata', async () => {
    const app = await mount();
    await showModel(app, withDiagnostics());
    app.$<HTMLButtonElement>('format-badge').click();
    const body = app.$('model-body');
    expect([...body.querySelectorAll('h3')].map((h) => h.textContent))
      .toEqual(['Summary', 'Metadata', 'Diagnostics']);
    expect(body.querySelector('.model-summary')?.textContent).toContain('HS3');
    expect(body.querySelector('.model-summary')?.textContent).toContain('3'); // nodes
    expect(body.querySelector('pre')?.textContent).toContain('hs3_version');
  });

  it('says so when there is no metadata to read', async () => {
    const app = await mount();
    await showModel(app);
    app.$<HTMLButtonElement>('format-badge').click();
    expect(app.$('model-body').textContent).toContain('This model carries no metadata');
    expect(app.$('model-body').textContent).toContain('No diagnostics — the model parsed cleanly');
  });

  it('lists diagnostics worst first', async () => {
    const app = await mount();
    await showModel(app, withDiagnostics());
    app.$<HTMLButtonElement>('format-badge').click();
    const levels = [...app.$('model-body').querySelectorAll('.diag-level')].map((s) => s.textContent);
    expect(levels).toEqual(['error', 'warn', 'info']);
  });

  it('makes a node diagnostic a link to the node, and a model-level one plain text', async () => {
    const app = await mount();
    await showModel(app, withDiagnostics());
    app.$<HTMLButtonElement>('format-badge').click();
    const items = [...app.$('model-body').querySelectorAll('.diag-list li')];
    // Worst first: [error (model-level), warn (on beta), info (model-level)].
    expect(items[0]!.querySelector('button')).toBeNull();
    expect(items[2]!.querySelector('button')).toBeNull();
    const xref = items[1]!.querySelector<HTMLButtonElement>('button.xref')!;
    expect(xref.textContent).toBe('beta looks odd');

    xref.click();
    expect(app.$<HTMLDialogElement>('model-dialog').open).toBe(false);
    expect(app.$('inspector-pane').textContent).toContain('beta');
  });

  it('advertises the diagnostic count next to the badge', async () => {
    const app = await mount();
    await showModel(app, withDiagnostics());
    const btn = app.$<HTMLButtonElement>('diag-btn');
    expect(btn.hidden).toBe(false);
    expect(btn.textContent).toBe('⚠ 3');
    expect(btn.dataset.level).toBe('error');
    expect(btn.getAttribute('aria-label')).toContain('3 diagnostics (1 error(s), 1 warning(s))');
    btn.click();
    expect(app.$<HTMLDialogElement>('model-dialog').open).toBe(true);
  });

  it('counts errors and warnings in the status bar', async () => {
    const app = await mount();
    await showModel(app, withDiagnostics());
    expect(app.status()).toContain('1 error(s), 1 warning(s)');
    expect(app.level()).toBe('error');
  });

  it('hides the count when a model parsed cleanly', async () => {
    const app = await mount();
    await showModel(app);
    expect(app.$('diag-btn').hidden).toBe(true);
    expect(app.level()).toBe('info');
  });

  it('stays shut while nothing is loaded', async () => {
    const app = await mount();
    app.$<HTMLButtonElement>('format-badge').click();
    expect(app.$<HTMLDialogElement>('model-dialog').open).toBe(false);
  });
});

describe('a model with no nodes', () => {
  it('is shown, but with search disabled and nothing to inspect', async () => {
    const app = await mount();
    await showModel(app, model({ nodes: [], edges: [] }));
    expect(app.$('format-badge').hidden).toBe(false);
    expect(search(app).disabled).toBe(true);
    expect(app.$('inspector-pane').textContent).toContain('Select a node to inspect');
  });
});
