// The snow you clear: a flat-shaded heightfield over the 0.5 m snow grid (world.ts). Vertex colours carry the look
// from the art bible: blue moonlit snow, darker mauve packed road where the plough has been, and warm peach pools
// around every lit lamp (faked in the colours, so dozens of lamps cost nothing).
import * as THREE from 'three/webgpu';
import { attribute } from 'three/tsl';
import { style } from './engine/style.ts';
import { CLEAR, GH, GW, X0, Z0, CELL, cellIndex, tileAt, type Snow } from './world.ts';

/** A warm light pool on the snow (Gaussian falloff). */
export interface Lamp {
  x: number;
  z: number;
  on: boolean;
  strength?: number;
  sigma?: number;
}

const HEIGHT = 0.4; // metres of snow per depth unit
const GLOW = 0.4; // emissive strength of a full lamp pool: warm under the moon, but just under the bloom threshold (0.35 luminance), so pools light the snow without hazing the streets
const VW = GW + 1;
const VH = GH + 1;
const col = (k: string) => new THREE.Color(style.palette[k]);
const SNOW = col('snow');
const STREET = col('snowStreet'); // street snow is warmer lilac than the yards and fields (frames 1-8)
const ROAD = col('road');
const HEAP = col('snowRim'); // banked snow is the brightest white in the frames, framing the darker lane
const LIT = col('snowLit');
const TYRE = col('road').multiplyScalar(0.5); // tyre lines pressed into the cleared lane
// Untouched snow gets a soft low-frequency light/dark drift (+-12%, 4 m cells) so open ground reads as rolling
// snow, not a flat sheet that looks like sky behind the square. Deterministic: a hash, not the game RNG.
const hash = (x: number, y: number): number => {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
function drift(i: number, j: number): number {
  const N = 8; // cells per noise cell
  const x = i / N;
  const y = j / N;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = smooth(0, 1, x - x0);
  const fy = smooth(0, 1, y - y0);
  const a = hash(x0, y0) + (hash(x0 + 1, y0) - hash(x0, y0)) * fx;
  const b = hash(x0, y0 + 1) + (hash(x0 + 1, y0 + 1) - hash(x0, y0 + 1)) * fx;
  return (a + (b - a) * fy) * 2 - 1;
}
const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function createSnowMesh(snow: Snow) {
  const pos = new Float32Array(VW * VH * 3);
  const color = new Float32Array(VW * VH * 3);
  const glow = new Float32Array(VW * VH * 3); // emitted lamp light: pools stay warm under the blue moonlight
  const light = new Float32Array(VW * VH); // 0..1 warm lamp light per vertex
  for (let j = 0; j < VH; j++)
    for (let i = 0; i < VW; i++) {
      const v = j * VW + i;
      pos[v * 3] = X0 + i * CELL;
      pos[v * 3 + 2] = Z0 + j * CELL;
    }
  const index: number[] = [];
  for (let j = 0; j < GH; j++)
    for (let i = 0; i < GW; i++) {
      const a = j * VW + i;
      // alternate the diagonal so the flat-shaded facets don't all lean one way
      if ((i + j) % 2) index.push(a, a + VW, a + 1, a + 1, a + VW, a + VW + 1);
      else index.push(a, a + VW, a + VW + 1, a, a + VW + 1, a + 1);
    }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(color, 3));
  geo.setAttribute('glow', new THREE.BufferAttribute(glow, 3));
  geo.setIndex(index);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), Math.hypot(GW, GH) * CELL);
  // smooth shading: ploughed ridges read as soft rolled snow, not crumpled facets
  const mat = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
  mat.emissiveNode = attribute('glow', 'vec3');
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'Snow';
  mesh.receiveShadow = true;
  mesh.castShadow = true;

  const c = new THREE.Color();
  const street = new THREE.Color();
  const square = new THREE.Color();
  // how much of the area round each vertex is street (7 x 7 cells, ~3 m): the warmer street snow fades into the
  // fields over a few metres instead of stopping at a ruler-straight edge
  const streetW = new Float32Array(VW * VH);
  for (let j = 0; j < VH; j++)
    for (let i = 0; i < VW; i++) {
      let r = 0;
      let n = 0;
      for (let cj = j - 4; cj < j + 3; cj++)
        for (let ci = i - 4; ci < i + 3; ci++) {
          if (ci < 0 || cj < 0 || ci >= GW || cj >= GH) continue;
          r += snow.road[cellIndex(ci, cj)]!;
          n++;
        }
      streetW[j * VW + i] = n ? r / n : 0;
    }
  function vertex(i: number, j: number): void {
    let d = 0;
    let n = 0;
    let road = 0;
    let tyre = 0;
    for (const [ci, cj] of [[i - 1, j - 1], [i, j - 1], [i - 1, j], [i, j]] as const) {
      if (ci < 0 || cj < 0 || ci >= GW || cj >= GH) continue;
      const k = cellIndex(ci, cj);
      d += snow.depth[k]!;
      road += snow.road[k]!;
      tyre += snow.tyre[k]!;
      n++;
    }
    d /= n;
    const edge = i === 0 || j === 0 || i === GW || j === GH;
    const v = j * VW + i;
    // yard snow (no road cell touches this vertex) rolls gently, so far fields shade like ground, not a flat sky
    // the edge row keeps its snow height: the field outside (createFieldMesh) starts at that height, so there is no
    // step down to the ground round the map (it read as a horizon line)
    const roll = road === 0 && !edge ? 0.22 * (drift(i + 37, j + 11) + 0.5 * drift(2 * i + 5, 2 * j + 3)) : 0;
    pos[v * 3 + 1] = 0.02 + d * HEIGHT + Math.max(0, roll + 0.15);
    const s = smooth(CLEAR - 0.15, CLEAR + 0.15, d);
    const base = street.copy(SNOW).lerp(STREET, streetW[v]!).multiplyScalar(1 + 0.12 * drift(i, j));
    // the square is trodden snow, not packed road (crops/square.png): it starts from the street snow colour
    const ground = tileAt(X0 + i * CELL, Z0 + j * CELL) === 'S' ? square.copy(STREET).lerp(HEAP, 0.35) : square.copy(ROAD);
    c.copy(ground).lerp(TYRE, Math.min(1, tyre / 2)).lerp(base, s).lerp(HEAP, smooth(1.05, 1.6, d) * (road / n));
    // the packed lane takes less of the lamp colour than fresh snow, so a cleared lane reads inside a warm pool too
    const lit = Math.min(1, light[v]!) * (0.2 + 0.8 * s);
    c.lerp(LIT, lit * 0.6); // lit snow turns pale lilac-pink (keyart's lit snow, L ~0.67), with a little added glow below
    color[v * 3] = c.r;
    color[v * 3 + 1] = c.g;
    color[v * 3 + 2] = c.b;
    const e = lit * GLOW;
    glow[v * 3] = LIT.r * e;
    glow[v * 3 + 1] = LIT.g * e;
    glow[v * 3 + 2] = LIT.b * e;
  }
  const markDirty = () => {
    for (const a of ['position', 'color', 'glow']) geo.getAttribute(a).needsUpdate = true;
  };
  function all(): void {
    for (let j = 0; j < VH; j++) for (let i = 0; i < VW; i++) vertex(i, j);
    markDirty();
    geo.computeVertexNormals();
  }
  return {
    mesh,
    /** Recompute the vertices around cells changed since the last sync (call from render). */
    sync() {
      if (!snow.dirty.size) return;
      for (const k of snow.dirty) {
        const i = k % GW;
        const j = (k - i) / GW;
        vertex(i, j);
        vertex(i + 1, j);
        vertex(i, j + 1);
        vertex(i + 1, j + 1);
      }
      snow.dirty.clear();
      markDirty();
      geo.computeVertexNormals(); // ~24k triangles: well under 1 ms, and only on frames the snow changed
    },
    /**
     * Warm pools: lamps = [{ x, z, on, strength }]. Gaussian falloff, ~2.4 m sigma. Rebuilds the whole field and
     * re-uploads the mesh: fine for events (a path opening, the festival) on this 108 x 108 grid, not per frame.
     */
    setLamps(lamps: readonly Lamp[]) {
      light.fill(0);
      for (const l of lamps) {
        if (!l.on) continue;
        const r = 3 * (l.sigma ?? 2.4);
        const i0 = Math.max(0, Math.floor((l.x - r - X0) / CELL));
        const i1 = Math.min(GW, Math.ceil((l.x + r - X0) / CELL));
        const j0 = Math.max(0, Math.floor((l.z - r - Z0) / CELL));
        const j1 = Math.min(GH, Math.ceil((l.z + r - Z0) / CELL));
        for (let j = j0; j <= j1; j++)
          for (let i = i0; i <= i1; i++) {
            const dx = X0 + i * CELL - l.x;
            const dz = Z0 + j * CELL - l.z;
            const v = j * VW + i;
            const s = l.sigma ?? 2.4;
            light[v] = Math.min(1, light[v]! + (l.strength ?? 1) * Math.exp(-(dx * dx + dz * dz) / (2 * s * s)));
          }
      }
      all();
    },
    all,
  };
}

