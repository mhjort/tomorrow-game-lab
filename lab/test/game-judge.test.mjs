import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, SKILLS, tmp, run } from './helpers.mjs';
import { aggregate, mergePanel, sameIssue, validateVerdict } from '../../skills/game-judge/scripts/aggregate.mjs';
import { metrics, palette } from '../../skills/game-judge/scripts/visual-pack.mjs';

const good = (judge, score = 8, issues = []) => ({ judge, score, pass: score >= 7, summary: 'ok', issues });

test('validateVerdict accepts the schema and rejects malformed outputs', () => {
  assert.deepEqual(validateVerdict(good('visual-fidelity')), []);
  assert.ok(validateVerdict({ judge: 'x', score: 11, pass: true, summary: '', issues: [] }).length);
  assert.ok(validateVerdict({ ...good('x'), issues: [{ severity: 'huge', title: 't', evidence: 'e', fix: 'f' }] }).length);
  assert.ok(
    validateVerdict({ ...good('x'), issues: [{ severity: 'blocker', title: 't', evidence: 'e', fix: 'f' }] }).some((e) => /blocker/.test(e)),
    'pass:true with a blocker is inconsistent',
  );
});

test('aggregate: orders fixes by severity, fails on any failing judge', () => {
  const runDir = tmp('verdict');
  mkdirSync(join(runDir, 'judges'));
  writeFileSync(join(runDir, 'report.json'), JSON.stringify({ pass: true }));
  writeFileSync(join(runDir, 'judges/a.json'), JSON.stringify(good('a', 8, [{ severity: 'minor', title: 'm', evidence: 'e', fix: 'f' }])));
  writeFileSync(join(runDir, 'judges/b.json'), '```json\n' + JSON.stringify({ ...good('b', 5), pass: false, issues: [{ severity: 'blocker', title: 'B', evidence: 'e', fix: 'f' }] }) + '\n```');
  const r = aggregate(runDir);
  assert.equal(r.pass, false);
  assert.equal(r.fixes[0].severity, 'blocker');
  assert.equal(r.meanScore, 6.5);
  const cli = run(process.execPath, [join(SKILLS, 'game-judge/scripts/aggregate.mjs'), runDir]);
  assert.equal(cli.status, 1);
  assert.match(readFileSync(join(runDir, 'verdict.md'), 'utf8'), /ITERATE/);
});

test('aggregate: a visual panel takes the median and lists only issues most of the panel raised', () => {
  const runDir = tmp('panel');
  mkdirSync(join(runDir, 'judges'));
  writeFileSync(join(runDir, 'report.json'), JSON.stringify({ pass: true }));
  const issue = (element, title, severity = 'major') => ({ severity, element, title, evidence: 'e', fix: 'f' });
  const vis = (score, crit, issues) => ({ ...good('visual-fidelity', score), pass: score >= 7 && !issues.some((i) => i.severity === 'blocker'), criteria: { palette: crit, shape: 6 }, keyart_bullets: ['b'], issues });
  writeFileSync(join(runDir, 'judges/visual-fidelity-1.json'), JSON.stringify(vis(6.4, 7, [issue('plough', 'Plough blade reads as a flat plank'), issue('house', 'Roof snow caps are thin flat slabs'), issue('palette', 'Snow hue too violet')])));
  writeFileSync(join(runDir, 'judges/visual-fidelity-2.json'), JSON.stringify(vis(6.8, 6, [issue('plough', 'Plough blade is a flat yellow plank, not a mouldboard'), issue('house', 'Roof snow is flat and thin', 'minor'), issue('polish', 'Black holes in dormers', 'blocker')])));
  writeFileSync(join(runDir, 'judges/visual-fidelity-3.json'), JSON.stringify(vis(7.2, 8, [issue('house', 'Roofs: thin snow slabs instead of thick caps')])));
  writeFileSync(join(runDir, 'judges/gameplay.json'), JSON.stringify(good('gameplay', 9)));
  const r = aggregate(runDir);
  const v = r.verdicts.find((x) => x.judge === 'visual-fidelity');
  assert.equal(v.panel, 3);
  assert.equal(v.score, 6.8, 'median, not mean');
  assert.deepEqual(v.scores, [6.4, 6.8, 7.2]);
  assert.equal(v.criteria.palette, 7);
  assert.equal(v.pass, false, 'only one of three passed');
  const titles = r.fixes.map((f) => `${f.element}:${f.raisedBy}`);
  assert.ok(titles.includes('house:3') && titles.includes('plough:2'), titles.join(' '));
  assert.ok(r.fixes.some((f) => f.severity === 'blocker'), 'a blocker is listed even when one judge raised it');
  assert.ok(r.unconfirmed.some((f) => f.element === 'palette'), 'a 1-of-3 issue is listed separately, not as a fix');
  assert.equal(r.fixes.find((f) => f.element === 'house').severity, 'major', 'median severity of major, minor, major');
  assert.equal(sameIssue(issue('house', 'Roof snow thin'), issue('palette', 'Snow hue violet')), false, 'different elements never merge');
  assert.equal(sameIssue(issue('camera', 'Chase camera is near top-down'), issue('camera', 'Play camera is steep and close'), true), true, 'one issue per element: merge on the element');
  assert.equal(sameIssue(issue('square centrepiece', 'Stones are flat boxes'), issue('square', 'Plaza is pink'), true), true, 'element names normalise to their first word');
  run(process.execPath, [join(SKILLS, 'game-judge/scripts/aggregate.mjs'), runDir]);
  const md = readFileSync(join(runDir, 'verdict.md'), 'utf8');
  assert.match(md, /median of 6\.4, 6\.8, 7\.2/);
  assert.match(md, /3\/3 judges/);
  assert.match(md, /minority of a panel/);
  assert.equal(mergePanel([good('x', 8)]).panel, 1);
});

