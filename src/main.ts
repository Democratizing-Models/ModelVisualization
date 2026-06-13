/** App entry: load a model (file or bundled sample), render tree + dag + inspector. */
import { detectAndParse, REGISTRY } from './adapters/detect.js';
import { renderTree } from './render/tree.js';
import { renderInspector } from './render/inspector.js';
import { initTheme } from './render/theme.js';
import { clear } from './render/dom.js';
import { buildIndex, computeRoots, type Model, type SourceFormat } from './model/index.js';
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

initTheme($<HTMLButtonElement>('theme-toggle'));

// Labels and sample list are derived from the format registry — adding a format
// is a single registry entry, with no edits here.
const FORMAT_LABEL = Object.fromEntries(REGISTRY.map((d) => [d.format, d.label])) as Record<SourceFormat, string>;
const SAMPLE_PATH = new Map(REGISTRY.map((d) => [d.sample.value, d.sample.path]));
for (const d of REGISTRY) {
  sampleSelect.append(new Option(d.sample.label, d.sample.value));
}

function setStatus(msg: string, level: 'info' | 'error' = 'info'): void {
  statusEl.textContent = msg;
  statusEl.dataset.level = level;
}

function showModel(model: Model): void {
  badge.hidden = false;
  badge.textContent = FORMAT_LABEL[model.format];

  // One index per model, shared by tree, dag and inspector (no per-click rebuilds).
  const index = buildIndex(model);

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

  tree = renderTree(model, index, treePane, (node) => select(node.id));
  dag = renderDag(index, dagPane, defaultFocus(model, index), (node) => select(node.id));

  const errors = model.diagnostics.filter((d) => d.level === 'error').length;
  const warns = model.diagnostics.filter((d) => d.level === 'warn').length;
  const diagText = errors || warns ? ` — ${errors} error(s), ${warns} warning(s)` : '';
  setStatus(`${FORMAT_LABEL[model.format]}: ${model.nodes.length} nodes, ${model.edges.length} edges${diagText}`,
    errors ? 'error' : 'info');

  // Bootstrap the shared selection so the tree highlight, inspector, and DAG all
  // open on the same default node instead of an empty inspector.
  const initial = defaultFocus(model, index);
  if (initial) {
    select(initial);
  } else {
    clear(inspectorPane);
    inspectorPane.textContent = 'Select a node to inspect.';
  }
}

/** First entry-point hint, else the first structural root, else the first node. */
function defaultFocus(model: Model, index: ReturnType<typeof buildIndex>): string {
  const roots = computeRoots(model, index);
  return roots[0]?.id ?? model.nodes[0]?.id ?? '';
}

function load(filename: string, source: string): void {
  try {
    showModel(detectAndParse(filename, source));
  } catch (err) {
    setStatus((err as Error).message, 'error');
  }
}

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => load(file.name, String(reader.result));
  reader.onerror = () => setStatus(`Could not read ${file.name}`, 'error');
  reader.readAsText(file);
});

sampleSelect.addEventListener('change', async () => {
  const path = SAMPLE_PATH.get(sampleSelect.value);
  if (!path) return;
  try {
    const res = await fetch(import.meta.env.BASE_URL + path);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    load(path.split('/').pop()!, await res.text());
  } catch (err) {
    setStatus(`Could not load sample "${sampleSelect.value}": ${(err as Error).message}`, 'error');
  }
});

setStatus('Load an HS3 model file, or pick a bundled sample.');
