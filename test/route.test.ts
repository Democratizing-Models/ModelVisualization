// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { makeRouter, type Rect, type Pt } from '../src/render/route.js';

const inside = (r: Rect) => (p: Pt): boolean =>
  p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h;

describe('octilinear A* router', () => {
  it('returns the exact start and goal as the path endpoints', () => {
    const pts = makeRouter(400, 400, []).route({ x: 100, y: 50 }, { x: 100, y: 350 }, 16);
    expect(pts[0]).toEqual({ x: 100, y: 50 });
    expect(pts[pts.length - 1]).toEqual({ x: 100, y: 350 });
    expect(pts.length).toBeGreaterThanOrEqual(2);
  });

  it('routes around an obstacle instead of through it', () => {
    const obs: Rect = { x: 80, y: 150, w: 40, h: 60 }; // straddles the straight x=100 run
    const pts = makeRouter(400, 400, [obs]).route({ x: 100, y: 50 }, { x: 100, y: 350 }, 16);
    expect(pts.some(inside(obs))).toBe(false); // no point inside the box
    expect(pts.some((p) => Math.abs(p.x - 100) > 10)).toBe(true); // it detoured sideways
  });

  it('returns only axis-aligned segments even for off-grid endpoints', () => {
    const pts = makeRouter(400, 400, [{ x: 150, y: 150, w: 80, h: 60 }])
      .route({ x: 73, y: 30 }, { x: 217, y: 370 }, 16); // off-grid ports
    for (let i = 1; i < pts.length; i++) {
      const dx = Math.abs(pts[i].x - pts[i - 1].x), dy = Math.abs(pts[i].y - pts[i - 1].y);
      expect(dx < 0.5 || dy < 0.5).toBe(true); // each segment is horizontal or vertical
    }
  });

  it('uses minimal bends on a clear path (no staircase)', () => {
    const pts = makeRouter(400, 400, []).route({ x: 50, y: 30 }, { x: 200, y: 300 }, 16);
    // a clear L/Z route: at most a couple of corners, not a staircase
    expect(pts.length).toBeLessThanOrEqual(5);
  });

  it('is deterministic for the same inputs', () => {
    const obs: Rect = { x: 80, y: 150, w: 40, h: 60 };
    const run = (): string =>
      JSON.stringify(makeRouter(400, 400, [obs]).route({ x: 100, y: 50 }, { x: 100, y: 350 }, 16));
    expect(run()).toBe(run());
  });

  it('falls back to a straight segment when boxed in', () => {
    // goal fully enclosed by an obstacle the size of the canvas → no path
    const pts = makeRouter(200, 200, [{ x: 0, y: 0, w: 200, h: 200 }])
      .route({ x: 50, y: 20 }, { x: 50, y: 180 }, 16);
    expect(pts).toEqual([{ x: 50, y: 20 }, { x: 50, y: 180 }]);
  });
});
