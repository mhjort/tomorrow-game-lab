---
name: web-game-runtime
description: Scaffold and implement browser games with three.js WebGPURenderer (automatic WebGL2 fallback), Vite, a fixed-timestep loop, optional Rapier 3D/2D physics, GLB loading with collider tags, and a window.__game test-hook contract for headless playtesting. Use when starting a web game project or writing three.js/Rapier game code.
---

# web-game-runtime

## Scaffold
```bash
node <skill>/scripts/scaffold.ts . --lab-bpy <blender-assets skill>/scripts/lab_bpy.py   # never overwrites existing files
pnpm install
```
The scaffold copies `index.html`, `vite.config.ts`, `tsconfig.json`, `src/engine/*`, `design/style.json`, `tests/` and a `.gitignore`. Use the script rather than `cp -r`: agents' permission systems usually block recursive copies. Scripts:
- `pnpm dev`: development server
- `pnpm typecheck`: strict TypeScript check (`tsc`, no emit); `pnpm build` runs it first
- `pnpm build`, then `pnpm preview`: production build and preview
- `pnpm assets`: Blender → GLB
- `pnpm media`: AI images, sound effects and music from `design/media.json` (the `generate-media` skill)
- `pnpm release`: optimized HTML5 build in `dist/` (minify, meshopt GLBs, budgets). Deploying is the `publish-web-game` skill.

`vite.config.ts` is publish-ready: relative `base: './'`, three.js in its own chunk, and `vite-plugin-wasm` for Rapier's real `.wasm` (`@dimforge/rapier3d`, loaded lazily). Keep these settings.

Before you write any game code, check the starter scene boots on both backends with the `game-judge` playtest.

