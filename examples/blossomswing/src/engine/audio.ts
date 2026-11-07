// Sound effects and music: parallel download with byte progress, decoded before play, WebAudio playback.
// Files live in public/sfx/<name>.mp3 and public/music/<name>.mp3 + <name>.json (made by the generate-media skill;
// the JSON holds the loop length, so loops are seamless even where a decoder keeps the MP3 encoder padding).
//
//   const audio = createAudio();
//   await loading.parallel('Loading…', [ ..., { weight: 0.1, run: (p) => audio.load(['putt', 'cup'], p) },
//                                              { weight: 0.2, run: (p) => audio.loadMusic(['theme'], p) } ]);
//   audio.play('putt', { volume: 0.8, rate: 1.05 });
//   audio.playMusic('theme');        // from a gameplay event in update(); starts on the first gesture if needed
//
// Browsers only start audio after a user gesture, so the AudioContext is created on the first pointer/key event
// (no autoplay console warning); clips are decoded up front with an OfflineAudioContext. In ?test mode nothing is
// audible, but play() still counts and `audio.music` names the track that would play, so scenarios can assert on
// `audio.counts` and `audio.music` via getState().
import { fetchBytes, assetSize, type Progress } from './assets.ts';
import { TEST_MODE } from './renderer.ts';

const BASE = import.meta.env.BASE_URL;

/** generate-media music sidecar (public/music/<name>.json). */
export interface MusicMeta {
  loop: boolean;
  samples?: number;
  rate?: number;
  bpm?: number;
  beatsPerBar?: number;
  seconds?: number;
}

export interface TrackInfo {
  bpm: number | undefined;
  beatsPerBar: number | undefined;
  seconds: number | undefined;
  loopStart: number;
  loopEnd: number;
  decoded: number;
}

export interface Audio {
  counts: Record<string, number>;
  /** Download + decode clips in parallel. onProgress(0..1) is byte-based in release builds (asset-manifest). */
  load(names: readonly string[], onProgress?: Progress): Promise<void>;
  /** Download + decode music tracks (public/music/<name>.mp3 and its loop sidecar <name>.json) in parallel. */
  loadMusic(names: readonly string[], onProgress?: Progress): Promise<void>;
  /** Switch the music (cross-fades; the same track again is a no-op, so call it every tick freely). */
  playMusic(name: string, opts?: { volume?: number; loop?: boolean }): void;
  stopMusic(): void;
  /** Name of the track that is (or, before the first gesture / in ?test, would be) playing, or null. */
  readonly music: string | null;
  /** { bpm, beatsPerBar, seconds, loopStart, loopEnd, decoded } of a loaded track (beat-synced effects, tests). */
  trackInfo(name: string): TrackInfo | undefined;
  /** Fire-and-forget one-shot. volume 0..1 (relative to master), rate = playback speed / pitch. */
  play(name: string, opts?: { volume?: number; rate?: number }): void;
  readonly muted: boolean;
  setMuted(m: boolean): void;
}

/**
 * [loopStart, loopEnd] seconds of a decoded music buffer. `meta` is the generate-media sidecar ({ loop, samples,
 * rate }). Chrome/Firefox drop the MP3 encoder delay (LAME header), so the buffer is exactly `samples` long; a
 * decoder that keeps it adds near-silence in front, which is skipped here.
 */
export function loopPoints(channel: Float32Array, sampleRate: number, meta: { samples: number; rate: number }): [number, number] {
  const len = Math.round((meta.samples * sampleRate) / meta.rate);
  const excess = channel.length - len;
  if (excess <= 0) return [0, channel.length / sampleRate];
  let d = 0;
  while (d < excess && Math.abs(channel[d] ?? 0) < 2e-3) d++;
  return [d / sampleRate, (d + len) / sampleRate];
}

interface Track {
  buffer: AudioBuffer;
  meta: MusicMeta;
  loop: [number, number];
}

