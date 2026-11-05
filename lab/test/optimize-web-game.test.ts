import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SKILLS, tmp, run } from './helpers.ts';
import { summarize } from '../../skills/optimize-web-game/scripts/perf-compare.ts';

const report = (avgFrameMs: number, kb: number) => ({
  pass: true,
  backends: { webgpu: { perf: { avgFrameMs, worstFrameMs: avgFrameMs * 2, fps: 60 }, network: { requests: [{ kb }, { kb: 100 }] }, scenarios: [{ bootMs: 400 }, { bootMs: 600 }] } },
});
const solid = (path: string, color: string) => run('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `color=c=${color}:s=320x180`, '-frames:v', '1', path]);
const noisy = (path: string) => run('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=s=320x180', '-frames:v', '1', path]);

test('perf-compare: frame/boot/download deltas, and screenshots marked same or changed with a side-by-side', () => {
  const root = tmp('perfcmp');
  const before = join(root, 'before');
  const after = join(root, 'after');
  for (const d of [before, after]) mkdirSync(join(d, 'webgpu'), { recursive: true });
  writeFileSync(join(before, 'report.json'), JSON.stringify(report(4, 900)));
  writeFileSync(join(after, 'report.json'), JSON.stringify(report(2.5, 400)));
  for (const d of [before, after]) noisy(join(d, 'webgpu/play.png')); // identical: a free change
  noisy(join(before, 'webgpu/overview.png'));
  solid(join(after, 'webgpu/overview.png'), '0x204080'); // different: a visible change
  const r = run(process.execPath, [join(SKILLS, 'optimize-web-game/scripts/perf-compare.ts'), before, after]);
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(readFileSync(join(after, 'perf-compare.json'), 'utf8'));
  assert.equal(out.delta.avgFrameMs, -1.5);
  assert.equal(out.delta.downloadKb, -500);
  assert.equal(out.before.bootMs, 500);
  type Shot = { name: string; changed: boolean; ssim: number; sideBySide: string };
  const shots = out.shots as Shot[];
  const shot = (name: string): Shot => {
    const s = shots.find((x) => x.name === name);
    assert.ok(s, `no shot ${name}`);
    return s;
  };
  assert.equal(shot('play.png').changed, false);
  assert.ok(shot('play.png').ssim > 0.99);
  assert.equal(shot('overview.png').changed, true);
  assert.ok(existsSync(join(after, shot('overview.png').sideBySide)), 'side-by-side for the user');
  assert.equal(out.lookChanged, true);
  assert.match(readFileSync(join(after, 'perf-compare.md'), 'utf8'), /The look changed/);
  assert.throws(() => summarize({ pass: true, backends: {} }, 'webgpu'), /no webgpu backend/);
});

test('optimize-web-game: the skill asks before visible changes and every catalogue entry is marked free or visible', () => {
  const skill = readFileSync(join(SKILLS, 'optimize-web-game/SKILL.md'), 'utf8');
  assert.match(skill, /only changes with the user's OK/);
  assert.match(skill, /one question per trade/i);
  const rows = readFileSync(join(SKILLS, 'optimize-web-game/references/changes.md'), 'utf8').split('\n').filter((l) => /^\| (?!change|---)/.test(l));
  assert.ok(rows.length >= 15);
  for (const row of rows) assert.match(row.split('|')[2] ?? '', /free|visible/, row);
});
