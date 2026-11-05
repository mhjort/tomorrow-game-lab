// One villager per house. They wait at their door until a cleared path joins it to the square, then walk there
// along that path, and gather in a ring around the fire pit. Logic only; meshes are synced in main.js.
import { HOUSES, SQUARE, cellIndex, cellOf, pathLength, pathToSquare } from './world.js';

export const WALK_SPEED = 1.3; // m/s (art bible: ~1.2 m/s, bouncy)
const YIELD = 2.6; // a villager waits while the plough is this close to the point just ahead of them
const RING = 3.5; // m from the fire (its stone ring is 2.3 m, plus the stones)

export function createVillagers() {
  return HOUSES.map((h) => ({
    house: h.index,
    state: 'waiting', // waiting → walking → arrived (→ cheering at the festival)
    x: h.wait.x,
    z: h.wait.z,
    yaw: Math.atan2(h.dir[0], h.dir[1]), // facing the street
    path: null,
    leg: 0,
    slot: -1,
    waited: 0,
  }));
}

/** Send villagers whose house just connected on their way. `reached` = Set of house indices connected now. */
export function startWalks(villagers, reached, snow, parent) {
  const started = [];
  for (const v of villagers)
    if (v.state === 'waiting' && reached.has(v.house)) {
      v.path = pathToSquare(snow, parent, HOUSES[v.house].wait, HOUSES[v.house].mouth);
      v.leg = 1;
      v.state = 'walking';
      started.push(v.house);
    }
  return started;
}

/** A street just opened: walkers on a long way round take the shortcut if it saves more than 4 m. */
export function replan(villagers, snow, parent) {
  for (const v of villagers) {
    if (v.state !== 'walking' || v.slot >= 0) continue;
    const cell = cellOf(v.x, v.z);
    if (parent[cellIndex(...cell)] === -1) continue; // standing on their doorstep: not on the network yet
    const rest = [{ x: v.x, z: v.z }, ...v.path.slice(v.leg)];
    const next = pathToSquare(snow, parent, { x: v.x, z: v.z }, cell);
    if (pathLength(next) < pathLength(rest) - 4) {
      v.path = next;
      v.leg = 1;
    }
  }
}

export function stepVillagers(villagers, plough, dt) {
  const arrivals = [];
  for (const v of villagers) {
    if (v.state !== 'walking') continue;
    // end of the path: walk on to a free slot in the ring around the tree
    if (v.leg >= v.path.length) {
      if (v.slot < 0) {
        // the free place in the ring nearest to where they enter the square (so they never cut across the fire pit)
        const taken = new Set(villagers.map((o) => o.slot));
        const enter = Math.atan2(v.z - SQUARE.z, v.x - SQUARE.x);
        const n = HOUSES.length;
        let best = 0;
        let bestD = Infinity;
        for (let k = 0; k < n; k++) {
          if (taken.has(k)) continue;
          const d = Math.abs(Math.atan2(Math.sin((k * 2 * Math.PI) / n - enter), Math.cos((k * 2 * Math.PI) / n - enter)));
          if (d < bestD) [best, bestD] = [k, d];
        }
        v.slot = best;
        const a = (best * 2 * Math.PI) / n;
        v.path.push({ x: SQUARE.x + Math.cos(a) * RING, z: SQUARE.z + Math.sin(a) * RING, last: true });
      } else {
        v.state = 'arrived';
        v.yaw = Math.atan2(SQUARE.x - v.x, SQUARE.z - v.z);
        arrivals.push(v.house);
        continue;
      }
    }
    const t = v.path[v.leg];
    const dx = t.x - v.x;
    const dz = t.z - v.z;
    const d = Math.hypot(dx, dz);
    const step = WALK_SPEED * dt;
    // don't walk under the plough
    const ax = v.x + (dx / (d || 1)) * 1.0;
    const az = v.z + (dz / (d || 1)) * 1.0;
    if (Math.hypot(plough.x - ax, plough.z - az) < YIELD) {
      v.waited += dt;
      continue;
    }
    if (d <= step) {
      v.x = t.x;
      v.z = t.z;
      v.leg++;
    } else {
      v.x += (dx / d) * step;
      v.z += (dz / d) * step;
      // turn smoothly towards the walking direction
      const want = Math.atan2(dx, dz);
      let diff = want - v.yaw;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      v.yaw += Math.sign(diff) * Math.min(Math.abs(diff), 8 * dt);
    }
  }
  return arrivals;
}
