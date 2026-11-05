// Island Putt — 3D minigolf. Golden test game for tomorrow-game-lab (see design/brief.md).
import * as THREE from 'three/webgpu';
import { createRenderer, fitToWindow, params } from './engine/renderer.js';
import { applyStyle, paletteColor, style } from './engine/style.js';
import { createPhysics } from './engine/physics.js';
import { createLoop } from './engine/loop.js';
import { createInput } from './engine/input.js';
import { installTestHooks } from './engine/testHooks.js';
import { loadModels } from './engine/assets.js';
import { createAudio } from './engine/audio.js';
import { createHud } from './hud.js';
import { createLoadingScreen, prewarm } from './engine/loading.js';

const loading = createLoadingScreen({ title: 'Island Putt', image: 'images/splash.webp' });
const audio = createAudio();
const SFX = ['putt', 'rail', 'cup', 'water', 'holed']; // public/sfx/*.mp3, generated from design/media.json
const MUSIC = 'course'; // public/music/course.mp3 (+ .json loop sidecar), a seamless loop from design/media.json

const HOLES = [
  { model: 'hole1', name: 'First Putt', par: 2 },
  { model: 'hole2', name: 'Dogleg', par: 3 },
  { model: 'hole3', name: 'The Climb', par: 3 },
];
const BALL_R = 0.05;
const CUP_R = 0.09;
const MAX_SPEED = 5; // m/s at power 1
const ROLL_DECEL = 0.9; // m/s² constant rolling resistance -> putt length ≈ v² / (2·ROLL_DECEL)
const STOP_SPEED = 0.06;
const STOP_TICKS = 15;
const HOLED_DELAY = 60;
const RAIL_DV = 0.35; // m/s horizontal velocity change in one tick that counts as a rail hit (rolling drag is ~0.015)

// Download phase: renderer init, Rapier WASM chunk, every GLB and every sound in parallel, one progress bar.
const [{ renderer, backend }, physics, models] = await loading.parallel('Loading course…', [
  { weight: 0.1, run: () => createRenderer() },
  { weight: 0.3, run: () => createPhysics({ substeps: 4 }) },
  { weight: 0.3, run: (p) => loadModels([...HOLES.map((h) => h.model), 'ball'], p) },
  { weight: 0.05, run: (p) => audio.load(SFX, p) },
  { weight: 0.05, run: (p) => audio.loadMusic([MUSIC], p) },
]);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(style.camera?.fov ?? 45, innerWidth / innerHeight, 0.05, 200);
fitToWindow(renderer, camera);
const { refreshShadows } = applyStyle(scene, renderer, { shadowArea: 8 });
const { RAPIER, world } = physics;
const input = createInput(renderer.domElement);
const hud = createHud(document.getElementById('hud'));

// ---------------------------------------------------------------- ball
const ballMesh = models.ball;
scene.add(ballMesh);
const ballBody = world.createRigidBody(
  RAPIER.RigidBodyDesc.dynamic().setCcdEnabled(true).setLinearDamping(0.05).setAngularDamping(0.2).setCanSleep(false),
);
const ballCollider = world.createCollider(
  RAPIER.ColliderDesc.ball(BALL_R).setDensity(1100).setFriction(0.6).setRestitution(0.35),
  ballBody,
);
physics.bind(ballBody, ballMesh);

// ---------------------------------------------------------------- aim arrow
const arrow = new THREE.Group();
const arrowMat = new THREE.MeshStandardMaterial({ color: paletteColor('accent'), roughness: 0.5 });
const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.01, 1), arrowMat);
shaft.position.z = -0.5;
const head = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.16, 12), arrowMat);
head.rotation.x = -Math.PI / 2;
arrow.add(shaft, head);
scene.add(arrow);

// ---------------------------------------------------------------- game state
const g = {
  hole: 0,
  strokes: 0,
  scorecard: [],
  phase: 'aim', // aim | rolling | holed | complete
  aim: { angle: 0, power: 0 },
  charging: false,
  chargeT: 0,
  slowTicks: 0,
  holedTicks: 0,
  lastShot: new THREE.Vector3(),
  tee: new THREE.Vector3(),
  cup: new THREE.Vector3(),
  holeRoot: null,
  holeBody: null,
  flag: null,
  camMode: 'follow',
  tick: 0,
  lastRailTick: -99,
};

