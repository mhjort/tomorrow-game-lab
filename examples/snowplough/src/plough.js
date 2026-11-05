// The player's snowplough: a bicycle-model car with a blade that clears the snow grid it passes over.
// heading 0 faces -z (north, up the map); steering right turns clockwise seen from above.
import { CELL, CLEAR, GH, GW, cellIndex, cellOf, collideCircle, tileAt, isRoad, X0, Z0 } from './world.js';

export const PLOUGH = {
  length: 3.2,
  wheelbase: 2.0,
  maxSteer: 0.6, // rad at full lock -> ~2.9 m turning radius
  steerRate: 3.5, // rad/s the wheels turn
  topSpeed: 7, // m/s on cleared road
  snowDrag: 2.6, // top speed lost per unit of snow load (fresh snow, load ~1.15 -> ~4 m/s)
  minSpeed: 1.8, // the plough always crawls through, however deep
  accel: 5,
  brake: 10,
  coast: 2.5,
  reverseTop: 3,
  blade: { ahead: 1.85, width: 2.6, depth: 0.5 },
  body: [{ at: 0.8, r: 0.95 }, { at: -0.8, r: 0.95 }], // collision circles along the length
};

export function createPlough(start) {
  return { x: start.x, z: start.z, heading: start.heading, speed: 0, steer: 0, load: 0, bump: 0, cleared: 0 };
}

/**
 * One fixed step. controls = { throttle -1..1, steer -1..1 }. Clears snow under the blade into side windrows and
 * returns { removed, bumped } for sounds.
 */
export function stepPlough(p, controls, snow, dt) {
  const P = PLOUGH;
  // steering
  const want = Math.max(-1, Math.min(1, controls.steer)) * P.maxSteer;
  p.steer += Math.max(-P.steerRate * dt, Math.min(P.steerRate * dt, want - p.steer));
  // speed: the blade's snow load caps it
  const top = Math.max(P.minSpeed, P.topSpeed - P.snowDrag * p.load);
  const t = Math.max(-1, Math.min(1, controls.throttle));
  if (t > 0) p.speed = p.speed < 0 ? Math.min(0, p.speed + P.brake * dt) : Math.min(top, p.speed + P.accel * t * dt);
  else if (t < 0) p.speed = p.speed > 0 ? Math.max(0, p.speed - P.brake * dt) : Math.max(-P.reverseTop, p.speed + P.accel * t * dt);
  else p.speed -= Math.sign(p.speed) * Math.min(Math.abs(p.speed), P.coast * dt);
  if (p.speed > top) p.speed = Math.max(top, p.speed - P.brake * dt); // ploughing into deep snow slows you
  // move
  p.heading += (p.speed / P.wheelbase) * Math.tan(p.steer) * dt;
  const fx = Math.sin(p.heading);
  const fz = -Math.cos(p.heading);
  p.x += fx * p.speed * dt;
  p.z += fz * p.speed * dt;
  // collide (two circles along the body)
  let bumped = 0;
  const dir = Math.sign(p.speed) || 1; // travel direction: reversing into a wall is a bump too
  for (let it = 0; it < 2; it++)
    for (const c of P.body) {
      const push = collideCircle(p.x + fx * c.at, p.z + fz * c.at, c.r);
      if (push.x || push.z) {
        p.x += push.x;
        p.z += push.z;
        const n = Math.hypot(push.x, push.z);
        const into = -(dir * (fx * push.x + fz * push.z)) / n; // >0 when travelling into the wall
        if (it === 0 && into > 0.3) bumped = Math.max(bumped, Math.abs(p.speed) * into);
      }
    }
  if (bumped > 0) {
    p.lastBump = { before: p.speed, after: p.speed * 0.35 };
    p.speed *= 0.35;
  }
  // blade: clear the cells whose centres are inside it (only when driving forwards)
  let removed = 0;
  if (p.speed > 0.05) {
    const B = P.blade;
    const rx = Math.cos(p.heading); // right vector
    const rz = Math.sin(p.heading);
    const cx = p.x + fx * B.ahead;
    const cz = p.z + fz * B.ahead;
    const reach = B.width / 2 + CELL;
    const [i0, j0] = cellOf(cx - reach, cz - reach);
    const [i1, j1] = cellOf(cx + reach, cz + reach);
    for (let j = Math.max(0, j0); j <= Math.min(GH - 1, j1); j++)
      for (let i = Math.max(0, i0); i <= Math.min(GW - 1, i1); i++) {
        const k = cellIndex(i, j);
        if (!snow.road[k]) continue;
        const ox = X0 + (i + 0.5) * CELL - cx;
        const oz = Z0 + (j + 0.5) * CELL - cz;
        const side = ox * rx + oz * rz;
        const fwd = ox * fx + oz * fz;
        if (Math.abs(side) > B.width / 2 || Math.abs(fwd) > B.depth / 2) continue;
        const d = snow.depth[k];
        if (d <= 0.02) continue;
        removed += d;
        snow.set(k, 0);
        // push it off the ends of the blade: half left, half right
        for (const s of [-1, 1]) deposit(snow, cx + rx * s * (B.width / 2 + 0.4), cz + rz * s * (B.width / 2 + 0.4), d / 2, rx * s, rz * s);
      }
  }
  // the wheels leave two tyre lines in the cleared lane behind the blade (crops/plough.png, frames 1-2)
  if (p.speed > 0.05) {
    for (const s of [-1, 1]) {
      const [i, j] = cellOf(p.x + Math.cos(p.heading) * s * 0.7, p.z + Math.sin(p.heading) * s * 0.7);
      if (i >= 0 && j >= 0 && i < GW && j < GH) snow.track(cellIndex(i, j));
    }
  }
  // load = snow depth the blade is cutting: removed volume per metre driven, vs fresh snow (depth 1) across the blade
  const ds = Math.max(0, p.speed) * dt;
  const now = ds > 1e-4 ? removed / ((ds / CELL) * (P.blade.width / CELL)) : 0;
  // rows of cells are cut in bursts (one 0.5 m row every few ticks), so smooth first, then clamp
  p.load = Math.min(2, p.load + (now - p.load) * Math.min(1, dt * 5));
  p.cleared += removed;
  return { removed, bumped };
}

/** Drop pushed snow at (x, z), sliding further out (dx, dz) past cleared road so doorsteps stay clear. */
function deposit(snow, x, z, amount, dx, dz) {
  for (let step = 0; step < 4; step++) {
    const [i, j] = cellOf(x + dx * step * CELL, z + dz * step * CELL);
    if (i < 0 || j < 0 || i >= GW || j >= GH) return;
    const k = cellIndex(i, j);
    const d = snow.depth[k];
    if (!snow.road[k]) {
      // a heap in a yard (visual only): the yard is not part of any path
      if (!isRoad(tileAt(x + dx * step * CELL, z + dz * step * CELL))) snow.set(k, Math.min(2.2, d + amount * 0.5));
      return;
    }
    if (d >= CLEAR) {
      snow.set(k, Math.min(1.8, d + amount)); // a windrow on the snow still to clear
      return;
    }
    // cleared road: keep sliding outwards
  }
}
