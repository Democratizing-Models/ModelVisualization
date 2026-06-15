// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { buildIndex, computeRoots, type Model } from '../src/model/index.js';

const model = (nodes: string[], edges: Array<[string, string]>): Model => ({
  format: 'hs3', meta: {}, roots: [], diagnostics: [],
  nodes: nodes.map((id) => ({ id, blockName: id, kind: 'unknown', type: 't', raw: {} })),
  edges: edges.map(([from, to]) => ({ from, to, role: 'input', port: 'x' })),
});

describe('computeRoots', () => {
  it('treats a node depended on only by a self-edge as a structural root', () => {
    // Regression: a→a put `a` in `dependents`, wrongly excluding it from roots.
    const m = model(['a'], [['a', 'a']]);
    const roots = computeRoots(m, buildIndex(m)).map((n) => n.id);
    expect(roots).toContain('a');
  });

  it('still excludes a node that something else depends on', () => {
    const m = model(['a', 'b'], [['a', 'b']]); // a depends on b → a is root, b is not
    const roots = computeRoots(m, buildIndex(m)).map((n) => n.id);
    expect(roots).toContain('a');
    expect(roots).not.toContain('b');
  });
});
