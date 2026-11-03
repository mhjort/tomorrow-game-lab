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

## Lighting
Single warm sun, low (≈32° elevation), from the side so rails cast long readable shadows. Cool sky fill. No bloom, no vignette.

## Camera
Elevated 3/4 view (~40° pitch), FOV ~45°, the whole hole visible at hole start; chase view behind the ball while aiming.

## Shape language & materials
Low-poly, flat-shaded, chunky. Boxes with small bevels for rails; 8–12 sided cones/cylinders for trees and the island; hexagonal rocks. All materials matte (roughness 0.5–1.0, metalness 0). No textures.

## Scale
Meters. Lane width 1.2 m, rail height 0.12 m, ball radius 0.05 m (slightly oversized for readability), cup radius 0.09 m.
