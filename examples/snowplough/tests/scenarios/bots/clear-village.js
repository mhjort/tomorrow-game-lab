// Clears every street the way a player would: only `drive` actions (throttle/steer). Pure pursuit along street
// centre lines (3.5 m lookahead, so corners are cut like a driver would), and three-point turns out of dead ends
// by reversing into a side street. Street centres: x = 6·col − 24, z = 6·row − 24 (village.json, 6 m tiles).
async (game, { log = false } = {}) => {
  const ROUTE = [
    { pts: [[0, 25], [0, -12], [-12, -12], [-12, -17.5]] }, // avenue (8 houses), row 2 west, up col 2 (house 3)
    { rev: true, pts: [[-12, -17.5], [-12, -14], [-8, -12]] }, // back out into row 2: now facing west
    { pts: [[-8, -12], [-12, -12], [-12, 17.5]] }, // down col 2 (houses 2, 6, 10)
    { rev: true, pts: [[-12, 17.5], [-12, 14], [-16, 12]] }, // back into row 6 west: now facing east
    { pts: [[-16, 12], [12, 12], [12, 17.5]] }, // row 6 east, down col 6 (house 13)
    { rev: true, pts: [[12, 17.5], [12, 14], [16, 12]] }, // back into row 6 east: now facing west
    { pts: [[16, 12], [12, 12], [12, -17.5]] }, // up col 6 (houses 16, 12, 8, 4)
    { rev: true, pts: [[12, -17.5], [12, -14], [17, -12]] }, // back out into the east end of row 2 and park there, off every walking route
  ];
  const LOOK = 3.5;
  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  // point at arc length s along the polyline, and the arc length of the closest point to (x, z)
  const along = (pts, s) => {
    for (let i = 1; i < pts.length; i++) {
      const [ax, az] = pts[i - 1];
      const [bx, bz] = pts[i];
      const len = Math.hypot(bx - ax, bz - az);
      if (s <= len || i === pts.length - 1) {
        const t = Math.min(1, s / len);
        return [ax + (bx - ax) * t, az + (bz - az) * t];
      }
      s -= len;
    }
  };
  const closest = (pts, x, z) => {
    let best = [Infinity, 0];
    let acc = 0;
    for (let i = 1; i < pts.length; i++) {
      const [ax, az] = pts[i - 1];
      const [bx, bz] = pts[i];
      const len = Math.hypot(bx - ax, bz - az);
      const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / (len * len)));
      const d = Math.hypot(ax + (bx - ax) * t - x, az + (bz - az) * t - z);
      if (d < best[0]) best = [d, acc + t * len];
      acc += len;
    }
    return { d: best[0], s: best[1], total: acc };
  };
  const legs = [];
  for (const { pts, rev } of ROUTE) {
    let ticks = 0;
    let s0 = 0;
    for (; ticks < 1500; ticks += 2) {
      const st = game.getState();
      if (st.phase === 'won' || st.phase === 'lost') break;
      const p = st.plough;
      const c = closest(pts, p.x, p.z);
      s0 = Math.max(s0, c.s);
      if (c.total - s0 < 0.8) break;
      const [tx, tz] = along(pts, Math.min(c.total, s0 + LOOK));
      const dx = tx - p.x;
      const dz = tz - p.z;
      const want = rev ? Math.atan2(-dx, dz) : Math.atan2(dx, -dz);
      const err = wrap(want - p.heading);
      const steer = Math.max(-1, Math.min(1, err * 2.2)) * (rev ? -1 : 1);
      const near = c.total - s0 < 3;
      const throttle = rev ? (near ? -0.5 : -1) : Math.abs(err) > 0.8 || near ? 0.5 : 1;
      game.input({ type: 'drive', throttle, steer });
      game.step(2);
    }
    // stop before changing direction
    for (let k = 0; k < 40 && Math.abs(game.getState().plough.speed) > 0.1; k++) {
      game.input({ type: 'drive', throttle: rev ? 1 : -1, steer: 0 });
      game.step(1);
    }
    const p = game.getState().plough;
    legs.push({ end: pts[pts.length - 1], rev: !!rev, ticks, at: [+p.x.toFixed(1), +p.z.toFixed(1)], reached: game.getState().reached });
  }
  game.input({ type: 'drive', throttle: 0, steer: 0 });
  for (let i = 0; i < 120 && game.getState().phase === 'play'; i++) game.step(30); // the last villagers walk over
  const s = game.getState();
  return { phase: s.phase, reached: s.reached, arrived: s.arrived, timeLeft: s.timeLeft, bumps: s.bumps, legs: log ? legs : legs.length };
};
