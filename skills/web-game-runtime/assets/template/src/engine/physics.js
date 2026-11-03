// Rapier 3D wrapper. For 2D games swap to @dimforge/rapier2d-compat (see references/rapier2d.md).
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three/webgpu';

// substeps: Rapier clamps rotation to ~π/4 per step, i.e. 47 rad/s at 60 Hz. Small fast-rolling
// bodies (a 5 cm ball at 4 m/s needs 80 rad/s) decelerate unnaturally unless you substep (4 is plenty).
export async function createPhysics({ gravity = { x: 0, y: -9.81, z: 0 }, hz = 60, substeps = 1 } = {}) {
  await RAPIER.init();
  const world = new RAPIER.World(gravity);
  world.timestep = 1 / hz / substeps;
  const events = new RAPIER.EventQueue(true);
  const bindings = []; // { body, object } — mesh follows body
  const sensorHandlers = new Map(); // collider handle -> fn(otherCollider, started)

  return {
    RAPIER,
    world,
    events,

    /** Advance one fixed step (= `substeps` world steps) and dispatch sensor/contact events. */
    step() {
      for (let i = 0; i < substeps; i++) {
        world.step(events);
        events.drainCollisionEvents((h1, h2, started) => {
          for (const [a, b] of [
            [h1, h2],
            [h2, h1],
          ]) {
            const fn = sensorHandlers.get(a);
            if (fn) fn(world.getCollider(b), started);
          }
        });
      }
    },

    /** Copy body transforms to their bound three.js objects (call before render). */
    sync() {
      for (const { body, object } of bindings) {
        const p = body.translation();
        const q = body.rotation();
        object.position.set(p.x, p.y, p.z);
        object.quaternion.set(q.x, q.y, q.z, q.w);
      }
    },

    /** Remove a body with its colliders, sensor handlers and mesh bindings (use when unloading a level). */
    removeBody(body) {
      for (let i = 0; i < body.numColliders(); i++) sensorHandlers.delete(body.collider(i).handle);
      for (let i = bindings.length - 1; i >= 0; i--) if (bindings[i].body === body) bindings.splice(i, 1);
      world.removeRigidBody(body);
    },

    bind(body, object) {
      bindings.push({ body, object });
    },

    onSensor(collider, fn) {
      collider.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
      sensorHandlers.set(collider.handle, fn);
    },

    /**
     * Build static colliders from a loaded glTF scene using blender-assets tags:
     *   userData.collider = trimesh | hull | cuboid | ball, friction, restitution, sensor, collider_only
     *   or name suffix _col (trimesh) / _hull (convex hull).
     * Returns { [objectName]: collider }.
     */
    collidersFromGltf(root, { body } = {}) {
      root.updateMatrixWorld(true);
      const target = body ?? world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
      const out = {};
      const tagged = [];
      root.traverse((o) => {
        const kind = o.userData.collider ?? (/_col$/.test(o.name) ? 'trimesh' : /_hull$/.test(o.name) ? 'hull' : null);
        if (kind) tagged.push([o, kind]);
      });
      for (const [o, kind] of tagged) {
        const { vertices, indices } = worldGeometry(o);
        if (!vertices.length) continue;
        let desc;
        if (kind === 'trimesh') desc = RAPIER.ColliderDesc.trimesh(vertices, indices, RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES);
        else if (kind === 'hull') desc = RAPIER.ColliderDesc.convexHull(vertices);
        else {
          const box = new THREE.Box3().setFromObject(o);
          const c = box.getCenter(new THREE.Vector3());
          const s = box.getSize(new THREE.Vector3()).multiplyScalar(0.5);
          desc = kind === 'ball' ? RAPIER.ColliderDesc.ball(Math.max(s.x, s.y, s.z)) : RAPIER.ColliderDesc.cuboid(s.x, s.y, s.z);
          desc.setTranslation(c.x, c.y, c.z);
        }
        if (!desc) {
          console.warn(`[physics] could not build ${kind} collider for ${o.name}`);
          continue;
        }
        desc.setFriction(o.userData.friction ?? 0.6).setRestitution(o.userData.restitution ?? 0.2);
        if (o.userData.sensor) desc.setSensor(true);
        out[o.name] = world.createCollider(desc, target);
        if (o.userData.collider_only || o.userData.sensor) o.visible = false;
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
export function worldGeometry(object, weld = 1e-4) {
  const verts = [];
  const idx = [];
  const lookup = new Map();
  const v = new THREE.Vector3();
  object.traverse((m) => {
    if (!m.isMesh) return;
    const g = m.geometry;
    const pos = g.attributes.position;
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
    const n = g.index ? g.index.count : pos.count;
    for (let t = 0; t + 2 < n; t += 3) {
      const a = remap[g.index ? g.index.getX(t) : t];
      const b = remap[g.index ? g.index.getX(t + 1) : t + 1];
      const c = remap[g.index ? g.index.getX(t + 2) : t + 2];
      if (a !== b && b !== c && a !== c) idx.push(a, b, c); // drop degenerate triangles
    }
  });
  return { vertices: new Float32Array(verts), indices: new Uint32Array(idx) };
}
