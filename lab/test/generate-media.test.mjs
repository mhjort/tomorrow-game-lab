import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SKILLS, has, hasBlender, tmp, run } from './helpers.mjs';
import { cutLoop, decodePcm, findLoop, loudSpan, normalise, writeWav } from '../../skills/generate-media/scripts/generate-media.mjs';

const SCRIPT = join(SKILLS, 'generate-media/scripts/generate-media.mjs');

test('loudSpan: trims a hissy lead-in and tail to the event (RMS, not peaks)', () => {
  const rate = 44100;
  const pcm = new Float32Array(rate); // 1 s
  let seed = 1;
  const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.02; // ~ -45 dB hiss
  for (let i = 0; i < pcm.length; i++) pcm[i] = noise();
  for (let i = 0.6 * rate; i < 0.7 * rate; i++) pcm[i] += 0.8 * Math.sin(i / 5) * Math.exp(-(i - 0.6 * rate) / 1500);
  const [start, end] = loudSpan(pcm, rate, 18);
  assert.ok(Math.abs(start - 0.6) < 0.015, `start ${start}`);
  assert.ok(end > 0.6 && end < 0.75, `end ${end}`);
});

// A 4-bar riff (16 beats, a different pitch per beat) over a pad, at `bpm`, after 1 s of silence: stereo, interleaved.
function synthSong(bpm, seconds, rate = 44100) {
  const pcm = new Float32Array(Math.round(seconds * rate) * 2);
  const notes = [0, 4, 7, 12, 7, 4, 2, 5, 9, 5, 2, -1, 0, 7, 4, 0];
  const beat = 60 / bpm;
  for (let i = rate; i < pcm.length / 2; i++) {
    const t = i / rate - 1;
    const k = Math.floor(t / beat);
    const f = 440 * 2 ** (notes[k % 16] / 12);
    const v = 0.5 * Math.sin(2 * Math.PI * f * t) * Math.exp(-(t - k * beat) * 6) + 0.1 * Math.sin(2 * Math.PI * 110 * t);
    pcm[2 * i] = v;
    pcm[2 * i + 1] = 0.9 * v;
  }
  return pcm;
}

test('findLoop: finds the real tempo and a whole number of bars when the model drifts off the asked BPM', () => {
  const rate = 44100;
  const st = synthSong(117, 50); // asked for 112, played at 117 (+4.5%, as ACE-Step does)
  const mono = new Float32Array(st.length / 2).map((_, i) => (st[2 * i] + st[2 * i + 1]) / 2);
  const l = findLoop(mono, rate, { beats: 32, bpm: 112 });
  const want = (32 * 60 * rate) / 117;
  assert.ok(Math.abs(l.length - want) / want < 0.003, `length ${l.length} vs ${want}`);
  assert.ok(Math.abs(l.bpm - 117) < 0.4, `bpm ${l.bpm}`);
  assert.ok(l.start >= 2 * rate, 'skips the intro');
  assert.ok(l.score > 0.9, `seam score ${l.score}`);
  const loop = cutLoop(st, 2, l.start, l.length, Math.round(0.08 * rate));
  assert.equal(loop.length, l.length * 2);
  const step = Math.abs(loop[0] - loop[loop.length - 2]); // left channel across the seam
  assert.ok(step < 0.05, `seam jump ${step}`);
  assert.throws(() => findLoop(mono.slice(0, 20 * rate), rate, { beats: 32, bpm: 112 }), /too short/);
});

