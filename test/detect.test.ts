// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { detectAndParse } from '../src/adapters/detect.js';

describe('format detection / routing', () => {
  it('routes a section-bearing HS3 doc to the HS3 adapter', () => {
    const m = detectAndParse('m.hs3', JSON.stringify({
      metadata: { hs3_version: '0.2' },
      distributions: [{ name: 'g', type: 'gaussian_dist', mean: 'mu' }],
    }));
    expect(m.format).toBe('hs3');
  });

  it('routes a metadata-only HS3 doc (no section arrays) to the HS3 adapter', () => {
    // Regression: metadata is the only required HS3 top-level; such a doc must
    // not be rejected as "unrecognized".
    const m = detectAndParse('m.hs3', JSON.stringify({ metadata: { hs3_version: '0.2' } }));
    expect(m.format).toBe('hs3');
  });

  it('rejects a JSON document that is neither sectioned nor metadata-shaped', () => {
    expect(() => detectAndParse('x.hs3', JSON.stringify([1, 2, 3]))).toThrow();
    expect(() => detectAndParse('x.hs3', JSON.stringify({ foo: 'bar' }))).toThrow();
  });

  it('throws a clear error on non-JSON input', () => {
    expect(() => detectAndParse('x.hs3', 'not json {')).toThrow(/parse/i);
  });
});
