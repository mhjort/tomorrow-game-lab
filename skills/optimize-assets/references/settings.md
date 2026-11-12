# design/optimize.json settings

`pnpm release` (publish-web-game's `release.ts`) reads this file and applies it to the copies in `dist/` only.
- **Keys:** dist-relative paths or globs. `*` matches anything; `music/*` matches inside one folder.
- **Merging:** every matching key is merged, wildcards first and exact paths last, so a file's own entry wins.
- **No file:** only the lossless GLB pipeline runs (dedup, weld, meshopt).

```json
{
  "textures": { "*": { "format": "webp", "quality": 90 }, "models/hero.glb": { "maxSize": 1024 } },
  "models":   { "models/world.glb": { "simplify": { "ratio": 0.5, "error": 0.002 } } },
  "images":   { "images/*": { "quality": 85 }, "images/splash.webp": { "maxSize": 2560 } },
  "audio":    { "music/*": { "vbr": 5 }, "sfx/*": { "vbr": 5 }, "sfx/step.mp3": { "mono": true } },
  "decisions": [{ "change": "simplify:models/world.glb:0.5", "accepted": false, "gain": "-89 KB gzip", "date": "2026-11-13" }]
}
```

| setting | saves | look | notes |
|---|---|---|---|
| `textures.format` webp, `quality` 90 | 30–70% of texture bytes | near-lossless | GLTFLoader reads `EXT_texture_webp`. The release keeps the smaller of with and without it. |
| `textures.maxSize` 1024 (from 2048) | ~75% of that texture | **visible** up close | `trial` it. Characters seen small rarely show it. |
| `models.simplify` ratio / error | triangles, raw bytes | **visible** | Named files only. Check the gzip gain: it can be negative. |
| `images.quality` 85 (WebP/JPEG) | 30–60% | near-lossless | `check` compares the image itself (≥ 0.985). |
| `images.quality` 70 | another ~40% | **visible** (gradients) | Loading-screen art only. |
| `images.maxSize` | big splashes | near-lossless above 2560 px | A full-screen backdrop needs ~2560 px for 1440p. |
| PNG | small | lossless | `compressionLevel` 9 only. Kept only when smaller. |
| `audio.vbr` 5 (LAME, ~130 kbps) | 15–25% vs generate-media's VBR 4 | near-lossless | Music loops must keep their sample count (the release checks). |
| `audio.vbr` 7 (~100 kbps) | another ~30% | **audible** on headphones | Listen on the dev link before offering it. |
| `audio.mono` | ~half of a stereo sfx | near-lossless if the file is near-mono | `inventory` measures it (side/mid energy < 0.5%). |

## Not automated yet (offer them in the report when they would matter)
- **KTX2/Basis textures:** saves GPU memory, not just download, so it matters on phones with many big textures. Needs `toktx` (KTX-Software) at release time and `KTX2Loader` with its transcoder in the game. The colours can shift: compare screenshots.
- **Opus or AAC music:** about half the size of MP3 at the same quality. Needs `engine/audio.ts` to load another extension, and a check on Safari.
- **Instancing repeated meshes:** grass, fences, rows of props. It is an asset-script and game change (one mesh plus a list of transforms), and often the biggest geometry win: see the inventory's biggest meshes.
- **Rapier wasm (~1.1 MB gzip):** only games that use physics carry it. A game with simple collisions can drop the dependency.
