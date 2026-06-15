// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { fromXs3Json, fromXs3Yaml } from '../src/adapters/xs3.js';
import { computeRoots, buildIndex } from '../src/model/index.js';
import { fixture, ids, edgeKey, hasEdge, errors } from './helpers.js';

const DEFINED_IDS = [
  'x', 'y', 'p', 'p0', 'pcov', 'y_fit',
  'curve_fit', 'curve_fit_call', 'gaussian', 'gaussian_call',
  'chisquare', 'chisquare_call', 'fit_ws',
].sort();

describe('XS3 JSON adapter', () => {
  const model = fromXs3Json(fixture('xs3_simple_fit.json'));

  it('lowers every block to a node, indexed by id (not blockName)', () => {
    // 13 defined + 1 synthesized variable (out_chisquare).
    expect(model.nodes).toHaveLength(14);
    expect(ids(model)).toEqual([...DEFINED_IDS, 'out_chisquare'].sort());
    expect(model.meta['author']).toContain('DEMOS-laser');
  });

  it('resolves input references to edges and skips numeric literals', () => {
    expect(hasEdge(model, 'curve_fit_call', 'x', 'input')).toBe(true);
    expect(hasEdge(model, 'curve_fit_call', 'gaussian', 'input')).toBe(true);
    expect(hasEdge(model, 'gaussian_call', 'p', 'input')).toBe(true);
    // maxiter: 1000 is a literal — no edge to a "1000" node.
    expect(model.edges.some((e) => e.to === '1000')).toBe(false);
    expect(model.nodes.some((n) => n.id === '1000')).toBe(false);
  });

  it('links function to function_call via call_type', () => {
    expect(hasEdge(model, 'gaussian', 'gaussian_call', 'call')).toBe(true);
    expect(hasEdge(model, 'curve_fit', 'curve_fit_call', 'call')).toBe(true);
    expect(hasEdge(model, 'chisquare', 'chisquare_call', 'call')).toBe(true);
  });

  it('synthesizes an implicit variable for an unresolved output string', () => {
    const out = model.nodes.find((n) => n.id === 'out_chisquare');
    expect(out?.synthetic).toBe(true);
    expect(out?.kind).toBe('variable');
    expect(hasEdge(model, 'chisquare_call', 'out_chisquare', 'output')).toBe(true);
    expect(hasEdge(model, 'fit_ws', 'out_chisquare', 'output')).toBe(true);
  });

  it('produces a DAG with no errors and surfaces the workspace as first root', () => {
    expect(errors(model)).toEqual([]);
    expect(model.roots).toContain('fit_ws');
    const roots = computeRoots(model, buildIndex(model)).map((n) => n.id);
    expect(roots[0]).toBe('fit_ws');
    expect(roots).toContain('curve_fit'); // other structural roots remain visible
  });
});

describe('XS3 literal rule (engine isnumeric, regression)', () => {
  // Engine treats only all-digit strings as literals; a float-valued input
  // string is a reference (→ synthesized variable), not a dropped literal.
  const tokens = {
    metadata: { XS3: 'version' },
    f: { id: 'f', type: 'function_call', inputs: { count: '1000', scale: '1.5' } },
  };

  it('all-digit input is a literal (no node, no edge)', () => {
    const m = fromXs3Json(JSON.stringify(tokens));
    expect(m.nodes.some((n) => n.id === '1000')).toBe(false);
    expect(m.edges.some((e) => e.to === '1000')).toBe(false);
  });

  it('non-all-digit (float) input is a reference, not a literal', () => {
    const m = fromXs3Json(JSON.stringify(tokens));
    expect(m.nodes.some((n) => n.id === '1.5' && n.synthetic)).toBe(true);
    expect(hasEdge(m, 'f', '1.5', 'input')).toBe(true);
  });
});

