---
name: generate-media
description: Generate 2D images (splash/key art, icons, sprites, UI, textures), game sound effects, seamless background-music loops, gameplay videos and image-to-3D models (characters, vehicles, organic props as raw GLB) with an AI service (Runware) from a declarative design/media.json, with candidate review (contact sheets, waveforms), ffmpeg post-processing (resize, silence trim, normalise) and a lock file so re-runs cost nothing. Use when a web game needs sound effects, music, a loading/splash image, a favicon or other 2D art, when a game should be built from a generated gameplay video (video-first), or when a game needs a 3D character, vehicle or organic prop that Blender scripts can't model well. Level geometry stays in blender-assets.
---

# generate-media

This skill covers what Blender scripts are bad at: painted 2D art, icons, **sound**, **music loops**, **gameplay videos** (fake "in-engine footage" that becomes the spec a game is built from), and **3D models of characters, vehicles and organic props** (image → GLB). Level geometry, colliders and simple geometric props stay as Blender scripts (`blender-assets`), and every generated GLB still goes through one (`L.import_glb`). It needs `RUNWARE_API_KEY` in the environment. If the key is missing, tell the user and skip this step; the game must still work without media.

Files in this skill:
- `scripts/generate-media.ts`: the generator. No dependencies; uses ffmpeg/ffprobe and Blender when present.
- `scripts/preview_glb.py`: Blender script that renders a generated GLB's preview sheet (run automatically). The web-game-runtime template ships an identical copy behind `pnpm media`.
- `references/runware.md`: API fields, model list with prices, limits, and prompting tips. Read it before changing models.

