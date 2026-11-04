---
name: generate-media
description: Generate 2D images (splash/key art, icons, sprites, UI, textures) and game sound effects with an AI service (Runware) from a declarative design/media.json, with candidate review, ffmpeg post-processing (resize, silence trim, normalise) and a lock file so re-runs cost nothing. Use when a web game needs sound effects, a loading/splash image, a favicon or other 2D art. 3D models stay in blender-assets.
---

# generate-media

**3D stays in Blender** (`blender-assets`). This skill covers what Blender is bad at: painted 2D art, icons, and **sound**. It needs `RUNWARE_API_KEY` in the environment. If the key is missing, tell the user and skip this step; the game must still work without media.

Files in this skill:
- `scripts/generate-media.mjs`: the generator. No dependencies; uses ffmpeg/ffprobe when present. The web-game-runtime template ships an identical copy behind `pnpm media`.
- `references/runware.md`: API fields, model list with prices, limits, and prompting tips. Read it before changing models.

## 1. Write `design/media.json`
```json
{ "provider": "runware",
  "images": {
    "splash": { "prompt": "…", "reference": ["design/reference/keyart.png"], "width": 1376, "height": 768, "out": "webp", "candidates": 2 },
    "icon":   { "prompt": "… transparent background …", "transparent": true, "width": 1024, "height": 1024, "resize": 64, "out": "png", "candidates": 2 } },
  "sfx": {
    "putt": { "prompt": "One single short 'tock' … the hit is the very first sound …", "duration": 1, "seed": 31, "maxDuration": 0.3, "candidates": 3 } } }
```
- Names must be unique across `images` and `sfx`. Outputs go to `public/images/<name>.<out>` and `public/sfx/<name>.mp3`.
- Default models: images `google:nano-banana@2.1`, `transparent: true` → `openai:gpt-image@2.5-flare`, sfx `mirelo:1@1`. Override with `"model"`.
- Images: `width`/`height` (both or neither), `reference` (project paths or URLs; sent as data URIs), `transparent`, `out` (`webp` default, `png`, `jpg`), `resize` (`N` or `[w, h]`, fit inside; needs `out` png/jpg and ffmpeg), `seed`, `settings` and `extra` (passed through to the provider task).
- SFX: `duration` (1–10 s, default 2), `seed`, `trimDb` (default 18), `maxDuration`, `gain` (dB after peak-normalising to −1 dBFS; use it to balance sounds against each other), `trim: false` to keep the raw clip.
- `candidates` (1–4): with more than one, results wait in `.lab/media/<name>/` for review.
- Write prompts from the art bible. Always pass the key art as `reference` for scene art, so the palette and shapes match. Say "no text" for images: models love to add titles.

## 2. Generate, review, pick
```bash
pnpm media --dry-run          # requests + estimated cost; nothing is called
pnpm media                    # all entries (or: pnpm media putt splash)
pnpm media --pick splash=1 --pick putt=0
```
- **Look at every image candidate** (`.lab/media/<name>/<i>.<ext>`) next to the key art. Reject anything with text, extra objects, or wrong colours or proportions. Check icons on a dark background at their final size.
- **SFX: you can't listen, so read the waveforms.** With candidates, each one gets `.lab/media/<name>/<i>.png`; the final clip gets `.lab/media/<name>.png`. A good one-shot is one sharp onset at the left edge and a short decay. Reject clips that are continuous noise, have several hits, or are a flat line. The log prints each final clip's duration; one-shots should be ≤ 0.6 s.
- Changing only post-processing keys (`resize`, `out`, `trimDb`, `maxDuration`, `gain`, `trim`) re-processes the cached candidate in `.lab/media/` for free. Changing a prompt, model, size, seed, duration or reference regenerates. `--force` always regenerates.
- Loudness balance and annoyance are human judgements. Include a sound question in `make-web-game`'s human review. Don't ask separately.

## 3. Use it in the game (web-game-runtime engine)
- **SFX:** call `createAudio()` (in `src/engine/audio.js`) and load with `audio.load(names, p)` **inside the one `loading.parallel` phase**. Play with `audio.play(name, { volume, rate })` from gameplay events in `update()`. Expose `sfx: { ...audio.counts }` in `getState()` and write a scenario that asserts each cue fires (sounds are silent in `?test`, but they are still counted).
- **Splash:** `createLoadingScreen({ title, image: 'images/splash.webp' })`. **Favicon:** `<link rel="icon" type="image/png" href="/images/icon.png">` in `index.html`.
- `pnpm release` preloads `sfx/*` and `images/*` and lists them in the asset manifest. Keep each image ≤ 150 KB (webp at about 1376 px is roughly 50 KB) and each sfx ≤ 30 KB.

## 4. Commit
Commit `design/media.json`, `./assets/media.lock.json`, `public/images/` and `public/sfx/`. CI and other machines have no key, and the lock records model, seed and cost for each file. `.lab/media/` (candidates) is gitignored, so a post-processing change on a fresh clone has to regenerate.

## Gotchas
- Never print, log or commit the API key. The script reads it only from `RUNWARE_API_KEY`.
- Text-to-SFX models pad clips with a noise floor and often put the event late in the clip: a putt "tap" arrived after a 0.9 s swing whoosh. A late onset reads as input lag, so the script trims to the loud span (RMS within `trimDb` of the loudest 10 ms). If a clip still starts with junk, lower `trimDb` or regenerate with "the hit is the very first sound, nothing before it".
- Mirelo is weak at tonal or musical cues: a "two-note chime" came back as a 60 ms click. Ask for physical sources instead ("a small brass bell struck once").
- Mirelo is billed per started second (about $0.01/s, observed), not the $0.00025/s on its docs page. Use `duration: 1` for one-shots and pay for candidates instead of length.
- ffmpeg usually has **no webp encoder**. So `resize` only works for png/jpg, and webp comes straight from the provider at the requested size.
- `numberResults` > 1 gives each result a different seed. The lock records the picked seed.
