// Parallel GLB loading with byte-accurate progress. Models live in public/models/<name>.glb (blender-assets).
// All models are fetched concurrently (fetch + stream byte counting), then parsed. In release builds
// asset-manifest.json (written by publish-web-game's release script) gives total sizes up front.
// Meshopt-compressed GLBs (release optimization) are decoded transparently.
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const BASE = import.meta.env.BASE_URL;
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const gltfs = new Map(); // name -> Promise<gltf>
let manifest;

function getManifest() {
  // dev server has no manifest; avoid a 404 (playtests fail on failed requests)
  manifest ??= import.meta.env.DEV
    ? Promise.resolve({})
    : fetch(`${BASE}asset-manifest.json`).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  return manifest;
}

async function fetchBytes(url, onBytes) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  if (!res.body) return res.arrayBuffer();
  const reader = res.body.getReader();
  const chunks = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    onBytes(received);
  }
  const out = new Uint8Array(received);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out.buffer;
}

/** Download + parse models in parallel. onProgress(0..1) is byte-based when sizes are known. */
export async function preloadModels(names, onProgress = () => {}) {
  const sizes = await getManifest();
  const total = names.reduce((s, n) => s + (sizes[`models/${n}.glb`] ?? 0), 0);
  const loaded = names.map(() => 0);
  let parsed = 0;
  const report = () => {
    const bytes = total ? loaded.reduce((s, b, i) => s + Math.min(b, sizes[`models/${names[i]}.glb`] ?? b), 0) / total : 0;
    onProgress(total ? 0.9 * bytes + 0.1 * (parsed / names.length) : parsed / names.length);
  };
  await Promise.all(
    names.map(async (n, i) => {
      if (!gltfs.has(n)) {
        const url = `${BASE}models/${n}.glb`;
        gltfs.set(n, fetchBytes(url, (b) => ((loaded[i] = b), report())).then((buf) => loader.parseAsync(buf, `${BASE}models/`)));
      }
      await gltfs.get(n);
      parsed++;
      report();
    }),
  );
}

/** A fresh clone of a (pre)loaded model's scene graph, shadows enabled. */
export async function loadModel(name) {
  if (!gltfs.has(name)) await preloadModels([name]);
  const gltf = await gltfs.get(name);
  const scene = gltf.scene.clone(true);
  scene.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  return scene;
}

/** Preload in parallel (with progress) and return { name: clonedScene }. */
export async function loadModels(names, onProgress = () => {}) {
  await preloadModels(names, onProgress);
  return Object.fromEntries(await Promise.all(names.map(async (n) => [n, await loadModel(n)])));
}
