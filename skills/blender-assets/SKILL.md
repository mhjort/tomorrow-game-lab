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
- `run_blender.sh <script.py> [args]`: runs a single script headless (`blender -b --factory-startup --python-exit-code 1`).
- `inspect_glb.mjs <glb...>`: triangle count, size, materials and colliders, checked against budgets. No dependencies.

The web-game-runtime template already includes `npm run assets` (its build-assets script):
- It builds every `assets/src/*.py` except files starting with `_` or `lab_`, which are treated as helpers.
- Pass asset names to build only those: `npm run assets -- hole1 ball`.
- Add `-- --no-preview` to skip the preview renders.

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

For custom shapes, build them with `bmesh` or `mesh.from_pydata`, as `_course.py` does in the minigolf example.

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
- **Budgets:** props ≤ 2k tris, characters ≤ 10k, level chunks ≤ 20k, GLB ≤ 2 MB. Flat-shaded low-poly is fine; avoid subdivision that adds nothing visible. Check with `node <skill>/scripts/inspect_glb.mjs public/models/*.glb`.
- **One asset per script.** Shared building code goes in `assets/src/_<name>.py`, which the build skips.

## Review loop (always)
1. `npm run assets -- <name>`
2. **Look at `.lab/previews/<name>.png`** and compare it with the key art and the art bible. Fix the silhouette, proportions and colours before writing any game code that uses the asset.
3. Run `inspect_glb.mjs` and confirm the colliders list contains every gameplay surface.

## Gotchas
- `--factory-startup` gives an empty, predictable scene. Don't depend on user preferences or add-ons.
- The Blender 4.2+ render engine is `BLENDER_EEVEE_NEXT`. `configure_render` falls back to `BLENDER_EEVEE` automatically.
- Booleans: use the EXACT solver (the `boolean_cut` default), and cut a single mesh before joining it with others.
- glTF splits vertices along hard edges. The runtime welds them again before building trimesh colliders, so flat shading is safe.
- To render key art or marketing stills, write a separate script that calls `L.setup_camera`, `L.setup_lighting` and `L.configure_render` without exporting.
