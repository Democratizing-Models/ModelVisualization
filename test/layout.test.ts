// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { fromHs3Json } from '../src/adapters/hs3.js';
import { buildIndex } from '../src/model/index.js';
import { extractCone } from '../src/render/cone.js';
import { layoutDag } from '../src/render/layout.js';
import { fixture } from './helpers.js';

const model = fromHs3Json(fixture('hs3_gaussian.hs3'));
const index = buildIndex(model);

function pos(focus: string, hops = 2) {
  return layoutDag(extractCone(index, focus, { hops }));
}

describe('layoutDag', () => {
  it('stacks dependents below their dependencies (top→bottom flow)', () => {
    const pg = pos('likelihood');
    const byId = new Map(pg.nodes.map((n) => [n.id, n]));
    // likelihood depends on model → likelihood (dependent) sits below model
    expect(byId.get('likelihood')!.y).toBeGreaterThan(byId.get('model')!.y);
    // model depends on mu → model sits below mu
    expect(byId.get('model')!.y).toBeGreaterThan(byId.get('mu')!.y);
  });

  it('places a node one row below its lowest parent (not flattened with other roots)', () => {
    // From `analysis`, `default_values` is pulled in via shared parameters. It
    // must sit one row below its deepest dependency — NOT on `analysis`'s row.
    const pg = layoutDag(extractCone(index, 'analysis', { hops: 3 }));
    const byId = new Map(pg.nodes.map((n) => [n.id, n]));
    const dv = byId.get('default_values')!;
    const analysis = byId.get('analysis')!;
    const parents = ['mu', 'sigma'].map((id) => byId.get(id)!);
    expect(dv).toBeTruthy();
    expect(parents.every(Boolean)).toBe(true);

    const lowestParentY = Math.max(...parents.map((p) => p.y));
    const rows = [...new Set(pg.nodes.map((n) => n.y))].sort((a, b) => a - b);
    const rowStep = rows[1] - rows[0];
    expect(dv.y).toBeCloseTo(lowestParentY + rowStep, 5); // exactly one row below
    expect(dv.y).not.toBe(analysis.y);                    // not flattened next to analysis
    expect(dv.y).toBeLessThan(analysis.y);                // analysis is the deeper consumer
  });

  it('pulls a pure-source node down to one row above its consumer', () => {
    // obsData (a leaf, consumed only by likelihood) should sit one row above
    // likelihood, not at the very top with a long edge crossing other rows.
    const pg = layoutDag(extractCone(index, 'analysis', { hops: 3 }));
    const byId = new Map(pg.nodes.map((n) => [n.id, n]));
    const obs = byId.get('obsData')!, lik = byId.get('likelihood')!;
    const rows = [...new Set(pg.nodes.map((n) => n.y))].sort((a, b) => a - b);
    const rowStep = rows[1] - rows[0];
    expect(lik.y - obs.y).toBeCloseTo(rowStep, 5); // exactly one row above its consumer
  });

  it('routes an edge spanning multiple rows through waypoints', () => {
    const pg = layoutDag(extractCone(index, 'analysis', { hops: 3 }));
    // analysis (deep consumer) → mu (leaf) spans more than one row
    const e = pg.edges.find((x) => x.from === 'analysis' && x.to === 'mu');
    expect(e).toBeTruthy();
    expect(e!.points.length).toBeGreaterThan(2); // bends via dummy waypoints
  });

  it('spaces wire attachment points across the middle third of a node edge', () => {
    // D has two dependents (X, Y) → two wires leave D's bottom; they must attach
    // at distinct points within the middle third of D's width.
    const m = {
      format: 'hs3' as const, meta: {}, roots: [], diagnostics: [],
      nodes: ['D', 'X', 'Y'].map((id) => ({ id, blockName: id, kind: 'unknown' as const, type: 't', raw: {} })),
      edges: [
        { from: 'X', to: 'D', role: 'input' as const, port: 'a' },
        { from: 'Y', to: 'D', role: 'input' as const, port: 'b' },
      ],
    };
    const pg = layoutDag(extractCone(buildIndex(m), 'D', { hops: 2 }));
    const d = pg.nodes.find((n) => n.id === 'D')!;
    const starts = pg.edges.filter((e) => e.to === 'D').map((e) => e.points[0].x).sort((a, b) => a - b);
    expect(starts).toHaveLength(2);
    expect(starts[0]).not.toBe(starts[1]); // spaced, not stacked at centre
    const lo = d.x + d.w / 3 - 0.01, hi = d.x + (2 * d.w) / 3 + 0.01;
    for (const x of starts) { expect(x).toBeGreaterThanOrEqual(lo); expect(x).toBeLessThanOrEqual(hi); }
  });

  it('centres a dependent symmetrically under its dependencies', () => {
    const m = {
      format: 'hs3' as const, meta: {}, roots: [], diagnostics: [],
      nodes: [
        { id: 'root', blockName: 'root', kind: 'unknown' as const, type: 't', raw: {} },
        { id: 'a', blockName: 'a', kind: 'unknown' as const, type: 't', raw: {} },
        { id: 'b', blockName: 'b', kind: 'unknown' as const, type: 't', raw: {} },
      ],
      edges: [
        { from: 'root', to: 'a', role: 'input' as const, port: 'x' },
        { from: 'root', to: 'b', role: 'input' as const, port: 'y' },
      ],
    };
    const pg = layoutDag(extractCone(buildIndex(m), 'root'));
    const byId = new Map(pg.nodes.map((n) => [n.id, n]));
    const root = byId.get('root')!, a = byId.get('a')!, b = byId.get('b')!;
    // root sits at the midpoint of its two dependencies
    expect(root.x).toBeCloseTo((a.x + b.x) / 2, 5);
  });

  it('assigns every node a unique (x, y) position', () => {
    const pg = pos('likelihood');
    const seen = new Set(pg.nodes.map((n) => `${n.x},${n.y}`));
    expect(seen.size).toBe(pg.nodes.length);
  });

  it('marks the focus node', () => {
    const pg = pos('likelihood');
    expect(pg.nodes.filter((n) => n.isFocus).map((n) => n.id)).toEqual(['likelihood']);
  });

  it('emits an edge polyline with at least two points for each cone edge', () => {
    const pg = pos('likelihood');
    expect(pg.edges.length).toBeGreaterThan(0);
    for (const e of pg.edges) expect(e.points.length).toBeGreaterThanOrEqual(2);
  });

  it('is deterministic', () => {
    expect(JSON.stringify(pos('likelihood'))).toBe(JSON.stringify(pos('likelihood')));
  });

  it('handles a single-node cone', () => {
    const pg = layoutDag(extractCone(index, 'likelihood', { nodeCap: 1 }));
    expect(pg.nodes).toHaveLength(1);
    expect(pg.edges).toHaveLength(0);
    expect(pg.width).toBeGreaterThan(0);
    expect(pg.height).toBeGreaterThan(0);
  });

  it('positions a cyclic cone without throwing or colliding', () => {
    const cyclic = {
      format: 'hs3' as const, meta: {}, roots: [], diagnostics: [],
      nodes: [
        { id: 'a', blockName: 'a', kind: 'unknown' as const, type: 't', raw: {} },
        { id: 'b', blockName: 'b', kind: 'unknown' as const, type: 't', raw: {} },
        { id: 'c', blockName: 'c', kind: 'unknown' as const, type: 't', raw: {} },
      ],
      edges: [
        { from: 'a', to: 'b', role: 'input' as const, port: 'x' },
        { from: 'b', to: 'c', role: 'input' as const, port: 'x' },
        { from: 'c', to: 'a', role: 'input' as const, port: 'x' },
      ],
    };
    const ci = buildIndex(cyclic);
    let pg: ReturnType<typeof layoutDag> | undefined;
    expect(() => { pg = layoutDag(extractCone(ci, 'a', { hops: 5 })); }).not.toThrow();
    const seen = new Set(pg!.nodes.map((n) => `${n.x},${n.y}`));
    expect(seen.size).toBe(pg!.nodes.length);
  });
});
