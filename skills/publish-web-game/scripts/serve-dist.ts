#!/usr/bin/env node
// Serve dist/ the way a precompressed-aware host does (nginx brotli_static/gzip_static, Caddy `precompressed`):
// if the browser accepts br (or gzip) and <file>.br (or .gz) exists, send it with Content-Encoding.
// Dependency-free; for verifying `release.ts --precompress` locally.
//
//   node serve-dist.ts [dist] [--port 4180]      -> prints "serving <dir> at http://localhost:<port>/"
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';

const argv = process.argv.slice(2);
const port = Number(argv.includes('--port') ? argv[argv.indexOf('--port') + 1] : 4180);
const root = resolve(argv.find((a, i) => !a.startsWith('--') && argv[i - 1] !== '--port') ?? 'dist');
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.wasm': 'application/wasm', // required for WebAssembly.instantiateStreaming
  '.glb': 'model/gltf-binary',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
};

createServer((req, res) => {
  let path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
  if (path.endsWith('/')) path += 'index.html';
  const file = join(root, normalize(path).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(root) || !existsSync(file) || statSync(file).isDirectory()) {
    res.writeHead(404).end('not found');
    return;
  }
  const accept = req.headers['accept-encoding'] ?? '';
  const headers: Record<string, string> = { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', Vary: 'Accept-Encoding', 'Cache-Control': 'no-cache' };
  let body = file;
  if (/\bbr\b/.test(accept) && existsSync(`${file}.br`)) {
    body = `${file}.br`;
    headers['Content-Encoding'] = 'br';
  } else if (/\bgzip\b/.test(accept) && existsSync(`${file}.gz`)) {
    body = `${file}.gz`;
    headers['Content-Encoding'] = 'gzip';
  }
  res.writeHead(200, headers).end(readFileSync(body));
}).listen(port, () => console.log(`serving ${root} at http://localhost:${port}/`));
