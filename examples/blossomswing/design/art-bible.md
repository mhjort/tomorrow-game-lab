# Art bible: Blossom Swing

Hero shot: `reference/keyart.png` (= frame_08, t=3.84 s): the child at the forward end of the swing under the big
tree's branch, a stream of petals blowing right, the left slope in bloom and the right slope still bare, the pond
between. Second reference: `frames/frame_01.png` (t=0): the whole trunk, the boulder, every orchard tree bare.

## Mood
Cosy, bright, gentle, toy-like, springtime morning. Soft rounded clay-toy shapes, smooth shading, no outlines.

What makes it distinct:
1. A **huge brown trunk and branch** frame the left and top of the shot; the swing hangs from the branch.
2. **Bare grey-brown orchard trees turn into round pink blossom balls**, row after row, the only pink in the valley.
3. A **tiny yellow-raincoat child**: the only saturated warm colour besides the pink.

## Palette (`palette.py` on the keyart, + samples inside the crops; by-eye picks are marked)
| key | hex | use |
|---|---|---|
| skyTop | `#8fcade` | sky high up |
| skyLow | `#c6d9e2` | sky at the horizon, haze over far hills |
| cloud | `#e8edf0` | clouds lit (by eye; k-means `#cbdbe3` mixes cloud and sky) · shade `#c3d0da` |
| grass | `#98b04c` | near hill (k-means dominant `#93a640`; tuned in the game to a fresher lime under its lighting) |
| grassLit | `#b3cc5c` | tops of the near hill and grass tufts (by eye: brighter than the ground) |
| grassShade | `#5f7a2e` | the tree's shadow on the hill |
| hillMid | `#8db58a` | the valley slopes (k-means `#8daf8c`, the reference's sage) |
| hillFar | `#9cc7c0` | far ridges |
| trunk | `#6e5036` | big tree trunk and branch (measured `#5a412c` in the crop's shade; lifted so the lit side reads mid-brown) · shade `#4a3624` |
| canopy | `#e9998c` | big tree's salmon-pink canopy balls (by eye) · shade `#bf7869` (k-means) |
| bareWood | `#85706a` | orchard trunks and branches (grey-brown, by eye) |
| blossom | `#f2b8d2` | blossom canopy balls (by eye; k-means `#dcbacd` is blended with grass) · shade `#d08aac` |
| flower | `#fbf1f4` | the small white flowers, centres `#f3cf4a` |
| leaf | `#7bb372` | green lollipop trees · shade `#519c56` |
| bush | `#3f9864` | bush domes |
| water | `#6cc6e4` | pond · deep `#4fb0dc` |
| pebble | `#9a97aa` | lavender-grey pebbles and the boulder |
| rope | `#c9ad7c` | swing ropes (by eye) |
| seat | `#5c3a2d` | plank seat |
| raincoat | `#f0c82a` | child's coat (by eye; the measured `#ccb120` is the shade side) |
| skin | `#ebc4af` | face, hands · cheek `#e59a86` |
| hair | `#7f4e43` | fringe |
| trousers | `#3f8fd0` | trousers (by eye) |
| shoes | `#8a4a2e` | shoes (by eye) |
| petal | `#f594b0` | the blowing petals (by eye; lighter in the game so they don't read red) |

## Lighting
Soft morning sun from upper right and behind the camera a little (elevation ~45°, the trunk's right side lit, its
shadow falls to the left and toward the camera). Warm white sun `#fff4e0`; high, cool-blue sky ambient
(shade sides read blue-green, never black). Soft shadows. Aerial haze: distant hills fade to `skyLow`.

## Camera
Side-on, nearly level (~2.5° down), ~4.8 m from the swing, a little above the child's head, FOV 50° (measured: the rope spans ~0.65 of the frame height, the child ~0.26). The trunk fills the
left ~30% of frame_01; the branch crosses the top. The horizon sits ~45% down the frame. The camera trucks slowly
right over the clip (the trunk drifts from 30% of the frame to off-screen by frame_11), following the swing.

## Shape language & materials
Rounded, soft, chunky: tapered trunks with root flares, ball canopies, domed bushes, smooth rolling terrain. Matte
(roughness ~0.85), no metal, smooth shading on organic shapes. No textures, except the generated child's own 512 px
colour map; colour variety from palette roles.

## Scale (metres)
The child is 1.2 m tall standing (big head, ~0.4 of the height), seated ~0.7. Rope 2.4 m from branch to seat.
The trunk is ~1.4 m wide (frame_01: 170 px of 640 ≈ 1.4 × the child's seated height). The pond is ~6 m across,
~25 m away; orchard trees ~2.5–3.5 m tall (the templates are ~2.3 m, placed at ×1.1–1.5 so they read from the hilltop), spaced ~3 m, on slopes 10–60 m away.

## Motion (4 fps strip, t=0–6.6 s)
Swing period ~2.6 s, amplitude ±35°. At each forward peak (t≈1.25, 3.8 s) a stream of petals leaves the branch and
blows right and down over the valley for ~2 s. Blossom spreads in rows, nearest left slope first, then the right
slopes (frames 07→12); a tree pops from bare to full in well under a second. The camera trucks right ~1 m/s.

## Do / Don't
- Do keep the pink for the blossoms, the canopy and the petals only; the child stays the only yellow.
- Do keep shade cool and light (blue-green), never black; distant hills hazy.
- Don't add outlines, text in the world, animals, other people, fences or props not in `inventory.md`.
- Don't use flat-shaded facets on organic shapes: the video is smooth clay-toy, not faceted low-poly.