/**
 * The snowfield beyond the map edge (visual only): gently rolling, with the same blue and the same drift as the yards.
 * A flat field there shaded as one even colour and read as sky behind the square. Inside the map it sits just under
 * the heightfield, so it never shows through the streets.
 */
export function createFieldMesh(margin = 30, step = 2) {
  const x0 = X0 - margin;
  const z0 = Z0 - margin;
  const n = Math.ceil((GW * CELL + 2 * margin) / step);
  const m = Math.ceil((GH * CELL + 2 * margin) / step);
  const geo = new THREE.PlaneGeometry(n * step, m * step, n, m).rotateX(-Math.PI / 2);
  geo.translate(x0 + (n * step) / 2, 0, z0 + (m * step) / 2);
  const pos = geo.getAttribute('position');
  const color = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let v = 0; v < pos.count; v++) {
    const x = pos.getX(v);
    const z = pos.getZ(v);
    const ci = (x - X0) / CELL;
    const cj = (z - Z0) / CELL;
    // distance outside the map (m): 0 at the edge, so the field rises out of the heightfield's edge row
    const out = Math.max(-ci, ci - GW, -cj, cj - GH, 0) * CELL;
    const roll = 0.7 * (drift(ci / 2 + 37, cj / 2 + 11) + 0.4 * drift(ci + 5, cj + 3)) + 0.5;
    const EDGE = 0.02 + 0.6 * HEIGHT; // yard snow height at the map edge
    pos.setY(v, out > 0 ? EDGE + Math.min(1, out / 4) * Math.max(0, roll) : -0.1);
    c.copy(SNOW).multiplyScalar(1 + 0.12 * drift(ci, cj));
    color.set([c.r, c.g, c.b], v * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(color, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 }));
  mesh.name = 'Field';
  mesh.receiveShadow = true;
  return mesh;
}
