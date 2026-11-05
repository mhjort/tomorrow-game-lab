// The village as data: tiles from village.json, a 0.5 m snow grid, collisions, and which doors connect to the square.
// Coordinates are three.js world metres: map col -> +x, row -> +z, the village centred on the origin.
// Pure logic (no three.js): the plough, villagers and snow mesh all read from it.
import villageJson from './village.json';

/** Shape of village.json (also read by assets/src/village.py). */
interface Village {
  about: string;
  tile: number;
  rows: string[];
}
const village: Village = villageJson;

export interface Point {
  x: number;
  z: number;
}
/** A grid cell [i, j]. */
export type Cell = [number, number];
export type Facing = 'e' | 'w' | 'n' | 's';
export interface House {
  index: number;
  r: number;
  c: number;
  facing: Facing;
  dir: [number, number];
  door: Point;
  wait: Point;
  stub: Cell[];
  mouth: Cell;
}
export type Snow = ReturnType<typeof createSnow>;

export const TILE = village.tile;
export const ROWS = village.rows;
export const H = ROWS.length;
export const W = ROWS[0]!.length;
export const CELL = 0.5;
const PER = TILE / CELL; // cells per tile
export const GW = W * PER;
export const GH = H * PER;
export const X0 = (-W * TILE) / 2;
export const Z0 = (-H * TILE) / 2;
export const CLEAR = 0.35; // depth below which a cell counts as cleared (walkable)
export const DIRS: Record<Facing, [number, number]> = { e: [1, 0], w: [-1, 0], n: [0, -1], s: [0, 1] };
const isFacing = (ch: string): ch is Facing => ch in DIRS;
const row = (r: number): string => ROWS[r] ?? '';

export const tileAt = (x: number, z: number): string => {
  const c = Math.floor((x - X0) / TILE);
  const r = Math.floor((z - Z0) / TILE);
  return r >= 0 && r < H && c >= 0 && c < W ? row(r)[c] ?? '#' : '#';
};
export const isRoad = (ch: string): boolean => ch === '.' || ch === 'S' || ch === 'P';
export const tileCenter = (r: number, c: number): Point => ({ x: X0 + (c + 0.5) * TILE, z: Z0 + (r + 0.5) * TILE });
export const cellIndex = (i: number, j: number): number => j * GW + i;
export const cellOf = (x: number, z: number): Cell => [Math.floor((x - X0) / CELL), Math.floor((z - Z0) / CELL)];
export const cellCenter = (i: number, j: number): Point => ({ x: X0 + (i + 0.5) * CELL, z: Z0 + (j + 0.5) * CELL });
const cellTile = (i: number, j: number): string => row(Math.floor(j / PER))[Math.floor(i / PER)] ?? '#';

/** Houses in reading order: door point, the shovelled stub of cells in front of it, and where the villager waits. */
export const HOUSES: House[] = [];
for (let r = 0; r < H; r++)
  for (let c = 0; c < W; c++) {
    const ch = row(r)[c] ?? '#';
    if (!isFacing(ch)) continue;
    const [dx, dz] = DIRS[ch];
    const t = tileCenter(r, c);
    const door = { x: t.x + dx * 2.0, z: t.z + dz * 2.0 };
    // the doorstep path the villager shovelled: 1.5 m wide, 2 m into the street
    const stub: Cell[] = [];
    for (let a = 0.25; a < 2.0; a += CELL)
      for (let b = -0.5; b <= 0.5; b += CELL) {
        const x = t.x + dx * (TILE / 2 + a) + (dz ? b : 0);
        const z = t.z + dz * (TILE / 2 + a) + (dx ? b : 0);
        stub.push(cellOf(x, z));
      }
    const doorSide = HOUSES.length; // index
    HOUSES.push({ index: doorSide, r, c, facing: ch, dir: [dx, dz], door, wait: { x: t.x + dx * 2.7, z: t.z + dz * 2.7 }, stub, mouth: cellOf(t.x + dx * (TILE / 2 + 1.75), t.z + dz * (TILE / 2 + 1.75)) });
  }