test('normalise: defaults and validation', () => {
  assert.equal(normalise('images', 'a', { prompt: 'x' }).model, 'google:nano-banana@2.1');
  assert.equal(normalise('images', 'a', { prompt: 'x', transparent: true }).model, 'openai:gpt-image@2.5-flare');
  assert.equal(normalise('images', 'a', { prompt: 'x', transparent: true }).out, 'png');
  assert.equal(normalise('sfx', 'a', { prompt: 'x' }).model, 'mirelo:1@1');
  const m = normalise('music', 'a', { prompt: 'x' });
  assert.deepEqual([m.model, m.out, m.loop, m.bpm, m.bars, m.duration, m.instrumental], ['runware:ace-step@v1.5-xl-turbo', 'mp3', true, 120, 8, 60, true]);
  assert.equal(normalise('music', 'a', { prompt: 'x', model: 'minimax:music@2.6' }).duration, undefined);
  assert.throws(() => normalise('music', 'a', { prompt: 'x', bpm: 10 }), /bpm/);
  assert.throws(() => normalise('images', 'a', {}), /prompt/);
  assert.throws(() => normalise('images', 'a', { prompt: 'x', resize: 64, out: 'webp' }), /resize/);
  assert.throws(() => normalise('images', 'a', { prompt: 'x', width: 512 }), /width and height/);
  assert.throws(() => normalise('sfx', 'a', { prompt: 'x', candidates: 5 }), /candidates/);
  const v = normalise('videos', 'a', { prompt: 'x', frames: 'k.png' });
  assert.deepEqual([v.model, v.duration, v.out, v.audio, v.dir, v.frames], ['minimax:h3@max', 5, 'mp4', false, 'design/reference', ['k.png']]);
  assert.throws(() => normalise('videos', 'a', { prompt: 'x', width: 1344, height: 768, resolution: '768p' }), /not both/);
  assert.throws(() => normalise('videos', 'a', { prompt: 'x', out: 'gif' }), /mp4, webm or mov/);
});

test('generate-media: missing key fails clearly', () => {
  const proj = tmp('media-nokey');
  mkdirSync(join(proj, 'design'));
  writeFileSync(join(proj, 'design/media.json'), JSON.stringify({ sfx: { a: { prompt: 'x' } } }));
  const env = { ...process.env };
  delete env.RUNWARE_API_KEY;
  const r = run(process.execPath, [SCRIPT], { cwd: proj, env });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /RUNWARE_API_KEY is not set/);
  const dry = run(process.execPath, [SCRIPT, '--dry-run'], { cwd: proj, env });
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /"taskType": "audioInference"/);
});

// Mock Runware: records tasks, answers with URLs to fixture files it serves itself. Video tasks behave like the
// real async API: the submit and the first poll answer `processing`, the next poll delivers the results.
async function mockRunware(files) {
  const requests = [];
  const videoPolls = new Map();
  const server = createServer((req, res) => {
    if (req.method === 'GET') {
      const f = files[req.url];
      res.writeHead(f ? 200 : 404).end(f);
      return;
    }
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const base = `http://127.0.0.1:${server.address().port}`;
      if (req.headers.authorization !== 'Bearer test-key') return res.writeHead(401).end(JSON.stringify({ errors: [{ message: 'bad key' }] }));
      const tasks = JSON.parse(body);
      requests.push(...tasks.filter((t) => t.taskType !== 'getResponse'));
      const data = tasks.flatMap((t) => {
        if (t.deliveryMethod === 'async') {
          videoPolls.set(t.taskUUID, { task: t, polls: 0 });
          return [{ taskType: t.taskType, taskUUID: t.taskUUID }];
        }
        if (t.taskType === 'getResponse') {
          const v = videoPolls.get(t.taskUUID);
          if (!v) return [];
          const tt = v.task.taskType;
          if (v.polls++ < 1) return [{ taskType: tt, taskUUID: t.taskUUID, status: 'processing', progress: 50 }];
          return Array.from({ length: v.task.numberResults }, (_, i) =>
            tt === '3dInference'
              ? { taskType: tt, taskUUID: t.taskUUID, status: 'success', seed: 400 + i, cost: 0.3, outputs: { files: [{ uuid: `m${i}`, url: `${base}/thing.glb` }] } }
              : { taskType: tt, taskUUID: t.taskUUID, status: 'success', videoUUID: `v${i}`, videoURL: `${base}/clip.mp4`, seed: 300 + i, cost: 0.15 },
          );
        }
        return Array.from({ length: t.numberResults ?? 1 }, (_, i) =>
          t.taskType === 'imageInference'
            ? { taskType: t.taskType, taskUUID: t.taskUUID, imageURL: `${base}/img.png`, seed: 100 + i, cost: 0.03 }
            : { taskType: t.taskType, taskUUID: t.taskUUID, audioURL: `${base}/${/ace-step/.test(t.model) ? 'song' : 'hit'}.wav`, seed: 200 + i, cost: 0.01 },
        );
      });
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ data }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, requests, url: `http://127.0.0.1:${server.address().port}/v1` };
}

