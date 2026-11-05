// Rapier 3D wrapper. For 2D games swap to @dimforge/rapier2d (see references/rapier2d.md).
// Rapier is a dynamic import of the non-compat build: a real .wasm file (~1.1 MB gzip, streaming compile,
// needs vite-plugin-wasm) that downloads in parallel with the models. The -compat build inlines the WASM as
// base64 (~1.6 MB gzip + main-thread decode), so avoid it for release builds.
import * as THREE from 'three/webgpu';
import type * as R from '@dimforge/rapier3d';

export type Rapier = typeof R;
type ColliderKind = 'trimesh' | 'hull' | 'cuboid' | 'ball';

export interface Physics {
  RAPIER: Rapier;
  world: R.World;
  events: R.EventQueue;
  /** Advance one fixed step (= `substeps` world steps) and dispatch sensor/contact events. */
  step(): void;
  /** Copy body transforms to their bound three.js objects (call before render). */
  sync(): void;
  /** Remove a body with its colliders, sensor handlers and mesh bindings (use when unloading a level). */
  removeBody(body: R.RigidBody): void;
  bind(body: R.RigidBody, object: THREE.Object3D): void;
  onSensor(collider: R.Collider, fn: (other: R.Collider, started: boolean) => void): void;
  /**
   * Build static colliders from a loaded glTF scene using blender-assets tags:
   *   userData.collider = trimesh | hull | cuboid | ball, friction, restitution, sensor, collider_only
   *   or name suffix _col (trimesh) / _hull (convex hull).
   * Returns { [objectName]: collider }.
   */
  collidersFromGltf(root: THREE.Object3D, opts?: { body?: R.RigidBody }): Record<string, R.Collider>;
}

let RAPIER: Rapier | undefined;

// substeps: Rapier clamps rotation to ~π/4 per step, i.e. 47 rad/s at 60 Hz. Small fast-rolling
// bodies (a 5 cm ball at 4 m/s needs 80 rad/s) decelerate unnaturally unless you substep (4 is plenty).
export async function createPhysics({
  gravity = { x: 0, y: -9.81, z: 0 },
  hz = 60,
  substeps = 1,
}: { gravity?: R.Vector; hz?: number; substeps?: number } = {}): Promise<Physics> {
  if (!RAPIER) {
    const mod = (await import('@dimforge/rapier3d')) as Rapier & { default?: Rapier; init?: () => Promise<void> };
    RAPIER = mod.default ?? mod;
    const init = (RAPIER as { init?: () => Promise<void> }).init;
    if (typeof init === 'function') await init(); // -compat builds need init()
  }
  const rapier = RAPIER;
  const world = new rapier.World(gravity);
  world.timestep = 1 / hz / substeps;
  const events = new rapier.EventQueue(true);
  const bindings: { body: R.RigidBody; object: THREE.Object3D }[] = []; // mesh follows body
  const sensorHandlers = new Map<number, (other: R.Collider, started: boolean) => void>(); // collider handle -> fn

  return {
    RAPIER: rapier,
    world,
    events,

    step() {
      for (let i = 0; i < substeps; i++) {
        world.step(events);
        events.drainCollisionEvents((h1, h2, started) => {
          for (const [a, b] of [
            [h1, h2],
            [h2, h1],
          ] as const) {
            const fn = sensorHandlers.get(a);
            if (fn) fn(world.getCollider(b), started);
          }
        });
      }
    },

    sync() {
      for (const { body, object } of bindings) {
        const p = body.translation();
        const q = body.rotation();
        object.position.set(p.x, p.y, p.z);
        object.quaternion.set(q.x, q.y, q.z, q.w);
      }
    },

    removeBody(body) {
      for (let i = 0; i < body.numColliders(); i++) sensorHandlers.delete(body.collider(i).handle);
      for (let i = bindings.length - 1; i >= 0; i--) if (bindings[i]?.body === body) bindings.splice(i, 1);
      world.removeRigidBody(body);
    },

    bind(body, object) {
      bindings.push({ body, object });
    },

    onSensor(collider, fn) {
      collider.setActiveEvents(rapier.ActiveEvents.COLLISION_EVENTS);
      sensorHandlers.set(collider.handle, fn);
    },

    collidersFromGltf(root, { body } = {}) {
      root.updateMatrixWorld(true);
      const target = body ?? world.createRigidBody(rapier.RigidBodyDesc.fixed());
      const out: Record<string, R.Collider> = {};
      const tagged: [THREE.Object3D, ColliderKind][] = [];
      root.traverse((o) => {
        const kind: ColliderKind | null = o.userData['collider'] ?? (/_col$/.test(o.name) ? 'trimesh' : /_hull$/.test(o.name) ? 'hull' : null);
        if (kind) tagged.push([o, kind]);
      });
      for (const [o, kind] of tagged) {
        const { vertices, indices } = worldGeometry(o);
        if (!vertices.length) continue;
        let desc: R.ColliderDesc | null;
        if (kind === 'trimesh') desc = rapier.ColliderDesc.trimesh(vertices, indices, rapier.TriMeshFlags.FIX_INTERNAL_EDGES);
        else if (kind === 'hull') desc = rapier.ColliderDesc.convexHull(vertices);
        else {
          const box = new THREE.Box3().setFromObject(o);
          const c = box.getCenter(new THREE.Vector3());
          const s = box.getSize(new THREE.Vector3()).multiplyScalar(0.5);
          desc = kind === 'ball' ? rapier.ColliderDesc.ball(Math.max(s.x, s.y, s.z)) : rapier.ColliderDesc.cuboid(s.x, s.y, s.z);
          desc.setTranslation(c.x, c.y, c.z);
        }
        if (!desc) {
          console.warn(`[physics] could not build ${kind} collider for ${o.name}`);
          continue;
        }
        desc.setFriction(o.userData['friction'] ?? 0.6).setRestitution(o.userData['restitution'] ?? 0.2);
        if (o.userData['sensor']) desc.setSensor(true);
        out[o.name] = world.createCollider(desc, target);
        if (o.userData['collider_only'] || o.userData['sensor']) o.visible = false;
      }
      return out;
    },
  };
}

/**
 * Merge all meshes under `object` into world-space Float32Array vertices + Uint32Array indices.
 * Vertices are welded by position: glTF splits vertices along hard edges/UV seams, and Rapier's
 * FIX_INTERNAL_EDGES needs shared vertices to see triangle adjacency (otherwise balls "bump" on seams).
 */
export function worldGeometry(object: THREE.Object3D, weld = 1e-4): { vertices: Float32Array; indices: Uint32Array } {
  const verts: number[] = [];
  const idx: number[] = [];
  const lookup = new Map<string, number>();
  const v = new THREE.Vector3();
  object.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const g = m.geometry;
    const pos = g.attributes['position'];
    if (!pos) return;
    const remap = new Uint32Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
      const key = `${Math.round(v.x / weld)},${Math.round(v.y / weld)},${Math.round(v.z / weld)}`;
      let j = lookup.get(key);
      if (j === undefined) {
        j = verts.length / 3;
        lookup.set(key, j);
        verts.push(v.x, v.y, v.z);
      }
      remap[i] = j;
    }
    const index = g.index;
    const n = index ? index.count : pos.count;
    const at = (k: number) => remap[index ? index.getX(k) : k]!;
    for (let t = 0; t + 2 < n; t += 3) {
      const a = at(t);
      const b = at(t + 1);
      const c = at(t + 2);
      if (a !== b && b !== c && a !== c) idx.push(a, b, c); // drop degenerate triangles
    }
  });
  return { vertices: new Float32Array(verts), indices: new Uint32Array(idx) };
}
