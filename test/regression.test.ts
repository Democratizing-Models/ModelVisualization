// @vitest-environment node
// One test per cross-cutting review finding, to prove it stays fixed.
import { describe, it, expect } from 'vitest';
import { summarizeValue } from '../src/render/format.js';
import { detectAndParse, REGISTRY } from '../src/adapters/detect.js';
import { validate, type Model } from '../src/model/index.js';
import { fromHs3Json } from '../src/adapters/hs3.js';
import { scanStringLeaves } from '../src/util/refscan.js';

describe('Critical: summarizeArray must not spread large arrays', () => {
  it('summarizes a 1,000,000-element numeric array without RangeError', () => {
    const big = new Float64Array(1_000_000);
    for (let i = 0; i < big.length; i++) big[i] = i;
    const arr = Array.from(big);
    let out = '';
    expect(() => { out = summarizeValue(arr); }).not.toThrow();
    expect(out).toContain('array[1000000]');
    expect(out).toContain('min 0');
    expect(out).toContain('max 999999');
  });
});

describe('High: format dispatch is registry-scored', () => {
  it('routes a data-only HS3 file to the HS3 adapter', () => {
    const m = detectAndParse('m.hs3', JSON.stringify({ metadata: { hs3_version: '0.2' }, data: [{ name: 'd', type: 'unbinned' }] }));
    expect(m.format).toBe('hs3');
  });

  it('exposes label + samples for every registered format (single source for the UI)', () => {
    for (const d of REGISTRY) {
      expect(d.label).toBeTruthy();
      expect(d.samples.length).toBeGreaterThan(0);
      for (const s of d.samples) expect(s.path).toMatch(/^samples\//);
    }
  });
});

describe('Medium: validation pass is a separable seam', () => {
  const cyclic = (): Model => ({
    format: 'hs3',
    meta: {},
    nodes: [
      { id: 'a', blockName: 'a', kind: 'unknown', type: 't', raw: {} },
      { id: 'b', blockName: 'b', kind: 'unknown', type: 't', raw: {} },
    ],
    edges: [
      { from: 'a', to: 'b', role: 'input', port: 'x' },
      { from: 'b', to: 'a', role: 'input', port: 'x' },
    ],
    diagnostics: [],
    roots: [],
  });

  it('validate() flags cycles independently of build()', () => {
    const m = cyclic();
    validate(m);
    expect(m.diagnostics.some((d) => d.code === 'cycle')).toBe(true);
  });

  it('validate() flags a self-dependency', () => {
    const m: Model = {
      format: 'hs3', meta: {}, roots: [], diagnostics: [],
      nodes: [{ id: 'a', blockName: 'a', kind: 'unknown', type: 't', raw: {} }],
      edges: [{ from: 'a', to: 'a', role: 'input', port: 'self' }],
    };
    validate(m);
    expect(m.diagnostics.some((d) => d.code === 'self-dependency')).toBe(true);
  });
});

describe('Low(security): untrusted JSON keys cannot pollute the meta object', () => {
  // Assert on model.meta itself (the real attack surface), NOT global
  // Object.prototype — the latter is never polluted by these code paths so it
  // would pass vacuously. With a plain-object meta, a `__proto__` data key would
  // swap meta's prototype; the null-proto meta keeps it inert.
  it('HS3 metadata __proto__ key leaves meta inert (null proto, no inherited prop)', () => {
    const m = fromHs3Json('{"metadata":{"hs3_version":"0.2","__proto__":{"polluted":1}},"data":[{"name":"d","type":"unbinned"}]}');
    expect((m.meta as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.getPrototypeOf(m.meta)).toBeNull();
  });
});

describe('Low: deeply nested input does not overflow the stack', () => {
  it('scanStringLeaves walks deep nesting iteratively', () => {
    let obj: unknown = 'leaf';
    for (let i = 0; i < 100_000; i++) obj = { n: obj };
    const found: string[] = [];
    expect(() => scanStringLeaves(obj, (v) => found.push(v))).not.toThrow();
    expect(found).toContain('leaf');
  });
});
