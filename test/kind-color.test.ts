// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { kindColor, resetKindColors } from '../src/render/dom.js';

describe('kindColor', () => {
  it('is deterministic and returns a palette var', () => {
    expect(kindColor('distribution')).toBe(kindColor('distribution'));
    expect(kindColor('distribution')).toMatch(/^var\(--p[0-7]\)$/);
  });
  it('mutes unknown', () => {
    expect(kindColor('unknown')).toBe('var(--fg-dim)');
  });
  it('assigns distinct slots to distinct kinds within one model (no hash collisions)', () => {
    resetKindColors();
    // best-estimation has exactly these 8 kinds — all must get distinct colours.
    const kinds = ['data', 'constant', 'distribution', 'measure', 'kernel', 'likelihood', 'posterior', 'deterministic'];
    const slots = new Set(kinds.map(kindColor));
    expect(slots.size).toBe(kinds.length); // 8 distinct, no two share a slot
  });

  it('resets assignment per model', () => {
    resetKindColors();
    const first = kindColor('alpha'); // first kind seen → slot 0
    resetKindColors();
    const again = kindColor('beta');  // first kind seen after reset → slot 0
    expect(first).toBe(again);
  });
});
