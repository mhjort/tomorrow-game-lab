#!/usr/bin/env node
// Generate 2D images, sound effects, music loops, gameplay videos and 3D models for a game from design/media.json with an AI
// provider (Runware for now). Run from the game project root: `pnpm media` (or node this file). No npm dependencies;
// ffmpeg (resize, silence trim, peak normalise, music loop cutting, waveforms, video contact sheets) and Blender (3D preview sheets,
// via preview_glb.py next to this file) are used when available.
//
//   node generate-media.ts [name...] [--project .] [--spec design/media.json] [--force] [--dry-run] [--pick name=i]
//
//   name...        only these entries (default: all)
//   --force        regenerate even if the spec entry is unchanged (costs money)
//   --dry-run      print the provider requests and an estimated cost, call nothing
//   --pick n=i     promote candidate i of entry n (from .lab/media/<n>/) to its output folder
//
// Outputs: public/images/<name>.<png|webp|jpg>, public/sfx/<name>.mp3, public/music/<name>.mp3 + <name>.json
// (seamless loop: loop length and tempo for the runtime's audio.ts), design/reference/<name>.mp4 (videos are
// references for building the game, not shipped), assets/generated/<name>.glb (raw 3D, imported and cleaned up
// by a Blender asset script), candidates + waveforms + contact sheets + 3D previews in .lab/media/,
// and assets/media.lock.json (spec hash → file, model, seed, cost). An entry whose spec hash matches the lock is
// skipped, so re-running is free. Commit the outputs and the lock file: CI has no API key.
// Env: RUNWARE_API_KEY (required unless --dry-run), RUNWARE_API_URL (override, used by tests).
import { createHash, randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, extname, join, relative, resolve } from 'node:path';

// ------------------------------------------------------------------ types
export const KINDS = ['images', 'sfx', 'music', 'videos', 'models'] as const;
export type Kind = (typeof KINDS)[number];
type Json = Record<string, unknown>;

/** An entry as written in design/media.json (every field optional; normalise() fills defaults and validates). */
export interface RawEntry {
  prompt?: string;
  negativePrompt?: string;
  model?: string;
  candidates?: number;
  seed?: number;
  out?: string;
  dir?: string;
  width?: number;
  height?: number;
  resolution?: string;
  fps?: number;
  duration?: number;
  maxDuration?: number;
  transparent?: boolean;
  resize?: number | number[];
  reference?: string | string[];
  frames?: string | string[];
  image?: string | string[];
  faceLimit?: number;
  trim?: boolean;
  gain?: number;
  trimDb?: number;
  loop?: boolean;
  instrumental?: boolean;
  bpm?: number;
  beatsPerBar?: number;
  bars?: number;
  skip?: number;
  crossfade?: number;
  level?: number;
  key?: string;
  lyrics?: string;
  audio?: boolean;
  settings?: Json;
  extra?: Json;
}
interface BaseEntry extends Omit<RawEntry, 'reference' | 'frames' | 'image'> {
  name: string;
  provider: string;
  candidates: number;
  model: string;
  out: string;
}
export interface ImageEntry extends BaseEntry {
  kind: 'images';
  format: string;
  reference: string[];
}
export interface SfxEntry extends BaseEntry {
  kind: 'sfx';
  duration: number;
  trim: boolean;
  gain: number;
  trimDb: number;
}
export interface MusicEntry extends BaseEntry {
  kind: 'music';
  loop: boolean;
  instrumental: boolean;
  bpm: number;
  beatsPerBar: number;
  bars: number;
  skip: number;
  crossfade: number;
  level: number;
}
export interface VideoEntry extends BaseEntry {
  kind: 'videos';
  duration: number;
  format: string;
  audio: boolean;
  dir: string;
  frames: string[];
  reference: string[];
}
export interface ModelEntry extends BaseEntry {
  kind: 'models';
  format: string;
  dir: string;
  image: string[];
}
export type Entry = ImageEntry | SfxEntry | MusicEntry | VideoEntry | ModelEntry;
type EntryOf<K extends Kind> = Extract<Entry, { kind: K }>;

/** A provider request (Runware task JSON). */
export interface Task extends Json {
  taskType: string;
  taskUUID: string;
  outputFormat?: string;
  numberResults?: number;
  deliveryMethod?: string;
  inputs?: Record<string, string | string[]>;
}
export interface Result {
  url: string;
  seed: number | undefined;
  cost: number | undefined;
}
export interface Provider {
  name: string;
  run(task: Task): Promise<Result[]>;
  imageTask(e: ImageEntry, refs: string[]): Task;
  audioTask(e: SfxEntry): Task;
  musicTask(e: MusicEntry): Task;
  videoTask(e: VideoEntry, frames: string[], refs: string[]): Task;
  modelTask(e: ModelEntry, images: string[]): Task;
}
/** Post-processing facts recorded in the lock file. */
export interface FinaliseInfo {
  file?: string;
  bytes?: number;
  duration?: number | null;
  trim?: [number, number];
  waveform?: string;
  sheet?: string;
  tris?: number;
  size?: number[];
  loop?: [number, number];
  seam?: number;
  tempo?: number;
}
/** One entry of assets/media.lock.json. */
export interface LockEntry extends FinaliseInfo {
  kind: Kind;
  hash: string;
  post: string;
  model: string;
  provider: string;
  cost: number;
  seeds?: (number | undefined)[];
  seed?: number | undefined;
  candidates?: string[];
  picked?: number;
}
type Lock = Record<string, LockEntry>;
/** The parts of a Runware response item read here. */
interface RunwareItem {
  taskUUID?: string;
  status?: string;
  error?: string;
  message?: string;
  imageURL?: string;
  audioURL?: string;
  videoURL?: string;
  imageUUID?: string;
  audioUUID?: string;
  videoUUID?: string;
  outputs?: { files?: { url?: string; uuid?: string }[] };
  seed?: number;
  cost?: number;
}
interface RunwareError {
  code?: string;
  message?: string;
  parameter?: string;
}
const list = (x: string | string[] | undefined): string[] => ([] as string[]).concat(x ?? []);

