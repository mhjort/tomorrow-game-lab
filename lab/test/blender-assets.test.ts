import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { ROOT, SKILLS, hasBlender, tmp, run } from './helpers.ts';
import { inspectGlb } from '../../skills/blender-assets/scripts/inspect_glb.ts';
import type { Bone, Object3D } from 'three';

/** Rig landmarks printed by the Blender scripts: name → [x, y, z] (Blender Z-up). */
type Vec3 = [number, number, number];
type Landmarks = Record<'hand.L' | 'shoulder.L' | 'hip.L' | 'neck', Vec3>;

/** The JSON after `prefix` on the first stdout line that starts with it. */
const resultLine = (stdout: string, prefix: string): string => {
  const line = stdout.split('\n').find((l) => l.startsWith(prefix));
  assert.ok(line, `no "${prefix}" line in output`);
  return line.slice(prefix.length);
};

test('lab_bpy: script -> GLB with collider tags + preview render', { skip: !hasBlender() && 'blender missing', timeout: 120000 }, () => {
  const proj = tmp('blender');
  mkdirSync(join(proj, 'assets/src'), { recursive: true });
  mkdirSync(join(proj, 'design'));
  writeFileSync(join(proj, 'design/style.json'), JSON.stringify({ palette: { floor: '#336699', prop: '#e4572e' } }));
  copyFileSync(join(SKILLS, 'blender-assets/scripts/lab_bpy.py'), join(proj, 'assets/src/lab_bpy.py'));
  writeFileSync(
    join(proj, 'assets/src/crate.py'),
    `import os, sys; sys.path.insert(0, os.path.dirname(__file__))
import lab_bpy as L
L.reset_scene()
style = L.load_style()
floor = L.box("Floor", (2, 2, 0.1), (0, 0, -0.05), L.material("Floor", L.color("floor", style)))
L.tag_collider(floor, "trimesh", friction=0.9)
crate = L.bevel(L.box("Crate", (0.5, 0.5, 0.5), (0, 0, 0.25), L.material("Prop", L.color("prop", style))), 0.03)
L.tag_collider(crate, "hull", restitution=0.4)
goal = L.box("Goal", (0.3, 0.3, 0.3), (0.7, 0.7, 0.15))
L.tag_collider(goal, "cuboid", sensor=True, collider_only=True)
L.cut_hole(floor, -0.5, -0.5, 0.0, 0.1, 0.12, name="Pit")
L.finish(__file__, style, {"pitch_deg": 35})
`,
  );
  const r = run(join(SKILLS, 'blender-assets/scripts/run_blender.sh'), ['assets/src/crate.py'], { cwd: proj });
  assert.equal(r.status, 0, r.stdout.slice(-2000) + r.stderr.slice(-2000));
  assert.ok(existsSync(join(proj, '.lab/previews/crate.png')), 'preview rendered');
  const info = inspectGlb(join(proj, 'public/models/crate.glb'));
  assert.deepEqual(info.problems, []);
  assert.ok(info.triangles > 12 && info.triangles < 500, `tris ${info.triangles}`);
  assert.deepEqual(info.colliders.sort(), ['Crate:hull', 'Floor:trimesh', 'Goal:cuboid(sensor)', 'PitFloor:trimesh', 'PitSensor:cuboid(sensor)', 'PitWall:trimesh']);
  const crate = info.nodes.find((n) => n.name === 'Crate');
  assert.ok(crate?.extras && crate.translation, 'Crate node with extras and a translation');
  assert.equal(crate.extras['restitution'], 0.4);
  // Blender Z-up -> glTF Y-up: crate origin at Blender z=0.25 becomes translation y=0.25
  const [, ty = NaN, tz = NaN] = crate.translation;
  assert.ok(Math.abs(ty - 0.25) < 1e-4 && Math.abs(tz) < 1e-4, `crate translation ${crate.translation}`);
});

