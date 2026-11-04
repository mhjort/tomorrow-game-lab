#!/usr/bin/env node
// Validate skills/ for `pnpm dlx skills add` compatibility and lab conventions.
//  - SKILL.md has frontmatter with name (== dir, kebab-case) and description (30..1024 chars)
//  - SKILL.md body ≤ 200 lines (skills must stay lightweight; push detail into references/)
//  - every relative path mentioned as `scripts/...`, `references/...`, `judges/...`, `assets/...` exists in the skill
//  - skills are self-contained: no `../` imports out of the skill dir in scripts
//  - shell/python/node scripts are executable or invokable; .mjs/.js parse
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = new URL('..', import.meta.url).pathname;
const skillsDir = join(root, 'skills');
const errors = [];
const err = (skill, msg) => errors.push(`${skill}: ${msg}`);
const MAX_LINES = 200;

const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));

const names = readdirSync(skillsDir).filter((d) => statSync(join(skillsDir, d)).isDirectory());
for (const name of names) {
  const dir = join(skillsDir, name);
  const file = join(dir, 'SKILL.md');
  if (!existsSync(file)) {
    err(name, 'missing SKILL.md');
    continue;
  }
  const text = readFileSync(file, 'utf8');
  const fm = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (!fm) {
    err(name, 'missing frontmatter');
    continue;
  }
  const meta = Object.fromEntries(fm[1].split('\n').map((l) => l.match(/^(\w+):\s*(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].trim()]));
  if (meta.name !== name) err(name, `frontmatter name "${meta.name}" != directory name`);
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(meta.name ?? '')) err(name, 'name must be kebab-case');
  if (!meta.description || meta.description.length < 30 || meta.description.length > 1024) err(name, 'description must be 30..1024 chars');
  const lines = text.split('\n').length;
  if (lines > MAX_LINES) err(name, `SKILL.md has ${lines} lines (max ${MAX_LINES})`);

  // referenced files exist
  const refs = new Set([...text.matchAll(/`(?:<skill>\/)?((?:scripts|references|judges|assets)\/[\w./-]+?)`/g)].map((m) => m[1]));
  for (const ref of refs) {
    if (ref.includes('<') || ref.endsWith('/')) continue;
    if (/\*/.test(ref)) continue;
    if (!existsSync(join(dir, ref)) && !existsSync(join(dir, 'assets', 'template', ref))) err(name, `references missing file ${ref}`);
  }

  // scripts: self-contained + syntax
  for (const f of walk(dir)) {
    if (f.includes('node_modules')) continue;
    const rel = f.slice(dir.length + 1);
    if (/\.(mjs|js)$/.test(f)) {
      const src = readFileSync(f, 'utf8');
      if (/from\s+['"]\.\.\/\.\.\/\.\.\//.test(src) && !rel.startsWith('assets/template/')) err(name, `${rel} imports outside the skill`);
      if (!rel.startsWith('assets/template/src')) {
        const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
        if (r.status !== 0) err(name, `${rel} syntax error: ${r.stderr.split('\n').slice(0, 4).join(' ')}`);
      }
    }
    if (f.endsWith('.py')) {
      const r = spawnSync('python3', ['-c', 'import ast,sys; ast.parse(open(sys.argv[1]).read())', f], { encoding: 'utf8' });
      if (r.status !== 0) err(name, `${rel} python syntax error: ${r.stderr.trim().split('\n').pop()}`);
    }
    if (f.endsWith('.sh')) {
      if (!(statSync(f).mode & 0o111)) err(name, `${rel} is not executable`);
      const r = spawnSync('bash', ['-n', f], { encoding: 'utf8' });
      if (r.status !== 0) err(name, `${rel} bash syntax error: ${r.stderr.trim()}`);
    }
    if (f.endsWith('.json')) {
      try {
        JSON.parse(readFileSync(f, 'utf8'));
      } catch (e) {
        err(name, `${rel} invalid JSON: ${e.message}`);
      }
    }
  }
}

// the copy of lab_bpy.py in the example must match the skill's (it's a vendored helper)
const vendored = join(root, 'examples', 'minigolf', 'assets', 'src', 'lab_bpy.py');
if (existsSync(vendored) && readFileSync(vendored, 'utf8') !== readFileSync(join(skillsDir, 'blender-assets', 'scripts', 'lab_bpy.py'), 'utf8'))
  errors.push('examples/minigolf/assets/src/lab_bpy.py is out of date with skills/blender-assets/scripts/lab_bpy.py');
// the example's engine must match the template's engine
const tplEngine = join(skillsDir, 'web-game-runtime', 'assets', 'template', 'src', 'engine');
for (const f of readdirSync(tplEngine)) {
  const ex = join(root, 'examples', 'minigolf', 'src', 'engine', f);
  if (existsSync(ex) && readFileSync(ex, 'utf8') !== readFileSync(join(tplEngine, f), 'utf8'))
    errors.push(`examples/minigolf/src/engine/${f} differs from the template (sync it or upstream the change)`);
}

// vendored copies that must stay byte-identical to their source of truth
const same = [
  ['skills/publish-web-game/scripts/release.mjs', 'skills/web-game-runtime/assets/template/scripts/release.mjs'],
  ['skills/publish-web-game/scripts/release.mjs', 'examples/minigolf/scripts/release.mjs'],
  ['skills/web-game-runtime/assets/template/vite.config.js', 'examples/minigolf/vite.config.js'],
];
for (const [src, copy] of same) {
  if (!existsSync(join(root, copy))) errors.push(`${copy} missing (copy of ${src})`);
  else if (readFileSync(join(root, src), 'utf8') !== readFileSync(join(root, copy), 'utf8')) errors.push(`${copy} differs from ${src} (re-copy it)`);
}

if (errors.length) {
  console.error(`✗ ${errors.length} problem(s):\n  ${errors.join('\n  ')}`);
  process.exit(1);
}
console.log(`✓ ${names.length} skills valid: ${names.join(', ')}`);