## 1. Write `design/media.json`
```json
{ "provider": "runware",
  "images": {
    "splash": { "prompt": "…", "reference": ["design/reference/keyart.png"], "width": 1376, "height": 768, "out": "webp", "candidates": 2 },
    "icon":   { "prompt": "… transparent background …", "transparent": true, "width": 1024, "height": 1024, "resize": 64, "out": "png", "candidates": 2 } },
  "sfx": {
    "putt": { "prompt": "One single short 'tock' … the hit is the very first sound …", "duration": 1, "seed": 31, "maxDuration": 0.3, "candidates": 3 } },
  "music": {
    "course": { "prompt": "relaxed … video game background music, marimba …, instrumental loop", "bpm": 96, "key": "F major", "bars": 8, "candidates": 2 } },
  "videos": {
    "gameplay": { "prompt": "<pitch> … Real in-engine gameplay footage, one continuous take, no cuts …", "width": 1344, "height": 768, "duration": 6, "seed": 11, "candidates": 2 } },
  "models": {
    "plough": { "image": "design/reference/props/plough-ref.png", "faceLimit": 4000 } } }
```
- Names must be unique across all kinds. Outputs go to `public/images/<name>.<out>`, `public/sfx/<name>.mp3`, `public/music/<name>.mp3` + `<name>.json` (loop sidecar), `design/reference/<name>.mp4` (a reference, not shipped) and `./assets/generated/<name>.glb` (raw; a Blender script imports and cleans it up).
- Default models: images `google:nano-banana@2.1`, `transparent: true` → `openai:gpt-image@2.5-flare`, sfx `mirelo:1@1`, music `runware:ace-step@v1.5-xl-turbo`, videos `minimax:h3@max`, models `tripo:v3.1@0`. Override with `"model"`.
- Images: `dir` (default `public/images`; `design/reference` for generated key art), `width`/`height` (both or neither), `reference` (project paths or URLs; sent as data URIs), `transparent`, `out` (`webp` default, `png`, `jpg`), `resize` (`N` or `[w, h]`, fit inside; needs `out` png/jpg and ffmpeg), `seed`, `settings` and `extra` (passed through to the provider task).
- SFX: `duration` (1–10 s, default 2), `seed`, `trimDb` (default 18), `maxDuration`, `gain` (dB after peak-normalising to −1 dBFS; use it to balance sounds against each other), `trim: false` to keep the raw clip.
- Music: `bpm` (default 120), `key` (`"D major"`), `bars` (loop length, default 8; 4 beats a bar, `beatsPerBar` to change), `duration` (generated length, default 60 s; the loop is cut from it), `loop` (default `true`; `false` = a one-shot jingle, trimmed with a fade-out, `maxDuration`), `instrumental` (default `true`) or `lyrics`, `level` (mean dBFS, default −20, so music sits under the sfx), `skip` (intro seconds the loop may not start in, default 2), `crossfade` (default 0.08 s), `seed`. Needs ffmpeg.
- Videos: `frames` (image-to-video: 1 image = first frame, 2 = first + last, 3+ = keyframes spread over the clip), `reference` (style images, only some models; H3 Max can't mix them with `frames`), `width`/`height` (H3: 1344×768, 1024×768, 768×768, 768×1344, 1536×672 at 768p) **or** `resolution` (`"768p"`; required instead of a size when `frames` is set), `duration` (s, default 5), `fps`, `seed`, `out` (`mp4` default), `audio` (default `false`: the soundtrack is stripped), `dir` (default `design/reference`), `settings`, `extra`. Entries run in order (images first), so a video's `frames` can be an image generated in the same run, e.g. `design/reference/keyart.png`.
- Models: `image` (a project path or several views of the same object; generate it first as an `images` entry, see "3D models"), or `prompt` alone for text-to-3D (worse), `faceLimit` (Tripo; enough faces to keep the crop's silhouette), `seed`, `settings`, `extra`, `dir` (default `./assets/generated`).
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
- **Music: you can't listen, so read the log and the waveform.** Each loop prints its `loop seam` score (0–1; ≥ 0.8 clean, below 0.5 a warning) and its real tempo. Pick the candidate with the best seam, then check its `.lab/media/<name>.png`: an even level across the loop, no silent gap, no fade. Whether it fits the game is a human judgement: ask in the review.
- **Videos: you can't watch them, so read the contact sheets.** Each clip gets an 8-frame sheet (`.lab/media/<name>.png`, per candidate `.lab/media/<name>/<i>.png`). Pick the clip whose frames show, in order: the player's character, its action, and a visible result of that action (a cleared path, a lit lantern). Reject cuts, HUD or text, a camera that wanders, a character that turns into something else, or nothing happening. Then hand the clip to `key-art-direction`.
- **3D: read the preview sheet** (`.lab/media/<name>.png`, needs Blender). Each tile looks from one axis: top-left from −Y, top-right from +X, bottom-left from +Y, bottom-right from −X. The tile that shows the object's front names its `forward` for `L.import_glb` (front visible top-right → `"+X"`). Check that the silhouette and colours match the reference image, and that the unseen back side is plausible.
- Changing only post-processing keys (`resize`, `out`, `trimDb`, `maxDuration`, `gain`, `trim`, `audio`, `dir`, `bars`, `loop`, `level`, `skip`, `crossfade`) re-processes the cached candidate in `.lab/media/` for free. Changing a prompt, model, size, seed, duration or reference regenerates. `--force` always regenerates.
- Loudness balance and annoyance are human judgements. Include a sound question in `make-web-game`'s human review. Don't ask separately.

## 3. Use it in the game (web-game-runtime engine)
- **SFX:** call `createAudio()` (in `src/engine/audio.ts`) and load with `audio.load(names, p)` **inside the one `loading.parallel` phase**. Play with `audio.play(name, { volume, rate })` from gameplay events in `update()`. Expose `sfx: { ...audio.counts }` in `getState()` and write a scenario that asserts each cue fires (sounds are silent in `?test`, but they are still counted).
- **Music:** `audio.loadMusic(['course'], p)` in the same `loading.parallel` phase, then `audio.playMusic('course')` once at boot or on a phase change (it starts on the first click or key; browsers block autoplay; switching tracks cross-fades). Put `music: audio.music` in `getState()` and assert it in a scenario. The mute key mutes music too.
- **Splash:** `createLoadingScreen({ title, image: 'images/splash.webp' })`. **Favicon:** `<link rel="icon" type="image/png" href="/images/icon.png">` in `index.html`.
- `pnpm release` preloads `sfx/*` and `images/*` and lists them in the asset manifest. Keep each image ≤ 150 KB (webp at about 1376 px is roughly 50 KB) each sfx ≤ 30 KB and each music loop ≤ 500 KB (a 20 s loop is about 400 KB).

## Gameplay video (video-first games)
`make-web-game` builds a game from a generated video when the user gave only words. Write the prompt in four parts, in this order:
1. **Pitch, one sentence:** who the player is, the verb, and what it changes in the world. "A tiny orange snowplough clears winding paths through a snowed-in toy village at dusk, pushing snow into heaps so villagers can walk to the lantern-lit square."
2. **Genre and look:** "Original cosy 3D driving game, low-poly flat-shaded toy look, warm window light against blue snow." Pick a look the lab can build: Blender-scripted low-poly, toy-like or stylised beats photoreal.
3. **Camera:** the rig the game will use. "High three-quarter chase camera behind the plough."
4. **The footage clause, verbatim:** "Real in-engine gameplay footage, one continuous take, no cuts, the player is clearly controlling the <character>. Absolutely no text, no letters, no numbers, no HUD, no interface on screen."
Use 1344×768, 6 s and `candidates: 2` (about $0.70). Keep `minimax:h3@max`: Turbo is half the price but lost the mechanic (the snowplough became a car). The picked clip goes to `design/reference/gameplay.mp4`.

To animate a key art image the user supplied, use `frames: ["design/reference/keyart.png"]` with `resolution: "768p"` instead of a size.

## 3D models (characters, vehicles, organic props)
1. **Reference image first** (`images` entry, `dir: "design/reference/props"`, 1024×1024, `out: "png"`, `reference`: the object's crop from `design/reference/inventory.md` (`key-art-direction`), plus `design/reference/keyart.png` for style): "The <object> from the reference image, alone, as a game asset concept: <what the crop shows, nothing more>. Whole object visible, three-quarter front view from slightly above, centred, filling most of the frame. Same style and colours as the reference. Plain pure white background, soft even light, no shadow, no other objects, no text." Describe only what the crop shows: the image model draws your words over a reference where the object is small, so an invented "scarf and knit hat" ends up on the model. Pick a candidate that shows the whole object clearly. For a **character**, ask for "standing in a T-pose: arms straight out to the sides, legs slightly apart, facing the camera, full body, front view" instead of the three-quarter view: `lab_rig` (blender-assets) rigs it in Blender, and it needs the arms away from the body.
2. **Model entry** with `image` pointing at it and a `faceLimit` that keeps the silhouette of the crop (props about 2000, vehicles and characters 4000–10000; `optimize-web-game` can reduce later, with the user's OK). About $0.30 and 2 min each.
3. **Import it in a Blender script** (`blender-assets`, `L.import_glb`): set `forward` from the sheet, a real-world `length` or `height`, `max_tris` and colliders. Never load `./assets/generated/*.glb` in the game directly: the raw files face random axes, are about 1 m long and weigh about 2 MB.

## 4. Commit
Commit `design/media.json`, `./assets/media.lock.json`, `public/images/`, `public/sfx/`, `public/music/` (mp3 + json), generated `design/reference/*` files and `./assets/generated/*.glb`. CI and other machines have no key, and the lock records model, seed and cost for each file. `.lab/media/` (candidates) is gitignored, so a post-processing change on a fresh clone has to regenerate.

## Gotchas
- Never print, log or commit the API key. The script reads it only from `RUNWARE_API_KEY`.
- Text beats a small reference. With the whole hero frame as `reference` (villagers 15 px tall) and "a winter coat, scarf and knit hat" in the prompt, nano-banana drew a big-headed chibi in a pompom hat. The video's villagers are blocky cube-headed figures without hats. Pass the full-resolution crop as the reference and keep the prompt to what the crop shows.
- Text-to-SFX models pad clips with a noise floor and often put the event late in the clip: a putt "tap" arrived after a 0.9 s swing whoosh. A late onset reads as input lag, so the script trims to the loud span (RMS within `trimDb` of the loudest 10 ms). If a clip still starts with junk, lower `trimDb` or regenerate with "the hit is the very first sound, nothing before it".
- Mirelo is weak at tonal or musical cues: a "two-note chime" came back as a 60 ms click. Ask for physical sources instead ("a small brass bell struck once"). It also can't hold one long toll: five "single huge bell, struck once" candidates all had 3–8 repeated strikes, and "a wind chime shimmer" and "a cloth whoosh" came back as noise or late onsets. When one good clip exists (a bell with one clean onset), derive the rest from it with `audio.play(name, { rate })`: rate 0.5 = an octave lower and twice as long (a great bell), 2.0 + 2.52 = a high two-note chime.
- gpt-image (`transparent: true`) needs 655,360–8,294,400 pixels in steps of 16: 1024×512 is too small (use 1280×640 for a 2:1 card). The script checks this before any request.
- Painted cards (hills, clouds, foliage) from gpt-image keep their alpha cleanly; the stair-stepped edges you may see when flattening them with ffmpeg are ffmpeg's, not the image's. Check the alpha with `ffmpeg -i x.webp -vf alphaextract`.
- Mirelo is billed per started second (about $0.01/s, observed), not the $0.00025/s on its docs page. Use `duration: 1` for one-shots and pay for candidates instead of length.
- Generated music runs off the asked tempo: ACE-Step played 112 BPM as 114 and 115, 96 as 96.05. A loop cut at the asked tempo drifts by a beat and stutters at the seam, so the script measures the real tempo first and cuts whole bars of it. ACE-Step costs about $0.004 per 60 s track (billed; its docs say $0.0009) and takes ~10 s, so ask for 2 candidates: seam scores of one prompt ranged from 0.47 to 0.96.
- MP3 adds encoder padding, which breaks loops. The script encodes with LAME, whose header lets Chrome, Firefox and ffmpeg decode the exact loop (asserted in the minigolf playtest); `audio.ts` also skips leading padding using the sidecar's sample count. Don't re-encode `public/music/*.mp3` with other tools.
- ffmpeg usually has **no webp encoder**. So `resize` only works for png/jpg, and webp comes straight from the provider at the requested size.
- `numberResults` > 1 gives each result a different seed. The lock records the picked seed.
- The "in-engine gameplay footage" clause matters. Without it, models make cinematics: cuts, a camera that drifts in, a hero pose and nothing to play. With it, H3 Max held a chase camera and a consistent village, and showed the plough clearing a trail that villagers then walked on.
- Cheap video models drift: with LTX-2.3 Fast, a minigolf course changed shape mid-clip and the "fixed" camera orbited. Even a good clip is a spec for look, camera, characters and the core verb, not for exact level layout or physics numbers.
- Image-to-3D (tested on a snowplough, 2026-11): Tripo v3.1 gave 3.6k tris at `faceLimit: 4000`, 2.1 MB (PBR maps), took about 2 min and billed $0.30, not its $0.40 list price. Hunyuan 3D Rapid ($0.225, about 70 s) looked as good but delivered 50k tris and a 14 MB PNG texture, and its windows smeared when decimated to 4k. Both delivered the object about 1 m long, and they faced different axes (+X and −X), so always read `forward` from the sheet.
- Video tasks are async (`deliveryMethod: "async"`); the script polls `getResponse` every 5 s for up to 20 min. H3 Max returned a 6 s clip in under a minute and billed $0.056/s (list price $0.08/s). The delivered clip runs a little long (6.58 s for `duration: 6`).