test('lab_bpy.finish fails on z-fighting: coplanar overlapping faces of two materials', { skip: !hasBlender() && 'blender missing', timeout: 120000 }, () => {
  const proj = tmp('zfight');
  mkdirSync(join(proj, 'assets/src'), { recursive: true });
  copyFileSync(join(SKILLS, 'blender-assets/scripts/lab_bpy.py'), join(proj, 'assets/src/lab_bpy.py'));
  const script = (shaftTop: number): string => `import os, sys; sys.path.insert(0, os.path.dirname(__file__))
import lab_bpy as L
L.reset_scene()
a, b, c = L.material("A", (0.8, 0.8, 0.7, 1)), L.material("B", (0.8, 0.6, 0.5, 1)), L.material("C", (0.2, 0.3, 0.2, 1))
L.box("Plinth", (3, 3, 0.3), (0, 0, -0.15), b)              # top at z = 0
L.box("Shaft", (2, 2, 2), (0, 0, ${shaftTop} - 1), a)          # top at z = ${shaftTop}
L.box("Crate", (0.5, 0.5, 0.5), (1.2, 1.2, 0.25), c)        # resting on the plinth: hidden contact, not a fight
L.finish(__file__, None, {})
`;
  writeFileSync(join(proj, 'assets/src/bad.py'), script(0));
  writeFileSync(join(proj, 'assets/src/good.py'), script(-0.3));
  const bad = run(join(SKILLS, 'blender-assets/scripts/run_blender.sh'), ['assets/src/bad.py', '--no-preview'], { cwd: proj });
  assert.notEqual(bad.status, 0, 'flush tops must fail the build');
  assert.match(bad.stdout + bad.stderr, /Z-FIGHT Plinth\[B\] \/ Shaft\[A\]: 4\.0000 m2/);
  assert.doesNotMatch(bad.stdout + bad.stderr, /Crate/);
  const good = run(join(SKILLS, 'blender-assets/scripts/run_blender.sh'), ['assets/src/good.py', '--no-preview'], { cwd: proj });
  assert.equal(good.status, 0, good.stdout.slice(-2000) + good.stderr.slice(-2000));
});

test('lab_bpy.instances: copies of a mesh export once, with EXT_mesh_gpu_instancing transforms', { skip: !hasBlender() && 'blender missing', timeout: 120000 }, () => {
  const proj = tmp('instances');
  mkdirSync(join(proj, 'assets/src'), { recursive: true });
  copyFileSync(join(SKILLS, 'blender-assets/scripts/lab_bpy.py'), join(proj, 'assets/src/lab_bpy.py'));
  writeFileSync(join(proj, 'assets/src/field.py'), `import os, sys; sys.path.insert(0, os.path.dirname(__file__))
import lab_bpy as L
L.reset_scene()
L.box("Ground", (10, 10, 0.1), (0, 0, -0.05))
tall, short = (L.sphere(n, 1.0, (0, 0, 0), 2) for n in ("TallTpl", "ShortTpl"))
meshes = [tall.data, short.data]
for t in (tall, short):
    L.bpy.data.objects.remove(t)  # keep only the mesh data
L.instances("Blades", [(meshes[i % 2], (i * 0.1, 0, 0), (0, 0.1, 0), (0.03, 0.03, 0.15)) for i in range(60)])
L.finish(__file__, None, {})
`);
  const r = run(join(SKILLS, 'blender-assets/scripts/run_blender.sh'), ['assets/src/field.py', '--no-preview'], { cwd: proj });
  assert.equal(r.status, 0, r.stdout.slice(-2000) + r.stderr.slice(-2000));
  const glb = readFileSync(join(proj, 'public/models/field.glb'));
  type Gltf = { meshes: unknown[]; accessors: { count: number }[]; nodes: { name: string; extensions?: { EXT_mesh_gpu_instancing?: { attributes: Record<string, number> } } }[] };
  const json = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString('utf8')) as Gltf;
  const batches = json.nodes.flatMap((n) => (n.extensions?.EXT_mesh_gpu_instancing ? [n.extensions.EXT_mesh_gpu_instancing] : []));
  assert.equal(batches.length, 2, 'one instanced node per distinct mesh');
  assert.deepEqual(batches.map((b) => json.accessors[b.attributes['TRANSLATION']!]!.count), [30, 30]);
  assert.equal(json.meshes.length, 3, 'ground + two blade meshes, each stored once');
});

