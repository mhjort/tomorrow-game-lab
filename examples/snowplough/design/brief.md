# Design brief — Little Plough

## Pitch
You drive a tiny orange snowplough through a snowed-in toy village at dusk, clearing paths so every villager can walk from their door to the lantern square before the 18:00 festival.

## Source video
`design/reference/gameplay.mp4` · MiniMax H3 Max, seed 11, $0.34 (`assets/media.lock.json`) · hero frame `design/reference/keyart.png` (frame 5 of the original 8-frame read; `design/reference/frames/` holds 8 frames of the clip)
Gameplay read:
- **Avatar:** an orange wheeled snowplough with a yellow front blade, about 3 m long; seen from behind, it fills roughly an eighth of the frame width (frames 1–4).
- **Verb:** drive; the blade parts the snow and leaves a darker packed lane with tyre lines behind it, snow banked at the sides (frames 1–2).
- **Camera rig:** high three-quarter chase behind the plough, pitch about 40° down, about 4 plough lengths back, turning slowly with it (frames 1–4).
- **Goal & feedback:** blocky villagers in plain coats stand by lit houses and walk on the cleared lanes towards a lantern-lit square with a stone-ringed fire pit and a small sapling (frames 5–8, `crops/square.png`).
- **World pattern:** a grid of streets about two plough widths wide, houses with fenced yards on both sides, pines between, the square at the far end of the main street.
- **Speeds:** the plough moves about 1 plough length per second (~3 m/s) in fresh snow; villagers walk about 1.2 m/s.
Inventory: `design/reference/inventory.md` (one full-resolution crop per element; the nouns above come from it).
What the video shows that v1 cuts: exact layout, chimney smoke, more vehicles.
What v1 adds that the video doesn't show, and why:
- A HUD clock and the 18:00 deadline: the fail state needs a timer.
- Lamps that stay dark until a house is reached: shows progress across the map (in the video every lamp is lit).
- The festival: the square's fire pit blazes up and everyone cheers. The win needs a payoff, so it uses the fire the video already has.
- Villagers start by their doors and gather round the fire; the video shows them walking, not where they go.
- Falling snow and a faint headlight on the plough: the snow sells the weather while the streets are quiet, and the headlight hints where the blade will cut. Both are kept subtle; the video's plough has no beam, so the headlight must never be the brightest warm spot.

## Core loop
drive into a snowed-in street → the blade clears a lane (slow in fresh snow, fast on cleared road) → a doorstep joins the cleared network → the house lamp lights, a chime, the villager walks to the square → pick the next street → repeat until everyone is there.

## Controls
- **Keyboard:** ↑/W drive, ↓/S brake then reverse, ←/→ (A/D) steer. C camera (chase / high), R restart, M sound.
- **Mouse/touch:** a drag is a virtual joystick around the press point: up = throttle, down = brake/reverse, sideways = steer.
- **Reference frame & camera during input:** the drag is read in screen space against its own press point, never the camera, so the chase camera turning with the plough can't feed back into the input.
- **Sensitivity / dead zone / cancel:** 12 px dead zone, full throttle or full lock at 80 px; releasing (or a cancelled pointer) zeroes the input.
Every control maps to `{ type: 'drive', throttle, steer }`, which `__game.input` also accepts.

## Rules
- The map is 9 × 9 tiles of 6 m (`src/village.json`): streets, the square, house plots and tree yards. Houses and yards are solid; bumping them slows the plough to a third.
- Snow lies on every street (depth 1 ≈ 0.4 m). Each house has a shovelled doorstep path 2 m into its street, and there is a trodden 2 m apron around the square.
- The blade (2.6 m wide) clears snow when driving forwards; the snow is pushed to the sides as windrows on still-snowy road, or as heaps in the yards. Never onto cleared road.
- Fresh snow loads the blade: top speed falls from 7 m/s on cleared road to about 4 m/s in fresh snow and less in windrows.
- A house is reached when its doorstep connects to the square through cleared road (4-neighbour, 0.5 m cells). Its lamp lights, a chime plays (one per house, a beat apart), and its villager walks the shortest cleared path to the square, re-planning if a shorter street opens. Villagers wait while the plough is in their way.

## Win / lose
- **Win:** all 21 villagers are at the square before 18:00 → the festival: the fire pit blazes up, everyone cheers, a jingle plays.
- **Lose:** at 18:00 (150 s after you start driving) the festival starts without those not at the square; the card shows how many made it. R restarts.

Collision is grid-based (`src/world.js`: every non-road tile is solid, the plough is two circles), so the game needs no physics engine; the template's Rapier module was removed.

## Scope (in v1)
One village, 21 houses (packed along the streets and round the square, like the video's), one plough, the clock, sounds and a music loop, keyboard and pointer controls, chase and high cameras.

## Cut list (explicitly NOT in v1)
Chimney smoke, more levels or random villages, snowfall that refills streets, other vehicles, plough upgrades, touch-specific UI buttons, a minimap.

## Audio & 2D media
| event | sound |
|---|---|
| blade clearing snow | `scrape`: crunchy push of packed snow (every 0.32 s while clearing, louder with more load) |
| hitting a fence or house | `bump`: muffled thud |
| a path opens | `chime`: one bright hand bell |

Music: `theme` (music box, pizzicato, sleigh bells, 114 BPM, D major, seamless loop) while playing; `festival` (6 s sleigh-bell fanfare, one-shot) at the win.
Images: splash (the loading screen, framed like the key art), icon (favicon).

## Feel targets
- Plough: ~4 m/s in fresh snow, 7 m/s on cleared road, turning radius ~2.9 m; a 90° turn at a junction fits without reversing.
- A clean route (the bot) clears all 21 houses in ~85 s of driving and wins with ~70 s left; a first-time player should finish with 20–60 s left.
- Villagers walk 1.3 m/s; the furthest walk takes ~30 s.

## Test hooks (`window.__game`)
- `getState()` → `{ phase: 'intro'|'play'|'won'|'lost', timeLeft, clock, total, reached, arrived, plough: {x, z, heading, speed, load}, controls, cleared, villagers: [{house, state, x, z}], houses, square, camera, fireBlazing, outfits, cheering, bumps, anims, sfx, music }`
- `input({ type: 'drive', throttle, steer })`, plus test helpers `{ type: 'reset' }`, `{ type: 'camera', mode: 'chase'|'high'|'overview' }`, `{ type: 'teleport', x, z, heading }`, `{ type: 'setTime', seconds }`.
- `?time=N` sets the festival timer (review), `?test` for deterministic runs.

## Scenarios
| scenario | proves |
|---|---|
| 01-boot | boots to the intro (villagers in 5 outfits), driving starts the game and clears snow; intro, play and key-art overview screenshots |
| 02-clear-avenue | one pass reaches exactly the 8 avenue houses (+3 that open onto the square); villagers set off, yield to the plough, then arrive |
| 03-snow-slows | ~4 m/s in fresh snow, near 7 m/s on the cleared lane |
| 04-walls | yards, the fire pit's stone ring and the map edge are solid, bump sound |
| 05-time-up | 18:00 ends the game (lost), music stops, R restarts with fresh snow |
| 06-keys | real held keys and chords drive, steer, release cleanly, brake then reverse |
| 07-drag-joystick | real held drag: dead zone, throttle and steer, no drift while held (also while the camera turns), release stops |
| 08-rules | windrows add load beside a cleared lane, bumps cut speed to a third, WASD, C high camera, M mute |
| 09-full-run | bot clears every street with drive actions only and wins the festival |
