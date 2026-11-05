#!/usr/bin/env node
// Build the visual-fidelity judge's evidence pack from a playtest run: every screenshot that names a reference frame
// (scenario step { "screenshot": "overview", "compare": "design/reference/keyart.png" }) becomes a same-height
// side-by-side image (left = reference, right = game) plus measured palettes and colour metrics for both.
// Judges read numbers from here instead of guessing hex values off the image.
// Usage: node visual-pack.ts <run-dir> [--project <dir>] [--backend webgpu]
// Writes <run-dir>/visual-pack/pack.md, pack.json and <shot>.png. Needs ffmpeg. Exit 2 on setup errors.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';

const SIZE = 96; // palette sample: SIZE x SIZE pixels (area-averaged)

export type RGB = [number, number, number];
export interface Swatch {
  hex: string;
  share: number;
  luma: number;
  hue: number;
}
export interface Metrics {
  meanLuma: number;
  meanSat: number;
  coolShare: number;
  warmShare: number;
  coolHue: number | null;
}
type Measured = { palette: Swatch[] } & Metrics;
export interface PackEntry {
  shot: string;
  ref: string;
  sideBySide: string;
  reference: Measured;
  game: Measured;
}
export interface Pack {
  backend: string;
  pairs: PackEntry[];
  context: string[];
  additions: string[] | null;
}
/** The parts of a playtest report.json read here. */
interface PlaytestReport {
  backends?: Record<string, { scenarios?: { compare?: { shot: string; ref: string }[]; screenshots?: string[] }[] }>;
}

/** RGB pixels of an image, scaled to SIZE x SIZE with area averaging (needs ffmpeg). */
export function pixels(path: string, size = SIZE): RGB[] {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', path, '-frames:v', '1', '-vf', `scale=${size}:${size}:flags=area`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 26 });
  if (r.status !== 0) throw new Error(`ffmpeg could not read ${path}: ${r.stderr}`);
  const px: RGB[] = [];
  const b = r.stdout;
  for (let i = 0; i + 2 < b.length; i += 3) px.push([b[i]!, b[i + 1]!, b[i + 2]!]);
  return px;
}

/** Deterministic k-means (seeded picks), same idea as key-art-direction's palette.py. */
export function palette(px: readonly RGB[], k = 6, iters = 20): Swatch[] {
  let seed = 1;
  const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const cents = Array.from({ length: k }, (): RGB => [...px[Math.floor(rand() * px.length)]!]);
  let groups: RGB[][] = [];
  for (let it = 0; it < iters; it++) {
    groups = cents.map((): RGB[] => []);
    for (const p of px) {
      let best = 0;
      let bd = Infinity;
      cents.forEach((c, i) => {
        const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2;
        if (d < bd) [bd, best] = [d, i];
      });
      groups[best]!.push(p);
    }
    groups.forEach((g, i) => {
      if (g.length) cents[i] = [0, 1, 2].map((d) => g.reduce((s, p) => s + p[d]!, 0) / g.length) as RGB;
    });
  }
  return cents
    .map((c, i) => ({ c: c.map((v) => Math.round(v)) as RGB, n: groups[i]?.length ?? 0 }))
    .filter((x) => x.n)
    .map(({ c, n }) => ({ hex: hex(c), share: round(n / px.length), luma: round(luma(c) / 255), hue: Math.round(hsv(c)[0]) }))
    .sort((a, b) => b.share - a.share);
}

/**
 * Whole-image colour metrics. cool/warm = share of clearly coloured pixels (saturation > 0.25, value > 0.12) whose hue
 * is blue (180-260 deg) or warm (0-60 deg, 330-360); coolHue = their mean hue. These answer "is it as blue / as warm".
 */
export function metrics(px: readonly RGB[]): Metrics {
  let L = 0;
  let S = 0;
  let cool = 0;
  let warm = 0;
  let hx = 0;
  let hy = 0;
  for (const p of px) {
    const [h, s, v] = hsv(p);
    L += luma(p) / 255;
    S += s;
    if (s > 0.25 && v > 0.12) {
      if (h >= 180 && h <= 260) {
        cool++;
        hx += Math.cos((h * Math.PI) / 180);
        hy += Math.sin((h * Math.PI) / 180);
      } else if (h <= 60 || h >= 330) warm++;
    }
  }
  const n = px.length;
  return { meanLuma: round(L / n), meanSat: round(S / n), coolShare: round(cool / n), warmShare: round(warm / n), coolHue: cool ? Math.round(((Math.atan2(hy, hx) * 180) / Math.PI + 360) % 360) : null };
}

const round = (x: number) => Math.round(x * 1000) / 1000;
const luma = ([r, g, b]: RGB) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const hex = (c: RGB) => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
function hsv([r, g, b]: RGB): RGB {
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const d = mx - mn;
  let h = 0;
  if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [((h * 60) + 360) % 360, mx ? d / mx : 0, mx / 255];
}

/** Pairs from the playtest report; without any "compare" steps, *overview* shots pair with design/reference/keyart.png. */
export function findPairs(report: PlaytestReport, _runDir: string, project: string, backend = 'webgpu'): { pairs: { shot: string; ref: string }[]; context: string[] } {
  const scen = report.backends?.[backend]?.scenarios ?? [];
  const pairs = scen.flatMap((s) => s.compare ?? []).map((c) => ({ shot: c.shot, ref: c.ref }));
  if (!pairs.length) {
    const key = 'design/reference/keyart.png';
    if (existsSync(join(project, key)))
      for (const s of scen) for (const shot of s.screenshots ?? []) if (/overview/.test(shot)) pairs.push({ shot, ref: key });
  }
  const paired = new Set(pairs.map((p) => p.shot));
  const context = scen.flatMap((s) => s.screenshots ?? []).filter((s) => !paired.has(s) && s.startsWith(`${backend}/`));
  return { pairs: pairs.filter((p) => p.shot.startsWith(`${backend}/`)), context };
}

