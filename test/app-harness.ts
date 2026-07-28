/**
 * Harness for the app entry (`src/main.ts`).
 *
 * `main.ts` is a side-effecting module: importing it wires the entire UI to
 * whatever `document` is current, so a test cannot simply call into it. Each
 * mount therefore rebuilds the DOM and re-imports the module (`vi.resetModules()`
 * + dynamic import). The DOM comes from the real `index.html` rather than a
 * restated fragment, so a control that `main.ts` looks up by id but `index.html`
 * has lost fails loudly here instead of silently disabling a feature.
 *
 * What is faked, and why:
 *  - `Worker` — jsdom has none. `FakeWorker` records what `main.ts` posts and
 *    lets a test answer it, including the one-shot `ready` handshake, so the
 *    load-token, superseded-reply and watchdog paths can be driven exactly.
 *    `answer()` runs the real `detectAndParse`, i.e. the worker's own body.
 *  - `fetch` — bundled samples are read off disk from `public/`.
 *  - `localStorage` — undefined under this runner. `main.ts` optional-chains it,
 *    so without a stub the persistence paths would just be skipped.
 *  - `<dialog>` — jsdom implements only `open`: no `showModal`, `close`, or
 *    `returnValue`. `patchDialog` adds the minimum, and `submitDialog` stands in
 *    for the browser's `form[method=dialog]` behaviour (take `returnValue` from
 *    the submit button, close, fire `close`). Dialog tests thus cover our own
 *    handlers, not the browser semantics they sit on.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { vi } from 'vitest';
import { detectAndParse } from '../src/adapters/detect.js';
import type { ParseRequest, ParseResponse } from '../src/adapters/parse.worker.js';
import type { Model, ModelNode } from '../src/model/index.js';

const ROOT = process.cwd();

/** The real page body, minus the module script (we import that ourselves). */
const INDEX_BODY = ((): string => {
  const html = readFileSync(resolve(ROOT, 'index.html'), 'utf8');
  const body = html.slice(html.indexOf('<body>') + '<body>'.length, html.lastIndexOf('</body>'));
  return body.replace(/<script[\s\S]*?<\/script>/g, '');
})();

/** Stand-in for the parse worker: records requests, replays replies on demand. */
export class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  onmessageerror: ((e: MessageEvent) => void) | null = null;
  readonly requests: ParseRequest[] = [];
  terminated = false;

  constructor(readonly url: URL | string, readonly options?: WorkerOptions) {
    FakeWorker.instances.push(this);
  }

  postMessage(req: ParseRequest): void { this.requests.push(req); }
  terminate(): void { this.terminated = true; }
  addEventListener(): void { /* main.ts uses the on* properties */ }
  removeEventListener(): void { /* idem */ }

  get lastRequest(): ParseRequest | undefined { return this.requests.at(-1); }

  /** The one-shot handshake the real worker posts as soon as it evaluates. */
  ready(): void { this.deliver({ ready: true }); }

  /** Reply exactly as the real worker would: run the parser, report either the
   *  model or the error it threw. The reply is delivered OUTSIDE the try, so a
   *  failure in the app's own render path surfaces as a test error rather than
   *  being handed back as a bogus parse failure. */
  answer(req: ParseRequest | undefined = this.lastRequest): void {
    if (!req) throw new Error('no parse request to answer');
    let res: ParseResponse;
    try {
      res = { id: req.id, ok: true, model: detectAndParse(req.filename, req.source) };
    } catch (err) {
      res = { id: req.id, ok: false, error: (err as Error).message };
    }
    this.deliver(res);
  }

  /** Reply with a specific model, for cases the bundled samples don't cover. */
  respondModel(model: Model, req: ParseRequest | undefined = this.lastRequest): void {
    this.deliver({ id: req!.id, ok: true, model } satisfies ParseResponse);
  }

  /** Reply with a parse failure. */
  respondError(error: string, req: ParseRequest | undefined = this.lastRequest): void {
    this.deliver({ id: req!.id, ok: false, error } satisfies ParseResponse);
  }

  /** A runtime error inside the worker. */
  fail(message: string): void {
    this.onerror?.({ message, preventDefault: () => { /* noop */ } } as unknown as ErrorEvent);
  }

  /** A reply that could not be structured-cloned. */
  messageError(): void { this.onmessageerror?.({} as MessageEvent); }

  deliver(data: unknown): void { this.onmessage?.({ data } as MessageEvent); }
}

