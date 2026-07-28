/**
 * Resolve a free-text query to nodes. Format-agnostic; the primary way to reach
 * a node in a large model that the windowed DAG cone and capped tree hide.
 *
 * Match priority: exact id → exact blockName → case-insensitive substring on id
 * or blockName → case-insensitive substring on `type` (so "gaussian_dist" finds
 * every gaussian, not just a node happening to be named that). Nodes are scanned
 * in model order within each tier, so the ranking is stable.
 */
import type { ModelNode } from './types.js';

/** All nodes matching `query`, best match first, deduplicated. */
export function findMatches(
  nodes: ModelNode[],
  byId: Map<string, ModelNode>,
  query: string,
): ModelNode[] {
  const q = query.trim();
  if (!q) return [];
  const lc = q.toLowerCase();

  const seen = new Set<string>();
  const out: ModelNode[] = [];
  const add = (n: ModelNode | undefined): void => {
    if (!n || seen.has(n.id)) return;
    seen.add(n.id);
    out.push(n);
  };

  add(byId.get(q));
  for (const n of nodes) if (n.blockName === q) add(n);
  for (const n of nodes) {
    if (n.id.toLowerCase().includes(lc) || n.blockName.toLowerCase().includes(lc)) add(n);
  }
  for (const n of nodes) if (n.type.toLowerCase().includes(lc)) add(n);
  return out;
}

/** The single best match for `query` (the first of `findMatches`). */
export function findNode(
  nodes: ModelNode[],
  byId: Map<string, ModelNode>,
  query: string,
): ModelNode | undefined {
  return findMatches(nodes, byId, query)[0];
}
