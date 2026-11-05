#!/usr/bin/env node
// Inspect GLB files without dependencies: triangles, local bounds, nodes, collider tags.
// Usage: node inspect_glb.ts <file.glb...> [--max-tris N] [--max-kb N] [--json]
// Budgets are opt-in: while a game is built to match its reference, counts are reported, not capped. The
// optimize-web-game pass passes budgets for the agreed target device. Exit 1 if a file is invalid or over a budget given.
import { readFileSync, statSync } from 'node:fs';
import { basename } from 'node:path';

const argv = process.argv.slice(2);
const opt = (name: string, def: number): number => {
  const i = argv.indexOf(name);
  return i >= 0 ? Number(argv[i + 1]) : def;
};
const maxTris = opt('--max-tris', Infinity);
const maxKb = opt('--max-kb', Infinity);
const asJson = argv.includes('--json');
const files = argv.filter((a, i) => !a.startsWith('--') && !['--max-tris', '--max-kb'].includes(argv[i - 1] ?? ''));

/** The parts of a glTF JSON chunk this script reads. */
interface Gltf {
  meshes?: { name?: string; primitives: { attributes: Record<string, number>; indices?: number; mode?: number }[] }[];
  accessors: { count: number; min?: number[]; max?: number[] }[];
  nodes?: { name?: string; mesh?: number; translation?: number[]; extras?: Record<string, unknown> }[];
  materials?: { name?: string }[];
  images?: { mimeType?: string }[];
  skins?: { joints: number[] }[];
  animations?: { name?: string }[];
  extensionsUsed?: string[];
}

export interface GlbReport {
  file: string;
  kb: number;
  triangles: number;
  materials: (string | undefined)[];
  textures: number;
  imageTypes: (string | undefined)[];
  joints: number;
  animations: (string | undefined)[];
  extensions: string[];
  meshes: { name: string | undefined; triangles: number; min: number[]; max: number[] }[];
  nodes: { name: string | undefined; mesh: string | null | undefined; translation: number[] | undefined; extras: Record<string, unknown> | undefined; collider: unknown }[];
  colliders: string[];
  problems: string[];
}

export function inspectGlb(path: string): GlbReport {
  const buf = readFileSync(path);
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error(`${path}: not a GLB (bad magic)`);
  const jsonLen = buf.readUInt32LE(12);
  const gltf = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8')) as Gltf;
  let tris = 0;
  const meshes = (gltf.meshes || []).map((m) => {
    let t = 0;
    let min = [Infinity, Infinity, Infinity];
    let max = [-Infinity, -Infinity, -Infinity];
    for (const p of m.primitives) {
      const pos = gltf.accessors[p.attributes['POSITION'] ?? -1];
      if (!pos) continue;
      const count = p.indices !== undefined ? (gltf.accessors[p.indices]?.count ?? 0) : pos.count;
      if ((p.mode ?? 4) === 4) t += count / 3;
      if (pos.min) min = min.map((v, i) => Math.min(v, pos.min?.[i] ?? v));
      if (pos.max) max = max.map((v, i) => Math.max(v, pos.max?.[i] ?? v));
    }
    tris += t;
    return { name: m.name, triangles: t, min, max };
  });
  const nodes = (gltf.nodes || []).map((n) => ({
    name: n.name,
    mesh: n.mesh !== undefined ? gltf.meshes?.[n.mesh]?.name : null,
    translation: n.translation,
    extras: n.extras,
    collider: n.extras?.['collider'] ?? (/_col$/.test(n.name ?? '') ? 'trimesh' : /_hull$/.test(n.name ?? '') ? 'hull' : null),
  }));
  const kb = statSync(path).size / 1024;
  const problems: string[] = [];
  if (tris > maxTris) problems.push(`triangles ${tris} > budget ${maxTris}`);
  if (kb > maxKb) problems.push(`size ${kb.toFixed(0)}KB > budget ${maxKb}KB`);
  if (!nodes.some((n) => n.mesh)) problems.push('no mesh nodes');
  return {
    file: basename(path),
    kb: Number(kb.toFixed(1)),
    triangles: tris,
    materials: (gltf.materials || []).map((m) => m.name),
    textures: (gltf.images || []).length,
    imageTypes: (gltf.images || []).map((i) => i.mimeType),
    joints: (gltf.skins || []).reduce((n, sk) => n + sk.joints.length, 0),
    animations: (gltf.animations || []).map((an) => an.name),
    extensions: gltf.extensionsUsed || [],
    meshes,
    nodes,
    colliders: nodes.filter((n) => n.collider).map((n) => `${n.name}:${n.collider}${n.extras?.['sensor'] ? '(sensor)' : ''}`),
    problems,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (!files.length) {
    console.error('usage: inspect_glb.ts <file.glb...> [--max-tris N] [--max-kb N] [--json]');
    process.exit(2);
  }
  let bad = false;
  const reports: (Partial<GlbReport> & { file: string; problems: string[] })[] = [];
  for (const f of files) {
    try {
      const r = inspectGlb(f);
      reports.push(r);
      if (r.problems.length) bad = true;
    } catch (e) {
      bad = true;
      reports.push({ file: f, problems: [e instanceof Error ? e.message : String(e)] });
    }
  }
  if (asJson) console.log(JSON.stringify(reports, null, 2));
  else
    for (const r of reports) {
      console.log(`${r.file}: ${r.triangles ?? '?'} tris, ${r.kb ?? '?'}KB, materials=[${(r.materials || []).join(', ')}]`);
      if (r.colliders?.length) console.log(`  colliders: ${r.colliders.join(', ')}`);
      if (r.extensions?.length) console.log(`  extensions: ${r.extensions.join(', ')}`);
      for (const p of r.problems) console.log(`  PROBLEM: ${p}`);
    }
  process.exit(bad ? 1 : 0);
}
