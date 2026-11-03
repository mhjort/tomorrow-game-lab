// Cached GLB loading. Models live in public/models/<name>.glb (built by blender-assets).
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const loader = new GLTFLoader();
const cache = new Map();

/** Load a model once; every call returns a fresh clone of the scene graph. */
export async function loadModel(name) {
  if (!cache.has(name)) cache.set(name, loader.loadAsync(`${import.meta.env.BASE_URL}models/${name}.glb`));
  const gltf = await cache.get(name);
  const scene = gltf.scene.clone(true);
  scene.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  return scene;
}

export async function loadModels(names) {
  return Object.fromEntries(await Promise.all(names.map(async (n) => [n, await loadModel(n)])));
}
