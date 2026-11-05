// Apply design/style.json (written by key-art-direction) to scene, lights and renderer.
// applyStyle() returns { sun, hemi, refreshShadows }.
import * as THREE from 'three/webgpu';
import styleJson from '../../design/style.json';

/** Shape of design/style.json. Assigning the JSON to it below type-checks the file. */
export interface Style {
  palette: Record<string, string>;
  background: string;
  fog?: { color: string; near: number; far: number };
  sun: { color: string; intensity: number; elevation: number; azimuth: number; shadows?: boolean };
  ambient: { color: string; ground?: string; intensity: number };
  materials?: { roughness?: number; metalness?: number };
  camera?: { fov?: number };
  toneMapping?: string;
  exposure?: number;
}

export const style: Style = styleJson;

const TONE: Record<string, THREE.ToneMapping> = {
  ACES: THREE.ACESFilmicToneMapping,
  AgX: THREE.AgXToneMapping,
  Neutral: THREE.NeutralToneMapping,
  None: THREE.NoToneMapping,
};

export function applyStyle(
  scene: THREE.Scene,
  renderer: THREE.WebGPURenderer,
  { shadowArea = 20 } = {},
): { sun: THREE.DirectionalLight; hemi: THREE.HemisphereLight; refreshShadows: () => void } {
  scene.background = new THREE.Color(style.background);
  if (style.fog) scene.fog = new THREE.Fog(style.fog.color, style.fog.near, style.fog.far);
  renderer.toneMapping = TONE[style.toneMapping ?? 'ACES'] ?? THREE.ACESFilmicToneMapping;
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
  // Call after adding/removing level geometry (needed when shadow.autoUpdate is off; harmless otherwise).
  const refreshShadows = () => {
    sun.shadow.needsUpdate = true;
  };
  return { sun, hemi, refreshShadows };
}

/** Palette colour by key ('primary', 'accent', ...) or hex. */
export const paletteColor = (k: string): THREE.Color => new THREE.Color(style.palette[k] ?? k);