test('visual-pack: pairs screenshots with reference frames, side by side, with measured palettes', () => {
  const project = tmp('vpack');
  const runDir = join(project, '.lab/runs/r1');
  mkdirSync(join(project, 'design/reference'), { recursive: true });
  mkdirSync(join(runDir, 'webgpu'), { recursive: true });
  const solid = (path, color, size) => run('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `color=c=${color}:s=${size}`, '-frames:v', '1', path]);
  solid(join(project, 'design/reference/keyart.png'), '0x0e4a7f', '640x366');
  solid(join(runDir, 'webgpu/boot-overview.png'), '0x4a74c0', '1280x720');
  solid(join(runDir, 'webgpu/rules-high.png'), '0x808080', '1280x720');
  writeFileSync(join(project, 'design/brief.md'), '# Brief\n\nWhat v1 adds that the video doesn\'t show, and why:\n- A HUD clock: the fail state needs a timer.\n- Falling snow: weather.\n\n## Core loop\n- not an addition\n');
  writeFileSync(join(runDir, 'report.json'), JSON.stringify({ backends: { webgpu: { scenarios: [
    { screenshots: ['webgpu/boot-overview.png'], compare: [{ shot: 'webgpu/boot-overview.png', ref: 'design/reference/keyart.png' }] },
    { screenshots: ['webgpu/rules-high.png'] },
  ] } } }));
  const r = run(process.execPath, [join(SKILLS, 'game-judge/scripts/visual-pack.mjs'), runDir, '--project', project]);
  assert.equal(r.status, 0, r.stderr);
  const pack = JSON.parse(readFileSync(join(runDir, 'visual-pack/pack.json'), 'utf8'));
  assert.equal(pack.pairs.length, 1);
  assert.deepEqual(pack.context, ['webgpu/rules-high.png']);
  const [e] = pack.pairs;
  const near = (a, b) => [1, 3, 5].every((i) => Math.abs(parseInt(a.slice(i, i + 2), 16) - parseInt(b.slice(i, i + 2), 16)) <= 2);
  assert.ok(near(e.reference.palette[0].hex, '#0e4a7f') && near(e.game.palette[0].hex, '#4a74c0'), `${e.reference.palette[0].hex} ${e.game.palette[0].hex}`);
  assert.ok(Math.abs(e.reference.coolHue - 208) <= 1 && Math.abs(e.game.coolHue - 219) <= 1, `${e.reference.coolHue} ${e.game.coolHue}`);
  const size = run('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', join(runDir, e.sideBySide)]).stdout.trim();
  assert.equal(size, `${Math.round((640 * 720) / 366 / 2) * 2 + 1280},720`, 'reference scaled to the shot height, then the shot');
  assert.match(readFileSync(join(runDir, 'visual-pack/pack.md'), 'utf8'), /left = reference, right = game[\s\S]*coolHue[\s\S]*Context shots/);
  assert.deepEqual(pack.additions, ['- A HUD clock: the fail state needs a timer.', '- Falling snow: weather.'], 'the additions list is quoted, and stops at the next section');
  // pure helpers
  assert.equal(palette([[255, 0, 0], [255, 0, 0], [0, 0, 255]], 2)[0].hex, '#ff0000');
  assert.equal(metrics([[200, 30, 20], [20, 60, 200]]).warmShare, 0.5);
});

