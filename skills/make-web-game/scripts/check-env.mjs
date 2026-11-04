#!/usr/bin/env node
// Check the toolchain the web-game skills need. Prints a table; exit 1 if anything required is missing.
// Usage: node <skill>/scripts/check-env.mjs
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const ver = (cmd, args = ['--version']) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  return r.status === 0 ? (r.stdout || r.stderr).split('\n')[0].trim() : null;
};
const firstExisting = (paths) => paths.find((p) => p && existsSync(p)) ?? null;

const blenderPath = process.env.BLENDER ?? (ver('blender') ? 'blender' : firstExisting(['/Applications/Blender.app/Contents/MacOS/Blender', '/usr/bin/blender', '/snap/bin/blender']));
const chromePath = firstExisting([
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
]);
// The lab tracks the latest stable releases: Node 26 LTS, Blender 5.2 LTS.
const atLeast = (v, min) => {
  const a = (v?.match(/\d+(\.\d+)*/)?.[0] ?? '0').split('.').map(Number);
  for (let i = 0; i < min.length; i++) if ((a[i] ?? 0) !== min[i]) return (a[i] ?? 0) > min[i];
  return true;
};
const blenderVer = blenderPath && ver(blenderPath)?.replace(/^Blender\s*/, '');
const rows = [
  ['node ≥ 24 (26 LTS preferred)', process.versions.node, atLeast(process.versions.node, [24]), true],
  ['pnpm', ver('pnpm'), !!ver('pnpm'), true],
  ['Google Chrome (playtests)', chromePath, !!chromePath, true],
  ['Blender ≥ 5.2 LTS (assets)', blenderVer, !!blenderPath && atLeast(blenderVer, [5, 2]), true],
  ['ffmpeg (video refs, parity)', ver('ffmpeg', ['-version'])?.split(' ').slice(0, 3).join(' '), !!ver('ffmpeg', ['-version']), false],
  ['python3 (palette)', ver('python3'), !!ver('python3'), false],
  ['RUNWARE_API_KEY (generated media)', process.env.RUNWARE_API_KEY ? 'set' : null, !!process.env.RUNWARE_API_KEY, false], // never print the value
];
let missing = 0;
for (const [name, value, ok, required] of rows) {
  if (!ok && required) missing++;
  console.log(`${ok ? '✓' : required ? '✗' : '!'} ${name.padEnd(28)} ${value ?? 'not found'}`);
}
if (blenderPath && blenderPath !== 'blender') console.log(`  hint: export BLENDER="${blenderPath}"`);
process.exit(missing ? 1 : 0);
