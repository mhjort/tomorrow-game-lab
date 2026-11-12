#!/usr/bin/env node
// Compare the screenshots of two game-judge playtest runs of the same game: did an asset setting change the look?
// Usage: node compare-shots.ts <before-run> <after-run> [--backend webgpu] [--same 0.985]
// For every screenshot both runs share: SSIM (1 = identical) and "same" at >= the threshold. Changed shots get a
// side-by-side image (before | after) in <after-run>/compare-shots/. Writes <after-run>/compare-shots.json.
// Needs ffmpeg. Exit 0 = every shot same, 1 = some shot changed, 2 = setup error.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** SSIM between two images (1 = identical), or null if ffmpeg cannot compare them (e.g. different sizes). */
export function ssim(a: string, b: string): number | null {
  const r = spawnSync('ffmpeg', ['-v', 'info', '-i', a, '-i', b, '-lavfi', 'ssim', '-f', 'null', '-'], { encoding: 'utf8' });
  const m = r.stderr.match(/All:([\d.]+)/);
  return m?.[1] ? Number(m[1]) : null;
}

export interface ShotResult {
  name: string;
  ssim: number | null;
  same: boolean;
  sideBySide: string | null;
}

export function compareShots(beforeDir: string, afterDir: string, { backend = 'webgpu', same = 0.985 } = {}): ShotResult[] {
  const dir = (d: string) => join(d, backend);
  if (!existsSync(dir(beforeDir)) || !existsSync(dir(afterDir))) throw new Error(`no ${backend}/ screenshots in both runs`);
  const names = readdirSync(dir(beforeDir)).filter((f) => f.endsWith('.png') && existsSync(join(dir(afterDir), f)));
  if (!names.length) throw new Error('the runs share no screenshots');
  return names.sort().map((name) => {
    const a = join(dir(beforeDir), name);
    const b = join(dir(afterDir), name);
    const score = ssim(a, b);
    const ok = score !== null && score >= same;
    let sideBySide: string | null = null;
    if (!ok) {
      mkdirSync(join(afterDir, 'compare-shots'), { recursive: true });
      sideBySide = join(afterDir, 'compare-shots', name);
      spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', a, '-i', b, '-filter_complex', '[0][1]hstack', sideBySide]);
    }
    return { name, ssim: score, same: ok, sideBySide };
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const opt = (k: string, d: string): string => (args.includes(k) ? (args[args.indexOf(k) + 1] ?? d) : d);
  const [beforeDir, afterDir] = args.filter((a, i) => !a.startsWith('--') && !['--backend', '--same'].includes(args[i - 1] ?? ''));
  if (!beforeDir || !afterDir) {
    console.error('usage: compare-shots.ts <before-run> <after-run> [--backend webgpu] [--same 0.985]');
    process.exit(2);
  }
  if (spawnSync('ffmpeg', ['-version']).status !== 0) {
    console.error('compare-shots needs ffmpeg on PATH');
    process.exit(2);
  }
  try {
    const threshold = Number(opt('--same', '0.985'));
    const shots = compareShots(beforeDir, afterDir, { backend: opt('--backend', 'webgpu'), same: threshold });
    writeFileSync(join(afterDir, 'compare-shots.json'), JSON.stringify({ threshold, shots }, null, 2));
    for (const s of shots) console.log(`${s.same ? 'same   ' : 'CHANGED'} ${s.ssim === null ? '  n/a ' : s.ssim.toFixed(4)} ${s.name}${s.sideBySide ? `  -> ${s.sideBySide}` : ''}`);
    const changed = shots.filter((s) => !s.same).length;
    console.log(changed ? `${changed} of ${shots.length} screenshots changed: show the user the side-by-side images` : `all ${shots.length} screenshots same (SSIM >= ${threshold})`);
    process.exit(changed ? 1 : 0);
  } catch (e) {
    console.error(`[compare-shots] ${e instanceof Error ? e.message : String(e)}`);
    process.exit(2);
  }
}
