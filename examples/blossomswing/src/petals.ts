// Petal gusts: a pool of small pink petals that blow from the big tree's canopy out over the valley (frames 04, 08:
// a stream leaves the branch at each forward peak and drifts right and down for ~2 s). Deterministic: a seeded rng
// and fixed-step integration, so playtests see the same petals every run.
import * as THREE from 'three/webgpu';
import { createRng } from './engine/testHooks.ts';

interface Petal {
  alive: boolean;
  p: THREE.Vector3;
  v: THREE.Vector3;
  age: number;
  life: number;
  spin: THREE.Vector3;
  phase: number;
}

export interface Petals {
  mesh: THREE.InstancedMesh;
  burst(origin: THREE.Vector3, n: number, strength: number, tick: number): void;
  step(dt: number, tick: number): void;
  sync(): void;
  live(): number;
  clear(): void;
}

export function createPetals(color: THREE.Color, max: number): Petals {
  // a small rounded petal: an ellipse fan, double-sided
  const shape = new THREE.Shape();
  shape.absellipse(0, 0, 0.048, 0.032, 0, Math.PI * 2, false, 0); // frame_08's petals are small and many
  const geo = new THREE.ShapeGeometry(shape, 6);
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.7, side: THREE.DoubleSide, emissive: color, emissiveIntensity: 0.6 });
  const mesh = new THREE.InstancedMesh(geo, mat, max);
  mesh.frustumCulled = false;
  const pool: Petal[] = Array.from({ length: max }, () => ({
    alive: false, p: new THREE.Vector3(), v: new THREE.Vector3(), age: 0, life: 1, spin: new THREE.Vector3(), phase: 0,
  }));
  let next = 0;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const scl = new THREE.Vector3();
  const zero = new THREE.Vector3(0, 0, 0);
  let rand = createRng(1);
  const api: Petals = {
    mesh,
    burst(origin, n, strength, tick) {
      rand = createRng(1000 + tick);
      for (let k = 0; k < n; k++) {
        const pt = pool[next]!;
        next = (next + 1) % max;
        pt.alive = true;
        // from all over the canopy's underside, right of the trunk
        pt.p.set(origin.x - 1.0 + rand() * 2.4, origin.y - 0.3 + rand() * 0.8, origin.z - 1 + rand() * 2.2); // off the branch
        pt.v.set((2.0 + rand() * 2.8) * strength, -1.1 + rand() * 1.0, -(0.8 + rand() * 3.2) * strength); // out and down over the valley
        pt.age = -rand() * 0.5; // a stream, not a single puff
        pt.life = 2.6 + rand() * 2.2;
        pt.spin.set(rand() * 6 - 3, rand() * 6 - 3, rand() * 6 - 3);
        pt.phase = rand() * Math.PI * 2;
      }
    },
    step(dt) {
      for (const pt of pool) {
        if (!pt.alive) continue;
        pt.age += dt;
        if (pt.age < 0) continue;
        if (pt.age > pt.life) {
          pt.alive = false;
          continue;
        }
        // drifting: a little gravity, air drag, a flutter across the wind
        pt.v.y -= 0.55 * dt;
        pt.v.multiplyScalar(1 - 0.35 * dt);
        pt.p.addScaledVector(pt.v, dt);
        pt.p.y += Math.sin(pt.age * 5 + pt.phase) * 0.25 * dt;
      }
    },
    sync() {
      pool.forEach((pt, i) => {
        const shown = pt.alive && pt.age >= 0;
        const fade = shown ? Math.min(1, pt.age * 4, (pt.life - pt.age) * 1.5) : 0;
        e.set(pt.spin.x * pt.age + pt.phase, pt.spin.y * pt.age, pt.spin.z * pt.age);
        q.setFromEuler(e);
        m.compose(pt.p, q, shown ? scl.setScalar(Math.max(fade, 1e-3)) : zero);
        mesh.setMatrixAt(i, m);
      });
      mesh.instanceMatrix.needsUpdate = true;
    },
    live: () => pool.filter((p) => p.alive).length,
    clear() {
      for (const p of pool) p.alive = false;
    },
  };
  return api;
}
