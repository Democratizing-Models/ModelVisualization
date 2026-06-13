/**
 * Bounded neighborhood ("cone") extraction around a focus node. Pure and
 * format-agnostic: operates only on the IR's ModelIndex adjacency. The cone is
 * the undirected neighborhood of the focus — every node fans out along BOTH its
 * dependencies and its dependents — up to `hops` deep, capped at `nodeCap`
 * nodes, so siblings reachable through a shared dependent appear (e.g. from
 * `likelihood`, its dependent `analysis` pulls in `analysis`'s other dependency
 * `default_domain`). Cycle-safe via a visited set; the subgraph stays small
 * regardless of total model size.
 *
 * `depth` is signed by the direction of the FIRST hop on the path from the
 * focus (<0 reached via a dependency, >0 via a dependent); deeper nodes inherit
 * their branch's sign. The cone follows dependency/dependent edges only
 * (`input`/`call` roles); `output`-role adjacency is out of scope for v1 and is
 * not counted in `hidden`. When `nodeCap` truncates, nearer nodes are kept.
 */
import {
  dependencyEdges,
  dependentEdges,
  type ModelIndex,
  type ModelNode,
  type ModelEdge,
} from '../model/index.js';

export interface ConeOpts {
  /** Max edges to traverse outward from the focus in each direction. */
  hops?: number;
  /** Max nodes (including the focus) to include. */
  nodeCap?: number;
}

export interface Subgraph {
  focusId: string;
  nodes: ModelNode[];
  edges: ModelEdge[];
  /** Signed distance from the focus: <0 upstream (dependencies), >0 downstream. */
  depth: Map<string, number>;
  /** Per node: count of adjacent nodes present in the full graph but excluded here. */
  hidden: Map<string, number>;
}

const DEFAULTS = { hops: 2, nodeCap: 80 } as const;

export function extractCone(index: ModelIndex, focusId: string, opts: ConeOpts = {}): Subgraph {
  const hops = opts.hops ?? DEFAULTS.hops;
  const nodeCap = opts.nodeCap ?? DEFAULTS.nodeCap;

  const depth = new Map<string, number>();
  const focus = index.byId.get(focusId);
  if (!focus) {
    return { focusId, nodes: [], edges: [], depth, hidden: new Map() };
  }
  depth.set(focusId, 0);

  // Single breadth-first queue over the UNDIRECTED neighborhood: every node
  // fans out along both its dependencies and its dependents, so siblings reached
  // through a shared dependent are included. `dir` is the sign of the first hop
  // from the focus and is inherited by deeper nodes (for depth orientation only;
  // the layout re-derives true direction from the edges). nodeCap is shared
  // fairly and nearer nodes win on truncation (BFS order).
  type Dir = -1 | 1;
  const neighborsOf = (id: string): string[] => [
    ...dependencyEdges(index, id).map((e) => e.to),
    ...dependentEdges(index, id).map((e) => e.from),
  ];
  const queue: Array<{ id: string; dir: Dir; dist: number }> = [];
  const enqueue = (id: string, dir: Dir, dist: number): void => {
    if (dist > hops || depth.has(id) || depth.size >= nodeCap) return;
    depth.set(id, dir * dist);
    queue.push({ id, dir, dist });
  };
  for (const t of dependencyEdges(index, focusId).map((e) => e.to)) enqueue(t, -1, 1);
  for (const f of dependentEdges(index, focusId).map((e) => e.from)) enqueue(f, +1, 1);
  for (let i = 0; i < queue.length; i++) {
    const { id, dir, dist } = queue[i];
    for (const n of neighborsOf(id)) enqueue(n, dir, dist + 1);
  }

  const included = new Set(depth.keys());
  const nodes: ModelNode[] = [];
  for (const id of included) {
    const n = index.byId.get(id);
    if (n) nodes.push(n);
  }

  const edges: ModelEdge[] = [];
  const hidden = new Map<string, number>();
  for (const id of included) {
    let hide = 0;
    for (const e of dependencyEdges(index, id)) {
      if (included.has(e.to)) edges.push(e);
      else hide++;
    }
    for (const e of dependentEdges(index, id)) {
      if (!included.has(e.from)) hide++;
    }
    if (hide > 0) hidden.set(id, hide);
  }

  return { focusId, nodes, edges, depth, hidden };
}
