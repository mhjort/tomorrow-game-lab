// window.__game — the contract between the game and the game-judge playtest harness.
// Always installed (cheap); deterministic control only matters with ?test.
//
//   __game.ready          true once assets are loaded and the first frame rendered
//   __game.backend        'webgpu' | 'webgl2'
//   __game.step(n)        advance n fixed steps (1/60 s each) and render; returns tick
//   __game.getState()     JSON-serialisable game state (positions, score, phase, ...)
//   __game.input(action)  apply a high-level action, e.g. { type: 'shoot', angle, power }
//   __game.stats()        { frames, avgFrameMs, worstFrameMs } from the realtime loop
import { TEST_MODE, params } from './renderer.js';

/** Seeded PRNG (mulberry32). Use instead of Math.random for gameplay so tests are reproducible. */
export function createRng(seed = Number(params.get('seed') ?? 1)) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function installTestHooks({ backend, loop, getState, input }) {
  const api = {
    ready: false,
    testMode: TEST_MODE,
    backend,
    step: (n = 1) => loop.step(n),
    getState: () => JSON.parse(JSON.stringify(getState())),
    input: (action) => {
      const r = input(action);
      return r === undefined ? true : r;
    },
    stats: () => ({
      frames: loop.stats.frames,
      avgFrameMs: loop.stats.frames ? loop.stats.totalFrameMs / loop.stats.frames : 0,
      worstFrameMs: loop.stats.worstFrameMs,
    }),
  };
  window.__game = api;
  return api;
}
