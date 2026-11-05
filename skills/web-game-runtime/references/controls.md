# Controls & camera feel

`__game.input(action)` scenarios test the game *logic*. They skip the path from pointer or keys to an action, and most "it feels bad" bugs live in that path. A green playtest made only of `input` steps proves nothing about controls.

## Rules

1. **Never read input against something the input moves.** If the camera follows the aim, a drag interpreted in the *live* camera frame is a feedback loop: aim turns → camera turns → the same drag now means a new aim → the view spins. Capture the reference frame (camera yaw, ball position, screen anchor) on `input.on('dragstart')` and use that frame for the whole gesture. Recompute it only on the next press.
2. **Hold the camera still during a screen-space gesture.** While the pointer is down, don't move the camera in response to the aim. The arrow, trajectory or cursor should stay put under the player's hand. Ease the camera to its new pose after release.
3. **A held-still input gives a held-still result.** Nothing should drift, accumulate or oscillate while the player's hand isn't moving. Integrate over time only for inputs that are meant to be rates (held arrow key = turn speed).
4. **Dead zone + cancel.** Ignore tiny drags (about 16 px) so a click or a shaky press doesn't aim or fire. Dragging back to the start cancels the action, and the UI should show it (power bar back to 0).
5. **Bounded sensitivity.** Give every input-to-output mapping an explicit, sane range: degrees per pixel, degrees per second, full power at about 1/3 of the screen. Clamp everything. Keys and pointer should reach the same set of outcomes.
6. **Gestures always end.** Handle `pointercancel` and lost capture (the template's `input.ts` does). A stuck "dragging" state freezes the controls.
7. **One owner per frame.** If two inputs can drive the same value (keys and drag), pick one while a gesture is active. Don't let them fight.
8. **Camera never fights the player.** Follow cameras ease (lerp about 0.05–0.15 per tick), never rotate faster than the player could have caused, and never orbit on their own while the player is idle.

## Test with real input (required)

Write at least one scenario per control scheme that drives **real** pointer/keyboard events with the playtest's `drag` and `key` steps, and **holds** them across ticks:

```json
{ "drag": { "from": [640, 360], "to": [560, 520], "hold": 5, "release": false } },
{ "assert": "Math.abs(state.aim.angle - 26.57) < 1", "label": "aim matches the pull direction" },
{ "step": 120 },
{ "assert": "Math.abs(state.aim.angle - 26.57) < 1", "label": "aim does not drift while held still" },
{ "screenshot": "drag-held" },
{ "pointerUp": true },
{ "assert": "state.strokes === 1", "label": "release fires with the aim the player saw" }
```

Also assert that a tiny drag does nothing, and that a held key changes the value at the intended rate. Put the aim/camera state the rules depend on into `getState()` so these asserts can see it. The minigolf example's `tests/scenarios/06-drag-aim-stable.json` is a working example. Without the frame fix, the aim swung from 35° to −55° in 2 s with the mouse held still.
