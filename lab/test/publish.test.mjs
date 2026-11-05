import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, SKILLS, tmp, run } from './helpers.mjs';
import { inspectGlb } from '../../skills/blender-assets/scripts/inspect_glb.mjs';

const GAME = join(ROOT, 'examples/minigolf');
const DIST = join(GAME, 'dist');

test('release: minigolf builds minified + code-split, GLBs meshopt-optimized, within budgets', { timeout: 180000 }, () => {
  const r = run('pnpm', ['--filter', 'minigolf', 'run', 'release'], { cwd: ROOT });
  assert.equal(r.status, 0, r.stdout.slice(-2000) + r.stderr.slice(-2000));
  const report = JSON.parse(readFileSync(join(DIST, 'release-report.json'), 'utf8'));
  assert.deepEqual(report.problems, []);
  const assets = readdirSync(join(DIST, 'assets'));
  assert.ok(assets.some((f) => /^three-.*\.js$/.test(f)), 'three.js in its own chunk');
  assert.ok(assets.some((f) => /^rapier.*\.wasm$/.test(f)), 'Rapier ships a real .wasm (not base64-inlined)');
  assert.ok(report.totals.jsGzipKb < 600, `JS gzip ${report.totals.jsGzipKb} KB (non-compat Rapier keeps JS small)`);
  // relative URLs only (GitHub Pages serves under /<repo>/)
  assert.doesNotMatch(readFileSync(join(DIST, 'index.html'), 'utf8'), /(src|href)="\/(?!\/)/);
  const manifest = JSON.parse(readFileSync(join(DIST, 'asset-manifest.json'), 'utf8'));
  assert.ok(manifest['models/hole1.glb'] > 0);
  assert.ok(manifest['sfx/putt.mp3'] > 0 && manifest['images/splash.webp'] > 0, 'generated media in the manifest');
  const html = readFileSync(join(DIST, 'index.html'), 'utf8');
  assert.match(html, /<link rel="preload" as="fetch" crossorigin href="\.\/sfx\/putt\.mp3">/);
  assert.match(html, /<link rel="preload" as="image" href="\.\/images\/splash\.webp">/);
  for (const name of ['hole1', 'hole2', 'hole3', 'ball']) {
    const info = inspectGlb(join(DIST, 'models', `${name}.glb`));
    assert.ok(info.extensions.includes('EXT_meshopt_compression'), `${name} meshopt-compressed`);
  }
  // marker empties and collider tags survive optimization (prune keepLeaves)
  const hole1 = inspectGlb(join(DIST, 'models/hole1.glb'));
  assert.ok(hole1.nodes.some((n) => n.name === 'Tee') && hole1.nodes.some((n) => n.name === 'CupCenter'), 'markers kept');
  assert.ok(hole1.colliders.includes('CupSensor:cuboid(sensor)'));
});

test('release: optimized build plays on both backends and loads assets in parallel', { skip: process.env.SKIP_BROWSER && 'SKIP_BROWSER set', timeout: 300000 }, () => {
  assert.ok(existsSync(join(DIST, 'index.html')), 'run the release test first');
  const out = tmp('release-playtest');
  // dist/ exists -> playtest serves it with vite preview (the production build)
  const r = run(process.execPath, [join(SKILLS, 'game-judge/scripts/playtest.mjs'), '--project', GAME, '--perf', '0', '--parity-min', '0.98', '--out', out]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const rep = JSON.parse(readFileSync(join(out, 'report.json'), 'utf8'));
  assert.match(rep.url, /localhost/);
  for (const b of Object.values(rep.backends)) {
    assert.ok(b.network.maxParallel >= 3, `max parallel requests ${b.network.maxParallel}`);
    const wasm = b.network.requests.find((n) => n.file.endsWith('.wasm'));
    const glbs = b.network.requests.filter((n) => n.file.endsWith('.glb'));
    assert.ok(wasm && glbs.length === 4, 'wasm + 4 GLBs requested');
    assert.ok(glbs.some((g) => g.start < wasm.end && g.end > wasm.start), 'models download while the physics WASM downloads');
    // preload hints: models + wasm start with the HTML, not after three.js has loaded and the entry module ran
    const three = b.network.requests.find((n) => /^three-.*\.js$/.test(n.file));
    assert.ok(glbs.every((g) => g.start < three.end) && wasm.start < three.end, 'assets start before three.js finishes');
    const sfx = b.network.requests.filter((n) => n.file.endsWith('.mp3'));
    assert.equal(sfx.length, 6, 'every sound effect + the music loop requested');
    assert.ok(sfx.every((x) => x.start < three.end), 'sound effects and music preload with the HTML');
    assert.ok(b.network.requests.some((n) => n.file === 'course.json'), 'music loop sidecar fetched');
    const dups = b.network.requests.filter((x, i, a) => a.findIndex((y) => y.file === x.file) !== i);
    assert.deepEqual(dups, [], 'preloaded responses are reused (no double downloads)');
  }
});

test('site: landing page + /minigolf/ assembled for GitHub Pages', () => {
  assert.ok(existsSync(join(DIST, 'index.html')), 'run the release test first');
  const r = run(process.execPath, [join(ROOT, 'lab/build-site.mjs')]);
  assert.equal(r.status, 0, r.stderr);
  const index = readFileSync(join(ROOT, '_site/index.html'), 'utf8');
  assert.match(index, /href="\.\/minigolf\/"/);
  assert.ok(existsSync(join(ROOT, '_site/minigolf.jpg')));
  assert.ok(existsSync(join(ROOT, '_site/minigolf/index.html')));
  assert.ok(existsSync(join(ROOT, '_site/minigolf/asset-manifest.json')));
});

test('release --precompress: .br/.gz siblings decode to the originals and the game plays when served with Content-Encoding: br', { skip: process.env.SKIP_BROWSER && 'SKIP_BROWSER set', timeout: 300000 }, async () => {
  const { brotliDecompressSync, gunzipSync } = await import('node:zlib');
  const { spawn } = await import('node:child_process');
  const r = run(process.execPath, ['scripts/release.mjs', '--precompress'], { cwd: GAME });
  assert.equal(r.status, 0, r.stdout.slice(-1500) + r.stderr.slice(-1500));
  const report = JSON.parse(readFileSync(join(DIST, 'release-report.json'), 'utf8'));
  assert.ok(report.totals.totalBrotliMb < report.totals.totalGzipMb * 0.85, 'brotli at least 15% smaller than gzip');
  const wasm = readdirSync(join(DIST, 'assets')).find((f) => f.endsWith('.wasm'));
  for (const f of [`assets/${wasm}`, 'models/hole1.glb']) {
    const orig = readFileSync(join(DIST, f));
    assert.ok(brotliDecompressSync(readFileSync(join(DIST, `${f}.br`))).equals(orig), `${f}.br round-trips`);
    assert.ok(gunzipSync(readFileSync(join(DIST, `${f}.gz`))).equals(orig), `${f}.gz round-trips`);
  }
  // serve like nginx brotli_static and play it
  const port = 4300 + Math.floor(Math.random() * 400);
  const server = spawn(process.execPath, [join(SKILLS, 'publish-web-game/scripts/serve-dist.mjs'), DIST, '--port', String(port)]);
  await new Promise((res) => server.stdout.once('data', res));
  try {
    const head = await fetch(`http://localhost:${port}/assets/${wasm}`, { headers: { 'accept-encoding': 'br' } });
    assert.equal(head.headers.get('content-encoding'), 'br');
    const out = tmp('brotli-playtest');
    const p = run(process.execPath, [join(SKILLS, 'game-judge/scripts/playtest.mjs'), '--project', GAME, '--url', `http://localhost:${port}/`, '--perf', '0', '--out', out]);
    assert.equal(p.status, 0, p.stdout + p.stderr);
  } finally {
    server.kill();
  }
});
