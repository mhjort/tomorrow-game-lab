#!/usr/bin/env node
// Release build for a web-game-runtime project: minified Vite build + optimized GLBs + asset manifest +
// gzip size report with budgets. Run from the game project root: `pnpm release` (or node this file).
//
//   node release.ts [--project .] [--no-glb-opt] [--no-preload] [--precompress] [--max-js-kb 1500] [--max-total-mb 20] [--skip-build]
//                   [--optimize design/optimize.json]
//
// design/optimize.json (written by the optimize-assets skill; optional) sets per-asset web settings applied to the
// copies in dist/ only, so public/ keeps the full-quality sources: GLB textures (WebP, max size), GLB simplification,
// 2D images (quality, max size) and audio (LAME VBR, mono). Keys are dist-relative paths or globs ("*", "music/*").
// Without the file only the lossless GLB pipeline runs. Audio needs ffmpeg on PATH.
//
// --precompress writes <file>.br (brotli q11) and <file>.gz (gzip -9) next to every compressible file > 1 KB,
// for hosts that serve precompressed files (nginx brotli_static/gzip_static, S3/CloudFront, Caddy precompressed).
// GitHub Pages ignores them (it compresses on the fly, gzip only), so it's off by default.
//
// Writes dist/asset-manifest.json (the runtime loader uses it for byte-accurate progress) and
// dist/release-report.json (sizes, budgets; read by the technical judge). Exit 1 if a budget is exceeded.
// Uses the project's own dependencies: vite, @gltf-transform/{core,extensions,functions}, meshoptimizer, and
// typescript when installed (`tsc` runs first, so type errors fail the release).
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readdirSync, readFileSync, statSync, unlinkSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { brotliCompressSync, constants as zlibConstants, gzipSync } from 'node:zlib';

const argv = process.argv.slice(2);
const opt = (n: string, d: string): string => (argv.indexOf(n) >= 0 ? (argv[argv.indexOf(n) + 1] ?? d) : d);
const project = resolve(opt('--project', '.'));
const dist = join(project, 'dist');
const maxJsKb = Number(opt('--max-js-kb', '1500'));
const maxTotalMb = Number(opt('--max-total-mb', '20'));
const req = createRequire(join(project, 'package.json'));
// Project dependencies resolve from the game project, not from wherever this script lives.
const imp = async <T,>(name: string): Promise<T> => (await import(req.resolve(name))) as T;

// 1. type check (strict TypeScript), then minified production build
if (!argv.includes('--skip-build')) {
  if (existsSync(join(project, 'node_modules', '.bin', 'tsc'))) {
    const t = spawnSync('pnpm', ['exec', 'tsc', '--noEmit'], { cwd: project, stdio: 'inherit' });
    if (t.status !== 0) {
      console.error('release: type check failed (pnpm exec tsc) — fix the type errors above');
      process.exit(t.status ?? 1);
    }
  }
  const r = spawnSync('pnpm', ['exec', 'vite', 'build'], { cwd: project, stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
if (!existsSync(join(dist, 'index.html'))) {
  console.error('dist/index.html missing — did vite build run?');
  process.exit(2);
}
const walk = (d: string): string[] =>
  readdirSync(d, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]))
    .filter((f) => !/\.(br|gz)$/.test(f)); // ignore precompressed siblings from a previous run
const precompress = argv.includes('--precompress');
const COMPRESSIBLE = /\.(js|mjs|wasm|glb|gltf|bin|html|json|css|svg|txt|xml)$/;
const brotli = (buf: Buffer) =>
  brotliCompressSync(buf, { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 11, [zlibConstants.BROTLI_PARAM_SIZE_HINT]: buf.length } });

