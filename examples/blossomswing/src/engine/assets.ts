// Parallel GLB loading with byte-accurate progress (fetchBytes/assetSize are shared with audio.ts). Models live in public/models/<name>.glb (blender-assets).
// All models are fetched concurrently (fetch + stream byte counting), then parsed. In release builds
// asset-manifest.json (written by publish-web-game's release script) gives total sizes up front.
// Meshopt-compressed GLBs (release optimization) are decoded transparently.
import type * as THREE from 'three/webgpu';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

export type Progress = (p: number) => void;

const BASE = import.meta.env.BASE_URL;
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const gltfs = new Map<string, Promise<GLTF>>();
let manifest: Promise<Record<string, number>> | undefined;

function getManifest(): Promise<Record<string, number>> {
  // dev server has no manifest; avoid a 404 (playtests fail on failed requests)
  manifest ??= import.meta.env.DEV
    ? Promise.resolve({})
    : fetch(`${BASE}asset-manifest.json`)
        .then((r) => (r.ok ? (r.json() as Promise<Record<string, number>>) : {}))
        .catch(() => ({}));
  return manifest;
}

/** Byte size of a dist-relative asset path (e.g. 'models/ball.glb', 'sfx/putt.mp3') from the manifest, 0 if unknown. */
export async function assetSize(path: string): Promise<number> {
  return (await getManifest())[path] ?? 0;
}

/** fetch() a URL as an ArrayBuffer, reporting bytes received so far to onBytes. */
export async function fetchBytes(url: string, onBytes: (bytes: number) => void = () => {}): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  if (!res.body) return res.arrayBuffer();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
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
export async function preloadModels(names: readonly string[], onProgress: Progress = () => {}): Promise<void> {
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
        gltfs.set(
          n,
          fetchBytes(url, (b) => ((loaded[i] = b), report())).then((buf) => loader.parseAsync(buf, `${BASE}models/`)),
        );
      }
      await gltfs.get(n);
      parsed++;
      report();
    }),
  );
}

/** A fresh clone of a (pre)loaded model's scene graph, shadows enabled. Rigged models are cloned with their own
 * skeleton, and their clips are on `userData.animations` (play them with createAnimator from animation.ts). */
export async function loadModel(name: string): Promise<THREE.Object3D> {
  if (!gltfs.has(name)) await preloadModels([name]);
  const gltf = await gltfs.get(name)!;
  let skinned = false;
  gltf.scene.traverse((o) => (skinned ||= (o as THREE.SkinnedMesh).isSkinnedMesh === true));
  // Object3D.clone() would share one skeleton between all copies (and bind them to the original's bones)
  const scene = skinned ? SkeletonUtils.clone(gltf.scene) : gltf.scene.clone(true);
  scene.userData['animations'] = gltf.animations;
  scene.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  return scene;
}

/** Preload in parallel (with progress) and return { name: clonedScene }. */
export async function loadModels(names: readonly string[], onProgress: Progress = () => {}): Promise<Record<string, THREE.Object3D>> {
  await preloadModels(names, onProgress);
  return Object.fromEntries(await Promise.all(names.map(async (n) => [n, await loadModel(n)] as const)));
}
