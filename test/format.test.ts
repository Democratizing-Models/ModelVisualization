// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { summarizeValue } from '../src/render/format.js';

describe('summarizeValue', () => {
  it('renders scalars', () => {
    expect(summarizeValue(null)).toBe('null');
    expect(summarizeValue(42)).toBe('42');
    expect(summarizeValue(3.14159265)).toBe('3.14159');
    expect(summarizeValue('hello')).toBe('hello');
    expect(summarizeValue(true)).toBe('true');
    expect(summarizeValue(undefined)).toBe('undefined');
  });

  it('summarizes a numeric array with min/max and head truncation', () => {
    expect(summarizeValue([1, 2, 3])).toBe('array[3] [1, 2, 3]  ⟂ min 1, max 3');
    const s = summarizeValue([5, 4, 3, 2, 1, 0, -1], 3);
    expect(s).toContain('array[7] [5, 4, 3, …]');
    expect(s).toContain('min -1, max 5');
  });

  it('omits min/max for a non-numeric or empty array', () => {
    expect(summarizeValue(['a', 'b'])).toBe('array[2] [a, b]');
    expect(summarizeValue([])).toBe('array[0] []');
    expect(summarizeValue([1, 'x', 2])).not.toContain('min');
  });

  it('summarizes an object by its keys, truncated', () => {
    expect(summarizeValue({ a: 1, b: 2 })).toBe('{ a, b }');
    expect(summarizeValue({ a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7 })).toBe('{ a, b, c, d, e, f, … }');
  });

  it('does not spread a very large array (no RangeError)', () => {
    const big = Array.from({ length: 1_000_000 }, (_, i) => i);
    let out = '';
    expect(() => { out = summarizeValue(big); }).not.toThrow();
    expect(out).toContain('array[1000000]');
    expect(out).toContain('min 0, max 999999');
  });
});