// ------------------------------------------------------------------ defaults
export const DEFAULT_MODELS = {
  image: 'google:nano-banana@2.1', // style-matched art; takes reference images (key art)
  transparent: 'openai:gpt-image@2.5-flare', // icons, sprites, UI with alpha
  sfx: 'mirelo:1@1', // Mirelo SFX 1.5, text-to-SFX
  music: 'runware:ace-step@v1.5-xl-turbo', // ACE-Step 1.5 XL Turbo: instrumentals with BPM/key control, ~$0.001, ~5 s
  model3d: 'tripo:v3.1@0', // Tripo 3D v3.1: image-to-3D GLB, native faceLimit, clean textures; $0.30 billed
  video: 'minimax:h3@max', // MiniMax H3 Max: convincing "gameplay footage", steady camera; ~$0.056/s at 1344×768 (observed)
};
// rough USD per result, for --dry-run and the summary when the provider returns no cost
type Sized = { duration?: number | undefined; width?: number | undefined; height?: number | undefined };
const EST_COST: Record<string, (t: Sized) => number> = {
  'google:nano-banana@2.1': () => 0.034,
  'openai:gpt-image@2.5-flare': () => 0.034,
  'bytedance:seedream@5.0-flash': () => 0.0193,
  'mirelo:1@1': (t) => 0.01 * Math.ceil(t.duration ?? 10), // billed ~$0.01/started second (observed 2026-11)
  'runware:ace-step@v1.5-xl-turbo': (t) => 0.0037 * Math.max(1, (t.duration ?? 60) / 60), // billed $0.0037 per 60 s WAV (observed 2026-11)
  'minimax:music@2.6': () => 0.15, // per song (~2.5 min to generate)
  // video: USD per second of output at <= 720p (Runware model schemas, 2026-11); larger sizes cost more
  'lightricks:ltx@2.3-fast': (t) => 0.03 * (t.duration ?? 5) * ((t.width ?? 1280) * (t.height ?? 720) > 1280 * 720 ? 2 : 1),
  'minimax:h3@max': (t) => 0.056 * (t.duration ?? 5), // 768p, billed (observed 2026-11; list price $0.08/s)
  'minimax:h3@max-turbo': (t) => 0.028 * (t.duration ?? 5), // 768p, billed (observed 2026-11; list price $0.04/s)
  'bytedance:seedance@2.5': (t) => 0.23 * (t.duration ?? 5), // 720p
  // 3D: USD per model (billed, observed 2026-11 where measured)
  'tripo:v3.1@0': () => 0.3,
  'tencent:hunyuan-3d@3.1-rapid': () => 0.225,
  'tencent:hunyuan-3d@3.1-pro': () => 0.525,
  'hyper3d:rodin@gen-2': () => 0.4,
  'meshy:meshy@6': () => 0.8,
  'google:veo@3.1-lite': (t) => 0.03 * (t.duration ?? 5),
  'bytedance:seedance@2.0-fast': (t) => 0.13 * (t.duration ?? 5),
  'klingai:kling-video@3.0-turbo': (t) => 0.112 * (t.duration ?? 5),
};
const VIDEO_EXT = /\.(mp4|webm|mov)$/;
const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };
const OUT_DIR: Record<Kind, string> = { images: 'public/images', sfx: 'public/sfx', music: 'public/music', videos: 'design/reference', models: 'assets/generated' };
const SINGLE_IMAGE_3D = /hunyuan-3d@3\.1-rapid|trellis/; // these take inputs.image, the others inputs.images

