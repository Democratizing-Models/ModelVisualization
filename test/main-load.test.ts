/**
 * App entry (`src/main.ts`), loading paths: samples, files, drag-and-drop, paste,
 * the parse worker's replies, and the shareable URL.
 *
 * These are the paths that had no coverage at all, and where every bug found by
 * hand-driving the built app actually lived: a failed load leaving the URL
 * describing a model that is no longer on screen, a worker that never starts,
 * out-of-order replies.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  mount, flush, waitForRequests, loadSample, showModel, bigFile, setFiles, dragEvent, submitDialog,
} from './app-harness.js';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('startup', () => {
  it('opens empty, with search disabled and an invitation to load', async () => {
    const app = await mount();
    expect(app.status()).toBe('Load a model file, or pick a bundled sample. Press / to search nodes.');
    expect(app.$('format-badge').hidden).toBe(true);
    expect(app.$('diag-btn').hidden).toBe(true);
    expect(app.$<HTMLInputElement>('node-search').disabled).toBe(true);
    expect(app.$('tree-pane').textContent).toContain('No model loaded');
  });

  it('offers a one-click sample, since reading a model is the fastest explanation', async () => {
    const app = await mount();
    const cta = app.$('dag-pane').querySelector('button');
    expect(cta?.textContent).toContain('Load sample');
    cta!.click();
    await flush();
    app.worker.answer();
    expect(app.$('format-badge').hidden).toBe(false);
  });

  it('populates the sample dropdown from the format registry, grouped by format', async () => {
    const app = await mount();
    const select = app.$<HTMLSelectElement>('sample-select');
    const groups = [...select.querySelectorAll('optgroup')].map((g) => g.label);
    expect(groups).toEqual(['HS3', 'XS3', 'FlatPPL']);
    expect(select.options.length).toBeGreaterThan(groups.length);
  });
});

describe('loading a bundled sample', () => {
  it('fetches it, parses it, and reports what was loaded', async () => {
    const app = await mount();
    await loadSample(app, 'hs3-gaussian');
    expect(app.fetchMock).toHaveBeenCalledWith('/samples/hs3_gaussian.hs3');
    expect(app.worker.lastRequest?.filename).toBe('hs3_gaussian.hs3');
    expect(app.$('format-badge').textContent).toBe('HS3');
    expect(app.status()).toMatch(/^HS3: \d+ nodes, \d+ edges/);
    expect(app.level()).toBe('info');
    expect(app.$<HTMLInputElement>('node-search').disabled).toBe(false);
  });

  it('resets the dropdown, so re-picking the same sample fires change again', async () => {
    const app = await mount();
    await loadSample(app, 'hs3-gaussian');
    expect(app.$<HTMLSelectElement>('sample-select').value).toBe('');
  });

  it('reports a fetch failure without clearing the screen', async () => {
    const app = await mount();
    app.fetchMock.mockResolvedValue({ ok: false, status: 503, text: async () => '' } as unknown as Response);
    const select = app.$<HTMLSelectElement>('sample-select');
    select.value = 'hs3-gaussian';
    select.dispatchEvent(new Event('change'));
    await flush();
    expect(app.worker.requests).toHaveLength(0);
    expect(app.status()).toContain('HTTP 503');
    expect(app.level()).toBe('error');
  });
});

describe('shareable URL', () => {
  it('records the sample and the selected node', async () => {
    const app = await mount();
    await loadSample(app, 'hs3-gaussian');
    const url = new URL(location.href);
    expect(url.searchParams.get('sample')).toBe('hs3-gaussian');
    expect(url.searchParams.get('node')).toBeTruthy();
  });

  it('restores a deep link, overriding the default root focus', async () => {
    const app = await mount({ url: '/?sample=hs3-gaussian&node=sigma' });
    await flush();
    app.worker.answer();
    expect(app.$('inspector-pane').textContent).toContain('sigma');
    expect(new URL(location.href).searchParams.get('node')).toBe('sigma');
  });

  it('says so when a linked node is not in the model', async () => {
    const app = await mount({ url: '/?sample=hs3-gaussian&node=not_a_node' });
    await flush();
    app.worker.answer();
    expect(app.status()).toContain('Linked node "not_a_node" is not in this model');
    expect(app.level()).toBe('error');
  });

  it('says so when the linked sample is unknown, instead of failing silently', async () => {
    const app = await mount({ url: '/?sample=nope' });
    expect(app.status()).toContain('Unknown sample "nope"');
    expect(app.fetchMock).not.toHaveBeenCalled();
  });

  it('drops the parameters for a pasted model, which no URL can restore', async () => {
    const app = await mount();
    await loadSample(app, 'hs3-gaussian');
    expect(location.search).toContain('sample=');
    await showModel(app);
    expect(location.search).toBe('');
  });
});

describe('a parse that fails', () => {
  it('keeps the model on screen and says the failure changed nothing', async () => {
    const app = await mount();
    await loadSample(app, 'hs3-gaussian');
    const before = app.$('tree-pane').innerHTML;

    app.$<HTMLButtonElement>('paste-btn').click();
    app.$<HTMLTextAreaElement>('paste-text').value = 'not a model';
    submitDialog(app.$<HTMLDialogElement>('paste-dialog'), 'load');
    app.worker.answer();

    expect(app.status()).toContain('Could not load "pasted model"');
    expect(app.status()).toContain('the loaded model is unchanged');
    expect(app.level()).toBe('error');
    expect(app.$('tree-pane').innerHTML).toBe(before);
  });

  /**
   * Regression: the sample was recorded when a load STARTED, so after a failed
   * load the next node click rewrote the URL for the failed load — stripping
   * `?sample=&node=` while the previous model was still on screen, leaving no
   * link to what the user was reading.
   */
  it('leaves the previous model still linkable', async () => {
    const app = await mount();
    await loadSample(app, 'hs3-gaussian');

    app.$<HTMLButtonElement>('paste-btn').click();
    app.$<HTMLTextAreaElement>('paste-text').value = 'not a model';
    submitDialog(app.$<HTMLDialogElement>('paste-dialog'), 'load');
    app.worker.answer();

    const search = app.$<HTMLInputElement>('node-search');
    search.value = 'sigma';
    search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    const url = new URL(location.href);
    expect(url.searchParams.get('sample')).toBe('hs3-gaussian');
    expect(url.searchParams.get('node')).toBe('sigma');
  });

  it('falls back to the empty state when there was nothing to keep', async () => {
    const app = await mount();
    app.$<HTMLButtonElement>('paste-btn').click();
    app.$<HTMLTextAreaElement>('paste-text').value = 'not a model';
    submitDialog(app.$<HTMLDialogElement>('paste-dialog'), 'load');
    app.worker.answer();
    expect(app.status()).toContain('Could not load "pasted model"');
    expect(app.status()).not.toContain('unchanged');
    expect(app.$('tree-pane').textContent).toContain('No model loaded');
  });
});

