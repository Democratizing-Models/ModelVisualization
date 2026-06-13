/**
 * Pure layered (Sugiyama-lite) layout for a bounded Subgraph. Format-agnostic:
 * consumes only the cone. Flow reads top→bottom: each node sits one row below
 * its deepest dependency (longest path from the leaves), so dependencies are
 * always above the nodes that consume them. Pure-source nodes are pulled DOWN to
 * just above their shallowest consumer to keep edges short. Ordering + coordinate
 * sweeps reduce crossings and keep balanced sub-DAGs symmetric. Edges are routed
 * by an octilinear A* router (see route.ts) so they take a short path around the
 * node boxes. No DOM.
 */
import type { Subgraph } from './cone.js';
import { makeRouter, type Rect } from './route.js';

const NODE_W = 150;
const NODE_H = 34;
const H_GAP = 28;
const V_GAP = 48;
const PAD = 20;
const SPACING = NODE_W + H_GAP; // minimum distance between node centres
const ROW = NODE_H + V_GAP;     // distance between row tops
const STUB = 16;                // straight stub out of a node before routing

export interface PositionedNode {
  id: string; x: number; y: number; w: number; h: number;
  kind: string; label: string; isFocus: boolean; hidden: number;
}
export interface PositionedEdge {
  from: string; to: string; role: string; port: string;
  points: Array<{ x: number; y: number }>;
}
export interface PositionedGraph {
  nodes: PositionedNode[]; edges: PositionedEdge[]; width: number; height: number;
}

