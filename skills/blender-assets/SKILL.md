---
name: blender-assets
description: Create game-ready 3D assets by writing Python scripts that run in headless Blender, exporting GLB for three.js with physics collider tags for Rapier and preview renders for review. Use when a web game needs 3D models, levels, props or characters built procedurally (no hand modelling), or when generating key-art/preview renders with Blender.
---

# blender-assets

Every asset is a **Python script** (`assets/src/<name>.py`) that rebuilds it from scratch. Running a script produces two files:
- `public/models/<name>.glb`
- `.lab/previews/<name>.png`, a preview render that you and the asset judge review

Files in this skill's `scripts/`:
- `lab_bpy.py`: helper module. Copy it into `assets/src/` and don't edit the copy, so it can be refreshed later.
- `lab_rig.py`: auto-rigging and procedural animation for characters (needs `lab_bpy`). Copy it next to `lab_bpy.py` when a game has characters.
- `run_blender.sh <script.py> [args]`: runs a single script headless (`blender -b --factory-startup --python-exit-code 1`).
- `inspect_glb.ts <glb...>`: triangle count, size, materials and colliders. Budgets are opt-in flags (`--max-tris`, `--max-kb`) for the `optimize-web-game` pass. No dependencies.

The web-game-runtime template already includes `pnpm assets` (its build-assets script):
- It builds every `assets/src/*.py` except files starting with `_` or `lab_`, which are treated as helpers.
- Pass asset names to build only those: `pnpm assets hole1 ball`.
- Add `--no-preview` to skip the preview renders.

## Asset script skeleton
```python
"""<what it is, size, gameplay role>"""
import os, sys; sys.path.insert(0, os.path.dirname(__file__))
import lab_bpy as L

L.reset_scene()
style = L.load_style()                       # design/style.json (searched upward from cwd)
turf = L.material("Turf", L.color("turf", style), roughness=0.9)
floor = L.box("Floor", (4, 4, 0.1), (0, 0, -0.05), turf)
L.tag_collider(floor, "trimesh", friction=0.8, restitution=0.1)
L.finish(__file__, style)                    # exports GLB + renders preview
```
Helpers in `lab_bpy`:
- Primitives: `box`, `cylinder`, `sphere`
- Mesh operations: `bevel`, `boolean_cut`, `cut_hole` (cup/pit/goal: cut + wall + floor + sensor), `join`, `apply_all_modifiers`, `apply_transform`
- Styling and tagging: `material`, `color`, `tag_collider`
- Output: `export_glb`, `render_preview`, `setup_camera`, `setup_lighting`
- Diagnostics: `triangle_count`, and `args()` for the script arguments after `--`
- Generated models: `import_glb` (below)

For custom shapes, build them with `bmesh` or `mesh.from_pydata`, as `_course.py` does in the minigolf example.

## Generated models (`import_glb`)
Characters, vehicles and organic props come from `generate-media` as raw GLBs in `./assets/generated/` (image → 3D). Each one still gets a script here, so it follows the same conventions and review loop:
```python
L.reset_scene()
plough = L.import_glb("assets/generated/plough.glb", "Plough", forward="+X", length=3.2, max_tris=4000, max_texture=1024)
L.tag_collider(plough, "hull", friction=0.6)
L.finish(__file__, L.load_style())
```
`import_glb` joins the meshes and turns the front to −Y (three.js +Z). It scales uniformly to `height` (Z) or `length` (Y) in meters, puts the origin at bottom-centre and decimates to `max_tris`. It shrinks textures to `max_texture` px and exports them as JPEG, and by default (`pbr=False`) it drops metallic, roughness and normal maps for a flat toy look. `forward` is the axis the raw model faces: read it from generate-media's preview sheet. The model keeps its own texture colours, so `style.json` doesn't restyle it: generate its reference image from the key art instead.

