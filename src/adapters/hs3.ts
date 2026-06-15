/**
 * HS3 adapter: HEP Statistics Serialization Standard JSON → Model.
 *
 * HS3 is a top-level object of optional arrays (`distributions`, `functions`,
 * `data`, `likelihoods`, `domains`, `parameter_points`, `analyses`) plus
 * `metadata`/`misc`. Each array item is identified by `name`; references are
 * name strings in type-specific positions.
 *
 * Reference resolution is per-section, NOT a blind scan of every string in the
 * document:
 *   - distributions/functions: their parameter/variable references are the
 *     object's own string field values (mean→"mu", x→"obs_x", composite
 *     summands/factors). A string matching another node → edge; otherwise the
 *     name is a free parameter/variable and is materialized as a node, so the
 *     actual statistical model is not dropped.
 *   - likelihoods: distributions[i] paired positionally with data[i];
 *     aux_distributions[] tagged distinctly. These must resolve to existing
 *     nodes (no synthesis); inline numeric data values are literals.
 *   - domains/parameter_points: axis/parameter names → parameter references.
 *   - analyses: likelihood/domains references + parameters_of_interest.
 * metadata/misc are never scanned for references (avoids fabricated edges).
 */
import { ModelBuilder, type Model, type NodeKind } from '../model/index.js';
import { scanStringLeaves } from '../util/refscan.js';

const SECTIONS: ReadonlyArray<{ key: string; kind: NodeKind }> = [
  { key: 'distributions', kind: 'distribution' },
  { key: 'functions', kind: 'function' },
  { key: 'data', kind: 'data' },
  { key: 'likelihoods', kind: 'likelihood' },
  { key: 'domains', kind: 'domain' },
  { key: 'parameter_points', kind: 'parameter_point' },
  { key: 'analyses', kind: 'analysis' },
];

/** Keys that are identity/prose/handled-separately, never plain references. */
const NON_REF_KEYS: ReadonlySet<string> = new Set(['name', 'type', 'description', 'expression']);

/** Common math builtins that appear in generic expressions but are not parameters. */
const MATH_BUILTINS: ReadonlySet<string> = new Set([
  'exp', 'log', 'ln', 'sqrt', 'abs', 'pow', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan',
  'sinh', 'cosh', 'tanh', 'floor', 'ceil', 'min', 'max', 'sum', 'prod', 'e', 'pi',
]);

interface Hs3Item {
  name?: string;
  type?: string;
  description?: string;
  [k: string]: unknown;
}

export function fromHs3Json(source: string): Model {
  return fromHs3Doc(JSON.parse(source) as Record<string, unknown>);
}

/** Lower an already-parsed HS3 document (lets the dispatcher avoid re-parsing). */
export function fromHs3Doc(doc: Record<string, unknown>): Model {
  const b = new ModelBuilder('hs3');

  readMetadata(b, doc);

  // Pass 1: nodes (HS3 kind is determined by section, not by the type string).
  for (const { key, kind } of SECTIONS) {
    const section = doc[key];
    if (!Array.isArray(section)) continue;
    for (const item of section as Hs3Item[]) {
      const id = item?.name;
      if (typeof id !== 'string') {
        b.warn(`Item in "${key}" has no string name; skipped`, { code: 'unnamed-item' });
        continue;
      }
      const node = {
        id,
        blockName: id,
        kind,
        type: typeof item.type === 'string' ? item.type : key,
        raw: item,
        ...(typeof item.description === 'string' ? { description: item.description } : {}),
      };
      if (b.addNode(node) && kind === 'analysis') b.addRoot(id);
    }
  }

  // Pass 2: references, per section semantics.
  for (const node of [...b.currentNodes()]) {
    const item = node.raw as Hs3Item;
    switch (node.kind) {
      case 'likelihood':
        resolveLikelihood(b, node.id, item);
        break;
      case 'data':
        break; // data axes define observables; they are not references
      case 'domain':
        // axis `name`s reference the parameters the domain bounds.
        resolveNamedList(b, node.id, item.axes, 'axes');
        break;
      case 'parameter_point':
        // parameter `name`s reference the parameters being valued.
        resolveNamedList(b, node.id, item.parameters, 'parameters');
        break;
      default:
        // distributions, functions, domains, parameter_points, analyses:
        // string field values are references; unknown names are free parameters.
        resolveParameterRefs(b, node.id, item);
        break;
    }
  }

  return b.build();
}

/** Keys that, as own properties, can subvert a prototype if an object is later
 *  key-merged. Stripped from untrusted subtrees on ingest. */
const DANGEROUS_KEYS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);

/** Deep-copy a JSON value, dropping dangerous own keys. Iterative (no recursion)
 *  so deeply-nested untrusted input cannot overflow the stack. */
