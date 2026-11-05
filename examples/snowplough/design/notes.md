# Iteration notes (builder only; no judge reads this file)

What we learned while fixing the game against the judges. The target itself is in `art-bible.md`, `style.json` and the reference; this file is the history.

## Measured against the reference (2026-11-05)
Pixel samples (k-means palettes), reference vs game:
- House walls: reference very dark red-brown (`#322926`, `#4b2622` in crops/house.png; `#531e1a` in keyart.png). Game `#7e6050`: too light. The "tan plaster panels" reading of the crop was wrong.
- Roofs: lit slopes are pale lilac-white, but slopes facing away from the light are deep saturated blue (`#024c89`, `#0f5e98` in keyart.png). Game roofs are pale grey on both slopes (`#a2b0ca`): a judge's "should be white" was followed without measuring.
- Snow darks: reference hue ~208°, game ~215° after the teal-navy shift (was ~220°).
- The video's chase camera sits behind **and to the right** of the plough (frames 1–8), so the blade is seen side-on. Straight behind, the blade's top edge reads as a plank.

## Things that did not work
- Big warm pools per house: they merged and turned the streets (and the all-lamps-lit win screen) peach.
- Bloom on the whole frame above a luminance threshold: missed the amber windows, smeared the white snow banks. Bloom emissive only.
- A flat ground plane and a heightfield that dropped to y=0 at the map edge: read as a sky band and a horizon line.
- Stretching the generated plough's flat blade to 2.6 m: read as a spoiler. Replaced with a modelled mouldboard.

## Visual judge scores
Eight single-judge rounds scored 6.3–6.75. The same build re-judged three times scored 6.4, 6.6, 6.4 and 6.8, so those rounds were mostly noise. The issues every judge raised (roof snow, blade, the edge behind the square) were the real signal.

## Palette, lighting and camera pass (measured with `visual-pack.mjs`)
Play view (boot-play vs frame_02), metrics before → after: mean luma 0.475 → 0.281 (ref 0.31), saturation 0.31 → 0.50 (0.70), cool share 0.14 → 0.43 (0.76), cool hue 221° → 220° (211°). Overview vs keyart: cool share 0.46 → 0.52 (0.51).
- The biggest single gain was roof and tree snow: near-white with emission read as neutral grey and filled a quarter of the frame. A light blue albedo with no emission lets the moon make lit slopes pale and shaded slopes deep blue.
- Pools now mostly add light (emission 0.55, albedo lerp 0.55) instead of mixing peach into blue, which turned the streets muddy under a dim moon. The bloom threshold rose to 0.35 so pools still don't bloom.
- A low moon (30°) lit roof slopes nicely but streaked shadows and measured worse; the moon stays at 58°, intensity 1.0, exposure 1.15.
- Camera: behind-left at 12 m back, 2 m to the side and 11 m up, FOV 38. At 4 m to the side it hung over the left-hand house.

## Camera pull-back and walls (panel 4.8 → 5.1 before this pass)
- Chase camera 15 m back, 2.5 m left, 13 m up, looking 6 m ahead: about nine houses in view; play-view cool share 0.43 → 0.57 (ref 0.76), avenue 0.55 (ref 0.51). The plough is now smaller than in the video; the narrow 6 m streets force the trade-off.
- Walls overshot to near-black (`#281711`, 25% of the frame) after `#6e4a3c` + emission 0.06; `#a86e52` + emission 0.18 measures `#5e3b30`.
- Headlight 8 → 3: two judges called its streak the brightest warm spot.

## Roof snow, stones, fences, square, plough (panel 5.6 before this pass)
- Roofs: 0.45 m chamfered slabs with 0.4 m overhang plus white rounded lips (snowRim) on eaves, verges and ridge: blue roof with a white rim, as in crops/house.png.
- Stones: 15 chamfered, slightly leaning grey-green rocks (`#56645b`), packed close, each under a lump of white snow.
- Fences: two pickets per gap. The square floor starts from street snow instead of packed road (it read salmon); square shot warm share 0.236 → 0.106 (ref 0.216).
- Plough: hue shift 15° → 9° (amber, not red-orange); blade yaw 14° → 22°.
- Budget: hidden faces culled (window panes and bars keep only their outward face, trunks lose caps, pickets lose bottoms) and the far forest pines lose their dark under-cones: 23.5k → 19.7k tris. `village.py` prints tris by part.

