// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { fromFlatppl } from '../src/adapters/flatppl.js';
import { detectAndParse } from '../src/adapters/detect.js';
import { computeRoots, buildIndex } from '../src/model/index.js';
import { fixture, hasEdge, errors } from './helpers.js';

describe('FlatPPL adapter — linear regression', () => {
  const m = fromFlatppl(fixture('flatppl_linear_regression.flatppl'));
  const byId = new Map(m.nodes.map((n) => [n.id, n]));

  it('classifies bindings by operator and head function', () => {
    expect(byId.get('sigma2')?.kind).toBe('distribution'); // sigma2 ~ InverseGamma(...)
    expect(byId.get('sigma')?.kind).toBe('deterministic');  // sigma = sqrt(sigma2)
    expect(byId.get('prior')?.kind).toBe('measure');        // lawof(...)
    expect(byId.get('forward_kernel')?.kind).toBe('kernel'); // kernelof(...)
    expect(byId.get('L')?.kind).toBe('likelihood');         // likelihoodof(...)
    expect(byId.get('posterior')?.kind).toBe('posterior');  // bayesupdate(...)
    expect(byId.get('x_data')?.kind).toBe('data');
    expect(byId.get('x_data')?.values).toEqual([1.1, 1.5, 1.3, 1.4]);
  });

  it('edges follow RHS references to other bindings', () => {
    expect(hasEdge(m, 'sigma', 'sigma2')).toBe(true);   // sqrt(sigma2)
    expect(hasEdge(m, 'alpha', 'sigma')).toBe(true);    // Normal(0, sigma*3)
    expect(hasEdge(m, 'means', 'x_data')).toBe(true);
    expect(hasEdge(m, 'y', 'means')).toBe(true);
    expect(hasEdge(m, 'posterior', 'L')).toBe(true);
    expect(hasEdge(m, 'posterior', 'prior')).toBe(true);
  });

  it('treats keyword-arg labels as labels, not references; skips builtins', () => {
    // record(alpha = alpha, beta = beta, sigma = sigma): values are refs, labels aren't.
    expect(hasEdge(m, 'prior', 'alpha')).toBe(true);
    // `Normal`, `sqrt`, `record` are builtins → never nodes/edges.
    expect(m.nodes.some((n) => ['Normal', 'sqrt', 'record', 'InverseGamma'].includes(n.id))).toBe(false);
  });

  it('roots the model at its terminal binding (posterior) with no errors', () => {
    expect(errors(m)).toEqual([]);
    expect(computeRoots(m, buildIndex(m)).map((n) => n.id)).toContain('posterior');
  });
});

describe('FlatPPL adapter — eight schools (#/% comments, iid)', () => {
  const m = fromFlatppl(fixture('flatppl_eight_schools.flatppl'));

  it('resolves iid distribution args and integer-array data', () => {
    expect(hasEdge(m, 'theta', 'mu')).toBe(true);  // iid(Normal(mu, tau), J)
    expect(hasEdge(m, 'theta', 'tau')).toBe(true);
    expect(hasEdge(m, 'theta', 'J')).toBe(true);
    expect(m.nodes.find((n) => n.id === 'y_data')?.values).toEqual([28, 8, -3, 7, -1, 1, 18, 12]);
    expect(errors(m)).toEqual([]);
  });
});

describe('FlatPPL bundled samples lower cleanly', () => {
  const samples = [
    'flatppl_poisson', 'flatppl_partial_pooling', 'flatppl_best_estimation',
  ];
  for (const name of samples) {
    it(`${name} produces a non-empty model with no errors`, () => {
      const m = fromFlatppl(fixture(`${name}.flatppl`));
      expect(m.nodes.length).toBeGreaterThan(3);
      expect(errors(m)).toEqual([]);
      // every edge connects two real nodes (no dangling references)
      const ids = new Set(m.nodes.map((n) => n.id));
      for (const e of m.edges) {
        expect(ids.has(e.from) && ids.has(e.to)).toBe(true);
      }
    });
  }
});

describe('FlatPPL malformed input', () => {
  it('surfaces a diagnostic for an unterminated bracket instead of silently dropping bindings', () => {
    const m = fromFlatppl('a = 1\nb = f(\nc = 2\n'); // `f(` never closes
    expect(m.diagnostics.some((d) => d.code === 'unbalanced-brackets')).toBe(true);
    expect(m.nodes.some((n) => n.id === 'a')).toBe(true); // binding before the open bracket survives
  });
});

describe('FlatPPL detection', () => {
  it('routes a .flatppl file to the FlatPPL adapter', () => {
    expect(detectAndParse('m.flatppl', 'a ~ Normal(0, 1)\nb = a + 1\n').format).toBe('flatppl');
  });
});
