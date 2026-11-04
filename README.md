# tomorrow-game-lab

**▶ Play the example: [Island Putt (3D minigolf)](https://mhjort.github.io/tomorrow-game-lab/minigolf/)** · [all examples](https://mhjort.github.io/tomorrow-game-lab/)

Lightweight agent skills for building **web games** from a prompt or from key art. There are six skills, one stack, and no engine zoo.

- **Runtime:** three.js `WebGPURenderer`, which falls back to WebGL2 automatically, plus Vite. Rapier 3D/2D handles physics when a game needs it.
- **Assets:** Python scripts run in headless **Blender** and export GLB files with physics collider tags and preview renders.
- **Art direction:** works from a reference **image or video**. The output is an art bible plus a `style.json` that drives both Blender and three.js.
- **Verification:** deterministic **headless Chrome** playtests on both backends, then **independent judge agents** score the result and produce a prioritized fix list.

## Install

```bash
npx skills add mhjort/tomorrow-game-lab                       # all skills, pick agents interactively
npx skills add mhjort/tomorrow-game-lab -a claude-code -y     # Claude Code, project-level
npx skills add mhjort/tomorrow-game-lab --skill game-judge    # just one skill
```
Requirements: Node ≥ 24 (26 LTS preferred), Google Chrome, Blender 5.2 LTS (`blender` on PATH or `BLENDER=`), ffmpeg. The lab tracks the latest stable releases of every tool and library.

Then ask your agent something like *"Make a 3D minigolf game that looks like reference/keyart.png"*.

## Skills

| skill | what it does |
|---|---|
| [`make-web-game`](skills/make-web-game/SKILL.md) | entry point: art direction → brief → scaffold → assets → implement → playtest → judge → iterate |
| [`key-art-direction`](skills/key-art-direction/SKILL.md) | image/video → key frames, palette, `design/art-bible.md`, `design/style.json` |
| [`web-game-runtime`](skills/web-game-runtime/SKILL.md) | Vite + three.js WebGPU/WebGL2 template, fixed-step loop, Rapier wrapper, `window.__game` test hooks |
| [`blender-assets`](skills/blender-assets/SKILL.md) | `lab_bpy` helper, Blender → GLB with collider tags, preview renders, GLB inspector |
| [`publish-web-game`](skills/publish-web-game/SKILL.md) | `npm run release` (minify, code-split, meshopt GLBs, gzip budgets) → GitHub Pages workflow → live-URL playtest |
| [`game-judge`](skills/game-judge/SKILL.md) | Playwright playtest (scenarios, bots, screenshots, perf, SSIM backend parity) + 4 judge rubrics + aggregator |

## How verification works

```
tests/scenarios/*.json ──► playtest.mjs ──► .lab/runs/<ts>/report.json + screenshots (webgpu, webgl2)
                                                   │
                     ┌──────────────┬──────────────┼──────────────┐
                visual-fidelity  gameplay      technical     asset-quality      (parallel subagents,
                 vs key art      vs brief      errors/perf    previews + GLBs    each sees only its inputs)
                     └──────────────┴──────┬───────┴──────────────┘
                                     aggregate.mjs ──► verdict.md (PASS / fix list) ──► iterate (≤3 rounds)
```

The game exposes `window.__game` with these members:
- `ready`, `backend`
- `step(n)`, `getState()`, `input(action)`, `stats()`

With `?test` the game never advances by itself, so every scenario is deterministic and replayable.

## Developing the lab

```
skills/                 the product (what `npx skills add` installs)
examples/minigolf/      golden test game, built by following the skills (3 holes, Rapier, Blender assets)
lab/fixtures/keyart/    original key art fixtures (rendered by Blender: minigolf.png + minigolf.mp4)
lab/validate-skills.mjs skill format + conventions + template/example drift check
lab/test/               node:test suites for every script (frames, palette, Blender→GLB, playtest, aggregator)
site/                   GitHub Pages landing page (deployed by .github/workflows/pages.yml)
lab/build-site.mjs      assembles _site/: site/ + each example's release build at /<name>/
lab/eval/run-eval.mjs   end-to-end agent eval (fresh workspace → install skills → claude -p → independent judges)
lab/eval/permissions.mjs scoped allowlists for the unattended eval agents (no permission bypass)
```

| command | what |
|---|---|
| `npm install` | installs the minigolf workspace (three, rapier, vite, playwright-core) |
| `npm test` | validator + all script tests, including both-backend playtest of minigolf (~15 s) |
| `npm run test:golden` | build minigolf and run its playtest (writes `examples/minigolf/.lab/runs/latest`) |
| `npm run keyart` | re-render the key-art fixtures in Blender |
| `npm run release:minigolf` | optimized release build of minigolf (`examples/minigolf/dist`) |
| `npm --workspace examples/minigolf run release -- --precompress` | same, plus `.br`/`.gz` siblings for brotli-capable hosts (not GitHub Pages) |
| `npm run site` | release build + assemble the Pages site in `_site/` (landing page + `/minigolf/`) |
| `npm run eval -- --input image\|video\|both [--model opus] [--budget 25]` | expensive agent E2E eval; results → `lab/eval/results/`, `lab/eval/history.md` |
| `cd examples/minigolf && npm run assets && npm run dev` | rebuild minigolf GLBs, play it |

**Development loop:**
1. Change a skill.
2. Run `npm test`.
3. If the change affects generated games, rerun the golden example; for bigger changes, run `npm run eval` and compare `lab/eval/history.md`.

The example vendors `lab_bpy.py` and the template's `src/engine/`. The validator fails if those copies drift, so upstream engine fixes into the template first, then copy them into the example.
