import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, SKILLS, has, tmp, run } from './helpers.ts';
import { propose, withCandidate, type Asset } from '../../skills/optimize-assets/scripts/optimize-assets.ts';
import { compareShots } from '../../skills/optimize-assets/scripts/compare-shots.ts';

const GAME = join(ROOT, 'examples/blossomswing');
const RELEASE = join(SKILLS, 'publish-web-game/scripts/release.ts');

/** A copy of the example with dist/ = public/ + a stub index.html, so release.ts --skip-build runs only the asset
 * stages (no Vite build, and no race with the site test, which releases the real example). */
function stubProject(name: string): string {
  const dir = tmp(name);
  cpSync(join(GAME, 'package.json'), join(dir, 'package.json'));
  symlinkSync(join(GAME, 'node_modules'), join(dir, 'node_modules'));
  cpSync(join(GAME, 'public'), join(dir, 'dist'), { recursive: true });
  writeFileSync(join(dir, 'dist', 'index.html'), '<!doctype html><html><head></head><body></body></html>');
  mkdirSync(join(dir, 'design'));
  return dir;
}

async function glbInfo(file: string): Promise<{ triangles: number; extensions: string[]; nodes: string }> {
  const { NodeIO } = await import(join(GAME, 'node_modules/@gltf-transform/core/dist/index.js'));
  const { ALL_EXTENSIONS } = await import(join(GAME, 'node_modules/@gltf-transform/extensions/dist/index.js'));
  const { MeshoptDecoder } = await import(join(GAME, 'node_modules/meshoptimizer/index.js'));
  await MeshoptDecoder.ready;
  type Doc = { getRoot(): { listMeshes(): { listPrimitives(): { getIndices(): { getCount(): number } | null }[] }[]; listNodes(): { getName(): string }[]; listExtensionsUsed(): { extensionName: string }[] } };
  const doc = (await new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder }).read(file)) as Doc;
  let triangles = 0;
  for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) triangles += (p.getIndices()?.getCount() ?? 0) / 3;
  return { triangles, extensions: doc.getRoot().listExtensionsUsed().map((e) => e.extensionName), nodes: doc.getRoot().listNodes().map((n) => n.getName()).sort().join('|') };
}

const samples = (file: string) => spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'f32le', '-ac', '1', 'pipe:1'], { maxBuffer: 1 << 30 }).stdout.length / 4;

test('release applies design/optimize.json to dist/ only: WebP textures, simplify, image + audio re-encodes, loops keep their length', { skip: !has('ffmpeg') && 'needs ffmpeg', timeout: 300000 }, async () => {
  const plain = stubProject('opt-plain');
  const r0 = run(process.execPath, [RELEASE, '--project', plain, '--skip-build', '--no-preload']);
  assert.equal(r0.status, 0, r0.stdout.slice(-1500) + r0.stderr.slice(-1500));
  const report0 = JSON.parse(readFileSync(join(plain, 'dist/release-report.json'), 'utf8'));
  assert.deepEqual(report0.optimized, [], 'no optimize.json: only the lossless GLB pipeline');

  const dir = stubProject('opt-applied');
  writeFileSync(join(dir, 'design/optimize.json'), JSON.stringify({
    textures: { '*': { format: 'webp', quality: 90 }, 'models/child.glb': { maxSize: 256 } },
    models: { 'models/orchard.glb': { simplify: { ratio: 0.5, error: 0.01 } } },
    images: { 'images/*': { quality: 80 } },
    audio: { 'music/*': { vbr: 6 }, 'sfx/*': { vbr: 6 } },
  }));
  const r = run(process.execPath, [RELEASE, '--project', dir, '--skip-build', '--no-preload']);
  assert.equal(r.status, 0, r.stdout.slice(-1500) + r.stderr.slice(-1500));
  const report = JSON.parse(readFileSync(join(dir, 'dist/release-report.json'), 'utf8')) as { optimized: { file: string; before: number; after: number }[] };
  const files = report.optimized.map((o) => o.file);
  for (const f of ['models/child.glb', 'models/orchard.glb', 'images/splash.webp', 'music/play.mp3']) assert.ok(files.includes(f), `${f} optimized (${files.join(', ')})`);
  for (const o of report.optimized) assert.ok(o.after < o.before || o.file.endsWith('.glb'), `${o.file} got smaller`);

  const child = await glbInfo(join(dir, 'dist/models/child.glb'));
  assert.ok(child.extensions.includes('EXT_texture_webp'), `child.glb textures are WebP (${child.extensions.join(', ')})`);
  const [orchard0, orchard] = [await glbInfo(join(plain, 'dist/models/orchard.glb')), await glbInfo(join(dir, 'dist/models/orchard.glb'))];
  assert.ok(orchard.triangles < orchard0.triangles * 0.8, `simplified ${orchard0.triangles} -> ${orchard.triangles} triangles`);
  assert.equal(orchard.nodes, orchard0.nodes, 'simplify keeps every node (markers, templates)');
  const world = await glbInfo(join(dir, 'dist/models/world.glb'));
  assert.ok(!world.extensions.includes('EXT_texture_webp'), 'a GLB without textures is left alone by the texture setting');

  const meta = JSON.parse(readFileSync(join(GAME, 'public/music/play.json'), 'utf8')) as { samples: number };
  assert.equal(samples(join(dir, 'dist/music/play.mp3')), meta.samples, 'the music loop keeps its exact sample count');
  assert.ok(readFileSync(join(GAME, 'public/music/play.mp3')).length > readFileSync(join(dir, 'dist/music/play.mp3')).length);
  assert.ok(existsSync(join(GAME, 'public/models/child.glb')), 'sources untouched');
});