// ------------------------------------------------------------------ provider: Runware
async function runwareCall(tasks: Task[] | { taskType: string; taskUUID: string }[]): Promise<RunwareItem[]> {
  const key = process.env.RUNWARE_API_KEY;
  if (!key) throw new Error('RUNWARE_API_KEY is not set. Get a key at https://runware.ai and `export RUNWARE_API_KEY=...`.');
  const url = process.env.RUNWARE_API_URL ?? 'https://api.runware.ai/v1';
  const res = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(tasks) });
  const text = await res.text();
  let json: { data?: RunwareItem[]; errors?: RunwareError[] };
  try {
    json = JSON.parse(text) as typeof json;
  } catch {
    throw new Error(`Runware HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  if (json.errors?.length) throw new Error(`Runware: ${json.errors.map((e) => `${e.code ?? ''} ${e.message ?? JSON.stringify(e)}${e.parameter ? ` (${e.parameter})` : ''}`).join('; ')}`);
  if (!res.ok) throw new Error(`Runware HTTP ${res.status}: ${text.slice(0, 300)}`);
  return json.data ?? [];
}

const runware: Provider = {
  name: 'runware',
  // run one task; poll getResponse when the request is async (videos) or fell back to async (sync > 120 s)
  async run(task) {
    const n = task.numberResults ?? 1;
    const url = (d: RunwareItem) => d.imageURL ?? d.audioURL ?? d.videoURL ?? d.outputs?.files?.[0]?.url;
    const seen = new Map<string, RunwareItem & { url: string }>(); // result UUID → item (getResponse may repeat finished results)
    const collect = (items: RunwareItem[]) => {
      for (const d of items) {
        if (d.taskUUID !== task.taskUUID) continue;
        if (d.status === 'error') throw new Error(`Runware: task ${task.taskUUID} failed: ${d.error ?? d.message ?? JSON.stringify(d)}`);
        const u = url(d);
        if (u) seen.set(d.imageUUID ?? d.audioUUID ?? d.videoUUID ?? d.outputs?.files?.[0]?.uuid ?? `${u}|${d.seed}`, { ...d, url: u });
      }
    };
    const slow = task.deliveryMethod === 'async'; // videos (~1 min) and 3D (1–3 min)
    const [wait, tries] = slow ? [5000, 240] : [2000, 150]; // async: up to 20 min
    collect(await runwareCall([task]));
    for (let i = 0; seen.size < n && i < tries; i++) {
      await new Promise((r) => setTimeout(r, Number(process.env.RUNWARE_POLL_MS ?? wait)));
      collect(await runwareCall([{ taskType: 'getResponse', taskUUID: task.taskUUID }]));
    }
    if (seen.size < n) throw new Error(`Runware: task ${task.taskUUID} returned ${seen.size}/${n} results`);
    return [...seen.values()].slice(0, n).map((d) => ({ url: d.url, seed: d.seed, cost: d.cost }));
  },
  imageTask(e, refs) {
    const t: Task = {
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
    const t: Task = {
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
  musicTask(e) {
    const ace = /ace-step/.test(e.model);
    const minimax = /^minimax:music/.test(e.model);
    const t: Task = {
      taskType: 'audioInference',
      taskUUID: randomUUID(),
      model: e.model,
      positivePrompt: e.prompt,
      outputType: 'URL',
      outputFormat: hasFfmpeg() ? 'WAV' : 'MP3', // lossless: the loop is cut and encoded here
      numberResults: e.candidates,
      includeCost: true,
    };
    if (minimax) t.deliveryMethod = 'async'; // ~2.5 min per song
    else if (e.duration) t.duration = e.duration;
    if (e.seed !== undefined) t.seed = e.seed;
    const settings: Json = {};
    if (ace) {
      Object.assign(settings, { bpm: e.bpm, timeSignature: e.beatsPerBar });
      if (e.key) settings.keyScale = e.key;
      if (e.instrumental && !e.lyrics) Object.assign(settings, { lyrics: '[Instrumental]', vocalLanguage: 'unknown' });
    } else {
      // no tempo setting: ask in words (the loop finder still searches around the expected bar length)
      t.positivePrompt = `${e.prompt}. ${e.bpm} BPM${e.key ? `, ${e.key}` : ''}.`;
      if (minimax) settings.instrumental = e.instrumental && !e.lyrics;
    }
    if (e.lyrics) settings.lyrics = e.lyrics;
    Object.assign(settings, e.settings);
    if (Object.keys(settings).length) t.settings = settings;
    return { ...t, ...e.extra };
  },
  videoTask(e, frames, refs) {
    const t: Task = {
      taskType: 'videoInference',
      taskUUID: randomUUID(),
      deliveryMethod: 'async',
      model: e.model,
      positivePrompt: e.prompt,
      duration: e.duration,
      outputType: 'URL',
      outputFormat: e.out.toUpperCase(),
      numberResults: e.candidates,
      includeCost: true,
    };
    if (e.width) Object.assign(t, { width: e.width, height: e.height });
    if (e.resolution) t.resolution = e.resolution; // e.g. "768p": models that take no size with frameImages (H3, Veo)
    if (e.fps) t.fps = e.fps;
    if (e.seed !== undefined) t.seed = e.seed;
    if (e.negativePrompt) t.negativePrompt = e.negativePrompt;
    const inputs: Record<string, string[]> = { ...(frames.length ? { frameImages: frames } : {}), ...(refs.length ? { referenceImages: refs } : {}) };
    if (Object.keys(inputs).length) t.inputs = inputs;
    if (e.settings) t.settings = e.settings;
    return { ...t, ...e.extra };
  },
  modelTask(e, images) {
    const t: Task = {
      taskType: '3dInference',
      taskUUID: randomUUID(),
      deliveryMethod: 'async',
      model: e.model,
      outputType: 'URL',
      outputFormat: 'GLB',
      numberResults: e.candidates,
      includeCost: true,
    };
    if (e.prompt) t.positivePrompt = e.prompt;
    if (e.seed !== undefined) t.seed = e.seed;
    const [first] = images;
    if (first) t.inputs = SINGLE_IMAGE_3D.test(e.model) ? { image: first } : { images };
    const settings = { ...(e.faceLimit && /^tripo:/.test(e.model) ? { faceLimit: e.faceLimit } : {}), ...e.settings };
    if (Object.keys(settings).length) t.settings = settings;
    return { ...t, ...e.extra };
  },
};
export const PROVIDERS: Record<string, Provider> = { runware };

// ------------------------------------------------------------------ helpers
let ffmpegOk: boolean | undefined;
const hasFfmpeg = () => (ffmpegOk ??= spawnSync('ffmpeg', ['-version']).status === 0);
const ffmpeg = (args: string[]) => {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-y', '-loglevel', 'error', ...args], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`ffmpeg ${args.join(' ')}\n${r.stderr}`);
  return r;
};
const stable = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(stable) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, stable((v as Json)[k])])) : v;
const sha = (s: string | Buffer) => createHash('sha256').update(s).digest('hex').slice(0, 16);

/** Resolve a spec entry to a full, normalised description (defaults filled in). */
export function normalise<K extends Kind>(kind: K, name: string, raw: RawEntry, provider?: string): EntryOf<K>;
export function normalise(kind: string, name: string, raw: RawEntry, provider?: string): Entry;
export function normalise(kind: string, name: string, raw: RawEntry, provider = 'runware'): Entry {
  if (!raw.prompt && !(kind === 'models' && raw.image)) throw new Error(`${kind}.${name}: "prompt" is required${kind === 'models' ? ' (or "image")' : ''}`);
  // filled in below, per kind; the casts at each return are checked by the per-kind interfaces' required fields
  const e = { kind, name, provider, candidates: 1, ...raw } as Json & RawEntry & { kind: string; name: string; candidates: number; format?: string };
  const done = (): Entry => {
    if (!(e.candidates >= 1 && e.candidates <= 4)) throw new Error(`${kind}.${name}: candidates must be 1..4`);
    return e as unknown as Entry;
  };
  if (kind === 'images') {
    e.model ??= e.transparent ? DEFAULT_MODELS.transparent : DEFAULT_MODELS.image;
    e.out ??= e.transparent ? 'png' : 'webp';
    // the provider renders the final format unless we resize (ffmpeg has no webp encoder on most installs)
    e.format = e.resize ? 'png' : e.out;
    if (e.resize && !/^(png|jpg)$/.test(e.out)) throw new Error(`images.${name}: "resize" needs out png or jpg (got ${e.out})`);
    if (e.transparent && e.out === 'jpg') throw new Error(`images.${name}: transparent images need png or webp`);
    e.reference = list(e.reference);
    if (!!e.width !== !!e.height) throw new Error(`images.${name}: give width and height together`);
    // checked here, before any request: the provider rejects these after earlier entries were already paid for
    if (typeof e.width === 'number' && typeof e.height === 'number' && /^openai:gpt-image/.test(String(e.model))) {
      const px = e.width * e.height;
      if (px < 655360 || px > 8294400 || e.width % 16 || e.height % 16)
        throw new Error(`images.${name}: ${e.model} needs width and height in steps of 16 and 655,360–8,294,400 pixels in all (${e.width}×${e.height} = ${px}); e.g. 1280×640 for a 2:1 card`);
    }
  } else if (kind === 'sfx') {
    e.model ??= DEFAULT_MODELS.sfx;
    e.duration ??= 2;
    e.out = 'mp3';
    e.trim ??= true;
    e.gain ??= 0; // dB relative to peak-normalised -1 dBFS
    e.trimDb ??= 18; // trim edges whose RMS is more than trimDb below the loudest 10 ms
  } else if (kind === 'music') {
    e.model ??= DEFAULT_MODELS.music;
    e.out = 'mp3';
    e.loop ??= true; // cut a seamless loop of `bars` bars; false = a one-shot (stinger, jingle) trimmed + faded
    e.instrumental ??= true;
    e.bpm ??= 120;
    e.beatsPerBar ??= 4;
    e.bars ??= 8;
    if (!/^minimax:music/.test(e.model)) e.duration ??= 60; // generated length (ACE-Step: 30..300 s); the loop is cut from it
    e.skip ??= 2; // s of intro to skip before the loop may start
    e.crossfade ??= 0.08; // s blended across the seam
    e.level ??= -20; // mean loudness in dBFS (peaks capped at -1); sfx are peak-normalised, so music sits under them
    if (!(e.bpm >= 30 && e.bpm <= 300)) throw new Error(`music.${name}: bpm must be 30..300`);
  } else if (kind === 'videos') {
    e.model ??= DEFAULT_MODELS.video;
    e.duration ??= 5;
    e.out ??= 'mp4';
    e.format = e.out;
    e.audio ??= false; // reference clips: strip the generated soundtrack (needs ffmpeg)
    e.dir ??= OUT_DIR.videos;
    if (!/^(mp4|webm|mov)$/.test(e.out)) throw new Error(`videos.${name}: out must be mp4, webm or mov (got ${e.out})`);
    e.frames = list(e.frames);
    e.reference = list(e.reference);
    if (!!e.width !== !!e.height) throw new Error(`videos.${name}: give width and height together`);
    if (e.width && e.resolution) throw new Error(`videos.${name}: give width/height or resolution, not both`);
  } else if (kind === 'models') {
    e.model ??= DEFAULT_MODELS.model3d;
    e.out = 'glb';
    e.format = 'glb';
    e.dir ??= OUT_DIR.models;
    e.image = list(e.image); // 1 image, or several views of the same object (model-dependent)
  } else throw new Error(`unknown kind "${kind}"`);
  return done();
}

// Spec keys that change what the provider returns. Everything else (resize, out, trim, gain, ...) is
// post-processing: changing it re-processes the cached candidate in .lab/media/ without a new request.
const GEN_KEYS = ['provider', 'model', 'prompt', 'negativePrompt', 'width', 'height', 'resolution', 'reference', 'frames', 'image', 'faceLimit', 'transparent', 'format', 'duration', 'fps', 'seed', 'candidates', 'settings', 'extra', 'bpm', 'beatsPerBar', 'key', 'instrumental', 'lyrics'];

// A reference/frame can be the output of an earlier entry (e.g. a generated key-art image), so it may not exist
// yet in a dry run. A real run fails with a clear message instead.
const missingRef = (e: Entry, r: string) => new Error(`${e.kind}.${e.name}: input "${r}" not found. If it is generated by another entry, generate (and --pick) that first.`);
const fileHash = (e: Entry, r: string, project: string, dry: boolean) => {
  if (/^(https?:|data:)/.test(r)) return r;
  if (!existsSync(join(project, r))) {
    if (dry) return `missing:${r}`;
    throw missingRef(e, r);
  }
  return sha(readFileSync(join(project, r)));
};

/** { gen, post } hashes of a normalised entry (gen includes reference/frame file contents). */
export function specHash(e: Entry, project: string, dry = false): { gen: string; post: string } {
  const inputs = e as Partial<Record<'reference' | 'frames' | 'image', string[]>>;
  const files = Object.fromEntries(
    (['reference', 'frames', 'image'] as const).flatMap((k) => {
      const refs = inputs[k];
      return refs ? [[k, refs.map((r) => fileHash(e, r, project, dry))]] : [];
    }),
  );
  const pick = (keep: boolean) => Object.fromEntries(Object.entries({ ...e, ...files }).filter(([k]) => k !== 'name' && GEN_KEYS.includes(k) === keep));
  return { gen: sha(JSON.stringify(stable({ kind: e.kind, ...pick(true) }))), post: sha(JSON.stringify(stable(pick(false)))) };
}

const refToInput = (e: Entry, r: string, project: string, dry: boolean) => {
  if (/^(https?:|data:)/.test(r)) return r;
  if (!existsSync(join(project, r))) {
    if (dry) return `<not generated yet: ${r}>`;
    throw missingRef(e, r);
  }
  const ext = extname(r).slice(1).toLowerCase();
  return `data:${MIME[ext] ?? 'application/octet-stream'};base64,${readFileSync(join(project, r)).toString('base64')}`;
};

async function download(url: string, file: string): Promise<void> {
  if (url.startsWith('data:')) return writeFileSync(file, Buffer.from(url.split(',')[1] ?? '', 'base64'));
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${url}: HTTP ${res.status}`);
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
}

