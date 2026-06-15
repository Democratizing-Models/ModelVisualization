// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { buildIndex, computeRoots, dependencyEdges, dependentEdges, outputEdges, type Model } from '../src/model/index.js';
import { extractCone } from '../src/render/cone.js';

// producer --output--> product, and consumer --input--> product.
const model: Model = {
  format: 'xs3', meta: {}, roots: [], diagnostics: [],
  nodes: ['producer', 'product', 'consumer'].map((id) => ({ id, blockName: id, kind: 'unknown', type: 't', raw: {} })),
  edges: [
    { from: 'producer', to: 'product', role: 'output', port: 'out' },
    { from: 'consumer', to: 'product', role: 'input', port: 'in' },
  ],
};

describe('output edges participate in graph traversal (data-flow connectivity)', () => {
  const idx = buildIndex(model);

  it('a product depends on its producer (reversed output edge)', () => {
    expect(dependencyEdges(idx, 'product').map((e) => e.to)).toContain('producer');
    expect(dependentEdges(idx, 'producer').map((e) => e.from)).toContain('product');
  });

  it('keeps the raw output edge for the inspector "Produces" view', () => {
    expect(outputEdges(idx, 'producer').map((e) => e.to)).toEqual(['product']);
  });

  it('a pure producer is still a structural root (reversed output edge does not bury it)', () => {
    // producer only emits an output; without the output-role exclusion it would
    // appear to be depended-on by `product` and lose its root status.
    expect(computeRoots(model, idx).map((n) => n.id)).toContain('producer');
  });

  it('a cone on the producer reaches the product and its consumer (was a dead end before)', () => {
    const cone = extractCone(idx, 'producer', { hops: 5 });
    const ids = cone.nodes.map((n) => n.id).sort();
    expect(ids).toEqual(['consumer', 'producer', 'product']);
  });
});
