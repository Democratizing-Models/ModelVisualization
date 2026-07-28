/** App entry: load a model (file or bundled sample), render tree + dag + inspector. */
import { REGISTRY } from './adapters/detect.js';
import type { ParseRequest, ParseMessage } from './adapters/parse.worker.js';
import { renderTree } from './render/tree.js';
import { renderInspector } from './render/inspector.js';
import { initTheme } from './render/theme.js';
import { clear, el, resetKindColors } from './render/dom.js';
import {
  buildIndex, computeRoots, findMatches,
  type Model, type ModelIndex, type ModelNode, type SourceFormat,
} from './model/index.js';
import { renderDag } from './render/dag.js';

const $ = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node as T;
};

const treePane = $<HTMLElement>('tree-pane');
const dagPane = $<HTMLElement>('dag-pane');
const inspectorPane = $<HTMLElement>('inspector-pane');
const statusEl = $<HTMLElement>('status');
const badge = $<HTMLElement>('format-badge');
const fileInput = $<HTMLInputElement>('file-input');
const sampleSelect = $<HTMLSelectElement>('sample-select');
const nodeSearch = $<HTMLInputElement>('node-search');
const searchList = $<HTMLDataListElement>('node-search-list');
const diagBtn = $<HTMLButtonElement>('diag-btn');
const modelDialog = $<HTMLDialogElement>('model-dialog');
const modelBody = $<HTMLElement>('model-body');
const layoutEl = document.querySelector<HTMLElement>('.layout')!;

/** Max autocomplete suggestions to put in the datalist (full search still scans
 *  all nodes; this only bounds the suggestion DOM for very large models). */
const SEARCH_SUGGESTIONS = 200;

// The currently displayed model, kept so the model dialog and the live search
// suggestions can consult it outside a render pass.
let currentModel: Model | null = null;
let currentIndex: ModelIndex | null = null;
/** Selects + reveals a node in the current model; null when nothing is loaded. */
let selectNode: ((id: string) => void) | null = null;
/** The bundled sample the displayed model came from, or null for a file/paste —
 *  only a sample can appear in a shareable URL. Assigned when a parse succeeds. */
let currentSample: string | null = null;
/** A ?node= target waiting for the model it belongs to to finish loading. */
let pendingNodeId: string | null = null;

initTheme($<HTMLButtonElement>('theme-toggle'));

/** Files above this size aren't blocked — the user is warned (loading a huge
 *  file may hang the tab) and may proceed or cancel. */
const LARGE_FILE_BYTES = 50 * 1024 * 1024;

// Labels and sample list are derived from the format registry — adding a format
// is a single registry entry, with no edits here. Each format's samples are
// grouped under an <optgroup> headed by the format label.
const FORMAT_LABEL = Object.fromEntries(REGISTRY.map((d) => [d.format, d.label])) as Record<SourceFormat, string>;
const SAMPLES = REGISTRY.flatMap((d) => d.samples);
const SAMPLE_PATH = new Map(SAMPLES.map((s) => [s.value, s.path]));
for (const d of REGISTRY) {
  const group = document.createElement('optgroup');
  group.label = d.label;
  for (const s of d.samples) group.append(new Option(s.label, s.value));
  sampleSelect.append(group);
}

function setStatus(msg: string, level: 'info' | 'error' = 'info'): void {
  // Prefix errors in text (not colour alone) so the level is conveyed to
  // screen-reader and monochrome users; switch to assertive announcement.
  statusEl.textContent = level === 'error' ? `Error: ${msg}` : msg;
  statusEl.title = statusEl.textContent; // full text on hover (the bar is single-line/ellipsised)
  statusEl.dataset.level = level;
  statusEl.setAttribute('aria-live', level === 'error' ? 'assertive' : 'polite');
}

/** Centred placeholder shown in an empty pane, with an optional call to action. */
function emptyState(pane: HTMLElement, msg: string, action?: HTMLElement): void {
  clear(pane);
  pane.append(el('div', { class: 'empty-state' }, [el('p', { class: 'empty-msg' }, [msg]), action]));
}

