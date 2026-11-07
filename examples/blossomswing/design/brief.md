# Design brief: Blossom Swing

## Pitch
A little child in a yellow raincoat kicks a rope swing higher and higher under a huge old tree; every high swing
blows a stream of petals over the valley and a row of bare orchard trees bursts into blossom, until the whole
valley is pink and the child lets go at the top and flies out over the hill.

## Source video
`design/reference/gameplay.mp4`: generated (`minimax:h3@max`, seed 23, candidate 0 of 2, `./assets/media.lock.json`;
1344×768, 6.6 s) · hero frame `design/reference/keyart.png` (= frame_08, t=3.84 s)
Gameplay read, one line each, citing frames:
- **Avatar:** a small big-headed child in a yellow hooded raincoat (`crops/child.png`), seated on a plank swing
  hung on two ropes from the big tree's branch; ~0.3 of the rope's length tall.
- **Verb:** swinging (all frames): at each forward peak (t≈1.25, 3.8 s) a stream of petals leaves the branch and
  blows right over the valley (frames 04, 08) → bare orchard trees turn into pink blossom trees, row by row
  (frames 07→12: the left slope first, then the right).
- **Camera rig:** side-on, level, at seat height, ~40° FOV (frame_01); trucks slowly right after the swing
  (the trunk leaves the frame by frame_11).
- **Goal & feedback:** the valley fills with pink blossom; petals stream with each gust.
- **World pattern:** a hilltop on the left with the big tree, the boulder and grass tufts; the hill falls away to a
  valley with a round pond; orchard trees in loose rows on the slopes on both sides; green hills behind.
- **Speeds:** swing period ~2.6 s, amplitude ±35° (4 fps strip); a gust's petals cross the frame in ~2 s; a tree
  pops into bloom in well under a second.
Inventory: `design/reference/inventory.md`.
What the video shows that v1 cuts: nothing in the inventory.
What v1 adds that the video doesn't show, and why:
- A title card ("Blossom Swing · any key starts") and an end card (leap distance, best, time): a game needs a start
  and an end.
- A one-line controls hint at the bottom; it fades after the first gusts.
- A **rule** for how high you must swing: each row of the orchard needs a higher peak than the last (the video shows
  rows blooming in order, not why).
- **Letting go**: when the valley is in full bloom the child can let go and fly out over the hill, landing on the
  grass. The video never shows it; it is the finale and a replayable score (distance).
- Five small row dots at the top right: one lights per bloomed row, so the player sees progress toward the leap.
- A small kick of the legs when the player presses (the video shows the legs swinging forward and back).

## Core loop
press at the bottom of the swing to kick → the swing grows → each forward peak blows a gust → a high enough gust
blooms the next row → keep kicking higher → full bloom → let go at the right moment → land → leap again for distance.

## Controls
- **Keyboard:** Space (or ↑ / W / Enter) = kick; after full bloom it lets go · M mute · any key starts.
- **Touch / mouse:** tap or click anywhere = kick / let go.
- Actions: `{type:'kick'}` (one action for kick and let-go, the phase decides), `{type:'start'}`.
- Reference frame: fixed side view, screen-right is forward (+x), always.

## Rules
- The swing is a pendulum: rope L = 2.4 m, game gravity 14 m/s² (period ≈ 2.6 s), angle θ (forward +), linear damping
  0.03/s, quadratic air drag 0.06·ω|ω| (a perfectly kicked swing saturates near 50°; one kicked at 75% timing near 44°).
- **Kick:** adds Δω = 0.2 rad/s × q × boost in the direction of motion (boost 1.8 from rest, falling to 1 once |ω| ≥ 1.2 rad/s: getting going is the dull part) (forward at rest), where q = exp(−(θ/17°)²) is the
  timing quality (1 at the bottom, ~0 near the peaks). One kick per half-swing: a kick arms again at the next
  turning point. A kick at the wrong moment just wastes that half-swing.
- **Gust:** at each forward turning point with θ ≥ 15°, petals blow out (strength from θ). The orchard has 5 rows (61 trees);
  row i needs a peak of [15, 21, 27, 33, 39]°. A gust blooms the next unbloomed row if it is high enough (one row per
  gust); a weaker gust only blows petals, and the hint says "Swing higher to reach the next row!".
- **Full bloom** (5 rows, once every tree has popped): the hint says "let go at the top", and the next press lets go: the child leaves the seat
  with the seat's velocity ×1.32 (she pushes off; L·ω along the swing's tangent, +1 m/s up) and flies ballistically (a floaty g = 7) until it lands on the
  hill. Distance = landing x − pivot x. Letting go while swinging backward drops the child behind the swing (distance
  near 0, still counts).
- **Landed:** the child sits up in the grass; the end card shows distance and best; any kick press puts the child
  back on the swing at rest to leap again (the valley stays in bloom).

## Win / lose
Win: the first landing after full bloom (end card). No lose state: a weak half-swing only costs time.

## Scope (in v1)
- The hilltop, big tree, swing, 5 orchard rows (61 trees, at least 2.6 m apart) on the valley slopes facing the hilltop, green trees, bushes, pond,
  clouds, grass tufts and daisies; petal gusts; bloom pops; the leap and landing.
- Generated child model, rigged in Blender with sit / kick / fly / land clips.
- Sound per event, one music loop.

## Cut list (NOT in v1)
- Other characters, animals, weather, seasons, more trees to swing from, levels, online scores.

## Audio & 2D media
| event | sound |
|---|---|
| kick | `creak`: a rope creaking on a wooden branch, once |
| gust (peak with petals) | `gust`: a soft breath of wind through leaves |
| a tree pops into bloom | `bloom`: a soft wooden marimba pluck for every second tree as the gust reaches it, pitched up per row via `rate` (a cascade, not one note per row) |
| let go / land | `land`: a soft thump on grass |

Music: `play`: light, playful, spring morning: ukulele, glockenspiel and soft flute, 96 BPM, G major.
Images: `splash` (loading screen, framed like the key art), `icon`, and the child's T-pose reference `child-ref`.

## Feel targets
- First gust within ~4 s (3 good kicks).
- Full bloom in ~40–90 s for a first-time player; the perfect bot does it in ~17 s (5 gusts can't be faster than ~13 s).
- A good leap ~5–7 m; a perfect one ~8–9 m (the hill keeps falling away to the right; let go at ~20° on the upswing of a full swing; flight gravity 7, push-off ×1.32, +1 m/s up). Whole game 1–3 min.

## Test hooks
- `getState()` → `{ phase: 'title'|'swing'|'flight'|'landed', tick, swing:{theta, omega, armed}, peak, rows,
  gusts, kicks, lastKick:{tick, q}|null, child:{x, y}, leap:{distance, best}, cam:{x, y}, sfx, music, anim }`
- `input(action)`: the actions above, plus `{type:'debug', rows?:number, theta?:number, omega?:number}` (test-only).

## Scenarios
| scenario | proves |
|---|---|
| 01-boot | boots, title, overview screenshot vs keyart |
| 02-kick | kicks at the bottom grow the swing; a kick at the peak does almost nothing; one kick per half-swing |
| 03-bloom | gusts bloom rows in order and only when high enough |
| 04-keys | real Space presses kick; holding it doesn't repeat |
| 05-leap | full bloom → let go → flight → landing, distance > 0, end card; kick again → back on the swing |
| 06-full-run | bot plays from title to landed |
| 07-pointer | real clicks kick |
