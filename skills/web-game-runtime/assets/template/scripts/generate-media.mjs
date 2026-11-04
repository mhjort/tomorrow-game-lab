#!/usr/bin/env node
// Generate 2D images and sound effects for a game from design/media.json with an AI provider (Runware for now).
// Run from the game project root: `pnpm media` (or node this file). No npm dependencies; ffmpeg is used for
// post-processing (resize, silence trim, peak normalise, waveform previews) when it is on PATH.
//
//   node generate-media.mjs [name...] [--project .] [--spec design/media.json] [--force] [--dry-run] [--pick name=i]
//
//   name...        only these entries (default: all)
//   --force        regenerate even if the spec entry is unchanged (costs money)
//   --dry-run      print the provider requests and an estimated cost, call nothing
//   --pick n=i     promote candidate i of entry n (from .lab/media/<n>/) to public/
//
// Outputs: public/images/<name>.<png|webp|jpg>, public/sfx/<name>.mp3, candidates + waveforms in .lab/media/,
// and assets/media.lock.json (spec hash → file, model, seed, cost). An entry whose spec hash matches the lock is
// skipped, so re-running is free. Commit the outputs and the lock file: CI has no API key.
// Env: RUNWARE_API_KEY (required unless --dry-run), RUNWARE_API_URL (override, used by tests).
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, extname, join, relative, resolve } from 'node:path';

// ------------------------------------------------------------------ defaults
export const DEFAULT_MODELS = {
  image: 'google:nano-banana@2.1', // style-matched art; takes reference images (key art)
  transparent: 'openai:gpt-image@2.5-flare', // icons, sprites, UI with alpha
  sfx: 'mirelo:1@1', // Mirelo SFX 1.5, text-to-SFX
};
// rough USD per result, for --dry-run and the summary when the provider returns no cost
const EST_COST = {
  'google:nano-banana@2.1': () => 0.034,
  'openai:gpt-image@2.5-flare': () => 0.034,
  'bytedance:seedream@5.0-flash': () => 0.0193,
  'mirelo:1@1': (t) => 0.01 * Math.ceil(t.duration ?? 10), // billed ~$0.01/started second (observed 2026-11)
};
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };

// ------------------------------------------------------------------ provider: Runware
const runware = {
  name: 'runware',
  async call(tasks) {
    const key = process.env.RUNWARE_API_KEY;
    if (!key) throw new Error('RUNWARE_API_KEY is not set. Get a key at https://runware.ai and `export RUNWARE_API_KEY=...`.');
    const url = process.env.RUNWARE_API_URL ?? 'https://api.runware.ai/v1';
    const res = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(tasks) });
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`Runware HTTP ${res.status}: ${text.slice(0, 300)}`);
    }
    if (json.errors?.length) throw new Error(`Runware: ${json.errors.map((e) => `${e.code ?? ''} ${e.message ?? JSON.stringify(e)}${e.parameter ? ` (${e.parameter})` : ''}`).join('; ')}`);
    if (!res.ok) throw new Error(`Runware HTTP ${res.status}: ${text.slice(0, 300)}`);
    return json.data ?? [];
  },
  // run one task; poll getResponse when the request fell back to async (sync requests > 120 s do)
  async run(task) {
    const n = task.numberResults ?? 1;
    const done = (items) => items.filter((d) => d.taskUUID === task.taskUUID && (d.imageURL || d.audioURL));
    let items = done(await this.call([task]));
    for (let i = 0; items.length < n && i < 150; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      items = done(await this.call([{ taskType: 'getResponse', taskUUID: task.taskUUID }]));
    }
    if (items.length < n) throw new Error(`Runware: task ${task.taskUUID} returned ${items.length}/${n} results`);
    return items.map((d) => ({ url: d.imageURL ?? d.audioURL, seed: d.seed, cost: d.cost }));
  },
  imageTask(e, refs) {
    const t = {
      taskType: 'imageInference',
      taskUUID: randomUUID(),
      model: e.model,
      positivePrompt: e.prompt,
      outputType: 'URL',
      outputFormat: e.format.toUpperCase().replace('JPEG', 'JPG'),
      numberResults: e.candidates,
      includeCost: true,
    };
    if (e.width) Object.assign(t, { width: e.width, height: e.height });
    if (e.seed !== undefined) t.seed = e.seed;
    if (e.negativePrompt) t.negativePrompt = e.negativePrompt;
    if (refs.length) t.inputs = { referenceImages: refs };
    const settings = { ...(e.transparent ? { background: 'transparent' } : {}), ...e.settings };
    if (Object.keys(settings).length) t.settings = settings;
    return { ...t, ...e.extra };
  },
  audioTask(e) {
    const t = {
      taskType: 'audioInference',
      taskUUID: randomUUID(),
      model: e.model,
      positivePrompt: e.prompt,
      duration: e.duration,
      outputType: 'URL',
      outputFormat: hasFfmpeg() ? 'WAV' : 'MP3', // lossless raw when we can re-encode ourselves
      numberResults: e.candidates,
      includeCost: true,
    };
    if (e.seed !== undefined) t.seed = e.seed;
    return { ...t, ...e.extra };
  },
};
export const PROVIDERS = { runware };

