#!/usr/bin/env node
// Validate skills/ for `pnpm dlx skills add` compatibility and lab conventions.
//  - SKILL.md has frontmatter with name (== dir, kebab-case) and description (30..1024 chars)
//  - SKILL.md body ≤ 200 lines (skills must stay lightweight; push detail into references/)
//  - every relative path mentioned as `scripts/...`, `references/...`, `judges/...`, `assets/...` exists in the skill
//  - skills are self-contained: no `../` imports out of the skill dir in scripts
//  - TypeScript only: no .js/.mjs/.cjs sources in skills/ or examples/ (type checking itself is `pnpm typecheck`)
//  - shell/python scripts parse, shell scripts are executable, JSON parses
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = new URL('..', import.meta.url).pathname;
const skillsDir = join(root, 'skills');
const errors: string[] = [];
const err = (skill: string, msg: string) => errors.push(`${skill}: ${msg}`);
const MAX_LINES = 200;
const JS = /\.(js|mjs|cjs)$/;

const walk = (d: string): string[] =>
  readdirSync(d, { withFileTypes: true })
    .filter((e) => !['node_modules', 'dist', '.lab'].includes(e.name))
    .flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));

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
  if (!fm?.[1]) {
    err(name, 'missing frontmatter');
    continue;
  }
  const meta: Record<string, string> = {};
  for (const l of fm[1].split('\n')) {
    const m = l.match(/^(\w+):\s*(.*)$/);
    if (m?.[1] && m[2] !== undefined) meta[m[1]] = m[2].trim();
  }
  if (meta['name'] !== name) err(name, `frontmatter name "${meta['name']}" != directory name`);
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(meta['name'] ?? '')) err(name, 'name must be kebab-case');
  const description = meta['description'];
  if (!description || description.length < 30 || description.length > 1024) err(name, 'description must be 30..1024 chars');
  const lines = text.split('\n').length;
  if (lines > MAX_LINES) err(name, `SKILL.md has ${lines} lines (max ${MAX_LINES})`);

  // referenced files exist
  const refs = new Set([...text.matchAll(/`(?:<skill>\/)?((?:scripts|references|judges|assets)\/[\w./-]+?)`/g)].flatMap((m) => (m[1] ? [m[1]] : [])));
  for (const ref of refs) {
    if (ref.includes('<') || ref.endsWith('/')) continue;
    if (/\*/.test(ref)) continue;
    if (!existsSync(join(dir, ref)) && !existsSync(join(dir, 'assets', 'template', ref))) err(name, `references missing file ${ref}`);
  }

  // scripts: self-contained + syntax
  for (const f of walk(dir)) {
    const rel = f.slice(dir.length + 1);
    if (JS.test(f)) err(name, `${rel} is JavaScript: write TypeScript (.ts)`);
    if (f.endsWith('.ts')) {
      const src = readFileSync(f, 'utf8');
      if (/from\s+['"]\.\.\/\.\.\/\.\.\//.test(src) && !rel.startsWith('assets/template/')) err(name, `${rel} imports outside the skill`);
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
        err(name, `${rel} invalid JSON: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }
}

// every example vendors the blender helpers, the template's engine and scripts: they must not drift
const EXAMPLES = readdirSync(join(root, 'examples')).filter((d) => existsSync(join(root, 'examples', d, 'package.json')));
const tplEngine = join(skillsDir, 'web-game-runtime', 'assets', 'template', 'src', 'engine');
for (const ex of EXAMPLES) {
  for (const f of walk(join(root, 'examples', ex))) if (JS.test(f)) errors.push(`${relative(root, f)} is JavaScript: write TypeScript (.ts)`);
  for (const h of ['lab_bpy.py', 'lab_rig.py']) {
    const vendored = join(root, 'examples', ex, 'assets', 'src', h);
    if (existsSync(vendored) && readFileSync(vendored, 'utf8') !== readFileSync(join(skillsDir, 'blender-assets', 'scripts', h), 'utf8'))
      errors.push(`examples/${ex}/assets/src/${h} is out of date with skills/blender-assets/scripts/${h}`);
  }
  for (const f of readdirSync(tplEngine)) {
    const copy = join(root, 'examples', ex, 'src', 'engine', f);
    if (existsSync(copy) && readFileSync(copy, 'utf8') !== readFileSync(join(tplEngine, f), 'utf8'))
      errors.push(`examples/${ex}/src/engine/${f} differs from the template (sync it or upstream the change)`);
  }
}

// vendored copies that must stay byte-identical to their source of truth
const TPL = 'skills/web-game-runtime/assets/template';
const same: [string, string][] = [
  ['skills/publish-web-game/scripts/release.ts', `${TPL}/scripts/release.ts`],
  ['skills/generate-media/scripts/generate-media.ts', `${TPL}/scripts/generate-media.ts`],
  ['skills/generate-media/scripts/preview_glb.py', `${TPL}/scripts/preview_glb.py`],
  ...EXAMPLES.flatMap((ex): [string, string][] => [
    ['skills/publish-web-game/scripts/release.ts', `examples/${ex}/scripts/release.ts`],
    [`${TPL}/vite.config.ts`, `examples/${ex}/vite.config.ts`],
    [`${TPL}/tsconfig.json`, `examples/${ex}/tsconfig.json`],
    ['skills/generate-media/scripts/generate-media.ts', `examples/${ex}/scripts/generate-media.ts`],
    ['skills/generate-media/scripts/preview_glb.py', `examples/${ex}/scripts/preview_glb.py`],
  ]),
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