function showEmpty(): void {
  badge.hidden = true;
  diagBtn.hidden = true;
  nodeSearch.disabled = true;
  nodeSearch.value = '';
  searchList.replaceChildren();
  jumpTo = null;
  selectNode = null;
  currentModel = null;
  currentIndex = null;
  emptyState(treePane, 'No model loaded.');
  // A button, not just instructions: the fastest way to understand what this
  // viewer does is to be looking at a model.
  const demo = SAMPLES[0];
  emptyState(
    dagPane,
    'No model loaded. Drop a .hs3, .xs3, or .flatppl file anywhere, paste one, or start with a bundled sample. Selecting a node updates the tree, graph, and inspector together.',
    demo ? el('button', {
      class: 'btn btn-primary', type: 'button',
      onclick: () => { void loadSample(demo.value); },
    }, [`Load sample: ${demo.label}`]) : undefined,
  );
  emptyState(inspectorPane, 'Select a node to inspect.');
}

/** Fill the model dialog from the loaded model: summary, metadata, diagnostics. */
function renderModelDialog(model: Model): void {
  clear(modelBody);

  const summary = el('dl', { class: 'model-summary' }, [
    el('dt', {}, ['format']), el('dd', {}, [FORMAT_LABEL[model.format] ?? model.format]),
    el('dt', {}, ['nodes']), el('dd', {}, [String(model.nodes.length)]),
    el('dt', {}, ['edges']), el('dd', {}, [String(model.edges.length)]),
  ]);
  modelBody.append(el('h3', {}, ['Summary']), summary);

  // Metadata is parsed by every adapter (HS3 `metadata`, XS3 payload) but had no
  // reader anywhere in the UI until now.
  const metaKeys = Object.keys(model.meta);
  modelBody.append(el('h3', {}, ['Metadata']));
  modelBody.append(metaKeys.length > 0
    ? el('pre', {}, [JSON.stringify(model.meta, null, 2)])
    : el('p', { class: 'model-none' }, ['This model carries no metadata.']));

  // Every diagnostic, including the model-level ones (no nodeId) that the
  // inspector cannot show and the status bar only counts.
  modelBody.append(el('h3', {}, ['Diagnostics']));
  if (model.diagnostics.length === 0) {
    modelBody.append(el('p', { class: 'model-none' }, ['No diagnostics — the model parsed cleanly.']));
    return;
  }
  const list = el('ul', { class: 'diag-list' });
  // Worst first, so errors are read before warnings.
  const rank = { error: 0, warn: 1, info: 2 } as const;
  const sorted = [...model.diagnostics].sort((a, b) => rank[a.level] - rank[b.level]);
  for (const d of sorted) {
    const target = d.nodeId !== undefined ? currentIndex?.byId.get(d.nodeId) : undefined;
    list.append(el('li', { dataset: { level: d.level } }, [
      el('span', { class: 'diag-level' }, [d.level]),
      target
        ? el('button', {
          class: 'xref', type: 'button',
          title: `Focus "${target.blockName}"`,
          onclick: () => { modelDialog.close(); selectNode?.(target.id); },
        }, [d.msg])
        : el('span', { class: 'diag-msg' }, [d.msg]),
    ]));
  }
  modelBody.append(list);
}

function openModelDialog(): void {
  if (!currentModel) return;
  renderModelDialog(currentModel);
  modelDialog.showModal();
}

badge.addEventListener('click', openModelDialog);
diagBtn.addEventListener('click', openModelDialog);