const probeDuration = (f: string): number | null => {
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f], { encoding: 'utf8' });
  return r.status === 0 ? Number(r.stdout.trim()) : null;
};
const maxVolume = (f: string): number | null => {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-i', f, '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' });
  const m = r.stderr.match(/max_volume:\s*(-?[\d.]+) dB/);
  return m?.[1] ? Number(m[1]) : null;
};

// Blender, for 3D preview sheets (optional): BLENDER env, `blender` on PATH, or the macOS app bundle
let blenderBin: string | null | undefined;
const findBlender = () =>
  (blenderBin ??= [process.env.BLENDER, 'blender', '/Applications/Blender.app/Contents/MacOS/Blender'].find((b) => b && spawnSync(b, ['--version'], { stdio: 'ignore' }).status === 0) ?? null);
/**
 * Render a GLB's 2x2 axis-view sheet with preview_glb.py. Returns { tris, size } or null without Blender.
 * Async on purpose: Blender can take a minute, and a blocked event loop leaves fetch's keep-alive sockets
 * stale (the server closes them meanwhile), so the next API request would fail with "fetch failed".
 */
export async function preview3d(glb: string, png: string): Promise<{ tris: number; size: number[] } | null> {
  const b = findBlender();
  if (!b) return null;
  const script = join(dirname(fileURLToPath(import.meta.url)), 'preview_glb.py');
  const r = await new Promise<{ status: number | null; stdout: string; stderr: string }>((done, fail) => {
    const p = spawn(b, ['-b', '--factory-startup', '--python-exit-code', '1', '-P', script, '--', glb, png]);
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (d: Buffer) => (stdout += d));
    p.stderr.on('data', (d: Buffer) => (stderr += d));
    p.on('error', fail);
    p.on('close', (status) => done({ status, stdout, stderr }));
  });
  const line = r.stdout.split('\n').find((l) => l.startsWith('PREVIEW '));
  if (r.status !== 0 || !line) throw new Error(`preview_glb.py ${glb} failed:\n${(r.stderr || r.stdout).slice(-1500)}`);
  return JSON.parse(line.slice(8)) as { tris: number; size: number[] };
}

