// Fixed-timestep game loop. Simulation runs at `hz`; rendering happens once per animation frame.
// In test mode (?test) the loop does not auto-run: the harness drives it with step(n).
import { TEST_MODE, params } from './renderer.js';

export function createLoop({ update, render, hz = 60, maxSubSteps = 5 }) {
  const dt = 1 / hz;
  let acc = 0;
  let last = 0;
  let tick = 0;
  let running = false;
  const stats = { frames: 0, totalFrameMs: 0, worstFrameMs: 0 };

  function frame(now) {
    if (!running) return;
    const t0 = performance.now();
    const elapsed = last ? Math.min((now - last) / 1000, dt * maxSubSteps) : dt;
    last = now;
    acc += elapsed;
    while (acc >= dt) {
      update(dt, tick++);
      acc -= dt;
    }
    render(acc / dt);
    const ms = performance.now() - t0;
    stats.frames++;
    stats.totalFrameMs += ms;
    stats.worstFrameMs = Math.max(stats.worstFrameMs, ms);
    requestAnimationFrame(frame);
  }

  return {
    dt,
    stats,
    get tick() {
      return tick;
    },
    start() {
      // ?test pauses the loop; ?test&realtime keeps it running (used for perf sampling).
      if (TEST_MODE && !params.has('realtime')) return;
      running = true;
      requestAnimationFrame(frame);
    },
    stop() {
      running = false;
    },
    /** Deterministically advance n fixed steps, then render once. */
    step(n = 1) {
      for (let i = 0; i < n; i++) update(dt, tick++);
      render(1);
      return tick;
    },
  };
}