// spawn (not spawnSync): the mock server lives in this process's event loop
const runAsync = (args, cwd, env) =>
  new Promise((resolve) => {
    const p = spawn(process.execPath, [SCRIPT, ...args], { cwd, env: { ...process.env, ...env } });
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (d) => (stdout += d));
    p.stderr.on('data', (d) => (stderr += d));
    p.on('close', (status) => resolve({ status, stdout, stderr }));
  });

test('generate-media: concept video from a generated image (async polling, audio stripped, contact sheet)', { skip: !has('ffmpeg') && 'ffmpeg missing', timeout: 60000 }, async () => {
  const proj = tmp('media-video');
  mkdirSync(join(proj, 'design/reference'), { recursive: true });
  const fx = join(proj, 'fx');
  mkdirSync(fx);
  assert.equal(run('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=green:s=256x256', '-frames:v', '1', join(fx, 'img.png')]).status, 0);
  // a 2 s clip with a soundtrack, like the real models deliver
  assert.equal(run('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=s=320x192:r=25:d=2', '-f', 'lavfi', '-i', 'sine=d=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', join(fx, 'clip.mp4')]).status, 0);
  // the video's first frame is the output of the image entry, generated earlier in the same run
  const spec = {
    images: { keyart: { prompt: 'island key art', out: 'png', dir: 'design/reference' } },
    videos: { concept: { prompt: 'ball rolls into the cup', frames: ['design/reference/keyart.png'], resolution: '768p', duration: 5, seed: 7, candidates: 2 } },
  };
  writeFileSync(join(proj, 'design/media.json'), JSON.stringify(spec));
  const env0 = { ...process.env, RUNWARE_API_KEY: '' };
  const dry = run(process.execPath, [SCRIPT, '--dry-run'], { cwd: proj, env: env0 });
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /"taskType": "videoInference"/);
  assert.match(dry.stdout, /<not generated yet: design\/reference\/keyart\.png>/, 'dry run tolerates a frame that an earlier entry will generate');

  const mock = await mockRunware({ '/img.png': readFileSync(join(fx, 'img.png')), '/clip.mp4': readFileSync(join(fx, 'clip.mp4')) });
  const env = { RUNWARE_API_KEY: 'test-key', RUNWARE_API_URL: mock.url, RUNWARE_POLL_MS: '20' };
  try {
    const r1 = await runAsync([], proj, env);
    assert.equal(r1.status, 0, r1.stdout + r1.stderr);
    assert.ok(existsSync(join(proj, 'design/reference/keyart.png')), 'image entry honours dir');
    const v = mock.requests.find((t) => t.taskType === 'videoInference');
    assert.deepEqual([v.model, v.deliveryMethod, v.outputFormat, v.duration, v.resolution, v.width, v.seed, v.numberResults], ['minimax:h3@max', 'async', 'MP4', 5, '768p', undefined, 7, 2]);
    assert.match(v.inputs.frameImages[0], /^data:image\/png;base64,/);
    assert.equal(v.inputs.referenceImages, undefined);
    assert.ok(existsSync(join(proj, '.lab/media/concept/0.png')), 'candidate contact sheet');
    assert.ok(!existsSync(join(proj, 'design/reference/concept.mp4')), 'waits for --pick');

    const pick = await runAsync(['--pick', 'concept=1'], proj, env);
    assert.equal(pick.status, 0, pick.stderr);
    const out = join(proj, 'design/reference/concept.mp4');
    const streams = run('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', out]).stdout.trim();
    assert.equal(streams, 'video', 'soundtrack stripped from the reference clip');
    const lock = JSON.parse(readFileSync(join(proj, 'assets/media.lock.json'), 'utf8')).concept;
    assert.deepEqual([lock.kind, lock.file, lock.seed, lock.cost], ['videos', 'design/reference/concept.mp4', 301, 0.3]);
    assert.ok(existsSync(join(proj, lock.sheet)), 'final contact sheet');

    // audio: true is post-processing only: re-processed from the cached candidate, no new request
    spec.videos.concept.audio = true;
    writeFileSync(join(proj, 'design/media.json'), JSON.stringify(spec));
    const n = mock.requests.length;
    const r2 = await runAsync([], proj, env);
    assert.equal(r2.status, 0, r2.stderr);
    assert.equal(mock.requests.length, n);
    assert.match(run('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', out]).stdout, /audio/);
  } finally {
    mock.server.close();
  }
});