// design/optimize.json: per-asset settings (see the header). Later, more specific keys override earlier ones.
type TexOpt = { format?: 'webp' | 'jpeg' | 'png' | 'avif'; quality?: number; maxSize?: number };
type ModelOpt = { simplify?: { ratio: number; error?: number; lockBorder?: boolean } };
type ImgOpt = { quality?: number; maxSize?: number };
type AudioOpt = { vbr?: number; mono?: boolean };
type OptimizeConfig = {
  textures?: Record<string, TexOpt>;
  models?: Record<string, ModelOpt>;
  images?: Record<string, ImgOpt>;
  audio?: Record<string, AudioOpt>;
};
const optimizePath = resolve(project, opt('--optimize', 'design/optimize.json'));
const optimize: OptimizeConfig = existsSync(optimizePath) ? (JSON.parse(readFileSync(optimizePath, 'utf8')) as OptimizeConfig) : {};
const globRe = (k: string) => new RegExp(`^${k.split('*').map((x) => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join(k === '*' ? '.*' : '[^/]*')}$`);
/** Settings for one dist-relative file: every matching key merged, wildcards first, exact paths last. */
function settingsFor<T extends object>(map: Record<string, T> | undefined, rel: string): T | undefined {
  if (!map) return undefined;
  const keys = Object.keys(map).filter((k) => globRe(k).test(rel)).sort((a, b) => Number(!a.includes('*')) - Number(!b.includes('*')) || a.length - b.length);
  return keys.length ? (Object.assign({}, ...keys.map((k) => map[k])) as T) : undefined;
}
const optimized: { file: string; kind: string; before: number; after: number; settings: object }[] = [];

