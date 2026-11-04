# three.js WebGPU notes (r18x)

- Import everything from `three/webgpu`, which includes `WebGPURenderer`, the node materials and all the core classes. Use addons from `three/addons/...`. Never import `three` in the same bundle; you'd ship and mix two copies of the core.
- `await renderer.init()` before the first render. After that, `renderer.backend.isWebGPUBackend` tells you which backend you got. If `navigator.gpu` is unavailable the renderer falls back to WebGL2 by itself, and `forceWebGL: true` forces the fallback.
- Classic materials work on both backends: `MeshStandardMaterial`, `MeshPhysicalMaterial`, `MeshBasicMaterial`, `MeshLambertMaterial`. They are converted to node materials internally.
- **TSL** (custom shaders): `import { color, uv, time, mix, positionLocal, sin } from 'three/tsl'`. Assign to `material.colorNode`, `positionNode`, `emissiveNode`… One TSL graph compiles to both WGSL and GLSL, so you never write raw shaders for one backend only. `ShaderMaterial` and `onBeforeCompile` do **not** work with WebGPURenderer.
- Post-processing: `const post = new THREE.RenderPipeline(renderer)`. In older releases this class is `PostProcessing`. Set `post.outputNode = bloom(pass(scene, camera))…` with `pass` from `three/tsl` and effects from `three/addons/tsl/display/*` (e.g. `BloomNode.js`). Then render with `post.render()` instead of `renderer.render()`.
- Shadows: `renderer.shadowMap.enabled = true`. Directional-light shadow cameras need explicit bounds (`applyStyle` sets them with `shadowArea`). Add `normalBias` (~0.02) to kill shadow acne on low-poly. After swapping level geometry, set `light.shadow.needsUpdate = true` (`refreshShadows()`).
- Tone mapping: `renderer.toneMapping` (ACES, AgX, Neutral). AgX desaturates strongly; use ACES or Neutral for saturated toy-like art.
- Headless Chrome: `--enable-unsafe-webgpu` gives a real WebGPU adapter on macOS (Metal). On Linux CI without a GPU you may only get WebGL2 through SwiftShader. The playtest reports the backend it got, and `--require-webgpu` turns a missing WebGPU into a failure.
- Screenshots of a WebGPU canvas work in Playwright without `preserveDrawingBuffer`. Always render a frame (`__game.step(1)`) before taking one.

## Prewarm everything behind a loading screen (required)
Shaders and pipelines compile lazily on first use, which causes hitches when a level, effect or material first appears.
- `renderer.compileAsync(scene, camera)` only compiles what the camera can *see*. Objects outside the frustum, or not yet in the scene, are skipped.
- `prewarm()` (engine/loading.js) handles this. For every root it turns frustum culling off, runs `compileAsync`, and renders warm-up frames so shadow pipelines compile too. Run it inside the loading screen, after lights exist, and pass **all** level roots plus anything spawned later.

## Shadows refresh once per *animation frame*, not per render() (test-mode gotcha)
`ShadowNode` renders a light's shadow map at most once per camera per node `frameId`, even when `shadow.needsUpdate = true`. `frameId` only advances on the renderer's internal requestAnimationFrame tick. Real play renders once per animation frame, so it's fine. Test-mode `step()` renders synchronously, possibly twice within one animation frame. A render right after a level swap then reuses the **previous level's shadow map**: ghost shadows on WebGPU and WebGL2, intermittent and timing-dependent. Parity SSIM can't catch it when both backends are stale.
**Fix:** `createLoop({ ..., renderer })`. `step()` then calls `advanceFrame(renderer)` before each render. This was verified clean in 20/20 runs; before the fix, 8/20 were stale. Note that prewarm, `refreshShadows`, extra renders and disposing the shadow map do **not** fix this.