## Proportions and camera (panel 5.6 → ?)
- The houses were too big for the toy look: in the video a cabin is about as wide as the plough is long. Built at 75% inside their 6 m plots (collision is tile-based, so play is unchanged). The view shows more snow and more cabins; play-view cool share 0.55 → 0.70 (ref 0.76).
- Roof snow 0.75 m thick (judges: "a tenth of the reference's thickness"); paler roofSnow `#bcd0ee` so lit faces read snow-white, shade blue.
- ambient.ground `#20203a` → `#123c6a`: the grey-purple ground term desaturated every shadow.
- Chase camera FOV 30 from 20 m back, 17 m up; overview pulled back to match. Festival camera now looks south over the village instead of north past the map edge. Forest pines packed into a 9 m band round the map.

## Reverted: 75% houses (panel 5.6 → 4.9)
- Smaller houses plus a long lens read as "a sparse scatter of boxes, top-down" to all three judges: the video's village is dense, seen low along the street with house fronts close on both sides. Houses back to full size; chase camera 12 m back, 2.5 m left, 10 m up, 6 m ahead, FOV 38.
- The colour metrics had improved while composition got worse: check the side-by-side images, not only the numbers.
- Unlit lamps keep a faint pool (0.3); reached lamps 0.85. Blade self-light back (0.25): unlit it read olive-green under the moon.

## House proportions (panel 5.2 before)
- Judges kept calling the camera "top-down" at a 31° pitch: roofs dominated because walls were short (2.5 m) under tall roofs (2.3-3 m rise) plus 0.75 m snow and a 0.5 m overhang. Walls 3.0-3.9 m, roof rise 1.7-2.3 m, snow 0.55 m, overhang 0.3 m: the facades (windows, doors) read from the chase camera like crops/house.png.
- Overview now matches keyart's colour balance: cool 0.54 vs 0.51, warm 0.20 vs 0.21, luma 0.31 vs 0.35. Pinker lit snow (`snowLit #ffbcb4`) and stronger lamp pools (unlit 0.35, reached 1.0).
- Fire pit: 11 smaller stones on a 1.7 m ring round a dark pit, three crossed logs, the sapling smaller and behind the pit.

## Generated houses (panel 5.2 before)
- Six procedural-roof rounds never escaped "thin flat slabs". Two image-to-3D cabins (Tripo, from crops/house.png + keyart.png references, $0.75 including the concept images) have the pillowy snow, chimney caps, dormer, doors and green boxes the crop shows.
- A generated texture has no emission: under the moon its windows read dull green and the walls near-black. `src/houseGlow.js` builds an emissive map from the texture (window texels → palette amber, the rest at 0.3).
- The village went from 19.7k to 105k triangles: 2.2 ms per frame, 60 fps. No reason to decimate; that is the optimize-web-game pass's call, with the user.

## Option A: plough, exposure, pools (panel 5.6 before)
- Plough regenerated from crops/plough.png + keyart (Tripo, ~$0.37): curved mouldboard on push arms, orange cab. plough.py is now a plain import (forward -X, 3.6 m) with the blade widened 2.25 → 2.4 m toward the game's 2.6 m lane; no hue shift or blade replacement needed.
- Exposure 1.15 → 0.95 (the white generated roofs lifted the brightness), pools tighter and stronger (lamps 0.6/1.0 at sigma 2.0, windows 0.7 at 1.5), pool colour peach-orange `#ffa86e`, street snow more saturated. Overview vs keyart: luma 0.31/0.35, sat 0.48/0.57, cool 0.61/0.51, warm 0.23/0.21.
- Peach-orange pools (`#ffa86e`) read "salmon" to all three judges (panel 5.7): keyart's lit snow is pale lilac-pink (`#c3a3a5`, L 0.67). Pool colour `#f2c6cf`, snow takes 60% of it with a smaller glow (0.4), pools tighter (lamps 0.6/1.0 at sigma 1.9, windows 0.65 at 1.5). Play view vs frame_02: cool 0.66/0.76, warm 0.08/0.10, luma 0.33/0.31. warmShare doesn't count pale lilac (too unsaturated) in either image, so the overview's 0.08 vs 0.21 is the dark-until-reached lamps, not the pool colour.

## Option B: denser village (panel 5.8 before)
- Layout: the empty yard row became houses (each street is lined with three cabins on each side) and the square shrank to one tile row with three houses behind it, so it's ringed by homes instead of ending at the map edge. 14 → 21 houses; streets unchanged, so ploughing work and the clock are the same. The bot now parks in the east end of row 2: parked in the square or at the top of col 6 it blocked four villagers for good.
- The 3 houses behind the square open straight onto it, so they count as reached from the start.
- Bug found on the way: a second (emissive) texture on the generated house material rendered as the base texture once the village grew (whole frame washed out: luma 0.70 vs 0.33), both as a runtime CanvasTexture and baked in the GLB. Not isolated further. Fix: repaint the window texels amber in the base texture and use that same texture as the emission map at 0.4 (the pattern the plough and villagers already used).