function showModel(model: Model): void {
  badge.hidden = false;
  badge.textContent = FORMAT_LABEL[model.format];
  // The visible text is the format name, so spell out what activating it does —
  // otherwise the button announces only "HS3".
  badge.title = 'Model info, metadata, and diagnostics';
  badge.setAttribute('aria-label', `${FORMAT_LABEL[model.format]} model — open info, metadata, and diagnostics`);

  // Fresh, first-seen kind→colour assignment for this model (distinct colours
  // per kind, deterministic per render).
  resetKindColors();

  // One index per model, shared by tree, dag and inspector (no per-click rebuilds).
  const index = buildIndex(model);
  currentModel = model;
  currentIndex = index;
  // Roots computed ONCE here and shared by the tree and the default focus.
  const roots = computeRoots(model, index);

  // Single source of truth for selection. The `current` guard breaks the cycle:
  // tree.focus() itself fires onSelect, which calls select() again — without the
  // guard that would recurse forever.
  let current: string | null = null;
  let tree: { focus(id: string): void };
  let dag: { focus(id: string): void };
  const select = (id: string): void => {
    if (id === current) return;
    const node = index.byId.get(id);
    if (!node) return;
    current = id;
    renderInspector(model, index, node, inspectorPane, select);
    tree.focus(id);
    dag.focus(id);
    syncUrl(id); // keep the address bar shareable (samples only)
  };

  const initial = roots[0]?.id ?? model.nodes[0]?.id ?? '';
  // User-driven selections also surface the inspector — on narrow (tabbed)
  // screens that gives visible feedback for a tap; on wide screens every pane is
  // shown regardless, so it's a no-op there.
  const userSelect = (id: string): void => { select(id); activatePane('inspector'); };
  selectNode = userSelect; // for the diagnostics list in the model dialog
  tree = renderTree(model, index, treePane, (node) => userSelect(node.id), roots);
  dag = renderDag(index, dagPane, initial, (node) => userSelect(node.id));

  // Enable jump-to-node search and seed autocomplete suggestions. Search is the
  // primary way to reach a node in a large model that the cone/capped tree hide.
  fillSuggestions(model.nodes);
  nodeSearch.disabled = model.nodes.length === 0;
  nodeSearch.value = '';
  searchQuery = '';
  searchMatches = [];
  jumpTo = (query: string, advance = false): void => {
    const q = query.trim();
    if (!q) return;
    // A new query starts a fresh match list; re-submitting the same one with
    // `advance` steps to the NEXT match, so every node matching a common
    // substring is reachable — previously only the first one ever was. Without
    // `advance` the same query just re-selects the current match (idempotent).
    if (q !== searchQuery) {
      searchQuery = q;
      searchMatches = findMatches(model.nodes, index.byId, q);
      searchPos = 0;
    } else if (advance && searchMatches.length > 1) {
      searchPos = (searchPos + 1) % searchMatches.length;
    }
    const match = searchMatches[searchPos];
    if (!match) { setStatus(`No node matching "${q}"`, 'error'); return; }
    userSelect(match.id);
    setStatus(searchMatches.length > 1
      ? `Focused "${match.blockName}" — match ${searchPos + 1} of ${searchMatches.length}; press Enter again for the next`
      : `Focused "${match.blockName}"`);
  };

  const errors = model.diagnostics.filter((d) => d.level === 'error').length;
  const warns = model.diagnostics.filter((d) => d.level === 'warn').length;
  const diagText = errors || warns ? ` — ${errors} error(s), ${warns} warning(s)` : '';
  setStatus(`${FORMAT_LABEL[model.format]}: ${model.nodes.length} nodes, ${model.edges.length} edges${diagText}`,
    errors ? 'error' : 'info');

  // The status bar only COUNTS diagnostics, and the inspector can only show ones
  // attached to a node — so surface a button that opens the full list, including
  // model-level messages that otherwise had no reader at all.
  const total = model.diagnostics.length;
  diagBtn.hidden = total === 0;
  if (total > 0) {
    diagBtn.textContent = `⚠ ${total}`;
    diagBtn.dataset.level = errors ? 'error' : warns ? 'warn' : 'info';
    const label = `${total} diagnostic${total === 1 ? '' : 's'} (${errors} error(s), ${warns} warning(s)) — click to read`;
    diagBtn.title = label;
    diagBtn.setAttribute('aria-label', label);
  }

  // Bootstrap the shared selection so the tree highlight, inspector, and DAG all
  // open on the same default node instead of an empty inspector.
  if (initial) {
    select(initial);
  } else {
    emptyState(inspectorPane, 'Select a node to inspect.');
  }

  // A ?node= deep link overrides the default root focus, once, after the panes
  // exist. Accepts an id or any search term so hand-written links still work.
  if (pendingNodeId) {
    const wanted = pendingNodeId;
    pendingNodeId = null;
    const target = index.byId.get(wanted) ?? findMatches(model.nodes, index.byId, wanted)[0];
    if (target) userSelect(target.id);
    else setStatus(`Linked node "${wanted}" is not in this model`, 'error');
  }
}

