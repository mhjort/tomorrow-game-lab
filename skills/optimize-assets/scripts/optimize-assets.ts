#!/usr/bin/env node
// Asset optimization for a web-game-runtime project: find where the bytes are, write near-lossless defaults to
// design/optimize.json, and measure bigger (visible) savings one at a time so the user can pick them.
// `pnpm release` (publish-web-game's release.ts) applies design/optimize.json to the copies in dist/ only.
//
//   node optimize-assets.ts inventory [--project .]          every asset in public/: KB, gzip KB, triangles, textures, audio
//   node optimize-assets.ts propose   [--project .]          write the near-lossless defaults + list visible candidates
//   node optimize-assets.ts trial <id> [--project .]         release with one candidate on top of optimize.json -> size gain
//   node optimize-assets.ts check     [--project .]          SSIM of every re-encoded 2D image in dist/ against public/
//   node optimize-assets.ts apply <id...> | decline <id...>  record the user's choice in optimize.json ("decisions")
//
// Writes .lab/optimize/{inventory,candidates}.json and .lab/optimize/trials/<id>/. Needs the project's own
// @gltf-transform/core, meshoptimizer and sharp (template devDependencies) and ffmpeg/ffprobe for audio.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

export type Settings = Record<string, Record<string, unknown>>;
export interface OptimizeConfig {
  textures?: Settings;
  models?: Settings;
  images?: Settings;
  audio?: Settings;
  decisions?: { change: string; accepted: boolean; gain?: string; date: string }[];
}
export interface Asset {
  file: string; // dist-relative, e.g. models/world.glb
  kind: 'model' | 'image' | 'audio' | 'other';
  kb: number;
  gzipKb: number;
  triangles?: number;
  /** the meshes with the most triangles: one mesh holding most of a GLB is where simplify or instancing pays */
  meshes?: { name: string; triangles: number }[];
  textures?: { mime: string; width: number; height: number; kb: number }[];
  audio?: { seconds: number; channels: number; kbps: number; nearMono?: boolean };
  image?: { width: number; height: number };
}
export interface Candidate {
  id: string;
  file: string;
  section: 'textures' | 'models' | 'images' | 'audio';
  settings: Record<string, unknown>;
  what: string; // one line for the user: what gets worse
}

const walk = (d: string): string[] =>
  existsSync(d) ? readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)])) : [];
const round = (x: number, n = 1) => Number(x.toFixed(n));

/** Is a stereo file practically mono? (side energy under 0.5% of mid energy) */
function nearMono(file: string): boolean {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'f32le', '-ac', '2', 'pipe:1'], { maxBuffer: 1 << 30 });
  const buf = r.stdout;
  const f = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 4));
  let mid = 0;
  let side = 0;
  for (let i = 0; i + 1 < f.length; i += 2) {
    const l = f[i]!;
    const rr = f[i + 1]!;
    mid += (l + rr) ** 2;
    side += (l - rr) ** 2;
  }
  return mid > 0 && side / mid < 0.005;
}

