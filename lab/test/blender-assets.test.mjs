import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SKILLS, hasBlender, tmp, run } from './helpers.mjs';
import { inspectGlb } from '../../skills/blender-assets/scripts/inspect_glb.mjs';

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
L.finish(__file__, style, {"pitch_deg": 35})
`,
  );
  const r = run(join(SKILLS, 'blender-assets/scripts/run_blender.sh'), ['assets/src/crate.py'], { cwd: proj });
  assert.equal(r.status, 0, r.stdout.slice(-2000) + r.stderr.slice(-2000));
  assert.ok(existsSync(join(proj, '.lab/previews/crate.png')), 'preview rendered');
  const info = inspectGlb(join(proj, 'public/models/crate.glb'));
  assert.deepEqual(info.problems, []);
  assert.ok(info.triangles > 12 && info.triangles < 500, `tris ${info.triangles}`);
  assert.deepEqual(info.colliders.sort(), ['Crate:hull', 'Floor:trimesh', 'Goal:cuboid(sensor)']);
  const crate = info.nodes.find((n) => n.name === 'Crate');
  assert.equal(crate.extras.restitution, 0.4);
  // Blender Z-up -> glTF Y-up: crate origin at Blender z=0.25 becomes translation y=0.25
  assert.ok(Math.abs(crate.translation[1] - 0.25) < 1e-4 && Math.abs(crate.translation[2]) < 1e-4, `crate translation ${crate.translation}`);
});

test('inspect_glb flags budget violations', { skip: !existsSync(new URL('../../examples/minigolf/public/models/hole1.glb', import.meta.url).pathname) && 'example not built' }, () => {
  const f = new URL('../../examples/minigolf/public/models/hole1.glb', import.meta.url).pathname;
  const r = run(process.execPath, [join(SKILLS, 'blender-assets/scripts/inspect_glb.mjs'), f, '--max-tris', '10']);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /PROBLEM: triangles/);
});
