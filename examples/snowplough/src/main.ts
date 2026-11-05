// Little Plough — clear snowed-in streets so every villager can reach the lantern square by 18:00.
// Built video-first from design/reference/gameplay.mp4 (see design/brief.md). Boot order: loading screen ->
// PARALLEL(renderer, models, sounds, music) -> style -> game objects -> prewarm -> hooks -> loop -> ready.
import * as THREE from 'three/webgpu';
import { createRenderer, fitToWindow, params } from './engine/renderer.ts';
import { applyStyle, style } from './engine/style.ts';
import { createLoop } from './engine/loop.ts';
import { createInput } from './engine/input.ts';
import { installTestHooks, createRng } from './engine/testHooks.ts';
import { createLoadingScreen, prewarm } from './engine/loading.ts';
import { loadModels, loadModel, preloadModels } from './engine/assets.ts';
import { emissive, mrt, output, pass } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { createAnimator } from './engine/animation.ts';
import { createAudio } from './engine/audio.ts';
import { HOUSES, SQUARE, START, createSnow, reachFromSquare, cellIndex, type Cell, type Facing, type Point } from './world.ts';
import { createFieldMesh, createSnowMesh } from './snow.ts';
import { PLOUGH, createPlough, stepPlough, type Controls, type Plough } from './plough.ts';
import { createVillagers, replan, startWalks, stepVillagers, type Villager, type VillagerState } from './villagers.ts';
import { createHud, type Phase } from './hud.ts';
import { OUTFITS, outfitMaterial } from './outfits.ts';

type CamMode = 'chase' | 'high' | 'overview';
/** Everything __game.input() (and the keyboard / pointer) can do. */
export type Action =
  | { type: 'drive'; throttle?: number; steer?: number }
  | { type: 'reset' }
  | { type: 'camera'; mode: CamMode }
  | { type: 'teleport'; x: number; z: number; heading?: number } // test helper
  | { type: 'setTime'; seconds: number }; // test helper
/** What __game.getState() returns (scenarios and bots read it). */
export interface State {
  phase: Phase;
  timeLeft: number;
  clock: number;
  total: number;
  reached: number;
  arrived: number;
  plough: { x: number; z: number; heading: number; speed: number; load: number };
  controls: Controls;
  cleared: number;
  villagers: { house: number; state: VillagerState; x: number; z: number }[];
  houses: { index: number; wait: Point; mouth: Cell; facing: Facing; tile: [number, number] }[];
  square: Point;
  camera: CamMode | 'festival';
  fireBlazing: boolean;
  outfits: number;
  cheering: number;
  lit: number[];
  flash: string | null;
  muted: boolean;
  bumps: number;
  lastBump: { before: number; after: number } | null;
  anims: Record<string, number>;
  sfx: Record<string, number>;
  music: string | null;
}

type StdMesh = THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
const isMesh = (o: THREE.Object3D): o is StdMesh => (o as THREE.Mesh).isMesh === true;
function must<T>(v: T | null | undefined, what: string): T {
  if (v === null || v === undefined) throw new Error(`missing ${what}`);
  return v;
}

const TIME = Number(params.get('time')) || 150; // seconds from 17:00 to the 18:00 festival (?time=N to review)
const SFX = ['scrape', 'bump', 'chime']; // public/sfx/*.mp3 (design/media.json)
const MUSIC = ['theme', 'festival']; // public/music/*.mp3: the play loop and the win jingle (one-shot)
const DRAG_DEAD = 12; // px
const DRAG_FULL = 80; // px from the press point for full throttle / full lock