test('lab_bpy.import_glb: generated GLB -> facing, scale, bottom-centre origin, tri + texture budget', { skip: !hasBlender() && 'blender missing', timeout: 180000 }, () => {
  const proj = tmp('import-glb');
  mkdirSync(join(proj, 'assets/src'), { recursive: true });
  copyFileSync(join(SKILLS, 'blender-assets/scripts/lab_bpy.py'), join(proj, 'assets/src/lab_bpy.py'));
  // a stand-in for a provider GLB: front (a tall "nose") along +X, off-centre, 1.4 m long, with a 512 px texture
  writeFileSync(
    join(proj, 'assets/src/_make_source.py'),
    `import os, sys; sys.path.insert(0, os.path.dirname(__file__))
import bpy, lab_bpy as L
L.reset_scene()
img = bpy.data.images.new("Tex", 512, 512)
img.pixels.foreach_set([0.9, 0.5, 0.1, 1.0] * 512 * 512)
img.pack()
mat = bpy.data.materials.new("Painted")
nt = mat.node_tree
tex = nt.nodes.new("ShaderNodeTexImage"); tex.image = img
nt.links.new(tex.outputs["Color"], nt.nodes["Principled BSDF"].inputs["Base Color"])
body = L.sphere("Body", 0.5, (2.0, 1.0, 3.0), subdivisions=4, mat=mat)
nose = L.box("Nose", (0.2, 0.2, 1.5), (2.8, 1.0, 3.25), mat)
L.export_glb("assets/generated/thing.glb")
`,
  );
  writeFileSync(
    join(proj, 'assets/src/thing.py'),
    `import os, sys, json; sys.path.insert(0, os.path.dirname(__file__))
import lab_bpy as L
L.reset_scene()
o = L.import_glb("assets/generated/thing.glb", "Thing", forward="+X", length=3.0, max_tris=200, max_texture=64)
top = max(o.data.vertices, key=lambda v: v.co.z).co
print("RESULT " + json.dumps({"dims": list(o.dimensions), "top": list(top), "tex": [list(n.image.size) for s in o.material_slots for n in s.material.node_tree.nodes if n.type == "TEX_IMAGE"]}))
L.finish(__file__, None, {})
`,
  );
  const rb = (script: string) => run(join(SKILLS, 'blender-assets/scripts/run_blender.sh'), [script], { cwd: proj });
  const a = rb('assets/src/_make_source.py');
  assert.equal(a.status, 0, a.stdout.slice(-1500) + a.stderr.slice(-1500));
  const b = rb('assets/src/thing.py');
  assert.equal(b.status, 0, b.stdout.slice(-2000) + b.stderr.slice(-2000));
  const res = JSON.parse(resultLine(b.stdout, 'RESULT ')) as { dims: Vec3; top: Vec3; tex: number[][] };
  assert.ok(Math.abs(res.dims[1] - 3.0) < 0.01, `length along Y = 3 m: ${res.dims}`);
  assert.ok(res.top[1] < -0.8, `nose (front) turned to -Y: ${res.top}`);
  assert.deepEqual(res.tex, [[64, 64]]);
  const info = inspectGlb(join(proj, 'public/models/thing.glb'));
  assert.ok(info.triangles <= 200, `decimated to budget: ${info.triangles}`);
  assert.deepEqual(info.imageTypes, ['image/jpeg']);
  const m = info.meshes[0];
  assert.ok(m, 'one mesh');
  const [x0 = NaN, y0 = NaN, z0 = NaN] = m.min;
  const [x1 = NaN, , z1 = NaN] = m.max;
  assert.ok(Math.abs(y0) < 0.01, `bottom at y=0: ${m.min}`);
  assert.ok(Math.abs(x0 + x1) < 0.01 && Math.abs(z0 + z1) < 0.01, `centred: ${m.min} ${m.max}`);
  assert.ok(z1 > 1.4, `front is three.js +Z: ${m.max}`);
});

