// Starter scene: replace the GAME section with your game. Keep the boot order:
// loading screen -> PARALLEL(renderer init, physics WASM, all models) -> style -> game objects -> prewarm
//   -> hooks -> loop -> loading.done() -> ready
// Every game boots through the loading screen: downloads run in parallel, then everything is prewarmed.
import * as THREE from 'three/webgpu';
import { createRenderer, fitToWindow } from './engine/renderer.ts';
import { applyStyle, paletteColor, style } from './engine/style.ts';
import { createPhysics } from './engine/physics.ts';
import { createLoop } from './engine/loop.ts';
import { createInput } from './engine/input.ts';
import { installTestHooks } from './engine/testHooks.ts';
import { createLoadingScreen, prewarm } from './engine/loading.ts';
import { loadModels } from './engine/assets.ts';

const MODELS: string[] = []; // GLB names in public/models/ (built by blender-assets), e.g. ['level1', 'player']

const loading = createLoadingScreen({ title: 'Web Game' });
// Download phase: everything at once, one combined progress bar.
const [{ renderer, backend }, physics, models] = await loading.parallel('Loading…', [
  { weight: 0.1, run: () => createRenderer() },
  { weight: 0.3, run: () => createPhysics() },
  { weight: 0.3, run: (p) => loadModels(MODELS, p) },
]);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(style.camera?.fov ?? 50, innerWidth / innerHeight, 0.1, 500);
camera.position.set(6, 5, 8);
camera.lookAt(0, 0, 0);
fitToWindow(renderer, camera);
applyStyle(scene, renderer);
const { RAPIER, world } = physics;
const input = createInput(renderer.domElement);

// ---------------------------------------------------------------- GAME
/** Everything __game.input() (and the bots) can do. */
export type Action = { type: 'impulse'; x?: number; y?: number; z?: number };
/** What __game.getState() returns (scenarios assert on it). */
export interface State {
  ball: { x: number; y: number; z: number };
}

const ground = new THREE.Mesh(new THREE.BoxGeometry(10, 0.2, 10), new THREE.MeshStandardMaterial({ color: paletteColor('primary') }));
ground.position.y = -0.1;
ground.receiveShadow = true;
scene.add(ground);
world.createCollider(RAPIER.ColliderDesc.cuboid(5, 0.1, 5).setTranslation(0, -0.1, 0));

const ball = new THREE.Mesh(new THREE.SphereGeometry(0.5, 32, 16), new THREE.MeshStandardMaterial({ color: paletteColor('accent') }));
ball.castShadow = true;
scene.add(ball);
const ballBody = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 3, 0));
world.createCollider(RAPIER.ColliderDesc.ball(0.5).setRestitution(0.5), ballBody);
physics.bind(ballBody, ball);

function act(action: Action): boolean {
  switch (action.type) {
    case 'impulse':
      ballBody.applyImpulse({ x: action.x ?? 0, y: action.y ?? 0, z: action.z ?? 0 }, true);
      return true;
    default:
      return false;
  }
}
input.on('dragend', ({ dx, dy }) => act({ type: 'impulse', x: dx * 0.01, y: 2, z: dy * 0.01 }));

function update(): void {
  if (input.down('Space')) act({ type: 'impulse', y: 0.3 });
  physics.step();
}
function getState(): State {
  const p = ballBody.translation();
  return { ball: { x: p.x, y: p.y, z: p.z } };
}
// ---------------------------------------------------------------- /GAME

// Compile every material/pipeline (incl. shadows) before play: the scene plus every level/model root.
await loading.step('Compiling shaders', 0.3, (p) => prewarm(renderer, scene, camera, [scene, ...Object.values(models)], p));

const loop = createLoop({
  renderer,
  update,
  render: () => {
    physics.sync();
    renderer.render(scene, camera);
  },
});
const hooks = installTestHooks({ backend, loop, getState, input: act });
loop.start();
loop.step(0);
loading.done();
hooks.ready = true;