const loading = createLoadingScreen({ title: 'Little Plough', image: 'images/splash.webp' });
const audio = createAudio({ musicVolume: 0.45 });
const [{ renderer, backend }, models] = await loading.parallel('Loading the village…', [
  { weight: 0.1, run: () => createRenderer() },
  { weight: 0.6, run: (p) => Promise.all([loadModels(['village', 'plough'], (x) => p(x * 0.75)), preloadModels(['villager'], (x) => p(0.75 + x * 0.25))]).then(([m]) => m) },
  { weight: 0.1, run: (p) => audio.load(SFX, p) },
  { weight: 0.2, run: (p) => audio.loadMusic(MUSIC, p) },
]);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(style.camera?.fov ?? 30, innerWidth / innerHeight, 0.3, 220);
fitToWindow(renderer, camera);
const { sun } = applyStyle(scene, renderer, { shadowArea: 22 });
sun.shadow.radius = 3; // soft-edged moon shadows, like the video's (PCF blur)
const input = createInput(renderer.domElement);
const hud = createHud(must(document.getElementById('hud'), '#hud'));

// ---------------------------------------------------------------- world
const village = must(models['village'], 'village model');
village.traverse((o) => {
  if (isMesh(o)) o.castShadow = o.receiveShadow = true;
});
scene.add(village);
const lampOn = (() => {
  let m: THREE.Material | undefined;
  village.traverse((o) => {
    if (isMesh(o)) for (const x of ([] as THREE.Material[]).concat(o.material)) if (x.name === 'lampOn') m = x;
  });
  return must(m, 'lampOn material');
})();
// the square's fire pit (design/reference/crops/square.png): it smoulders all game and blazes up at the festival
const fire = must(village.getObjectByName('Fire'), 'Fire') as StdMesh;
const fireMat = fire.material.clone();
fire.material = fireMat;
interface FireLevel {
  scale: number;
  glow: number;
}
const FIRE: Record<'idle' | 'festival', FireLevel> = { idle: { scale: 0.6, glow: 1.2 }, festival: { scale: 1.3, glow: 2.2 } };
const lampMesh = HOUSES.map((h) => must(village.getObjectByName(`Lamp_${h.index}`), `Lamp_${h.index}`) as THREE.Mesh);
const lampOff = must(lampMesh[0], 'a lamp').material;
const lampPos = lampMesh.map((m) => m.getWorldPosition(new THREE.Vector3()));
const pools: THREE.Vector3[] = [];
village.traverse((o) => o.name.startsWith('Pool_') && pools.push(o.getWorldPosition(new THREE.Vector3())));

const snow = createSnow();
const snowMesh = createSnowMesh(snow);
scene.add(snowMesh.mesh, createFieldMesh());

// warm light at the square (the only real point light), and the plough's headlights
const squareLight = new THREE.PointLight(style.palette['window'], 40, 22, 1.6);
squareLight.position.set(SQUARE.x, 4.5, SQUARE.z);
scene.add(squareLight);

const ploughMesh = must(models['plough'], 'plough model');
ploughMesh.traverse((o) => {
  if (!isMesh(o)) return;
  o.castShadow = o.receiveShadow = true;
  if (o.material.map) {
    // the hero stays toy-orange under the blue moon (crops/plough.png): a little of its own texture as emission
    o.material.emissiveMap = o.material.map;
    o.material.emissive.setScalar(0.35);
  }
});
const headlight = new THREE.SpotLight('#ffe2b0', 3, 12, 0.5, 0.7, 1.6); // faint: the video's plough has no beam, the lamps carry the warmth
headlight.position.set(0, 1.4, 1.2); // model space: the front is +z
headlight.target.position.set(0, 0, 9);
ploughMesh.add(headlight, headlight.target);
scene.add(ploughMesh);

// one generated villager, recoloured into the crowd the video shows (coats and hair vary)
const villagerMeshes = (await Promise.all(HOUSES.map(() => loadModel('villager')))).map((m, i) => {
  const outfit = (i * 3) % OUTFITS.length; // neighbours (and the crowd at the fire) differ
  m.traverse((o) => {
    if (isMesh(o)) {
      o.castShadow = true;
      o.material = outfitMaterial(o.material, outfit);
      // coats keep their colour in shadow (crops/villagers.png): a little of the texture as emission
      o.material.emissiveMap = o.material.map;
      o.material.emissive.setScalar(0.22);
    }
  });
  scene.add(m);
  return { mesh: m, outfit, anim: createAnimator(m, { fade: 0.25 }) };
});