// 2. GLB optimization: dedup + weld (+ simplify, + texture compression per optimize.json) + meshopt (quantize +
//    reorder + compress). Runtime decodes via MeshoptDecoder.
const glbs = walk(dist).filter((f) => f.endsWith('.glb'));
const glbReport: { file: string; before: number; after: number }[] = [];
if (glbs.length && !argv.includes('--no-glb-opt')) {
  const { NodeIO } = await imp<typeof import('@gltf-transform/core')>('@gltf-transform/core');
  const { ALL_EXTENSIONS } = await imp<typeof import('@gltf-transform/extensions')>('@gltf-transform/extensions');
  const { dedup, weld, prune, meshopt, simplify, textureCompress } = await imp<typeof import('@gltf-transform/functions')>('@gltf-transform/functions');
  const { MeshoptEncoder, MeshoptDecoder, MeshoptSimplifier } = await imp<typeof import('meshoptimizer')>('meshoptimizer');
  await MeshoptEncoder.ready;
  await MeshoptDecoder.ready;
  await MeshoptSimplifier.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
  const names = (d: import('@gltf-transform/core').Document) => d.getRoot().listNodes().map((n) => n.getName()).sort().join('|');
  /** One GLB through the pipeline, with or without the texture re-encode; returns the encoded bytes. */
  const build = async (f: string, rel: string, tex: TexOpt | undefined, model: ModelOpt | undefined): Promise<Uint8Array> => {
    const doc = await io.read(f);
    const namesBefore = names(doc);
    // quantization moves the mesh of a node that also has child nodes into a new unnamed child (so the dequantize
    // scale doesn't scale the children): a mesh looked up by its node's name would no longer be there
    const splits = doc.getRoot().listNodes().filter((n) => n.getMesh() && n.listChildren().length).map((n) => n.getName());
    const steps = [dedup(), weld()];
    // simplify before quantization; only for files listed by name (thin parts such as ropes and blades can open up)
    if (model?.simplify) steps.push(simplify({ simplifier: MeshoptSimplifier, error: 1e-3, ...model.simplify }));
    if (tex) {
      const sharp = (await imp<{ default: unknown }>('sharp')).default;
      steps.push(textureCompress({ encoder: sharp, targetFormat: tex.format ?? 'webp', quality: tex.quality ?? 90, ...(tex.maxSize ? { resize: [tex.maxSize, tex.maxSize] as [number, number] } : {}) }));
    }
    // keepLeaves: marker empties (Spawn, Tee, Goal...) are leaf nodes without meshes — never prune them.
    // keepAttributes: UVs no texture uses can still drive a node material (uv() in TSL: bark grain, gradients); prune
    // would drop them and the effect vanishes in release builds only. Measured cost: ≤0.01 MB gzip per game.
    steps.push(prune({ keepLeaves: true, keepExtras: true, keepAttributes: true }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
    await doc.transform(...steps);
    if (names(doc) !== namesBefore) {
      console.error(`${rel}: optimization changed the node set (markers/colliders would break)`);
      if (splits.length)
        console.error(`  nodes with both a mesh and child nodes: ${splits.join(', ')}. Meshopt quantization moves such a mesh into a new unnamed child.\n  Fix the asset script: make the parent an empty (the pivot) and parent the mesh and the other children to it.`);
      process.exit(1);
    }
    return io.writeBinary(doc);
  };
  for (const f of glbs) {
    const before = statSync(f).size;
    const rel = relative(dist, f);
    const model = settingsFor(optimize.models, rel);
    const texWanted = settingsFor(optimize.textures, rel);
    const tex = texWanted && (await io.read(f)).getRoot().listTextures().length ? texWanted : undefined;
    let bytes = await build(f, rel, undefined, model);
    let usedTex = false;
    if (tex) {
      // a texture re-encode can come out bigger (JPEG already small): keep whichever GLB is smaller
      const withTex = await build(f, rel, tex, model);
      if (withTex.length < bytes.length || tex.maxSize) [bytes, usedTex] = [withTex, true];
    }
    writeFileSync(f, bytes);
    glbReport.push({ file: rel, before, after: bytes.length });
    if (usedTex || model) optimized.push({ file: rel, kind: 'glb', before, after: bytes.length, settings: { ...(usedTex ? { textures: tex } : {}), ...(model ?? {}) } });
  }
}

// 2b. 2D images and audio per optimize.json, in place in dist/ (same names, so code and preload hints don't change).
//     A re-encode is kept only when it is smaller.
for (const f of walk(dist)) {
  const rel = relative(dist, f);
  const img = /^images\/.*\.(webp|png|jpe?g)$/.test(rel) ? settingsFor(optimize.images, rel) : undefined;
  const snd = rel.endsWith('.mp3') ? settingsFor(optimize.audio, rel) : undefined;
  const before = statSync(f).size;
  let out: Buffer | null = null;
  if (img) {
    const sharp = (await imp<{ default: (b: Buffer) => import('sharp').Sharp }>('sharp')).default;
    let p = sharp(readFileSync(f));
    if (img.maxSize) p = p.resize({ width: img.maxSize, height: img.maxSize, fit: 'inside', withoutEnlargement: true });
    const q = img.quality ?? 85;
    out = await (rel.endsWith('.webp') ? p.webp({ quality: q, effort: 6 }) : rel.endsWith('.png') ? p.png({ compressionLevel: 9 }) /* lossless: sharp's `effort` or `palette` quantize */ : p.jpeg({ quality: q, mozjpeg: true })).toBuffer();
  } else if (snd) {
    out = reencodeMp3(f, rel, snd);
  }
  if (out && out.length < before) {
    writeFileSync(f, out);
    optimized.push({ file: rel, kind: img ? 'image' : 'audio', before, after: out.length, settings: (img ?? snd)! });
  }
}

/** LAME VBR re-encode of one mp3; music loops (music/<name>.json sidecar) must keep their exact sample count. */
function reencodeMp3(f: string, rel: string, o: AudioOpt): Buffer {
  if (spawnSync('ffmpeg', ['-version']).error) {
    console.error('release: design/optimize.json re-encodes audio, which needs ffmpeg on PATH (brew install ffmpeg / apt-get install ffmpeg)');
    process.exit(1);
  }
  const tmp = `${f}.tmp.mp3`;
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', f, '-map_metadata', '-1', '-c:a', 'libmp3lame', '-q:a', String(o.vbr ?? 5), ...(o.mono ? ['-ac', '1'] : []), tmp]);
  if (r.status !== 0) {
    console.error(`release: ffmpeg failed on ${rel}: ${r.stderr}`);
    process.exit(1);
  }
  const sidecar = f.replace(/\.mp3$/, '.json');
  if (rel.startsWith('music/') && existsSync(sidecar) && (JSON.parse(readFileSync(sidecar, 'utf8')) as { loop?: boolean }).loop) {
    // decode from files, not a pipe: from a pipe ffmpeg can't use the LAME gapless header and adds ~224 samples
    const samples = (file: string) => spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'f32le', '-ac', '1', 'pipe:1'], { maxBuffer: 1 << 30 }).stdout.length / 4;
    const want = samples(f);
    const got = samples(tmp);
    if (got !== want) {
      unlinkSync(tmp);
      console.error(`release: re-encoding ${rel} changed its length (${want} -> ${got} samples): the loop seam would drift. Drop its audio setting in design/optimize.json.`);
      process.exit(1);
    }
  }
  const buf = readFileSync(tmp);
  unlinkSync(tmp);
  return buf;
}

