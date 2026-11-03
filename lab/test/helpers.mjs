import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';

export const ROOT = new URL('../../', import.meta.url).pathname;
export const SKILLS = join(ROOT, 'skills');
export const has = (cmd) => spawnSync('which', [cmd]).status === 0;
export const hasBlender = () => !!process.env.BLENDER || has('blender') || spawnSync('test', ['-x', '/Applications/Blender.app/Contents/MacOS/Blender']).status === 0;
export const tmp = (prefix) => {
  const base = join(ROOT, 'lab', '.tmp');
  spawnSync('mkdir', ['-p', base]);
  return mkdtempSync(join(base, `${prefix}-`));
};
export const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', ...opts });
