---
name: publish-web-game
description: Publish a three.js web game as an optimized HTML5 build. Minified, code-split release build, meshopt-compressed GLBs, an asset manifest for the parallel loader, gzip size budgets, deployed to GitHub Pages by default with a GitHub Actions workflow, then smoke-tested at the live URL. Use when asked to publish, deploy, release, ship or host a web game, or to share a playable link.
---

# publish-web-game

The default host is **GitHub Pages**: free, works with any repo, and the URL is `https://<owner>.github.io/<repo>/`. Any static host works with the same `dist/`.

Files in this skill:
- `scripts/release.ts`: the release build. The web-game-runtime template ships an identical copy as `scripts/release.ts` behind `pnpm release`. Projects scaffolded before that existed can copy it from here.
- `assets/pages.yml`: the GitHub Actions deploy workflow.
- `scripts/serve-dist.ts`: a local static server that serves precompressed `.br`/`.gz` files, like nginx `brotli_static`.

## 1. Release build
```bash
pnpm release            # = node scripts/release.ts  [--max-js-kb 1500] [--max-total-mb 20] [--no-glb-opt]
```
1. Runs `vite build`. The template's `vite.config.ts` sets `base: './'` (relative URLs), splits three.js into its own chunk, and lazy-loads Rapier as its own JS chunk plus a real `.wasm` file.
2. Optimizes every `dist/**/*.glb` in place: dedup, weld, and meshopt (quantize + reorder + compress), typically 2–3× smaller. The runtime loader decodes these with `MeshoptDecoder`. Marker empties and collider extras are preserved; the script fails if the node set changes.
3. Injects preload hints into `dist/index.html`: `modulepreload` for lazy JS chunks, `preload as=fetch crossorigin` for the `.wasm`, every GLB, every `sfx/*` clip and `music/*` loop, and the manifest, and `preload as=image` for `images/*`. The browser then starts **every** download while parsing the HTML, instead of after three.js has loaded and the entry module has run. On the lab's live minigolf this cut the cold-load ready time from 3.46 s to 1.31 s. The new limit is the largest single file, the physics `.wasm`. The loader's `fetch()` reuses the preloaded responses, so nothing is downloaded twice. If a preload ever goes unused, Chrome logs a console warning.
4. Writes `dist/asset-manifest.json` (file → bytes) so the loading screen can show byte-accurate progress.
5. Prints a gzip size table, checks the budgets, and writes `dist/release-report.json` for the technical judge. Exit 1 means over budget.

If the build is over budget, hand it to the `optimize-web-game` skill rather than shrinking assets here. It applies the changes that don't alter the look first (compression, KTX2/WebP textures, unused three addons) and asks the user before any that do (fewer triangles, smaller textures).

Never inline large assets as base64.

### Brotli: precompressed files for hosts that serve them
`pnpm release --precompress` writes `<file>.br` (brotli q11) and `<file>.gz` (gzip -9) next to every compressible file over 1 KB. On minigolf brotli is 26% smaller than gzip, and the physics `.wasm` drops from 1148 KB to 832 KB. It adds about 7 s to the build. Use it when the host serves precompressed files:
- **nginx:** `brotli_static on; gzip_static on;` (ngx_brotli module). Also make sure `application/wasm` is in `mime.types`.
- **Caddy:** `file_server { precompressed br gzip }`
- **S3 + CloudFront:** upload the `.br` file under the original key with `Content-Encoding: br`, or let CloudFront compress.
- Check locally with `node <skill>/scripts/serve-dist.ts dist`, then run the playtest with `--url http://localhost:4180/`.

**GitHub Pages ignores precompressed files.** It compresses on the fly with gzip only, and you can't set `Content-Encoding`. So keep `--precompress` off for Pages; the extra files would only bloat the upload. A browser-side brotli decoder isn't worth it either: Chrome's `DecompressionStream` has no brotli, a WASM decoder costs much of the saving, and it breaks streaming WASM compilation. For brotli without running a server, use a CDN that compresses automatically: Cloudflare Pages, or GitHub Pages behind Cloudflare on a custom domain.

## 2. Verify the release build locally
```bash
node <game-judge skill>/scripts/playtest.ts          # serves dist/ via vite preview when dist/ exists
```
- All scenarios must pass on **webgpu and webgl2**.
- In `summary.md`, the **loading** line should show models, the Rapier `.wasm` and chunks in flight together ("max N in parallel"). A chain of one-at-a-time requests means something awaits too early. Every download belongs in the single `loading.parallel(...)` phase (see web-game-runtime).

## 3. Deploy to GitHub Pages
```bash
gh api -X POST repos/{owner}/{repo}/pages -f build_type=workflow   # once; 409 = already enabled
mkdir -p .github/workflows && cp <skill>/assets/pages.yml .github/workflows/pages.yml
git add -A && git commit -m "Publish to GitHub Pages" && git push
gh run watch "$(gh run list --workflow pages.yml --limit 1 --json databaseId -q '.[0].databaseId')"
```
- Commit `public/models/*.glb`. CI has no Blender, and the release build only optimizes the committed GLBs. Commit generated media too (`public/images/`, `public/sfx/`, `public/music/`, `./assets/media.lock.json`): CI has no `RUNWARE_API_KEY`.
- Commit `pnpm-lock.yaml` (CI runs `pnpm install --frozen-lockfile`). The workflow reads the pnpm version from `"packageManager"` in `package.json`, which the template sets.
- For a game in a sub-folder (monorepo), set `GAME_DIR` in the workflow.
- Several games in one repo: build each one and assemble a site folder (`/<game>/` per game plus an index page) before `upload-pages-artifact`. The tomorrow-game-lab repo's own workflow is an example.
- Pages enforces HTTPS, so WebGPU's secure-context requirement is met.
- **License is the user's choice.** The template sets no license. Before the first public deploy, ask the user which license they want (or none: all rights reserved). Then add the `LICENSE` file and the `license` field in `package.json` yourself. Never pick a license on their behalf.

## 4. Smoke-test the live URL
```bash
node <game-judge skill>/scripts/playtest.ts --url https://<owner>.github.io/<repo>/ --perf 0
```
This must pass on both backends with no `http 404` errors. A 404 almost always means an absolute `/...` URL; check `base: './'` and use `import.meta.env.BASE_URL` for runtime fetches. The `window.__game` hooks stay in production builds. They're cheap, and they make this live check possible.

## Gotchas
- **Gzip vs brotli:** Pages serves gzip, not brotli, so the budgets are gzip sizes. With `--precompress`, `release-report.json` also lists brotli totals.
- **Caching:** Pages caches for about 10 minutes. Vite's hashed file names make new deploys safe. Only `index.html` and `asset-manifest.json` keep stable names.
- **Rapier build:** use `@dimforge/rapier3d` (real `.wasm`, about 1.1 MB gzip, streaming compile), not `-compat` (base64, about 1.6 MB gzip plus decode time).
- **Shaders:** the release build doesn't change shader compilation. The loading screen's prewarm step still has to cover the first level, and streamed levels still compile before they are shown.
- **Streamed levels:** if `design/levels.json` exists, assets that only later levels use get no preload hint, so they don't compete with level 1. The game fetches them during play.
