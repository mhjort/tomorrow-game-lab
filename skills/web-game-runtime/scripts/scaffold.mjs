#!/usr/bin/env node
// Copy the game template into a project directory without overwriting existing files.
// Usage: node <skill>/scripts/scaffold.mjs [dest=.] [--force] [--lab-bpy <path/to/lab_bpy.py>]
// --lab-bpy copies the blender-assets helper into assets/src/ (pass the path from the blender-assets skill).
import { cpSync, existsSync, mkdirSync, readdirSync, statSync, copyFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const argv = process.argv.slice(2);
const force = argv.includes('--force');
const labIdx = argv.indexOf('--lab-bpy');
const labBpy = labIdx >= 0 ? argv[labIdx + 1] : null;
const dest = resolve(argv.find((a, i) => !a.startsWith('--') && argv[i - 1] !== '--lab-bpy') ?? '.');
const template = resolve(dirname(new URL(import.meta.url).pathname), '..', 'assets', 'template');

const created = [];
const skipped = [];
const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
for (const src of walk(template)) {
  const rel = relative(template, src);
  const out = join(dest, rel);
  if (existsSync(out) && !force) {
    skipped.push(rel);
    continue;
  }
  mkdirSync(dirname(out), { recursive: true });
  cpSync(src, out);
  created.push(rel);
}
if (labBpy) {
  mkdirSync(join(dest, 'assets', 'src'), { recursive: true });
  copyFileSync(resolve(labBpy), join(dest, 'assets', 'src', 'lab_bpy.py'));
  created.push('assets/src/lab_bpy.py');
}
console.log(`scaffolded ${created.length} files into ${dest}${skipped.length ? ` (kept ${skipped.length} existing: ${skipped.join(', ')})` : ''}`);
console.log('next: pnpm install && pnpm dev   (playtest: game-judge skill)');