// 3. preload hints: the browser starts EVERY download while parsing index.html, instead of waiting for the
//    entry module (which waits for three.js) to run the loader. Lazy chunks -> modulepreload; .wasm, models and
//    sfx -> preload as fetch (crossorigin so the loader's fetch() reuses the response); images -> as image.
//    Lazily loaded levels (web-game-runtime levels.ts): assets that only levels after the first use, per
//    design/levels.json { "levels": [{ "models": [], "sfx": [], "music": [] }, ...] }, get NO hint, so they
//    don't compete with the first level's bandwidth; the game fetches them in the background during play.
if (!argv.includes('--no-preload')) {
  const htmlPath = join(dist, 'index.html');
  let page = readFileSync(htmlPath, 'utf8');
  const rel = (f: string) => `./${relative(dist, f)}`;
  const lazy = lazyLevelAssets();
  // images/: the loading screen's splash.* is a CSS background (no CORS) -> as=image without crossorigin; every other
  // image is assumed to be a three.js texture, and TextureLoader requests in CORS mode, so its preload needs
  // crossorigin or the browser downloads it twice. sfx/ are fetched like models.
  const hints = walk(dist)
    .filter((f) => (/\.(js|wasm|glb|mp3|ogg)$/.test(f) || /^images\/.*\.(webp|png|jpg)$/.test(relative(dist, f))) && !page.includes(relative(dist, f)))
    .filter((f) => !lazy.has(relative(dist, f)))
    // icon.* is the favicon / share image, never loaded by the game: a preload of it only warns 'not used'
    .filter((f) => !/^images\/icon\./.test(relative(dist, f)))
    .map((f) =>
      f.endsWith('.js')
        ? `<link rel="modulepreload" crossorigin href="${rel(f)}">`
        : relative(dist, f).startsWith('images/')
          ? `<link rel="preload" as="image"${/^images\/splash\./.test(relative(dist, f)) ? '' : ' crossorigin'} href="${rel(f)}">`
          : `<link rel="preload" as="fetch" crossorigin href="${rel(f)}">`,
    );
  hints.push('<link rel="preload" as="fetch" crossorigin href="./asset-manifest.json">'); // written below
  if (hints.length) {
    page = page.replace('</head>', `    ${hints.join('\n    ')}\n  </head>`);
    writeFileSync(htmlPath, page);
    console.log(`preload hints: ${hints.length} (lazy chunks, wasm, models, sfx, images)`);
  }
}

/** dist-relative paths used only by levels after the first in design/levels.json (empty if there is no such file). */
function lazyLevelAssets(): Set<string> {
  const file = join(project, 'design', 'levels.json');
  if (!existsSync(file)) return new Set();
  type Level = { models?: string[]; sfx?: string[]; music?: string[] };
  const { levels = [] } = JSON.parse(readFileSync(file, 'utf8')) as { levels?: Level[] };
  const paths = (l: Level | undefined): string[] =>
    l ? [...(l.models ?? []).map((n) => `models/${n}.glb`), ...(l.sfx ?? []).map((n) => `sfx/${n}.mp3`), ...(l.music ?? []).map((n) => `music/${n}.mp3`)] : [];
  const first = new Set(paths(levels[0]));
  const lazy = new Set(levels.slice(1).flatMap(paths).filter((p) => !first.has(p)));
  if (lazy.size) console.log(`lazy level assets (no preload hint): ${[...lazy].join(', ')}`);
  return lazy;
}

