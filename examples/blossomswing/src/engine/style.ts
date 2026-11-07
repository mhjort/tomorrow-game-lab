// Apply design/style.json (written by key-art-direction) to scene, lights and renderer.
// applyStyle() returns { sun, hemi, refreshShadows, setTheme }.
// Optional per-level themes: style.json "themes": { "snow": { "background": ..., "sun": {...}, "palette": {...} } }
// are partial styles merged over the base. setTheme(name) swaps background, fog and light colours/directions; these
// are uniforms, so a theme switch never recompiles shaders (keep fog on or off in every theme, or it does).
// Blender asset scripts read the same themes with lab_bpy.load_style(theme=...).
import * as THREE from 'three/webgpu';
import styleJson from '../../design/style.json';

/** The parts of a style a theme can override. */
export interface ThemeStyle {
  palette?: Record<string, string>;
  background?: string;
  fog?: { color: string; near: number; far: number };
  sun?: Partial<Style['sun']>;
  ambient?: Partial<Style['ambient']>;
  exposure?: number;
}

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
  themes?: Record<string, ThemeStyle>;
}

export const style: Style = styleJson;

/** The base style with theme `name` merged over it (palette, sun and ambient merge key by key). */
export function themeStyle(name: string): Style {
  const t = style.themes?.[name];
  if (!t) throw new Error(`style.json has no theme "${name}"`);
  return {
    ...style,
    ...(t.background !== undefined && { background: t.background }),
    ...(t.fog !== undefined && { fog: t.fog }),
    ...(t.exposure !== undefined && { exposure: t.exposure }),
    palette: { ...style.palette, ...t.palette },
    sun: { ...style.sun, ...t.sun },
    ambient: { ...style.ambient, ...t.ambient },
  };
}

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
): {
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  refreshShadows: () => void;
  /** Switch to a style.json theme (null = the base style). Cheap: no shader recompiles. */
  setTheme: (name: string | null) => void;
} {
  renderer.toneMapping = TONE[style.toneMapping ?? 'ACES'] ?? THREE.ACESFilmicToneMapping;
  const hemi = new THREE.HemisphereLight();
  const sun = new THREE.DirectionalLight();
  scene.add(hemi);
  const setTheme = (name: string | null) => {
    const st = name === null ? style : themeStyle(name);
    scene.background = new THREE.Color(st.background);
    if (st.fog) {
      const fog = scene.fog instanceof THREE.Fog ? scene.fog : new THREE.Fog(st.fog.color);
      fog.color.set(st.fog.color);
      fog.near = st.fog.near;
      fog.far = st.fog.far;
      scene.fog = fog;
    } else scene.fog = null;
    renderer.toneMappingExposure = st.exposure ?? 1;
    const amb = st.ambient;
    hemi.color.set(amb.color);
    hemi.groundColor.set(amb.ground ?? amb.color);
    hemi.intensity = amb.intensity;
    const s = st.sun;
    sun.color.set(s.color);
    sun.intensity = s.intensity;
    const el = THREE.MathUtils.degToRad(s.elevation);
    const az = THREE.MathUtils.degToRad(s.azimuth);
    sun.position.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).multiplyScalar(30);
    sun.shadow.needsUpdate = true;
  };
  setTheme(null);
  if (style.sun.shadows !== false) {
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
  return { sun, hemi, refreshShadows, setTheme };
}

/** Palette colour by key ('primary', 'accent', ...) or hex. */
export const paletteColor = (k: string): THREE.Color => new THREE.Color(style.palette[k] ?? k);