test('lab_rig: auto-rig a T-pose figure, procedural clips, and the runtime plays them on independent clones', { skip: !hasBlender() && 'blender missing', timeout: 240000 }, async () => {
  const proj = tmp('rig');
  mkdirSync(join(proj, 'assets/src'), { recursive: true });
  for (const f of ['lab_bpy.py', 'lab_rig.py']) copyFileSync(join(SKILLS, 'blender-assets/scripts', f), join(proj, 'assets/src', f));
  // a blocky 1.6 m figure in a T-pose, facing -Y, joined into one mesh like a generated model
  writeFileSync(
    join(proj, 'assets/src/dummy.py'),
    `import os, sys, json; sys.path.insert(0, os.path.dirname(__file__))
import lab_bpy as L, lab_rig as R
L.reset_scene()
m = L.material("Skin", (0.8, 0.5, 0.3, 1))
parts = [L.box("LegL", (0.14, 0.16, 0.8), (0.12, 0, 0.4), m), L.box("LegR", (0.14, 0.16, 0.8), (-0.12, 0, 0.4), m),
         L.box("Torso", (0.44, 0.24, 0.55), (0, 0, 1.075), m), L.box("Arms", (1.5, 0.12, 0.12), (0, 0, 1.28), m),
         L.box("Head", (0.24, 0.24, 0.26), (0, 0, 1.47), m), L.box("Nose", (0.04, 0.06, 0.04), (0, -0.14, 1.47), m)]
for p in parts:
    mod = p.modifiers.new("Sub", "SUBSURF"); mod.subdivision_type = "SIMPLE"; mod.levels = 3
    L.apply_all_modifiers(p)
body = L.join(parts, "Dummy")
rig = R.rig_biped(body)
R.add_biped_clips(rig)
R.render_pose_sheet(rig, ".lab/previews/dummy-poses.png", tile=128)
print("LM " + rig["landmarks"])
L.finish(__file__, None, {})
`,
  );
  const r = run(join(SKILLS, 'blender-assets/scripts/run_blender.sh'), ['assets/src/dummy.py', '--', '--no-preview'], { cwd: proj });
  assert.equal(r.status, 0, r.stdout.slice(-2500) + r.stderr.slice(-2500));
  const lm = JSON.parse(resultLine(r.stdout, 'LM ')) as Landmarks;
  const near = (a: number, b: number, tol: number, what: string) => assert.ok(Math.abs(a - b) < tol, `${what}: ${a} vs ${b}`);
  near(lm['hand.L'][0], 0.75, 0.05, 'left hand at +X arm tip');
  near(lm['shoulder.L'][2], 1.28, 0.06, 'shoulder at arm height');
  near(lm['hip.L'][2], 0.8, 0.08, 'hip at the crotch');
  near(lm['hip.L'][0], 0.12, 0.04, 'left leg at +X');
  assert.ok(lm.neck[2] > 1.3 && lm.neck[2] < 1.42, `neck between shoulders and head: ${lm.neck}`);
  assert.ok(existsSync(join(proj, '.lab/previews/dummy-poses.png')), 'pose sheet');

  const glb = join(proj, 'public/models/dummy.glb');
  const info = inspectGlb(glb);
  assert.equal(info.joints, 16);
  assert.deepEqual(info.animations.sort(), ['idle', 'jump', 'run', 'walk']);

  // runtime contract: GLTFLoader + SkeletonUtils.clone + createAnimator, with three from the example project
  const req = createRequire(join(ROOT, 'examples/minigolf/package.json'));
  const imp = (m: string): Promise<unknown> => import(pathToFileURL(req.resolve(m)).href);
  const { GLTFLoader } = (await imp('three/addons/loaders/GLTFLoader.js')) as typeof import('three/addons/loaders/GLTFLoader.js');
  const SkeletonUtils = (await imp('three/addons/utils/SkeletonUtils.js')) as typeof import('three/addons/utils/SkeletonUtils.js');
  const { createAnimator } = (await import(pathToFileURL(join(ROOT, 'examples/minigolf/src/engine/animation.ts')).href)) as typeof import('../../skills/web-game-runtime/assets/template/src/engine/animation.ts');
  const buf = readFileSync(glb);
  const gltf = await new GLTFLoader().parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length), '');
  const mk = () => {
    const s = SkeletonUtils.clone(gltf.scene);
    s.userData['animations'] = gltf.animations;
    return s;
  };
  const [a, b] = [mk(), mk()];
  const thigh = (s: Object3D): Object3D => {
    const t = s.getObjectByName('thighL') ?? s.getObjectByName('thigh.L');
    const bones: string[] = [];
    s.traverse((o) => void ((o as Bone).isBone && bones.push(o.name)));
    assert.ok(t, `bone names: ${bones}`);
    return t;
  };
  const animA = createAnimator(a);
  const animB = createAnimator(b);
  assert.deepEqual(animA.clips.sort(), ['idle', 'jump', 'run', 'walk']);
  const rest = thigh(b).quaternion.clone();
  animA.play('walk');
  animA.play('walk'); // repeat calls are no-ops
  animB.play('idle');
  for (let i = 0; i < 15; i++) {
    animA.update(1 / 60);
    animB.update(1 / 60);
  }
  assert.deepEqual(animA.counts, { walk: 1 });
  assert.ok(thigh(a).quaternion.angleTo(rest) > 0.1, 'walk swings the thigh');
  assert.ok(thigh(b).quaternion.angleTo(rest) < 0.05, 'the other clone is independent (idle barely moves the legs)');
  assert.throws(() => animA.play('dance'), /no animation "dance"/);
});

