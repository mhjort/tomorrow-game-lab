---
name: optimize-assets
description: Make every asset of a finished three.js web game as small as web use allows before it is published — GLB textures and geometry, 2D images, music and sound effects — without quietly changing how it looks or sounds. Writes design/optimize.json, which `pnpm release` applies to the dist/ copies only, so public/ keeps the full-quality sources. Near-lossless settings are applied after screenshots prove them identical; bigger savings are measured one by one and shown to the user as one table to pick from. Use when a game is ready to publish, when the user asks to shrink the download, or when a release build is over its size budget.
---

# optimize-assets

Games are built fidelity-first (`make-web-game`): assets match the reference with no budgets. This is the pass that makes them web-sized once the user likes the game. Two rules:
- **Sources stay full quality.** Every setting goes in `design/optimize.json`; `pnpm release` applies it to the copies in `dist/`. Art iteration keeps working on `public/` and `assets/src/` as before, and the next release re-applies the settings.
- **The look and sound only change with the user's OK.** Near-lossless settings are kept only when the release screenshots are identical; anything bigger is shown to the user with its measured gain.

Files:
- `scripts/optimize-assets.ts`: `inventory`, `propose`, `trial <id>`, `check`, `apply <id...>` and `decline <id...>`.
- `scripts/compare-shots.ts`: SSIM per screenshot between two playtest runs ("same" at ≥ 0.985), with side-by-side images for changed shots.
- `references/settings.md`: every setting, what it saves, whether it is near-lossless or visible, and the options not automated yet.

Uses sibling skills by name: `game-judge` (playtest, visual panel), `publish-web-game` (`pnpm release` applies the settings), `blender-assets` (asset scripts, for changes a setting can't make).

Run from the game project. Needs the template's devDependencies (gltf-transform, meshoptimizer, sharp) and ffmpeg.

## 1. Baseline
```bash
node scripts/release.ts --optimize none.json            # today's release, no settings applied
node <game-judge>/scripts/playtest.ts --perf 0 --out .lab/optimize/base-run
node <skill>/scripts/optimize-assets.ts inventory       # where the bytes are, biggest first
```
Read the inventory before changing anything. It shows per GLB the triangles, the three biggest meshes and the textures; per audio file the length, channels and bitrate; per image its size. The shipped sizes (after the release's lossless GLB compression, plus JS and wasm) are in `dist/release-report.json`.

## 2. Near-lossless defaults
```bash
node <skill>/scripts/optimize-assets.ts propose         # writes design/optimize.json + .lab/optimize/candidates.json
pnpm release                                            # applies it; prints a line per optimized file
node <game-judge>/scripts/playtest.ts --perf 0 --out .lab/optimize/opt-run
node <skill>/scripts/compare-shots.ts .lab/optimize/base-run .lab/optimize/opt-run --backend webgpu
node <skill>/scripts/compare-shots.ts .lab/optimize/base-run .lab/optimize/opt-run --backend webgl2
node <skill>/scripts/optimize-assets.ts check           # images the screenshots never show (splash, icon)
```
Keep the defaults only if the playtest passes, every screenshot is "same" and `check` passes. If something moved, remove the setting that moved it from `optimize.json` (or raise its quality) and run again. `propose` keeps entries already in the file, so a second pass never undoes the user's choices.

## 3. Measure each visible candidate
`propose` lists them in `.lab/optimize/candidates.json`: GLB simplification for big meshes, smaller textures, lower music bitrate, lower image quality. For each one:
```bash
node <skill>/scripts/optimize-assets.ts trial <id>      # releases with and without it: KB saved (gzip and raw)
node <game-judge>/scripts/playtest.ts --perf 0 --out <trial dir>/run
node <skill>/scripts/compare-shots.ts .lab/optimize/opt-run <trial dir>/run
```
Drop a candidate that saves nothing: hosts gzip GLBs (GitHub Pages does), and simplified geometry can compress *worse* than the regular original. Note what a screenshot cannot judge: audio (listen to it on the dev link), and anything off screen in the scenarios.

## 4. One table for the user
Show every candidate that saves something in **one table**: asset · change · KB saved (gzip) · screenshots (SSIM, worst) · side-by-side image path · what gets worse, in plain words. Ask once which to apply. Then:
```bash
node <skill>/scripts/optimize-assets.ts apply <id...>
node <skill>/scripts/optimize-assets.ts decline <id...>
```
Both write to `decisions` in `optimize.json`, so a later pass doesn't ask again. In unattended runs, apply none and put the table in the report.

## 5. Verify and report
- `pnpm release` passes and the playtest passes on WebGPU and WebGL2 with no console errors.
- If an accepted change moved a gameplay screenshot, re-run the `game-judge` visual-fidelity panel and report the score before and after. With every shot "same" the panel would only re-score identical images: say so instead.
- Report the shipped size before and after (total MB gzip and the biggest files), each accepted and declined trade, and what is still big and why: wasm, or an asset whose fix belongs in its asset script (see Gotchas).
- Commit `design/optimize.json`. `.lab/` is generated.

## Gotchas
- **Look at the inventory's biggest meshes first.** If one GLB is mostly a repeated small mesh (grass blades: 216k of Blossom Swing's 330k triangles), the fix is in the asset script: `L.instances` (blender-assets) stores the blade once with a transform per copy. Blossom Swing's shipped world.glb fell from 886 to 395 KB gzip, and the simplify it had accepted before then grew the file: re-trial simplify after instancing.
- **Music loops keep their exact length.** The release re-encodes with LAME and refuses a result whose sample count differs from the source, so the seam can't drift. Count samples from files, never through a pipe: from a pipe ffmpeg can't read the gapless header and adds about 224 samples.
- **PNG stays lossless.** sharp's `effort` or `palette` options quantize PNGs to a palette. The release writes PNGs with `compressionLevel` only, and keeps a re-encode only when it is smaller.
- **A texture re-encode can grow a GLB.** A small JPEG made by `import_glb` is often smaller than WebP q90, so the release builds both and keeps the smaller one.
- **Never simplify by wildcard.** Thin parts (ropes, blades, fences) can break up, so name each GLB in `models`.
- **UVs out of [0,1] are not quantized.** Tube UVs in metres for bark grain stay float32. That costs some bytes, but quantizing them would break the effect.
- **Release-only bugs.** Quantization moves each mesh's dequantize transform into its node. Compare release screenshots, not dev ones (see `publish-web-game`).