export function layoutDag(sub: Subgraph): PositionedGraph {
  const idSet = new Set(sub.nodes.map((n) => n.id));
  const edges = sub.edges.filter((e) => idSet.has(e.from) && idSet.has(e.to));

  // outAdj[node] = its dependencies (edge from→to); depAdj[node] = its dependents.
  const outAdj = new Map<string, string[]>();
  const depAdj = new Map<string, string[]>();
  const nbr = new Map<string, string[]>();
  for (const n of sub.nodes) { outAdj.set(n.id, []); depAdj.set(n.id, []); nbr.set(n.id, []); }
  for (const e of edges) {
    outAdj.get(e.from)!.push(e.to);
    depAdj.get(e.to)!.push(e.from);
    nbr.get(e.from)!.push(e.to);
    nbr.get(e.to)!.push(e.from);
  }

  // Layer = longest dependency chain below a node (leaves at row 0). Memoized
  // DFS; a cycle back-edge counts as a leaf so cyclic input still terminates.
  const layer = new Map<string, number>();
  const onStack = new Set<string>();
  const layerOf = (id: string): number => {
    const cached = layer.get(id);
    if (cached !== undefined) return cached;
    if (onStack.has(id)) return 0;
    onStack.add(id);
    let l = 0;
    for (const dep of outAdj.get(id)!) l = Math.max(l, layerOf(dep) + 1);
    onStack.delete(id);
    layer.set(id, l);
    return l;
  };
  for (const n of sub.nodes) layerOf(n.id);

  // Pull pure-source nodes (no dependencies) down to just above their shallowest
  // consumer, so e.g. obsData sits one row above likelihood rather than at the
  // top with a long edge crossing the rows between.
  for (const n of sub.nodes) {
    if (outAdj.get(n.id)!.length === 0 && depAdj.get(n.id)!.length > 0) {
      const nearest = Math.min(...depAdj.get(n.id)!.map((d) => layer.get(d)!));
      layer.set(n.id, Math.max(0, nearest - 1));
    }
  }

  const maxLayer = Math.max(0, ...[...layer.values()]);
  const layers: string[][] = Array.from({ length: maxLayer + 1 }, () => []);
  for (const n of sub.nodes) layers[layer.get(n.id)!].push(n.id);
  for (const ids of layers) ids.sort((a, b) => a.localeCompare(b)); // deterministic seed

  const mean = (xs: number[]): number => xs.reduce((s, v) => s + v, 0) / xs.length;

  // Ordering sweeps reduce crossings: order each layer by the mean position of
  // its neighbours in an adjacent reference layer (order only).
  const orderIndex = new Map<string, number>();
  layers.forEach((ids) => ids.forEach((id, i) => orderIndex.set(id, i)));
  const orderByRef = (ids: string[], refLayer: number): void => {
    if (ids.length < 2) return;
    const keyed = ids.map((id) => {
      const refs = nbr.get(id)!.filter((m) => layer.get(m) === refLayer);
      return { id, b: refs.length ? mean(refs.map((m) => orderIndex.get(m)!)) : orderIndex.get(id)! };
    });
    keyed.sort((p, q) => p.b - q.b || p.id.localeCompare(q.id));
    ids.splice(0, ids.length, ...keyed.map((k) => k.id));
    ids.forEach((id, i) => orderIndex.set(id, i));
  };
  for (let k = 0; k < 4; k++) {
    for (let l = 1; l <= maxLayer; l++) orderByRef(layers[l], l - 1);
    for (let l = maxLayer - 1; l >= 0; l--) orderByRef(layers[l], l + 1);
  }

  // Coordinate assignment (centre x). Centre each node over its neighbours in the
  // adjacent layer; resolve overlaps by enforcing spacing then recentering the
  // row's centroid on the desired mean (symmetry for balanced sub-DAGs).
  const cx = new Map<string, number>();
  for (const ids of layers) ids.forEach((id, i) => cx.set(id, i * SPACING));
  const alignLayer = (ids: string[], refLayer: number): void => {
    if (ids.length === 0) return;
    const want = ids.map((id) => {
      const refs = nbr.get(id)!.filter((m) => layer.get(m) === refLayer);
      return refs.length ? mean(refs.map((m) => cx.get(m)!)) : cx.get(id)!;
    });
    const placed = want.slice();
    for (let i = 1; i < placed.length; i++) placed[i] = Math.max(placed[i], placed[i - 1] + SPACING);
    const shift = mean(want) - mean(placed);
    ids.forEach((id, i) => cx.set(id, placed[i] + shift));
  };
  for (let k = 0; k < 4; k++) {
    for (let l = 1; l <= maxLayer; l++) alignLayer(layers[l], l - 1);
    for (let l = maxLayer - 1; l >= 0; l--) alignLayer(layers[l], l + 1);
  }

  // Normalise so the leftmost node's left edge sits at PAD.
  const minC = Math.min(...[...cx.values()]);
  const dx = PAD + NODE_W / 2 - minC;
  for (const [id, v] of cx) cx.set(id, v + dx);

  const rowTop = (id: string): number => PAD + layer.get(id)! * ROW;

  const nodes: PositionedNode[] = sub.nodes.map((n) => ({
    id: n.id,
    x: cx.get(n.id)! - NODE_W / 2,
    y: rowTop(n.id),
    w: NODE_W, h: NODE_H,
    kind: n.kind, label: n.blockName,
    isFocus: n.id === sub.focusId, hidden: sub.hidden.get(n.id) ?? 0,
  }));

  const width = Math.max(...nodes.map((n) => n.x + n.w), NODE_W) + PAD;
  const height = Math.max(...nodes.map((n) => n.y + n.h), NODE_H) + PAD;

  // Attach each wire near its OTHER end's x, clamped to the MIDDLE THIRD of the
  // node edge and spaced to avoid overlap (order preserved). A wire from a source
  // directly above/below thus lands centrally instead of being pushed to a side.
  const group = (key: (e: typeof edges[number]) => string): Map<string, typeof edges> => {
    const m = new Map<string, typeof edges>();
    for (const e of edges) { const k = key(e); const l = m.get(k); if (l) l.push(e); else m.set(k, [e]); }
    return m;
  };
  const assign = (
    groups: Map<string, typeof edges>,
    otherEnd: (e: typeof edges[number]) => number,
    into: Map<typeof edges[number], number>,
  ): void => {
    for (const [id, es] of groups) {
      const c = cx.get(id)!;
      if (es.length === 1) { into.set(es[0], c); continue; }
      const lo = c - NODE_W / 6, hi = c + NODE_W / 6; // middle third
      const gap = (hi - lo) / es.length;
      es.sort((a, b) => otherEnd(a) - otherEnd(b) || a.to.localeCompare(b.to));
      const pos = es.map((e) => Math.min(hi, Math.max(lo, otherEnd(e))));
      for (let i = 1; i < pos.length; i++) pos[i] = Math.max(pos[i], pos[i - 1] + gap);
      const overflow = pos[pos.length - 1] - hi;
      if (overflow > 0) for (let i = 0; i < pos.length; i++) pos[i] -= overflow;
      es.forEach((e, i) => into.set(e, pos[i]));
    }
  };
  const startX = new Map<typeof edges[number], number>();
  const endX = new Map<typeof edges[number], number>();
  assign(group((e) => e.to), (e) => cx.get(e.from)!, startX); // bottom ports near each dependent
  assign(group((e) => e.from), (e) => cx.get(e.to)!, endX);   // top ports near each dependency

  // Route around the node boxes, SHORTEST edges first: short, direct wires claim
  // the central channels before long ones detour (the router's usage penalty
  // makes later edges yield). Results are stored back in the original order.
  const obstacles: Rect[] = nodes.map((n) => ({ x: n.x, y: n.y, w: n.w, h: n.h }));
  const router = makeRouter(width, height, obstacles);
  const startOf = (e: typeof edges[number]): { x: number; y: number } => ({ x: startX.get(e)!, y: rowTop(e.to) + NODE_H });
  const goalOf = (e: typeof edges[number]): { x: number; y: number } => ({ x: endX.get(e)!, y: rowTop(e.from) });
  const span = (e: typeof edges[number]): number => {
    const s = startOf(e), g = goalOf(e);
    return Math.abs(s.x - g.x) + Math.abs(s.y - g.y);
  };
  const order = edges.map((_, i) => i).sort((a, b) => span(edges[a]) - span(edges[b]));
  const pointsByIdx: Array<Array<{ x: number; y: number }>> = new Array(edges.length);
  for (const idx of order) pointsByIdx[idx] = router.route(startOf(edges[idx]), goalOf(edges[idx]), STUB);
  const positioned: PositionedEdge[] = edges.map((e, idx) => ({
    from: e.from, to: e.to, role: e.role, port: e.port, points: pointsByIdx[idx],
  }));

  return { nodes, edges: positioned, width, height };
}