/** Put `nodes` (capped) into the search datalist as autocomplete suggestions. */
function fillSuggestions(nodes: ModelNode[]): void {
  const frag = document.createDocumentFragment();
  for (const n of nodes.slice(0, SEARCH_SUGGESTIONS)) frag.append(new Option(n.blockName));
  searchList.replaceChildren(frag);
}

// Jump-to-node search over the current model; (re)set on each load so any node
// in a large model is reachable without browsing the tree/cone.
let jumpTo: ((query: string, advance?: boolean) => void) | null = null;
// Cycling state: the query the current match list was built for, that list, and
// where in it we are. Re-submitting the same query advances `searchPos`.
let searchQuery = '';
let searchMatches: ModelNode[] = [];
let searchPos = 0;

// Enter is what steps through matches — `change` alone can't, because the browser
// doesn't fire it when the value hasn't been edited, so a second Enter on the
// same query was silently doing nothing. `change` still handles the paths Enter
// doesn't cover (picking a suggestion with the mouse, committing on blur), and
// only re-selects the current match, so the two firing for one Enter is harmless.
nodeSearch.addEventListener('keydown', (ev) => {
  if (ev.key !== 'Enter') return;
  ev.preventDefault();
  jumpTo?.(nodeSearch.value, true);
});
nodeSearch.addEventListener('change', () => jumpTo?.(nodeSearch.value));
// Narrow the autocomplete suggestions to what actually matches, so a node far
// down a large model still shows up (the capped list is in model order).
// Debounced: matching scans every node, which shouldn't run on each keystroke of
// a model with thousands of them.
const SUGGEST_DELAY_MS = 120;
let suggestTimer = 0;
nodeSearch.addEventListener('input', () => {
  clearTimeout(suggestTimer);
  suggestTimer = window.setTimeout(() => {
    if (!currentModel || !currentIndex) return;
    const q = nodeSearch.value.trim();
    fillSuggestions(q ? findMatches(currentModel.nodes, currentIndex.byId, q) : currentModel.nodes);
  }, SUGGEST_DELAY_MS);
});

// A monotonic token guards against out-of-order async loads (a slow sample fetch
// or a slow worker parse resolving after a newer selection): only the latest
// wins. It also tags each parse request so the worker's reply can be matched.
let loadToken = 0;
/** Per in-flight token: the filename (the worker reports only the failure
 *  reason, not what was being parsed) and which bundled sample the source came
 *  from, if any. */
const pending = new Map<number, { filename: string; sample: string | null }>();

// Parsing runs in a worker so a large or pathological file can't hang the tab.
const parseWorker = new Worker(new URL('./adapters/parse.worker.js', import.meta.url), { type: 'module' });
/** Set by the worker's one-shot ready message. Until it arrives, an unanswered
 *  parse means the worker never started rather than a slow model. */
let workerReady = false;
parseWorker.onmessage = (e: MessageEvent<ParseMessage>) => {
  const res = e.data;
  if ('ready' in res) { workerReady = true; return; }
  // Drop the bookkeeping for EVERY reply, including superseded ones — leaving it
  // to the post-check branch below leaked an entry per superseded load.
  const entry = pending.get(res.id);
  pending.delete(res.id);
  if (res.id !== loadToken) return; // superseded by a newer load; ignore
  const filename = entry?.filename ?? 'model';
  if (res.ok) {
    // The URL may only advertise a sample once that sample has actually parsed —
    // set it here, not when the load was kicked off, or a load that then fails
    // leaves the address bar describing a model that isn't on screen.
    currentSample = entry?.sample ?? null;
    showModel(res.model);
  } else {
    // Keep whatever is on screen: a mistyped paste or a wrongly dropped file
    // shouldn't destroy the model the user was reading (nor its shareable URL,
    // which is why `currentSample` is left untouched here). Only clear if there
    // is nothing to keep.
    if (!currentModel) showEmpty();
    // The reason already says what was wrong (unknown format, JSON syntax, or an
    // adapter's own complaint), so this only supplies which file it was.
    setStatus(`Could not load "${filename}": ${res.error}`
      + `${currentModel ? ' — the loaded model is unchanged.' : ''}`, 'error');
  }
};

