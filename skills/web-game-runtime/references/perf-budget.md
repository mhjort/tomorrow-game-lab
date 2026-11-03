# Performance budget (mid-range laptop, 1080p)

| metric | target | how to check |
|---|---|---|
| frame time (avg) | < 8 ms CPU+submit | playtest `perf` (`?test&realtime`), `renderer.info.render` |
| worst frame | < 33 ms after boot | playtest `perf.worstFrameMs` |
| draw calls | < 300 | `renderer.info.render.drawCalls` |
| triangles on screen | < 500k | `renderer.info.render.triangles` |
| boot to first frame | < 3 s on localhost | playtest `bootMs` |
| JS bundle (gz) | < 1.5 MB (three + rapier ≈ 1 MB) | `npm run build` output |
| GLB per asset | < 2 MB, total < 20 MB | `inspect_glb.mjs` |
| physics bodies | < 500 dynamic | — |

## Cheap wins
- Merge static decor by material (`BufferGeometryUtils.mergeGeometries`). Use `InstancedMesh` for repeated props.
- Keep one shadow-casting directional light and give it tight shadow bounds.
- Cap the pixel ratio at 2 (the template does). For heavy scenes, drop it to 1.5 when frame time > 12 ms.
- Load GLBs in parallel (`loadModels([...])`). Rapier's WASM is inlined in the `-compat` build, so it needs no extra fetch.

Headless numbers are indicative. Compare runs against each other, not against absolute targets.