// ------------------------------------------------------------------ helpers
let ffmpegOk;
const hasFfmpeg = () => (ffmpegOk ??= spawnSync('ffmpeg', ['-version']).status === 0);
const ffmpeg = (args) => {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-y', '-loglevel', 'error', ...args], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`ffmpeg ${args.join(' ')}\n${r.stderr}`);
  return r;
};
const stable = (v) => (Array.isArray(v) ? v.map(stable) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, stable(v[k])])) : v);
const sha = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);

/** Resolve a spec entry to a full, normalised description (defaults filled in). */
export function normalise(kind, name, raw, provider = 'runware') {
  if (!raw.prompt) throw new Error(`${kind}.${name}: "prompt" is required`);
  const e = { kind, name, provider, candidates: 1, ...raw };
  if (kind === 'images') {
    e.model ??= e.transparent ? DEFAULT_MODELS.transparent : DEFAULT_MODELS.image;
    e.out ??= e.transparent ? 'png' : 'webp';
    // the provider renders the final format unless we resize (ffmpeg has no webp encoder on most installs)
    e.format = e.resize ? 'png' : e.out;
    if (e.resize && !/^(png|jpg)$/.test(e.out)) throw new Error(`images.${name}: "resize" needs out png or jpg (got ${e.out})`);
    if (e.transparent && e.out === 'jpg') throw new Error(`images.${name}: transparent images need png or webp`);
    e.reference = [].concat(e.reference ?? []);
    if (!!e.width !== !!e.height) throw new Error(`images.${name}: give width and height together`);
  } else if (kind === 'sfx') {
    e.model ??= DEFAULT_MODELS.sfx;
    e.duration ??= 2;
    e.out = 'mp3';
    e.trim ??= true;
    e.gain ??= 0; // dB relative to peak-normalised -1 dBFS
    e.trimDb ??= 18; // trim edges whose RMS is more than trimDb below the loudest 10 ms
  } else throw new Error(`unknown kind "${kind}"`);
  if (!(e.candidates >= 1 && e.candidates <= 4)) throw new Error(`${kind}.${name}: candidates must be 1..4`);
  return e;
}

// Spec keys that change what the provider returns. Everything else (resize, out, trim, gain, ...) is
// post-processing: changing it re-processes the cached candidate in .lab/media/ without a new request.
const GEN_KEYS = ['provider', 'model', 'prompt', 'negativePrompt', 'width', 'height', 'reference', 'transparent', 'format', 'duration', 'seed', 'candidates', 'settings', 'extra'];