/** One PNG of `n` evenly spaced frames (4 per row): the agent's way to "watch" a generated clip. */
export function contactSheet(src: string, png: string, n = 8): string {
  const d = probeDuration(src) || 5;
  mkdirSync(dirname(png), { recursive: true });
  ffmpeg(['-i', src, '-vf', `fps=${(n / d).toFixed(5)},scale=320:-2,tile=4x${Math.ceil(n / 4)}:padding=4:color=white`, '-frames:v', '1', png]);
  return png;
}

const waveform = (src: string, png: string) => {
  ffmpeg(['-i', src, '-filter_complex', 'aformat=channel_layouts=mono,showwavespic=s=640x120:colors=#e4572e', '-frames:v', '1', png]);
  return png;
};
/** Float PCM of an audio file (via ffmpeg): mono, or interleaved with channels = 2. */
export function decodePcm(src: string, rate = 44100, channels = 1): Float32Array {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', src, '-f', 'f32le', '-ac', String(channels), '-ar', String(rate), '-'], { maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error(`ffmpeg decode ${src}: ${r.stderr}`);
  return new Float32Array(r.stdout.buffer.slice(r.stdout.byteOffset, r.stdout.byteOffset + r.stdout.length));
}

/** 32-bit float WAV from interleaved samples. */
export function writeWav(file: string, samples: Float32Array, rate = 44100, channels = 1): void {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + samples.length * 4, 4);
  h.write('WAVEfmt ', 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(3, 20); // IEEE float
  h.writeUInt16LE(channels, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * channels * 4, 28);
  h.writeUInt16LE(channels * 4, 32);
  h.writeUInt16LE(32, 34);
  h.write('data', 36);
  h.writeUInt32LE(samples.length * 4, 40);
  writeFileSync(file, Buffer.concat([h, Buffer.from(samples.buffer, samples.byteOffset, samples.length * 4)]));
}

/**
 * Find a seamless loop of `beats` beats in a mono track asked for at `bpm`: the start (after `skip` s) and exact
 * length whose seam (the music around start+length vs around start) matches best. Generated music runs up to ~6%
 * off the asked tempo, so the real tempo is estimated first (onset autocorrelation over many beats), then the
 * length is searched within ±tolerance of `beats` at that tempo. Coarse pass: Pearson correlation of 10 ms log-energy
 * envelopes over a few seconds, nudged towards starts on an onset (a downbeat sounds like a beginning). Fine pass:
 * the length to the sample, by waveform correlation across the seam.
 * Returns { start, length } in samples and score 0..1 (≥ 0.8: clean seam; < 0.5: regenerate or change bars).
 */