export async function inventory(project: string): Promise<Asset[]> {
  const pub = join(project, 'public');
  const req = createRequire(join(project, 'package.json'));
  const out: Asset[] = [];
  for (const f of walk(pub)) {
    const file = relative(pub, f);
    if (/(^|\/)\./.test(file)) continue;
    const buf = readFileSync(f);
    const a: Asset = { file, kind: 'other', kb: round(buf.length / 1024), gzipKb: round(gzipSync(buf, { level: 9 }).length / 1024) };
    if (file.endsWith('.glb')) {
      a.kind = 'model';
      const { NodeIO, ImageUtils } = (await import(req.resolve('@gltf-transform/core'))) as typeof import('@gltf-transform/core');
      const { ALL_EXTENSIONS } = (await import(req.resolve('@gltf-transform/extensions'))) as typeof import('@gltf-transform/extensions');
      const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(f);
      const per = doc.getRoot().listMeshes().map((m) => ({
        name: m.getName(),
        triangles: m.listPrimitives().reduce((t, p) => t + Math.floor((p.getIndices()?.getCount() ?? p.getAttribute('POSITION')?.getCount() ?? 0) / 3), 0),
      }));
      a.triangles = per.reduce((t, m) => t + m.triangles, 0);
      a.meshes = per.sort((x, y) => y.triangles - x.triangles).slice(0, 3);
      a.textures = doc.getRoot().listTextures().map((t) => {
        const img = t.getImage();
        const size = img ? ImageUtils.getSize(img, t.getMimeType()) : null;
        return { mime: t.getMimeType(), width: size?.[0] ?? 0, height: size?.[1] ?? 0, kb: round((img?.length ?? 0) / 1024) };
      });
    } else if (/\.(webp|png|jpe?g)$/.test(file)) {
      a.kind = 'image';
      const sharp = ((await import(req.resolve('sharp'))) as { default: (input: Buffer) => import('sharp').Sharp }).default;
      const m = await sharp(buf).metadata();
      a.image = { width: m.width ?? 0, height: m.height ?? 0 };
    } else if (/\.(mp3|ogg|wav)$/.test(file)) {
      a.kind = 'audio';
      const p = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=channels,bit_rate:format=duration', '-of', 'json', f], { encoding: 'utf8' });
      const j = JSON.parse(p.stdout || '{}') as { streams?: { channels?: number; bit_rate?: string }[]; format?: { duration?: string } };
      const channels = j.streams?.[0]?.channels ?? 0;
      a.audio = { seconds: round(Number(j.format?.duration ?? 0), 2), channels, kbps: Math.round(Number(j.streams?.[0]?.bit_rate ?? 0) / 1000) };
      if (channels === 2) a.audio.nearMono = nearMono(f);
    }
    out.push(a);
  }
  return out.sort((x, y) => y.gzipKb - x.gzipKb);
}

/** Near-lossless defaults (applied without asking once the screenshots say "same") + the visible candidates. */
export function propose(assets: Asset[], current: OptimizeConfig): { config: OptimizeConfig; candidates: Candidate[] } {
  const defaults: OptimizeConfig = {
    // the release keeps whichever GLB is smaller, so a texture that is already a small JPEG stays as it is
    textures: { '*': { format: 'webp', quality: 90 } },
    images: { 'images/*': { quality: 85 } },
    audio: { 'music/*': { vbr: 5 }, 'sfx/*': { vbr: 5 } },
  };
  for (const a of assets) {
    if (a.kind === 'image' && /splash/.test(a.file) && Math.max(a.image?.width ?? 0, a.image?.height ?? 0) > 2560)
      defaults.images![a.file] = { quality: 85, maxSize: 2560 }; // a full-screen backdrop: 2560 covers 1440p at 1x
    if (a.kind === 'audio' && a.audio?.nearMono && a.file.startsWith('sfx/')) defaults.audio![a.file] = { vbr: 5, mono: true };
  }
  // the user's earlier entries win over the defaults; sections merge key by key
  const config: OptimizeConfig = { decisions: current.decisions ?? [] };
  for (const k of ['textures', 'models', 'images', 'audio'] as const) {
    const merged = { ...(defaults[k] ?? {}), ...(current[k] ?? {}) };
    if (Object.keys(merged).length) config[k] = merged;
  }
  const decided = new Set((current.decisions ?? []).map((d) => d.change));
  const candidates: Candidate[] = [];
  const add = (c: Candidate) => {
    if (!decided.has(c.id)) candidates.push(c);
  };
  for (const a of assets) {
    if (a.kind === 'model' && (a.triangles ?? 0) > 20000) {
      for (const ratio of [0.75, 0.5])
        add({ id: `simplify:${a.file}:${ratio}`, file: a.file, section: 'models', settings: { simplify: { ratio, error: 0.002 } }, what: `${Math.round(ratio * 100)}% of ${a.triangles} triangles: rounder shapes get flatter, thin parts can break up` });
    }
    const big = (a.textures ?? []).filter((t) => Math.max(t.width, t.height) > 1024);
    if (big.length) add({ id: `texture-1024:${a.file}`, file: a.file, section: 'textures', settings: { format: 'webp', quality: 90, maxSize: 1024 }, what: `${big.length} texture(s) of up to ${Math.max(...big.map((t) => Math.max(t.width, t.height)))} px down to 1024 px: softer up close` });
    if (a.kind === 'audio' && a.file.startsWith('music/')) add({ id: `music-vbr7:${a.file}`, file: a.file, section: 'audio', settings: { vbr: 7 }, what: 'about 100 kbps instead of 130: duller highs, audible on headphones' });
    if (a.kind === 'image' && !/icon/.test(a.file) && a.gzipKb > 50) add({ id: `image-q70:${a.file}`, file: a.file, section: 'images', settings: { quality: 70 }, what: 'quality 70: blockier gradients in the loading screen' });
  }
  return { config, candidates };
}

