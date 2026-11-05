---
name: make-web-game
description: Build, change or fix a browser game (three.js WebGPU with WebGL2 fallback, optional Rapier physics, Blender-scripted 3D assets) from a short prompt and/or a reference image or video (key art), then verify it with headless Chrome playtests and independent judge agents, iterating until it passes. Use when asked to make, prototype, remake, change or fix a web/browser/three.js game, or to turn concept art or a gameplay video into a playable game.
---

# make-web-game

Entry point of the tomorrow-game-lab skills. It orchestrates these sibling skills — use them by name:

| skill | job |
|---|---|
| `key-art-direction` | reference image/video → `design/art-bible.md` + `design/style.json` |
| `web-game-runtime` | project template: three.js WebGPU/WebGL2, Rapier, fixed-step loop, `window.__game` test hooks |
| `blender-assets` | headless Blender Python scripts → `public/models/*.glb` + preview renders |
| `generate-media` | AI-generated 2D images, sound effects, music loops, gameplay videos and image-to-3D models (Runware) from `design/media.json` → `public/images/`, `public/sfx/`, `public/music/`, `design/reference/*.mp4`, `./assets/generated/*.glb` |
| `game-judge` | headless Chrome playtest + judge rubrics → `verdict.md` with a fix list |
| `optimize-web-game` | performance pass for a target device, after the user has played the game: free wins first, asks before any visible compromise |
| `publish-web-game` | optimized release build (`pnpm release`) + GitHub Pages deploy + live smoke test |

If a sibling skill is not installed, tell the user: `pnpm dlx skills add <repo> --skill <name>`.

## Requirements
Node ≥ 24 (26 LTS preferred), Google Chrome, Blender ≥ 5.2 LTS (`blender` on PATH or `BLENDER=`), ffmpeg. Prefer the latest stable release of every tool and library. Check them first with `node <skill>/scripts/check-env.ts`, not by listing system folders. Report anything missing before starting. `RUNWARE_API_KEY` is optional: without it, skip generated media (no sound, no music, no splash art, no generated video or 3D models).

## Project layout (every skill assumes this)
```
design/            reference/ (key art, frames), art-bible.md, style.json, brief.md, media.json, notes.md (iteration notes; no judge reads it)
assets/src/        one Blender script per asset (+ lab_bpy.py helper, _shared.py helpers)
assets/generated/  raw image-to-3D GLBs from generate-media, imported by assets/src scripts — committed
assets/media.lock.json  what generate-media produced (model, seed, cost) — committed
public/models/     built GLBs (generated — rebuild with `pnpm assets`)
public/images/, public/sfx/, public/music/  generated 2D art, sound effects, music loops (`pnpm media`) — committed
src/               engine/ (from template) + game code
tests/scenarios/   playtest scenarios (*.json) + bots/*.ts
.lab/              previews/, runs/<timestamp>/ (generated, gitignored)
```

## Workflow

**Fidelity first.** Build the game to match its reference and to feel good; performance budgets don't shape the look while you build. Keep it playable (about 60 fps on this machine) and avoid waste, nothing more. Performance for a target device is a separate pass (`optimize-web-game`, step 11) that asks the user before any compromise that changes the look.


1. **Art direction**:
   - **Video-first** (the default when the user gave only words and `RUNWARE_API_KEY` is set, or when they gave a gameplay video): follow `references/video-first.md`. Generate a gameplay video, read it with `key-art-direction`, and build the game to look like the video and keep its mechanic.
   - **Key art given:** run `key-art-direction` on it.
   - **Neither** (no key, no reference): write a short art bible from the prompt (palette of 6-10 hex colours, light, camera, shape language) and `design/style.json`.
2. **Brief** — copy `references/design-brief-template.md` to `design/brief.md` and fill it in (video-first: start with its "Source video" section): core loop, controls, rules, win/lose, scope **cut list**, and the `__game` hooks (`getState` fields + `input` actions). Keep v1 small: one core mechanic done well beats five half-done ones. If the request is ambiguous about genre, controls or scope, ask the user now. These are expensive to change later.
3. **Scaffold** — `web-game-runtime`: copy the template, `pnpm install`, run the boot playtest before writing game code. A green boot on both backends is the baseline.
4. **Media** (if `RUNWARE_API_KEY` is set): `generate-media`. Write `design/media.json` with one sound per gameplay event in the brief, a music loop per mood in the brief, plus a splash image and an icon. Add a 3D model (reference image → `models` entry) for each character, vehicle or organic prop that a Blender script would turn into a blocky stand-in. Run `pnpm media`, review the candidates (images by eye, sounds by waveform, music by seam score, models by preview sheet), and pick.
   **Assets** — `blender-assets`: one script per asset, styled from `design/style.json`, colliders tagged for physics. Generated models get a short script too (`L.import_glb`: facing, real size), and characters are rigged and animated there (`lab_rig`). Build with `pnpm assets` (after `pnpm media`), then look at every preview PNG yourself before using an asset.
