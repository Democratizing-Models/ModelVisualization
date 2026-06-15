/** App entry: load a model (file or bundled sample), render tree + dag + inspector. */
import { detectAndParse, REGISTRY } from './adapters/detect.js';
import { renderTree } from './render/tree.js';
import { renderInspector } from './render/inspector.js';
import { initTheme } from './render/theme.js';
import { clear } from './render/dom.js';
import { buildIndex, computeRoots, findNode, type Model, type SourceFormat } from './model/index.js';
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
const layoutEl = document.querySelector<HTMLElement>('.layout')!;

/** Max autocomplete suggestions to put in the datalist (full search still scans
 *  all nodes; this only bounds the suggestion DOM for very large models). */
const SEARCH_SUGGESTIONS = 1000;

initTheme($<HTMLButtonElement>('theme-toggle'));

/** Reject files larger than this before reading, to avoid hanging the tab. */
const MAX_FILE_BYTES = 50 * 1024 * 1024;

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

/** Centred placeholder shown in an empty pane. */
function emptyState(pane: HTMLElement, msg: string): void {
  clear(pane);
  const p = document.createElement('p');
  p.className = 'empty-state';
  p.textContent = msg;
  pane.append(p);
}

function showEmpty(): void {
  badge.hidden = true;
  nodeSearch.disabled = true;
  nodeSearch.value = '';
  searchList.replaceChildren();
  jumpTo = null;
  emptyState(treePane, 'No model loaded.');
  emptyState(dagPane, 'No model loaded — choose a sample above or load a .hs3 file. Click any node to inspect it; selection syncs across all panes.');
  emptyState(inspectorPane, 'Select a node to inspect.');
}

function showModel(model: Model): void {
  badge.hidden = false;
  badge.textContent = FORMAT_LABEL[model.format];

  // One index per model, shared by tree, dag and inspector (no per-click rebuilds).
  const index = buildIndex(model);
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
  };

  const initial = roots[0]?.id ?? model.nodes[0]?.id ?? '';
  // User-driven selections also surface the inspector — on narrow (tabbed)
  // screens that gives visible feedback for a tap; on wide screens every pane is
  // shown regardless, so it's a no-op there.
  const userSelect = (id: string): void => { select(id); activatePane('inspector'); };
  tree = renderTree(model, index, treePane, (node) => userSelect(node.id), roots);
  dag = renderDag(index, dagPane, initial, (node) => userSelect(node.id));

  // Enable jump-to-node search and seed autocomplete suggestions. Search is the
  // primary way to reach a node in a large model that the cone/capped tree hide.
  searchList.replaceChildren();
  const frag = document.createDocumentFragment();
  for (const n of model.nodes.slice(0, SEARCH_SUGGESTIONS)) {
    frag.append(new Option(n.blockName));
  }
  searchList.append(frag);
  nodeSearch.disabled = model.nodes.length === 0;
  nodeSearch.value = '';
  jumpTo = (query: string): void => {
    if (!query.trim()) return;
    const match = findNode(model.nodes, index.byId, query);
    if (match) { userSelect(match.id); setStatus(`Focused "${match.blockName}"`); }
    else setStatus(`No node matching "${query.trim()}"`, 'error');
  };

  const errors = model.diagnostics.filter((d) => d.level === 'error').length;
  const warns = model.diagnostics.filter((d) => d.level === 'warn').length;
  const diagText = errors || warns ? ` — ${errors} error(s), ${warns} warning(s)` : '';
  setStatus(`${FORMAT_LABEL[model.format]}: ${model.nodes.length} nodes, ${model.edges.length} edges${diagText}`,
    errors ? 'error' : 'info');

  // Bootstrap the shared selection so the tree highlight, inspector, and DAG all
  // open on the same default node instead of an empty inspector.
  if (initial) {
    select(initial);
  } else {
    emptyState(inspectorPane, 'Select a node to inspect.');
  }
}

function load(filename: string, source: string): void {
  try {
    showModel(detectAndParse(filename, source));
  } catch (err) {
    showEmpty();
    setStatus(`Couldn't parse "${filename}" — expected an HS3 JSON model. (${(err as Error).message})`, 'error');
  }
}

// Jump-to-node search over the current model; (re)set on each load so any node
// in a large model is reachable without browsing the tree/cone.
let jumpTo: ((query: string) => void) | null = null;

nodeSearch.addEventListener('change', () => jumpTo?.(nodeSearch.value));

// A monotonic token guards against out-of-order async loads (a slow sample fetch
// resolving after a newer file/sample selection): only the latest wins.
let loadToken = 0;

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  if (file.size > MAX_FILE_BYTES) {
    setStatus(`"${file.name}" is too large (${(file.size / 1e6).toFixed(0)} MB; limit ${MAX_FILE_BYTES / 1e6} MB)`, 'error');
    return;
  }
  const token = ++loadToken;
  sampleSelect.value = ''; // this load is from a file; clear the sample selection
  setStatus(`Reading ${file.name}…`);
  const reader = new FileReader();
  reader.onload = () => { if (token === loadToken) load(file.name, String(reader.result)); };
  reader.onerror = () => { if (token === loadToken) setStatus(`Could not read ${file.name}`, 'error'); };
  reader.readAsText(file);
});

sampleSelect.addEventListener('change', async () => {
  const path = SAMPLE_PATH.get(sampleSelect.value);
  if (!path) return;
  const token = ++loadToken;
  fileInput.value = ''; // this load is from a sample; clear any chosen file
  const value = sampleSelect.value;
  const name = path.split('/').pop()!;
  setStatus(`Loading sample "${name}"…`);
  try {
    const res = await fetch(import.meta.env.BASE_URL + path);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    if (token === loadToken) load(name, text);
  } catch (err) {
    if (token === loadToken) setStatus(`Could not load sample "${value}": ${(err as Error).message}`, 'error');
  } finally {
    // Reset to the placeholder so re-picking the SAME sample fires `change` again
    // (a dead-click otherwise). The format badge already shows what's loaded.
    sampleSelect.value = '';
  }
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

showEmpty();
setStatus('Load an HS3 model file, or pick a bundled sample.');
