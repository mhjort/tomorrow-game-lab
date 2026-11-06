# Art bible — Island Putt

Source: `design/reference/keyart.png` (palette: `design/reference/palette.json`).

## Mood
Late-afternoon, toy-like, calm. A floating grass island with a single bright course on top. Readable at a glance, no clutter.

## Palette (style.json keys)
| key | hex | use |
|---|---|---|
| grass  | #529249 | island top, everything that is *not* playable |
| turf   | #69aa71 | playable surface — must be lighter than grass so the course reads |
| rail   | #f2e6cc | course borders, flag pole |
| accent | #e4572e | flag, rail trim blocks — the only saturated warm colour; reserve for goals/hazard cues |
| water  | #3aa7d8 | ponds (out of bounds) |
| rock / wood / leaf | #946f44 / #7a4f2b / #3f7a46 | props |
| sky    | #f1cfa8 | warm peach background + fog |

The table is the **base** style (loading screen, key art). Each hole is a themed island: `style.json` → `themes.<name>` overrides the palette, sky/fog and sun per island, keeping the same roles (`grass` = island ground, `turf` lighter than the ground, `accent` reserved for the flag and trim):

| theme | ground | course | props | sky / light |
|---|---|---|---|---|
| beach | sand | green turf, white rails, coral flag | palms, umbrellas + towels, lagoon | pale cyan, high warm sun |
| snow | snow white | frosty turf, red rails, blue flag | snowy pines, snowmen, ice pond, capped rocks | cool grey-blue, low sun |
| desert | sand | dry turf, terracotta rails, teal flag | saguaros, sandstone mesas, oasis palm | warm peach, high sun |
| city | concrete | astro-turf, yellow rails, pink flag | lit towers on the rim, street lamps, planter trees, benches, fountain | dusk lavender, low orange sun |

## Lighting
Single warm sun, low (≈32° elevation), from the side so rails cast long readable shadows. Cool sky fill. No bloom, no vignette.

## Camera
Elevated 3/4 view (~40° pitch), FOV ~45°, the whole hole visible at hole start; chase view behind the ball while aiming.

## Shape language & materials
Low-poly, flat-shaded, chunky. Boxes with small bevels for rails; 8–12 sided cones/cylinders for trees and the island; hexagonal rocks. All materials matte (roughness 0.5–1.0, metalness 0). No textures.

## Scale
Meters. Lane width 1.2 m, rail height 0.12 m, ball radius 0.05 m (slightly oversized for readability), cup radius 0.09 m.