/** A worker that never runs would otherwise leave the status on "Parsing…"
 *  forever — and, since the worker is a singleton, every later load too. */
const workerFailed = (detail: string): void => {
  pending.clear();
  if (!currentModel) showEmpty();
  setStatus(`The model parser could not run (${detail}). Reload the page to try again.`, 'error');
};
// Fires for a runtime error inside the worker. Note it does NOT fire in Chrome
// when the worker's module script itself fails to load (blocked by CSP or an
// extension, or a stale chunk URL after a deploy) — hence the watchdog below.
parseWorker.onerror = (ev) => {
  ev.preventDefault();
  workerFailed(ev.message || 'worker error');
};
parseWorker.onmessageerror = () => workerFailed('the parsed model could not be transferred');

/** How long to wait for a worker that has never reported ready before calling it
 *  dead. Only ever consulted when `workerReady` is false, so a genuinely slow
 *  parse of a huge model is never interrupted by it. */
const WORKER_START_TIMEOUT_MS = 8000;

/** Hand source to the worker under `token`, unless a newer load has started.
 *  `sample` is the registry value when this source came from a bundled sample. */
function dispatchParse(token: number, filename: string, source: string, sample: string | null): void {
  if (token !== loadToken) return;
  pending.set(token, { filename, sample });
  setStatus(`Parsing ${filename}…`);
  parseWorker.postMessage({ id: token, filename, source } satisfies ParseRequest);
  if (workerReady) return;
  window.setTimeout(() => {
    // Still no handshake and this request is still outstanding: the worker never
    // came up, so say so instead of leaving "Parsing…" on screen indefinitely.
    if (!workerReady && pending.has(token)) workerFailed('it did not start');
  }, WORKER_START_TIMEOUT_MS);
}

/** Read a dropped/picked File and parse it, warning first if it's very large. */
function loadFile(file: File): void {
  if (file.size > LARGE_FILE_BYTES) {
    const proceed = window.confirm(
      `"${file.name}" is large (${(file.size / 1e6).toFixed(0)} MB). ` +
      `Loading it may be slow or unresponsive.\n\nProceed anyway?`,
    );
    if (!proceed) {
      setStatus('Load cancelled', 'error');
      return;
    }
  }
  const token = ++loadToken;
  sampleSelect.value = ''; // this load is from a file; clear the sample selection
  setStatus(`Reading ${file.name}…`);
  const reader = new FileReader();
  reader.onload = () => dispatchParse(token, file.name, String(reader.result), null);
  reader.onerror = () => { if (token === loadToken) setStatus(`Could not read ${file.name}`, 'error'); };
  reader.readAsText(file);
}

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  fileInput.value = ''; // clear so re-picking the same file fires `change` again
  if (file) loadFile(file);
});

/** Fetch and load a bundled sample by its registry value. */
async function loadSample(value: string): Promise<void> {
  const path = SAMPLE_PATH.get(value);
  if (!path) return;
  const token = ++loadToken;
  fileInput.value = ''; // this load is from a sample; clear any chosen file
  const name = path.split('/').pop()!;
  setStatus(`Loading sample "${name}"…`);
  try {
    const res = await fetch(import.meta.env.BASE_URL + path);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    // Only samples can be deep-linked (a local file isn't fetchable from a URL);
    // the link is recorded once the parse succeeds.
    dispatchParse(token, name, text, value);
  } catch (err) {
    if (token === loadToken) setStatus(`Could not load sample "${value}": ${(err as Error).message}`, 'error');
  } finally {
    // Reset to the placeholder so re-picking the SAME sample fires `change` again
    // (a dead-click otherwise). The format badge already shows what's loaded.
    sampleSelect.value = '';
  }
}

