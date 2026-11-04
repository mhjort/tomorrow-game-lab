# Runware reference (checked 2026-11)

## API
- `POST https://api.runware.ai/v1` with headers `Authorization: Bearer $RUNWARE_API_KEY` and `Content-Type: application/json`. The body is a **JSON array** of tasks, and the response is `{ data: [...], errors?: [...] }`.
- Every task needs `taskType` and a `taskUUID` (UUID v4). Results echo the `taskUUID`.
- Delivery: sync by default. A sync request that runs past 120 s continues as async; poll it with `{ "taskType": "getResponse", "taskUUID": "…" }`. `generate-media.mjs` does this automatically.
- `includeCost: true` adds `cost` (USD) to each result. The lock file stores it.
- Find models with `{ "taskType": "modelSearch", "taskUUID": "…", "search": "sfx", "category": "audio" | "checkpoint", "source": "official", "limit": 50 }`. It is free. Each result has `air`, `name`, and `capabilities` (`io:text-to-image`, `feat:transparency`, `io:text-to-audio`, …).

### imageInference
`model`, `positivePrompt`, `width` + `height` (or `resolution` on some models), `numberResults` 1–4, `outputType` `URL` | `base64Data` | `dataURI`, `outputFormat` `JPG` (default) | `PNG` | `WEBP`, `outputQuality` 20–99, `seed`, `inputs.referenceImages` (UUID, URL, data URI or base64), `settings` (model-specific, e.g. `background: "transparent"`, `quality`). The result has `imageURL`, `imageUUID`, `seed` and `cost`.

### audioInference
`model`, `positivePrompt`, `duration`, `numberResults` 1–4, `outputType`, `outputFormat` (`MP3` | `WAV` | `FLAC` | `OGG`), `seed`, `steps`. `audioSettings` (`bitrate`, `channels`, `sampleRate`) is only valid for MP3/OGG. The result has `audioURL`, `audioUUID`, `seed` and `cost`. The script requests WAV and encodes MP3 itself after trimming.

## Recommended models
| use | AIR | notes |
|---|---|---|
| Scene/splash art matched to key art (default) | `google:nano-banana@2.1` | up to 14 reference images; 1K sizes such as 1024², 1376×768 (16:9); ~$0.034 at 1K, ~$0.05 at 2K. No reliable alpha. |
| Transparent icons, sprites, UI (default when `transparent`) | `openai:gpt-image@2.5-flare` | `settings.background: "transparent"`, PNG/WEBP; 16–3840 px in steps of 16, 0.66–8.3 MP, aspect 1:3–3:1; `settings.quality` low…max; ~$0.03. |
| Cheap bulk: textures, variants | `bytedance:seedream@5.0-flash` | $0.0193 flat; 0.92–4.6 MP (e.g. 1024²); refs; also supports `settings.background: "transparent"`. |
| Fast prompt drafts | `runware:400@4` (FLUX.2 [klein] 4B) | sub-second, very cheap; good for exploring prompts before a final render on a better model. |
| Typography/logos | `ideogram:4.5@0` | use when the image must contain readable text (title cards). |
| Sound effects (default) | `mirelo:1@1` (Mirelo SFX 1.5) | the only dedicated text-to-SFX model on Runware; 1–10 s; billed ~$0.01 per started second (observed; the docs say $0.00025/s). |
| Music (not wired yet) | `runware:ace-step@v1.5-xl-turbo`, `minimax:music@2.6` | full tracks/loops; would need loop-point handling in `audio.js`. |
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
