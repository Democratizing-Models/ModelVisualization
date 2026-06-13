// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { findCycles, computeRoots, buildIndex, type Model, type ModelNode } from '../src/model/index.js';

function node(id: string): ModelNode {
  return { id, blockName: id, kind: 'unknown', type: 'unknown', raw: {} };
}

function model(ids: string[], edges: Array<[string, string]>, roots: string[] = []): Model {
  return {
    format: 'hs3',
    meta: {},
    nodes: ids.map(node),
    edges: edges.map(([from, to]) => ({ from, to, role: 'input' as const, port: 'x' })),
    diagnostics: [],
    roots,
  };
}

describe('graph operations', () => {
  it('computes roots as nodes nothing depends on', () => {
    const m = model(['a', 'b', 'c'], [['a', 'b'], ['a', 'c']]);
    expect(computeRoots(m, buildIndex(m)).map((n) => n.id)).toEqual(['a']);
  });

  it('surfaces the adapter root hint first, keeping other structural roots', () => {
    const m = model(['a', 'b', 'c'], [['a', 'b'], ['a', 'c']], ['b']);
    expect(computeRoots(m, buildIndex(m)).map((n) => n.id)).toEqual(['b', 'a']);
  });

  it('falls back to all nodes when every node has a dependent', () => {
    const m = model(['a', 'b'], [['a', 'b'], ['b', 'a']]);
    expect(computeRoots(m, buildIndex(m))).toHaveLength(2);
  });

  it('finds cycle entry points', () => {
    const m = model(['a', 'b', 'c'], [['a', 'b'], ['b', 'c'], ['c', 'a']]);
    expect(findCycles(m).length).toBeGreaterThan(0);
  });

  it('returns no cycles for a DAG', () => {
    const m = model(['a', 'b', 'c'], [['a', 'b'], ['b', 'c']]);
    expect(findCycles(m)).toEqual([]);
  });

  it('handles a deep chain without stack overflow (iterative)', () => {
    const ids = Array.from({ length: 20000 }, (_, i) => `n${i}`);
    const edges = ids.slice(0, -1).map((id, i): [string, string] => [id, ids[i + 1]]);
    const m = model(ids, edges);
    let cycles: string[] = [];
    expect(() => { cycles = findCycles(m); }).not.toThrow();
    expect(cycles).toEqual([]);
  });
});