sampleSelect.addEventListener('change', () => { void loadSample(sampleSelect.value); });

// --- shareable URL ---------------------------------------------------------
// `?sample=<registry value>&node=<id>` restores a view. Only bundled samples can
// be linked — a locally loaded file isn't fetchable from a URL — so a file/paste
// load clears the parameters rather than leaving a link that resolves elsewhere.
function syncUrl(nodeId: string | null): void {
  const url = new URL(location.href);
  if (currentSample) {
    url.searchParams.set('sample', currentSample);
    if (nodeId) url.searchParams.set('node', nodeId); else url.searchParams.delete('node');
  } else {
    url.searchParams.delete('sample');
    url.searchParams.delete('node');
  }
  history.replaceState(null, '', url);
}

// --- drag-and-drop file loading -------------------------------------------
// Accept a file dropped anywhere on the window. An overlay gives the drop a
// visible target; it's shown while a drag carrying files is over the window.
const dropOverlay = $<HTMLElement>('drop-overlay');
const dragHasFiles = (e: DragEvent): boolean => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');
window.addEventListener('dragover', (e) => {
  if (!dragHasFiles(e)) return;
  e.preventDefault(); // required for `drop` to fire
  dropOverlay.hidden = false;
});
// relatedTarget is null only when the pointer leaves the window entirely, so
// dragging over child elements doesn't flicker the overlay off.
window.addEventListener('dragleave', (e) => { if (!e.relatedTarget) dropOverlay.hidden = true; });
window.addEventListener('drop', (e) => {
  if (!dragHasFiles(e)) return;
  e.preventDefault();
  dropOverlay.hidden = true;
  const file = e.dataTransfer?.files?.[0];
  if (file) loadFile(file);
});

// --- paste-to-load ---------------------------------------------------------
// Load model text pasted into a dialog (source that isn't a local file). The
// format is detected from content, so no extension is needed.
const pasteBtn = $<HTMLButtonElement>('paste-btn');
const pasteDialog = $<HTMLDialogElement>('paste-dialog');
const pasteText = $<HTMLTextAreaElement>('paste-text');
pasteBtn.addEventListener('click', () => {
  pasteText.value = '';
  // Clear the previous outcome too: `showModal()` does not reset it, so the close
  // handler below must not be able to see a stale "load" from an earlier visit.
  pasteDialog.returnValue = '';
  pasteDialog.showModal();
  pasteText.focus();
});
pasteDialog.addEventListener('close', () => {
  if (pasteDialog.returnValue !== 'load') return; // Cancel / Esc
  const source = pasteText.value;
  if (!source.trim()) { setStatus('Nothing to load — paste box was empty', 'error'); return; }
  const token = ++loadToken;
  fileInput.value = '';
  sampleSelect.value = '';
  dispatchParse(token, 'pasted model', source, null);
});

// --- responsive pane tabs (shown only on narrow screens via CSS) ----------
const tabs = [...document.querySelectorAll<HTMLButtonElement>('.pane-tab')];
function activatePane(pane: string): void {
  layoutEl.dataset.activePane = pane;
  for (const t of tabs) t.setAttribute('aria-selected', String(t.dataset.pane === pane));
}
for (const tab of tabs) {
  tab.addEventListener('click', () => activatePane(tab.dataset.pane!));
}

// --- resizable panes -------------------------------------------------------
// The side panes were fixed-width, which truncated long node names with no way
// to widen. Each splitter drives a CSS var on .layout; the width is remembered.
type PaneEdge = 'tree' | 'inspector';
const PANE_VAR: Record<PaneEdge, string> = { tree: '--tree-w', inspector: '--insp-w' };
const PANE_KEY: Record<PaneEdge, string> = { tree: 'mv-tree-w', inspector: 'mv-insp-w' };
const PANE_DEFAULT: Record<PaneEdge, number> = { tree: 320, inspector: 380 };
const PANE_MIN = 180;
const PANE_MAX = 720;
const splitters = [...document.querySelectorAll<HTMLElement>('.splitter')];