function readConfig(project: string): OptimizeConfig {
  const p = join(project, 'design', 'optimize.json');
  return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as OptimizeConfig) : {};
}
function writeConfig(project: string, c: OptimizeConfig): void {
  mkdirSync(join(project, 'design'), { recursive: true });
  writeFileSync(join(project, 'design', 'optimize.json'), `${JSON.stringify(c, null, 2)}\n`);
}
export function withCandidate(c: OptimizeConfig, cand: Candidate): OptimizeConfig {
  const next = structuredClone(c);
  next[cand.section] = { ...(next[cand.section] ?? {}), [cand.file]: { ...(next[cand.section]?.[cand.file] ?? {}), ...cand.settings } };
  return next;
}

type Report = { totals: { totalGzipMb: number }; files: { file: string; bytes: number; gzip: number }[] };
/** Release with a config; returns the release report (dist/ is left built with that config). */
function release(project: string, configFile: string): Report {
  const r = spawnSync(process.execPath, [join(project, 'scripts', 'release.ts'), '--project', project, '--optimize', configFile], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`release failed:\n${r.stdout.slice(-1500)}${r.stderr.slice(-1500)}`);
  return JSON.parse(readFileSync(join(project, 'dist', 'release-report.json'), 'utf8')) as Report;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const cmd = args[0];
  const pi = args.indexOf('--project');
  const project = resolve(pi >= 0 ? (args[pi + 1] ?? '.') : '.');
  const ids = args.slice(1).filter((a, i, all) => a !== '--project' && all[i - 1] !== '--project');
  const work = join(project, '.lab', 'optimize');
  mkdirSync(work, { recursive: true });
  const candFile = join(work, 'candidates.json');
  const loadCands = (): Candidate[] => {
    if (!existsSync(candFile)) throw new Error('no candidates yet: run `propose` first');
    return JSON.parse(readFileSync(candFile, 'utf8')) as Candidate[];
  };
  if (cmd === 'inventory') {
    const assets = await inventory(project);
    writeFileSync(join(work, 'inventory.json'), JSON.stringify(assets, null, 2));
    const total = assets.reduce((s, a) => s + a.gzipKb, 0);
    console.log(`${'file'.padEnd(34)} ${'KB'.padStart(8)} ${'gzip KB'.padStart(8)}  details`);
    for (const a of assets) {
      const d = a.kind === 'model'
        ? `${a.triangles} tris (${a.meshes?.map((m) => `${m.name} ${m.triangles}`).join(', ')})${a.textures?.length ? `, textures ${a.textures.map((t) => `${t.width}x${t.height} ${t.mime.split('/')[1]}`).join(', ')}` : ''}`
        : a.kind === 'audio' ? `${a.audio?.seconds} s, ${a.audio?.channels} ch, ${a.audio?.kbps} kbps${a.audio?.nearMono ? ' (near-mono)' : ''}`
        : a.kind === 'image' ? `${a.image?.width}x${a.image?.height}` : '';
      console.log(`${a.file.padEnd(34)} ${String(a.kb).padStart(8)} ${String(a.gzipKb).padStart(8)}  ${d}`);
    }
    console.log(`\npublic/ total ${round(total / 1024, 2)} MB gzip, before the release's lossless GLB compression; dist/release-report.json has the shipped sizes (and JS, wasm)`);
  } else if (cmd === 'propose') {
    const assets = existsSync(join(work, 'inventory.json')) ? (JSON.parse(readFileSync(join(work, 'inventory.json'), 'utf8')) as Asset[]) : await inventory(project);
    const { config, candidates } = propose(assets, readConfig(project));
    writeConfig(project, config);
    writeFileSync(candFile, JSON.stringify(candidates, null, 2));
    console.log('design/optimize.json: near-lossless defaults written (check them with a release playtest + compare-shots)');
    console.log(`\nvisible candidates (trial each, then show the user one table):`);
    for (const c of candidates) console.log(`  ${c.id}\n      ${c.what}`);
  } else if (cmd === 'trial') {
    const cand = loadCands().find((c) => c.id === ids[0]);
    if (!cand) throw new Error(`unknown candidate ${ids[0] ?? '(none)'}; see .lab/optimize/candidates.json`);
    const dir = join(work, 'trials', cand.id.replace(/[^\w.-]+/g, '_'));
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const base = readConfig(project);
    writeFileSync(join(dir, 'base.json'), JSON.stringify(base));
    writeFileSync(join(dir, 'trial.json'), JSON.stringify(withCandidate(base, cand)));
    const before = release(project, join(dir, 'base.json'));
    const after = release(project, join(dir, 'trial.json')); // dist/ is left as the trial build, ready to playtest
    const gz = (r: Report) => r.files.find((f) => f.file === cand.file)?.gzip ?? 0;
    const raw = (r: Report) => r.files.find((f) => f.file === cand.file)?.bytes ?? 0;
    const gain = { candidate: cand, fileKb: [round(gz(before) / 1024), round(gz(after) / 1024)] as [number, number], rawKb: [round(raw(before) / 1024), round(raw(after) / 1024)] as [number, number], totalMb: [round(before.totals.totalGzipMb, 2), round(after.totals.totalGzipMb, 2)] as [number, number] };
    writeFileSync(join(dir, 'gain.json'), JSON.stringify(gain, null, 2));
    cpSync(join(project, 'dist', 'release-report.json'), join(dir, 'release-report.json'));
    console.log(`${cand.id}: ${cand.file} ${gain.fileKb[0]} -> ${gain.fileKb[1]} KB gzip (raw ${gain.rawKb[0]} -> ${gain.rawKb[1]} KB) · total ${gain.totalMb[0]} -> ${gain.totalMb[1]} MB gzip`);
    if (gain.fileKb[1] >= gain.fileKb[0]) console.log('  no gain: hosts gzip GLBs (GitHub Pages does), and simplified geometry can compress worse than the regular original. Decline it.');
    console.log(`  trial dir: ${relative(project, dir)}`);
    console.log(`dist/ now holds this trial: playtest it (game-judge playtest --out ${relative(project, join(dir, 'run'))}), then compare-shots against the base run`);
  } else if (cmd === 'check') {
    // gameplay screenshots never show the loading-screen splash or the icon: compare those images directly
    let worst = 1;
    for (const f of walk(join(project, 'dist', 'images'))) {
      const src = join(project, 'public', relative(join(project, 'dist'), f));
      if (!existsSync(src) || readFileSync(src).equals(readFileSync(f))) continue;
      const r = spawnSync('ffmpeg', ['-v', 'info', '-i', src, '-i', f, '-lavfi', 'scale2ref[a][b];[a][b]ssim', '-f', 'null', '-'], { encoding: 'utf8' });
      const score = Number(r.stderr.match(/All:([\d.]+)/)?.[1] ?? 0);
      worst = Math.min(worst, score);
      console.log(`${score >= 0.985 ? 'same   ' : 'CHANGED'} ${score.toFixed(4)} ${relative(project, f)}`);
    }
    process.exit(worst >= 0.985 ? 0 : 1);
  } else if (cmd === 'apply' || cmd === 'decline') {
    const cands = loadCands();
    let config = readConfig(project);
    const date = new Date().toISOString().slice(0, 10);
    for (const id of ids) {
      const cand = cands.find((c) => c.id === id);
      if (!cand) throw new Error(`unknown candidate ${id}`);
      const gainFile = join(work, 'trials', id.replace(/[^\w.-]+/g, '_'), 'gain.json');
      const g = existsSync(gainFile) ? (JSON.parse(readFileSync(gainFile, 'utf8')) as { fileKb: [number, number] }) : null;
      if (cmd === 'apply') config = withCandidate(config, cand);
      config.decisions = [...(config.decisions ?? []), { change: id, accepted: cmd === 'apply', ...(g ? { gain: `${g.fileKb[1] > g.fileKb[0] ? '+' : ''}${round(g.fileKb[1] - g.fileKb[0])} KB gzip` } : {}), date }];
      console.log(`${cmd === 'apply' ? 'applied ' : 'declined'} ${id}`);
    }
    writeConfig(project, config);
  } else {
    console.error('usage: optimize-assets.ts inventory | propose | trial <id> | check | apply <id...> | decline <id...>  [--project .]');
    process.exit(2);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e: unknown) => {
    console.error(`[optimize-assets] ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  });
}
