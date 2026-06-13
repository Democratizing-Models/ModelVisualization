/**
 * Semantic validation pass — deliberately separate from assembly (`build()`),
 * so the parse → resolve → validate phases have a real seam (and richer
 * validation levels can be added here later without touching the adapters).
 *
 * Appends diagnostics to `model.diagnostics`; does not mutate the graph.
 */
import type { Model } from './types.js';
import { findCycles } from './graph.js';

export function validate(model: Model): void {
  const ids = new Set(model.nodes.map((n) => n.id));

  for (const e of model.edges) {
    // A reference graph must be acyclic; self-dependency is the degenerate cycle.
    if (e.from === e.to && e.role !== 'output') {
      model.diagnostics.push({
        level: 'error',
        code: 'self-dependency',
        msg: `"${e.from}" depends on itself via "${e.port}"`,
        nodeId: e.from,
      });
    }
    // Edges should resolve to a real node (adapters synthesize, so this is a guard).
    if (!ids.has(e.to)) {
      model.diagnostics.push({
        level: 'warn',
        code: 'dangling-ref',
        msg: `Reference "${e.port}" from "${e.from}" does not resolve to a node ("${e.to}")`,
        nodeId: e.from,
      });
    }
  }

  for (const id of findCycles(model)) {
    model.diagnostics.push({
      level: 'error',
      code: 'cycle',
      msg: `Cycle detected involving "${id}" — model is not a DAG`,
      nodeId: id,
    });
  }
}
