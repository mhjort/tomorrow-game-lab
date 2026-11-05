import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, SKILLS, has, tmp, run } from './helpers.mjs';

const VIDEO = join(ROOT, 'lab/fixtures/keyart/minigolf.mp4');
const IMAGE = join(ROOT, 'lab/fixtures/keyart/minigolf.png');

test('extract-frames.sh: frames + contact sheet from the fixture video', { skip: !has('ffmpeg') && 'ffmpeg missing' }, () => {
  const out = tmp('frames');
  const r = run(join(SKILLS, 'key-art-direction/scripts/extract-frames.sh'), [VIDEO, out, '6']);
  assert.equal(r.status, 0, r.stderr);
  const frames = readdirSync(out).filter((f) => /^frame_\d+\.png$/.test(f));
  assert.ok(frames.length >= 4 && frames.length <= 6, `got ${frames.length} frames`);
  assert.ok(existsSync(join(out, 'contact-sheet.png')));
});

test('crop-frame.sh: full-resolution crop of a video moment and of an image, upscaled', { skip: !has('ffmpeg') && 'ffmpeg missing' }, () => {
  const dir = tmp('crop');
  const size = (f) => run('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', f]).stdout.trim().split(',').map(Number);
  const [vw, vh] = size(VIDEO);
  const v = run(join(SKILLS, 'key-art-direction/scripts/crop-frame.sh'), [VIDEO, join(dir, 'v.png'), '0.4', '0.4', '0.1', '0.1', '1.0']);
  assert.equal(v.status, 0, v.stderr);
  const [w, h] = size(join(dir, 'v.png'));
  // a 10 % box is upscaled (at most 6x) towards a 1024 px long side, keeping its aspect
  assert.ok(w > vw * 0.1 * 2 && Math.max(w, h) <= 1030, `crop ${w}x${h} of ${vw}x${vh}`);
  assert.ok(Math.abs(w / h - vw / vh) < 0.05);
  const i = run(join(SKILLS, 'key-art-direction/scripts/crop-frame.sh'), [IMAGE, join(dir, 'i.png'), '0.9', '0.9', '0.2', '0.2']);
  assert.equal(i.status, 0, i.stderr); // a box past the edge is shifted inside
  const bad = run(join(SKILLS, 'key-art-direction/scripts/crop-frame.sh'), [IMAGE, join(dir, 'b.png'), '40', '0', '0.2', '0.2']);
  assert.notEqual(bad.status, 0);
});

test('palette.py: dominant colours of the fixture key art', { skip: !has('ffmpeg') && 'ffmpeg missing' }, () => {
  const out = join(tmp('palette'), 'palette.json');
  const r = run('python3', [join(SKILLS, 'key-art-direction/scripts/palette.py'), IMAGE, '-k', '5', '-o', out]);
  assert.equal(r.status, 0, r.stderr);
  const p = JSON.parse(readFileSync(out, 'utf8'));
  assert.equal(p.colors.length, 5);
  const share = p.colors.reduce((s, c) => s + c.share, 0);
  assert.ok(Math.abs(share - 1) < 0.01);
  // the fixture is a grassy island: the dominant colour must be green
  const [r0, g0, b0] = [1, 3, 5].map((i) => parseInt(p.colors[0].hex.slice(i, i + 2), 16));
  assert.ok(g0 > r0 && g0 > b0, `dominant ${p.colors[0].hex} should be green`);
});