## Rigging and animation (`lab_rig`)
Rigging happens here, in Blender, for any biped: generated or scripted. The character must stand in a **T- or A-pose** (arms away from the body), so ask for one in its reference image.
```python
import lab_bpy as L, lab_rig as R
body = L.import_glb("assets/generated/villager.glb", "Villager", forward="+X", height=1.1, max_tris=6000)
rig = R.rig_biped(body)                     # landmarks measured from the mesh, printed as "[lab_rig] landmarks {...}"
R.add_biped_clips(rig)                      # idle 2 s, walk 1 s, run 0.6 s (loops), jump 0.8 s (once); in place
R.render_pose_sheet(rig, ".lab/previews/villager-poses.png")
L.finish(__file__)                          # GLB with a 16-joint skin and one glTF animation per clip
```
- `rig_biped` measures the hips, knees, ankles, toes, shoulders, elbows, wrists, hands and neck from the mesh. It builds the armature (`root`, `hips`, `chest`, `head`, `upper_arm/forearm/hand.L/R`, `thigh/shin/foot.L/R`; `.L` = the character's left = +X) and skins each vertex to its nearest bones. Bones never pull across the centre line, and it works on the non-manifold meshes that image-to-3D produces. Everything above the neck and inside the head's width is bound rigidly to `head`: on a big boxy head, the lower corners are nearer the shoulders than the head bone, and lifting the arms dragged the face into a V. The torso width comes from the gaps between face spans, so A-pose hands hanging beside the hem don't count as torso.
- **Look at the pose sheet**: one row per clip (idle, walk, run, jump), 4 frames each. Knees and elbows must bend at the joints, and nothing may tear or stretch across the body. If a joint is off, fix that landmark: `R.rig_biped(body, landmarks={"hip.L": (0.08, 0, 0.3), "hip.R": (-0.08, 0, 0.3)})`.
- `add_biped_clips(rig, clips=(...), stride_deg=28)` keys every bone in every clip, so clips never inherit each other's pose. The game moves the character; clips only bob in place.
- In the game: `createAnimator(model)` from the runtime's `animation.ts`, `play('walk')` from `update(dt)`, and `update(dt)` in the fixed step (see `web-game-runtime`).

## Conventions (the runtime depends on these)
- **Units:** meters. Blender is +Z up; the glTF export is +Y up, so Blender `(x, y, z)` becomes three.js `(x, z, -y)`. Put the origin where the game will place the object (usually bottom-center).
- **Physics tags** are custom properties. They export as glTF extras and arrive in three.js as `userData`:
  - `collider`: `trimesh` (static level geometry), `hull` (convex props), `cuboid`, or `ball`.
  - `friction` and `restitution`.
  - `sensor = 1` marks a trigger. Sensors are hidden at runtime.
  - `collider_only = 1` marks an invisible collision proxy.
  - Names ending in `_col` or `_hull` also work.
  - Dynamic bodies (player, ball) are created in code. Their GLB is visual only.
- **Holes and hazards are real geometry.** Make cups, pits and goals with `cut_hole`; never fake them with a dark decal, because physics needs something to drop into. Water, lava and out-of-bounds zones are **sensors** (`sensor=True`), not solid colliders, so the game can detect them.
- **Markers:** add named empties such as `Spawn`, `Tee`, `Goal` or `Checkpoint1` instead of hard-coding positions in game code.
- **Determinism:** seed all randomness with `random.Random(seed)`. Running the same script twice must produce the same file.
- **Style:** never hard-code colours. Use `L.color("<palette role>", style)`, so changing `style.json` restyles everything.
- **Fidelity first, no fixed budgets:** while building to a reference, model what the reference shows (rounded snow, real silhouettes) and don't trim it to fit a triangle count. Avoid only waste: subdivision or hidden faces that add nothing visible. `node <skill>/scripts/inspect_glb.ts public/models/*.glb` reports counts and sizes; budgets are opt-in flags (`--max-tris`, `--max-kb`) used by the `optimize-web-game` pass, which asks the user before any compromise that changes the look. In the snowplough proof a 20k-per-file cap held the roofs to flat chamfered slabs through six judge rounds.
- **One asset per script.** Shared building code goes in `assets/src/_<name>.py`, which the build skips.

## Review loop (always)
1. `pnpm assets <name>`
2. **Look at `.lab/previews/<name>.png`** and compare it with the key art and the art bible. Fix the silhouette, proportions and colours before writing any game code that uses the asset.
3. Run `inspect_glb.ts` and confirm the colliders list contains every gameplay surface.

## Gotchas
- glTF imports use quaternion rotation, so setting `rotation_euler` on an imported object does nothing. And `bound_box` stays stale after `obj.data.transform()` until the depsgraph updates. `import_glb` works on mesh data and vertex bounds for these reasons.
- Auto-rig landmarks are read from height bands made of the **faces** that overlap each band, not the vertices inside it. On a coarse mesh a band can fall between vertex rings and see only a nose, which put a test figure's neck mid-head. The leg-gap test uses 1% of the height: toy characters' legs nearly touch, and at 2.5% the crotch landed at the ankles.
- Decimate **before** setting the origin: decimation moves outer vertices, and a model grounded first ended up 2 cm under the floor.
- `--factory-startup` gives an empty, predictable scene. Don't depend on user preferences or add-ons.
- Target the latest Blender LTS (5.2). The EEVEE engine id is `BLENDER_EEVEE` (Blender 4.x called it `BLENDER_EEVEE_NEXT`). New materials and worlds already have node trees, so do not set `use_nodes`: it is deprecated and will be removed in 6.0.
- Preview backdrop: `setup_lighting` lights the scene with `style.ambient` but shows the camera `style.background` (a Light Path "Is Camera Ray" mix in the world). Blender 5.2's EEVEE honours this; 4.x silently showed the ambient colour. So set `background` in `style.json` explicitly.
- Booleans: use the EXACT solver (the `boolean_cut` default), and cut a single mesh before joining it with others.
- glTF splits vertices along hard edges. The runtime welds them again before building trimesh colliders, so flat shading is safe.
- To render key art or marketing stills, write a separate script that calls `L.setup_camera`, `L.setup_lighting` and `L.configure_render` without exporting.
- `L.apply_transform` keeps each object's own origin (location is not applied). To rotate a group of parts about a shared point (a house turned to face its street), multiply each part's `matrix_world` by the group transform; setting `rotation_euler` turns every part about its own centre.
- `L.join` keeps the first object's origin. Set it explicitly afterwards (`origin_set(type="ORIGIN_CURSOR")`) so pivots mean something.
- `mat.use_backface_culling = True` exports single-sided materials (half the fragment cost on closed meshes), but hand-built `from_pydata` faces then need outward winding: run `bmesh.ops.recalc_face_normals` and check the preview. Inverted roofs rendered black in-game.
- Thick snow on a roof: build a solid bevelled slab per roof side (box, `T` about 0.3 m, a 1-segment bevel, overhanging the eaves) plus a rounded tube along the ridge. A bevelled shell over the roof has no visible edge thickness, so judges read it as "flat thin slabs". A 2-segment bevel is rounder, but costs about 120 tris per house.
