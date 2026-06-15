/**
 * FlatPPL adapter — a small, self-contained reader for the `.flatppl`
 * probabilistic-programming language, written to our zero-dependency / ESM /
 * strict-TS constraints (we deliberately do NOT vendor the upstream CJS engine).
 *
 * A `.flatppl` model is a list of bindings:
 *   - `name = expr`  (deterministic)
 *   - `name ~ expr`  (stochastic / random variable)
 * whose right-hand sides reference other bindings by name — i.e. a dependency
 * DAG, mapping directly onto the Model IR: one node per bound name, an edge to
 * every other binding its expression references. Builtins and distributions
 * (`Normal`, `iid`, `lawof`, …) are not bindings, so they never become edges.
 * Comments run from `#` or `%` to end of line. Multi-line RHS occurs only inside
 * brackets (e.g. a `cartprod(...)`), tracked by bracket depth.
 *
 * This recognizes the binding/reference structure the viewer needs; it is NOT a
 * full FlatPPL parser (no type inference, measure algebra, or evaluation).
 */
import { ModelBuilder, type Model, type ModelNode, type NodeKind } from '../model/index.js';

/** RHS head-function → node kind (colour/labelling only). */
const HEAD_KIND: Readonly<Record<string, NodeKind>> = {
  elementof: 'parameter',
  lawof: 'measure',
  kernelof: 'kernel',
  functionof: 'function',
  likelihoodof: 'likelihood',
  bayesupdate: 'posterior',
};

interface Binding { names: string[]; op: '=' | '~'; rhs: string; }

export function fromFlatppl(source: string): Model {
  const b = new ModelBuilder('flatppl');
  const { bindings, unterminated } = parseBindings(source);
  if (unterminated) {
    b.warn('Unterminated bracket — the rest of the file was read as one statement; some bindings may be missing', { code: 'unbalanced-brackets' });
  }

  // Pass 1: one node per bound name.
  for (const bd of bindings) {
    const kind = classify(bd);
    const type = bd.op === '~' ? 'random' : headOf(bd.rhs) ?? 'deterministic';
    for (const name of bd.names) {
      const node: ModelNode = { id: name, blockName: name, kind, type, raw: { op: bd.op, rhs: bd.rhs } };
      if (kind === 'data') {
        const values = parseArray(bd.rhs);
        if (values.length > 0) node.values = values;
      }
      b.addNode(node);
    }
  }

  // Pass 2: edges to referenced bindings (builtins/dists aren't bindings → skipped).
  for (const bd of bindings) {
    const refs = referencedIds(bd.rhs);
    for (const name of bd.names) {
      for (const ref of refs) {
        if (ref !== name && b.has(ref)) b.addEdge(name, ref, 'input', ref);
      }
    }
  }

  if (b.currentNodes().length === 0) {
    b.warn('No FlatPPL bindings found (empty or unrecognized content)', { code: 'empty-model' });
  }
  return b.build();
}

/** Strip a `#`/`%` line comment (FlatPPL has no block comments or string `#`s). */
function stripComment(line: string): string {
  const h = line.indexOf('#');
  const p = line.indexOf('%');
  const cut = h === -1 ? p : p === -1 ? h : Math.min(h, p);
  return cut === -1 ? line : line.slice(0, cut);
}

const bracketDelta = (s: string): number => {
  let d = 0;
  for (const c of s) {
    if (c === '(' || c === '[' || c === '{') d++;
    else if (c === ')' || c === ']' || c === '}') d--;
  }
  return d;
};

/** Split source into binding statements, joining lines whose brackets stay open.
 *  `unterminated` is true if EOF was reached with an open bracket — the trailing
 *  buffer is then one over-long statement and later bindings may have been
 *  swallowed, so the caller surfaces a diagnostic rather than dropping silently. */
function parseBindings(source: string): { bindings: Binding[]; unterminated: boolean } {
  const out: Binding[] = [];
  let buf = '';
  let depth = 0;
  const flush = (): void => {
    const stmt = buf.trim();
    buf = '';
    depth = 0;
    const parsed = stmt ? parseStatement(stmt) : null;
    if (parsed) out.push(parsed);
  };
  for (const raw of source.split(/\r?\n/)) {
    const line = stripComment(raw);
    if (!buf && line.trim() === '') continue;
    buf = buf ? `${buf} ${line}` : line;
    depth += bracketDelta(line);
    if (depth <= 0) flush();
  }
  const unterminated = buf.trim() !== '' && depth > 0;
  if (buf.trim()) flush();
  return { bindings: out, unterminated };
}

/** Split a statement at its top-level `=` or `~` into LHS name(s), op, RHS. */
function parseStatement(stmt: string): Binding | null {
  let depth = 0;
  for (let i = 0; i < stmt.length; i++) {
    const c = stmt[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (depth === 0 && (c === '=' || c === '~')) {
      // skip comparison/relational operators (== != <= >=) — not a binding op
      if (c === '=' && (stmt[i + 1] === '=' || stmt[i - 1] === '!' || stmt[i - 1] === '<' || stmt[i - 1] === '>' || stmt[i - 1] === '=')) {
        continue;
      }
      const names = stmt.slice(0, i).split(',').map((n) => n.trim()).filter((n) => /^[A-Za-z_]\w*$/.test(n));
      const rhs = stmt.slice(i + 1).trim();
      if (names.length === 0 || rhs === '') return null;
      return { names, op: c as '=' | '~', rhs };
    }
  }
  return null;
}

function classify(bd: Binding): NodeKind {
  if (bd.op === '~') return 'distribution';
  const rhs = bd.rhs.trimStart();
  if (rhs.startsWith('[')) return 'data';
  const head = headOf(rhs);
  if (head && head in HEAD_KIND) return HEAD_KIND[head];
  if (/^[-+]?\d+(\.\d+)?$/.test(rhs.trim())) return 'constant';
  return 'deterministic';
}

/** The leading function name of an expression, e.g. `lawof(...)`/`Normal.(...)`. */
function headOf(rhs: string): string | undefined {
  return /^([A-Za-z_]\w*)\s*\.?\(/.exec(rhs.trimStart())?.[1];
}

/** Identifiers referenced in an expression, with keyword-argument labels
 *  (`mu = …`) removed so a label is never mistaken for a reference. */
function referencedIds(rhs: string): string[] {
  const noLabels = rhs.replace(/[A-Za-z_]\w*\s*=(?!=)/g, ' ');
  return [...new Set(noLabels.match(/[A-Za-z_]\w*/g) ?? [])];
}

function parseArray(rhs: string): number[] {
  const m = /\[([^\]]*)\]/.exec(rhs);
  if (!m) return [];
  return m[1]
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => !Number.isNaN(n));
}