describe('the parse worker', () => {
  it('ignores a reply that a newer load has superseded', async () => {
    const app = await mount();
    const select = app.$<HTMLSelectElement>('sample-select');
    select.value = 'hs3-gaussian';
    select.dispatchEvent(new Event('change'));
    await flush();
    select.value = 'flatppl-poisson';
    select.dispatchEvent(new Event('change'));
    await flush();
    expect(app.worker.requests).toHaveLength(2);

    // The stale reply arrives last, as a slow parse would.
    app.worker.answer(app.worker.requests[0]);
    expect(app.$('format-badge').hidden).toBe(true);

    app.worker.answer(app.worker.requests[1]);
    expect(app.$('format-badge').textContent).toBe('FlatPPL');
  });

  it('reports a worker that never starts, instead of parsing forever', async () => {
    const app = await mount({ ready: false });
    vi.useFakeTimers();
    const select = app.$<HTMLSelectElement>('sample-select');
    select.value = 'hs3-gaussian';
    select.dispatchEvent(new Event('change'));
    await vi.advanceTimersByTimeAsync(1);
    expect(app.status()).toContain('Parsing');

    await vi.advanceTimersByTimeAsync(8000);
    expect(app.status()).toContain('The model parser could not run (it did not start)');
    expect(app.level()).toBe('error');
  });

  it('does not time out a slow parse once the worker has reported ready', async () => {
    const app = await mount(); // ready delivered
    vi.useFakeTimers();
    const select = app.$<HTMLSelectElement>('sample-select');
    select.value = 'hs3-gaussian';
    select.dispatchEvent(new Event('change'));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(app.status()).toContain('Parsing');
    expect(app.status()).not.toContain('could not run');
  });

  it('reports a runtime error inside the worker', async () => {
    const app = await mount();
    app.worker.fail('boom');
    expect(app.status()).toContain('The model parser could not run (boom)');
    expect(app.level()).toBe('error');
  });

  it('reports a model that could not be transferred', async () => {
    const app = await mount();
    app.worker.messageError();
    expect(app.status()).toContain('the parsed model could not be transferred');
  });

  it('is a module worker, as the source imports require', async () => {
    const app = await mount();
    expect(app.worker.options?.type).toBe('module');
  });
});

