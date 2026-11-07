// The sky behind everything: a big inverted dome, skyTop high up fading to skyLow at the horizon (art bible), with
// no fog (the hills fade into skyLow through the scene fog instead).
import * as THREE from 'three/webgpu';
import { Fn, cameraPosition, mix, normalize, positionWorld, smoothstep, vec3, vec4 } from 'three/tsl';
import { paletteColor } from './engine/style.ts';

export function createSky(): THREE.Mesh {
  const top = vec3(...paletteColor('skyTop').toArray());
  const low = vec3(...paletteColor('skyLow').toArray());
  const mat = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false, fog: false });
  mat.colorNode = Fn(() => {
    // the view direction's elevation (the dome follows the camera, so this is independent of where it stands)
    const y = normalize(positionWorld.sub(cameraPosition)).y;
    return vec4(mix(low, top, smoothstep(0.0, 0.42, y)), 1);
  })();
  mat.toneMapped = false;
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16), mat);
  mesh.renderOrder = -10;
  mesh.frustumCulled = false;
  return mesh;
}
