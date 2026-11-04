---
name: make-web-game
description: Build a complete browser game (three.js WebGPU with WebGL2 fallback, optional Rapier physics, Blender-scripted 3D assets) from a short prompt and/or a reference image or video (key art), then verify it with headless Chrome playtests and independent judge agents, iterating until it passes. Use when asked to make, prototype, or remake a web/browser/three.js game, or to turn concept art or a gameplay video into a playable game.
---

# make-web-game

Entry point of the tomorrow-game-lab skills. It orchestrates four sibling skills — use them by name:

| skill | job |
|---|---|
| `key-art-direction` | reference image/video → `design/art-bible.md` + `design/style.json` |
| `web-game-runtime` | project template: three.js WebGPU/WebGL2, Rapier, fixed-step loop, `window.__game` test hooks |
| `blender-assets` | headless Blender Python scripts → `public/models/*.glb` + preview renders |
| `game-judge` | headless Chrome playtest + judge rubrics → `verdict.md` with a fix list |

If a sibling skill is not installed, tell the user: `npx skills add <repo> --skill <name>`.

## Requirements
Node ≥ 20, Google Chrome, Blender ≥ 4.2 (`blender` on PATH or `BLENDER=`), ffmpeg. Check them first with `node <skill>/scripts/check-env.mjs`, not by listing system folders. Report anything missing before starting.

## Project layout (every skill assumes this)
```
design/            reference/ (key art, frames), art-bible.md, style.json, brief.md
assets/src/        one Blender script per asset (+ lab_bpy.py helper, _shared.py helpers)
public/models/     built GLBs (generated — rebuild with `npm run assets`)
src/               engine/ (from template) + game code
tests/scenarios/   playtest scenarios (*.json) + bots/*.js
.lab/              previews/, runs/<timestamp>/ (generated, gitignored)
```

## Workflow

1. **Art direction** — if the user gave key art, run `key-art-direction` now. With no reference, write a short art bible from the prompt (palette of 6-10 hex colours, light, camera, shape language) and `design/style.json`.
2. **Brief** — copy `references/design-brief-template.md` to `design/brief.md` and fill it in: core loop, controls, rules, win/lose, scope **cut list**, and the `__game` hooks (`getState` fields + `input` actions). Keep v1 small: one core mechanic done well beats five half-done ones. If the request is ambiguous about genre, controls or scope, ask the user now. These are expensive to change later.
3. **Scaffold** — `web-game-runtime`: copy the template, `npm install`, run the boot playtest before writing game code. A green boot on both backends is the baseline.
4. **Assets** — `blender-assets`: one script per asset, styled from `design/style.json`, colliders tagged for physics. Build with `npm run assets`, then look at every preview PNG yourself before using an asset.
5. **Implement** — replace the `GAME` section of `src/main.js`. Rules:
   - All gameplay goes through `update(dt)` (fixed step). Rendering only reads state.
   - Every player action is a high-level action object, and `__game.input(action)` accepts the same objects, so tests exercise real game logic.
   - Use `createRng()` instead of `Math.random()`. No wall-clock time in gameplay.
6. **Scenarios** — write one `tests/scenarios/*.json` per brief rule, plus a bot (`tests/scenarios/bots/*.js`) that plays the whole game to its end state. Include `screenshot` steps: an *overview* shot framed like the key art, plus the main play view.
7. **Playtest** — `game-judge` playtest. Fix every failing assertion and console error before judging. Judges are expensive; a red playtest is cheap.
8. **Judge** — run the `game-judge` judges in parallel as independent subagents, then aggregate.
9. **Iterate** — apply `verdict.md` fixes in order (blockers → majors), rebuild assets if scripts changed, then re-run steps 7–8. Stop when the verdict is PASS or after **3 rounds**. Then report the scores, the remaining issues, and how to play (`npm run dev`).

## Definition of done
- `npm run build` succeeds, and the playtest passes on **webgpu and webgl2** with zero console errors.
- The game boots through a loading screen with a progress bar that loads assets and prewarms all levels/materials before play.
- Every judge passes (see `game-judge`). Remaining minor issues are listed in your final message.
- A full-game bot reaches the end state. The README or final message explains the controls.

## Gotchas
- Small, fast-spinning Rapier bodies (balls) need `createPhysics({ substeps: 4 })`, because Rapier caps rotation at about π/4 per step.
- Blender is Z-up and glTF/three is Y-up: Blender `(x, y, z)` → three `(x, z, -y)`. Use named empties (`Tee`, `Spawn`, …) and read them with `getObjectByName` instead of hard-coding coordinates in two places.
- Don't let judges see your reasoning. Pass them only the files their rubric lists.
