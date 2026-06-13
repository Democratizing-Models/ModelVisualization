// @vitest-environment node
// Render pipeline must survive whatever an adapter emits (a 2nd format will).
import { describe, it, expect } from 'vitest';
import { buildIndex, type Model, type ModelEdge } from '../src/model/index.js';
import { extractCone } from '../src/render/cone.js';
import { layoutDag } from '../src/render/layout.js';
import { wirePaths } from '../src/render/wires.js';

const node = (id: string, kind = 'thing') => ({ id, blockName: id, kind, type: 't', raw: {} });
const model = (nodes: string[], edges: Array<[string, string]>): Model => ({
  format: 'x', meta: {}, roots: [], diagnostics: [],
  nodes: nodes.map((id) => node(id)),
  edges: edges.map(([from, to]): ModelEdge => ({ from, to, role: 'input', port: 'p' })),
});

// Run the whole render pipeline around `focus` and assert it produces sane output.
const run = (m: Model, focus: string): void => {
  const idx = buildIndex(m);
  let pg!: ReturnType<typeof layoutDag>;
  expect(() => { pg = layoutDag(extractCone(idx, focus, { hops: 4 })); }).not.toThrow();
  expect(pg.width).toBeGreaterThan(0);
  expect(pg.height).toBeGreaterThan(0);
  for (const n of pg.nodes) { expect(Number.isFinite(n.x)).toBe(true); expect(Number.isFinite(n.y)).toBe(true); }
  for (const e of pg.edges) for (const pt of e.points) {
    expect(Number.isFinite(pt.x)).toBe(true); expect(Number.isFinite(pt.y)).toBe(true);
  }
  let paths!: string[];
  expect(() => { paths = wirePaths(pg.edges); }).not.toThrow();
  expect(paths.every((d) => d === '' || d.startsWith('M'))).toBe(true);
  expect(paths.every((d) => !d.includes('NaN'))).toBe(true);
};

describe('render pipeline survives adversarial IR', () => {
  it('empty model', () => run(model([], []), 'nope'));
  it('focus id not present', () => run(model(['a', 'b'], [['a', 'b']]), 'ghost'));
  it('edge to a missing node', () => run(model(['a'], [['a', 'z']]), 'a'));
  it('self-loop', () => run(model(['a', 'b'], [['a', 'a'], ['b', 'a']]), 'a'));
  it('2-cycle', () => run(model(['a', 'b'], [['a', 'b'], ['b', 'a']]), 'a'));
  it('3-cycle', () => run(model(['a', 'b', 'c'], [['a', 'b'], ['b', 'c'], ['c', 'a']]), 'b'));
  it('wide fan-out / fan-in', () => {
    const leaves = Array.from({ length: 40 }, (_, i) => `L${i}`);
    run(model(['hub', ...leaves], leaves.map((l): [string, string] => ['hub', l])), 'hub');
  });
  it('duplicate edges', () => run(model(['a', 'b'], [['a', 'b'], ['a', 'b'], ['a', 'b']]), 'a'));
  it('empty + odd kind strings', () => {
    const m = model(['a', 'b'], [['a', 'b']]);
    m.nodes[0].kind = '';
    m.nodes[1].kind = '🙂/weird kind';
    run(m, 'a');
  });
});
