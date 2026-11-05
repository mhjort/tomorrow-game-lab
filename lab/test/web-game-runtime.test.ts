import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { SKILLS, tmp, run } from './helpers.ts';

// The template is not a workspace package (so the scaffold never copies a node_modules); check it as an agent would
// use it: scaffold into a fresh dir, standalone install, then the strict type check its `pnpm build` runs first.
test('template: a fresh scaffold passes strict `pnpm typecheck`', { timeout: 180000 }, () => {
  const proj = tmp('template-tsc');
  const s = run(process.execPath, [join(SKILLS, 'web-game-runtime/scripts/scaffold.ts'), proj]);
  assert.equal(s.status, 0, s.stderr);
  assert.ok(existsSync(join(proj, 'tsconfig.json')));
  const i = run('pnpm', ['install', '--ignore-workspace', '--prefer-offline'], { cwd: proj });
  assert.equal(i.status, 0, i.stdout + i.stderr);
  const t = run('pnpm', ['run', 'typecheck'], { cwd: proj });
  assert.equal(t.status, 0, t.stdout + t.stderr);
});