export function findLoop(
  pcm: Float32Array,
  rate: number,
  { beats, bpm, skip = 2, search = 8, tolerance = 0.012, tail = 3 }: { beats: number; bpm: number; skip?: number; search?: number; tolerance?: number; tail?: number },
): { start: number; length: number; score: number; waveScore: number; bpm: number } {
  // indices below stay inside the arrays by construction; `at` reads without the undefined check
  const at = (a: Float32Array, i: number) => a[i]!;
  const hop = Math.round(rate / 100);
  const env = new Float32Array(Math.floor(pcm.length / hop));
  for (let k = 0; k < env.length; k++) {
    let s = 0;
    for (let j = k * hop; j < (k + 1) * hop; j++) s += at(pcm, j) ** 2;
    env[k] = Math.log10(s / hop + 1e-9);
  }
  const onset = env.map((v, k) => (k ? Math.max(0, v - at(env, k - 1)) : 0));
  const onsetMax = onset.reduce((m, v) => Math.max(m, v), 1e-9);
  // tempo: autocorrelation of the onset signal at 1..16 beat lags, for tempi within ±8% of the asked one
  let tempo = { bpm, s: -1 };
  for (let b = bpm * 0.92; b <= bpm * 1.08; b += 0.05) {
    let s = 0;
    for (let k = 1; k <= 16; k++) {
      const lag = Math.round((k * 6000) / b);
      for (let i = 0; i + lag < onset.length; i += 1) s += at(onset, i) * at(onset, i + lag);
    }
    if (s > tempo.s) tempo = { bpm: b, s };
  }
  const seconds = (beats * 60) / tempo.bpm;
  const T = Math.round(seconds * 100);
  const [lo, hi] = [Math.floor(T * (1 - tolerance)), Math.ceil(T * (1 + tolerance))];
  const W = Math.min(400, T); // compare up to 4 s of envelope
  const first = Math.round(skip * 100);
  const last = Math.min(first + search * 100, env.length - Math.round(tail * 100) - hi - W);
  if (last < first) throw new Error(`track is ${(pcm.length / rate).toFixed(1)} s: too short for a ${seconds.toFixed(1)} s loop after skip ${skip} s (raise duration or lower bars)`);
  const corr = (a: number, b: number) => {
    let [sa, sb, saa, sbb, sab] = [0, 0, 0, 0, 0];
    for (let i = 0; i < W; i++) {
      const x = at(env, a + i);
      const y = at(env, b + i);
      sa += x;
      sb += y;
      saa += x * x;
      sbb += y * y;
      sab += x * y;
    }
    const v = (saa - (sa * sa) / W) * (sbb - (sb * sb) / W);
    return v > 0 ? (sab - (sa * sb) / W) / Math.sqrt(v) : 0;
  };
  let best = { score: -2, corr: 0, a: first, L: lo };
  for (let a = first; a <= last; a++) {
    const bonus = 0.1 * (at(onset, a) / onsetMax);
    for (let L = lo; L <= hi; L++) {
      // the music before the seam (start + L - W .. start + L) must match the music before the start, and after
      const c = (corr(a + L, a) + corr(a + L - Math.min(W, a), a - Math.min(W, a))) / 2;
      if (c + bonus > best.score) best = { score: c + bonus, corr: c, a, L };
    }
  }
  // fine: the length to the sample, so the waveform runs on across the seam
  const start = best.a * hop;
  const N = Math.min(Math.round(rate * 0.05), start);
  let fine = { c: -2, len: best.L * hop };
  for (let d = -hop; d <= hop; d++) {
    const len = best.L * hop + d;
    let [sxy, sxx, syy] = [0, 0, 0];
    for (let i = -N; i < N; i++) {
      const x = at(pcm, start + i);
      const y = at(pcm, start + len + i);
      sxy += x * y;
      sxx += x * x;
      syy += y * y;
    }
    const c = sxy / Math.sqrt(sxx * syy + 1e-12);
    if (c > fine.c) fine = { c, len };
  }
  return { start, length: fine.len, score: Number(Math.max(0, best.corr).toFixed(3)), waveScore: Number(fine.c.toFixed(3)), bpm: Number((((beats * 60) / fine.len) * rate).toFixed(2)) };
}

/** Cut [start, start+length) of interleaved PCM into a loop; the first `fade` samples blend in what follows the end. */
export function cutLoop(pcm: Float32Array, channels: number, start: number, length: number, fade: number): Float32Array {
  const out = new Float32Array(length * channels);
  for (let i = 0; i < length; i++) {
    const w = i < fade ? i / fade : 1;
    for (let c = 0; c < channels; c++) {
      const a = pcm[(start + i) * channels + c] ?? 0;
      const b = i < fade ? (pcm[(start + length + i) * channels + c] ?? 0) : 0;
      out[i * channels + c] = a * w + b * (1 - w);
    }
  }
  return out;
}

const volumeStats = (f: string) => {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-i', f, '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' });
  return { mean: Number(r.stderr.match(/mean_volume:\s*(-?[\d.]+) dB/)?.[1] ?? -20), peak: Number(r.stderr.match(/max_volume:\s*(-?[\d.]+) dB/)?.[1] ?? 0) };
};

/** Music: cut a seamless loop (or trim a one-shot), set loudness, encode MP3 + the loop sidecar for audio.js. */
function finaliseMusic(e: MusicEntry, src: string, out: string, project: string): FinaliseInfo {
  const rate = 44100;
  const pcm = decodePcm(src, rate, 2);
  const frames = pcm.length / 2;
  const info: FinaliseInfo = {};
  let cut: Float32Array;
  if (e.loop) {
    const mono = new Float32Array(frames);
    for (let i = 0; i < frames; i++) mono[i] = ((pcm[2 * i] ?? 0) + (pcm[2 * i + 1] ?? 0)) / 2;
    const l = findLoop(mono, rate, { beats: e.bars * e.beatsPerBar, bpm: e.bpm, skip: e.skip });
    cut = cutLoop(pcm, 2, l.start, l.length, Math.round(e.crossfade * rate));
    Object.assign(info, { loop: [Number((l.start / rate).toFixed(4)), Number(((l.start + l.length) / rate).toFixed(4))], seam: l.score, tempo: l.bpm });
    if (l.score < 0.5) console.warn(`  ! music.${e.name}: weak loop seam (score ${l.score}); listen to it, or regenerate / change bars`);
  } else {
    const [s, end] = loudSpan(decodePcm(src, rate), rate, 40);
    const stop = Math.min(end, e.maxDuration ? s + e.maxDuration : end);
    const [a, b] = [Math.floor(s * rate), Math.floor(stop * rate)];
    cut = pcm.slice(a * 2, b * 2);
    const fade = Math.min(Math.round(1.5 * rate), Math.floor((b - a) / 3));
    for (let i = 0; i < fade; i++) for (let c = 0; c < 2; c++) cut[(b - a - fade + i) * 2 + c]! *= 1 - i / fade;
    info.trim = [Number(s.toFixed(3)), Number(stop.toFixed(3))];
  }
  const tmp = `${src}.loop.wav`;
  writeWav(tmp, cut, rate, 2);
  const v = volumeStats(tmp);
  const gain = Math.min(e.level - v.mean, -1 - v.peak);
  ffmpeg(['-i', tmp, '-af', `volume=${gain.toFixed(2)}dB`, '-c:a', 'libmp3lame', '-q:a', '4', out]);
  rmSync(tmp);
  const samples = cut.length / 2;
  const meta = { loop: e.loop, samples, rate, seconds: Number((samples / rate).toFixed(4)), bpm: info.tempo ?? e.bpm, beatsPerBar: e.beatsPerBar, bars: e.loop ? e.bars : undefined };
  writeFileSync(out.replace(/\.mp3$/, '.json'), `${JSON.stringify(meta)}\n`);
  info.duration = meta.seconds;
  info.waveform = relative(project, waveform(out, join(project, '.lab', 'media', `${e.name}.png`)));
  return info;
}

