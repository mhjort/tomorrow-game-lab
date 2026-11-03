---
name: key-art-direction
description: Turn a reference image or video (key art, concept art, gameplay footage) into a concrete art bible and a machine-readable design/style.json that drives both Blender asset scripts and the three.js game. Use when a game should look like a given picture or video, or when asked to extract palette, lighting, camera and mood from references.
---

# key-art-direction

Output: `design/reference/` (inputs + derived frames), `design/art-bible.md`, `design/style.json`.
Scripts (in this skill's `scripts/` dir): `extract-frames.sh` (needs ffmpeg) and `palette.py` (needs ffmpeg, no pip packages).

## Steps

1. **Collect references.** Copy every reference into `design/reference/` and keep the original filenames.
2. **Video?** Extract key frames and a contact sheet:
   ```bash
   bash <skill>/scripts/extract-frames.sh design/reference/clip.mp4 design/reference/frames 12
   ```
   Look at `contact-sheet.png` first, then at 2–4 individual frames. For gameplay footage, also note:
   - camera behaviour (follow, fixed, orbit)
   - HUD layout
   - motion: speed, how snappy it feels, any squash and stretch
3. **Palette.** Run `python3 <skill>/scripts/palette.py <image> -k 8 -o design/reference/palette.json` on the main image, or on 2–3 representative frames. k-means only finds the *dominant* colours. Small accents (flags, pickups, UI) get averaged away, so pick those by eye and add them.
4. **Study the image yourself** and describe it before you write anything. Cover:
   - Palette roles: what is ground, what is the play surface, what is an accent or hazard. Accent colours must be reserved for gameplay-relevant objects.
   - Light: sun elevation and azimuth, warm or cool, how hard the shadows are, the ambient colour.
   - Camera: height, pitch, FOV (wide/normal/tele), framing.
   - Shapes and materials: low-poly or smooth, bevels, roughness, textures (prefer none).
   - Scale cues and mood words (3–5).
5. **Write `design/art-bible.md`** with these sections: Mood · Palette table (key / hex / use) · Lighting · Camera · Shape language & materials · Scale (meters) · Do/Don't. Keep it to one page; judges read it.
6. **Write `design/style.json`.** The game and the Blender scripts both read it, so it is the single source of truth for the look:
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
7. **Hand-off.** Tell `make-web-game` which image or frame is the hero shot. The boot scenario needs an *overview* screenshot framed like it so the visual judge can compare like with like.

## Quality bar
- Every colour in `style.json` traces back to the reference: measured with `palette.py` or picked from a named region.
- The art bible says what makes this look distinct in 3 bullets. If you can't say it, look again.
