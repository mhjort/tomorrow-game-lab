#!/usr/bin/env node
// Compare two game-judge playtest runs of the same game: a baseline (before an optimisation) and an attempt (after).
// Reports the performance change and, for every screenshot both runs share, whether the image changed (SSIM).
// A change that moves a screenshot below the threshold changes the look: the user decides whether it is worth it.
// Usage: node perf-compare.ts <before-run> <after-run> [--backend webgpu] [--same 0.985]
// Writes <after-run>/perf-compare.md, perf-compare.json and perf-compare/<shot>.png (before | after) for changed shots.
// Needs ffmpeg. Exit 0 = report written, 2 = setup error.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** SSIM between two images (1 = identical), or null if ffmpeg cannot compare them. */
export function ssim(a: string, b: string): number | null {
  const r = spawnSync('ffmpeg', ['-v', 'info', '-i', a, '-i', b, '-lavfi', 'ssim', '-f', 'null', '-'], { encoding: 'utf8' });
  const m = r.stderr.match(/All:([\d.]+)/);
  return m?.[1] ? Number(m[1]) : null;
}

/** The numbers worth comparing from a playtest report. avgFrameMs is the work per frame (fps is capped by vsync). */
/** The parts of a game-judge playtest report.json read here. */
export interface PlaytestReport {
  pass: boolean;
  backends?: Record<
    string,
    {
      scenarios?: { bootMs?: number }[];
      perf?: { avgFrameMs?: number; worstFrameMs?: number; fps?: number } | null;
      network?: { requests?: { kb?: number }[] };
    }
  >;
}

const METRICS = ['avgFrameMs', 'worstFrameMs', 'bootMs', 'downloadKb'] as const;
type Metric = (typeof METRICS)[number];
export type Summary = Record<Metric | 'fps', number | null> & { pass: boolean };
type Shot = { name: string; ssim: number | null; changed: boolean; sideBySide: string | null };
export interface Comparison {
  backend: string;
  threshold: number;
  before: Summary;
  after: Summary;
  delta: Record<Metric, number | null>;
  shots: Shot[];
  lookChanged: boolean;
}

export function summarize(report: PlaytestReport, backend: string): Summary {
  const b = report.backends?.[backend];
  if (!b) throw new Error(`no ${backend} backend in the report`);
  const boots = (b.scenarios ?? []).map((s) => s.bootMs).filter((x): x is number => typeof x === 'number');
  return {
    avgFrameMs: b.perf?.avgFrameMs ?? null,
    worstFrameMs: b.perf?.worstFrameMs ?? null,
    fps: b.perf?.fps ?? null,
    bootMs: boots.length ? Math.round(boots.reduce((s, x) => s + x, 0) / boots.length) : null,
    downloadKb: b.network?.requests ? Math.round(b.network.requests.reduce((s, q) => s + (q.kb ?? 0), 0)) : null,
    pass: report.pass,
  };
}

export function compare(beforeDir: string, afterDir: string, { backend = 'webgpu', same = 0.985 } = {}): Comparison {
  const read = (d: string) => JSON.parse(readFileSync(join(d, 'report.json'), 'utf8')) as PlaytestReport;
  const before = summarize(read(beforeDir), backend);
  const after = summarize(read(afterDir), backend);
  const shotsDir = (d: string) => join(d, backend);
  const names = existsSync(shotsDir(beforeDir)) ? readdirSync(shotsDir(beforeDir)).filter((f) => f.endsWith('.png') && existsSync(join(shotsDir(afterDir), f))) : [];
  const outDir = join(afterDir, 'perf-compare');
  const shots: Shot[] = [];
  for (const name of names.sort()) {
    const a = join(shotsDir(beforeDir), name);
    const b = join(shotsDir(afterDir), name);
    const score = ssim(a, b);
    const changed = score === null || score < same;
    let sideBySide: string | null = null;
    if (changed) {
      mkdirSync(outDir, { recursive: true });
      sideBySide = join('perf-compare', name);
      spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', a, '-i', b, '-filter_complex', '[0][1]hstack', join(afterDir, sideBySide)]);
    }
    shots.push({ name, ssim: score, changed, sideBySide });
  }
  const delta = Object.fromEntries(
    METRICS.map((k) => {
      const [b, a] = [before[k], after[k]];
      return [k, b !== null && a !== null ? Number((a - b).toFixed(2)) : null];
    }),
  ) as Record<Metric, number | null>;
  return { backend, threshold: same, before, after, delta, shots, lookChanged: shots.some((s) => s.changed) };
}

function toMarkdown(r: Comparison): string {
  const fmt = (x: number | null) => (x === null ? '–' : Number(x.toFixed(2)));
  const row = (k: Metric, unit: string) => `| ${k} | ${fmt(r.before[k])} | ${fmt(r.after[k])} | ${r.delta[k] ?? '–'}${r.delta[k] !== null ? unit : ''} |`;
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
  const opt = (k: string, d: string): string => (args.includes(k) ? (args[args.indexOf(k) + 1] ?? d) : d);
  const [beforeDir, afterDir] = args.filter((a, i) => !a.startsWith('--') && !['--backend', '--same'].includes(args[i - 1] ?? ''));
  if (!beforeDir || !afterDir) {
    console.error('usage: perf-compare.ts <before-run> <after-run> [--backend webgpu] [--same 0.985]');
    process.exit(2);
  }
  if (spawnSync('ffmpeg', ['-version']).status !== 0) {
    console.error('perf-compare needs ffmpeg on PATH');
    process.exit(2);
  }
  try {
    const r = compare(beforeDir, afterDir, { backend: opt('--backend', 'webgpu'), same: Number(opt('--same', '0.985')) });
    const md = toMarkdown(r);
    writeFileSync(join(afterDir, 'perf-compare.json'), JSON.stringify(r, null, 2));
    writeFileSync(join(afterDir, 'perf-compare.md'), md);
    console.log(md);
  } catch (e) {
    console.error(`[perf-compare] ${e instanceof Error ? e.message : String(e)}`);
    process.exit(2);
  }
}