test('lab_rig: A-pose block figure with hands beside the hem and a big cube head (rigid head)', { skip: !hasBlender() && 'blender missing', timeout: 240000 }, () => {
  const proj = tmp('rig-apose');
  mkdirSync(join(proj, 'assets/src'), { recursive: true });
  for (const f of ['lab_bpy.py', 'lab_rig.py']) copyFileSync(join(SKILLS, 'blender-assets/scripts', f), join(proj, 'assets/src', f));
  // the snowplough villager's shape: 1.1 m, head as wide as the coat, arms sloping down to beside the hem
  writeFileSync(
    join(proj, 'assets/src/blocky.py'),
    `import os, sys, json, math; sys.path.insert(0, os.path.dirname(__file__))
import lab_bpy as L, lab_rig as R
L.reset_scene()
m = L.material("Skin", (0.8, 0.5, 0.3, 1))
parts = [L.box("LegL", (0.1, 0.14, 0.4), (0.08, 0, 0.2), m), L.box("LegR", (0.1, 0.14, 0.4), (-0.08, 0, 0.2), m),
         L.box("Coat", (0.32, 0.24, 0.34), (0, 0, 0.57), m), L.box("Head", (0.36, 0.36, 0.36), (0, 0, 0.92), m)]
for s in (1, -1):
    arm = L.box("Arm", (0.09, 0.09, 0.34), (0, 0, 0), m)
    arm.rotation_euler = (0, -s * math.radians(40), 0)  # hand end out and down
    arm.location = (s * 0.27, 0, 0.55)  # shoulders inside the coat top, hands beside the hem
    parts.append(arm)
for p in parts:
    mod = p.modifiers.new("Sub", "SUBSURF"); mod.subdivision_type = "SIMPLE"; mod.levels = 3
    L.apply_all_modifiers(p)
    L.apply_transform(p)
body = L.join(parts, "Blocky")
rig = R.rig_biped(body)
lm = json.loads(rig["landmarks"])
head = body.vertex_groups["head"].index
loose = sum(1 for v in body.data.vertices if v.co.z > 0.76 and any(g.group != head and g.weight > 0.01 for g in v.groups))
print("RES " + json.dumps({"lm": lm, "loose": loose}))
`,
  );
  const r = run(join(SKILLS, 'blender-assets/scripts/run_blender.sh'), ['assets/src/blocky.py', '--', '--no-preview'], { cwd: proj });
  assert.equal(r.status, 0, r.stdout.slice(-2500) + r.stderr.slice(-2500));
  const { lm, loose } = JSON.parse(resultLine(r.stdout, 'RES ')) as { lm: Landmarks; loose: unknown };
  assert.ok(lm['hand.L'][0] > 0.3 && lm['hand.L'][2] < lm['shoulder.L'][2], `A-pose hand found: ${lm['hand.L']}`);
  assert.ok(lm.neck[2] > 0.66 && lm.neck[2] < 0.78, `neck at the coat top: ${lm.neck}`);
  assert.equal(loose, 0, 'every head vertex is bound to the head bone only');
});