// falling snow + the spray thrown off the blade: tiny instanced flakes (works on WebGPU and WebGL2 alike)
const flakeGeo = new THREE.OctahedronGeometry(0.028, 0);
const flakeMat = new THREE.MeshBasicMaterial({ color: '#c9d6f5' });
const FLAKES = 700;
const flakes = new THREE.InstancedMesh(flakeGeo, flakeMat, FLAKES);
flakes.frustumCulled = false;
scene.add(flakes);
const SPRAY = 160;
const spray = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.09, 0), new THREE.MeshLambertMaterial({ color: must(style.palette['heap'], 'palette.heap') }), SPRAY);
spray.frustumCulled = false;
scene.add(spray);

// ---------------------------------------------------------------- state
interface Flake {
  x: number;
  y: number;
  z: number;
  s: number;
}
interface Spray {
  life: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
}
interface Game {
  phase: Phase;
  timeLeft: number;
  tick: number;
  plough: Plough;
  controls: Controls;
  villagers: Villager[];
  reached: Set<number>;
  arrived: number;
  parent: Int32Array | null;
  seenVersion: number;
  scrapeCooldown: number;
  bumpCooldown: number;
  bumps: number;
  cam: { mode: CamMode; yaw: number; x: number; y: number; z: number; tx: number; tz: number; init: boolean };
  flash: { text: string; until: number } | null;
  chimes: number;
  flakes: Flake[];
  spray: Spray[];
  sprayNext: number;
  fire: FireLevel;
  wonTick: number;
}

let rng: () => number;
let g: Game;
function newGame(): void {
  rng = createRng(); // reseeded: a restart replays exactly like a fresh boot
  snow.reset();
  snowMesh.all();
  g = {
    phase: 'intro', // intro → play → won | lost
    timeLeft: TIME,
    tick: 0,
    plough: createPlough(START),
    controls: { throttle: 0, steer: 0 },
    villagers: createVillagers(),
    reached: new Set<number>(),
    arrived: 0,
    parent: null,
    seenVersion: -1,
    scrapeCooldown: 0,
    bumpCooldown: 0,
    bumps: 0,
    cam: { mode: (g as Game | undefined)?.cam.mode ?? 'chase', yaw: START.heading, x: 0, y: 0, z: 0, tx: START.x, tz: START.z, init: false },
    flash: null, // { text, until: tick }
    chimes: 0, // queued: one chime per reached house, a beat apart
    flakes: Array.from({ length: FLAKES }, () => ({ x: (rng() - 0.5) * 40, y: rng() * 14, z: (rng() - 0.5) * 40, s: 0.6 + rng() * 0.6 })),
    spray: Array.from({ length: SPRAY }, () => ({ life: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 })),
    sprayNext: 0,
    fire: FIRE.idle,
    wonTick: 0,
  };
  for (const m of lampMesh) m.material = lampOff;
  for (const v of villagerMeshes) v.anim.play('idle', { restart: true });
  setFire(FIRE.idle);
  squareLight.intensity = 40;
  updateLamps();
  hud.intro();
  audio.playMusic('theme', { volume: 0.8 });
}
function updateLamps() {
  snowMesh.setLamps([
    ...pools.map((p) => ({ x: p.x, z: p.z, on: true, strength: 0.9 })),
    // a reached house's lamp floods its stretch of street with warm light: progress shows across the map
    ...lampPos.map((p, i) => ({ x: p.x, z: p.z, on: true, strength: g.reached.has(i) ? 1.0 : 0.6, sigma: 1.9 })), // tight warm pools at every lamp (video), brighter once reached // unlit lamps keep a faint pool (every lamp in the video is lit) // local: 14 big pools merged and turned the whole village peach
    // window glow: every house's lit windows warm the street in front of it, reached or not (the video's warm lanes)
    ...HOUSES.map((h) => ({ x: h.wait.x + h.dir[0] * 1.2, z: h.wait.z + h.dir[1] * 1.2, on: true, strength: 0.65, sigma: 1.5 })),
    { x: SQUARE.x, z: SQUARE.z, on: true, strength: g.phase === 'won' ? 1 : 0.6, sigma: 5.5 }, // a wide warm falloff: no hard plaza edge
  ]);
}

