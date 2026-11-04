import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SKILLS, has, tmp, run } from './helpers.mjs';
import { loudSpan, normalise } from '../../skills/generate-media/scripts/generate-media.mjs';

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

test('normalise: defaults and validation', () => {
  assert.equal(normalise('images', 'a', { prompt: 'x' }).model, 'google:nano-banana@2.1');
  assert.equal(normalise('images', 'a', { prompt: 'x', transparent: true }).model, 'openai:gpt-image@2.5-flare');
  assert.equal(normalise('images', 'a', { prompt: 'x', transparent: true }).out, 'png');
  assert.equal(normalise('sfx', 'a', { prompt: 'x' }).model, 'mirelo:1@1');
  assert.throws(() => normalise('images', 'a', {}), /prompt/);
  assert.throws(() => normalise('images', 'a', { prompt: 'x', resize: 64, out: 'webp' }), /resize/);
  assert.throws(() => normalise('images', 'a', { prompt: 'x', width: 512 }), /width and height/);
  assert.throws(() => normalise('sfx', 'a', { prompt: 'x', candidates: 5 }), /candidates/);
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

// Mock Runware: records tasks, answers with URLs to fixture files it serves itself.
async function mockRunware(files) {
  const requests = [];
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
      requests.push(...tasks);
      const data = tasks.flatMap((t) =>
        Array.from({ length: t.numberResults ?? 1 }, (_, i) =>
          t.taskType === 'imageInference'
            ? { taskType: t.taskType, taskUUID: t.taskUUID, imageURL: `${base}/img.png`, seed: 100 + i, cost: 0.03 }
            : { taskType: t.taskType, taskUUID: t.taskUUID, audioURL: `${base}/hit.wav`, seed: 200 + i, cost: 0.01 },
        ),
      );
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
