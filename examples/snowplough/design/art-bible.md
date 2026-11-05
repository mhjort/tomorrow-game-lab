# Art bible: Little Plough

Source: `design/reference/gameplay.mp4` (MiniMax H3 Max, generated), hero frame `design/reference/keyart.png` (= frame_05 of the original 8-frame read), frames in `design/reference/frames/`.

## Mood
Cosy, quiet, toy-like, blue hour. A model-railway village at dusk where warm windows answer a cold blue world.

**What makes it distinct:**
- Two-temperature light: deep blue snow in shadow, pink-peach snow inside warm lamp pools. There is no neutral white.
- Thick, rounded snow caps on every roof, fence and pine; houses look iced like gingerbread.
- One saturated orange object (the plough) is the only thing that isn't blue, brown or lamp-gold.

## Palette
| key | hex | use |
|---|---|---|
| snow | `#0f66a4` | untouched snow away from lamps: a teal-leaning navy (keyart.png's dominant colour is `#0e4a7f`, hue ~208°, 31% of the frame) |
| blade | `#f0a52a` | the plough's mouldboard, a yellow-orange lighter than the body |
| steel | `#6a6e78` | the blade's push arms |
| snowShadow | `#1d5a92` | snow in shadow / far snow; ground fog tint |
| snowLit | `#f2c6cf` | snow inside a lamp pool (measured `#d5afa9` lit street) |
| road | `#8c6774` | cleared, packed street (darker mauve with tyre lines; measured) |
| snowStreet | `#1f6aae` | uncleared snow on the streets: a little lighter than yards and fields, still blue |
| snowRim | `#e4ddf2` | the white rounded lips on roof edges, snow lumps on rocks and fence posts |
| heap | `#c9c3e0` | ploughed-up heaps (a touch brighter than snow: fresh) |
| wood | `#7a4636` | lamp posts, logs, fence rails (measured `#63322c`, lifted so it reads under moonlight) |
| plaster | `#8a5640` | the wall panels between the timbers, with a faint warm self-light: renders mid-dark brown like the cabins in keyart.png (`#7e4a3c`) |
| roofSnow | `#d6e0f4` | snow on roofs and trees: light blue, so lit slopes read pale and shaded slopes deep blue |
| timber | `#5e2a22` | the house frame: corner posts, bands, window frames and glazing bars, fence posts |
| trimGreen | `#2f4f3a` | gable boards, the box by the door |
| doorGreen | `#2f5a3e` | most doors (some are `door` red) |
| roofDark | `#2a2436` | roof edges, chimneys, window frames |
| door | `#8a1a14` | front doors |
| window | `#ff9a2e` | lit windows (2 x 2 panes), lanterns (emissive) |
| windowOff | `#3a3048` | unlit lanterns (houses not yet reached) |
| pine | `#0e3f6b` | pine needles under snow (only visible in gaps) |
| accent | `#e88a1c` | the plough; reserved for the player |
| sky | `#0b2f55` | sky colour in the palette (background and fog use `#1d4a78`, the key art's navy) |
| stone | `#4c5a55` | the stones round the square's fire pit (`crops/square.png`) |
| leaf | `#4a7a3a` | the sapling's flat crown behind the fire |
| fire | `#ff7a26` | the fire pit's embers and flames (smoulders all game, blazes at the win) |

## Lighting
- **Moon:** cool directional light (`style.json` sun) from behind-left of the default camera, high enough that shadows are soft and about a house-length long, like the video's.
- **Ambient:** hemisphere (`style.json` ambient); carries the blue.
- **Warm pools:** every lamp post and lit lantern makes a peach pool on the snow, about 4 m radius. Faked as vertex colour plus an emissive vertex attribute on the snow (cheap, as many as we like; the emission keeps them warm under the blue moon), plus one real warm point light at the square. Every house's windows warm a small patch in front of its door. Pools stay pools: blue snow shows between them. Bigger ones merge, and no blue street is left between them.
- Windows and lanterns are emissive `#ffb04a`, never lit by anything.
- Tone mapping ACES, exposure 0.95: keeps the orange and gold saturated.

## Camera
High three-quarter chase from behind and to the **left** of the plough (frames 1–8): about 35° down and far enough back that 8–10 houses and the street towards the square are in frame, so the plough reads three-quarter from behind (blade side-on) heading up-right and the street recedes towards the square. Diorama lens, FOV 30, about 18 m back, 3 m left and 15 m up. It lags the plough a little and turns slowly with it. The hero shot (keyart) looks up the avenue towards the square from the same side.

## Shape language & materials
- Low-poly, flat-shaded, chunky. Roof slopes about 40°, snow caps 0.55 m thick with white rounded lips, overhanging the eaves and rounded with a bevel.
- Houses: half-timbered cabins (pale plaster panels in a red-brown frame), 4–6 lit 2 x 2-pane windows, a green or red door with a green box beside it, a chimney, a dormer on about half, green boards on the gables. Sizes vary. Brown picket fences with snow on the post tops.
- Pines: 3 stacked cones, snow-white with a hint of blue.
- No textures except the generated plough and villager (their own baked colours). Roughness 0.9, metalness 0.

## Scale (meters)
- Plough 3.2 m long, 1.9 m wide; a generated model (crops/plough.png) with a wide curved mouldboard on push arms, widened to about the 2.6 m the game clears, `blade` `#f0a52a` (lighter than the body) on `steel` `#6a6e78` arms (crops/plough.png). The plough is the one exception to "only windows, lanterns and fire glow": body and blade carry a faint self-light so they stay orange and yellow under the blue moon (unlit, the blade read olive-green).
- Villager 1.1 m tall (toy proportions: about a third of the plough's length): a blocky figure, cube head with a hair block, plain coat, no hat or scarf. Five outfits, as in the crowd (`design/reference/inventory.md`).
- Houses are generated from `crops/house.png` (generate-media `models.house-a`, `models.house-b`: green door with a dormer, red door without), about 4.5 m square and 5.2 m to the chimney top inside a 6 m plot, sized 0.92-1.07 so no two look the same. Their painted windows are repainted the palette's amber in `village.py` and the texture doubles as a faint emission map (0.4), so the windows glow and the timber stays brown. The village packs them along the streets and round a one-tile square, like the video (21 houses).

## Motion
- Plough speed about 1 plough length/s in the video (frames 1→4: ~3 m/s); top speed in game 6 m/s on clear road, slower in deep snow.
- Snow parts at the blade and rolls to the sides as a soft ridge; the cleared lane shows two tyre lines (frames 1–2).
- Only emissive light blooms (windows, lanterns, fire): lamp pools stay just under the bloom threshold, so they light the snow without hazing the streets. Yard and field snow rolls gently, so far ground shades like ground, not like sky.
- Villagers walk at about 1.2 m/s with a bouncy gait (frames 5–8).

## Do / Don't
- Do keep everything blue except lamps, windows, the plough and villagers.
- Do put a lamp pool at every street corner so streets read as warm paths.
- Don't add text, signs or HUD into the world.
- Don't light the scene neutral white or grey: it kills the dusk.
