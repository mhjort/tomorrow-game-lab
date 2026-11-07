// Level streaming: only the first level is downloaded and prewarmed behind the loading screen, so play starts
// sooner. Later levels download and compile in the background while the player plays (prefetch), or on demand
// behind a short "Loading…" card if the player gets there first.
//
//   const levels = createLevels(LEVELS, { audio });   // LEVELS: [{ models: ['level1'], music: ['forest'] }, ...]
//   // download phase: shared assets (player, common sfx) + ONLY the first level
//   await loading.parallel('Loading…', [ ..., { weight: 0.3, run: (p) => levels.download(first, p) } ]);
//   // after scene + applyStyle (lights exist):
//   levels.attach(renderer, scene, camera);
//   await loading.step('Compiling shaders', 0.3, (p) => levels.prewarm(first, p));   // full prewarm, incl. shadows
//   ...
//   levels.prefetch(first + 1);                       // when a level starts: get the next one ready in the background
//   // level change:
//   if (levels.isReady(i)) build(levels.models(i));   // instant
//   else { showLoadingCard(); await levels.load(i, (p) => card(p)); build(levels.models(i)); }
//
// Levels may share assets (a model or track listed in two levels is downloaded once). Assets every level needs
// (player, common sounds) stay in the boot download phase. Release builds read design/levels.json (if present)
// and do not add preload hints for assets only later levels use, so they don't compete with level 1's bandwidth.
import type * as THREE from 'three/webgpu';
import { loadModels, type Progress } from './assets.ts';
import type { Audio } from './audio.ts';
import { compileInBackground, prewarm } from './loading.ts';

/** What one level needs: GLB names (public/models/), sound effects (public/sfx/) and music (public/music/). */
export interface LevelAssets {
  models?: readonly string[];
  sfx?: readonly string[];
  music?: readonly string[];
}

/** idle → downloading → downloaded → compiling → ready (or failed). */
export type LevelStatus = 'idle' | 'downloading' | 'downloaded' | 'compiling' | 'ready' | 'failed';

export interface Levels {
  readonly count: number;
  /** Download level i (models parsed, audio decoded). Cached: repeat calls share one promise. */
  download(i: number, onProgress?: Progress): Promise<void>;
  /** Give the loader the renderer, the live scene (its lights and fog are used to compile) and the camera. */
  attach(renderer: THREE.WebGPURenderer, scene: THREE.Scene, camera: THREE.Camera): void;
  /** Download + full prewarm (renders warm-up frames, covers shadows). Only behind the loading screen. */
  prewarm(i: number, onProgress?: Progress): Promise<void>;
  /** Download + background compile; nothing is drawn, the game keeps running. Cached like download(). */
  load(i: number, onProgress?: Progress): Promise<void>;
  /** load(i) without waiting (no-op when out of range or already started). Failures are logged. */
  prefetch(i: number): void;
  isReady(i: number): boolean;
  status(i: number): LevelStatus;
  /** Statuses of every level (for getState()). */
  statuses(): LevelStatus[];
  /** Level i's model instances by name (cloned once; reused when the level is played again). Throws if not downloaded. */
  models(i: number): Record<string, THREE.Object3D>;
}

interface Slot {
  status: LevelStatus;
  progress: number;
  listeners: Set<Progress>;
  download?: Promise<void>;
  ready?: Promise<void>;
  models?: Record<string, THREE.Object3D>;
}

const DOWNLOAD_SHARE = 0.85; // of a level's progress bar; the rest is shader compilation

