#!/usr/bin/env node
// Build every Blender asset script in assets/src/*.py -> public/models/<name>.glb (+ .lab/previews/<name>.png).
// Files starting with "_" or "lab_" are helpers and are skipped.
// Usage: npm run assets [-- name ...] [-- --no-preview]
import { readdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, basename } from 'node:path';

const args = process.argv.slice(2);
const only = args.filter((a) => !a.startsWith('--'));
const extra = args.filter((a) => a.startsWith('--'));
const blender =
  process.env.BLENDER ??
  (spawnSync('which', ['blender']).status === 0 ? 'blender' : '/Applications/Blender.app/Contents/MacOS/Blender');
if (blender !== 'blender' && !existsSync(blender)) {
  console.error('Blender not found. Set BLENDER=/path/to/blender');
  process.exit(127);
}
const scripts = readdirSync('assets/src')
  .filter((f) => f.endsWith('.py') && !f.startsWith('_') && !f.startsWith('lab_'))
  .filter((f) => !only.length || only.includes(basename(f, '.py')));
let failed = 0;
for (const f of scripts) {
  const t0 = Date.now();
  const r = spawnSync(blender, ['-b', '--factory-startup', '--python-exit-code', '1', '-P', join('assets/src', f), '--', ...extra], {
    encoding: 'utf8',
  });
  const ok = r.status === 0;
  if (!ok) failed++;
  const log = (r.stdout + r.stderr).split('\n').filter((l) => /\[lab_bpy\]|Error|Traceback|^\s+File /.test(l));
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${f} (${((Date.now() - t0) / 1000).toFixed(1)}s)\n  ${log.join('\n  ')}`);
}
process.exit(failed ? 1 : 0);