// smallest valid GLB: one triangle
function triangleGlb() {
  const bin = Buffer.alloc(36);
  [0, 0, 0, 1, 0, 0, 0, 1, 0].forEach((v, i) => bin.writeFloatLE(v, i * 4));
  const json = Buffer.from(
    JSON.stringify({
      asset: { version: '2.0' },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ mesh: 0, name: 'Tri' }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
      accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] }],
      bufferViews: [{ buffer: 0, byteLength: 36 }],
      buffers: [{ byteLength: 36 }],
    }),
  );
  const pad = (b, c) => Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4, c)]);
  const j = pad(json, 0x20);
  const chunk = (b, type) => Buffer.concat([Buffer.from(new Uint32Array([b.length, type]).buffer), b]);
  const body = Buffer.concat([chunk(j, 0x4e4f534a), chunk(bin, 0x004e4942)]);
  return Buffer.concat([Buffer.from(new Uint32Array([0x46546c67, 2, 12 + body.length]).buffer), body]);
}

test('generate-media: image-to-3D model (3dInference, async, raw GLB to assets/generated, preview sheet)', { timeout: 120000 }, async () => {
  const proj = tmp('media-3d');
  mkdirSync(join(proj, 'design/reference/props'), { recursive: true });
  writeFileSync(join(proj, 'design/reference/props/thing.png'), Buffer.from('89504e470d0a1a0a', 'hex'));
  writeFileSync(join(proj, 'design/media.json'), JSON.stringify({ models: { thing: { image: 'design/reference/props/thing.png', faceLimit: 4000 }, rapid: { image: 'design/reference/props/thing.png', model: 'tencent:hunyuan-3d@3.1-rapid' } } }));
  const mock = await mockRunware({ '/thing.glb': triangleGlb() });
  const env = { RUNWARE_API_KEY: 'test-key', RUNWARE_API_URL: mock.url, RUNWARE_POLL_MS: '20' };
  try {
    const r = await runAsync([], proj, env);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const [t, rapid] = mock.requests;
    assert.deepEqual([t.taskType, t.model, t.deliveryMethod, t.outputFormat, t.settings], ['3dInference', 'tripo:v3.1@0', 'async', 'GLB', { faceLimit: 4000 }]);
    assert.match(t.inputs.images[0], /^data:image\/png;base64,/);
    assert.match(rapid.inputs.image, /^data:image\/png;base64,/, 'Hunyuan Rapid takes a single inputs.image');
    assert.equal(rapid.settings, undefined, 'faceLimit is Tripo-only');
    assert.deepEqual(readFileSync(join(proj, 'assets/generated/thing.glb')), triangleGlb());
    const lock = JSON.parse(readFileSync(join(proj, 'assets/media.lock.json'), 'utf8')).thing;
    assert.deepEqual([lock.kind, lock.file, lock.seed, lock.cost], ['models', 'assets/generated/thing.glb', 400, 0.3]);
    if (hasBlender()) {
      assert.equal(lock.tris, 1);
      assert.ok(existsSync(join(proj, lock.sheet)), 'Blender preview sheet');
    }
  } finally {
    mock.server.close();
  }
});