export function createAudio({ volume = 0.8, musicVolume = 0.5, ext = 'mp3' } = {}): Audio {
  const buffers = new Map<string, AudioBuffer>();
  const tracks = new Map<string, Track>();
  const counts: Record<string, number> = {};
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let musicBus: GainNode | null = null;
  let muted = false;
  let music: { name: string; volume: number; loop: boolean | undefined } | null = null; // wanted track
  let playing: { name: string; src: AudioBufferSourceNode; gain: GainNode } | null = null;

  const unlock = () => {
    if (TEST_MODE) return;
    if (!ctx) {
      ctx = new AudioContext();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : volume;
      master.connect(ctx.destination);
      musicBus = ctx.createGain();
      musicBus.gain.value = musicVolume;
      musicBus.connect(master);
    }
    if (ctx.state === 'suspended') void ctx.resume().then(() => startMusic()); // iOS can re-suspend; keep listening
    else startMusic();
  };

  // bring the playing track in line with the wanted one (called on change and when the context unlocks)
  function startMusic(fade = 0.5): void {
    if (!ctx || ctx.state !== 'running' || !musicBus) return;
    if (playing && playing.name === music?.name) return;
    const now = ctx.currentTime;
    if (playing) {
      const old = playing;
      old.gain.gain.setTargetAtTime(0, now, fade / 4);
      old.src.stop(now + fade * 2);
      playing = null;
    }
    if (!music) return;
    const t = tracks.get(music.name);
    if (!t) return;
    const src = ctx.createBufferSource();
    src.buffer = t.buffer;
    src.loop = music.loop ?? t.meta.loop;
    [src.loopStart, src.loopEnd] = t.loop;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(music.volume, now + fade);
    src.connect(gain).connect(musicBus);
    src.start(now, t.loop[0]);
    if (!src.loop)
      src.onended = () => {
        if (playing?.src === src) {
          playing = null;
          music = null;
        }
      };
    playing = { name: music.name, src, gain };
  }

  async function fetchAll(paths: string[], onProgress: Progress, decodeEach: (i: number, bytes: ArrayBuffer) => Promise<void>): Promise<void> {
    const sizes = await Promise.all(paths.map(assetSize));
    const total = sizes.reduce((s, b) => s + b, 0);
    const loaded = paths.map(() => 0);
    let decoded = 0;
    const report = () =>
      onProgress(
        total
          ? 0.9 * (loaded.reduce((s, b, i) => s + Math.min(b, sizes[i] ?? b), 0) / total) + 0.1 * (decoded / paths.length)
          : decoded / paths.length,
      );
    await Promise.all(
      paths.map(async (p, i) => {
        const bytes = await fetchBytes(`${BASE}${p}`, (b) => ((loaded[i] = b), report()));
        await decodeEach(i, bytes);
        decoded++;
        report();
      }),
    );
  }
  addEventListener('pointerdown', unlock, { capture: true });
  addEventListener('keydown', unlock, { capture: true });

  return {
    counts,
    async load(names, onProgress = () => {}) {
      const decoder = new OfflineAudioContext(1, 1, 44100);
      await fetchAll(
        names.map((n) => `sfx/${n}.${ext}`),
        onProgress,
        async (i, bytes) => void buffers.set(names[i]!, await decoder.decodeAudioData(bytes)),
      );
    },
    async loadMusic(names, onProgress = () => {}) {
      const decoder = new OfflineAudioContext(2, 1, 44100);
      const metas = await Promise.all(
        names.map((n) => fetch(`${BASE}music/${n}.json`).then((r): Promise<MusicMeta> | MusicMeta => (r.ok ? r.json() : { loop: true }))),
      );
      await fetchAll(
        names.map((n) => `music/${n}.mp3`),
        onProgress,
        async (i, bytes) => {
          const buffer = await decoder.decodeAudioData(bytes);
          const meta = metas[i]!;
          const loop: [number, number] =
            meta.samples && meta.rate
              ? loopPoints(buffer.getChannelData(0), buffer.sampleRate, { samples: meta.samples, rate: meta.rate })
              : [0, buffer.duration];
          tracks.set(names[i]!, { buffer, meta, loop });
        },
      );
    },
    playMusic(name, { volume: v = 1, loop } = {}) {
      if (!tracks.has(name)) throw new Error(`audio: music "${name}" was not loaded`);
      if (music?.name === name) return;
      music = { name, volume: v, loop };
      startMusic();
    },
    stopMusic() {
      music = null;
      startMusic();
    },
    get music() {
      return music?.name ?? null;
    },
    trackInfo(name) {
      const t = tracks.get(name);
      return (
        t && {
          bpm: t.meta.bpm,
          beatsPerBar: t.meta.beatsPerBar,
          seconds: t.meta.seconds,
          loopStart: t.loop[0],
          loopEnd: t.loop[1],
          decoded: t.buffer.duration,
        }
      );
    },
    play(name, { volume: v = 1, rate = 1 } = {}) {
      const buffer = buffers.get(name);
      if (!buffer) throw new Error(`audio: "${name}" was not loaded`);
      counts[name] = (counts[name] ?? 0) + 1;
      if (!ctx || ctx.state !== 'running' || muted || !master) return;
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.playbackRate.value = rate;
      const gain = ctx.createGain();
      gain.gain.value = v;
      src.connect(gain).connect(master);
      src.start();
    },
    get muted() {
      return muted;
    },
    setMuted(m) {
      muted = m;
      if (master) master.gain.value = muted ? 0 : volume;
    },
  };
}
