#!/usr/bin/env node
// Compare two game-judge playtest runs of the same game: a baseline (before an optimisation) and an attempt (after).
// Reports the performance change and, for every screenshot both runs share, whether the image changed (SSIM).
// A change that moves a screenshot below the threshold changes the look: the user decides whether it is worth it.
// Usage: node perf-compare.mjs <before-run> <after-run> [--backend webgpu] [--same 0.985]
// Writes <after-run>/perf-compare.md, perf-compare.json and perf-compare/<shot>.png (before | after) for changed shots.
// Needs ffmpeg. Exit 0 = report written, 2 = setup error.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** SSIM between two images (1 = identical), or null if ffmpeg cannot compare them. */
export function ssim(a, b) {
  const r = spawnSync('ffmpeg', ['-v', 'info', '-i', a, '-i', b, '-lavfi', 'ssim', '-f', 'null', '-'], { encoding: 'utf8' });
  const m = r.stderr.match(/All:([\d.]+)/);
  return m ? Number(m[1]) : null;
}

/** The numbers worth comparing from a playtest report. avgFrameMs is the work per frame (fps is capped by vsync). */
export function summarize(report, backend) {
  const b = report.backends?.[backend];
  if (!b) throw new Error(`no ${backend} backend in the report`);
  const boots = (b.scenarios ?? []).map((s) => s.bootMs).filter((x) => typeof x === 'number');
  return {
    avgFrameMs: b.perf?.avgFrameMs ?? null,
    worstFrameMs: b.perf?.worstFrameMs ?? null,
    fps: b.perf?.fps ?? null,
    bootMs: boots.length ? Math.round(boots.reduce((s, x) => s + x, 0) / boots.length) : null,
    downloadKb: b.network?.requests ? Math.round(b.network.requests.reduce((s, q) => s + (q.kb ?? 0), 0)) : null,
    pass: report.pass,
  };
}

export function compare(beforeDir, afterDir, { backend = 'webgpu', same = 0.985 } = {}) {
  const read = (d) => JSON.parse(readFileSync(join(d, 'report.json'), 'utf8'));
  const before = summarize(read(beforeDir), backend);
  const after = summarize(read(afterDir), backend);
  const shotsDir = (d) => join(d, backend);
  const names = existsSync(shotsDir(beforeDir)) ? readdirSync(shotsDir(beforeDir)).filter((f) => f.endsWith('.png') && existsSync(join(shotsDir(afterDir), f))) : [];
  const outDir = join(afterDir, 'perf-compare');
  const shots = [];
  for (const name of names.sort()) {
    const a = join(shotsDir(beforeDir), name);
    const b = join(shotsDir(afterDir), name);
    const score = ssim(a, b);
    const changed = score === null || score < same;
    let sideBySide = null;
    if (changed) {
      mkdirSync(outDir, { recursive: true });
      sideBySide = join('perf-compare', name);
      spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', a, '-i', b, '-filter_complex', '[0][1]hstack', join(afterDir, sideBySide)]);
    }
    shots.push({ name, ssim: score, changed, sideBySide });
  }
  const delta = Object.fromEntries(
    ['avgFrameMs', 'worstFrameMs', 'bootMs', 'downloadKb'].map((k) => [k, before[k] !== null && after[k] !== null ? Number((after[k] - before[k]).toFixed(2)) : null]),
  );
  return { backend, threshold: same, before, after, delta, shots, lookChanged: shots.some((s) => s.changed) };
}

function toMarkdown(r) {
  const row = (k, unit) => `| ${k} | ${r.before[k] ?? '–'} | ${r.after[k] ?? '–'} | ${r.delta[k] ?? '–'}${r.delta[k] !== null ? unit : ''} |`;
  const fmt = (x) => (x === null ? '–' : typeof x === 'number' ? Number(x.toFixed(2)) : x);
  r.before = Object.fromEntries(Object.entries(r.before).map(([k, v]) => [k, fmt(v)]));
  r.after = Object.fromEntries(Object.entries(r.after).map(([k, v]) => [k, fmt(v)]));
  return [
    `# Performance compare (${r.backend})`,
    '',
    '| | before | after | change |',
    '|---|---|---|---|',
    row('avgFrameMs', ' ms'),
    row('worstFrameMs', ' ms'),
    row('bootMs', ' ms'),
    row('downloadKb', ' KB'),
    `| playtest | ${r.before.pass ? 'pass' : 'FAIL'} | ${r.after.pass ? 'pass' : 'FAIL'} | |`,
    '',
    `## Look (SSIM per screenshot, "same" at ≥ ${r.threshold})`,
    '',
    ...r.shots.map((s) => `- ${s.changed ? '⚠️ changed' : '✅ same'} ${s.name}: ${s.ssim === null ? 'not comparable' : s.ssim.toFixed(4)}${s.sideBySide ? ` → ${s.sideBySide} (before | after)` : ''}`),
    '',
    r.lookChanged
      ? '**The look changed.** Show the user the side-by-side images and the gain above, and apply this only if they agree.'
      : 'No screenshot changed: this optimisation is free to keep.',
    '',
  ].join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
  const [beforeDir, afterDir] = args.filter((a, i) => !a.startsWith('--') && !['--backend', '--same'].includes(args[i - 1]));
  if (!beforeDir || !afterDir) {
    console.error('usage: perf-compare.mjs <before-run> <after-run> [--backend webgpu] [--same 0.985]');
    process.exit(2);
  }
  if (spawnSync('ffmpeg', ['-version']).status !== 0) {
    console.error('perf-compare needs ffmpeg on PATH');
    process.exit(2);
  }
  try {
    const r = compare(beforeDir, afterDir, { backend: opt('--backend', 'webgpu'), same: Number(opt('--same', 0.985)) });
    const md = toMarkdown(structuredClone(r));
    writeFileSync(join(afterDir, 'perf-compare.json'), JSON.stringify(r, null, 2));
    writeFileSync(join(afterDir, 'perf-compare.md'), md);
    console.log(md);
  } catch (e) {
    console.error(`[perf-compare] ${e.message}`);
    process.exit(2);
  }
}
