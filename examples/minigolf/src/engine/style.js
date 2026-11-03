// Apply design/style.json (written by key-art-direction) to scene, lights and renderer.
import * as THREE from 'three/webgpu';
import style from '../../design/style.json';

export { style };

const TONE = { ACES: THREE.ACESFilmicToneMapping, AgX: THREE.AgXToneMapping, Neutral: THREE.NeutralToneMapping, None: THREE.NoToneMapping };

export function applyStyle(scene, renderer, { shadowArea = 20 } = {}) {
  scene.background = new THREE.Color(style.background);
  if (style.fog) scene.fog = new THREE.Fog(style.fog.color, style.fog.near, style.fog.far);
  renderer.toneMapping = TONE[style.toneMapping] ?? THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = style.exposure ?? 1;

  const amb = style.ambient;
  const hemi = new THREE.HemisphereLight(amb.color, amb.ground ?? amb.color, amb.intensity);
  scene.add(hemi);

  const s = style.sun;
  const sun = new THREE.DirectionalLight(s.color, s.intensity);
  const el = THREE.MathUtils.degToRad(s.elevation);
  const az = THREE.MathUtils.degToRad(s.azimuth);
  sun.position.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).multiplyScalar(30);
  if (s.shadows !== false) {
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const c = sun.shadow.camera;
    c.left = c.bottom = -shadowArea;
    c.right = c.top = shadowArea;
    c.near = 1;
    c.far = 80;
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.02;
  }
  scene.add(sun, sun.target);
  return { sun, hemi };
}

/** Palette colour by key ('primary', 'accent', ...) or hex. */
export const paletteColor = (k) => new THREE.Color(style.palette[k] ?? k);
