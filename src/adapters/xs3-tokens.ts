/**
 * XS3 token-dict → Model lowering, conforming to the XS3 Standard
 * (XS3-Standard/standard_xs3.md). Both concretizations (clean JSON and the
 * yaml-ish `.xs3`) lex to the same token dict.
 *
 * Standard rules implemented:
 *   - §1.3.2 Every object has an `identifier` + `type` (we accept `id` as a
 *     pre-standard alias, then fall back to the block name).
 *   - §2.1 Metadata objects: `preamble` (its NamedTuple `values` carry the model
 *     provenance) and legacy `metadata` are pulled into `meta`, NOT emitted as
 *     nodes; `comment` MUST be ignored entirely.
 *   - §1.3.3/§1.3.5 An input/output value that is a parenthesized type denotation
 *     — `(real)`, `(id)`, `(random_state)`, … — is a TYPE, not a reference, so it
 *     produces no edge or node. Literals likewise produce no edge. A value that
 *     matches an object identifier is a `reference` → edge.
 *   - §2.3 Linking: `function.call_type`, and `samplable.weighting_type` /
 *     `sampling_type`, connect an abstract object to its call objects (call edge).
 *   - §1.3.6 The model is a DAG of objects (nodes) connected by identifier
 *     references (edges); outputs are objects with their own identifiers.
 *
 * blockName ≠ identifier (block `data_x` may have identifier `x`); objects are
 * indexed by identifier.
 */
import { ModelBuilder, type Model, type ModelNode, type NodeKind } from '../model/index.js';
import { isXs3Literal } from '../util/number.js';
import { sanitize } from '../util/sanitize.js';

export interface Xs3Token {
  id?: string;
  identifier?: string;
  type?: string;
  call_type?: string;
  weighting_type?: string;
  sampling_type?: string;
  values?: unknown;
  inputs?: Record<string, unknown>;
  outputs?: Record<string, unknown>;
  description?: string;
  [k: string]: unknown;
}

export type Xs3TokenDict = Record<string, Xs3Token>;

/** Block names the Standard defines as metadata (§2.1); never structural nodes. */
const METADATA_BLOCKS: ReadonlySet<string> = new Set(['preamble', 'metadata']);
/** Fields that link an abstract object to its concrete call object(s) (§2.3). */
const CALL_LINK_FIELDS = ['call_type', 'weighting_type', 'sampling_type'] as const;

/** A parenthesized type denotation like `(real)`, `(id)`, `(int / real)` — a
 *  TYPE, not a reference (§1.3.3). */
function isTypeDenotation(value: unknown): boolean {
  return typeof value === 'string' && /^\(.+\)$/.test(value.trim());
}

/** Map an XS3 `type:` value to a render kind (colour only; treated opaquely). */
function kindFromXs3Type(type: string | undefined): NodeKind {
  if (!type) return 'unknown';
  const t = type.trim();
  if (t === 'data') return 'data';
  if (t.startsWith('array(')) return 'array';
  if (t === 'function') return 'function';
  if (t === 'function_call' || t === 'weighting_call' || t === 'sampling_call') return 'function_call';
  if (t === 'workspace') return 'workspace';
  if (t === 'samplable') return 'distribution';
  if (t === 'random_state') return 'random_state';
  if (t === 'domain') return 'domain';
  return 'unknown';
}

export function tokensToModel(tokens: Xs3TokenDict): Model {
  // Single 'xs3' format id for both concretizations; the viewer badge/label
  // doesn't distinguish them.
  const b = new ModelBuilder('xs3');

  // Pass 1: build nodes (indexed by identifier), pull metadata aside.
  for (const [blockName, token] of Object.entries(tokens)) {
    // `comment` objects MUST be ignored by processors (§2.1).
    if (blockName === 'comment') continue;
    if (METADATA_BLOCKS.has(blockName)) {
      // preamble carries provenance in its NamedTuple `values`; legacy `metadata`
      // carried it as top-level fields. Deep-sanitize (prototype-pollution guard,
      // same posture as HS3) before merging into the null-proto meta.
      const payload = blockName === 'preamble' && token.values && typeof token.values === 'object'
        ? token.values
        : token;
      Object.assign(b.meta, sanitize(payload) as Record<string, unknown>);
      continue;
    }
    const id = token.identifier ?? token.id ?? blockName;
    const node: ModelNode = {
      id,
      blockName,
      kind: kindFromXs3Type(token.type),
      type: token.type ?? 'unknown',
      raw: token,
    };
    if (token.values !== undefined) node.values = token.values;
    if (typeof token.description === 'string') node.description = token.description.trim();
    if (b.addNode(node) && node.kind === 'workspace') b.addRoot(id);
  }

  // Pass 2: resolve references into edges (snapshot first — we synthesize nodes).
  for (const node of [...b.currentNodes()]) {
    const token = node.raw as Xs3Token;

    // Link an abstract object to its call object(s): function→call_type,
    // samplable→weighting_type/sampling_type.
    for (const field of CALL_LINK_FIELDS) {
      const target = token[field];
      if (typeof target !== 'string') continue;
      if (b.has(target)) {
        b.addEdge(node.id, target, 'call', field);
      } else {
        b.warn(`${field} "${target}" of "${node.id}" does not resolve`, {
          code: 'unresolved-call-type',
          nodeId: node.id,
        });
      }
    }

    resolvePorts(b, node.id, token.inputs, 'input');
    resolvePorts(b, node.id, token.outputs, 'output');
  }

  if (b.currentNodes().length === 0) {
    b.warn('XS3 source produced no objects (empty or unrecognized content)', { code: 'empty-model' });
  }

  return b.build();
}

function resolvePorts(
  b: ModelBuilder,
  from: string,
  ports: Record<string, unknown> | undefined,
  role: 'input' | 'output',
): void {
  for (const [port, value] of Object.entries(ports ?? {})) {
    if (isTypeDenotation(value)) {
      // a type denotation declares the port's type — not a reference (§1.3.3)
    } else if (typeof value === 'string' && b.has(value)) {
      b.addEdge(from, value, role, port);
    } else if (isXs3Literal(value)) {
      // literal — not an edge
    } else if (typeof value === 'string') {
      // Unresolved identifier: an output object defined only by being produced
      // (§1.3.6), or a dangling input reference. Synthesize so the graph shows
      // it; warn for inputs (a reference MUST resolve to exactly one object).
      b.ensureSynthetic(value, 'variable');
      b.addEdge(from, value, role, port);
      if (role === 'input') {
        b.warn(`Input "${port}" of "${from}" references unknown id "${value}"`, {
          code: 'unresolved-input',
          nodeId: from,
        });
      }
    }
  }
}