test('generate-media: request shape, candidates + pick, post-processing, lock caching', { skip: !has('ffmpeg') && 'ffmpeg missing', timeout: 60000 }, async () => {
  const proj = tmp('media');
  mkdirSync(join(proj, 'design/reference'), { recursive: true });
  const fx = join(proj, 'fx');
  mkdirSync(fx);
  // fixtures: a 1024² RGBA png and a 1 s wav: hiss, then a decaying tone at 0.5 s
  assert.equal(run('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=red@0.5:s=1024x1024,format=rgba', '-frames:v', '1', join(fx, 'img.png')]).status, 0);
  const tone = "aevalsrc='0.004*(random(0)-0.5)+if(gte(t,0.5),0.8*sin(2*PI*880*t)*exp(-(t-0.5)*30),0)':s=44100:d=1";
  assert.equal(run('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', tone, join(fx, 'hit.wav')]).status, 0);
  writeFileSync(join(proj, 'design/reference/key.png'), readFileSync(join(fx, 'img.png')));
  const spec = {
    images: {
      splash: { prompt: 'island', reference: ['design/reference/key.png'], width: 1376, height: 768, candidates: 2 },
      icon: { prompt: 'ball', transparent: true, width: 1024, height: 1024, resize: 64 },
    },
    sfx: { hit: { prompt: 'tock', duration: 1, seed: 3 } },
  };
  const writeSpec = () => writeFileSync(join(proj, 'design/media.json'), JSON.stringify(spec));
  writeSpec();
  const mock = await mockRunware({ '/img.png': readFileSync(join(fx, 'img.png')), '/hit.wav': readFileSync(join(fx, 'hit.wav')) });
  const env = { RUNWARE_API_KEY: 'test-key', RUNWARE_API_URL: mock.url };
  try {
    const r1 = await runAsync([], proj, env);
    assert.equal(r1.status, 0, r1.stdout + r1.stderr);
    assert.doesNotMatch(r1.stdout + r1.stderr, /test-key/, 'never print the key');
    const byModel = Object.fromEntries(mock.requests.map((t) => [t.positivePrompt, t]));
    assert.equal(mock.requests.length, 3);
    assert.equal(byModel.island.model, 'google:nano-banana@2.1');
    assert.equal(byModel.island.numberResults, 2);
    assert.equal(byModel.island.outputFormat, 'WEBP');
    assert.match(byModel.island.inputs.referenceImages[0], /^data:image\/png;base64,/);
    assert.equal(byModel.ball.model, 'openai:gpt-image@2.5-flare');
    assert.equal(byModel.ball.settings.background, 'transparent');
    assert.equal(byModel.ball.outputFormat, 'PNG');
    assert.equal(byModel.tock.taskType, 'audioInference');
    assert.equal(byModel.tock.model, 'mirelo:1@1');
    assert.deepEqual([byModel.tock.duration, byModel.tock.seed, byModel.tock.outputFormat], [1, 3, 'WAV']);

    // single-candidate entries are finalised; multi-candidate ones wait for --pick
    const probe = (f, what) => run('ffprobe', ['-v', 'error', '-show_entries', what, '-of', 'csv=p=0', join(proj, f)]).stdout.trim();
    assert.equal(probe('public/images/icon.png', 'stream=width,height'), '64,64');
    assert.ok(!existsSync(join(proj, 'public/images/splash.webp')));
    const lock = () => JSON.parse(readFileSync(join(proj, 'assets/media.lock.json'), 'utf8'));
    const hit = lock().hit;
    assert.ok(Math.abs(hit.trim[0] - 0.5) < 0.02, `onset trimmed to the tone: ${hit.trim}`);
    assert.ok(hit.duration < 0.4, `trimmed duration ${hit.duration}`);
    assert.equal(hit.seed, 200);
    assert.ok(existsSync(join(proj, '.lab/media/hit.png')), 'waveform written');
    assert.equal(lock().splash.candidates.length, 2);

    const pick = await runAsync(['--pick', 'splash=1'], proj, env);
    assert.equal(pick.status, 0, pick.stderr);
    assert.ok(existsSync(join(proj, 'public/images/splash.webp')));
    assert.equal(lock().splash.picked, 1);
    assert.equal(lock().splash.seed, 101);

    // unchanged spec: no requests
    const r2 = await runAsync([], proj, env);
    assert.equal(r2.status, 0, r2.stderr);
    assert.equal(mock.requests.length, 3, 'cached: no new requests');
    assert.match(r2.stdout, /unchanged/);

    // post-processing change: re-processed from the cached candidate, still no request
    spec.sfx.hit.gain = -6;
    writeSpec();
    const r3 = await runAsync([], proj, env);
    assert.equal(r3.status, 0, r3.stderr);
    assert.equal(mock.requests.length, 3);
    assert.match(r3.stdout, /re-processed/);

    // generation change: exactly one new request
    spec.sfx.hit.prompt = 'tick';
    writeSpec();
    const r4 = await runAsync(['hit'], proj, env);
    assert.equal(r4.status, 0, r4.stderr);
    assert.equal(mock.requests.length, 4);

    // API errors surface verbatim
    const bad = await runAsync(['--force', 'hit'], proj, { ...env, RUNWARE_API_KEY: 'wrong' });
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /bad key/);
  } finally {
    mock.server.close();
  }
});

