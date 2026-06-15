// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { buildIndex, findNode, type Model, type ModelNode } from '../src/model/index.js';

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