// ---------------------------------------------------------------- actions (keyboard, pointer and __game.input)
function act(a: Action): boolean {
  switch (a.type) {
    case 'drive':
      g.controls = { throttle: a.throttle ?? 0, steer: a.steer ?? 0 };
      if (g.phase === 'intro' && (g.controls.throttle || g.controls.steer)) start();
      return true;
    case 'reset':
      newGame();
      return true;
    case 'camera':
      g.cam.mode = a.mode;
      g.cam.init = false;
      return true;
    case 'teleport': // test helper
      Object.assign(g.plough, { x: a.x, z: a.z, heading: a.heading ?? g.plough.heading, speed: 0 });
      return true;
    case 'setTime': // test helper
      g.timeLeft = a.seconds;
      return true;
    default:
      return false;
  }
}
function start() {
  g.phase = 'play';
  hud.hideCard();
  flash('Clear the streets!');
}

let held = false; // was the keyboard/pointer driving last tick? (so releasing them stops the plough)
function readControls() {
  const k = input.keys;
  let throttle = (k.has('ArrowUp') || k.has('KeyW') ? 1 : 0) - (k.has('ArrowDown') || k.has('KeyS') ? 1 : 0);
  let steer = (k.has('ArrowRight') || k.has('KeyD') ? 1 : 0) - (k.has('ArrowLeft') || k.has('KeyA') ? 1 : 0);
  const d = input.drag;
  if (d.active) {
    // a joystick around the press point: screen space, so it never depends on the moving camera
    const dx = d.x - d.startX;
    const dy = d.y - d.startY;
    const len = Math.hypot(dx, dy);
    if (len > DRAG_DEAD) {
      const s = Math.min(1, (len - DRAG_DEAD) / (DRAG_FULL - DRAG_DEAD)) / len;
      steer = Math.max(-1, Math.min(1, dx * s * 1.3));
      throttle = Math.max(-1, Math.min(1, -dy * s * 1.3));
    }
  }
  const active = throttle !== 0 || steer !== 0;
  if (active || held) act({ type: 'drive', throttle, steer });
  held = active;
}
addEventListener('keydown', (e) => {
  if (e.code === 'KeyR') act({ type: 'reset' });
  if (e.code === 'KeyC') act({ type: 'camera', mode: g.cam.mode === 'chase' ? 'high' : 'chase' });
  if (e.code === 'KeyM') {
    audio.setMuted(!audio.muted);
    flash(audio.muted ? 'Sound off' : 'Sound on');
  }
});