function loadHole(i) {
  if (g.holeRoot) scene.remove(g.holeRoot);
  if (g.holeBody) physics.removeBody(g.holeBody);
  g.hole = i;
  g.strokes = 0;
  g.holeRoot = models[HOLES[i].model];
  scene.add(g.holeRoot);
  refreshShadows();
  g.holeBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  const colliders = physics.collidersFromGltf(g.holeRoot, { body: g.holeBody });
  physics.onSensor(colliders.CupSensor, (other, started) => {
    if (started && other.handle === ballCollider.handle && g.phase === 'rolling') holeOut();
  });
  g.holeRoot.getObjectByName('Tee').getWorldPosition(g.tee);
  g.holeRoot.getObjectByName('CupCenter').getWorldPosition(g.cup);
  g.flag = g.holeRoot.getObjectByName('FlagCloth');
  placeBall(g.tee);
  // aim at the cup's general direction for hole 1, straight down the lane otherwise
  g.aim.angle = 0;
  g.aim.power = 0;
  g.phase = 'aim';
  snapCamera();
  hud.update(hudState());
}

function placeBall(p) {
  ballBody.setTranslation({ x: p.x, y: p.y + BALL_R + 0.002, z: p.z }, true);
  ballBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
  ballBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
  g.lastShot.copy(p);
}

const aimDir = (angleDeg) => {
  const a = THREE.MathUtils.degToRad(angleDeg);
  return new THREE.Vector3(Math.sin(a), 0, -Math.cos(a));
};

function shoot(angle, power) {
  if (g.phase !== 'aim') return false;
  power = THREE.MathUtils.clamp(power, 0.02, 1);
  g.aim.angle = angle;
  g.aim.power = power;
  const p = ballBody.translation();
  g.lastShot.set(p.x, p.y - BALL_R, p.z);
  const v = aimDir(angle).multiplyScalar(power * MAX_SPEED);
  ballBody.setLinvel({ x: v.x, y: 0, z: v.z }, true);
  // start in pure roll (ω = up × v / r) so no energy is lost to the slide->roll transition
  ballBody.setAngvel({ x: v.z / BALL_R, y: 0, z: -v.x / BALL_R }, true);
  g.strokes++;
  g.phase = 'rolling';
  g.slowTicks = 0;
  audio.play('putt', { volume: 0.35 + 0.65 * power });
  hud.update(hudState());
  return true;
}

function holeOut() {
  g.phase = 'holed';
  g.holedTicks = 0;
  audio.play('cup');
  const h = HOLES[g.hole];
  g.scorecard[g.hole] = { hole: g.hole + 1, par: h.par, strokes: g.strokes };
  hud.flash(g.strokes === 1 ? 'Hole in one!' : scoreName(g.strokes - h.par));
  hud.update(hudState());
}

const scoreName = (d) => ({ '-2': 'Eagle!', '-1': 'Birdie!', 0: 'Par', 1: 'Bogey', 2: 'Double bogey' })[d] ?? `+${d}`;

function act(a) {
  switch (a.type) {
    case 'shoot': {
      let angle = a.angle ?? g.aim.angle;
      if (a.target) {
        const p = ballBody.translation();
        angle = THREE.MathUtils.radToDeg(Math.atan2(a.target[0] - p.x, -(a.target[1] - p.z)));
      }
      return shoot(angle, a.power ?? 0.5);
    }
    case 'aim':
      g.aim.angle = a.angle ?? g.aim.angle;
      g.aim.power = a.power ?? g.aim.power;
      return true;
    case 'loadHole':
      loadHole(THREE.MathUtils.clamp((a.hole ?? 1) - 1, 0, HOLES.length - 1));
      return true;
    case 'reset':
      g.scorecard = [];
      hud.hideScorecard();
      loadHole(0);
      return true;
    case 'camera':
      g.camMode = a.mode;
      snapCamera();
      return true;
    default:
      return false;
  }
}

// ---------------------------------------------------------------- controls
// The camera follows the aim, so a drag must be read in the camera frame captured when it STARTED.
// Reading it against the live camera is a feedback loop: aim turns -> camera turns -> same drag
// now means a new aim -> ... and the view spins. The camera also holds still while dragging, so
// the arrow on screen always points straight away from the pointer.
const DRAG_DEAD_ZONE = 16; // px: below this a drag is a click/cancel and doesn't aim or shoot
let dragFrame = null; // { fwd, right } on the ground plane, frozen for the whole drag

input.on('dragstart', () => {
  if (g.phase !== 'aim') return;
  const fwd = new THREE.Vector3();
  camera.getWorldDirection(fwd);
  fwd.y = 0;
  fwd.normalize();
  dragFrame = { fwd, right: new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)) };
});
input.on('dragend', ({ dx, dy }) => {
  const frame = dragFrame;
  dragFrame = null;
  if (!frame || g.phase !== 'aim' || Math.hypot(dx, dy) < DRAG_DEAD_ZONE) return;
  const { angle, power } = dragAim(frame, dx, dy);
  shoot(angle, power);
});