/** { gen, post } hashes of a normalised entry (gen includes reference file contents). */
export function specHash(e, project) {
  const refs = e.reference?.map((r) => (/^(https?:|data:)/.test(r) ? r : sha(readFileSync(join(project, r))))) ?? [];
  const pick = (keep) => Object.fromEntries(Object.entries({ ...e, reference: refs }).filter(([k]) => k !== 'name' && GEN_KEYS.includes(k) === keep));
  return { gen: sha(JSON.stringify(stable({ kind: e.kind, ...pick(true) }))), post: sha(JSON.stringify(stable(pick(false)))) };
}

const refToInput = (r, project) => {
  if (/^(https?:|data:)/.test(r)) return r;
  const ext = extname(r).slice(1).toLowerCase();
  return `data:${MIME[ext] ?? 'application/octet-stream'};base64,${readFileSync(join(project, r)).toString('base64')}`;
};

async function download(url, file) {
  if (url.startsWith('data:')) return writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${url}: HTTP ${res.status}`);
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
}

const probeDuration = (f) => {
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f], { encoding: 'utf8' });
  return r.status === 0 ? Number(r.stdout.trim()) : null;
};
const maxVolume = (f) => {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-i', f, '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' });
  const m = r.stderr.match(/max_volume:\s*(-?[\d.]+) dB/);
  return m ? Number(m[1]) : null;
};

const waveform = (src, png) => {
  ffmpeg(['-i', src, '-filter_complex', 'aformat=channel_layouts=mono,showwavespic=s=640x120:colors=#e4572e', '-frames:v', '1', png]);
  return png;
};
/** Mono float PCM of an audio file (via ffmpeg). */
export function decodePcm(src, rate = 44100) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', src, '-f', 'f32le', '-ac', '1', '-ar', String(rate), '-'], { maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(`ffmpeg decode ${src}: ${r.stderr}`);
  return new Float32Array(r.stdout.buffer, r.stdout.byteOffset, r.stdout.length / 4);
}

/**
 * [start, end] seconds of the "event" in a clip: the span whose 10 ms RMS is within trimDb of the loudest window.
 * RMS (not sample peaks) so a hissy noise floor doesn't count as signal.
 */
export function loudSpan(pcm, rate = 44100, trimDb = 18) {
  const win = Math.round(rate / 100);
  const db = [];
  for (let i = 0; i + win <= pcm.length; i += win) {
    let sum = 0;
    for (let j = i; j < i + win; j++) sum += pcm[j] * pcm[j];
    db.push(10 * Math.log10(sum / win + 1e-12));
  }
  if (!db.length) return [0, pcm.length / rate];
  const thr = Math.max(...db) - trimDb;
  const first = db.findIndex((d) => d >= thr);
  const last = db.findLastIndex((d) => d >= thr);
  const duration = pcm.length / rate;
  return [Math.max(0, first * 0.01 - 0.005), Math.min(duration, (last + 1) * 0.01 + 0.03)];
}

/** Post-process a downloaded candidate into its public/ output. Returns info for the lock + log. */
export function finalise(e, src, project) {
  const dir = join(project, 'public', e.kind === 'images' ? 'images' : 'sfx');
  mkdirSync(dir, { recursive: true });
  const out = join(dir, `${e.name}.${e.out}`);
  for (const f of readdirSync(dir)) if (f.startsWith(`${e.name}.`) && join(dir, f) !== out) rmSync(join(dir, f)); // format changed
  const info = {};
  if (e.kind === 'images') {
    if (e.resize) {
      if (!hasFfmpeg()) throw new Error(`images.${e.name}: "resize" needs ffmpeg on PATH`);
      const [w, h] = [].concat(e.resize);
      ffmpeg(['-i', src, '-vf', `scale=${w}:${h ?? w}:force_original_aspect_ratio=decrease:flags=lanczos`, '-frames:v', '1', out]);
    } else copyFileSync(src, out);
  } else if (hasFfmpeg()) {
    // Text-to-SFX models pad clips with a noise floor and often place the event late. A game sound must start at
    // t=0, so trim to the span louder than (peak - trimDb), cap at maxDuration, fade the edges, peak-normalise.
    const duration = probeDuration(src);
    let [start, end] = [0, duration];
    if (e.trim) [start, end] = loudSpan(decodePcm(src), 44100, e.trimDb);
    if (e.maxDuration) end = Math.min(end, start + e.maxDuration);
    const len = Math.max(0.02, end - start);
    const fadeOut = Math.min(0.08, len / 3);
    const tmp = `${src}.tmp.wav`;
    ffmpeg(['-i', src, '-af', `atrim=${start.toFixed(4)}:${end.toFixed(4)},asetpts=PTS-STARTPTS,afade=t=in:d=0.004,afade=t=out:st=${(len - fadeOut).toFixed(4)}:d=${fadeOut.toFixed(4)},aformat=channel_layouts=mono`, '-ar', '44100', tmp]);
    const peak = maxVolume(tmp) ?? 0;
    ffmpeg(['-i', tmp, '-af', `volume=${(-1 - peak + e.gain).toFixed(2)}dB`, '-c:a', 'libmp3lame', '-q:a', '4', out]);
    rmSync(tmp);
    info.duration = probeDuration(out);
    info.trim = [Number(start.toFixed(3)), Number(end.toFixed(3))];
    info.waveform = relative(project, waveform(out, join(project, '.lab', 'media', `${e.name}.png`)));
  } else {
    copyFileSync(src, out);
    console.warn(`  ! ffmpeg not found: sfx.${e.name} copied untrimmed and unnormalised`);
  }
  info.file = relative(project, out);
  info.bytes = statSync(out).size;
  return info;
}

// ------------------------------------------------------------------ main
export async function main(argv = process.argv.slice(2)) {
  const opt = (n, d) => (argv.indexOf(n) >= 0 ? argv[argv.indexOf(n) + 1] : d);
  const valued = new Set(['--project', '--spec', '--pick']);
  const project = resolve(opt('--project', '.'));
  const specPath = join(project, opt('--spec', 'design/media.json'));
  const lockPath = join(project, 'assets', 'media.lock.json');
  const force = argv.includes('--force');
  const dry = argv.includes('--dry-run');
  const picks = argv.flatMap((a, i) => (argv[i - 1] === '--pick' ? [a] : []));
  const only = argv.filter((a, i) => !a.startsWith('--') && !valued.has(argv[i - 1]));

  if (!existsSync(specPath)) throw new Error(`no spec at ${relative(project, specPath)} (see the generate-media skill)`);
  const spec = JSON.parse(readFileSync(specPath, 'utf8'));
  const provider = PROVIDERS[spec.provider ?? 'runware'];
  if (!provider) throw new Error(`unknown provider "${spec.provider}" (have: ${Object.keys(PROVIDERS).join(', ')})`);
  const lock = existsSync(lockPath) ? JSON.parse(readFileSync(lockPath, 'utf8')) : {};
  const saveLock = () => {
    mkdirSync(dirname(lockPath), { recursive: true });
    writeFileSync(lockPath, `${JSON.stringify(stable(lock), null, 2)}\n`);
  };
  const entries = ['images', 'sfx'].flatMap((kind) => Object.entries(spec[kind] ?? {}).map(([name, raw]) => normalise(kind, name, raw, provider.name)));
  const names = new Set(entries.map((e) => e.name));
  if (names.size !== entries.length) throw new Error('entry names must be unique across images and sfx');
  for (const n of only) if (!names.has(n)) throw new Error(`no entry "${n}" in ${relative(project, specPath)}`);

  // --pick name=i: promote a reviewed candidate
  for (const p of picks) {
    const [name, idx] = p.split('=');
    const e = entries.find((x) => x.name === name);
    const l = lock[name];
    if (!e || !l?.candidates) throw new Error(`--pick ${p}: no pending candidates for "${name}" (generate first)`);
    const src = l.candidates[Number(idx)];
    if (!src || !existsSync(join(project, src))) throw new Error(`--pick ${p}: candidate ${idx} not found (have 0..${l.candidates.length - 1})`);
    Object.assign(l, finalise(e, join(project, src), project), { picked: Number(idx), seed: l.seeds?.[Number(idx)], post: specHash(e, project).post });
    console.log(`✓ ${name}: picked candidate ${idx} → ${l.file}`);
    saveLock();
  }
  if (picks.length) return { lock };

  let spent = 0;
  let requests = 0;
  for (const e of entries) {
    if (only.length && !only.includes(e.name)) continue;
    const { gen, post } = specHash(e, project);
    const l = lock[e.name];
    const label = `${e.kind}.${e.name}`;
    const have = (f) => f && existsSync(join(project, f));
    if (!force && l?.hash === gen) {
      if (l.post === post && have(l.file)) {
        console.log(`= ${label}: unchanged (${l.file})`);
        continue;
      }
      if (l.picked !== undefined && have(l.candidates?.[l.picked])) {
        Object.assign(l, finalise(e, join(project, l.candidates[l.picked]), project), { post });
        console.log(`↻ ${label}: re-processed cached candidate ${l.picked} → ${l.file} (no request)`);
        saveLock();
        continue;
      }
      if (l.picked === undefined && l.candidates?.every(have)) {
        console.log(`… ${label}: ${l.candidates.length} candidates waiting for review: ${l.candidates.join(' ')}\n  pick one with --pick ${e.name}=<i>`);
        continue;
      }
    }
    const task = e.kind === 'images' ? provider.imageTask(e, e.reference.map((r) => refToInput(r, project))) : provider.audioTask(e);
    const est = (EST_COST[e.model]?.(e) ?? NaN) * e.candidates;
    if (dry) {
      const shown = { ...task, inputs: task.inputs && { referenceImages: task.inputs.referenceImages.map((r) => (r.startsWith('data:') ? `${r.slice(0, 32)}… (${r.length} chars)` : r)) } };
      console.log(`→ ${label} (~$${Number.isNaN(est) ? '?' : est.toFixed(4)})\n${JSON.stringify(shown, null, 2)}`);
      if (!Number.isNaN(est)) spent += est;
      continue;
    }
    console.log(`→ ${label}: ${e.model}, ${e.candidates} result(s)…`);
    requests++;
    const results = await provider.run(task);
    const candDir = join(project, '.lab', 'media', e.name);
    rmSync(candDir, { recursive: true, force: true });
    mkdirSync(candDir, { recursive: true });
    const rawExt = e.kind === 'images' ? e.format : task.outputFormat.toLowerCase();
    const candidates = [];
    for (const [i, r] of results.entries()) {
      const f = join(candDir, `${i}.${rawExt}`);
      await download(r.url, f);
      candidates.push(relative(project, f));
      if (e.kind === 'sfx' && hasFfmpeg() && results.length > 1) waveform(f, f.replace(/\.\w+$/, '.png'));
    }
    const cost = results.reduce((s, r) => s + (r.cost ?? 0), 0) || (Number.isNaN(est) ? 0 : est);
    spent += cost;
    lock[e.name] = { kind: e.kind, hash: gen, post, model: e.model, provider: provider.name, cost: Number(cost.toFixed(5)), seeds: results.map((r) => r.seed), candidates };
    if (candidates.length === 1) {
      Object.assign(lock[e.name], finalise(e, join(project, candidates[0]), project), { picked: 0, seed: results[0].seed });
      const l2 = lock[e.name];
      console.log(`✓ ${label} → ${l2.file} (${(l2.bytes / 1024).toFixed(1)} KB${l2.duration ? `, ${l2.duration.toFixed(2)} s` : ''})${l2.waveform ? ` waveform: ${l2.waveform}` : ''}`);
    } else console.log(`… ${label}: review ${candidates.join(' ')}\n  then: --pick ${e.name}=<i>`);
    saveLock();
  }
  console.log(`${dry ? 'estimated' : 'spent'} ~$${spent.toFixed(4)} (${dry ? 'dry run, nothing called' : `${requests} request(s)`})`);
  return { lock, spent, requests };
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`✗ ${err.message}`);
    process.exit(1);
  });
}