// ---------------------------------------------------------------- update (fixed step)
function update(dt: number): void {
  g.tick++;
  readControls();
  const p = g.plough;
  if (g.phase === 'play') {
    g.timeLeft = Math.max(0, g.timeLeft - dt);
    const { removed, bumped } = stepPlough(p, g.controls, snow, dt);
    g.scrapeCooldown -= dt;
    g.bumpCooldown -= dt;
    if (removed > 0.4 && g.scrapeCooldown <= 0) {
      audio.play('scrape', { volume: Math.min(1, 0.35 + removed / 6), rate: 0.9 + rng() * 0.2 });
      g.scrapeCooldown = 0.32;
    }
    if (removed > 0) emitSpray(p, removed);
    if (bumped > 1.2 && g.bumpCooldown <= 0) {
      audio.play('bump', { volume: Math.min(1, bumped / 5) });
      g.bumpCooldown = 0.5;
      g.bumps++;
    }
    // which doors connect to the square? (recomputed at most every 6 ticks, only when the snow changed)
    if (g.tick % 6 === 0 && snow.version !== g.seenVersion) {
      g.seenVersion = snow.version;
      const parent = (g.parent = reachFromSquare(snow));
      const now = new Set(HOUSES.filter((h) => parent[cellIndex(...h.mouth)] !== -1).map((h) => h.index));
      replan(g.villagers, snow, parent);
      const fresh = startWalks(g.villagers, now, snow, parent);
      for (const i of fresh) {
        g.reached.add(i);
        lampMesh[i]!.material = lampOn;
      }
      if (fresh.length) {
        g.chimes += fresh.length;
        flash(fresh.length > 1 ? `${fresh.length} paths clear!` : 'Path clear!');
        updateLamps();
      }
    }
    if (g.chimes > 0 && g.tick % 9 === 0) {
      audio.play('chime', { rate: 1 + 0.06 * (g.chimes % 4) });
      g.chimes--;
    }
    if (g.timeLeft <= 0) finish('lost');
  } else {
    stepPlough(p, { throttle: 0, steer: 0 }, snow, dt); // coast to a stop (intro: stays parked)
  }
  if (g.phase === 'play' || g.phase === 'won') {
    const arrivals = stepVillagers(g.villagers, p, dt);
    g.arrived += arrivals.length;
    if (g.phase === 'play' && g.arrived === HOUSES.length) finish('won');
  }
  for (const [i, v] of g.villagers.entries()) {
    const a = villagerMeshes[i]!.anim;
    if (g.phase === 'won' && v.state === 'arrived') a.play('jump', { timeScale: 0.9 });
    else if (v.state === 'walking' && v.waited === 0) a.play('walk', { timeScale: 1.15 });
    else a.play('idle');
    v.waited = 0;
    a.update(dt);
  }
  stepFlakes(dt);
  stepSpray(dt);
  stepCamera(dt);
}

function flash(text: string): void {
  g.flash = { text, until: g.tick + 90 };
}

function finish(phase: 'won' | 'lost'): void {
  g.phase = phase;
  g.flash = null;
  g.controls = { throttle: 0, steer: 0 };
  if (phase === 'won') {
    g.wonTick = g.tick;
    setFire(FIRE.festival);
    squareLight.intensity = 90;
    updateLamps();
    audio.playMusic('festival', { volume: 1 });
  } else audio.stopMusic();
  hud.end(getState());
}

function setFire(f: FireLevel): void {
  g.fire = f;
  fireMat.emissiveIntensity = f.glow;
}

function emitSpray(p: Plough, removed: number): void {
  const n = Math.min(4, Math.ceil(removed * 1.5));
  const fx = Math.sin(p.heading);
  const fz = -Math.cos(p.heading);
  for (let k = 0; k < n; k++) {
    const s = g.spray[g.sprayNext]!;
    g.sprayNext = (g.sprayNext + 1) % SPRAY;
    const side = k % 2 ? 1 : -1;
    const bx = p.x + fx * PLOUGH.blade.ahead + Math.cos(p.heading) * side * 1.3;
    const bz = p.z + fz * PLOUGH.blade.ahead + Math.sin(p.heading) * side * 1.3;
    const out = 1.2 + rng() * 1.5;
    Object.assign(s, {
      life: 0.5 + rng() * 0.3,
      x: bx,
      y: 0.4,
      z: bz,
      vx: Math.cos(p.heading) * side * out + fx * p.speed * 0.6,
      vy: 1.8 + rng() * 1.6,
      vz: Math.sin(p.heading) * side * out + fz * p.speed * 0.6,
    });
  }
}
function stepSpray(dt: number): void {
  for (const s of g.spray) {
    if (s.life <= 0) continue;
    s.life -= dt;
    s.vy -= 9.8 * dt;
    s.x += s.vx * dt;
    s.y = Math.max(0.1, s.y + s.vy * dt);
    s.z += s.vz * dt;
  }
}
function stepFlakes(dt: number): void {
  const c = g.cam;
  for (const f of g.flakes) {
    f.y -= 0.9 * f.s * dt;
    f.x += Math.sin(g.tick * 0.01 + f.s * 9) * 0.25 * dt;
    if (f.y < 0) f.y += 14;
    // keep the flakes in a 40 m box around the camera's focus
    if (f.x - c.tx > 20) f.x -= 40;
    if (f.x - c.tx < -20) f.x += 40;
    if (f.z - c.tz > 20) f.z -= 40;
    if (f.z - c.tz < -20) f.z += 40;
  }
}

