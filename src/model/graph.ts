/**
 * Graph operations over a `Model`. Format-agnostic, reused by every consumer
 * (tree, inspector; a graph view later). Dependency direction: an `input`/`call`
 * edge `A → B` means "A depends on B".
 *
 * All adjacency lookups go through a `ModelIndex` built once per model in a
 * single O(N+E) pass — callers must NOT re-scan `model.edges` per node.
 */
import type { Model, ModelNode, ModelEdge, EdgeRole } from './types.js';

const DEPENDENCY_ROLES: ReadonlySet<EdgeRole> = new Set(['input', 'call']);

/** Precomputed adjacency for O(1) lookups. Build once with `buildIndex`. */
export interface ModelIndex {
  byId: Map<string, ModelNode>;
  /** node id → its dependency edges (input/call), i.e. what it depends on. */
  deps: Map<string, ModelEdge[]>;
  /** node id → edges by which others depend on it. */
  dependents: Map<string, ModelEdge[]>;
  /** node id → its output edges (what it produces/exposes). */
  outputs: Map<string, ModelEdge[]>;
}

const push = (m: Map<string, ModelEdge[]>, key: string, e: ModelEdge): void => {
  const list = m.get(key);
  if (list) list.push(e);
  else m.set(key, [e]);
};

export function buildIndex(model: Model): ModelIndex {
  const byId = new Map<string, ModelNode>();
  for (const n of model.nodes) byId.set(n.id, n);

  const deps = new Map<string, ModelEdge[]>();
  const dependents = new Map<string, ModelEdge[]>();
  const outputs = new Map<string, ModelEdge[]>();
  for (const e of model.edges) {
    if (e.role === 'output') {
      // An output edge producer→product is kept verbatim for the inspector's
      // "Produces" view, AND contributes a dependency the other way round: the
      // product depends on its producer (to obtain the product you must run the
      // producer). Storing the reversed edge in deps/dependents lets the cone,
      // layout, and root logic traverse data-flow uniformly (producer above
      // product), instead of treating outputs as a dead end.
      push(outputs, e.from, e);
      const rev: ModelEdge = { from: e.to, to: e.from, role: e.role, port: e.port };
      push(deps, rev.from, rev);
      push(dependents, rev.to, rev);
    } else {
      push(deps, e.from, e);
      push(dependents, e.to, e);
    }
  }
  return { byId, deps, dependents, outputs };
}

export const dependencyEdges = (index: ModelIndex, id: string): ModelEdge[] => index.deps.get(id) ?? [];
export const dependentEdges = (index: ModelIndex, id: string): ModelEdge[] => index.dependents.get(id) ?? [];
export const outputEdges = (index: ModelIndex, id: string): ModelEdge[] => index.outputs.get(id) ?? [];

/**
 * Forest roots. Nodes nothing depends on are the structural roots; the adapter's
 * `model.roots` entry-point hint (e.g. HS3 analyses) is surfaced FIRST without
 * excluding the rest, so hint-only rooting cannot hide structurally-reachable
 * nodes the hint omits.
 */
export function computeRoots(model: Model, index: ModelIndex): ModelNode[] {
  // A node is structural-root if nothing *else* depends on it. A self-edge
  // (a→a) must not disqualify it; nor must a reversed `output` edge — a pure
  // producer (e.g. an XS3 workspace that only emits outputs) should still root
  // the forest rather than be buried under what it produces.
  const structural = model.nodes.filter((n) => {
    const back = index.dependents.get(n.id);
    return !back || back.every((e) => e.from === n.id || e.role === 'output');
  });
  const base = structural.length > 0 ? structural : model.nodes;

  const hinted = model.roots.filter((id) => index.byId.has(id));
  if (hinted.length === 0) return base;

  const hintSet = new Set(hinted);
  const ordered = [
    ...hinted.map((id) => index.byId.get(id)!),
    ...base.filter((n) => !hintSet.has(n.id)),
  ];
  return ordered;
}

/**
 * Find cycle entry points in the dependency graph. Pure (no mutation): returns
 * the ids where a back-edge was found, so the validation pass owns diagnostics.
 * Iterative DFS — no native recursion, so deep chains can't overflow the stack.
 */
export function findCycles(model: Model): string[] {
  const adj = new Map<string, string[]>();
  for (const n of model.nodes) adj.set(n.id, []);
  for (const e of model.edges) {
    if (DEPENDENCY_ROLES.has(e.role) && adj.has(e.from)) adj.get(e.from)!.push(e.to);
  }

  const UNVISITED = 0, ON_STACK = 1, DONE = 2;
  const state = new Map<string, number>();
  for (const id of adj.keys()) state.set(id, UNVISITED);
  const cycleEntries = new Set<string>();

  for (const start of adj.keys()) {
    if (state.get(start) !== UNVISITED) continue;
    const stack: Array<{ id: string; i: number }> = [{ id: start, i: 0 }];
    state.set(start, ON_STACK);
    while (stack.length > 0) {
      const top = stack[stack.length - 1];
      const neighbors = adj.get(top.id)!;
      if (top.i < neighbors.length) {
        const next = neighbors[top.i++];
        if (!adj.has(next)) continue;
        const s = state.get(next);
        if (s === ON_STACK) cycleEntries.add(next);
        else if (s === UNVISITED) {
          state.set(next, ON_STACK);
          stack.push({ id: next, i: 0 });
        }
      } else {
        state.set(top.id, DONE);
        stack.pop();
      }
    }
  }
  return [...cycleEntries];
}