describe('XS3 yaml-ish adapter', () => {
  const json = fromXs3Json(fixture('xs3_simple_fit.json'));
  const yaml = fromXs3Yaml(fixture('xs3_simple_fit.xs3'));

  it('parses the bespoke .xs3 format (tolerating the sample quote bug)', () => {
    expect(ids(yaml)).toEqual(ids(json));
    // The .xs3 sample has `"f_obs: y_fit` (unbalanced quote); lexer recovers the key.
    expect(hasEdge(yaml, 'chisquare_call', 'y_fit', 'input')).toBe(true);
  });

  it('produces the same graph as the JSON form', () => {
    const a = json.edges.map(edgeKey).sort();
    const b = yaml.edges.map(edgeKey).sort();
    expect(b).toEqual(a);
  });

  it('a scalar values: line does not swallow following blocks (lexer EOF guard)', () => {
    const src = '- a:\n    id: a\n    type: data\n    values: scalar\n- b:\n    id: b\n    type: data\n';
    expect(ids(fromXs3Yaml(src))).toContain('b'); // block b survives the malformed values: line
  });
});

describe('upstream example 01 (real .xs3 from XS3-Architecture)', () => {
  const m = fromXs3Yaml(fixture('xs3_simple_fit_001.xs3'));

  it('lowers with no errors and a workspace root', () => {
    expect(errors(m)).toEqual([]);
    expect(m.roots).toContain('fit');
    expect(m.nodes.length).toBeGreaterThan(5);
  });

  it('resolves the data nodes and metadata', () => {
    expect(m.nodes.find((n) => n.id === 'x')?.kind).toBe('data');
    expect(m.meta['author']).toContain('DEMOS-laser');
  });
});

describe('upstream example 04 (standard vintage: identifier/preamble/samplable)', () => {
  const m = fromXs3Yaml(fixture('xs3_transport_004.xs3'));
  const byId = new Map(m.nodes.map((n) => [n.id, n]));

  it('treats preamble + comment as metadata, not nodes (§2.1)', () => {
    expect(byId.has('preamble')).toBe(false);
    expect(byId.has('comment')).toBe(false);
    expect(m.meta['author']).toContain('DEMOS-laser'); // pulled from preamble values
  });

  it('uses `identifier` as the node id (§1.3.2)', () => {
    expect(byId.get('gun_dist')?.kind).toBe('distribution'); // block `- gun`, identifier gun_dist
    expect(byId.has('gun')).toBe(false);
  });

  it('skips parenthesized type denotations — no (real)/(random_state) nodes (§1.3.3/1.3.5)', () => {
    expect(m.nodes.some((n) => /[()]/.test(n.id))).toBe(false);
  });

  it('links a samplable to its weighting/sampling calls (§2.3.4)', () => {
    expect(hasEdge(m, 'gun_dist', 'gun_dist_weighting_call', 'call')).toBe(true);
    expect(hasEdge(m, 'gun_dist', 'gun_dist_sampling_call', 'call')).toBe(true);
  });

  it('resolves function_call input/output references and roots the workspace', () => {
    expect(hasEdge(m, 'transport_call', 'y', 'output')).toBe(true);
    expect(hasEdge(m, 'post_call', 'y', 'input')).toBe(true); // y produced by transport_call, consumed by post_call
    expect(m.roots).toContain('analysis_ws');
    expect(errors(m)).toEqual([]);
  });
});

describe('XS3 metadata is sanitized against prototype pollution', () => {
  it('strips a nested __proto__ key and leaves Object.prototype clean', () => {
    const m = fromXs3Json(JSON.stringify({
      metadata: { author: 'x', nested: { '__proto__': { polluted: 1 }, ok: 2 } },
      a: { id: 'a', type: 'data' },
    }));
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(m.meta['author']).toBe('x');
    const nested = (m.meta as Record<string, Record<string, unknown>>).nested;
    expect(nested.ok).toBe(2);
    expect(Object.getPrototypeOf(nested)).toBeNull();
  });
});
