/** Detail panel for a selected node: fields, edges (clickable), diagnostics, raw. */
import {
  dependencyEdges,
  dependentEdges,
  outputEdges,
  type Model,
  type ModelNode,
  type ModelEdge,
  type ModelIndex,
} from '../model/index.js';
import { el, clear, kindBadge } from './dom.js';
import { summarizeValue } from './format.js';

/** Arrays longer than this are truncated in the raw dump to keep it responsive. */
const RAW_ARRAY_CAP = 100;

/** Remembers whether the "Raw source" section is expanded, so it stays open as
 * the user clicks between nodes (the inspector rebuilds on each selection). */
let rawSourceOpen = false;

/** Per-model index of diagnostics by node id, built once and reused across the
 * many per-click inspector rebuilds (was a full O(D) scan on every selection). */
const diagsByModel = new WeakMap<Model, Map<string, Model['diagnostics']>>();
function diagnosticsFor(model: Model, nodeId: string): Model['diagnostics'] {
  let byNode = diagsByModel.get(model);
  if (!byNode) {
    byNode = new Map();
    for (const d of model.diagnostics) {
      if (d.nodeId === undefined) continue;
      const list = byNode.get(d.nodeId);
      if (list) list.push(d); else byNode.set(d.nodeId, [d]);
    }
    diagsByModel.set(model, byNode);
  }
  return byNode.get(nodeId) ?? [];
}

export function renderInspector(
  model: Model,
  index: ModelIndex,
  node: ModelNode,
  host: HTMLElement,
  onNavigate: (id: string) => void,
): void {
  clear(host);

  const header = el('div', { class: 'insp-header' }, [
    kindBadge(node.kind),
    el('h2', {}, [node.blockName]),
    node.id !== node.blockName && el('code', { class: 'insp-id' }, [`id: ${node.id}`]),
  ]);
  host.append(header);

  const fields = el('dl', { class: 'insp-fields' });
  const addField = (k: string, v: string): void => {
    fields.append(el('dt', {}, [k]), el('dd', {}, [v]));
  };
  addField('type', node.type);
  if (node.synthetic) addField('origin', `synthesized (${node.kind})`);
  if (node.description) addField('description', node.description);
  if (node.values !== undefined) addField('values', summarizeValue(node.values, 12));
  host.append(fields);

  const edgeList = (title: string, edges: ModelEdge[], dir: 'to' | 'from'): void => {
    if (edges.length === 0) return;
    const ul = el('ul', { class: 'insp-edges' });
    for (const e of edges) {
      const otherId = dir === 'to' ? e.to : e.from;
      const other = index.byId.get(otherId);
      const link = el('button', { class: 'xref', type: 'button' }, [
        `${e.port} — ${other?.blockName ?? otherId}`,
      ]);
      link.addEventListener('click', () => onNavigate(otherId));
      ul.append(el('li', { dataset: { role: e.role } }, [link]));
    }
    host.append(el('h3', {}, [title]), ul);
  };

  edgeList('Depends on', dependencyEdges(index, node.id), 'to');
  edgeList('Produces', outputEdges(index, node.id), 'to');
  edgeList('Used by', dependentEdges(index, node.id), 'from');

  const diags = diagnosticsFor(model, node.id);
  if (diags.length > 0) {
    const ul = el('ul', { class: 'insp-diags' });
    for (const d of diags) ul.append(el('li', { dataset: { level: d.level } }, [d.msg]));
    host.append(el('h3', {}, ['Diagnostics']), ul);
  }

  const raw = el('details', { class: 'insp-raw', open: rawSourceOpen }, [
    el('summary', {}, ['Raw source']),
    el('pre', {}, [JSON.stringify(node.raw, capArrays, 2)]),
  ]);
  raw.addEventListener('toggle', () => { rawSourceOpen = raw.open; });
  host.append(raw);
}

/** JSON.stringify replacer: truncate large arrays so the raw dump stays cheap. */
function capArrays(_key: string, value: unknown): unknown {
  if (Array.isArray(value) && value.length > RAW_ARRAY_CAP) {
    return [...value.slice(0, RAW_ARRAY_CAP), `… ${value.length - RAW_ARRAY_CAP} more`];
  }
  return value;
}
