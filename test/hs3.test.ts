// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { fromHs3Json } from '../src/adapters/hs3.js';
import { computeRoots, buildIndex } from '../src/model/index.js';
import { fixture, hasEdge, errors } from './helpers.js';

describe('HS3 adapter', () => {
  const model = fromHs3Json(fixture('hs3_gaussian.hs3'));
  const byId = new Map(model.nodes.map((n) => [n.id, n]));

  it('lowers each section item to a node keyed by name (kind = section)', () => {
    expect(byId.get('model')?.kind).toBe('distribution');
    expect(byId.get('likelihood')?.kind).toBe('likelihood');
    expect(byId.get('analysis')?.kind).toBe('analysis');
    expect(byId.get('default_domain')?.kind).toBe('domain');
    expect(model.meta['hs3_version']).toBe('0.2');
  });

  it('materializes free parameters/variables as nodes (the model is not dropped)', () => {
    // Regression: the old leaf-scan dropped distribution→parameter refs entirely.
    for (const p of ['mu', 'sigma', 'obs_x', 'mu_obs']) {
      const n = byId.get(p);
      expect(n, `parameter ${p} should be a node`).toBeTruthy();
      expect(n?.kind).toBe('parameter');
      expect(n?.synthetic).toBe(true);
    }
    expect(hasEdge(model, 'model', 'mu', 'input')).toBe(true);
    expect(hasEdge(model, 'model', 'sigma', 'input')).toBe(true);
    expect(hasEdge(model, 'model', 'obs_x', 'input')).toBe(true);
  });

  it('pairs likelihood distributions/data positionally and tags aux distinctly', () => {
    const ports = model.edges.filter((e) => e.from === 'likelihood').map((e) => e.port);
    expect(ports).toContain('distributions[0]');
    expect(ports).toContain('data[0]');
    expect(ports).toContain('aux_distributions[0]');
    expect(hasEdge(model, 'likelihood', 'model')).toBe(true);
    expect(hasEdge(model, 'likelihood', 'obsData')).toBe(true);
    expect(hasEdge(model, 'likelihood', 'constraint')).toBe(true);
  });

  it('resolves analysis references', () => {
    expect(hasEdge(model, 'analysis', 'likelihood')).toBe(true);
    expect(hasEdge(model, 'analysis', 'default_domain')).toBe(true);
  });

  it('resolves domain axis and parameter_point references to parameters', () => {
    expect(hasEdge(model, 'default_domain', 'mu', 'input')).toBe(true);
    expect(hasEdge(model, 'default_domain', 'sigma', 'input')).toBe(true);
    expect(hasEdge(model, 'default_values', 'mu', 'input')).toBe(true);
  });

  it('roots the forest at the analysis (entry-point hint first)', () => {
    expect(errors(model)).toEqual([]);
    expect(model.roots).toContain('analysis');
    expect(computeRoots(model, buildIndex(model)).map((n) => n.id)[0]).toBe('analysis');
  });
});

describe('HS3 reference fidelity (regression)', () => {
  it('does NOT fabricate edges from metadata or description strings', () => {
    // `description` equals a node name, and a metadata field equals one too;
    // neither must become an edge (only typed reference fields are scanned).
    const src = JSON.stringify({
      metadata: { hs3_version: '0.2', author: 'gauss' },
      distributions: [{ name: 'gauss', type: 'gaussian_dist', mean: 'm', description: 'gauss' }],
    });
    const m = fromHs3Json(src);
    // The only edge from `gauss` is its real parameter ref to `m`.
    const targets = m.edges.filter((e) => e.from === 'gauss').map((e) => e.to);
    expect(targets).toEqual(['m']);
    expect(m.edges.some((e) => e.to === 'gauss')).toBe(false);
  });

  it('tokenizes generic-expression identifiers instead of one phantom parameter', () => {
    const src = JSON.stringify({
      metadata: { hs3_version: '0.2' },
      functions: [{ name: 'f', type: 'generic_function', expression: 'a*exp(-(x-mu)**2)' }],
    });
    const m = fromHs3Json(src);
    const targets = m.edges.filter((e) => e.from === 'f').map((e) => e.to).sort();
    expect(targets).toEqual(['a', 'mu', 'x']); // `exp` builtin skipped; no whole-expression node
    expect(m.nodes.some((n) => /[*()]/.test(n.id))).toBe(false);
  });

  it('errors when the required metadata.hs3_version is missing', () => {
    const src = JSON.stringify({ metadata: { author: 'x' }, data: [{ name: 'd', type: 'unbinned' }] });
    const m = fromHs3Json(src);
    expect(m.diagnostics.some((d) => d.code === 'hs3-version-missing')).toBe(true);
  });

  it('detects a data-only HS3 file (data is in the section list)', () => {
    // via the adapter directly; detection covered in detect.test.ts
    const m = fromHs3Json(JSON.stringify({ metadata: { hs3_version: '0.2' }, data: [{ name: 'd', type: 'unbinned' }] }));
    expect(m.nodes.map((n) => n.id)).toContain('d');
  });
});
