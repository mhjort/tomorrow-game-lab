// Skeletal animation for rigged models (blender-assets lab_rig: idle / walk / run / jump, hang / swing / climb /
// pull clips).
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
