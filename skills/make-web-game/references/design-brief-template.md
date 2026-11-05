# Design brief — <working title>

## Pitch
One sentence: who you are, what you do, why it's fun.

## Source video (video-first only; delete otherwise)
`design/reference/gameplay.mp4` · model, seed, cost in `./assets/media.lock.json` · hero frame `design/reference/keyart.png` (= frame_NN)
Gameplay read, one line each, citing frames:
- **Avatar:** …
- **Verb:** … → the world changes by …
- **Camera rig:** …
- **Goal & feedback:** …
- **World pattern:** …
- **Speeds:** … avatar lengths/s, one action takes … s
Inventory: `design/reference/inventory.md` (one crop per element; the nouns above come from it).
What the video shows that v1 cuts: …
What v1 adds that the video doesn't show, and why: … (e.g. "a HUD clock: the fail state needs a timer"). Build gameplay needs from inventory items where possible.

## Core loop
<verb> → <verb> → <feedback> → repeat. (e.g. aim → putt → watch roll → next shot)

## Controls
- **Mouse/touch:** …
- **Keyboard:** …
(Every control maps to a high-level action that `__game.input` also accepts.)
- **Reference frame & camera during input:** e.g. "drag is read in the camera frame at press; camera holds still until release"
- **Sensitivity / dead zone / cancel:** e.g. "full power at 260 px, 16 px dead zone, drag back to start cancels"

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

Music (`public/music/<name>.mp3`, a seamless loop): one track per mood the game has (e.g. `play`, and maybe `menu`), with instruments, BPM and key from the art bible's mood: "`play`: unhurried marimba and brushed drums, 96 BPM, F major".

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
| 0N-controls | real held `drag`/`key` input aims correctly, doesn't drift while held, releases as aimed |
| 0N-full-run | bot plays to the end state |
