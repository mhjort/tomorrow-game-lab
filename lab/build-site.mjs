#!/usr/bin/env node
// Assemble the GitHub Pages site for the lab repo: site/* at the root, each example's release build at /<name>/.
// Used by .github/workflows/pages.yml and `pnpm site` (local preview: pnpm exec vite preview --outDir _site).
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const out = join(root, '_site');
const examples = ['minigolf'];
rmSync(out, { recursive: true, force: true });
mkdirSync(out);
cpSync(join(root, 'site'), out, { recursive: true });
for (const name of examples) {
  const dist = join(root, 'examples', name, 'dist');
  if (!existsSync(join(dist, 'index.html'))) {
    console.error(`examples/${name}/dist missing — run: pnpm --filter ${name} release`);
    process.exit(1);
  }
  cpSync(dist, join(out, name), { recursive: true });
}
console.log(`site assembled in _site/ (${examples.map((e) => `/${e}/`).join(', ')})`);
