# Design brief — Island Putt (3D minigolf)

## Core loop
Aim → set power → putt → watch the ball roll and bounce off rails → it stops (aim again) or drops in the cup (next hole).

## Controls
- **Mouse/touch:** drag *back* from anywhere (slingshot); direction is opposite the drag in screen space, length = power. Release to putt.
- **Keyboard:** ←/→ or A/D rotate aim, hold Space to charge power, release to putt. R restarts the hole.

## Rules
- 3 holes, par 2 / 3 / 3. Stroke counted on each putt.
- Ball leaving the course (falls below the turf) → +1 penalty stroke, returns to where it was last putted.
- Ball resting in the cup sensor → hole complete; after ~1 s the next hole loads. After hole 3 a scorecard shows the total vs par.

## Win / lose
No lose state; the score is the total strokes vs par.

## Scope (in)
Three hand-made holes (straight, L-bend, ramp), aim line, power bar, HUD (hole, par, strokes), scorecard, out-of-bounds reset.

## Cut list (not in v1)
Moving obstacles, sound, multiplayer, hole editor, menus.

## Test hooks (`window.__game`)
- `getState()` → `{ hole, par, strokes, total, phase: 'aim'|'rolling'|'holed'|'complete', ball:{x,y,z,speed}, tee:{x,y,z}, cup:{x,y,z}, aim:{angle,power}, scorecard:[...] }`
- `input({type:'shoot', angle, power})` — angle in degrees, 0 = down the course (−Z), positive turns right; power 0..1
- `input({type:'shoot', target:[x,z], power})` — aim at a world point
- `input({type:'loadHole', hole})`, `input({type:'reset'})`