/**
 * The brief's "What v1 adds that the video doesn't show" list, verbatim: the heading line (heading or plain line) and
 * every bullet under it. Judges missed it when it wasn't a markdown heading, and flagged listed additions as inventions.
 */
export function additions(project: string): string[] | null {
  const path = join(project, 'design/brief.md');
  if (!existsSync(path)) return null;
  const lines = readFileSync(path, 'utf8').split('\n');
  const i = lines.findIndex((l) => /what v1 adds/i.test(l));
  if (i < 0) return null;
  const out: string[] = [];
  for (let j = i + 1; j < lines.length; j++) {
    const line = lines[j] ?? '';
    if (!(/^\s*[-*] /.test(line) || (!out.length && !line.trim()))) break;
    if (line.trim()) out.push(line.trim());
  }
  return out;
}

export function buildPack(runDir: string, { project = process.cwd(), backend = 'webgpu' } = {}): Pack {
  const report = JSON.parse(readFileSync(join(runDir, 'report.json'), 'utf8')) as PlaytestReport;
  const { pairs, context } = findPairs(report, runDir, project, backend);
  const out = join(runDir, 'visual-pack');
  mkdirSync(out, { recursive: true });
  const entries: PackEntry[] = [];
  for (const { shot, ref } of pairs) {
    const shotPath = join(runDir, shot);
    const refPath = resolve(project, ref);
    if (!existsSync(shotPath) || !existsSync(refPath)) throw new Error(`missing ${!existsSync(shotPath) ? shotPath : refPath}`);
    const side = join(out, `${basename(shot, '.png')}.png`);
    const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', refPath, '-i', shotPath, '-filter_complex', '[0]scale=-2:720:flags=lanczos[a];[1]scale=-2:720[b];[a][b]hstack', side]);
    if (r.status !== 0) throw new Error(`ffmpeg side-by-side failed: ${r.stderr}`);
    const [rp, gp] = [pixels(refPath), pixels(shotPath)];
    entries.push({ shot, ref, sideBySide: relative(runDir, side), reference: { palette: palette(rp), ...metrics(rp) }, game: { palette: palette(gp), ...metrics(gp) } });
  }
  const pack: Pack = { backend, pairs: entries, context, additions: additions(project) };
  writeFileSync(join(out, 'pack.json'), JSON.stringify(pack, null, 2));
  writeFileSync(join(out, 'pack.md'), toMarkdown(pack));
  return pack;
}

function toMarkdown(pack: Pack): string {
  const pal = (p: Swatch[]) => p.map((c) => `\`${c.hex}\` ${Math.round(c.share * 100)}% (L ${c.luma}, hue ${c.hue}°)`).join(' · ');
  const L = ['# Visual pack', '', 'Measured with ffmpeg + k-means (96 x 96 area samples). Side-by-side images: **left = reference, right = game**, same height.', ''];
  if (!pack.pairs.length) L.push('No screenshot names a reference frame (`"compare"` in a screenshot step), so nothing is paired.', '');
  for (const e of pack.pairs) {
    L.push(`## ${e.shot} ↔ ${e.ref}`, '', `![side by side](${basename(e.sideBySide)})`, '');
    L.push('| | reference | game |', '|---|---|---|');
    for (const k of ['meanLuma', 'meanSat', 'coolShare', 'warmShare', 'coolHue'] as const) L.push(`| ${k} | ${e.reference[k] ?? '–'} | ${e.game[k] ?? '–'} |`);
    L.push('', `- reference palette: ${pal(e.reference.palette)}`, `- game palette: ${pal(e.game.palette)}`, '');
  }
  L.push('## Additions the brief lists (in the game on purpose, not in the reference)', '');
  L.push(...(pack.additions?.length ? pack.additions : ['- none listed (design/brief.md has no "What v1 adds" list)']), '');
  if (pack.context.length) L.push('## Context shots (no reference frame: judge polish and blockers only)', '', ...pack.context.map((c) => `- ${c}`), '');
  return L.join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const opt = (k: string, d: string): string => (args.includes(k) ? (args[args.indexOf(k) + 1] ?? d) : d);
  const runDir = args.find((a, i) => !a.startsWith('--') && !['--project', '--backend'].includes(args[i - 1] ?? ''));
  if (!runDir) {
    console.error('usage: visual-pack.ts <run-dir> [--project <dir>] [--backend webgpu]');
    process.exit(2);
  }
  if (spawnSync('ffmpeg', ['-version']).status !== 0) {
    console.error('visual-pack needs ffmpeg on PATH');
    process.exit(2);
  }
  try {
    const project = resolve(opt('--project', existsSync(join(runDir, '..', '..', '..', 'design')) ? join(runDir, '..', '..', '..') : process.cwd()));
    const pack = buildPack(runDir, { project, backend: opt('--backend', 'webgpu') });
    console.log(`[visual-pack] ${pack.pairs.length} pairs, ${pack.context.length} context shots -> ${join(runDir, 'visual-pack', 'pack.md')}`);
  } catch (e) {
    console.error(`[visual-pack] ${e instanceof Error ? e.message : String(e)}`);
    process.exit(2);
  }
}