// ---------------------------------------------------------------- camera (fixed step: deterministic screenshots)
const focus = new THREE.Vector3();
const sunOff = new THREE.Vector3();
const FEST = { pos: new THREE.Vector3(SQUARE.x, 17, SQUARE.z + 7) }; // from the south (sapling behind the fire, as in crops/square.png), ~65 deg down: the square sits at the map edge, so a flatter shot sees past it
// up the avenue towards the square from behind-left, like keyart.png (~32 deg down)
const OVERVIEW = { pos: new THREE.Vector3(START.x - 4, 13, START.z + 12), look: new THREE.Vector3(START.x + 1, 0, START.z - 10) };
function stepCamera(dt: number): void {
  const c = g.cam;
  const p = g.plough;
  let diff = p.heading - c.yaw;
  diff = Math.atan2(Math.sin(diff), Math.cos(diff));
  c.yaw += diff * Math.min(1, dt * 2.2);
  const fx = Math.sin(c.yaw);
  const fz = -Math.cos(c.yaw);
  // the video's rig (frames 1-8): high, behind and to the LEFT of the plough, ~34 deg down, so the plough is seen
  // three-quarter from behind (blade side-on) heading up-right, and the street recedes towards the square
  const [back, side, up, ahead] = c.mode === 'high' ? [7, 0, 22, 2] : [18, 3, 15, 6];
  const want = { x: p.x - fx * back + fz * side, y: up, z: p.z - fz * back - fx * side };
  const k = c.init ? Math.min(1, dt * 5) : 1;
  c.x += (want.x - c.x) * k;
  c.y += (want.y - c.y) * k;
  c.z += (want.z - c.z) * k;
  c.tx = p.x + fx * ahead;
  c.tz = p.z + fz * ahead;
  c.init = true;
}
function placeCamera(): void {
  const c = g.cam;
  if (c.mode === 'overview') {
    camera.position.copy(OVERVIEW.pos);
    camera.lookAt(OVERVIEW.look);
  } else if (g.phase === 'won') {
    // the festival: swing round to the square from the avenue
    const k = Math.min(1, (g.tick - g.wonTick) / 120);
    const e = k * k * (3 - 2 * k);
    camera.position.set(c.x + (FEST.pos.x - c.x) * e, c.y + (FEST.pos.y - c.y) * e, c.z + (FEST.pos.z - c.z) * e);
    focus.set(c.tx + (SQUARE.x - c.tx) * e, 0.6 + 1.4 * e, c.tz + (SQUARE.z - c.tz) * e);
    camera.lookAt(focus);
  } else {
    camera.position.set(c.x, c.y, c.z);
    camera.lookAt(c.tx, 0.6, c.tz);
  }
  // the moon's shadow box follows what the camera looks at
  if (c.mode === 'overview') focus.copy(OVERVIEW.look);
  else focus.set(c.tx, 0, c.tz);
  sunOff.subVectors(sun.position, sun.target.position);
  sun.target.position.copy(focus);
  sun.position.copy(focus).add(sunOff);
}

