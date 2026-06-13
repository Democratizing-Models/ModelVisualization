// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { kindColor } from '../src/render/dom.js';

describe('kindColor', () => {
  it('is deterministic and returns a palette var', () => {
    expect(kindColor('distribution')).toBe(kindColor('distribution'));
    expect(kindColor('distribution')).toMatch(/^var\(--p[0-7]\)$/);
  });
  it('mutes unknown', () => {
    expect(kindColor('unknown')).toBe('var(--fg-dim)');
  });
  it('gives different kinds (usually) different slots', () => {
    const slots = new Set(['data', 'function', 'likelihood', 'analysis', 'domain'].map(kindColor));
    expect(slots.size).toBeGreaterThan(1);
  });
});