function sanitize(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  const clone: unknown = Array.isArray(value) ? [] : Object.create(null);
  const stack: Array<{ src: Record<string, unknown> | unknown[]; dst: Record<string, unknown> | unknown[] }> = [
    { src: value as Record<string, unknown> | unknown[], dst: clone as Record<string, unknown> | unknown[] },
  ];
  while (stack.length > 0) {
    const { src, dst } = stack.pop()!;
    for (const key of Object.keys(src)) {
      if (DANGEROUS_KEYS.has(key)) continue;
      const v = (src as Record<string, unknown>)[key];
      if (v !== null && typeof v === 'object') {
        const child: Record<string, unknown> | unknown[] = Array.isArray(v) ? [] : Object.create(null);
        (dst as Record<string, unknown>)[key] = child;
        stack.push({ src: v as Record<string, unknown> | unknown[], dst: child });
      } else {
        (dst as Record<string, unknown>)[key] = v;
      }
    }
  }
  return clone;
}

function readMetadata(b: ModelBuilder, doc: Record<string, unknown>): void {
  const meta = doc.metadata;
  if (!meta || typeof meta !== 'object') {
    // `metadata` is the only required top-level component (HS3 2_toplevels).
    b.error('HS3 model has no `metadata` (the only required top-level component)', {
      code: 'metadata-missing',
    });
    return;
  }
  // `b.meta` is null-proto, but the assigned values are untrusted subtrees that
  // still carry Object.prototype. Deep-sanitize them so a `__proto__`/
  // `constructor`/`prototype` key buried in metadata can never become a
  // pollution sink if a downstream consumer ever key-merges these values.
  Object.assign(b.meta, sanitize(meta) as Record<string, unknown>);
  if (doc.misc !== undefined) b.meta.misc = sanitize(doc.misc);
  if (!('hs3_version' in (meta as Record<string, unknown>))) {
    // `hs3_version` is a required field inside `metadata` (HS3 2.8_metadata).
    b.error('HS3 metadata is missing the required `hs3_version`', { code: 'hs3-version-missing' });
  }
}

/** distributions[i] paired with data[i]; aux_distributions tagged distinctly. */
function resolveLikelihood(b: ModelBuilder, from: string, item: Hs3Item): void {
  const dists = asStringArray(item.distributions);
  const data = Array.isArray(item.data) ? item.data : [];
  dists.forEach((dist, i) => {
    edgeOrWarn(b, from, dist, 'input', `distributions[${i}]`);
    const datum = data[i];
    if (typeof datum === 'string') edgeOrWarn(b, from, datum, 'input', `data[${i}]`);
    // numeric inline data values are literals — intentionally no node/edge.
  });
  asStringArray(item.aux_distributions).forEach((aux, i) => {
    edgeOrWarn(b, from, aux, 'input', `aux_distributions[${i}]`);
  });
}

/** Distribution/function/domain/parameter_point/analysis parameter references. */
function resolveParameterRefs(b: ModelBuilder, from: string, item: Hs3Item): void {
  scanStringLeaves(
    item,
    (target, port) => {
      if (target === from) return;
      if (b.has(target)) b.addEdge(from, target, 'input', port);
      else b.addEdge(from, b.ensureSynthetic(target, 'parameter').id, 'input', port);
    },
    { skipKeys: NON_REF_KEYS },
  );
  // Only `generic_function` carries a free-text `expression` string (HS3 2.2 /
  // grammar in 3.1) that names parameters by identifier — edge to each, skipping
  // math builtins. Other function/distribution types declare refs structurally.
  if (item.type === 'generic_function' && typeof item.expression === 'string') {
    const seen = new Set<string>();
    for (const m of item.expression.matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)) {
      const id = m[0];
      if (seen.has(id) || MATH_BUILTINS.has(id.toLowerCase()) || id === from) continue;
      seen.add(id);
      const target = b.has(id) ? id : b.ensureSynthetic(id, 'parameter').id;
      b.addEdge(from, target, 'input', `expression:${id}`);
    }
  }
}

/** Resolve a list of `{name, …}` entries (domain axes, parameter_point params)
 * whose `name` references a parameter. Handled explicitly because the generic
 * scan skips `name` keys (which are identity at the object's top level). */
function resolveNamedList(b: ModelBuilder, from: string, list: unknown, field: string): void {
  if (!Array.isArray(list)) return;
  list.forEach((entry, i) => {
    const name = (entry as { name?: unknown })?.name;
    if (typeof name === 'string') {
      b.addEdge(from, b.ensureSynthetic(name, 'parameter').id, 'input', `${field}[${i}].name`);
    }
  });
}

function edgeOrWarn(b: ModelBuilder, from: string, target: string, role: 'input', port: string): void {
  if (b.has(target)) b.addEdge(from, target, role, port);
  else b.warn(`"${from}" references undefined "${target}" at ${port}`, { code: 'dangling-ref', nodeId: from });
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}
