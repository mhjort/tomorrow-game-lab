---
name: web-game-runtime
description: Scaffold and implement browser games with three.js WebGPURenderer (automatic WebGL2 fallback), Vite, a fixed-timestep loop, optional Rapier 3D/2D physics, GLB loading with collider tags, and a window.__game test-hook contract for headless playtesting. Use when starting a web game project or writing three.js/Rapier game code.
---

# web-game-runtime

## Scaffold
```bash
node <skill>/scripts/scaffold.mjs . --lab-bpy <blender-assets skill>/scripts/lab_bpy.py   # never overwrites existing files
pnpm install
```
The scaffold copies `index.html`, `vite.config.js`, `src/engine/*`, `design/style.json`, `tests/` and a `.gitignore`. Use the script rather than `cp -r`: agents' permission systems usually block recursive copies. Scripts:
- `pnpm dev`: development server
- `pnpm build`, then `pnpm preview`: production build and preview
- `pnpm assets`: Blender → GLB
- `pnpm media`: AI images + sound effects from `design/media.json` (the `generate-media` skill)
- `pnpm release`: optimized HTML5 build in `dist/` (minify, meshopt GLBs, budgets). Deploying is the `publish-web-game` skill.

`vite.config.js` is publish-ready: relative `base: './'`, three.js in its own chunk, and `vite-plugin-wasm` for Rapier's real `.wasm` (`@dimforge/rapier3d`, loaded lazily). Keep these settings.

Before you write any game code, check the starter scene boots on both backends with the `game-judge` playtest.

## Engine modules (`src/engine/`)
| module | provides |
|---|---|
| `renderer.js` | `createRenderer()` → `{ renderer, backend }`; `?renderer=webgl2` forces fallback; `TEST_MODE` (`?test`), `params` |
| `loop.js` | `createLoop({ update, render, renderer, hz })` fixed step (always pass `renderer`); auto-runs unless `?test`; `step(n)` for tests; frame stats |
| `physics.js` | `createPhysics({ gravity, hz, substeps })` → `{ RAPIER, world, step, sync, bind, onSensor, collidersFromGltf }` |
| `assets.js` | `loadModels(names, onProgress)`: all GLBs fetched **in parallel** with byte progress (uses `asset-manifest.json` in release builds), meshopt-aware; `loadModel(name)` returns a clone |
| `style.js` | `style` (design/style.json), `applyStyle(scene, renderer)` → `{ sun, hemi, refreshShadows }` (background, fog, hemi + sun w/ shadows, tone mapping), `paletteColor(role)` |
| `input.js` | `createInput(canvas)` → held `keys`, pointer `drag`, `on('dragstart' \| 'dragend', fn)` (`pointercancel` ends a drag as `{dx:0, dy:0, cancelled}`) |
| `audio.js` | `createAudio()` → `load(names, onProgress)` (`public/sfx/<name>.mp3`, parallel, decoded up front), `play(name, { volume, rate })`, `setMuted`, `counts` (plays per sound, also in `?test` where nothing is audible) |
| `loading.js` | `createLoadingScreen({ title, image })` → `parallel(label, [{ weight, run(progress) }])`, `step(label, weight, fn(progress))`, `done()`; `prewarm(renderer, scene, camera, roots, onProgress)` |
| `testHooks.js` | `installTestHooks({ backend, loop, getState, input })`, `createRng(seed)` |

Boot order in `main.js`:
1. `createLoadingScreen()`; it is shown first
2. **One parallel download phase:** `loading.parallel('Loading…', [createRenderer, createPhysics, loadModels(ALL_MODELS, p), audio.load(SFX, p), …])`. Every download (models, Rapier `.wasm`, audio, textures) starts at once. Never `await` one download before starting the next.
3. scene and camera, then `applyStyle` (lights must exist before prewarm)
4. build game objects from the loaded models
5. **prewarm all levels/materials** (`loading.step('Compiling shaders', …, p => prewarm(..., allLevelRoots, p))`)
6. build the first level (`collidersFromGltf`), then `installTestHooks`
7. `createLoop({ update, render, renderer })`, `loop.start()`, `loop.step(0)`, `loading.done()`, then `hooks.ready = true`

**Every game must have the loading screen and prewarm.** Lazy shader/pipeline compilation causes hitches the first time a level, effect or material appears.

## The `window.__game` contract (the playtests rely on it)
- `ready` is set after the first frame renders. `backend` is `'webgpu'` or `'webgl2'`.
- `step(n)` advances exactly n fixed ticks and renders once. With `?test` nothing advances unless asked, so runs are deterministic.
- `getState()` returns plain JSON: phase, score, level, player position and speed, and anything else a rule depends on.
- `input(action)` takes the **same** action objects the real controls produce. Add test helpers too: `loadLevel`, `reset`, `camera: 'overview'`.
- `stats()` returns realtime frame stats (`?test&realtime`).

## Rules for game code
- Gameplay state changes happen only in `update(dt)`. `render()` syncs meshes and draws.
- Use `createRng()` for randomness. Never use `Date.now()` or `performance.now()` in gameplay.
- Load levels from GLB plus named marker empties (Spawn, Goal…). Read them with `root.getObjectByName('Spawn').getWorldPosition(v)`.
- To change level, call `physics.removeBody(levelBody)`; it removes the colliders and sensor handlers too. Remove the old scene root, add the new one, then call `refreshShadows()` (from `applyStyle`). Prewarm must include every level, so the swap doesn't hitch.
- Support a `?level=N` deep link (read with `params` from `renderer.js`), so people reviewing the game can jump straight to a level.
- Controls: read a drag in the frame captured on `dragstart`, never against a camera that the drag itself moves (that is a feedback loop, and the view spins). Hold the camera still during the gesture. Add a dead zone. Test with **real** held `drag`/`key` playtest steps, not only `input()` actions. See `references/controls.md`.
- Use a DOM overlay (`#hud`) for the HUD; it is cheap and readable in screenshots. Show the controls on screen.
- Play sounds from gameplay events in `update()` (deterministic), never from `render()`. Put `sfx: { ...audio.counts }` in `getState()` so scenarios can assert on cues. Give players a mute key.
- Keep all code in `import * as THREE from 'three/webgpu'`. Use addons from `three/addons/...`. Never mix in `three` (the WebGL-only build).

## References (read when relevant)
- `references/rapier3d.md`: bodies, colliders, CCD, sensors, character control, the tuning gotchas
- `references/rapier2d.md`: switching to 2D physics (top-down/side-on games)
- `references/webgpu-notes.md`: WebGPURenderer, TSL materials, post-processing, fallback caveats
- `references/perf-budget.md`: targets and how to measure them
- `references/controls.md`: input/camera feel rules (feedback loops, dead zones, cancel, sensitivity) and how to test them with real input
