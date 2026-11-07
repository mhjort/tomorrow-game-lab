// Fixed-timestep game loop. Simulation runs at `hz`; rendering happens once per animation frame.
// In test mode (?test) the loop does not auto-run: the harness drives it with step(n).
import type * as THREE from 'three/webgpu';
import { TEST_MODE, params, advanceFrame } from './renderer.ts';

export interface LoopStats {
  frames: number;
  totalFrameMs: number;
  worstFrameMs: number;
}

export interface Loop {
  dt: number;
  stats: LoopStats;
  readonly tick: number;
  start(): void;
  stop(): void;
  /** Deterministically advance n fixed steps, then render once. */
  step(n?: number): number;
}

export interface LoopOptions {
  update: (dt: number, tick: number) => void;
  render: (alpha: number) => void;
  /** Pass it so test-mode step() counts as a real animation frame (fresh shadows, see advanceFrame). */
  renderer?: THREE.WebGPURenderer;
  hz?: number;
  maxSubSteps?: number;
}

export function createLoop({ update, render, renderer, hz = 60, maxSubSteps = 5 }: LoopOptions): Loop {
  const dt = 1 / hz;
  let acc = 0;
  let last = 0;
  let tick = 0;
  let running = false;
  const stats: LoopStats = { frames: 0, totalFrameMs: 0, worstFrameMs: 0 };

  function frame(now: number): void {
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
    step(n = 1) {
      for (let i = 0; i < n; i++) update(dt, tick++);
      if (renderer) advanceFrame(renderer);
      render(1);
      return tick;
    },
  };
}