test('judge rubrics: each names inputs, weights summing to 1, and a pass threshold', () => {
  const dir = join(SKILLS, 'game-judge/judges');
  const rubrics = readdirSync(dir).filter((f) => f.endsWith('.md'));
  assert.ok(rubrics.length >= 4);
  for (const f of rubrics) {
    const t = readFileSync(join(dir, f), 'utf8');
    assert.match(t, /## Inputs/, f);
    assert.match(t, /Pass threshold: \*\*\d/, f);
    assert.match(t, /_output-schema\.json/, f);
    const weights = [...t.matchAll(/^\|[^|]+\|\s*(0\.\d+)\s*\|/gm)].map((m) => Number(m[1]));
    assert.ok(Math.abs(weights.reduce((a, b) => a + b, 0) - 1) < 1e-9, `${f} weights sum ${weights}`);
  }
});

test('playtest: golden minigolf passes on webgpu + webgl2 with backend parity', { skip: process.env.SKIP_BROWSER && 'SKIP_BROWSER set', timeout: 300000 }, () => {
  const proj = join(ROOT, 'examples/minigolf');
  const out = tmp('playtest');
  const r = run(process.execPath, [join(SKILLS, 'game-judge/scripts/playtest.mjs'), '--project', proj, '--dev', '--perf', '1', '--parity-min', '0.98', '--out', out]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const rep = JSON.parse(readFileSync(join(out, 'report.json'), 'utf8'));
  assert.equal(rep.backends.webgl2.reported, 'webgl2');
  assert.ok(['webgpu', 'webgl2'].includes(rep.backends.webgpu.reported));
  for (const b of Object.values(rep.backends)) {
    assert.ok(b.scenarios.length >= 4);
    for (const s of b.scenarios) assert.deepEqual(s.errors, [], `${s.name} errors`);
  }
  // ≥ 0.98 relies on prewarm() covering every level (skills/web-game-runtime/references/webgpu-notes.md)
  assert.ok(rep.parity.length >= 4 && rep.parity.every((p) => p.ssim >= 0.98));
  assert.ok(existsSync(join(out, 'webgpu/boot-overview.png')));
});

test('playtest: video-first snowplough example passes every scenario (real keys + drag, full-run bot)', { skip: process.env.SKIP_BROWSER && 'SKIP_BROWSER set', timeout: 300000 }, () => {
  const out = tmp('playtest-snowplough');
  const r = run(process.execPath, [join(SKILLS, 'game-judge/scripts/playtest.mjs'), '--project', join(ROOT, 'examples/snowplough'), '--dev', '--backends', 'webgl2', '--perf', '0', '--out', out]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const rep = JSON.parse(readFileSync(join(out, 'report.json'), 'utf8'));
  const names = rep.backends.webgl2.scenarios.map((s) => s.name);
  for (const n of ['boot', 'keys', 'drag-joystick', 'full-run']) assert.ok(names.includes(n), n);
  const bot = rep.backends.webgl2.scenarios.find((s) => s.name === 'full-run').steps.find((s) => s.result).result;
  assert.equal(bot.phase, 'won');
  // screenshots framed like reference frames are recorded, and the visual pack pairs them
  const vp = run(process.execPath, [join(SKILLS, 'game-judge/scripts/visual-pack.mjs'), out, '--project', join(ROOT, 'examples/snowplough'), '--backend', 'webgl2']);
  assert.equal(vp.status, 0, vp.stderr);
  const pack = JSON.parse(readFileSync(join(out, 'visual-pack/pack.json'), 'utf8'));
  assert.ok(pack.pairs.some((p) => p.ref === 'design/reference/keyart.png' && /boot-overview/.test(p.shot)), JSON.stringify(pack.pairs.map((p) => p.shot)));
  assert.ok(pack.context.some((c) => /high-camera/.test(c)), 'unpaired shots are context only');
});

test('playtest: detects a failing assertion and console errors', { skip: process.env.SKIP_BROWSER && 'SKIP_BROWSER set', timeout: 120000 }, () => {
  const scen = tmp('bad-scenarios');
  writeFileSync(join(scen, 'bad.json'), JSON.stringify({ name: 'bad', steps: [{ step: 1 }, { assert: 'state.hole === 99' }, { eval: "console.error('boom')" }] }));
  const out = tmp('playtest-bad');
  const r = run(process.execPath, [join(SKILLS, 'game-judge/scripts/playtest.mjs'), '--project', join(ROOT, 'examples/minigolf'), '--dev', '--backends', 'webgl2', '--perf', '0', '--scenarios', scen, '--out', out]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  const s = JSON.parse(readFileSync(join(out, 'report.json'), 'utf8')).backends.webgl2.scenarios[0];
  assert.equal(s.pass, false);
  assert.ok(s.steps[1].failed);
  assert.ok(s.errors.some((e) => e.includes('boom')));
});

test('template: scaffold boots through loading screen + prewarm on both backends', { skip: process.env.SKIP_BROWSER && 'SKIP_BROWSER set', timeout: 180000 }, () => {
  const proj = tmp('template');
  const s = run(process.execPath, [join(SKILLS, 'web-game-runtime/scripts/scaffold.mjs'), proj]);
  assert.equal(s.status, 0, s.stderr);
  // a real standalone install, as an agent would do (fast: packages hard-link from the pnpm store)
  const i = run('pnpm', ['install', '--ignore-workspace', '--prefer-offline'], { cwd: proj });
  assert.equal(i.status, 0, i.stdout + i.stderr);
  const out = join(proj, '.lab/run');
  const r = run(process.execPath, [join(SKILLS, 'game-judge/scripts/playtest.mjs'), '--project', proj, '--dev', '--perf', '0', '--out', out]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const rep = JSON.parse(readFileSync(join(out, 'report.json'), 'utf8'));
  assert.equal(rep.backends.webgl2.reported, 'webgl2');
  assert.ok(rep.parity.every((p) => p.ssim >= 0.98));
});
