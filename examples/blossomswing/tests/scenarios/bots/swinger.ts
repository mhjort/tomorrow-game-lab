// Plays like a player with good timing, with the same action the keys produce: kick as the swing passes the
// bottom (once per half-swing), and once the valley is in bloom let go on a forward upswing at ~20°.
// args.stop: 'rows' (+ args.n) | 'bloom' | 'landed'; args.late = degrees past the bottom it kicks (worse timing);
// args.release = the upswing angle it lets go at (degrees); args.max = tick budget.
import type { GameHooks } from '../../../src/engine/testHooks.ts';
import type { Action, State } from '../../../src/main.ts';

async (game: GameHooks<State, Action>, { stop = 'landed', n = 1, max = 6000, late = 0, release = 20 }: { stop?: string; n?: number; max?: number; late?: number; release?: number } = {}) => {
  let st = game.getState();
  if (st.phase === 'title') game.input({ type: 'start' });
  game.step(1);
  st = game.getState();
  const t0 = st.tick;
  let bloomTick = -1;
  const done = (x: State): boolean =>
    (stop === 'rows' && x.rows >= n) || (stop === 'bloom' && x.rows >= x.rowsTotal) || (stop === 'landed' && x.phase === 'landed');
  while (!done(st) && st.tick - t0 < max) {
    const DT = 1 / 60;
    if (st.phase === 'swing') {
      if (st.rows >= st.rowsTotal && st.hint.includes('let go')) {
        if (bloomTick < 0) bloomTick = st.tick;
        // let go once the valley is fully pink (the hint shows), on the upswing at `release` degrees
        if (st.hint.includes('let go') && st.swing.omega > 0 && st.swing.deg >= release && st.swing.deg < release + 6) game.input({ type: 'kick' });
      } else if (st.swing.armed) {
        // about to cross the bottom (or `late` degrees past it)
        const next = st.swing.theta + st.swing.omega * DT;
        const lateRad = (late * Math.PI) / 180;
        const atRest = Math.abs(st.swing.omega) < 1e-3;
        const crossing = Math.sign(next - Math.sign(st.swing.omega) * lateRad) !== Math.sign(st.swing.theta - Math.sign(st.swing.omega) * lateRad);
        if (atRest || crossing) game.input({ type: 'kick' });
      }
    }
    game.step(1);
    st = game.getState();
  }
  return { phase: st.phase, ticks: st.tick - t0, bloomTicks: bloomTick < 0 ? null : bloomTick - t0, rows: st.rows, gusts: st.gusts, kicks: st.kicks, distance: st.leap.distance };
};
