# Runware reference (checked 2026-11)

## API
- `POST https://api.runware.ai/v1` with headers `Authorization: Bearer $RUNWARE_API_KEY` and `Content-Type: application/json`. The body is a **JSON array** of tasks, and the response is `{ data: [...], errors?: [...] }`.
- Every task needs `taskType` and a `taskUUID` (UUID v4). Results echo the `taskUUID`.
- Delivery: sync by default. A sync request that runs past 120 s continues as async; poll it with `{ "taskType": "getResponse", "taskUUID": "…" }`. `generate-media.ts` does this automatically.
- `includeCost: true` adds `cost` (USD) to each result. The lock file stores it.
- Find models with `{ "taskType": "modelSearch", "taskUUID": "…", "search": "sfx", "category": "audio" | "checkpoint", "source": "official", "limit": 50 }`. It is free. Each result has `air`, `name`, and `capabilities` (`io:text-to-image`, `feat:transparency`, `io:text-to-audio`, …).

### imageInference
`model`, `positivePrompt`, `width` + `height` (or `resolution` on some models), `numberResults` 1–4, `outputType` `URL` | `base64Data` | `dataURI`, `outputFormat` `JPG` (default) | `PNG` | `WEBP`, `outputQuality` 20–99, `seed`, `inputs.referenceImages` (UUID, URL, data URI or base64), `settings` (model-specific, e.g. `background: "transparent"`, `quality`). The result has `imageURL`, `imageUUID`, `seed` and `cost`.

### audioInference
`model`, `positivePrompt`, `duration`, `numberResults` 1–4, `outputType`, `outputFormat` (`MP3` | `WAV` | `FLAC` | `OGG`), `seed`, `steps`. `audioSettings` (`bitrate`, `channels`, `sampleRate`) is only valid for MP3/OGG. The result has `audioURL`, `audioUUID`, `seed` and `cost`. The script requests WAV and encodes MP3 itself after trimming.

### videoInference
`model`, `positivePrompt`, `negativePrompt` (some models), `duration` (s), `width` + `height` or `resolution` (`720p`…, model-specific), `fps`, `seed`, `numberResults` 1–4, `outputType` `URL` (only), `outputFormat` `MP4` | `WEBM` | `MOV`, `deliveryMethod` `async` (default for video), `inputs.frameImages` (image-to-video: plain images, or `{ image, frame: "first" | "last" | <index> }`; 1 image = first frame, 2 = first + last, 3+ = spread evenly), `inputs.referenceImages` (style guidance without pinning a frame; Seedance), `settings` / `providerSettings` (model-specific, e.g. `providerSettings.google.generateAudio: false`). The submit returns `status: "processing"`; poll `getResponse` until items have `status: "success"`, `videoUUID`, `videoURL`, `cost`. Failed tasks land in `errors`.
- Each model publishes a JSON schema with exact sizes, durations, modes and per-second prices: find it in `https://runware.ai/docs/models/index.json` (`schema` field) and read `components.schemas.RequestBody.items`, `info["x-modes"]`, `info["x-pricing"]`. Check it before changing the video model: the allowed sizes differ a lot (Veo only takes 1280×720/1920×1080, and no size at all with 2+ frames).

### 3dInference
`model`, `positivePrompt` (text-to-3D; optional with images), `inputs.images` (1 image, or several views; Hunyuan 3D Rapid and TRELLIS take a single `inputs.image` instead), `numberResults`, `seed`, `outputType` `URL`, `outputFormat` `GLB` (Tripo also `FBX`), `deliveryMethod` `async` (default), `settings` (model-specific: Tripo `faceLimit` 1000–20000, `smartLowPoly`, `texture`, `pbr`, `textureQuality`, `orientation: "align_image"`, `autoSize`; Hunyuan Pro `faceCount`, `generateType`; Meshy `decimation` 1–4). The result has `outputs.files[0].url` (and `.uuid`), `seed` and `cost`. The GLBs arrive without mesh compression, so Blender imports them directly.