test('optimize-assets propose: near-lossless defaults, user entries win, decided candidates are not asked again', () => {
  const assets: Asset[] = [
    { file: 'models/world.glb', kind: 'model', kb: 7000, gzipKb: 3900, triangles: 330000, meshes: [{ name: 'Tufts', triangles: 216000 }] },
    { file: 'models/hero.glb', kind: 'model', kb: 400, gzipKb: 230, triangles: 8000, textures: [{ mime: 'image/png', width: 2048, height: 2048, kb: 300 }] },
    { file: 'music/play.mp3', kind: 'audio', kb: 400, gzipKb: 400, audio: { seconds: 20, channels: 2, kbps: 164, nearMono: false } },
    { file: 'sfx/step.mp3', kind: 'audio', kb: 9, gzipKb: 9, audio: { seconds: 0.5, channels: 2, kbps: 100, nearMono: true } },
    { file: 'images/splash.webp', kind: 'image', kb: 400, gzipKb: 400, image: { width: 4096, height: 2304 } },
  ];
  const { config, candidates } = propose(assets, { audio: { 'music/*': { vbr: 4 } }, decisions: [{ change: 'music-vbr7:music/play.mp3', accepted: false, date: '2026-11-13' }] });
  assert.deepEqual(config.textures, { '*': { format: 'webp', quality: 90 } });
  assert.deepEqual(config.audio?.['music/*'], { vbr: 4 }, "the user's own entry wins over the default");
  assert.deepEqual(config.audio?.['sfx/step.mp3'], { vbr: 5, mono: true }, 'near-mono stereo sfx become mono');
  assert.deepEqual(config.images?.['images/splash.webp'], { quality: 85, maxSize: 2560 });
  const ids = candidates.map((c) => c.id);
  assert.ok(ids.includes('simplify:models/world.glb:0.5') && ids.includes('texture-1024:models/hero.glb'), ids.join(', '));
  assert.ok(!ids.includes('music-vbr7:music/play.mp3'), 'a declined candidate is not offered again');
  assert.ok(!ids.some((i) => i.includes('hero.glb') && i.startsWith('simplify')), 'small meshes are not simplification candidates');
  const c = candidates.find((x) => x.id === 'texture-1024:models/hero.glb')!;
  assert.deepEqual(withCandidate(config, c).textures?.['models/hero.glb'], { format: 'webp', quality: 90, maxSize: 1024 });
});

test('compare-shots: identical screenshots are "same", a shifted one is not and gets a side-by-side', { skip: !has('ffmpeg') && 'needs ffmpeg' }, () => {
  const [a, b] = [tmp('shots-a'), tmp('shots-b')];
  for (const d of [a, b]) mkdirSync(join(d, 'webgpu'));
  const img = (out: string, x: number) => run('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=1', '-frames:v', '1', '-vf', `crop=300:170:${x}:0`, out]);
  img(join(a, 'webgpu/same.png'), 0);
  img(join(b, 'webgpu/same.png'), 0);
  img(join(a, 'webgpu/moved.png'), 0);
  img(join(b, 'webgpu/moved.png'), 12);
  const shots = compareShots(a, b);
  assert.deepEqual(shots.map((s) => [s.name, s.same]), [['moved.png', false], ['same.png', true]]);
  assert.equal(shots[1]!.ssim, 1);
  assert.ok(shots[0]!.sideBySide && existsSync(shots[0]!.sideBySide));
});