test('lab_rig: rig_vehicle cuts the generated plough\'s four wheels (not its blade), rig_rotor a windmill; createParts turns them', { skip: !hasBlender() && 'blender missing', timeout: 240000 }, async () => {
  const proj = tmp('rig-parts');
  mkdirSync(join(proj, 'assets/src'), { recursive: true });
  for (const f of ['lab_bpy.py', 'lab_rig.py']) copyFileSync(join(SKILLS, 'blender-assets/scripts', f), join(proj, 'assets/src', f));
  // a real image-to-3D model: tyres with tread, fused to the body; the blade touches the ground at its tips
  const plough = join(ROOT, 'examples/snowplough/assets/generated/plough.glb');
  writeFileSync(
    join(proj, 'assets/src/plough.py'),
    `import os, sys, json; sys.path.insert(0, os.path.dirname(__file__))
import lab_bpy as L, lab_rig as R
L.reset_scene()
body = L.import_glb(${JSON.stringify(plough)}, "Plough", forward="-X", length=3.6, max_texture=256)
for slot in body.material_slots:  # no texture: GLTFLoader can't decode images in Node
    slot.material = L.material("Paint", (0.9, 0.5, 0.1, 1))
wheels = R.rig_vehicle(body)
R.render_parts_sheet(body, ".lab/previews/plough-parts.png", tile=96)
print("RES " + json.dumps([{"name": w.name, "at": list(w.location), "r": w["wheel_radius"], "steer": w["steer"], "faces": len(w.children[0].data.polygons)} for w in wheels]))
L.finish(__file__, None, {})
`,
  );
  writeFileSync(
    join(proj, 'assets/src/mill.py'),
    `import os, sys, json; sys.path.insert(0, os.path.dirname(__file__))
import lab_bpy as L, lab_rig as R
L.reset_scene()
tower = L.box("Tower", (0.6, 0.6, 2.0), (0, 0, 1.0))
sail = L.box("Sail", (2.0, 0.05, 0.2), (0, -0.4, 1.8))
sail2 = L.box("Sail2", (0.2, 0.05, 2.0), (0, -0.4, 1.8))
for o in (tower, sail, sail2):
    L.apply_transform(o)
mill = L.join([tower, sail, sail2], "Mill")
rotor = R.rig_rotor(mill, "sails", (0, -0.4, 1.8), axis="Y", radius=1.1, depth=0.1)
print("RES " + json.dumps({"faces": len(rotor.children[0].data.polygons), "body": len(mill.data.polygons), "axis": list(rotor["spin_axis"])}))
L.finish(__file__, None, {})
`,
  );
  const r = run(join(SKILLS, 'blender-assets/scripts/run_blender.sh'), ['assets/src/plough.py', '--', '--no-preview'], { cwd: proj });
  assert.equal(r.status, 0, r.stdout.slice(-2500) + r.stderr.slice(-2500));
  const wheels = (JSON.parse(resultLine(r.stdout, 'RES ')) as { name: string; at: Vec3; r: number; steer: number; faces: number }[]).sort((a, b) => a.name.localeCompare(b.name));
  assert.deepEqual(wheels.map((w) => w.name), ['wheel.FL', 'wheel.FR', 'wheel.RL', 'wheel.RR'], 'four tyres; the blade tips are no wheels');
  for (const w of wheels) {
    assert.ok(w.r > 0.37 && w.r < 0.45, `${w.name} radius ${w.r}`);
    assert.ok(Math.abs(w.at[2] - w.r) < 0.01, `${w.name} hub at its radius above the ground: ${w.at}`);
    assert.ok(Math.abs(Math.abs(w.at[0]) - 0.67) < 0.05 && Math.sign(w.at[0]) === (w.name.endsWith('L') ? 1 : -1), `${w.name} x ${w.at}`);
    assert.equal(w.steer, w.name.startsWith('wheel.F') ? 1 : 0);
    assert.ok(w.faces > 300, `${w.name} took the tyre (${w.faces} faces)`);
  }
  assert.ok(existsSync(join(proj, '.lab/previews/plough-parts.png')), 'parts sheet');
  const m = run(join(SKILLS, 'blender-assets/scripts/run_blender.sh'), ['assets/src/mill.py', '--', '--no-preview'], { cwd: proj });
  assert.equal(m.status, 0, m.stdout.slice(-2500) + m.stderr.slice(-2500));
  const mill = JSON.parse(resultLine(m.stdout, 'RES ')) as { faces: number; body: number; axis: number[] };
  assert.equal(mill.faces, 12, 'both sail boxes, nothing of the tower');
  assert.equal(mill.body, 6);
  assert.deepEqual(mill.axis, [0, 0, -1], 'Blender Y = glTF -Z');

  // runtime: the wheels are empties on the hubs (meshes under them), createParts rolls and steers them
  const req = createRequire(join(ROOT, 'examples/minigolf/package.json'));
  const imp = (mod: string): Promise<unknown> => import(pathToFileURL(req.resolve(mod)).href);
  const { GLTFLoader } = (await imp('three/addons/loaders/GLTFLoader.js')) as typeof import('three/addons/loaders/GLTFLoader.js');
  const { createParts } = (await import(pathToFileURL(join(ROOT, 'examples/minigolf/src/engine/animation.ts')).href)) as typeof import('../../skills/web-game-runtime/assets/template/src/engine/animation.ts');
  const load = async (f: string) => {
    const buf = readFileSync(join(proj, 'public/models', f));
    return (await new GLTFLoader().parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length), '')).scene;
  };
  const scene = await load('plough.glb');
  const parts = createParts(scene);
  assert.equal(parts.wheels.length, 4);
  const fl = parts.wheels.find((w) => w.node.name === 'wheelFL');
  assert.ok(fl && fl.steers && fl.node.children.length === 1, 'wheel.FL is an empty holding its mesh');
  assert.ok(Math.abs(fl.node.position.z - 0.316) < 0.02 && Math.abs(fl.node.position.y - fl.radius) < 0.01, `hub in glTF axes: ${fl.node.position.toArray()}`);
  parts.drive(fl.radius * 0.5, 0.3);
  assert.ok(Math.abs(fl.node.rotation.x - 0.5) < 1e-6, 'rolled half a radian forward');
  assert.equal(fl.node.rotation.y, 0.3);
  assert.equal(parts.wheels.find((w) => w.node.name === 'wheelRL')!.node.rotation.y, 0, 'rear wheels do not steer');
  const millScene = await load('mill.glb');
  const mp = createParts(millScene);
  assert.equal(mp.rotors.length, 1);
  mp.spin(0.25);
  assert.ok(Math.abs(mp.rotors[0]!.node.quaternion.angleTo(mp.rotors[0]!.rest) - Math.PI / 2) < 1e-6, 'a quarter turn');
});