## Recommended models
| use | AIR | notes |
|---|---|---|
| Scene/splash art matched to key art (default) | `google:nano-banana@2.1` | up to 14 reference images; 1K sizes such as 1024², 1376×768 (16:9); ~$0.034 at 1K, ~$0.05 at 2K. No reliable alpha. |
| Transparent icons, sprites, UI (default when `transparent`) | `openai:gpt-image@2.5-flare` | `settings.background: "transparent"`, PNG/WEBP; 16–3840 px in steps of 16, 0.66–8.3 MP, aspect 1:3–3:1; `settings.quality` low…max; ~$0.03. |
| Cheap bulk: textures, variants | `bytedance:seedream@5.0-flash` | $0.0193 flat; 0.92–4.6 MP (e.g. 1024²); refs; also supports `settings.background: "transparent"`. |
| Fast prompt drafts | `runware:400@4` (FLUX.2 [klein] 4B) | sub-second, very cheap; good for exploring prompts before a final render on a better model. |
| Typography/logos | `ideogram:4.5@0` | use when the image must contain readable text (title cards). |
| Sound effects (default) | `mirelo:1@1` (Mirelo SFX 1.5) | the only dedicated text-to-SFX model on Runware; 1–10 s; billed ~$0.01 per started second (observed; the docs say $0.00025/s). |
| Gameplay video (default) | `minimax:h3@max` (MiniMax H3 Max) | Best "in-engine footage" in a side-by-side test: steady chase camera, consistent world, the mechanic visible. Text, first/last frame, or `referenceImages` (not mixed with frames). 5–15 s. Sizes 1344×768, 1024×768, 768×768, 768×1344, 1536×672 (or 480p ones); with `frameImages` pass `resolution: "768p"`, not a size. `settings.promptExpansion` `disabled`/`balanced` (default). Billed $0.056/s at 768p (list $0.08/s); 6 s ≈ $0.34, ~40 s. |
| Gameplay video draft | `minimax:h3@max-turbo` | Same sizes, text or first/last frame; $0.028/s billed. Lost the mechanic in the same test (the plough became a car). Use it only to try out prompts. |
| Cheap concept clip | `lightricks:ltx@2.3-fast` (LTX-2.3 Fast) | first/last/3–10 keyframes; any size 128–2048 in steps of 64; 1–20 s; `fps`; $0.03/s at 720p. The camera and layout drift a lot. |
| Top quality, slow | `bytedance:seedance@2.5` | 4–30 s, 480p–1080p; $0.23/s at 720p, ~2.5 min per clip; `settings.audio`, draft mode. |
| Concept video, better motion | `google:veo@3.1-lite` | 4/6/8 s; 1280×720 or 1920×1080 (no size with 2 frames; use `resolution`); $0.03/s 720p **only with** `providerSettings.google.generateAudio: false` ($0.05/s with audio). |
| Concept video from style refs | `bytedance:seedance@2.0-fast` | `inputs.referenceImages` without pinning a frame; 4–15 s; 480p/720p; $0.06–0.13/s. |
| Image-to-3D (default) | `tripo:v3.1@0` (Tripo 3D v3.1) | native `faceLimit`, clean textures, plausible unseen sides; ~2 min; billed $0.30 (list $0.40). |
| Image-to-3D, cheap/fast | `tencent:hunyuan-3d@3.1-rapid` | $0.225, ~70 s; 50k tris and a 14 MB PNG texture, so it needs heavy decimation (`L.import_glb(max_tris=…)`). |
| Image-to-3D, others | `tencent:hunyuan-3d@3.1-pro` ($0.375–0.825, multi-view), `hyper3d:rodin@gen-2` ($0.40), `meshy:meshy@6` ($0.80, slow) | untested in the lab. |
| Background removal | `bria:2@1` (Bria RMBG v2.0) | `taskType: "removeBackground"`, $0.018; not wired: prompt for a plain white background instead. |
| Music loops (default) | `runware:ace-step@v1.5-xl-turbo` | 30–300 s; `settings.bpm`, `timeSignature`, `keyScale` (`"D major"`), `lyrics` (`"[Instrumental]"` + `vocalLanguage: "unknown"` for no vocals); ~$0.004 per 60 s billed, ~10 s. |
| Music, top quality | `minimax:music@2.6` | full songs, no `duration` or tempo setting (BPM goes in the prompt); `settings.instrumental`, `lyrics`; $0.15 per song, ~2.5 min (the script sends it async). |
| Music, other | `elevenlabs:1@1` | ElevenLabs Music V1; not tested. |
| Voice lines (not wired yet) | `google:gemini@3.1-flash-tts`, `inworld:tts@2` | TTS. |

## Prompting
**Images**
- Start with the subject and composition, then the style words from the art bible (e.g. "low-poly, flat-shaded, matte, toy-like, late-afternoon sun"), then the negatives: "no text, no logo, no people".
- Scene art: pass the key art as `reference` and say "match the palette and style of the reference image". Ask for empty space where the UI will sit (the loading bar is bottom-centre).
- Icons: "bold, chunky, readable at 32 px, centred, filling most of the frame, transparent background". Generate at 1024 and `resize` down; always check the small version.

**SFX**
- One event per clip, and describe the physical source: "a putter face hitting a golf ball", "a small ball plopping into still water".
- Front-load it: "the hit is the very first sound, nothing before it".
- List what to leave out: "no music, no ambience, no voice, no reverb tail".
- Use `duration: 1` for one-shots and 3 candidates, then pick from the waveforms. Balance loudness across cues with `gain` (UI chimes −3…−6 dB, impacts 0).

**Video (gameplay footage)**: the four-part prompt is in the SKILL.md section "Gameplay video".
- One clip shows the core loop once: the player's action and its visible result.
- Name the camera rig the game will use. A good model holds it; a cheap one drifts.
- When animating supplied key art (`frames`), add "match the style of the first frame".