## Engine modules (`src/engine/`)
| module | provides |
|---|---|
| `renderer.ts` | `createRenderer()` → `{ renderer, backend }`; `?renderer=webgl2` forces fallback; `TEST_MODE` (`?test`), `params` |
| `loop.ts` | `createLoop({ update, render, renderer, hz })` fixed step (always pass `renderer`); auto-runs unless `?test`; `step(n)` for tests; frame stats |
| `physics.ts` | `createPhysics({ gravity, hz, substeps })` → `{ RAPIER, world, step, sync, bind, onSensor, collidersFromGltf }` |
| `assets.ts` | `loadModels(names, onProgress)`: all GLBs fetched **in parallel** with byte progress (uses `asset-manifest.json` in release builds), meshopt-aware; `await loadModel(name)` returns a clone (rigged models: own skeleton, clips in `userData.animations`); for many instances, `preloadModels([name], p)` in the download phase, then clone |
| `animation.ts` | `createAnimator(model)` → `play(name, { loop, timeScale })` (cross-fades; repeat calls are no-ops), `scrub(name, u)` (hold a clip at 0..1 of its length, driven by game state: a pendulum's angle), `update(dt)` **in the fixed-step `update`**, `current`, `counts` (for `getState()`) |
| `style.ts` | `style` (design/style.json), `applyStyle(scene, renderer)` → `{ sun, hemi, refreshShadows, setTheme }` (background, fog, hemi + sun w/ shadows, tone mapping), `paletteColor(role)`; per-level looks: `"themes": { name: partial style }` in style.json, `setTheme(name)` (uniforms only, no recompiles), `themeStyle(name)` |
| `input.ts` | `createInput(canvas)` → held `keys`, pointer `drag`, `on('dragstart' \| 'dragend', fn)` (`pointercancel` ends a drag as `{dx:0, dy:0, cancelled}`) |
| `audio.ts` | `createAudio({ volume, musicVolume })` → `load(names, onProgress)` (`public/sfx/<name>.mp3`, parallel, decoded up front), `play(name, { volume, rate })`, `setMuted` (music too), `counts` (plays per sound, also in `?test` where nothing is audible); music: `loadMusic(names, p)` (`public/music/<name>.mp3` + loop `.json`), `playMusic(name, { volume })` (seamless loop, cross-fades, waits for the first gesture), `stopMusic()`, `music` (current name, for `getState()`), `trackInfo(name)` (bpm, loop) |
| `loading.ts` | `createLoadingScreen({ title, image })` → `parallel(label, [{ weight, run(progress) }])`, `step(label, weight, fn(progress))`, `done()`; `prewarm(renderer, scene, camera, roots, onProgress)`; `compileInBackground(renderer, scene, camera, root)` (off-screen, during play) |
| `levels.ts` | level streaming: `createLevels([{ models, sfx, music }], { audio })` → `download(i, p)`, `attach(renderer, scene, camera)`, `prewarm(i, p)` (behind the loading screen), `load(i, p)` (download + background compile), `prefetch(i)`, `isReady(i)`, `models(i)`, `statuses()` |
| `testHooks.ts` | `installTestHooks({ backend, loop, getState, input })`, `createRng(seed)` |

Boot order in `main.ts`:
1. `createLoadingScreen()`; it is shown first
2. **One parallel download phase:** `loading.parallel('Loading…', [createRenderer, createPhysics, loadModels(SHARED_MODELS, p), audio.load(SFX, p), levels.download(first, p), …])`. Every download (models, Rapier `.wasm`, audio, textures) starts at once. Never `await` one download before starting the next. Shared assets plus **only the first level**; with a single level, load everything here.
3. scene and camera, then `applyStyle` (lights must exist before prewarm), `levels.attach(renderer, scene, camera)`
4. build game objects from the loaded models
5. **prewarm** the shared objects and the first level (`loading.step('Compiling shaders', …, p => levels.prewarm(first, p))`, or `prewarm(..., roots, p)`)
6. build the first level (`collidersFromGltf`), `levels.prefetch(first + 1)`, then `installTestHooks`
7. `createLoop({ update, render, renderer })`, `loop.start()`, `loop.step(0)`, `loading.done()`, then `hooks.ready = true`

**Every game must have the loading screen and prewarm.** Lazy shader/pipeline compilation causes hitches the first time a level, effect or material appears.

**Multi-level games stream levels** (`levels.ts`, example: `examples/minigolf`): list each level's GLBs, sfx and music in `design/levels.json` (`{ "levels": [{ "models": [], "music": [], ...game fields }] }`, imported by `main.ts`). Play starts once level 1 is ready. Whenever a level starts, `prefetch` the next one: it downloads and compiles off-screen while the player plays. On a level change, swap in instantly if `isReady(i)`; otherwise show a small "Loading…" card (`load(i, p)`), keep the old level on screen, and swap in `update()` once it is ready. Expose `levels: levels.statuses()` in `getState()`. Bots must `await` (e.g. 50 ms) while the game is loading; a synchronous `step` loop starves the download. `pnpm release` reads `design/levels.json` and doesn't add preload hints for later-level assets.

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
- To change level, call `physics.removeBody(levelBody)`; it removes the colliders and sensor handlers too. Remove the old scene root, add the new one, `setTheme()` if levels have their own look, then call `refreshShadows()` (from `applyStyle`). Every level must be compiled before it is shown: the first by `prewarm`, the rest by `levels.load`/`prefetch`.
- Support a `?level=N` deep link (read with `params` from `renderer.ts`), so people reviewing the game can jump straight to a level.
- Controls: read a drag in the frame captured on `dragstart`, never against a camera that the drag itself moves (that is a feedback loop, and the view spins). Hold the camera still during the gesture. Add a dead zone. Test with **real** held `drag`/`key` playtest steps, not only `input()` actions. See `references/controls.md`.
- After any change the user can see or feel, end with a checked `pnpm dev` link, the controls and what to try (the `make-web-game` skill's hand-off rule). Don't make the user ask where to test.
- Use a DOM overlay (`#hud`) for the HUD; it is cheap and readable in screenshots. Show the controls on screen. Time HUD flashes in game ticks, not `setTimeout`, or stepped screenshots catch them half-faded; hide them under end cards.
- No physics needed (grid or circle collisions, a pendulum)? Run the boot playtest first (the starter scene uses physics), then delete `src/engine/physics.ts` and the `@dimforge/rapier3d` dependency. Keep `vite.config.ts` and `vite-plugin-wasm` as scaffolded: the plugin is harmless without `.wasm`, and the lab's validator wants examples' config identical to the template's.
- Play sounds from gameplay events in `update()` (deterministic), never from `render()`. Put `sfx: { ...audio.counts }` and `music: audio.music` in `getState()` so scenarios can assert on cues. Give players a mute key.
- three's GLTFLoader strips `.` from node names: lab_rig's bone `hand.L` is `handL` in the game. `getObjectByName('hand.L')` silently returns undefined (a ringer's hands were never pinned to her rope), so look nodes up through a helper that throws when a name is missing.
- HUD fades: drive `style.opacity` from tick counters, not CSS `transition`. Transitions don't advance in stepped `?test` runs, so a title card stayed on top of every screenshot.
- Instancing parts of a GLB (`InstancedMesh` from a template node): take each mesh's `matrixWorld` in the file, **including the template node's own transform**. The release build's meshopt quantization stores each mesh's dequantize scale/offset in its node's transform, and an orchard instanced with matrices relative to the template node rendered as squat stumps in the release build only. Dev looked right, so three judge rounds scored a bug nobody saw.
- Screen-space AO (`GTAONode` in a `RenderPipeline`) renders the scene through un-antialiased passes with noisy AO: it added grain to clouds, dark seams where spheres intersect and black specks on small flower quads, and the visual judges marked polish down more than the soft shading gained. For a soft toy look prefer soft shadows (`shadow.radius`, `normalBias`) and per-material shading; if you use GTAO, look at magnified crops of thin and intersecting geometry first.
- Replacing a GLB material in code (`new MeshStandardNodeMaterial`) drops its `side`: a double-sided terrain went back to front faces only and the whole valley vanished. Copy `side` from the old material.
- Planes added in code (painted cards, decals, shadow blobs, water) must sit ≥ 1 cm off any surface they lie on, or
  use `material.polygonOffset`. The Blender check (`blender-assets`) only sees the GLB; coplanar planes from code
  z-fight the same way.
- The loading bar uses `palette.accent` from `style.json`; give the palette an `accent` role.
- Keep all code in `import * as THREE from 'three/webgpu'`. Use addons from `three/addons/...`. Never mix in `three` (the WebGL-only build).

## TypeScript
Game code, bots and scripts are strict TypeScript (`tsconfig.json`: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`). Vite bundles `src/`; Node runs `scripts/*.ts` directly (type stripping, no build step). So:
- Only erasable syntax: no `enum`, `namespace` or constructor parameter properties (use union types and plain fields).
- Relative imports keep the `.ts` extension; type-only imports use `import type`.
- three.js types come from `@types/three`; Rapier, gltf-transform and Playwright ship their own.
- Indexing returns `T | undefined` (`noUncheckedIndexedAccess`): handle the miss, or use `!` only where the index is provably in range.
- glTF `userData` is untyped: read it with bracket access (`o.userData['collider']`) and narrow.
- Bots (`tests/scenarios/bots/*.ts`) are one arrow-function expression evaluated in the page. They may `import type { GameHooks } from '../../../src/engine/testHooks.ts'` and the game's `State`/`Action` (type imports are erased), nothing else.

## References (read when relevant)
- `references/rapier3d.md`: bodies, colliders, CCD, sensors, character control, the tuning gotchas
- `references/rapier2d.md`: switching to 2D physics (top-down/side-on games)
- `references/webgpu-notes.md`: WebGPURenderer, TSL materials, post-processing, fallback caveats
- `references/perf-budget.md`: targets and how to measure them
- `references/controls.md`: input/camera feel rules (feedback loops, dead zones, cancel, sensitivity) and how to test them with real input
