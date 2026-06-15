/**
 * Resolve a free-text query to a node. Format-agnostic; the primary way to reach
 * a node in a large model that the windowed DAG cone and capped tree hide.
 * Match priority: exact id → exact blockName → first case-insensitive substring
 * on id or blockName (nodes scanned in model order, so results are stable).
 */
import type { ModelNode } from './types.js';

export function findNode(
  nodes: ModelNode[],
  byId: Map<string, ModelNode>,
  query: string,
): ModelNode | undefined {
  const q = query.trim();
  if (!q) return undefined;
  const exactId = byId.get(q);
  if (exactId) return exactId;
  const lc = q.toLowerCase();
  return (
    nodes.find((n) => n.blockName === q) ??
    nodes.find((n) => n.id.toLowerCase().includes(lc) || n.blockName.toLowerCase().includes(lc))
  );
}