// ---------------------------------------------------------------- render
const m4 = new THREE.Matrix4();
const q = new THREE.Quaternion();
const one = new THREE.Vector3(1, 1, 1);
const zero = new THREE.Vector3(0, 0, 0);
const v3 = new THREE.Vector3();
const sc = new THREE.Vector3();
let hudTick = -1;
function render(): void {
  const p = g.plough;
  snowMesh.sync();
  ploughMesh.position.set(p.x, 0, p.z);
  ploughMesh.rotation.y = Math.PI - p.heading; // the model's front is +z
  for (const [i, v] of g.villagers.entries()) {
    const m = villagerMeshes[i]!.mesh;
    m.position.set(v.x, 0, v.z);
    m.rotation.y = v.yaw;
  }
  // flames flicker on the game tick (deterministic screenshots)
  const flick = 1 + 0.12 * Math.sin(g.tick * 0.37) + 0.06 * Math.sin(g.tick * 0.91);
  fire.scale.set(g.fire.scale, g.fire.scale * flick, g.fire.scale);
  for (const [i, f] of g.flakes.entries()) flakes.setMatrixAt(i, m4.compose(v3.set(f.x, f.y, f.z), q, one));
  flakes.instanceMatrix.needsUpdate = true;
  for (const [i, s] of g.spray.entries()) {
    const k = s.life > 0 ? Math.min(1, s.life * 3) : 0;
    spray.setMatrixAt(i, m4.compose(v3.set(s.x, s.y, s.z), q, k ? sc.setScalar(k) : zero));
  }
  spray.instanceMatrix.needsUpdate = true;
  placeCamera();
  // the HUD only writes the DOM when a value changed
  if (g.tick !== hudTick)
    hud.update({ reached: g.reached.size, total: HOUSES.length, arrived: g.arrived, clock: 60 * (1 - g.timeLeft / TIME), timeLeft: g.timeLeft, phase: g.phase, flash: g.flash && g.tick < g.flash.until ? g.flash.text : null });
  hudTick = g.tick;
  post.render();
}

function getState(): State {
  const p = g.plough;
  return {
    phase: g.phase,
    timeLeft: Number(g.timeLeft.toFixed(2)),
    clock: 60 * (1 - g.timeLeft / TIME),
    total: HOUSES.length,
    reached: g.reached.size,
    arrived: g.arrived,
    plough: { x: p.x, z: p.z, heading: p.heading, speed: p.speed, load: p.load },
    controls: { ...g.controls },
    cleared: Number(snow.clearedFraction().toFixed(4)),
    villagers: g.villagers.map((v) => ({ house: v.house, state: v.state, x: v.x, z: v.z })),
    houses: HOUSES.map((h) => ({ index: h.index, wait: h.wait, mouth: h.mouth, facing: h.facing, tile: [h.r, h.c] })),
    square: SQUARE,
    camera: g.phase === 'won' ? 'festival' : g.cam.mode,
    fireBlazing: g.fire === FIRE.festival,
    outfits: new Set(villagerMeshes.map((v) => v.outfit)).size,
    cheering: g.villagers.filter((_, i) => villagerMeshes[i]?.anim.current === 'jump').length,
    lit: [...g.reached].sort((a, b) => a - b), // houses whose lamp is lit
    flash: g.flash && g.tick < g.flash.until ? g.flash.text : null,
    muted: audio.muted,
    bumps: g.bumps,
    lastBump: p.lastBump ?? null,
    anims: must(villagerMeshes[0], 'a villager').anim.counts,
    sfx: { ...audio.counts },
    music: audio.music,
  };
}

// ---------------------------------------------------------------- boot
// glow on the windows, lanterns, warm pools and the fire, as in the video. Only emissive light blooms (a second
// render target): a luminance threshold on the whole frame missed the amber windows (luminance ~0.45) but smeared
// the bright white snow banks. The threshold keeps out the faint self-light on the plough and the villagers.
const post = new THREE.RenderPipeline(renderer);
const scenePass = pass(scene, camera);
scenePass.setMRT(mrt({ output, emissive }));
const glowPass = bloom(scenePass.getTextureNode('emissive'), 1.4, 0.45, 0.35);
post.outputNode = scenePass.getTextureNode('output').add(glowPass);
newGame();
stepCamera(0);
// prewarm with the lit variants in place too (a lamp lighting up must not compile a pipeline mid-game)
must(lampMesh[0], 'a lamp').material = lampOn;
setFire(FIRE.festival);
await loading.step('Compiling shaders', 0.3, async (pr) => {
  await prewarm(renderer, scene, camera, [scene], pr);
  post.render();
});
must(lampMesh[0], 'a lamp').material = lampOff;
setFire(FIRE.idle);
const loop = createLoop({ update, render, renderer });
const hooks = installTestHooks({ backend, loop, getState, input: act });
loop.start();
loop.step(0);
loading.done();
hooks.ready = true;
