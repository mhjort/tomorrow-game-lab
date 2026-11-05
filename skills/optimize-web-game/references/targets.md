# Targets per device class

Agree one class with the user (step 1). These are starting points, not laws: the user can trade them.

| metric | desktop / mid-range laptop, 1080p (default) | phone (mid-range, 2023+) | low-end / integrated GPU |
|---|---|---|---|
| frame time (avg, CPU + submit) | < 8 ms (60 fps with headroom) | < 16 ms (60 fps) or < 33 ms (30 fps, if the user accepts) | < 16 ms |
| worst frame after boot | < 33 ms | < 50 ms | < 50 ms |
| draw calls | < 300 | < 150 | < 150 |
| triangles on screen | < 500k | < 150k | < 200k |
| texture size | ≤ 2048 px | ≤ 1024 px | ≤ 1024 px |
| boot to first frame (localhost) | < 3 s | < 4 s | < 4 s |
| total download (gzip) | < 20 MB | < 10 MB | < 10 MB |
| JS (gzip) | < 1.5 MB | < 1.5 MB | < 1.5 MB |
| per GLB | < 2 MB | < 1 MB | < 1 MB |

How to read each one:
- Frame times, boot, download: `game-judge` playtest `report.json` (`backends.*.perf`, `scenarios[].bootMs`, `network.requests`).
- Draw calls and triangles on screen: `renderer.info.render` in the game (expose it in `__game.getState()` behind `?test` if you need it in a scenario).
- Sizes: `pnpm release` → `dist/release-report.json`. Per-GLB counts: `inspect_glb.mjs --max-tris N --max-kb N` with the agreed numbers.

Headless Chrome on the dev machine is not the target device. Use it to compare before and after; when the user cares about a real phone, ask them to try the build on one (`publish-web-game` gives a URL).