describe('loading a file', () => {
  const HS3 = '{"metadata":{"hs3_version":"0.2"},"distributions":[{"name":"d","type":"gaussian_dist","mean":"m","sigma":1,"x":"x"}]}';

  it('reads a picked file and parses it', async () => {
    const app = await mount();
    const input = app.$<HTMLInputElement>('file-input');
    setFiles(input, [new File([HS3], 'picked.hs3')]);
    input.dispatchEvent(new Event('change'));
    await waitForRequests(app);
    expect(app.worker.lastRequest?.filename).toBe('picked.hs3');
    app.worker.answer();
    expect(app.$('format-badge').textContent).toBe('HS3');
  });

  it('clears the input, so re-picking the same file fires change again', async () => {
    const app = await mount();
    const input = app.$<HTMLInputElement>('file-input');
    setFiles(input, [new File([HS3], 'picked.hs3')]);
    input.dispatchEvent(new Event('change'));
    expect(input.value).toBe('');
  });

  it('warns before a very large file, and loads it if the user agrees', async () => {
    const app = await mount({ confirm: true });
    const input = app.$<HTMLInputElement>('file-input');
    setFiles(input, [bigFile('huge.hs3', HS3, 60e6)]);
    input.dispatchEvent(new Event('change'));
    expect(app.confirmMock).toHaveBeenCalledOnce();
    expect(String(app.confirmMock.mock.calls[0]?.[0])).toContain('60 MB');
    await waitForRequests(app);
    expect(app.worker.lastRequest?.filename).toBe('huge.hs3');
  });

  it('backs out without reading when the user declines', async () => {
    const app = await mount({ confirm: false });
    const input = app.$<HTMLInputElement>('file-input');
    setFiles(input, [bigFile('huge.hs3', HS3, 60e6)]);
    input.dispatchEvent(new Event('change'));
    await flush();
    expect(app.worker.requests).toHaveLength(0);
    expect(app.status()).toContain('Load cancelled');
  });

  it('does not warn about an ordinary file', async () => {
    const app = await mount();
    const input = app.$<HTMLInputElement>('file-input');
    setFiles(input, [new File([HS3], 'small.hs3')]);
    input.dispatchEvent(new Event('change'));
    expect(app.confirmMock).not.toHaveBeenCalled();
  });
});

describe('drag and drop', () => {
  it('shows the overlay only while a drag carrying files is over the window', async () => {
    const app = await mount();
    const overlay = app.$('drop-overlay');
    expect(overlay.hidden).toBe(true);

    window.dispatchEvent(dragEvent('dragover', [new File(['x'], 'a.hs3')]));
    expect(overlay.hidden).toBe(false);

    // Crossing into a child element keeps it up (relatedTarget is set)…
    window.dispatchEvent(dragEvent('dragleave', [], document.body));
    expect(overlay.hidden).toBe(false);
    // …leaving the window entirely takes it down.
    window.dispatchEvent(dragEvent('dragleave', []));
    expect(overlay.hidden).toBe(true);
  });

  it('ignores a drag that carries no files', async () => {
    const app = await mount();
    window.dispatchEvent(dragEvent('dragover', []));
    expect(app.$('drop-overlay').hidden).toBe(true);
  });

  it('loads a dropped file and hides the overlay', async () => {
    const app = await mount();
    const file = new File(['mu ~ normal(0, 1)\ny = mu\n'], 'dropped.flatppl');
    window.dispatchEvent(dragEvent('dragover', [file]));
    window.dispatchEvent(dragEvent('drop', [file]));
    expect(app.$('drop-overlay').hidden).toBe(true);
    await waitForRequests(app);
    expect(app.worker.lastRequest?.filename).toBe('dropped.flatppl');
    app.worker.answer();
    expect(app.$('format-badge').textContent).toBe('FlatPPL');
  });
});

describe('paste to load', () => {
  it('opens an empty box with no stale outcome from a previous visit', async () => {
    const app = await mount();
    const dialog = app.$<HTMLDialogElement>('paste-dialog');
    dialog.returnValue = 'load'; // as a previous load would have left it
    app.$<HTMLTextAreaElement>('paste-text').value = 'old text';
    app.$<HTMLButtonElement>('paste-btn').click();
    expect(dialog.open).toBe(true);
    expect(app.$<HTMLTextAreaElement>('paste-text').value).toBe('');
    expect(dialog.returnValue).toBe('');
  });

  it('parses pasted text, with no extension to go on', async () => {
    const app = await mount();
    app.$<HTMLButtonElement>('paste-btn').click();
    app.$<HTMLTextAreaElement>('paste-text').value = 'mu ~ normal(0, 1)\ny = mu\n';
    submitDialog(app.$<HTMLDialogElement>('paste-dialog'), 'load');
    expect(app.worker.lastRequest?.filename).toBe('pasted model');
    app.worker.answer();
    expect(app.$('format-badge').textContent).toBe('FlatPPL');
  });

  it('loads nothing when cancelled', async () => {
    const app = await mount();
    app.$<HTMLButtonElement>('paste-btn').click();
    app.$<HTMLTextAreaElement>('paste-text').value = 'mu ~ normal(0, 1)';
    submitDialog(app.$<HTMLDialogElement>('paste-dialog'), 'cancel');
    expect(app.worker.requests).toHaveLength(0);
  });

  it('says the box was empty rather than reporting a parse failure', async () => {
    const app = await mount();
    app.$<HTMLButtonElement>('paste-btn').click();
    app.$<HTMLTextAreaElement>('paste-text').value = '   \n  ';
    submitDialog(app.$<HTMLDialogElement>('paste-dialog'), 'load');
    expect(app.worker.requests).toHaveLength(0);
    expect(app.status()).toContain('paste box was empty');
  });
});
