/**
 * Wiring-diagram treatment for routed edge polylines (pure, no DOM):
 *  - offsetOverlaps: nudge overlapping horizontal runs into separate lanes so
 *    parallel wires don't sit on top of each other.
 *  - wirePath: render a polyline as an SVG path with rounded corners.
 */
export interface Pt { x: number; y: number; }

const BEND_R = 8;     // constant corner radius
const LANE_GAP = 7;
const EPS = 0.6;

/** Shift overlapping horizontal segments (same y, overlapping x) onto distinct
 *  lanes. Mutates the polylines. Segments touching an endpoint are left alone so
 *  wires stay attached to their node borders. */
export function offsetOverlaps(polys: Pt[][]): void {
  interface Seg { ei: number; i: number; x0: number; x1: number; }
  const byRow = new Map<number, Seg[]>();
  polys.forEach((P, ei) => {
    for (let i = 0; i < P.length - 1; i++) {
      const a = P[i], b = P[i + 1];
      if (Math.abs(a.y - b.y) > EPS || Math.abs(a.x - b.x) < EPS) continue; // not horizontal
      if (i === 0 || i + 1 === P.length - 1) continue;                      // touches an endpoint
      const key = Math.round(a.y);
      const seg = { ei, i, x0: Math.min(a.x, b.x), x1: Math.max(a.x, b.x) };
      const list = byRow.get(key); if (list) list.push(seg); else byRow.set(key, [seg]);
    }
  });
  for (const segs of byRow.values()) {
    if (segs.length < 2) continue;
    segs.sort((p, q) => p.x0 - q.x0 || p.x1 - q.x1);
    const laneEnd: number[] = [];
    const lane = segs.map((s) => {
      let assigned = laneEnd.findIndex((end) => end < s.x0 - 1);
      if (assigned < 0) { assigned = laneEnd.length; laneEnd.push(s.x1); }
      else laneEnd[assigned] = s.x1;
      return assigned;
    });
    const lanes = lane.reduce((m, v) => Math.max(m, v), 0) + 1;
    if (lanes < 2) continue;
    segs.forEach((s, idx) => {
      const off = (lane[idx] - (lanes - 1) / 2) * LANE_GAP;
      if (off === 0) return;
      const P = polys[s.ei];
      P[s.i].y += off; P[s.i + 1].y += off;
    });
  }
}

/**
 * SVG path for a polyline with a CONSTANT bend radius at every corner. Each
 * corner is a circular arc of radius BEND_R; the tangent cutback `t = R·tan(δ/2)`
 * is derived from the turn angle so the radius stays fixed regardless of how
 * sharp the bend is. The cutback is clamped on very short segments (radius then
 * reduces only in that rare case).
 */
export function wirePath(P: Pt[]): string {
  const n = P.length;
  if (n < 2) return '';
  const unit = (a: Pt, b: Pt): { x: number; y: number; l: number } => {
    const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1;
    return { x: dx / l, y: dy / l, l };
  };

  let d = `M${P[0].x} ${P[0].y}`;
  for (let i = 1; i < n - 1; i++) {
    const inU = unit(P[i - 1], P[i]);
    const outU = unit(P[i], P[i + 1]);
    const dot = Math.max(-1, Math.min(1, inU.x * outU.x + inU.y * outU.y));
    const delta = Math.acos(dot); // deflection angle (0 = straight)
    if (delta < 1e-3) continue;   // collinear → no corner
    const tan = Math.tan(delta / 2);
    let t = BEND_R * tan;
    t = Math.min(t, inU.l / 2, outU.l / 2); // keep within the adjacent segments
    const r = t / tan;                       // = BEND_R unless t was clamped
    const c = P[i];
    const sweep = inU.x * outU.y - inU.y * outU.x > 0 ? 1 : 0; // turn direction (y-down)
    d += ` L${c.x - inU.x * t} ${c.y - inU.y * t}`;
    d += ` A${r} ${r} 0 0 ${sweep} ${c.x + outU.x * t} ${c.y + outU.y * t}`;
  }
  const last = P[n - 1];
  d += ` L${last.x} ${last.y}`;
  return d;
}

/** Apply lane-offset to a set of edges and render each to a path. */
export function wirePaths(edges: Array<{ points: Pt[] }>): string[] {
  const polys = edges.map((e) => e.points.map((p) => ({ x: p.x, y: p.y })));
  offsetOverlaps(polys);
  return polys.map((P) => wirePath(P));
}
