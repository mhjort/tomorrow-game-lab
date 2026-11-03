---
name: web-game-runtime
description: Scaffold and implement browser games with three.js WebGPURenderer (automatic WebGL2 fallback), Vite, a fixed-timestep loop, optional Rapier 3D/2D physics, GLB loading with collider tags, and a window.__game test-hook contract for headless playtesting. Use when starting a web game project or writing three.js/Rapier game code.
---

# web-game-runtime

## Scaffold
```bash
node <skill>/scripts/scaffold.mjs . --lab-bpy <blender-assets skill>/scripts/lab_bpy.py   # never overwrites existing files
npm install
```
The scaffold copies `index.html`, `vite.config.js`, `src/engine/*`, `design/style.json`, `tests/` and a `.gitignore`. Use the script rather than `cp -r`: agents' permission systems usually block recursive copies. Scripts:
- `npm run dev`: development server
- `npm run build`, then `npm run preview`: production build and preview
- `npm run assets`: Blender → GLB

Before you write any game code, check the starter scene boots on both backends with the `game-judge` playtest.

## Engine modules (`src/engine/`)
| module | provides |
|---|---|
| `renderer.js` | `createRenderer()` → `{ renderer, backend }`; `?renderer=webgl2` forces fallback; `TEST_MODE` (`?test`), `params` |
| `loop.js` | `createLoop({ update, render, hz })` fixed step; auto-runs unless `?test`; `step(n)` for tests; frame stats |
| `physics.js` | `createPhysics({ gravity, hz, substeps })` → `{ RAPIER, world, step, sync, bind, onSensor, collidersFromGltf }` |
| `assets.js` | `loadModel(name)` / `loadModels([...])` from `public/models/<name>.glb` (cached, cloned, shadows on) |
| `style.js` | `style` (design/style.json), `applyStyle(scene, renderer)` (background, fog, hemi + sun w/ shadows, tone mapping), `paletteColor(role)` |
| `input.js` | `createInput(canvas)` → held `keys`, pointer `drag`, `on('dragend', fn)` |
| `testHooks.js` | `installTestHooks({ backend, loop, getState, input })`, `createRng(seed)` |

Boot order in `main.js`:
1. renderer, then scene and camera
2. `applyStyle`
3. physics
4. load assets, then build the level (`collidersFromGltf`)
5. `installTestHooks`
6. `loop.start()`
7. `loop.step(0)`, then `hooks.ready = true`

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
- To change level, call `physics.removeBody(levelBody)`; it removes the colliders and sensor handlers too. Remove the old scene root as well.
- Use a DOM overlay (`#hud`) for the HUD; it is cheap and readable in screenshots. Show the controls on screen.
- Keep all code in `import * as THREE from 'three/webgpu'`. Use addons from `three/addons/...`. Never mix in `three` (the WebGL-only build).

## References (read when relevant)
- `references/rapier3d.md`: bodies, colliders, CCD, sensors, character control, the tuning gotchas
- `references/rapier2d.md`: switching to 2D physics (top-down/side-on games)
- `references/webgpu-notes.md`: WebGPURenderer, TSL materials, post-processing, fallback caveats
- `references/perf-budget.md`: targets and how to measure them
