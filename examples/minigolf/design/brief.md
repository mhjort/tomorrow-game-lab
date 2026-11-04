# Design brief — Island Putt (3D minigolf)

## Core loop
Aim → set power → putt → watch the ball roll and bounce off rails → it stops (aim again) or drops in the cup (next hole).

## Controls
- **Mouse/touch:** drag *back* from anywhere (slingshot); direction is opposite the drag in screen space, length = power (16 px dead zone; drag back to the start to cancel). The drag is read in the camera frame at press, and the camera holds still until release. Release to putt.
- **Keyboard:** ←/→ or A/D rotate aim, hold Space to charge power, release to putt. R restarts the hole.

## Rules
- 3 holes, par 2 / 3 / 3. Stroke counted on each putt.
- Ball leaving the course (falls below the turf) → +1 penalty stroke, returns to where it was last putted.
- Ball resting in the cup sensor → hole complete; after ~1 s the next hole loads. After hole 3 a scorecard shows the total vs par.

## Win / lose
No lose state; the score is the total strokes vs par.

## Scope (in)
Three hand-made holes (straight, L-bend, ramp), aim line, power bar, HUD (hole, par, strokes), scorecard, out-of-bounds reset.

## Audio & 2D media (`design/media.json`, generate-media)
| event | sound |
|---|---|
| putt (every stroke, volume ∝ power) | `putt` — putter tock |
| ball hits a rail (sudden horizontal Δv > 0.35 m/s, rate-limited) | `rail` — wooden knock |
| ball drops in the cup | `cup` — rattle, then `holed` bell ding 0.25 s later |
| out of bounds | `water` — plop |

Images: `splash` (loading-screen background, generated from the key art), `icon` (favicon). **M** toggles sound.

## Cut list (not in v1)
Moving obstacles, music, multiplayer, hole editor, menus.

## Test hooks (`window.__game`)
- `getState()` → `{ hole, par, strokes, total, phase: 'aim'|'rolling'|'holed'|'complete', ball:{x,y,z,speed}, tee:{x,y,z}, cup:{x,y,z}, aim:{angle,power}, scorecard:[...], sfx:{ putt, rail, cup, water, holed } }` (sfx = play counts)
- `input({type:'shoot', angle, power})` — angle in degrees, 0 = down the course (−Z), positive turns right; power 0..1
- `input({type:'shoot', target:[x,z], power})` — aim at a world point
- `input({type:'loadHole', hole})`, `input({type:'reset'})`
- URL `?hole=N` starts on hole N (deep link for human review)
