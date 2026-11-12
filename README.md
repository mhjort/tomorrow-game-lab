# tomorrow-game-lab

[![Test](https://github.com/mhjort/tomorrow-game-lab/actions/workflows/test.yml/badge.svg?branch=main)](https://github.com/mhjort/tomorrow-game-lab/actions/workflows/test.yml)

**▶ Play the examples: [Island Putt (3D minigolf)](https://mhjort.github.io/tomorrow-game-lab/minigolf/) · [Little Plough (snowplough, built from a gameplay video)](https://mhjort.github.io/tomorrow-game-lab/snowplough/) · [Blossom Swing (swing timing, built from a gameplay video)](https://mhjort.github.io/tomorrow-game-lab/blossomswing/)** · [all examples](https://mhjort.github.io/tomorrow-game-lab/)

Lightweight agent skills for building **web games** from a prompt or from key art. There are nine skills, one stack, and no engine zoo.

- **Runtime:** three.js `WebGPURenderer`, which falls back to WebGL2 automatically, plus Vite. Rapier 3D/2D handles physics when a game needs it.
- **Assets:** Python scripts run in headless **Blender** and export GLB files with physics collider tags and preview renders. Characters, vehicles and organic props can be generated (reference image → 3D model), then imported, sized and budgeted by the same scripts. Characters are auto-rigged in Blender with procedural idle, walk, run and jump clips.
- **2D art, sound, music & gameplay video:** splash art, icons, sound effects, seamless music loops and gameplay videos come from an AI service (Runware for now) via a declarative `design/media.json`. Candidates are reviewed and picked, and the outputs are locked and committed. With no reference from the user, a generated gameplay video becomes the spec the game is built from.
- **Art direction:** works from a reference **image or video** (given or generated). The output is an art bible plus a `style.json` that drives both Blender and three.js.
- **Verification:** deterministic **headless Chrome** playtests on both backends, then **independent judge agents** score the result and produce a prioritized fix list.

## Install

```bash
pnpm dlx skills add mhjort/tomorrow-game-lab                       # all skills, pick agents interactively
pnpm dlx skills add mhjort/tomorrow-game-lab -a claude-code -y     # Claude Code, project-level
pnpm dlx skills add mhjort/tomorrow-game-lab --skill game-judge    # just one skill
```
Requirements: Node ≥ 24 (26 LTS preferred), Google Chrome, Blender 5.2 LTS (`blender` on PATH or `BLENDER=`), ffmpeg. Optional: `RUNWARE_API_KEY` for generated images, sound effects, music, gameplay videos and 3D models (see below). The lab tracks the latest stable releases of every tool and library.

Then ask your agent something like *"Make a 3D minigolf game that looks like reference/keyart.png"*.

With a `RUNWARE_API_KEY`, words alone are enough: *"Make a cosy game where a little snowplough clears paths through a snowed-in toy village"*. The agent first generates a short **gameplay video** (fake in-engine footage, about $0.70), then builds a game that looks like the video and keeps its mechanic (**video-first**, see [`make-web-game/references/video-first.md`](skills/make-web-game/references/video-first.md)).

### Optional: generated images, sound, music, video and 3D (Runware)

Splash art, icons, sound effects, music, gameplay videos and generated 3D models come from [Runware](https://runware.ai), a pay-as-you-go API for image, audio, video and 3D models. A 6-second gameplay video costs about $0.35, a 3D model about $0.30, and a music track less than a cent. Without a key the games still work, just without generated media.

1. Create an account at [runware.ai](https://runware.ai) and verify your email.
2. Add credits in the dashboard (new accounts may get some trial credit). Each generated file's cost is recorded in the game's `assets/media.lock.json`, and re-runs reuse locked files at no cost.
3. Open **API Keys** in the dashboard, create a key, and export it in the shell your agent runs in:

   ```bash
   export RUNWARE_API_KEY=...   # e.g. in ~/.zshrc; never commit it
   ```

The `make-web-game` environment check (`scripts/check-env.ts`) reports whether the key is set, without printing it.

## Skills

| skill | what it does |
|---|---|
| [`make-web-game`](skills/make-web-game/SKILL.md) | entry point: art direction → brief → scaffold → assets + media → implement → playtest → judge → iterate → human review |
| [`key-art-direction`](skills/key-art-direction/SKILL.md) | image/video → key frames, palette, `design/art-bible.md`, `design/style.json` |
| [`web-game-runtime`](skills/web-game-runtime/SKILL.md) | Vite + three.js WebGPU/WebGL2 template, fixed-step loop, Rapier wrapper, skeletal animation, `window.__game` test hooks |
| [`blender-assets`](skills/blender-assets/SKILL.md) | `lab_bpy` helper, Blender → GLB with collider tags, preview renders, GLB inspector, `import_glb` for generated models, `lab_rig` auto-rigging + animation clips |
| [`generate-media`](skills/generate-media/SKILL.md) | `design/media.json` → Runware (Nano Banana 2.1 / GPT-Image-2.5 images, Mirelo SFX, ACE-Step music, MiniMax H3 Max video, Tripo image-to-3D) → candidate review (contact sheets, waveforms, 3D preview sheets) → trimmed, normalised `public/sfx/*.mp3`, seamless `public/music/*.mp3` loops, `public/images/*`, reference clips in `design/reference/` and raw GLBs in `assets/generated/` with a cost/seed lock file |
| [`optimize-web-game`](skills/optimize-web-game/SKILL.md) | performance pass for a target device after the game matches its reference: measure, free wins first, ask before any visible compromise; `perf-compare.ts` before/after report |
| [`optimize-assets`](skills/optimize-assets/SKILL.md) | web-sized assets before publishing: `design/optimize.json` (WebP textures, image/audio re-encodes, GLB simplification) applied by `pnpm release` to `dist/` only; near-lossless settings proven by identical screenshots, bigger savings measured one by one for the user to pick |
| [`publish-web-game`](skills/publish-web-game/SKILL.md) | `pnpm release` (minify, code-split, `design/optimize.json`, meshopt GLBs, gzip budgets) → GitHub Pages workflow → live-URL playtest |
| [`game-judge`](skills/game-judge/SKILL.md) | Playwright playtest (scenarios, bots, screenshots, perf, SSIM backend parity) + 4 judge rubrics + aggregator |

## How verification works

```
tests/scenarios/*.json ──► playtest.ts ──► .lab/runs/<ts>/report.json + screenshots (webgpu, webgl2)
                                                   │
                     ┌──────────────┬──────────────┼──────────────┐
                visual-fidelity  gameplay      technical     asset-quality      (parallel subagents,
                 vs key art      vs brief      errors/perf    previews + GLBs    each sees only its inputs)
                     └──────────────┴──────┬───────┴──────────────┘
                                     aggregate.ts ──► verdict.md (PASS / fix list) ──► iterate (≤10 rounds)
```

The game exposes `window.__game` with these members:
- `ready`, `backend`
- `step(n)`, `getState()`, `input(action)`, `stats()`

With `?test` the game never advances by itself, so every scenario is deterministic and replayable.

## Developing the lab

```
skills/                 the product (what `pnpm dlx skills add` installs)
examples/minigolf/      golden test game, built by following the skills (3 holes, Rapier, Blender assets)
examples/snowplough/    video-first proof: "Little Plough", built from a generated gameplay video (generated
                        plough + rigged villager models, scripted village, deformable snow, music; no physics engine)
examples/blossomswing/  video-first: "Blossom Swing", a swing-timing game (generated child rigged with seated clips,
                        scripted hill, tree and instanced orchard; judged over 10 rounds to pass the visual bar)
lab/fixtures/keyart/    original key art fixtures (rendered by Blender: minigolf.png + minigolf.mp4)
lab/validate-skills.ts  skill format + conventions + template/example drift check
lab/test/               node:test suites for every script (frames, palette, Blender→GLB, playtest, aggregator)
site/                   GitHub Pages landing page: the games, then "How they were made" (each reference next to its
                        game; build-site.ts copies the gameplay videos in). Deployed by .github/workflows/pages.yml
lab/build-site.ts       assembles _site/: site/ + each example's release build at /<name>/
lab/eval/run-eval.ts    end-to-end agent eval (fresh workspace → install skills → claude -p → independent judges)
lab/eval/permissions.ts scoped allowlists for the unattended eval agents (no permission bypass)
```

| command | what |
|---|---|
| `pnpm install` | installs the minigolf workspace (three, rapier, vite, playwright-core) |
| `pnpm typecheck` | strict TypeScript check of `lab/`, skill scripts and every example (`tsc`, no emit) |
| `pnpm test` | typecheck + validator + all script tests, including both-backend playtest of minigolf (~15 s) |
| `pnpm test:golden` | build minigolf and run its playtest (writes `examples/minigolf/.lab/runs/latest`) |
| `pnpm keyart` | re-render the key-art fixtures in Blender |
| `pnpm release:minigolf` | optimized release build of minigolf (`examples/minigolf/dist`) |
| `pnpm --filter minigolf release --precompress` | same, plus `.br`/`.gz` siblings for brotli-capable hosts (not GitHub Pages) |
| `pnpm site` | release builds + assemble the Pages site in `_site/` (landing page + `/minigolf/` + `/snowplough/` + `/blossomswing/`) |
| `pnpm eval --input image\|video\|both [--model opus] [--budget 25]` | expensive agent E2E eval; results → `lab/eval/results/`, `lab/eval/history.md` |
| `cd examples/minigolf && pnpm assets && pnpm dev` | rebuild minigolf GLBs, play it |
| `cd examples/snowplough && pnpm assets && pnpm dev` | rebuild the snowplough GLBs (village, imported plough, rigged villager), play it |
| `cd examples/blossomswing && pnpm assets && pnpm dev` | rebuild the Blossom Swing GLBs (world, orchard, rigged child), play it |

**Development loop:**
1. Change a skill.
2. Run `pnpm test`.
3. If the change affects generated games, rerun the golden example; for bigger changes, run `pnpm eval` and compare `lab/eval/history.md`.

The examples vendor `lab_bpy.py` (and `lab_rig.py`), the template's `src/engine/` and its scripts. The validator fails if those copies drift, so upstream engine fixes into the template first, then copy them into every example.

## License

[Apache License 2.0](LICENSE)
