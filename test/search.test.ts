// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { buildIndex, findNode, findMatches, type Model, type ModelNode } from '../src/model/index.js';

const nodes: ModelNode[] = [
  { id: 'mu', blockName: 'mu', kind: 'parameter', type: 't', raw: {} },
  { id: 'sigma_obs', blockName: 'sigma_obs', kind: 'parameter', type: 't', raw: {} },
  { id: 'g1', blockName: 'gauss_model', kind: 'distribution', type: 'gaussian_dist', raw: {} },
];
const model: Model = { format: 'hs3', meta: {}, roots: [], diagnostics: [], nodes, edges: [] };
const byId = buildIndex(model).byId;
const find = (q: string): string | undefined => findNode(model.nodes, byId, q)?.id;

describe('findNode', () => {
  it('matches exact id first', () => {
    expect(find('mu')).toBe('mu');
    expect(find('g1')).toBe('g1');
  });

  it('matches exact blockName when id differs', () => {
    expect(find('gauss_model')).toBe('g1');
  });

  it('falls back to case-insensitive substring on id or name', () => {
    expect(find('GAUSS')).toBe('g1');     // substring of blockName
    expect(find('obs')).toBe('sigma_obs'); // substring of id/name
  });

  it('returns undefined for blank or no match', () => {
    expect(find('   ')).toBeUndefined();
    expect(find('nonexistent')).toBeUndefined();
  });

  it('trims the query', () => {
    expect(find('  mu  ')).toBe('mu');
  });
});

describe('findMatches', () => {
  const ids = (q: string): string[] => findMatches(model.nodes, byId, q).map((n) => n.id);

  it('returns every match so the UI can step through them', () => {
    // "mu" is an exact id AND a substring of nothing else here; "sigma" hits one.
    expect(ids('sigma')).toEqual(['sigma_obs']);
    expect(ids('a')).toEqual(['sigma_obs', 'g1']); // substring of both names
  });

  it('ranks exact id, then exact name, then substring', () => {
    expect(ids('mu')[0]).toBe('mu');
    expect(ids('gauss_model')[0]).toBe('g1');
  });

  it('matches on type once names are exhausted', () => {
    // No node is NAMED gaussian_dist; one HAS that type.
    expect(ids('gaussian_dist')).toEqual(['g1']);
    // Name matches still come first when both kinds of match exist.
    expect(ids('t')).toEqual(['mu', 'sigma_obs', 'g1']);
  });

  it('never repeats a node that matches on several fields', () => {
    const out = ids('mu');
    expect(new Set(out).size).toBe(out.length);
  });

  it('is empty for a blank query or no match', () => {
    expect(ids('   ')).toEqual([]);
    expect(ids('nonexistent')).toEqual([]);
  });
});