/** Map-backed Storage, so the pane-width persistence paths actually run. */
export class FakeStorage implements Storage {
  readonly map = new Map<string, string>();
  get length(): number { return this.map.size; }
  getItem(k: string): string | null { return this.map.get(k) ?? null; }
  setItem(k: string, v: string): void { this.map.set(k, String(v)); }
  removeItem(k: string): void { this.map.delete(k); }
  clear(): void { this.map.clear(); }
  key(i: number): string | null { return [...this.map.keys()][i] ?? null; }
}

/** jsdom has no layout, so it implements no scrolling. The tree scrolls the
 *  selected row into view on every selection, which is on the path of nearly
 *  every test here. */
function patchScrollIntoView(): void {
  if (typeof Element.prototype.scrollIntoView === 'function') return;
  Element.prototype.scrollIntoView = function scrollIntoView(): void { /* no layout */ };
}

let dialogPatched = false;
/** jsdom's HTMLDialogElement carries only `open`; add the members main.ts uses. */
function patchDialog(): void {
  if (dialogPatched) return;
  dialogPatched = true;
  const proto = HTMLDialogElement.prototype as unknown as Record<string, unknown>;
  if (typeof proto.showModal === 'function') return; // a future jsdom implements it
  Object.defineProperties(proto, {
    returnValue: { value: '', writable: true, configurable: true },
    showModal: { value(this: HTMLDialogElement) { this.open = true; }, configurable: true },
    show: { value(this: HTMLDialogElement) { this.open = true; }, configurable: true },
    close: {
      value(this: HTMLDialogElement, rv?: string) {
        if (rv !== undefined) this.returnValue = rv;
        this.open = false;
        this.dispatchEvent(new Event('close'));
      },
      configurable: true,
    },
  });
}

/**
 * Do what a browser does when a `form[method=dialog]` is submitted: adopt the
 * submitter's value as `returnValue`, close, and fire `close`. `main.ts` reacts
 * to that `close` event, which is the part under test.
 */
export function submitDialog(dialog: HTMLDialogElement, value: string): void {
  dialog.returnValue = value;
  dialog.close();
}

export interface MountOptions {
  /** Page URL, for the `?sample=…&node=…` deep-link paths. */
  url?: string;
  /** Deliver the worker's ready handshake (default true). False exercises the
   *  "worker never started" watchdog. */
  ready?: boolean;
  /** Seed values for the fake localStorage, e.g. a remembered pane width. */
  storage?: Record<string, string>;
  /** What `window.confirm` returns for the large-file warning (default true). */
  confirm?: boolean;
}

export interface MountedApp {
  worker: FakeWorker;
  storage: FakeStorage;
  fetchMock: ReturnType<typeof vi.fn>;
  confirmMock: ReturnType<typeof vi.fn>;
  /** Element by id, asserting it exists (mirrors main.ts's own lookup). */
  $: <T extends HTMLElement>(id: string) => T;
  layout: HTMLElement;
  status: () => string;
  level: () => string | undefined;
}