function dragAim(frame, dx, dy) {
  // pull back like a slingshot: shot goes opposite to the drag, in the drag-start ground frame
  const dir = frame.right.clone().multiplyScalar(-dx).addScaledVector(frame.fwd, dy);
  return {
    angle: THREE.MathUtils.radToDeg(Math.atan2(dir.x, -dir.z)),
    power: THREE.MathUtils.clamp((Math.hypot(dx, dy) - DRAG_DEAD_ZONE) / 240, 0, 1),
  };
}

addEventListener('keydown', (e) => {
  if (e.code === 'KeyR') act({ type: g.phase === 'complete' ? 'reset' : 'loadHole', hole: g.hole + 1 });
  if (e.code === 'KeyC') act({ type: 'camera', mode: g.camMode === 'follow' ? 'overview' : 'follow' });
  if (e.code === 'KeyM') {
    audio.setMuted(!audio.muted);
    hud.flash(audio.muted ? 'Sound off' : 'Sound on');
  }
});
addEventListener('keyup', (e) => {
  if (e.code === 'Space' && g.charging) {
    g.charging = false;
    shoot(g.aim.angle, g.aim.power);
  }
});

// ---------------------------------------------------------------- update
function update(dt) {
  g.tick++;
  if (g.phase === 'aim') {
    const turn = dragFrame ? 0 : (input.down('ArrowLeft') || input.down('KeyA') ? -1 : 0) + (input.down('ArrowRight') || input.down('KeyD') ? 1 : 0);
    g.aim.angle += turn * 90 * dt;
    if (input.down('Space')) {
      g.charging = true;
      g.chargeT += dt / 1.2;
      g.aim.power = 1 - Math.abs(1 - (g.chargeT % 2)); // ping-pong 0..1
    } else g.chargeT = 0;
    if (dragFrame) {
      const dx = input.drag.x - input.drag.startX;
      const dy = input.drag.y - input.drag.startY;
      if (Math.hypot(dx, dy) >= DRAG_DEAD_ZONE) Object.assign(g.aim, dragAim(dragFrame, dx, dy));
      else g.aim.power = 0; // dragged back to the start: shows the shot is cancelled
    }
  }

  if (g.phase === 'rolling') applyRollingResistance(dt);
  const v0 = ballBody.linvel();
  physics.step();
  const p = ballBody.translation();
  const v = ballBody.linvel();
  const speed = Math.hypot(v.x, v.y, v.z);

  if (g.phase === 'rolling') {
    const cupDist = Math.hypot(p.x - g.cup.x, p.z - g.cup.z);
    // rail hit = sudden horizontal velocity change (no contact-event plumbing needed); rate-limited, louder when faster
    const dv = Math.hypot(v.x - v0.x, v.z - v0.z);
    if (dv > RAIL_DV && cupDist > CUP_R + 0.05 && g.tick - g.lastRailTick > 6) {
      g.lastRailTick = g.tick;
      audio.play('rail', { volume: Math.min(1, 0.25 + dv / 2), rate: 0.95 + Math.min(0.15, dv / 20) });
    }
    if (p.y < g.tee.y - 0.02 && cupDist > CUP_R + 0.02 && p.y < g.cup.y - 0.02) {
      // off the course: penalty stroke, back to the last shot position
      g.strokes++;
      audio.play('water');
      hud.flash('Out of bounds +1');
      placeBall(g.lastShot);
      g.phase = 'aim';
    } else if (p.y < -2) {
      placeBall(g.lastShot);
      g.phase = 'aim';
    } else {
      g.slowTicks = speed < STOP_SPEED ? g.slowTicks + 1 : 0;
      if (g.slowTicks >= STOP_TICKS && cupDist > CUP_R) {
        ballBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
        ballBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
        g.phase = 'aim';
        g.aim.power = 0;
      }
    }
    hud.update(hudState());
  } else if (g.phase === 'holed') {
    if (++g.holedTicks === 15) audio.play('holed'); // chime a beat after the cup rattle
    if (g.holedTicks >= HOLED_DELAY) {
      if (g.hole + 1 < HOLES.length) loadHole(g.hole + 1);
      else {
        g.phase = 'complete';
        hud.scorecard(g.scorecard);
      }
    }
  }
  if (g.flag) g.flag.rotation.z = Math.sin(g.tick * 0.08) * 0.12;
  if (!dragFrame) updateCamera(0.08); // hold the view still while the player is aiming with the pointer
}

