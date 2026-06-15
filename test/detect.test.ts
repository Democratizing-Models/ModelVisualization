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

  it('routes the yaml-ish .xs3 format (non-JSON) to the XS3 adapter', () => {
    const src = '- a:\n    id: a\n    type: data\n';
    expect(detectAndParse('m.xs3', src).format).toBe('xs3');
  });

  it('routes the XS3 JSON concretization to the XS3 adapter (not HS3)', () => {
    const doc = JSON.stringify({ metadata: { 'XS3-version': '0.0.1' }, a: { id: 'a', type: 'data' } });
    expect(detectAndParse('m.json', doc).format).toBe('xs3');
  });

  it('keeps an HS3 doc (metadata + a typed object, no section arrays) on the HS3 adapter', () => {
    // Regression: a `type`/`id` field on some object must not hijack to XS3 when
    // an hs3_version marker is present.
    const doc = JSON.stringify({ metadata: { hs3_version: '0.2' }, foo: { type: 'gaussian_dist', id: 'x' } });
    expect(detectAndParse('m.hs3', doc).format).toBe('hs3');
  });

  it('does not mistake a plain markdown/yaml list for an XS3 model', () => {
    expect(() => detectAndParse('notes.txt', '- shopping: milk\n- todo: laundry\n')).toThrow(/no known format|unrecognized/i);
  });

  it('throws a clear error on unrecognized non-JSON input', () => {
    // JSON parsing is now non-fatal (some formats aren't JSON); unrecognized
    // input that matches no descriptor is rejected as unknown.
    expect(() => detectAndParse('x.hs3', 'not json {')).toThrow(/no known format|unrecognized/i);
  });
});
