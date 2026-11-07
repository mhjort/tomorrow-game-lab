// The orchard: orchard.glb's BareTrunk, BareBranches and Blossom templates instanced at world.glb's Orchard_r<row>_<i> empties.
// Every tree is always bare; its blossom canopy pops in (scale 0 → overshoot → 1, from the canopy's base) when a
// gust reaches it (frames 07→12: a tree turns from bare to pink in well under a second), and its bare branches
// shrink into the fork at the same time, so no tips poke through the canopy.
import * as THREE from 'three/webgpu';
import { createRng } from './engine/testHooks.ts';

export interface Tree {
  row: number;
  /** distance from the swing (m, ground plane): the gust reaches near trees first */
  dist: number;
  /** 0..1 deterministic shuffle so a row doesn't pop in a perfect line */
  jitter: number;
  matrix: THREE.Matrix4;
}

export interface Orchard {
  group: THREE.Group;
  trees: Tree[];
  rows: number;
  /** bloomAt[i] = tick tree i starts to bloom (-1 = bare) */
  sync(bloomAt: number[], tick: number): void;
}

const POP_TICKS = 26;

/** Each mesh under a template node, with its matrix in the template file's space. That includes the node's OWN
 * transform: the release build's meshopt quantization stores the dequantize scale/offset there, and parts measured
 * relative to the node rendered as squat stumps in release builds only (dev builds have no quantization). */
function partsOf(root: THREE.Object3D): { mesh: THREE.Mesh; local: THREE.Matrix4 }[] {
  root.updateWorldMatrix(true, true);
  const out: { mesh: THREE.Mesh; local: THREE.Matrix4 }[] = [];
  root.traverse((o) => {
    if (o instanceof THREE.Mesh) out.push({ mesh: o, local: o.matrixWorld.clone() });
  });
  return out;
}

function pop(k: number): number {
  // ease-out-back: grows past full size and settles (a soft "burst")
  const c = 1.9;
  const t = k - 1;
  return 1 + (c + 1) * t * t * t + c * t * t;
}

export function createOrchard(templates: THREE.Object3D, world: THREE.Object3D): Orchard {
  const trunkNode = templates.getObjectByName('BareTrunk');
  const branchNode = templates.getObjectByName('BareBranches');
  const blossomNode = templates.getObjectByName('Blossom');
  if (!trunkNode || !branchNode || !blossomNode) throw new Error('orchard.glb needs BareTrunk, BareBranches and Blossom');
  const markers: THREE.Object3D[] = [];
  world.updateMatrixWorld(true);
  world.traverse((o) => {
    if (/^Orchard_r\d+_\d+$/.test(o.name)) markers.push(o);
  });
  markers.sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));
  if (!markers.length) throw new Error('world.glb has no Orchard_r<row>_<i> markers');
  const pivot = world.getObjectByName('Pivot')?.getWorldPosition(new THREE.Vector3()) ?? new THREE.Vector3();
  const rand = createRng(7); // the row shuffle: same order every run
  const trees: Tree[] = markers.map((m) => {
    const p = m.getWorldPosition(new THREE.Vector3());
    return {
      row: Number(/_r(\d+)_/.exec(m.name)![1]),
      dist: Math.hypot(p.x - pivot.x, p.z - pivot.z),
      jitter: rand(),
      matrix: m.matrixWorld.clone(),
    };
  });
  const group = new THREE.Group();
  const instanced = (parts: { mesh: THREE.Mesh; local: THREE.Matrix4 }[]) =>
    parts.map(({ mesh, local }) => {
      const im = new THREE.InstancedMesh(mesh.geometry, mesh.material, trees.length);
      im.castShadow = true;
      im.receiveShadow = true;
      im.frustumCulled = false; // instances are spread over the valley; the bounding sphere is the template's
      group.add(im);
      return { im, local };
    });
  const bare = instanced(partsOf(trunkNode));
  const branches = instanced(partsOf(branchNode));
  const blossom = instanced(partsOf(blossomNode));
  const tmp = new THREE.Matrix4();
  trees.forEach((t, i) => {
    for (const { im, local } of bare) im.setMatrixAt(i, tmp.multiplyMatrices(t.matrix, local));
  });
  for (const { im } of bare) im.instanceMatrix.needsUpdate = true;
  // branches shrink toward the fork (the trunk's top)
  const forkBox = new THREE.Box3().setFromObject(trunkNode); // template-file space, like the parts' matrices
  const fork = new THREE.Vector3(0, forkBox.max.y, 0);
  const toFork = new THREE.Matrix4().makeTranslation(fork.x, fork.y, fork.z);
  const fromFork = new THREE.Matrix4().makeTranslation(-fork.x, -fork.y, -fork.z);
  // the canopy grows from its base (just above the trunk's fork)
  const box = new THREE.Box3().setFromObject(blossomNode);
  const base = new THREE.Vector3((box.min.x + box.max.x) / 2, box.min.y + 0.15, (box.min.z + box.max.z) / 2);
  const toBase = new THREE.Matrix4().makeTranslation(base.x, base.y, base.z);
  const fromBase = new THREE.Matrix4().makeTranslation(-base.x, -base.y, -base.z);
  const scale = new THREE.Matrix4();
  const last = trees.map(() => -2);
  return {
    group,
    trees,
    rows: Math.max(...trees.map((t) => t.row)) + 1,
    sync(bloomAt, tick) {
      let dirty = false;
      trees.forEach((t, i) => {
        const at = bloomAt[i] ?? -1;
        const age = at < 0 ? -1 : tick - at;
        const k = age < 0 ? 0 : pop(Math.min(1, age / POP_TICKS));
        if (k === last[i]) return;
        last[i] = k;
        dirty = true;
        const sc = Math.max(k, 1e-4);
        scale.makeScale(sc, sc, sc);
        for (const { im, local } of blossom) {
          im.setMatrixAt(i, tmp.copy(t.matrix).multiply(toBase).multiply(scale).multiply(fromBase).multiply(local));
        }
        const b = Math.max(1 - (age < 0 ? 0 : Math.min(1, age / POP_TICKS)), 1e-4);
        scale.makeScale(b, b, b);
        for (const { im, local } of branches) {
          im.setMatrixAt(i, tmp.copy(t.matrix).multiply(toFork).multiply(scale).multiply(fromFork).multiply(local));
        }
      });
      if (dirty) for (const { im } of [...blossom, ...branches]) im.instanceMatrix.needsUpdate = true;
    },
  };
}