test('lab_rig: rig_quadruped on a blocky dog: legs, belly, head and tail measured; gaits play', { skip: !hasBlender() && 'blender missing', timeout: 240000 }, () => {
  const proj = tmp('rig-quad');
  mkdirSync(join(proj, 'assets/src'), { recursive: true });
  for (const f of ['lab_bpy.py', 'lab_rig.py']) copyFileSync(join(SKILLS, 'blender-assets/scripts', f), join(proj, 'assets/src', f));
  // body 0.39..0.71 m high, legs at x ±0.12 and y ±0.33, the head raised in front (-Y), a tail behind
  writeFileSync(
    join(proj, 'assets/src/dog.py'),
    `import os, sys, json; sys.path.insert(0, os.path.dirname(__file__))
import lab_bpy as L, lab_rig as R
L.reset_scene()
m = L.material("Fur", (0.8, 0.5, 0.25, 1))
parts = [L.box("Body", (0.36, 0.9, 0.32), (0, 0, 0.55), m), L.box("Neck", (0.16, 0.16, 0.3), (0, -0.48, 0.78), m),
         L.box("Head", (0.24, 0.36, 0.22), (0, -0.62, 0.95), m), L.box("Tail", (0.06, 0.35, 0.06), (0, 0.6, 0.72), m)]
parts += [L.box("Leg", (0.1, 0.1, 0.42), (x, y, 0.21), m) for x in (-0.12, 0.12) for y in (-0.33, 0.33)]
for p in parts:
    mod = p.modifiers.new("Sub", "SUBSURF"); mod.subdivision_type = "SIMPLE"; mod.levels = 3
    L.apply_all_modifiers(p)
    L.apply_transform(p)
body = L.join(parts, "Dog")
rig = R.rig_quadruped(body)
R.add_quadruped_clips(rig)
R.render_pose_sheet(rig, ".lab/previews/dog-poses.png", tile=96)
head = body.vertex_groups["head"].index
loose = sum(1 for v in body.data.vertices if v.co.y < -0.6 and v.co.z > 0.85 and any(g.group != head and g.weight > 0.01 for g in v.groups))
print("RES " + json.dumps({"lm": json.loads(rig["landmarks"]), "loose": loose}))
L.finish(__file__, None, {})
`,
  );
  const r = run(join(SKILLS, 'blender-assets/scripts/run_blender.sh'), ['assets/src/dog.py', '--', '--no-preview'], { cwd: proj });
  assert.equal(r.status, 0, r.stdout.slice(-2500) + r.stderr.slice(-2500));
  const { lm, loose } = JSON.parse(resultLine(r.stdout, 'RES ')) as { lm: Record<string, Vec3>; loose: number };
  const near = (a: number, b: number, tol: number, what: string) => assert.ok(Math.abs(a - b) < tol, `${what}: ${a} vs ${b}`);
  near(lm['knee.FL']![2] * 2, 0.39, 0.03, 'belly at the body bottom (knees half way)');
  for (const [leg, x, y] of [['FL', 0.12, -0.33], ['FR', -0.12, -0.33], ['HL', 0.12, 0.33], ['HR', -0.12, 0.33]] as const) {
    near(lm[`ankle.${leg}`]![0], x, 0.03, `${leg} x`);
    near(lm[`ankle.${leg}`]![1], y, 0.03, `${leg} y`);
  }
  assert.ok(lm['nose']![1] < -0.75 && lm['head']![2] > 0.85, `head forward and up: ${lm['head']} ${lm['nose']}`);
  assert.ok(lm['tail_tip'] && lm['tail_tip'][1] > 0.7, `tail found: ${lm['tail_tip']}`);
  assert.equal(loose, 0, 'the head is rigid');
  const info = inspectGlb(join(proj, 'public/models/dog.glb'));
  assert.equal(info.joints, 19, 'root, hips, chest, neck, head, 2 tail, 3 per leg');
  assert.deepEqual(info.animations.sort(), ['gallop', 'idle', 'trot', 'walk']);
  assert.ok(existsSync(join(proj, '.lab/previews/dog-poses.png')), 'pose sheet');
});

test('inspect_glb reports counts without capping them; budgets are opt-in flags', { skip: !existsSync(new URL('../../examples/minigolf/public/models/hole1.glb', import.meta.url).pathname) && 'example not built' }, () => {
  const f = new URL('../../examples/minigolf/public/models/hole1.glb', import.meta.url).pathname;
  const r = run(process.execPath, [join(SKILLS, 'blender-assets/scripts/inspect_glb.ts'), f, '--max-tris', '10']);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /PROBLEM: triangles/);
  const plain = run(process.execPath, [join(SKILLS, 'blender-assets/scripts/inspect_glb.ts'), f]);
  assert.equal(plain.status, 0, 'no budget unless one is passed (fidelity first while building)');
  assert.doesNotMatch(plain.stdout, /PROBLEM/);
});
