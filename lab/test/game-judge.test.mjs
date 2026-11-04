import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, SKILLS, tmp, run } from './helpers.mjs';
import { aggregate, validateVerdict } from '../../skills/game-judge/scripts/aggregate.mjs';

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
  const proj = tmp('template'); // inside the repo, so node_modules resolve from the root workspace
  const s = run(process.execPath, [join(SKILLS, 'web-game-runtime/scripts/scaffold.mjs'), proj]);
  assert.equal(s.status, 0, s.stderr);
  const out = join(proj, '.lab/run');
  const r = run(process.execPath, [join(SKILLS, 'game-judge/scripts/playtest.mjs'), '--project', proj, '--dev', '--perf', '0', '--out', out]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const rep = JSON.parse(readFileSync(join(out, 'report.json'), 'utf8'));
  assert.equal(rep.backends.webgl2.reported, 'webgl2');
  assert.ok(rep.parity.every((p) => p.ssim >= 0.98));
});
