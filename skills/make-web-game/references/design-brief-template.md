# Design brief — <working title>

## Pitch
One sentence: who you are, what you do, why it's fun.

## Core loop
<verb> → <verb> → <feedback> → repeat. (e.g. aim → putt → watch roll → next shot)

## Controls
- **Mouse/touch:** …
- **Keyboard:** …
(Every control maps to a high-level action that `__game.input` also accepts.)

## Rules
- Scoring / progression: …
- Failure / penalties: …
- Level / round structure: …

## Win / lose
…

## Scope (in v1)
- …

## Cut list (explicitly NOT in v1)
- …

## Audio & 2D media (generate-media; optional)
| event | sound (`public/sfx/<name>.mp3`) |
|---|---|
| e.g. jump | `jump`: short soft whoosh |

Images: splash (loading-screen background, framed like the key art), icon (favicon). Anything else 2D: …

## Feel targets (numbers judges can check)
- e.g. max speed, typical distances, session length, expected bot score

## Test hooks (`window.__game`)
- `getState()` → `{ phase: '…'|'…', score, level, player:{x,y,z}, … }` (JSON-serialisable; include everything a scenario needs to assert on)
- `input({ type: '…', … })` — one entry per action, plus test-only helpers (`loadLevel`, `reset`, `camera`)

## Scenarios to write
| scenario | proves |
|---|---|
| 01-boot | boots, no errors, overview + play screenshots |
| 02-… | rule … |
| 0N-full-run | bot plays to the end state |