function applyRollingResistance(dt) {
  const v = ballBody.linvel();
  const h = Math.hypot(v.x, v.z);
  if (h < 1e-6 || Math.abs(v.y) > 0.5) return; // airborne / falling into the cup
  const k = Math.max(0, h - ROLL_DECEL * dt) / h;
  ballBody.setLinvel({ x: v.x * k, y: v.y, z: v.z * k }, true);
  const w = ballBody.angvel();
  ballBody.setAngvel({ x: w.x * k, y: w.y * k, z: w.z * k }, true);
}

// ---------------------------------------------------------------- camera
const camTarget = new THREE.Vector3();
const camPos = new THREE.Vector3();
function desiredCamera() {
  if (g.camMode === 'overview' && g.holeRoot) {
    const box = new THREE.Box3();
    g.holeRoot.traverse((o) => o.isMesh && /^(Turf|Rail)/.test(o.name) && box.expandByObject(o));
    const c = box.getCenter(new THREE.Vector3());
    const r = box.getSize(new THREE.Vector3()).length() / 2;
    return { pos: c.clone().add(new THREE.Vector3(-0.45, 0.85, 0.75).normalize().multiplyScalar(r * 1.9)), look: c };
  }
  const p = ballBody.translation();
  const ball = new THREE.Vector3(p.x, p.y, p.z);
  const dir = g.phase === 'aim' ? aimDir(g.aim.angle) : new THREE.Vector3(g.cup.x - p.x, 0, g.cup.z - p.z).normalize();
  return { pos: ball.clone().addScaledVector(dir, -2.0).add(new THREE.Vector3(0, 1.35, 0)), look: ball.clone().addScaledVector(dir, 1.2) };
}
function updateCamera(k) {
  const d = desiredCamera();
  camPos.lerp(d.pos, k);
  camTarget.lerp(d.look, k);
  camera.position.copy(camPos);
  camera.lookAt(camTarget);
}
function snapCamera() {
  const d = desiredCamera();
  camPos.copy(d.pos);
  camTarget.copy(d.look);
  updateCamera(1);
}

// ---------------------------------------------------------------- render / hooks
function render() {
  physics.sync();
  const show = g.phase === 'aim';
  arrow.visible = show && g.aim.power > 0.01;
  if (show) {
    const p = ballBody.translation();
    arrow.position.set(p.x, p.y - BALL_R + 0.01, p.z);
    arrow.rotation.y = -THREE.MathUtils.degToRad(g.aim.angle);
    const len = 0.25 + g.aim.power * 1.1;
    shaft.scale.z = len;
    shaft.position.z = -len / 2 - 0.08;
    head.position.z = -len - 0.08;
  }
  hud.power(show ? g.aim.power : 0);
  renderer.render(scene, camera);
}

function hudState() {
  const h = HOLES[g.hole];
  return {
    hole: g.hole + 1,
    holes: HOLES.length,
    name: h.name,
    par: h.par,
    strokes: g.strokes,
    total: g.scorecard.reduce((s, c) => s + (c?.strokes ?? 0), 0),
  };
}

function getState() {
  const p = ballBody.translation();
  const v = ballBody.linvel();
  return {
    ...hudState(),
    phase: g.phase,
    ball: { x: p.x, y: p.y, z: p.z, speed: Math.hypot(v.x, v.y, v.z) },
    tee: { x: g.tee.x, y: g.tee.y, z: g.tee.z },
    cup: { x: g.cup.x, y: g.cup.y, z: g.cup.z },
    aim: { ...g.aim },
    camera: g.camMode,
    scorecard: g.scorecard,
    sfx: { ...audio.counts }, // plays per sound (audible only outside ?test)
    music: audio.music,
    musicTrack: audio.trackInfo(MUSIC),
  };
}

await loading.step('Compiling shaders', 0.3, (p) => prewarm(renderer, scene, camera, HOLES.map((h) => models[h.model]), p));
loadHole(THREE.MathUtils.clamp((Number(params.get('hole')) || 1) - 1, 0, HOLES.length - 1)); // ?hole=N deep link for human review
const loop = createLoop({ update, render, renderer });
const hooks = installTestHooks({ backend, loop, getState, input: act });
audio.playMusic(MUSIC, { volume: 0.7 }); // audible from the first click/key (browsers block autoplay)
loop.start();
loop.step(0);
loading.done();
hooks.ready = true;