test('generate-media: music loop (tempo drift, gapless MP3 + loop sidecar)', { skip: !has('ffmpeg') && 'ffmpeg missing', timeout: 60000 }, async () => {
  const proj = tmp('media-music');
  mkdirSync(join(proj, 'design'), { recursive: true });
  const fx = join(proj, 'fx');
  mkdirSync(fx);
  writeWav(join(fx, 'song.wav'), synthSong(117, 50), 44100, 2);
  writeFileSync(join(proj, 'design/media.json'), JSON.stringify({ music: { theme: { prompt: 'cosy loop', bpm: 112, key: 'D major', bars: 8 } } }));
  const mock = await mockRunware({ '/song.wav': readFileSync(join(fx, 'song.wav')) });
  try {
    const r = await runAsync([], proj, { RUNWARE_API_KEY: 'test-key', RUNWARE_API_URL: mock.url });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const [t] = mock.requests;
    assert.deepEqual([t.taskType, t.model, t.duration, t.outputFormat], ['audioInference', 'runware:ace-step@v1.5-xl-turbo', 60, 'WAV']);
    assert.deepEqual(t.settings, { bpm: 112, timeSignature: 4, keyScale: 'D major', lyrics: '[Instrumental]', vocalLanguage: 'unknown' });
    const meta = JSON.parse(readFileSync(join(proj, 'public/music/theme.json'), 'utf8'));
    const want = (32 * 60 * 44100) / 117;
    assert.equal(meta.loop, true);
    assert.ok(Math.abs(meta.samples - want) / want < 0.003, `loop ${meta.samples} samples vs ${want}`);
    assert.ok(Math.abs(meta.bpm - 117) < 0.4, `tempo ${meta.bpm}`);
    // the LAME header carries the encoder delay/padding: a gapless decoder (ffmpeg, Chrome) returns the exact loop
    const dec = decodePcm(join(proj, 'public/music/theme.mp3'), 44100, 2);
    assert.equal(dec.length / 2, meta.samples);
    const lock = JSON.parse(readFileSync(join(proj, 'assets/media.lock.json'), 'utf8')).theme;
    assert.ok(lock.seam > 0.9, `seam ${lock.seam}`);
    assert.ok(existsSync(join(proj, '.lab/media/theme.png')), 'waveform written');
  } finally {
    mock.server.close();
  }
});