/** Build the page, install the fakes, and import `main.ts` fresh. */
export async function mount(opts: MountOptions = {}): Promise<MountedApp> {
  patchDialog();
  patchScrollIntoView();
  history.replaceState(null, '', opts.url ?? '/');
  document.documentElement.removeAttribute('data-theme');
  document.body.innerHTML = INDEX_BODY;

  const storage = new FakeStorage();
  for (const [k, v] of Object.entries(opts.storage ?? {})) storage.setItem(k, v);
  vi.stubGlobal('localStorage', storage);

  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input).replace(/^\/+/, '');
    try {
      const body = readFileSync(resolve(ROOT, 'public', path), 'utf8');
      return { ok: true, status: 200, text: async () => body } as unknown as Response;
    } catch {
      return { ok: false, status: 404, text: async () => '' } as unknown as Response;
    }
  });
  vi.stubGlobal('fetch', fetchMock);

  const confirmMock = vi.fn(() => opts.confirm ?? true);
  vi.stubGlobal('confirm', confirmMock);

  FakeWorker.instances.length = 0;
  vi.stubGlobal('Worker', FakeWorker);

  vi.resetModules();
  await import('../src/main.js');

  const worker = FakeWorker.instances.at(-1);
  if (!worker) throw new Error('main.ts did not create a parse worker');
  if (opts.ready !== false) worker.ready();

  const $ = <T extends HTMLElement>(id: string): T => {
    const node = document.getElementById(id);
    if (!node) throw new Error(`missing #${id}`);
    return node as T;
  };
  const statusEl = $<HTMLElement>('status');
  return {
    worker, storage, fetchMock, confirmMock, $,
    layout: document.querySelector<HTMLElement>('.layout')!,
    status: () => statusEl.textContent ?? '',
    level: () => statusEl.dataset.level,
  };
}

/** Yield to the macrotask queue, letting fetch/FileReader callbacks run. Not for
 *  use under fake timers — advance those explicitly instead. */
export const flush = (): Promise<void> => new Promise<void>((r) => { setTimeout(r, 0); });

/** Wait until `n` parse requests have reached the worker. `FileReader` delivers
 *  over several tasks in jsdom, so a single tick is not enough to see one. */
export async function waitForRequests(app: MountedApp, n = 1): Promise<void> {
  await vi.waitFor(() => {
    if (app.worker.requests.length < n) throw new Error(`only ${app.worker.requests.length} of ${n} requests`);
  });
}

/** Load a bundled sample the way a user does, and let the worker answer it. */
export async function loadSample(app: MountedApp, value: string): Promise<void> {
  const select = app.$<HTMLSelectElement>('sample-select');
  select.value = value;
  select.dispatchEvent(new Event('change'));
  await flush();
  app.worker.answer();
}

/**
 * Display `m` without going through a parser: paste a placeholder, then have the
 * worker hand back the model. Lets a test pick the exact graph it needs instead
 * of one a bundled sample happens to have.
 */
export async function showModel(app: MountedApp, m: Model = model()): Promise<void> {
  const dialog = app.$<HTMLDialogElement>('paste-dialog');
  app.$<HTMLButtonElement>('paste-btn').click();
  app.$<HTMLTextAreaElement>('paste-text').value = 'placeholder';
  submitDialog(dialog, 'load');
  app.worker.respondModel(m);
}

/** A File whose reported size is a lie, so the large-file warning can be
 *  triggered without allocating 50 MB. */
export function bigFile(name: string, text: string, size: number): File {
  const file = new File([text], name);
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

/** Give a file input a FileList-ish; jsdom has no DataTransfer to build one. */
export function setFiles(input: HTMLInputElement, files: File[]): void {
  Object.defineProperty(input, 'files', {
    configurable: true,
    value: { ...files, length: files.length, item: (i: number) => files[i] ?? null },
  });
}

/** A drag/drop event carrying files; jsdom has neither DragEvent nor DataTransfer. */
export function dragEvent(type: string, files: File[], relatedTarget: unknown = null): Event {
  const ev = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(ev, {
    dataTransfer: { value: { types: files.length ? ['Files'] : [], files } },
    relatedTarget: { value: relatedTarget },
  });
  return ev;
}

export function key(el: EventTarget, k: string, init: KeyboardEventInit = {}): void {
  el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));
}

/** Minimal hand-built model, for shapes the bundled samples don't have. */
export function model(over: Partial<Model> = {}): Model {
  const node = (id: string, type = 'gaussian_dist'): ModelNode =>
    ({ id, blockName: id, kind: 'distribution', type, raw: { name: id } });
  return {
    format: 'hs3',
    meta: {},
    nodes: [node('alpha'), node('beta'), node('gamma', 'poisson_dist')],
    edges: [{ from: 'alpha', to: 'beta', role: 'input', port: 'mean' }],
    diagnostics: [],
    roots: [],
    ...over,
  };
}
