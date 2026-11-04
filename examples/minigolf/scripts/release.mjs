#!/usr/bin/env node
// Release build for a web-game-runtime project: minified Vite build + optimized GLBs + asset manifest +
// gzip size report with budgets. Run from the game project root: `npm run release` (or node this file).
//
//   node release.mjs [--project .] [--no-glb-opt] [--no-preload] [--max-js-kb 1500] [--max-total-mb 20] [--skip-build]
//
// Writes dist/asset-manifest.json (the runtime loader uses it for byte-accurate progress) and
// dist/release-report.json (sizes, budgets; read by the technical judge). Exit 1 if a budget is exceeded.
// Uses the project's own dependencies: vite, @gltf-transform/{core,extensions,functions}, meshoptimizer.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readdirSync, readFileSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

const argv = process.argv.slice(2);
const opt = (n, d) => (argv.indexOf(n) >= 0 ? argv[argv.indexOf(n) + 1] : d);
const project = resolve(opt('--project', '.'));
const dist = join(project, 'dist');
const maxJsKb = Number(opt('--max-js-kb', 1500));
const maxTotalMb = Number(opt('--max-total-mb', 20));
const req = createRequire(join(project, 'package.json'));
const imp = async (name) => import(req.resolve(name));

// 1. minified production build
if (!argv.includes('--skip-build')) {
  const r = spawnSync('npx', ['vite', 'build'], { cwd: project, stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
if (!existsSync(join(dist, 'index.html'))) {
  console.error('dist/index.html missing — did vite build run?');
  process.exit(2);
}
const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));

// 2. GLB optimization: dedup + weld + meshopt (quantize + reorder + compress). Runtime decodes via MeshoptDecoder.
const glbs = walk(dist).filter((f) => f.endsWith('.glb'));
const glbReport = [];
if (glbs.length && !argv.includes('--no-glb-opt')) {
  const { NodeIO } = await imp('@gltf-transform/core');
  const { ALL_EXTENSIONS } = await imp('@gltf-transform/extensions');
  const { dedup, weld, prune, meshopt } = await imp('@gltf-transform/functions');
  const { MeshoptEncoder, MeshoptDecoder } = await imp('meshoptimizer');
  await MeshoptEncoder.ready;
  await MeshoptDecoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
  for (const f of glbs) {
    const before = statSync(f).size;
    const doc = await io.read(f);
    const names = (d) => d.getRoot().listNodes().map((n) => n.getName()).sort().join('|');
    const namesBefore = names(doc);
    // keepLeaves: marker empties (Spawn, Tee, Goal...) are leaf nodes without meshes — never prune them
    await doc.transform(dedup(), weld(), prune({ keepLeaves: true, keepExtras: true }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
    if (names(doc) !== namesBefore) {
      console.error(`${relative(dist, f)}: optimization changed the node set (markers/colliders would break)`);
      process.exit(1);
    }
    await io.write(f, doc);
    glbReport.push({ file: relative(dist, f), before, after: statSync(f).size });
  }
}

// 3. preload hints: the browser starts EVERY download while parsing index.html, instead of waiting for the
//    entry module (which waits for three.js) to run the loader. Lazy chunks -> modulepreload; .wasm and
//    models -> preload as fetch (crossorigin so the loader's fetch() reuses the response).
if (!argv.includes('--no-preload')) {
  const htmlPath = join(dist, 'index.html');
  let page = readFileSync(htmlPath, 'utf8');
  const rel = (f) => `./${relative(dist, f)}`;
  const hints = walk(dist)
    .filter((f) => /\.(js|wasm|glb)$/.test(f) && !page.includes(relative(dist, f)))
    .map((f) =>
      f.endsWith('.js') ? `<link rel="modulepreload" crossorigin href="${rel(f)}">` : `<link rel="preload" as="fetch" crossorigin href="${rel(f)}">`,
    );
  hints.push('<link rel="preload" as="fetch" crossorigin href="./asset-manifest.json">'); // written below
  if (hints.length) {
    page = page.replace('</head>', `    ${hints.join('\n    ')}\n  </head>`);
    writeFileSync(htmlPath, page);
    console.log(`preload hints: ${hints.length} (lazy chunks, wasm, models)`);
  }
}

// 4. manifest + size report
const files = walk(dist).filter((f) => !/\/(asset-manifest|release-report)\.json$/.test(f));
const manifest = Object.fromEntries(files.filter((f) => !f.endsWith('.html')).map((f) => [relative(dist, f), statSync(f).size]));
writeFileSync(join(dist, 'asset-manifest.json'), JSON.stringify(manifest));
const rows = files.map((f) => {
  const buf = readFileSync(f);
  return { file: relative(dist, f), bytes: buf.length, gzip: /\.(png|jpe?g|webp|avif|mp3|ogg|ktx2)$/.test(f) ? buf.length : gzipSync(buf, { level: 9 }).length };
});
const sum = (xs, k) => xs.reduce((s, x) => s + x[k], 0);
const js = rows.filter((r) => r.file.endsWith('.js'));
const kb = (b) => (b / 1024).toFixed(1).padStart(8);
console.log(`\n${'file'.padEnd(46)}      raw KB   gzip KB`);
for (const r of rows.sort((a, b) => b.gzip - a.gzip)) console.log(`${r.file.padEnd(46)} ${kb(r.bytes)}  ${kb(r.gzip)}`);
for (const g of glbReport) console.log(`  optimized ${g.file}: ${kb(g.before).trim()} KB -> ${kb(g.after).trim()} KB`);
const totals = { jsGzipKb: sum(js, 'gzip') / 1024, totalGzipMb: sum(rows, 'gzip') / 1024 / 1024, files: rows.length };
const problems = [];
if (totals.jsGzipKb > maxJsKb) problems.push(`JS ${totals.jsGzipKb.toFixed(0)} KB gzip > budget ${maxJsKb} KB`);
if (totals.totalGzipMb > maxTotalMb) problems.push(`total ${totals.totalGzipMb.toFixed(1)} MB gzip > budget ${maxTotalMb} MB`);
const html = readFileSync(join(dist, 'index.html'), 'utf8');
if (/(src|href)="\/(?!\/)/.test(html)) problems.push('index.html uses absolute "/..." URLs: set base: "./" in vite.config.js (breaks on GitHub Pages sub-paths)');
console.log(`\nJS ${totals.jsGzipKb.toFixed(0)} KB gzip (budget ${maxJsKb}) · total ${totals.totalGzipMb.toFixed(2)} MB gzip (budget ${maxTotalMb})`);
for (const p of problems) console.log(`BUDGET: ${p}`);
writeFileSync(join(dist, 'release-report.json'), JSON.stringify({ createdAt: new Date().toISOString(), totals, budgets: { maxJsKb, maxTotalMb }, problems, glbs: glbReport, files: rows }, null, 2));
console.log(problems.length ? 'release: FAIL' : 'release: OK -> dist/');
process.exit(problems.length ? 1 : 0);