const sq: Point[] = [];
for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) if (row(r)[c] === 'S') sq.push(tileCenter(r, c));
export const SQUARE = { x: sq.reduce((s, p) => s + p.x, 0) / sq.length, z: sq.reduce((s, p) => s + p.z, 0) / sq.length };
const startTile = ((): Point => {
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) if (row(r)[c] === 'P') return tileCenter(r, c);
  throw new Error('village.json has no start tile P');
})();
export const START = { x: startTile.x, z: startTile.z + 1, heading: 0 };

/** Snow depth per cell (1 = fresh snow on a street, ~0.4 m). Roads start full, the square and doorsteps clear. */
export function createSnow() {
  const depth = new Float32Array(GW * GH);
  const road = new Uint8Array(GW * GH);
  const tyre = new Uint8Array(GW * GH); // cells the plough's wheels have rolled over (visual: tyre lines in the lane)
  const fill = () => {
    tyre.fill(0);
    for (let j = 0; j < GH; j++)
      for (let i = 0; i < GW; i++) {
        const ch = cellTile(i, j);
        const k = cellIndex(i, j);
        road[k] = isRoad(ch) ? 1 : 0;
        depth[k] = ch === 'S' ? 0 : isRoad(ch) ? 1 : ch === 'T' ? 1.3 : 0.6;
      }
    for (const h of HOUSES) for (const [i, j] of h.stub) depth[cellIndex(i, j)] = 0;
    // a trodden apron 2 m into the streets around the square: a pass along any street beside it connects
    for (let j = 0; j < GH; j++)
      for (let i = 0; i < GW; i++) {
        const k = cellIndex(i, j);
        if (!road[k] || depth[k] === 0) continue;
        const { x, z } = cellCenter(i, j);
        for (const [dx, dz] of [[2, 0], [-2, 0], [0, 2], [0, -2]] as const)
          if (tileAt(x + dx, z + dz) === 'S') depth[k] = 0;
      }
  };
  fill();
  const roadCells = road.reduce((s, v) => s + v, 0);
  return {
    depth,
    road,
    tyre,
    dirty: new Set<number>(), // cell indices changed since the mesh last synced
    version: 0, // bumped on every change (connectivity is recomputed lazily)
    /** Fresh snowfall (restart). The mesh must re-sync everything (snowMesh.all()). */
    reset() {
      fill();
      this.dirty.clear();
      this.version++;
    },
    set(k: number, d: number) {
      if (depth[k] === d) return;
      depth[k] = d;
      this.dirty.add(k);
      this.version++;
    },
    /** A wheel rolled over cell k (cleared road only): the mesh draws a tyre line there. */
    track(k: number) {
      if (tyre[k] || !road[k] || depth[k]! >= CLEAR) return;
      tyre[k] = 1;
      this.dirty.add(k);
    },
    clearedFraction() {
      let n = 0;
      for (let k = 0; k < depth.length; k++) if (road[k] && depth[k]! < CLEAR) n++;
      return n / roadCells;
    },
  };
}

const walkable = (snow: Snow, k: number): boolean => !!snow.road[k] && snow.depth[k]! < CLEAR;

/**
 * Breadth-first search over cleared road cells from the square. Returns parent pointers (-1 = unreached, -2 = root),
 * so any reached cell can walk back to the square.
 */
export function reachFromSquare(snow: Snow): Int32Array {
  const parent = new Int32Array(GW * GH).fill(-1);
  const queue = new Int32Array(GW * GH);
  let head = 0;
  let tail = 0;
  for (let j = 0; j < GH; j++)
    for (let i = 0; i < GW; i++)
      if (cellTile(i, j) === 'S') {
        const k = cellIndex(i, j);
        parent[k] = -2;
        queue[tail++] = k;
      }
  while (head < tail) {
    const k = queue[head++]!;
    const i = k % GW;
    const j = (k - i) / GW;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const ni = i + di;
      const nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= GW || nj >= GH) continue;
      const n = cellIndex(ni, nj);
      if (parent[n] !== -1 || !walkable(snow, n)) continue;
      parent[n] = k;
      queue[tail++] = n;
    }
  }
  return parent;
}

