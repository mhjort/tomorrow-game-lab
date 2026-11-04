// Sound effects: parallel download with byte progress, decoded before play, WebAudio playback.
// Files live in public/sfx/<name>.mp3 (made by the generate-media skill).
//
//   const audio = createAudio();
//   await loading.parallel('Loading…', [ ..., { weight: 0.1, run: (p) => audio.load(['putt', 'cup'], p) } ]);
//   audio.play('putt', { volume: 0.8, rate: 1.05 });
//
// Browsers only start audio after a user gesture, so the AudioContext is created on the first pointer/key event
// (no autoplay console warning); clips are decoded up front with an OfflineAudioContext. In ?test mode nothing is
// audible, but play() still counts, so scenarios can assert on `audio.counts` via getState().
import { fetchBytes, assetSize } from './assets.js';
import { TEST_MODE } from './renderer.js';

const BASE = import.meta.env.BASE_URL;

export function createAudio({ volume = 0.8, ext = 'mp3' } = {}) {
  const buffers = new Map();
  const counts = {};
  let ctx = null;
  let master = null;
  let muted = false;

  const unlock = () => {
    if (TEST_MODE) return;
    if (!ctx) {
      ctx = new AudioContext();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : volume;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume(); // iOS can re-suspend; keep listening
  };
  addEventListener('pointerdown', unlock, { capture: true });
  addEventListener('keydown', unlock, { capture: true });

  return {
    counts,
    /** Download + decode clips in parallel. onProgress(0..1) is byte-based in release builds (asset-manifest). */
    async load(names, onProgress = () => {}) {
      const decoder = new OfflineAudioContext(1, 1, 44100);
      const paths = names.map((n) => `sfx/${n}.${ext}`);
      const sizes = await Promise.all(paths.map(assetSize));
      const total = sizes.reduce((s, b) => s + b, 0);
      const loaded = names.map(() => 0);
      let decoded = 0;
      const report = () =>
        onProgress(total ? 0.9 * (loaded.reduce((s, b, i) => s + Math.min(b, sizes[i]), 0) / total) + 0.1 * (decoded / names.length) : decoded / names.length);
      await Promise.all(
        names.map(async (n, i) => {
          const bytes = await fetchBytes(`${BASE}${paths[i]}`, (b) => ((loaded[i] = b), report()));
          buffers.set(n, await decoder.decodeAudioData(bytes));
          decoded++;
          report();
        }),
      );
    },
    /** Fire-and-forget one-shot. volume 0..1 (relative to master), rate = playback speed / pitch. */
    play(name, { volume: v = 1, rate = 1 } = {}) {
      if (!buffers.has(name)) throw new Error(`audio: "${name}" was not loaded`);
      counts[name] = (counts[name] ?? 0) + 1;
      if (!ctx || ctx.state !== 'running' || muted) return;
      const src = ctx.createBufferSource();
      src.buffer = buffers.get(name);
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
      muted = !!m;
      if (master) master.gain.value = muted ? 0 : volume;
    },
  };
}
