// Simple putting bot: aims at per-hole waypoints, then the cup; power from the game's rolling model
// (distance ≈ v² / (2·0.9 m/s²), max speed 5 m/s, +energy to climb hole 3's 0.16 m ramp).
async (game, { maxShots = 40 } = {}) => {
  const ROLL = 0.9, MAX_V = 5;
  const waypoint = (s) => {
    if (s.hole === 2 && s.ball.z > -2.6) return [0, -3.1]; // dogleg corner
    if (s.hole === 2 && s.ball.x < 1.15) return [1.0, -3.5, 1.4]; // through the gap beside the bumper (+1.4 m carry)
    if (s.hole === 3 && s.ball.z > -2.1) return [s.ball.x > 0 ? 0.62 : -0.62, -2.6]; // around the guard
    return [s.cup.x, s.cup.z];
  };
  const shots = [];
  for (let i = 0; i < maxShots; i++) {
    const s = game.getState();
    if (s.phase === 'complete') break;
    if (s.phase !== 'aim') { game.step(10); continue; }
    const t = waypoint(s);
    const toCup = t[0] === s.cup.x && t[1] === s.cup.z;
    const d = Math.hypot(t[0] - s.ball.x, t[1] - s.ball.z) + (toCup ? 0.25 : t[2] ?? 0);
    const climb = s.hole === 3 && s.ball.z > -1.6 && t[1] < -1.6 ? 2 * 9.81 * 0.16 * 1.4 : 0;
    const power = Math.min(1, Math.sqrt(2 * ROLL * d + climb) / MAX_V);
    game.input({ type: 'shoot', target: t.slice(0, 2), power });
    shots.push({ hole: s.hole, target: t, power: +power.toFixed(3) });
    for (let k = 0; k < 150 && game.getState().phase === 'rolling'; k++) game.step(10);
    game.step(70);
  }
  return { phase: game.getState().phase, shots };
};
