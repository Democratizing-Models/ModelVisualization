/**
 * Normalized internal model (IR) that every format adapter lowers into.
 *
 * A model is, semantically, a DAG of typed objects connected by name
 * references. The renderer only ever sees this `Model`, so adding a new source
 * format means writing one adapter and changing nothing downstream.
 */

/**
 * Render kind for a node — a free-form string the adapter chooses (e.g.
 * `distribution`, `function`, `data`). The renderer treats it opaquely and
 * derives a stable colour from it (see kindColor), so each format can use its
 * own vocabulary. `unknown` is the conventional fallback for unclassified nodes.
 */
export type NodeKind = string;

/** Source format id, set by the adapter and used as the registry key. */
export type SourceFormat = string;

/** A single object in the model graph. */
export interface ModelNode {
  /** Unique identifier used for reference resolution (HS3 `name`). */
  id: string;
  /** Source key/label; may differ from `id` for adapters that rename blocks. */
  blockName: string;
  kind: NodeKind;
  /** Raw type string from the source (e.g. `array(real)`, `gaussian_dist`). */
  type: string;
  /** Bulk numeric payload for data/array nodes — summarized at render time. */
  values?: unknown;
  description?: string;
  /** Original source object, shown verbatim in the inspector. */
  raw: unknown;
  /** True when this node was synthesized (e.g. a free parameter referenced but not defined). */
  synthetic?: boolean;
}

export type EdgeRole = 'input' | 'output' | 'call';

/** A resolved reference between two nodes. */
export interface ModelEdge {
  /** Source node id (the dependent / producer). */
  from: string;
  /** Target node id (the dependency / produced object). */
  to: string;
  role: EdgeRole;
  /** The inputs/outputs key (or field path) the reference came from. */
  port: string;
}

export interface Diagnostic {
  level: 'info' | 'warn' | 'error';
  msg: string;
  /** Stable machine code for the diagnostic class (e.g. 'dup-id', 'cycle'). */
  code?: string;
  nodeId?: string;
}

export interface Model {
  format: SourceFormat;
  meta: Record<string, unknown>;
  nodes: ModelNode[];
  edges: ModelEdge[];
  diagnostics: Diagnostic[];
  /**
   * Preferred forest roots (entry points) set by the adapter — e.g. HS3
   * analyses. When empty, consumers fall back to "nodes nothing depends on".
   * Lets the tree open on the model's real entry points instead of stray
   * synthesized parameters.
   */
  roots: string[];
}
