/**
 * Pure octilinear (90°/45°) A* grid router. Finds a short path from a start to a
 * goal point that avoids the obstacle rectangles, preferring straight runs (turn
 * penalty) and spreading successive edges apart (shared usage penalty). Returns
 * simplified corner points in world coordinates. Format-agnostic, no DOM.
 */
export interface Rect { x: number; y: number; w: number; h: number; }
export interface Pt { x: number; y: number; }

const CLEAR = 6;       // obstacle inflation (px)
const TURN = 6;        // penalty (grid units) per corner — strongly prefer straight runs
const SHARE = 0.2;     // gentle penalty per prior edge using a cell (colour distinguishes overlaps)
const MAX_CELLS = 120_000;

// Orthogonal moves only — paths are horizontal/vertical (no diagonals).
const DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
];

export interface Router {
  /** Route from `start` to `goal`, stepping out of the endpoint nodes by `stub`
   *  px vertically first. Returns [start, ...corners, goal] in world coords. */
  route(start: Pt, goal: Pt, stub: number): Pt[];
}

class MinHeap {
  private pr: number[] = [];
  private v: number[] = [];
  get size(): number { return this.v.length; }
  push(p: number, val: number): void {
    this.pr.push(p); this.v.push(val);
    let i = this.v.length - 1;
    while (i > 0) {
      const par = (i - 1) >> 1;
      if (this.pr[par] <= this.pr[i]) break;
      this.swap(i, par); i = par;
    }
  }
  pop(): number {
    const top = this.v[0];
    const last = this.v.length - 1;
    this.swap(0, last); this.pr.pop(); this.v.pop();
    let i = 0; const n = this.v.length;
    for (;;) {
      let s = i; const l = 2 * i + 1, r = 2 * i + 2;
      if (l < n && this.pr[l] < this.pr[s]) s = l;
      if (r < n && this.pr[r] < this.pr[s]) s = r;
      if (s === i) break;
      this.swap(i, s); i = s;
    }
    return top;
  }
  private swap(a: number, b: number): void {
    const p = this.pr[a]; this.pr[a] = this.pr[b]; this.pr[b] = p;
    const w = this.v[a]; this.v[a] = this.v[b]; this.v[b] = w;
  }
}

