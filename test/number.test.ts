// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { formatNumber } from '../src/util/number.js';

describe('formatNumber', () => {
  it('formats integers and finite floats', () => {
    expect(formatNumber(42)).toBe('42');
    expect(formatNumber(3.14159265)).toBe('3.14159');
  });

  it('renders non-finite numbers as clear markers, not raw "NaN"/"Infinity"', () => {
    expect(formatNumber(Number.NaN)).toBe('NaN');
    expect(formatNumber(Number.POSITIVE_INFINITY)).toBe('∞');
    expect(formatNumber(Number.NEGATIVE_INFINITY)).toBe('−∞');
  });
});