// 4. manifest + size report
const files = walk(dist).filter((f) => !/\/(asset-manifest|release-report)\.json$/.test(f));
const manifest = Object.fromEntries(files.filter((f) => !f.endsWith('.html')).map((f) => [relative(dist, f), statSync(f).size]));
writeFileSync(join(dist, 'asset-manifest.json'), JSON.stringify(manifest));
type Row = { file: string; bytes: number; gzip: number; brotli?: number };
const rows = files.map((f): Row => {
  const buf = readFileSync(f);
  const compressible = COMPRESSIBLE.test(f);
  const gz = compressible ? gzipSync(buf, { level: 9 }) : null;
  const row: Row = { file: relative(dist, f), bytes: buf.length, gzip: gz ? gz.length : buf.length };
  if (precompress) {
    const br = compressible ? brotli(buf) : null;
    row.brotli = br ? br.length : buf.length;
    if (br && gz && buf.length > 1024) {
      if (br.length < buf.length) writeFileSync(`${f}.br`, br);
      if (gz.length < buf.length) writeFileSync(`${f}.gz`, gz);
    }
  }
  return row;
});
const sum = (xs: Row[], k: 'bytes' | 'gzip' | 'brotli') => xs.reduce((s, x) => s + (x[k] ?? 0), 0);
const js = rows.filter((r) => r.file.endsWith('.js'));
const kb = (b: number) => (b / 1024).toFixed(1).padStart(8);
console.log(`\n${'file'.padEnd(46)}      raw KB   gzip KB`);
for (const r of rows.sort((a, b) => b.gzip - a.gzip)) console.log(`${r.file.padEnd(46)} ${kb(r.bytes)}  ${kb(r.gzip)}`);
for (const g of glbReport) console.log(`  optimized ${g.file}: ${kb(g.before).trim()} KB -> ${kb(g.after).trim()} KB`);
if (optimized.length) {
  console.log(`\noptimize.json (${relative(project, optimizePath)}):`);
  for (const o of optimized) console.log(`  ${o.file.padEnd(40)} ${kb(o.before)} -> ${kb(o.after)} KB  ${JSON.stringify(o.settings)}`);
}
const totals: { jsGzipKb: number; totalGzipMb: number; files: number; jsBrotliKb?: number; totalBrotliMb?: number } = {
  jsGzipKb: sum(js, 'gzip') / 1024,
  totalGzipMb: sum(rows, 'gzip') / 1024 / 1024,
  files: rows.length,
};
const brotliTotals = precompress ? { jsBrotliKb: sum(js, 'brotli') / 1024, totalBrotliMb: sum(rows, 'brotli') / 1024 / 1024 } : null;
if (brotliTotals) Object.assign(totals, brotliTotals);
const problems: string[] = [];
if (totals.jsGzipKb > maxJsKb) problems.push(`JS ${totals.jsGzipKb.toFixed(0)} KB gzip > budget ${maxJsKb} KB`);
if (totals.totalGzipMb > maxTotalMb) problems.push(`total ${totals.totalGzipMb.toFixed(1)} MB gzip > budget ${maxTotalMb} MB`);
const html = readFileSync(join(dist, 'index.html'), 'utf8');
if (/(src|href)="\/(?!\/)/.test(html)) problems.push('index.html uses absolute "/..." URLs: set base: "./" in vite.config.ts (breaks on GitHub Pages sub-paths)');
console.log(`\nJS ${totals.jsGzipKb.toFixed(0)} KB gzip (budget ${maxJsKb}) · total ${totals.totalGzipMb.toFixed(2)} MB gzip (budget ${maxTotalMb})`);
if (brotliTotals)
  console.log(`precompressed .br/.gz written · brotli: JS ${brotliTotals.jsBrotliKb.toFixed(0)} KB, total ${brotliTotals.totalBrotliMb.toFixed(2)} MB (${((1 - brotliTotals.totalBrotliMb / totals.totalGzipMb) * 100).toFixed(0)}% smaller than gzip)`);
for (const p of problems) console.log(`BUDGET: ${p}`);
writeFileSync(join(dist, 'release-report.json'), JSON.stringify({ createdAt: new Date().toISOString(), totals, budgets: { maxJsKb, maxTotalMb }, problems, glbs: glbReport, optimized, files: rows }, null, 2));
console.log(problems.length ? 'release: FAIL' : 'release: OK -> dist/');
process.exit(problems.length ? 1 : 0);