function paneWidth(edge: PaneEdge): number {
  return parseInt(layoutEl.style.getPropertyValue(PANE_VAR[edge]), 10) || PANE_DEFAULT[edge];
}

function setPaneWidth(edge: PaneEdge, px: number): void {
  const w = Math.round(Math.min(PANE_MAX, Math.max(PANE_MIN, px)));
  layoutEl.style.setProperty(PANE_VAR[edge], `${w}px`);
  splitters.find((s) => s.dataset.edge === edge)?.setAttribute('aria-valuenow', String(w));
  try { globalThis.localStorage?.setItem(PANE_KEY[edge], String(w)); } catch { /* private mode */ }
}

for (const edge of ['tree', 'inspector'] as PaneEdge[]) {
  const saved = Number(globalThis.localStorage?.getItem(PANE_KEY[edge]));
  if (Number.isFinite(saved) && saved > 0) setPaneWidth(edge, saved);
}

for (const sep of splitters) {
  const edge = sep.dataset.edge as PaneEdge;
  sep.addEventListener('pointerdown', (ev) => {
    ev.preventDefault(); // don't start a text selection or a native drag
    sep.dataset.dragging = 'true';
    sep.setPointerCapture?.(ev.pointerId);
    document.body.style.userSelect = 'none';
  });
  sep.addEventListener('pointermove', (ev) => {
    if (!sep.dataset.dragging) return;
    const box = layoutEl.getBoundingClientRect();
    // The inspector is measured from the right edge, so its width grows as the
    // pointer moves left.
    setPaneWidth(edge, edge === 'tree' ? ev.clientX - box.left : box.right - ev.clientX);
  });
  const endDrag = (ev: PointerEvent): void => {
    if (!sep.dataset.dragging) return;
    delete sep.dataset.dragging;
    sep.releasePointerCapture?.(ev.pointerId);
    document.body.style.userSelect = '';
  };
  sep.addEventListener('pointerup', endDrag);
  sep.addEventListener('pointercancel', endDrag);
  // Keyboard resizing, per the ARIA separator pattern.
  sep.addEventListener('keydown', (ev) => {
    const step = ev.shiftKey ? 48 : 16;
    const grow = edge === 'tree' ? 'ArrowRight' : 'ArrowLeft';
    const shrink = edge === 'tree' ? 'ArrowLeft' : 'ArrowRight';
    if (ev.key === grow) { ev.preventDefault(); setPaneWidth(edge, paneWidth(edge) + step); }
    else if (ev.key === shrink) { ev.preventDefault(); setPaneWidth(edge, paneWidth(edge) - step); }
    else if (ev.key === 'Home') { ev.preventDefault(); setPaneWidth(edge, PANE_DEFAULT[edge]); }
  });
}

// --- global keyboard shortcuts ---------------------------------------------
// "/" jumps to the node search from anywhere (it was mouse-only); Escape leaves
// it. Typing in a field or dialog is never hijacked.
document.addEventListener('keydown', (ev) => {
  const target = ev.target as HTMLElement | null;
  const typing = !!target
    && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA'
      || target.tagName === 'SELECT' || target.isContentEditable);
  if (ev.key === '/' && !typing && !ev.metaKey && !ev.ctrlKey && !ev.altKey) {
    if (nodeSearch.disabled) return;
    ev.preventDefault();
    nodeSearch.focus();
    nodeSearch.select();
  } else if (ev.key === 'Escape' && target === nodeSearch) {
    nodeSearch.value = '';
    nodeSearch.blur();
  }
});

// --- startup ---------------------------------------------------------------
showEmpty();
// Restore a linked view (?sample=…&node=…) if present, else invite a load.
const startUrl = new URL(location.href);
const linkedSample = startUrl.searchParams.get('sample');
const linkedNode = startUrl.searchParams.get('node');
if (linkedSample && SAMPLE_PATH.has(linkedSample)) {
  pendingNodeId = linkedNode;
  void loadSample(linkedSample);
} else {
  if (linkedSample) setStatus(`Unknown sample "${linkedSample}" in the link — pick one from the list.`, 'error');
  else setStatus('Load a model file, or pick a bundled sample. Press / to search nodes.');
}
