#!/usr/bin/env node
// Assemble the GitHub Pages site for the lab repo: site/* at the root, each example's release build at /<name>/.
// Used by .github/workflows/pages.yml and `pnpm site` (local preview: pnpm exec vite preview --outDir _site).
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const out = join(root, '_site');
const examples = ['minigolf', 'snowplough', 'blossomswing'];
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
  // the generated gameplay video a video-first game was built from, shown under "How they were made"
  const video = join(root, 'examples', name, 'design/reference/gameplay.mp4');
  if (existsSync(video)) {
    mkdirSync(join(out, 'media'), { recursive: true });
    cpSync(video, join(out, 'media', `${name}-gameplay.mp4`));
  }
}
for (const m of readFileSync(join(out, 'index.html'), 'utf8').matchAll(/(?:src|poster)="\.\/([^"]+)"/g)) {
  if (!existsSync(join(out, m[1]!))) {
    console.error(`site/index.html references ${m[1]}, which is not in _site/`);
    process.exit(1);
  }
}
console.log(`site assembled in _site/ (${examples.map((e) => `/${e}/`).join(', ')})`);
