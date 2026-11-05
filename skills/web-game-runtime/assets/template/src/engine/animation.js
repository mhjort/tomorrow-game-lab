// Skeletal animation for rigged models (blender-assets lab_rig: idle / walk / run / jump clips).
// Advance it from the game's fixed-step update(dt), never from render(): then ?test runs and screenshots are
// deterministic. `counts` (plays per clip) goes into getState() so scenarios can assert that a clip started.
import * as THREE from 'three/webgpu';

/** createAnimator(model from loadModel) → { clips, current, counts, play(name, opts), update(dt), mixer } */
export function createAnimator(model, { fade = 0.2 } = {}) {
  const mixer = new THREE.AnimationMixer(model);
  const actions = Object.fromEntries((model.userData.animations ?? []).map((c) => [c.name, mixer.clipAction(c)]));
  const counts = {};
  let current = null;
  return {
    mixer,
    clips: Object.keys(actions),
    counts,
    get current() {
      return current;
    },
    /** Cross-fade to a clip. Calling it again with the playing clip is a no-op (call it every tick freely). */
    play(name, { loop = true, timeScale = 1, restart = false } = {}) {
      const next = actions[name];
      if (!next) throw new Error(`no animation "${name}" (have: ${Object.keys(actions).join(', ') || 'none'})`);
      next.timeScale = timeScale;
      if (current === name && !restart) return next;
      const prev = current && actions[current];
      next.reset();
      next.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
      next.clampWhenFinished = !loop;
      next.play();
      if (prev && prev !== next) prev.crossFadeTo(next, fade, false);
      current = name;
      counts[name] = (counts[name] ?? 0) + 1;
      return next;
    },
    update(dt) {
      mixer.update(dt);
    },
  };
}
