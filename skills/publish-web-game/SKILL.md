---
name: publish-web-game
description: Publish a three.js web game as an optimized HTML5 build. Minified, code-split release build, meshopt-compressed GLBs, an asset manifest for the parallel loader, gzip size budgets, deployed to GitHub Pages by default with a GitHub Actions workflow, then smoke-tested at the live URL. Use when asked to publish, deploy, release, ship or host a web game, or to share a playable link.
---

# publish-web-game

The default host is **GitHub Pages**: free, works with any repo, and the URL is `https://<owner>.github.io/<repo>/`. Any static host works with the same `dist/`.

Files in this skill:
- `scripts/release.mjs`: the release build. The web-game-runtime template ships an identical copy as `scripts/release.mjs` behind `npm run release`. Projects scaffolded before that existed can copy it from here.
- `assets/pages.yml`: the GitHub Actions deploy workflow.

## 1. Release build
```bash
npm run release            # = node scripts/release.mjs  [--max-js-kb 1500] [--max-total-mb 20] [--no-glb-opt]
```
1. Runs `vite build`. The template's `vite.config.js` sets `base: './'` (relative URLs), splits three.js into its own chunk, and lazy-loads Rapier as its own JS chunk plus a real `.wasm` file.
2. Optimizes every `dist/**/*.glb` in place: dedup, weld, and meshopt (quantize + reorder + compress), typically 2–3× smaller. The runtime loader decodes these with `MeshoptDecoder`. Marker empties and collider extras are preserved; the script fails if the node set changes.
3. Injects preload hints into `dist/index.html`: `modulepreload` for lazy JS chunks, and `preload as=fetch crossorigin` for the `.wasm`, every GLB and the manifest. The browser then starts **every** download while parsing the HTML, instead of after three.js has loaded and the entry module has run. On the live site that took the ready time from about 3.5 s down to about the size of the largest file. The loader's `fetch()` reuses the preloaded responses, so nothing is downloaded twice. If a preload ever goes unused, Chrome logs a console warning.
4. Writes `dist/asset-manifest.json` (file → bytes) so the loading screen can show byte-accurate progress.
5. Prints a gzip size table, checks the budgets, and writes `dist/release-report.json` for the technical judge. Exit 1 means over budget.

If the build is over budget, look at the biggest rows first:
- textures → KTX2 or WebP, or smaller sizes
- GLBs → fewer triangles
- unused three addons → remove the imports

Never inline large assets as base64.

## 2. Verify the release build locally
```bash
node <game-judge skill>/scripts/playtest.mjs          # serves dist/ via vite preview when dist/ exists
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
- Commit `public/models/*.glb`. CI has no Blender, and the release build only optimizes the committed GLBs.
- For a game in a sub-folder (monorepo), set `GAME_DIR` in the workflow.
- Several games in one repo: build each one and assemble a site folder (`/<game>/` per game plus an index page) before `upload-pages-artifact`. The tomorrow-game-lab repo's own workflow is an example.
- Pages enforces HTTPS, so WebGPU's secure-context requirement is met.

## 4. Smoke-test the live URL
```bash
node <game-judge skill>/scripts/playtest.mjs --url https://<owner>.github.io/<repo>/ --perf 0
```
This must pass on both backends with no `http 404` errors. A 404 almost always means an absolute `/...` URL; check `base: './'` and use `import.meta.env.BASE_URL` for runtime fetches. The `window.__game` hooks stay in production builds. They're cheap, and they make this live check possible.

## Gotchas
- **Gzip vs brotli:** Pages serves gzip, not brotli, so the budgets are gzip sizes. Pre-compressing doesn't help on Pages.
- **Caching:** Pages caches for about 10 minutes. Vite's hashed file names make new deploys safe. Only `index.html` and `asset-manifest.json` keep stable names.
- **Rapier build:** use `@dimforge/rapier3d` (real `.wasm`, about 1.1 MB gzip, streaming compile), not `-compat` (base64, about 1.6 MB gzip plus decode time).
- **Shaders:** the release build doesn't change shader compilation. The loading screen's prewarm step still has to cover every level.