export function makeRouter(width: number, height: number, obstacles: Rect[]): Router {
  // Pick a grid step that keeps the cell count bounded for large layouts.
  const grid = Math.max(12, Math.ceil(Math.sqrt((width * height) / MAX_CELLS)));
  const cols = Math.max(1, Math.ceil(width / grid) + 2);
  const rows = Math.max(1, Math.ceil(height / grid) + 2);
  const n = cols * rows;

  const blocked = new Uint8Array(n);
  for (const r of obstacles) {
    const x0 = Math.floor((r.x - CLEAR) / grid), x1 = Math.ceil((r.x + r.w + CLEAR) / grid);
    const y0 = Math.floor((r.y - CLEAR) / grid), y1 = Math.ceil((r.y + r.h + CLEAR) / grid);
    for (let iy = Math.max(0, y0); iy <= Math.min(rows - 1, y1); iy++) {
      for (let ix = Math.max(0, x0); ix <= Math.min(cols - 1, x1); ix++) blocked[iy * cols + ix] = 1;
    }
  }
  const usage = new Float32Array(n);

  const clampX = (x: number): number => Math.min(cols - 1, Math.max(0, Math.round(x / grid)));
  const clampY = (y: number): number => Math.min(rows - 1, Math.max(0, Math.round(y / grid)));

  // Direction-aware A*: a state is (cell, entry-direction) with NONE=4 for the
  // start, so the turn penalty is EXACT and the router truly minimises corners
  // (no staircase wiggle). State id = cell * 5 + dir.
  const NONE = 4;
  const astar = (sIdx: number, gIdx: number): number[] | null => {
    const size = n * 5;
    const gScore = new Float32Array(size).fill(Infinity);
    const came = new Int32Array(size).fill(-1);
    const closed = new Uint8Array(size);
    const gx = gIdx % cols, gy = (gIdx / cols) | 0;
    const h = (idx: number): number => Math.abs((idx % cols) - gx) + Math.abs(((idx / cols) | 0) - gy);
    const startState = sIdx * 5 + NONE;
    gScore[startState] = 0;
    const open = new MinHeap();
    open.push(h(sIdx), startState);
    let goalState = -1;
    while (open.size) {
      const st = open.pop();
      if (closed[st]) continue;
      closed[st] = 1;
      const cell = (st / 5) | 0, dir = st % 5;
      if (cell === gIdx) { goalState = st; break; }
      const cx = cell % cols, cy = (cell / cols) | 0;
      for (let di = 0; di < 4; di++) {
        const nx = cx + DIRS[di][0], ny = cy + DIRS[di][1];
        if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) continue;
        const ncell = ny * cols + nx;
        if (blocked[ncell]) continue;
        const nst = ncell * 5 + di;
        if (closed[nst]) continue;
        const turn = dir !== NONE && dir !== di ? TURN : 0;
        const tentative = gScore[st] + 1 + turn + usage[ncell] * SHARE;
        if (tentative < gScore[nst]) {
          gScore[nst] = tentative;
          came[nst] = st;
          open.push(tentative + h(ncell), nst);
        }
      }
    }
    if (goalState === -1) return null;
    const path: number[] = [];
    for (let st = goalState; st !== -1; st = came[st]) path.push((st / 5) | 0);
    path.reverse();
    return path;
  };

  const simplify = (pts: Pt[]): Pt[] => {
    if (pts.length <= 2) return pts;
    const out = [pts[0]];
    for (let i = 1; i < pts.length - 1; i++) {
      const a = out[out.length - 1], b = pts[i], c = pts[i + 1];
      if (Math.sign(b.x - a.x) !== Math.sign(c.x - b.x) || Math.sign(b.y - a.y) !== Math.sign(c.y - b.y)) {
        out.push(b);
      }
    }
    out.push(pts[pts.length - 1]);
    return out;
  };

  const route = (start: Pt, goal: Pt, stub: number): Pt[] => {
    const a = { x: start.x, y: start.y + stub }; // start node is above → step down
    const b = { x: goal.x, y: goal.y - stub };   // goal node is below → arrive from above
    const sIdx = clampY(a.y) * cols + clampX(a.x);
    const gIdx = clampY(b.y) * cols + clampX(b.x);
    const wasS = blocked[sIdx], wasG = blocked[gIdx];
    blocked[sIdx] = 0; blocked[gIdx] = 0; // endpoints must be walkable
    const cells = astar(sIdx, gIdx);
    blocked[sIdx] = wasS; blocked[gIdx] = wasG;
    if (!cells) return [start, goal];
    for (const c of cells) usage[c] += 1;
    const world = simplify(cells.map((c) => ({ x: (c % cols) * grid, y: ((c / cols) | 0) * grid })));
    const sx = start.x, gx = goal.x;

    // The grid path is snapped to grid columns; the exact ports are off-grid.
    // Slide the vertical run at each END onto the exact port x so the endpoint
    // segment is a clean vertical with no little grid-snap jog. (A single short
    // path collapses to a tidy Z.)
    const zigzag = (midY: number): Pt[] =>
      simplify([start, { x: sx, y: midY }, { x: gx, y: midY }, goal]);
    if (world.length <= 1) return zigzag(world.length ? world[0].y : Math.round((start.y + goal.y) / 2));

    let i = 0;
    while (i + 1 < world.length && world[i].x === world[i + 1].x) i++; // initial vertical run
    let k = world.length - 1;
    while (k - 1 >= 0 && world[k].x === world[k - 1].x) k--;            // final vertical run
    if (i >= k) return zigzag(world[0].y);
    for (let j = 0; j <= i; j++) world[j] = { x: sx, y: world[j].y };
    for (let j = k; j < world.length; j++) world[j] = { x: gx, y: world[j].y };
    return simplify([start, ...world, goal]);
  };

  return { route };
}
