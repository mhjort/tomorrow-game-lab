---
name: game-judge
description: Test a web game in headless Chrome (WebGPU and WebGL2) with deterministic JSON scenarios and bots, capture screenshots, errors, perf and backend parity, then score it with independent judge agents (visual fidelity vs key art, gameplay vs brief, technical, asset quality) and produce a prioritized fix list. Use after building or changing a browser game, to verify it works, or to decide what to fix next.
---

# game-judge

Two stages: the **playtest** produces facts cheaply and deterministically, and the **judges** turn those facts into scores and fixes. Always make the playtest pass before running the judges.

Requirements in the game project:
- the `window.__game` contract (see `web-game-runtime`)
- `playwright-core` as a devDependency
- Google Chrome installed
- optionally ffmpeg, for the parity check

## 1. Playtest
```bash
pnpm build && node <skill>/scripts/playtest.mjs            # serves dist/ with vite preview
node <skill>/scripts/playtest.mjs --dev                        # or serve via vite dev (no build)
#   --backends webgpu,webgl2  --scenarios tests/scenarios  --perf 3  --require-webgpu  --parity-min 0.9  --headed
```
Output goes to `.lab/runs/<ts>/`, with `.lab/runs/latest` linking to the newest run. It contains:
- `report.json`: every step with `stateAfter`, errors, perf, parity
- `summary.md`
- `webgpu/*.png` and `webgl2/*.png`

Exit codes: 0 = pass, 1 = a scenario failed or there was a console error, 2 = setup failure.

### Scenarios (`tests/scenarios/*.json`, run in name order, fresh page each)
```json
{ "name": "straight-putt", "description": "what rule this proves",
  "steps": [
    { "step": 10 },                                        // advance 10 fixed ticks (1/60 s each)
    { "input": { "type": "shoot", "angle": 0, "power": 0.7 } },
    { "until": "state.phase === 'holed'", "max": 900 },    // step until true (fails if never)
    { "assert": "state.strokes === 1", "label": "hole in one" },
    { "screenshot": "after" },
    { "key": "Space", "steps": 30 },                       // real keyboard: hold for 30 ticks
    { "drag": { "from": [640, 500], "to": [640, 650] } },  // real pointer drag (press, move, release)
    { "drag": { "from": [640, 500], "to": [600, 650], "hold": 60, "release": false } }, // keep it pressed for 60 ticks
    { "pointerUp": true },                                 // release a held drag
    { "script": "bots/play-round.js", "args": {} },        // file: `async (game, args) => result`
    { "eval": "window.__game.getState().phase" }
  ] }
```
- `state` in expressions is `__game.getState()`.
- Write one scenario per brief rule. `input` steps skip the real controls, so also write **at least one real-input scenario per control scheme**: a held `drag`/`key`, asserts while it is held (no drift), then the release (see the controls reference in the `web-game-runtime` skill). Include a full-game bot and a boot scenario that takes an **overview** screenshot framed like the key art.
- Take a screenshot right after each *natural* level transition (won/finished → next level), not only after `loadLevel` hooks. Backend-specific bugs hide there.
- Fix failures in the game, not by loosening asserts, unless the brief changed.

## 2. Judges (independent agents)
Rubrics are in `judges/`:
- `visual-fidelity.md`
- `gameplay.md`
- `technical.md`
- `asset-quality.md`

The output format is `judges/_output-schema.json`. Each judge:
- reads only the inputs its rubric lists
- returns `{judge, score 0-10, pass, summary, issues[{severity, title, evidence, fix}]}`
- has its output written to `.lab/runs/<ts>/judges/<judge>.json`

**Claude Code:** launch all four judges **in parallel** as subagents (Agent tool, general-purpose) in one message. Give each a self-contained prompt:
1. The full text of its rubric file.
2. The absolute project path and run directory.
3. The paths of the `<skill>` scripts it may run.
4. The instruction "Return only the JSON object."

Do **not** include your own opinion of the game or what you changed. Judges that know the builder's intent are lenient. Write each returned JSON to the judges folder.

**Agents without subagents:** run the rubrics one at a time in a fresh context if you can. Otherwise run them yourself, strictly from the listed inputs, and score adversarially.

## 3. Aggregate
```bash
node <skill>/scripts/aggregate.mjs .lab/runs/latest     # → verdict.md + verdict.json; exit 0 = PASS
```
`verdict.md` contains:
- a score table
- the fix list ordered blocker → major → minor
- any judge outputs that failed validation (re-run those judges)

When iterating:
- Apply the fixes in order.
- Re-run the playtest, then only the judges whose inputs changed (e.g. visual only after a `style.json` tweak).
- Stop after 3 rounds and report what is left.

## Thresholds
| judge | passes at |
|---|---|
| visual-fidelity | ≥ 7.0 |
| gameplay | ≥ 7.0 |
| technical | ≥ 7.5 |
| asset-quality | ≥ 7.0 |

A judge with any `blocker` issue fails regardless of its score.
