// Skeletal animation for rigged models (blender-assets lab_rig: biped idle / walk / run / jump, hang / swing / climb /
// pull, sit / kick / fly / land; quadruped idle / walk / trot / gallop), and rigid moving parts (lab_rig
// rig_vehicle wheels, rig_rotor propellers and sails: createParts).
// Advance it from the game's fixed-step update(dt), never from render(): then ?test runs and screenshots are
// deterministic. `counts` (plays per clip) goes into getState() so scenarios can assert that a clip started.
import * as THREE from 'three/webgpu';

export interface PlayOptions {
  loop?: boolean;
  timeScale?: number;
  restart?: boolean;
}

export interface Animator {
  mixer: THREE.AnimationMixer;
  clips: string[];
  counts: Record<string, number>;
  readonly current: string | null;
  /** Cross-fade to a clip. Calling it again with the playing clip is a no-op (call it every tick freely). */
  play(name: string, opts?: PlayOptions): THREE.AnimationAction;
  /**
   * Hold a clip at a pose instead of playing it in time: u = 0..1 of its length (lab_rig's `swing`, `pull`).
   * Drive u from game state (a pendulum's angle), every tick. Switching to it cross-fades like play().
   */
  scrub(name: string, u: number): void;
  update(dt: number): void;
}

/** createAnimator(model from loadModel) → { clips, current, counts, play(name, opts), update(dt), mixer } */
export function createAnimator(model: THREE.Object3D, { fade = 0.2 }: { fade?: number } = {}): Animator {
  const mixer = new THREE.AnimationMixer(model);
  const clips: THREE.AnimationClip[] = model.userData['animations'] ?? [];
  const actions: Record<string, THREE.AnimationAction> = Object.fromEntries(clips.map((c) => [c.name, mixer.clipAction(c)]));
  const counts: Record<string, number> = {};
  let current: string | null = null;
  return {
    mixer,
    clips: Object.keys(actions),
    counts,
    get current() {
      return current;
    },
    play(name, { loop = true, timeScale = 1, restart = false } = {}) {
      const next = actions[name];
      if (!next) throw new Error(`no animation "${name}" (have: ${Object.keys(actions).join(', ') || 'none'})`);
      next.timeScale = timeScale;
      if (current === name && !restart) return next;
      const prev = current === null ? undefined : actions[current];
      next.reset();
      next.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
      next.clampWhenFinished = !loop;
      next.play();
      if (prev && prev !== next) prev.crossFadeTo(next, fade, false);
      current = name;
      counts[name] = (counts[name] ?? 0) + 1;
      return next;
    },
    scrub(name, u) {
      const a = this.play(name);
      a.paused = true;
      a.time = Math.min(Math.max(u, 0), 1) * a.getClip().duration;
    },
    update(dt) {
      mixer.update(dt);
    },
  };
}

export interface Wheel {
  node: THREE.Object3D;
  radius: number;
  steers: boolean;
}
export interface Rotor {
  node: THREE.Object3D;
  axis: THREE.Vector3;
  rest: THREE.Quaternion;
  angle: number;
}
export interface Parts {
  wheels: Wheel[];
  rotors: Rotor[];
  /** Roll every wheel by `distance` metres driven (negative = reversing) and turn the steering wheels to `steer`
   * radians (positive = left, i.e. counter-clockwise seen from above). Call it every tick with that tick's distance. */
  drive(distance: number, steer?: number): void;
  /** Turn the rotors (all, or the one named `name`) by `turns` revolutions: turnsPerSecond * dt each tick. */
  spin(turns: number, name?: string): void;
  /** Wheel roll angle (radians, wrapped) and steering, for getState(). */
  readonly state: { roll: number; steer: number };
}

/**
 * createParts(model from loadModel) finds the nodes lab_rig cut out of a vehicle or machine: `wheel.*` (extras
 * wheel_radius, steer) and rotors (extras spin_axis). A model without them gives empty lists, so it is safe to call
 * on any model. Drive it from the fixed-step update(dt), like the animator.
 */
export function createParts(model: THREE.Object3D): Parts {
  const wheels: Wheel[] = [];
  const rotors: Rotor[] = [];
  model.traverse((o) => {
    const u = o.userData;
    if (typeof u['wheel_radius'] === 'number') {
      o.rotation.order = 'YXZ'; // steer about the vehicle's up axis, then roll about the axle
      wheels.push({ node: o, radius: u['wheel_radius'], steers: u['steer'] === 1 });
    } else if (Array.isArray(u['spin_axis'])) {
      const [x = 0, y = 0, z = 0] = u['spin_axis'] as number[];
      rotors.push({ node: o, axis: new THREE.Vector3(x, y, z).normalize(), rest: o.quaternion.clone(), angle: 0 });
    }
  });
  const state = { roll: 0, steer: 0 };
  const q = new THREE.Quaternion();
  const TAU = Math.PI * 2;
  return {
    wheels,
    rotors,
    state,
    drive(distance, steer = state.steer) {
      // rolling forward (the model's +z) turns the top of the wheel forward: positive about +x
      state.steer = steer;
      for (const w of wheels) {
        w.node.rotation.x = (w.node.rotation.x + distance / w.radius) % TAU;
        if (w.steers) w.node.rotation.y = steer;
      }
      const first = wheels[0];
      state.roll = first ? first.node.rotation.x : 0;
    },
    spin(turns, name) {
      for (const r of rotors) {
        if (name !== undefined && r.node.name !== name) continue;
        r.angle = (r.angle + turns * TAU) % TAU;
        r.node.quaternion.copy(r.rest).multiply(q.setFromAxisAngle(r.axis, r.angle));
      }
    },
  };
}
