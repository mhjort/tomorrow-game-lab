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

/**
 * Advance three's node-frame counter. Shadow maps (and other per-frame node updates) refresh at most once per
 * animation frame; the counter normally ticks on the renderer's internal requestAnimationFrame. Test-mode
 * step() renders synchronously, possibly several times per animation frame, so without this a render right
 * after a level swap can reuse the previous level's shadow map. Uses a private field (three r18x).
 */
export function advanceFrame(renderer) {
  const nodeFrame = renderer._nodes?.nodeFrame;
  if (nodeFrame) nodeFrame.frameId++;
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
