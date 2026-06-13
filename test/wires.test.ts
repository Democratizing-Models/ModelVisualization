// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { offsetOverlaps, wirePath, type Pt } from '../src/render/wires.js';

describe('offsetOverlaps', () => {
  it('separates overlapping horizontal runs onto distinct lanes', () => {
    // Each poly: down, across (horizontal mid-segment at y=50), down.
    const a: Pt[] = [{ x: 0, y: 0 }, { x: 0, y: 50 }, { x: 100, y: 50 }, { x: 100, y: 100 }];
    const b: Pt[] = [{ x: 20, y: 0 }, { x: 20, y: 50 }, { x: 120, y: 50 }, { x: 120, y: 100 }];
    offsetOverlaps([a, b]);
    expect(a[1].y).not.toBe(b[1].y); // the horizontal runs no longer share a row
    expect(a[1].y).toBe(a[2].y);     // each run stays horizontal (both ends moved together)
    expect(b[1].y).toBe(b[2].y);
  });

  it('leaves non-overlapping horizontals alone', () => {
    const a: Pt[] = [{ x: 0, y: 0 }, { x: 0, y: 50 }, { x: 40, y: 50 }, { x: 40, y: 100 }];
    const b: Pt[] = [{ x: 200, y: 0 }, { x: 200, y: 50 }, { x: 240, y: 50 }, { x: 240, y: 100 }];
    offsetOverlaps([a, b]);
    expect(a[1].y).toBe(50);
    expect(b[1].y).toBe(50);
  });
});

describe('wirePath', () => {
  it('renders a straight two-point segment', () => {
    expect(wirePath([{ x: 0, y: 0 }, { x: 0, y: 100 }])).toBe('M0 0 L0 100');
  });

  it('rounds an interior corner with a constant-radius arc', () => {
    const d = wirePath([{ x: 5, y: 7 }, { x: 5, y: 90 }, { x: 80, y: 90 }]);
    expect(d.startsWith('M5 7')).toBe(true);
    const arc = d.match(/A(\d+(?:\.\d+)?) /); // "A<r> ..."
    expect(arc).toBeTruthy();
    expect(Number(arc![1])).toBeCloseTo(8, 5); // radius == BEND_R (segments long enough)
  });

  it('uses the same radius on a 45° bend as on a 90° bend', () => {
    const ninety = wirePath([{ x: 0, y: 0 }, { x: 0, y: 100 }, { x: 100, y: 100 }]);
    const fortyfive = wirePath([{ x: 0, y: 0 }, { x: 0, y: 100 }, { x: 100, y: 200 }]);
    const r = (d: string): number => Number(d.match(/A(\d+(?:\.\d+)?) /)![1]);
    expect(r(ninety)).toBeCloseTo(r(fortyfive), 5);
  });
});