export function createLevels(levels: readonly LevelAssets[], { audio }: { audio?: Audio } = {}): Levels {
  const slots: Slot[] = levels.map(() => ({ status: 'idle', progress: 0, listeners: new Set() }));
  let gpu: { renderer: THREE.WebGPURenderer; scene: THREE.Scene; camera: THREE.Camera } | null = null;

  const slot = (i: number): Slot => {
    const s = slots[i];
    if (!s) throw new Error(`levels: no level ${i} (have ${slots.length})`);
    return s;
  };
  const report = (s: Slot, p: number) => {
    s.progress = Math.max(s.progress, Math.min(1, p));
    for (const l of s.listeners) l(s.progress);
  };
  /** Run `work` with onProgress subscribed to the slot's progress for as long as it takes. */
  const watch = async (s: Slot, onProgress: Progress | undefined, work: Promise<void>): Promise<void> => {
    if (!onProgress) return work;
    s.listeners.add(onProgress);
    onProgress(s.progress);
    try {
      await work;
    } finally {
      s.listeners.delete(onProgress);
    }
  };
  const fail = (s: Slot) => (e: unknown) => {
    s.status = 'failed';
    throw e;
  };
  const needGpu = () => {
    if (!gpu) throw new Error('levels: call attach(renderer, scene, camera) before prewarm/load');
    return gpu;
  };

  function startDownload(i: number): Promise<void> {
    const s = slot(i);
    if (s.download) return s.download;
    const lv = levels[i]!;
    if ((lv.sfx?.length || lv.music?.length) && !audio) throw new Error(`levels: level ${i} has audio but createLevels got no audio`);
    s.status = 'downloading';
    const parts = [0, 0, 0];
    const part = (k: number) => (p: number) => {
      parts[k] = p;
      report(s, (DOWNLOAD_SHARE * (parts[0]! + parts[1]! + parts[2]!)) / 3);
    };
    s.download = Promise.all([
      loadModels(lv.models ?? [], part(0)),
      lv.sfx?.length ? audio!.load(lv.sfx, part(1)) : part(1)(1),
      lv.music?.length ? audio!.loadMusic(lv.music, part(2)) : part(2)(1),
    ]).then(([models]) => {
      s.models = models;
      s.status = 'downloaded';
    }, fail(s));
    return s.download;
  }

  function startReady(i: number, compile: (roots: THREE.Object3D[], p: Progress) => Promise<void>): Promise<void> {
    const s = slot(i);
    s.ready ??= startDownload(i)
      .then(() => {
        s.status = 'compiling';
      })
      .then(() => compile(Object.values(s.models ?? {}), (p) => report(s, DOWNLOAD_SHARE + (1 - DOWNLOAD_SHARE) * p)))
      .then(() => {
        s.status = 'ready';
        report(s, 1);
      }, fail(s));
    return s.ready;
  }

  return {
    count: levels.length,
    download: (i, onProgress) => {
      const s = slot(i);
      // the download is the first 85% of the level's bar; scale it to 0..1 for the caller
      return watch(s, onProgress && ((p) => onProgress(Math.min(1, p / DOWNLOAD_SHARE))), startDownload(i));
    },
    attach(renderer, scene, camera) {
      gpu = { renderer, scene, camera };
    },
    prewarm(i, onProgress) {
      const { renderer, scene, camera } = needGpu();
      return watch(slot(i), onProgress, startReady(i, (roots, p) => prewarm(renderer, scene, camera, roots, p)));
    },
    load(i, onProgress) {
      const { renderer, scene, camera } = needGpu();
      return watch(
        slot(i),
        onProgress,
        startReady(i, async (roots, p) => {
          for (const [k, root] of roots.entries()) await compileInBackground(renderer, scene, camera, root, (q) => p((k + q) / roots.length));
        }),
      );
    },
    prefetch(i) {
      if (i < 0 || i >= slots.length || slot(i).ready) return;
      this.load(i).catch((e: unknown) => console.error(`levels: loading level ${i} failed`, e));
    },
    isReady: (i) => slot(i).status === 'ready',
    status: (i) => slot(i).status,
    statuses: () => slots.map((s) => s.status),
    models(i) {
      const m = slot(i).models;
      if (!m) throw new Error(`levels: level ${i} is not downloaded (status ${slot(i).status})`);
      return m;
    },
  };
}
