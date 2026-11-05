---
name: optimize-web-game
description: Make a finished three.js web game run well on a target device (laptop, phone, low-end) and download fast, without quietly degrading how it looks. Measures first, applies the changes that leave the image unchanged, and asks the user before any trade of visual quality for speed or size, showing before/after screenshots and the measured gain. Use after a game matches its reference and the user has played it, when the user says a game is slow, stutters or takes too long to load, or when a release build is over its size budget.
---

# optimize-web-game

A game is first built to match its reference and to feel good (`make-web-game`). Performance is this separate pass, so a budget never silently decides how the game looks. The rule of this skill: **the look only changes with the user's OK.**

Files:
- `scripts/perf-compare.mjs`: compares a baseline playtest run with one after a change. It reports the frame-time, boot and download change, and an SSIM score per shared screenshot that marks it "same" or "changed". For changed shots it writes side-by-side images (before | after).
- `references/targets.md`: frame, draw-call, triangle and download targets per device class.
- `references/changes.md`: the catalogue of optimisations, each marked **free** (same image) or **visible** (needs the user's OK), with how to apply and verify it.

Uses sibling skills by name: `game-judge` (playtest, visual panel), `blender-assets` (`inspect_glb.mjs`, asset scripts), `publish-web-game` (`pnpm release`).

## 1. Agree the target (ask once)
Ask the user which device class matters and what hurts most: frame rate, load time or download size. Offer the classes in `references/targets.md`; the default is a mid-range laptop at 1080p. In unattended runs, use the default and apply **free** changes only.

## 2. Measure the baseline
```bash
node <game-judge>/scripts/playtest.mjs --perf 5          # keep this run dir: BEFORE
pnpm release                                            # dist/release-report.json: gzip sizes per file
node <blender-assets>/scripts/inspect_glb.mjs public/models/*.glb   # triangles, KB, textures per GLB
```
Find what is over the target and why before changing anything:
- **GPU-bound** (frame time scales with resolution): pixel ratio, post-processing, shadows, overdraw.
- **CPU-bound** (frame time doesn't scale): draw calls, per-frame allocations, game code.
- **Download-bound**: textures, GLBs, audio. Look at the biggest rows of the release report first.

Headless timings are indicative: compare runs on the same machine, never against absolute numbers from elsewhere. `avgFrameMs` is the work per frame (fps is capped by vsync).

## 3. Free changes first
Apply the **free** changes from `references/changes.md` that address the measured cost: compression, merging, instancing, chunking for culling, tighter shadow bounds and so on. After each batch:
```bash
node <game-judge>/scripts/playtest.mjs --perf 5          # AFTER
node <skill>/scripts/perf-compare.mjs <BEFORE> <AFTER>
```
Keep a batch only if the playtest still passes and **every shared screenshot is "same"** (SSIM ≥ 0.985). If a "free" change moved a screenshot, it wasn't free: revert it, or treat it as visible (step 4).

## 4. Visible changes need the user's OK
For each change that would alter the look (decimating meshes, smaller textures, lower pixel ratio, cheaper shadows, less bloom, fewer particles, shorter view distance):
1. Make it on its own, then run the playtest and `perf-compare.mjs`.
2. Show the user the side-by-side images from `perf-compare/` and the measured gain (ms per frame, MB, seconds of load). Say plainly what gets worse.
3. Ask **one question per trade**: apply, skip, or try a milder version. Never bundle several compromises into one yes.
4. Revert it unless they agree. In unattended runs, don't apply any; list each with its evidence in the report.

Record every decision in `design/notes.md` ("pixel ratio 1.5 on phones: accepted, 2026-11-05"), so a later pass doesn't ask again or undo it.

## 5. Verify and report
- The playtest passes on WebGPU and WebGL2 with no console errors, and `pnpm release` is within the agreed budgets.
- If the user accepted any visible change, run the `game-judge` visual-fidelity panel again and report the score before and after.
- Report the final `perf-compare` table against the original baseline, every accepted and declined trade, and what is still over target.

## Gotchas
- Optimise what you measured. A game at 2 ms per frame on the target doesn't need fewer triangles. If only the download is too big, compress before you decimate.
- KTX2/Basis texture compression can shift colours slightly. Check it with `perf-compare.mjs` before calling it free.
- Merging static meshes is free for the image, but it breaks per-object material swaps (lamps that light up) and per-object culling. Keep the nodes the game changes or looks up by name separate.
- Splitting one big static level into spatial chunks lets three.js frustum-cull what's behind the camera, and keeps each GLB small, without changing anything on screen.