5. **Implement** — replace the `GAME` section of `src/main.ts`. Rules:
   - All gameplay goes through `update(dt)` (fixed step). Rendering only reads state.
   - Every player action is a high-level action object, and `__game.input(action)` accepts the same objects, so tests exercise real game logic.
   - Use `createRng()` instead of `Math.random()`. No wall-clock time in gameplay.
   - Everything is **strict TypeScript** (`.ts`, never `.js`): type `State` and `Action` (a discriminated union) in `main.ts`, no `any`, no `@ts-ignore`. Run `pnpm typecheck` after every change; fix the type, don't cast it away.
   - Controls follow the controls reference in the `web-game-runtime` skill: a drag is read in the frame captured at its start, the camera holds still during a gesture, and there is a dead zone and a cancel.
6. **Scenarios** — write one `tests/scenarios/*.json` per brief rule, plus a bot (`tests/scenarios/bots/*.ts`) that plays the whole game to its end state. At least one scenario per control scheme must drive **real** input (`drag`/`key` steps held across ticks) and assert that the result is right and doesn't drift. `input()` actions bypass the controls entirely. Include `screenshot` steps: an *overview* shot framed like the key art, plus the main play view.
7. **Playtest** — `game-judge` playtest. Fix every failing assertion and console error before judging. Judges are expensive; a red playtest is cheap.
8. **Judge** — build the `game-judge` visual pack, run the judges in parallel as independent subagents (visual fidelity as a panel of three), then aggregate.
9. **Iterate** — apply `verdict.md` fixes in order (blockers → majors), rebuild assets if scripts changed, then re-run steps 7–8. Stop when the verdict is PASS or after **3 rounds**. The last round judges the final build: never report a score from before your last changes. If you stop below the bar, say so, list the open issues by severity, and offer to continue. A `major` issue raised in two rounds in a row is never "out of scope".
10. **Human review (once, when you think it's ready)**: taste decides whether a game is good, and judges can't play it. Follow `references/human-review.md`:
    - start `pnpm dev` in the background and check the URL answers
    - send the link, the controls, deep links (`?level=N`), and 2–4 specific questions (feel, sound, look)
    - wait for the answer, apply the feedback, re-run the playtest, then reply with the same link
    Don't ask mid-build. With no user available (unattended runs), list the questions in the final report.
11. **Optimize** (after the user has played it and likes it, when they ask, or when the release is over budget) — `optimize-web-game`: agree a target device, measure, apply the changes that don't change the look, and ask before any that do.
12. **Publish** (when asked, or when the user wants a link) — `publish-web-game`: release build, GitHub Pages deploy, live-URL playtest.

## Every hand-off ends with a play link
Whenever you finish a change the user can see or feel (a new game, a fix, a tuning tweak, a new level), your final message **starts with a working local link**. Don't make the user ask where to test. Follow `references/human-review.md` §1 to start and check the server, then send:
- the URL, plus a deep link (`?level=N`) to the part that changed
- the controls, in one line
- **what to try**: 1–4 concrete actions that show the change, e.g. "pull far back and hold still: the view should stay put"

Leave the server running and say so. This is not the full taste review (step 10). Don't add a list of questions to every hand-off. Skip the link only in unattended runs, or when the change has no visible effect (docs, CI).

## Definition of done
- `pnpm typecheck` is clean and `pnpm build` succeeds (it type-checks first), and the playtest passes on **webgpu and webgl2** with zero console errors.
- The game boots through a loading screen with a progress bar. All downloads run in one parallel phase, then every level/material is prewarmed before play.
- `pnpm release` succeeds (sizes are reported; budgets for a target device are the `optimize-web-game` pass).
- Every judge passes (see `game-judge`). Remaining minor issues are listed in your final message.
- A full-game bot reaches the end state. The README or final message explains the controls.
- The final message starts with a checked local play link, the controls and what to try.
- The user has played it from a working local link and their feedback has been addressed (or, in unattended runs, the questions are in the report).

## Gotchas
- Small, fast-spinning Rapier bodies (balls) need `createPhysics({ substeps: 4 })`, because Rapier caps rotation at about π/4 per step.
- Blender is Z-up and glTF/three is Y-up: Blender `(x, y, z)` → three `(x, z, -y)`. Use named empties (`Tee`, `Spawn`, …) and read them with `getObjectByName` instead of hard-coding coordinates in two places.
- A camera that follows the aim + a drag read against the live camera = a feedback loop, and the view spins as soon as the player pulls too far. Freeze the frame at `dragstart`. Only a held real-input scenario catches this.
- A generated video shows a moment, not rules. It's the spec for look, camera, avatar and verb. Level layout drifts between frames and physics is staged, so invent rules and tune numbers in the brief. Don't invent looks: every character and prop traces to a full-resolution crop in `design/reference/inventory.md`, and the brief lists every addition.
- Don't let judges see your reasoning. Pass them only the files their rubric lists.
