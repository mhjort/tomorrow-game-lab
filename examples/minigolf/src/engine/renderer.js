// WebGPU-first renderer with automatic WebGL2 fallback.
// Force WebGL2 with `?renderer=webgl2` (used by the playtest harness for backend parity checks).
import * as THREE from 'three/webgpu';

export const params = new URLSearchParams(location.search);
export const TEST_MODE = params.has('test');

export async function createRenderer({ container = document.body, antialias = true } = {}) {
  const forceWebGL = params.get('renderer') === 'webgl2';
  const renderer = new THREE.WebGPURenderer({ antialias, forceWebGL });
  renderer.setPixelRatio(TEST_MODE ? 1 : Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap; // PCFSoft is removed in WebGPURenderer; soften with light.shadow.radius
  container.appendChild(renderer.domElement);
  await renderer.init();
  const backend = renderer.backend.isWebGPUBackend ? 'webgpu' : 'webgl2';
  console.info(`[game] renderer backend: ${backend}`);
  return { renderer, backend };
}

export function fitToWindow(renderer, camera) {
  const resize = () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  };
  addEventListener('resize', resize);
  resize();
}