/**
 * [start, end] seconds of the "event" in a clip: the span whose 10 ms RMS is within trimDb of the loudest window.
 * RMS (not sample peaks) so a hissy noise floor doesn't count as signal.
 */
export function loudSpan(pcm: Float32Array, rate = 44100, trimDb = 18): [number, number] {
  const win = Math.round(rate / 100);
  const db: number[] = [];
  for (let i = 0; i + win <= pcm.length; i += win) {
    let sum = 0;
    for (let j = i; j < i + win; j++) sum += (pcm[j] ?? 0) ** 2;
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
export async function finalise(e: Entry, src: string, project: string): Promise<FinaliseInfo> {
  const dir = join(project, e.dir ?? OUT_DIR[e.kind]);
  mkdirSync(dir, { recursive: true });
  const out = join(dir, `${e.name}.${e.out}`);
  // format changed: drop the old output. Outside public/ (design/reference/ holds hand-made refs too) only old
  // generated videos are removed; a stale image there stays rather than risk deleting the user's key art.
  const shared = !(e.dir ?? OUT_DIR[e.kind]).startsWith('public');
  for (const f of readdirSync(dir)) if (f.startsWith(`${e.name}.`) && join(dir, f) !== out && !(e.kind === 'music' && f === `${e.name}.json`) && (!shared || (e.kind === 'videos' && VIDEO_EXT.test(f)))) rmSync(join(dir, f));
  const info: FinaliseInfo = {};
  if (e.kind === 'models') {
    copyFileSync(src, out);
    const p = await preview3d(out, join(project, '.lab', 'media', `${e.name}.png`));
    if (p) Object.assign(info, { tris: p.tris, size: p.size, sheet: relative(project, join(project, '.lab', 'media', `${e.name}.png`)) });
    else console.warn(`  ! Blender not found: no preview sheet for models.${e.name}`);
  } else if (e.kind === 'videos') {
    if (hasFfmpeg()) {
      // remux only (no re-encode): drop the soundtrack unless asked, move the index up front for quick seeking
      ffmpeg(['-i', src, '-map', '0:v:0', ...(e.audio ? ['-map', '0:a?'] : ['-an']), '-c', 'copy', ...(e.out === 'webm' ? [] : ['-movflags', '+faststart']), out]);
      info.duration = probeDuration(out);
      info.sheet = relative(project, contactSheet(out, join(project, '.lab', 'media', `${e.name}.png`)));
    } else {
      copyFileSync(src, out);
      console.warn(`  ! ffmpeg not found: videos.${e.name} copied as delivered (audio kept, no contact sheet)`);
    }
  } else if (e.kind === 'music') {
    if (!hasFfmpeg()) throw new Error(`music.${e.name}: needs ffmpeg on PATH (loop cutting + MP3 encoding)`);
    Object.assign(info, finaliseMusic(e, src, out, project));
  } else if (e.kind === 'images') {
    if (e.resize) {
      if (!hasFfmpeg()) throw new Error(`images.${e.name}: "resize" needs ffmpeg on PATH`);
      const [w, h] = ([] as number[]).concat(e.resize);
      ffmpeg(['-i', src, '-vf', `scale=${w}:${h ?? w}:force_original_aspect_ratio=decrease:flags=lanczos`, '-frames:v', '1', out]);
    } else copyFileSync(src, out);
  } else if (hasFfmpeg()) {
    // e.kind === 'sfx' from here on
    // Text-to-SFX models pad clips with a noise floor and often place the event late. A game sound must start at
    // t=0, so trim to the span louder than (peak - trimDb), cap at maxDuration, fade the edges, peak-normalise.
    const duration = probeDuration(src) ?? e.duration;
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
export async function main(argv = process.argv.slice(2)): Promise<{ lock: Lock; spent?: number; requests?: number }> {
  const opt = (n: string, d: string): string => (argv.indexOf(n) >= 0 ? (argv[argv.indexOf(n) + 1] ?? d) : d);
  const valued = new Set(['--project', '--spec', '--pick']);
  const project = resolve(opt('--project', '.'));
  const specPath = join(project, opt('--spec', 'design/media.json'));
  const lockPath = join(project, 'assets', 'media.lock.json');
  const force = argv.includes('--force');
  const dry = argv.includes('--dry-run');
  const picks = argv.flatMap((a, i) => (argv[i - 1] === '--pick' ? [a] : []));
  const only = argv.filter((a, i) => !a.startsWith('--') && !valued.has(argv[i - 1] ?? ''));

  if (!existsSync(specPath)) throw new Error(`no spec at ${relative(project, specPath)} (see the generate-media skill)`);
  const spec = JSON.parse(readFileSync(specPath, 'utf8')) as { provider?: string } & Partial<Record<Kind, Record<string, RawEntry>>>;
  const provider = PROVIDERS[spec.provider ?? 'runware'];
  if (!provider) throw new Error(`unknown provider "${spec.provider}" (have: ${Object.keys(PROVIDERS).join(', ')})`);
  const lock: Lock = existsSync(lockPath) ? (JSON.parse(readFileSync(lockPath, 'utf8')) as Lock) : {};
  const saveLock = () => {
    mkdirSync(dirname(lockPath), { recursive: true });
    writeFileSync(lockPath, `${JSON.stringify(stable(lock), null, 2)}\n`);
  };
  const entries: Entry[] = KINDS.flatMap((kind) => Object.entries(spec[kind] ?? {}).map(([name, raw]): Entry => normalise(kind, name, raw, provider.name)));
  const names = new Set(entries.map((e) => e.name));
  if (names.size !== entries.length) throw new Error('entry names must be unique across images, sfx, music, videos and models');
  for (const n of only) if (!names.has(n)) throw new Error(`no entry "${n}" in ${relative(project, specPath)}`);

  // --pick name=i: promote a reviewed candidate
  for (const p of picks) {
    const [name = '', idx] = p.split('=');
    const e = entries.find((x) => x.name === name);
    const l = lock[name];
    if (!e || !l?.candidates) throw new Error(`--pick ${p}: no pending candidates for "${name}" (generate first)`);
    const src = l.candidates[Number(idx)];
    if (!src || !existsSync(join(project, src))) throw new Error(`--pick ${p}: candidate ${idx} not found (have 0..${l.candidates.length - 1})`);
    Object.assign(l, await finalise(e, join(project, src), project), { picked: Number(idx), seed: l.seeds?.[Number(idx)], post: specHash(e, project).post });
    // music: show the seam and tempo here too, so candidates can be compared by picking each in turn
    const loopInfo = l.seam === undefined ? '' : ` (loop seam ${l.seam}, ${l.tempo} BPM)`;
    console.log(`✓ ${name}: picked candidate ${idx} → ${l.file}${loopInfo}`);
    saveLock();
  }
  if (picks.length) return { lock };

  let spent = 0;
  let requests = 0;
  for (const e of entries) {
    if (only.length && !only.includes(e.name)) continue;
    const { gen, post } = specHash(e, project, dry);
    const l = lock[e.name];
    const label = `${e.kind}.${e.name}`;
    const have = (f: string | undefined): f is string => !!f && existsSync(join(project, f));
    if (!force && l?.hash === gen) {
      if (l.post === post && have(l.file)) {
        console.log(`= ${label}: unchanged (${l.file})`);
        continue;
      }
      const pickedFile = l.picked !== undefined ? l.candidates?.[l.picked] : undefined;
      if (have(pickedFile)) {
        Object.assign(l, await finalise(e, join(project, pickedFile), project), { post });
        console.log(`↻ ${label}: re-processed cached candidate ${l.picked} → ${l.file} (no request)`);
        saveLock();
        continue;
      }
      if (l.picked === undefined && l.candidates?.every((c) => have(c))) {
        console.log(`… ${label}: ${l.candidates.length} candidates waiting for review: ${l.candidates.join(' ')}\n  pick one with --pick ${e.name}=<i>`);
        continue;
      }
    }
    const inputs = (refs: string[]) => refs.map((r) => refToInput(e, r, project, dry));
    const task =
      e.kind === 'images'
        ? provider.imageTask(e, inputs(e.reference))
        : e.kind === 'videos'
          ? provider.videoTask(e, inputs(e.frames), inputs(e.reference))
          : e.kind === 'models'
            ? provider.modelTask(e, inputs(e.image))
            : e.kind === 'sfx'
              ? provider.audioTask(e)
              : provider.musicTask(e);
    const est = (EST_COST[e.model]?.(e) ?? NaN) * e.candidates;
    if (dry) {
      const short = (r: string) => (r.startsWith('data:') ? `${r.slice(0, 32)}… (${r.length} chars)` : r);
      const shown = { ...task, inputs: task.inputs && Object.fromEntries(Object.entries(task.inputs).map(([k, v]) => [k, Array.isArray(v) ? v.map(short) : short(v)])) };
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
    const rawExt = e.kind === 'sfx' || e.kind === 'music' ? (task.outputFormat ?? 'mp3').toLowerCase() : e.format;
    const candidates: string[] = [];
    for (const [i, r] of results.entries()) {
      const f = join(candDir, `${i}.${rawExt}`);
      await download(r.url, f);
      candidates.push(relative(project, f));
      if (results.length > 1 && e.kind === 'models') await preview3d(f, f.replace(/\.\w+$/, '.png'));
      else if (hasFfmpeg() && results.length > 1 && e.kind !== 'images') (e.kind === 'sfx' || e.kind === 'music' ? waveform : contactSheet)(f, f.replace(/\.\w+$/, '.png'));
    }
    const cost = results.reduce((s, r) => s + (r.cost ?? 0), 0) || (Number.isNaN(est) ? 0 : est);
    spent += cost;
    const l2: LockEntry = { kind: e.kind, hash: gen, post, model: e.model, provider: provider.name, cost: Number(cost.toFixed(5)), seeds: results.map((r) => r.seed), candidates };
    lock[e.name] = l2;
    const [only1] = candidates;
    if (only1 !== undefined && candidates.length === 1) {
      Object.assign(l2, await finalise(e, join(project, only1), project), { picked: 0, seed: results[0]?.seed });
      console.log(`✓ ${label} → ${l2.file} (${((l2.bytes ?? 0) / 1024).toFixed(1)} KB${l2.duration ? `, ${l2.duration.toFixed(2)} s` : ''}${l2.seam !== undefined ? `, loop seam ${l2.seam}, ${l2.tempo} BPM` : ''})${l2.waveform ? ` waveform: ${l2.waveform}` : ''}${l2.tris ? `, ${l2.tris} tris, ${(l2.size ?? []).join('×')} m as delivered` : ''}${l2.sheet ? ` sheet: ${l2.sheet}` : ''}`);
    } else console.log(`… ${label}: review ${candidates.join(' ')}\n  then: --pick ${e.name}=<i>`);
    saveLock();
  }
  console.log(`${dry ? 'estimated' : 'spent'} ~$${spent.toFixed(4)} (${dry ? 'dry run, nothing called' : `${requests} request(s)`})`);
  return { lock, spent, requests };
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err: unknown) => {
    console.error(`✗ ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
