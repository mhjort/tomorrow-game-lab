---
name: key-art-direction
description: Turn a reference image or video (key art, concept art, gameplay footage, or an AI-generated concept clip from generate-media) into a concrete art bible and a machine-readable design/style.json that drives both Blender asset scripts and the three.js game. Use when a game should look like a given picture or video, or when asked to extract palette, lighting, camera and mood from references.
---

# key-art-direction

Output: `design/reference/` (inputs, derived frames, crops, `inventory.md`), `design/art-bible.md`, `design/style.json`.
Scripts (in this skill's `scripts/` dir): `extract-frames.sh`, `crop-frame.sh` (both need ffmpeg) and `palette.py` (needs ffmpeg, no pip packages).

## Steps

1. **Collect references.** Copy every reference into `design/reference/` and keep the original filenames.
2. **Video?** Extract key frames and a contact sheet:
   ```bash
   bash <skill>/scripts/extract-frames.sh design/reference/clip.mp4 design/reference/frames 12
   ```
   Frames are numbered in time order and `times.txt` gives each one's time, so the brief can cite "frame_08, t=8.8 s" and `crop-frame.sh` can grab the same moment at full resolution. Look at `contact-sheet.png` first, then at 2–4 individual frames. For gameplay footage, also note:
   - camera behaviour (follow, fixed, orbit)
   - HUD layout
   - motion: speed, how snappy it feels, any squash and stretch
   For a **generated gameplay video** (`generate-media`'s `videos`, listed in `./assets/media.lock.json`), the video is the spec for the look, the camera rig, the avatar and the core verb. The game must look like it. Pick the frame that best shows the game in play as the hero shot and copy it to `design/reference/keyart.png`. Measure the camera and speeds against the avatar's size. Ignore what drifts between frames (exact layout, object counts) and staged physics. If `make-web-game` asks for a Gameplay read, write it from the same frames.
3. **Inventory: what is actually in the reference.** Frames and contact sheets are 640 px or less, so small things (characters, a centrepiece far away) are a few pixels. Guess at those, and a vague green blob becomes "a decorated Christmas tree" in the brief. Then a mechanic gets built on it and a generated model gets made from your words, not from the picture. So, for every kind of thing that will appear in the game (avatar, characters, centrepiece, recurring props, buildings, ground), crop it at full source resolution, from the moment where it is biggest:
   ```bash
   bash <skill>/scripts/crop-frame.sh design/reference/gameplay.mp4 design/reference/crops/villager.png 0.64 0.47 0.05 0.12 4.5
   ```
   (`x y w h` are fractions of the frame; the last argument is the time in seconds, for videos.) Look at each crop, then write `design/reference/inventory.md`:
   | element | crop | what the crop shows | variety | confidence |
   |---|---|---|---|---|
   | villager | `crops/villager.png` (t=4.5) | blocky toy figure, cube head with a hair cap, plain coat, no hat | ~8 seen; coats red, blue, green, maroon; hair brown, yellow | clear |
   - Write only what the crop shows: shapes, colours, parts. Don't name things by genre ("winter square → Christmas tree", "villager → scarf and knit hat").
   - **Variety**: how many there are and how they differ. One model for a crowd that varies in the video is a deviation, and the brief must list it.
   - **Confidence**: `clear`, or `unclear` plus what you can see ("green blob on a stalk, maybe a sapling"). Try another moment before giving up. Don't build a rule or a generated asset on an `unclear` item without saying so in the brief.
   The brief, the generated-asset prompts and the visual judge all read this file.
4. **Palette.** Run `python3 <skill>/scripts/palette.py <image> -k 8 -o design/reference/palette.json` on the main image, or on 2–3 representative frames. k-means only finds the *dominant* colours. Small accents (flags, pickups, UI) get averaged away, so pick those by eye and add them. Soft gradients get averaged too: the bell-tower rainbow's bands came out as `#e1ac80`/`#7ab5d0` (each band blended with the sky) and rendered as a faint pastel smear. Pick gradient stops by eye from a crop.
   **Scale and camera, measured:** pick one thing of known size (the tower's width, a door), count its pixels in two frames and get px/m for each (bell tower: 65.6 px/m in the play frame, 52 in the opening frame). Then size every element and place the camera from those numbers (visible width = px width ÷ px/m → distance from the FOV). A different px/m between frames means the camera dollies; copy that move.
5. **Study the image yourself** and describe it before you write anything. Cover:
   - Palette roles: what is ground, what is the play surface, what is an accent or hazard. Accent colours must be reserved for gameplay-relevant objects.
   - Light: sun elevation and azimuth, warm or cool, how hard the shadows are, the ambient colour.
   - Camera: height, pitch, FOV (wide/normal/tele), framing.
   - Shapes and materials: low-poly or smooth, bevels, roughness, textures (prefer none).
   - Scale cues and mood words (3–5).
6. **Write `design/art-bible.md`** with these sections: Mood · Palette table (key / hex / use) · Lighting · Camera · Shape language & materials · Scale (meters) · Motion (only with a video reference: speeds, durations and effects as numbers the brief's feel targets can reuse, and which frame they came from) · Do/Don't. Keep it to one page; judges read it.
7. **Write `design/style.json`.** The game and the Blender scripts both read it, so it is the single source of truth for the look:
   ```json
   {
     "palette": { "<role>": "#rrggbb", "...": "..." },
     "background": "#rrggbb",
     "fog": { "color": "#rrggbb", "near": 20, "far": 80 },
     "sun": { "color": "#rrggbb", "intensity": 3.0, "elevation": 35, "azimuth": 60, "shadows": true },
     "ambient": { "color": "#rrggbb", "ground": "#rrggbb", "intensity": 1.0 },
     "materials": { "roughness": 0.8, "metalness": 0.0 },
     "camera": { "fov": 45 },
     "toneMapping": "ACES | AgX | Neutral | None",
     "exposure": 1.0
   }
   ```
   - Palette keys are *roles* such as `turf` and `accent`, not colour names. Asset scripts call `L.color("turf", style)`.
   - Tone mapping changes saturation a lot. `AgX` desaturates bright greens and reds; use `Neutral` or `ACES` for saturated, toy-like art. Check this against the key art in the first playtest screenshot.
8. **Hand-off.** Tell `make-web-game` which image or frame is the hero shot. The boot scenario needs an *overview* screenshot framed like it so the visual judge can compare like with like.

## Quality bar
- Every colour in `style.json` traces back to the reference: measured with `palette.py` or picked from a named region.
- The art bible says what makes this look distinct in 3 bullets. If you can't say it, look again.
- Every element in `inventory.md` has a crop, and its description would let someone who never saw the video pick it out of a line-up.