/** Is the straight segment a→b on cleared road all the way (sampled every 0.25 m)? */
export function clearLine(snow: Snow, a: Point, b: Point): boolean {
  const n = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.25);
  for (let s = 0; s <= n; s++) {
    const [i, j] = cellOf(a.x + ((b.x - a.x) * s) / n, a.z + ((b.z - a.z) * s) / n);
    if (i < 0 || j < 0 || i >= GW || j >= GH || !walkable(snow, cellIndex(i, j))) return false;
  }
  return true;
}

/**
 * Path from `from` (a point) via cell `startCell` → … → the square, string-pulled to few waypoints.
 * For a house: from = where its villager waits, startCell = the mouth of its doorstep.
 */
export function pathToSquare(snow: Snow, parent: Int32Array, from: Point, startCell: Cell): Point[] {
  const cells: Point[] = [];
  for (let k = cellIndex(...startCell); k >= 0; k = parent[k]!) cells.push(cellCenter(k % GW, Math.floor(k / GW)));
  const pts = [from, ...cells];
  const out: Point[] = [from];
  let at = 1;
  while (at < pts.length) {
    let far = at;
    for (let k = pts.length - 1; k > at; k--)
      if (clearLine(snow, out[out.length - 1]!, pts[k]!)) {
        far = k;
        break;
      }
    out.push(pts[far]!);
    at = far + 1;
  }
  return out;
}

export const pathLength = (pts: readonly Point[]): number =>
  pts.reduce((s, p, i) => {
    const prev = pts[i - 1];
    return prev ? s + Math.hypot(p.x - prev.x, p.z - prev.z) : 0;
  }, 0);

// solid props standing on the square (assets/src/village.py): the fire pit's stone ring, and the four lamp posts
const PROPS = [{ x: SQUARE.x, z: SQUARE.z, r: 2.9 }, ...([[-6.5, 4], [6.5, 4], [-6.5, -4], [6.5, -4]] as const).map(([dx, dz]) => ({ x: SQUARE.x + dx, z: SQUARE.z + dz, r: 0.25 }))];

/** Push a circle out of solid tiles, the square's props and the map edge. Returns the push vector (0,0 if free). */
export function collideCircle(x: number, z: number, r: number): Point {
  let px = 0;
  let pz = 0;
  for (const o of PROPS) {
    const dx = x - o.x;
    const dz = z - o.z;
    const d = Math.hypot(dx, dz);
    if (d < r + o.r && d > 1e-6) {
      px += (dx / d) * (r + o.r - d);
      pz += (dz / d) * (r + o.r - d);
    }
  }
  const c0 = Math.floor((x - r - X0) / TILE);
  const c1 = Math.floor((x + r - X0) / TILE);
  const r0 = Math.floor((z - r - Z0) / TILE);
  const r1 = Math.floor((z + r - Z0) / TILE);
  for (let rr = r0; rr <= r1; rr++)
    for (let cc = c0; cc <= c1; cc++) {
      const solid = rr < 0 || cc < 0 || rr >= H || cc >= W || !isRoad(row(rr)[cc] ?? '#');
      if (!solid) continue;
      const minX = X0 + cc * TILE;
      const minZ = Z0 + rr * TILE;
      const qx = Math.max(minX, Math.min(x + px, minX + TILE));
      const qz = Math.max(minZ, Math.min(z + pz, minZ + TILE));
      const dx = x + px - qx;
      const dz = z + pz - qz;
      const d = Math.hypot(dx, dz);
      if (d >= r) continue;
      if (d > 1e-6) {
        px += (dx / d) * (r - d);
        pz += (dz / d) * (r - d);
      } else {
        // centre inside the tile: push out along the shortest axis
        const opts: [number, number][] = [[minX - r - (x + px), 0], [minX + TILE + r - (x + px), 0], [0, minZ - r - (z + pz)], [0, minZ + TILE + r - (z + pz)]];
        const [ox, oz] = opts.sort((a, b) => Math.hypot(...a) - Math.hypot(...b))[0]!;
        px += ox;
        pz += oz;
      }
    }
  return { x: px, z: pz };
}
