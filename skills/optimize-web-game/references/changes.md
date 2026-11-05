# Optimisation catalogue

**free** = the image stays the same (every shared screenshot SSIM ≥ 0.985 in `perf-compare.ts`): apply after measuring.
**visible** = the image changes: make it alone, show the user before/after and the gain, apply only with their OK.

## Download and load time
| change | look | how |
|---|---|---|
| meshopt-compress GLBs | free | `pnpm release` does it (quantize + reorder + compress); runtime decodes with `MeshoptDecoder` |
| WebP for 2D images, Opus/MP3 at sane bitrates | free if quality ≥ 80 | re-encode in `generate-media`'s pipeline, then compare |
| KTX2/Basis textures | usually free, check | colours can shift slightly: run `perf-compare.ts` before calling it free |
| lazy-load music after first frame | free | start the loop after the loading screen; keep sfx preloaded |
| drop unused three addons / imports | free | check the bundle table in `dist/release-report.json` |
| smaller textures (2048 → 1024) | visible | the asset's `import_glb(max_texture=…)` or the texture source |
| fewer triangles (decimate) | visible | `import_glb(max_tris=…)` for generated models; fewer segments in Blender scripts |

## CPU (draw calls, per-frame work)
| change | look | how |
|---|---|---|
| merge static meshes by material | free | join in the Blender script, or `BufferGeometryUtils.mergeGeometries`; keep nodes the game swaps or looks up separate |
| `InstancedMesh` for repeated props | free | trees, fence posts, lamps that never change individually |
| split one big static level into spatial chunks | free | one GLB or node per block, so three.js frustum-culls what's behind the camera |
| `shadow.autoUpdate = false` for static casters | free | refresh only when they move (`refreshShadows()` in the template) |
| no allocations in the frame loop | free | reuse vectors and arrays; `new` in `render()` shows up as GC spikes in `worstFrameMs` |
| fewer animated characters updating far away | visible if they freeze in view | skip mixer updates when off-screen only |

## GPU (pixels, shading)
| change | look | how |
|---|---|---|
| tighten the shadow camera to the visible play area | free if nothing in view loses its shadow | fit `shadow.camera` bounds, check with `perf-compare.ts` |
| cap pixel ratio at 2 | free on most screens | the template already does |
| pixel ratio 1.5 or 1 | visible (softer edges) | `renderer.setPixelRatio`; offer for phones |
| smaller shadow map, no soft-shadow radius | visible (blockier shadows) | `shadow.mapSize`, `shadow.radius` |
| fewer shadow casters | visible (missing shadows) | `castShadow = false` on small props |
| half-resolution or no bloom | visible (less glow) | the bloom pass in the post chain |
| fewer particles | visible | lower counts in the particle systems |
| shorter view distance / closer fog | visible | `camera.far`, `fog.near/far` |
| LOD (simpler meshes far away) | visible at the swap distance | `THREE.LOD`; set distances where the swap can't be seen, then compare |
