// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { fromHs3Json } from '../src/adapters/hs3.js';
import { buildIndex, type Model } from '../src/model/index.js';
import { extractCone } from '../src/render/cone.js';
import { fixture } from './helpers.js';

const model = fromHs3Json(fixture('hs3_gaussian.json'));
const index = buildIndex(model);

describe('extractCone', () => {
  it('always includes the focus node at depth 0', () => {
    const c = extractCone(index, 'likelihood');
    expect(c.focusId).toBe('likelihood');
    expect(c.nodes.some((n) => n.id === 'likelihood')).toBe(true);
    expect(c.depth.get('likelihood')).toBe(0);
  });

  it('walks upstream dependencies (negative depth) and downstream dependents (positive depth)', () => {
    const c = extractCone(index, 'likelihood', { hops: 1 });
    for (const dep of ['model', 'obsData', 'constraint']) {
      expect(c.depth.get(dep)).toBe(-1);
    }
    expect(c.depth.get('analysis')).toBe(1);
  });

  it('fans out to siblings reachable through a shared dependent', () => {
    // likelihood → analysis (dependent) → analysis's other dependency default_domain
    const c = extractCone(index, 'likelihood', { hops: 2 });
    expect(c.nodes.some((n) => n.id === 'default_domain')).toBe(true);
  });

  it('respects the hop limit', () => {
    const oneHop = extractCone(index, 'likelihood', { hops: 1 });
    expect(oneHop.nodes.some((n) => n.id === 'mu')).toBe(false);
    const twoHop = extractCone(index, 'likelihood', { hops: 2 });
    expect(twoHop.nodes.some((n) => n.id === 'mu')).toBe(true);
  });

  it('respects the node cap (focus only when cap is 1)', () => {
    const c = extractCone(index, 'likelihood', { nodeCap: 1 });
    expect(c.nodes).toHaveLength(1);
    expect(c.nodes[0].id).toBe('likelihood');
  });

  it('truncates to exactly nodeCap nodes, breadth-first from the focus', () => {
    const c = extractCone(index, 'likelihood', { hops: 3, nodeCap: 4 });
    expect(c.nodes).toHaveLength(4);
    expect(c.nodes.some((n) => n.id === 'likelihood')).toBe(true);
    // nearer ring (|depth| 1) is filled before any |depth| 2 node appears
    const maxAbs = Math.max(...[...c.depth.values()].map((d) => Math.abs(d)));
    expect(maxAbs).toBeLessThanOrEqual(2);
  });

  it('only includes edges whose endpoints are both in the cone', () => {
    const c = extractCone(index, 'likelihood', { hops: 1 });
    const ids = new Set(c.nodes.map((n) => n.id));
    for (const e of c.edges) {
      expect(ids.has(e.from) && ids.has(e.to)).toBe(true);
    }
  });

  it('reports hidden-neighbor counts for boundary nodes', () => {
    const c = extractCone(index, 'likelihood', { hops: 1 });
    expect((c.hidden.get('model') ?? 0)).toBeGreaterThanOrEqual(3);
  });

  it('returns an empty cone for an unknown focus id', () => {
    const c = extractCone(index, 'does-not-exist');
    expect(c.nodes).toHaveLength(0);
    expect(c.edges).toHaveLength(0);
  });

  it('terminates on a cyclic graph', () => {
    const cyclic: Model = {
      format: 'hs3', meta: {}, roots: [], diagnostics: [],
      nodes: [
        { id: 'a', blockName: 'a', kind: 'unknown', type: 't', raw: {} },
        { id: 'b', blockName: 'b', kind: 'unknown', type: 't', raw: {} },
      ],
      edges: [
        { from: 'a', to: 'b', role: 'input', port: 'x' },
        { from: 'b', to: 'a', role: 'input', port: 'x' },
      ],
    };
    const ci = buildIndex(cyclic);
    let c: ReturnType<typeof extractCone> | undefined;
    expect(() => { c = extractCone(ci, 'a', { hops: 5 }); }).not.toThrow();
    expect(c!.nodes.some((n) => n.id === 'b')).toBe(true);
  });
});
