"""Render a 2x2 contact sheet of a GLB in headless Blender, for reviewing generated 3D models. Each tile looks
FROM one axis (Blender Z-up, as imported): top-left from -Y, top-right from +X, bottom-left from +Y, bottom-right
from -X. The tile that shows the model's front names its forward axis (front visible top-right -> "+X"). Called by generate-media.mjs when Blender is available; usable on its own:

    blender -b --factory-startup --python-exit-code 1 -P preview_glb.py -- <in.glb> <out.png> [tile_px=384]

Prints one JSON line `PREVIEW {...}` with triangle count and bounding-box size (Blender Z-up meters).
"""
import json
import math
import os
import sys

import bpy
import mathutils
import numpy as np

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
src, out = argv[0], argv[1]
tile = int(argv[2]) if len(argv) > 2 else 384

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=os.path.abspath(src))
meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
if not meshes:
    raise SystemExit(f"no meshes in {src}")

pts = [o.matrix_world @ mathutils.Vector(c) for o in meshes for c in o.bound_box]
lo = mathutils.Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
hi = mathutils.Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
center, radius = (lo + hi) / 2, max((hi - lo).length / 2, 1e-3)
dg = bpy.context.evaluated_depsgraph_get()
tris = 0
for o in meshes:
    me = o.evaluated_get(dg).to_mesh()
    me.calc_loop_triangles()
    tris += len(me.loop_triangles)
    o.evaluated_get(dg).to_mesh_clear()

scene = bpy.context.scene
world = bpy.data.worlds.new("World")
scene.world = world
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.82, 0.84, 0.88, 1)
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.9
sun = bpy.data.objects.new("Sun", bpy.data.lights.new("Sun", "SUN"))
sun.data.energy = 3.0
sun.rotation_euler = (math.radians(40), 0, math.radians(30))
scene.collection.objects.link(sun)
cam = bpy.data.objects.new("Cam", bpy.data.cameras.new("Cam"))
cam.data.angle = math.radians(35)
scene.collection.objects.link(cam)
scene.camera = cam
scene.render.engine = "BLENDER_EEVEE"
scene.eevee.taa_render_samples = 16
scene.render.resolution_x = scene.render.resolution_y = tile
scene.render.film_transparent = False
scene.view_settings.view_transform = "Standard"  # show the texture colours as authored

# camera positions: yaw 0 = at -Y (three.js +Z, the lab's "front"), 90 = at +X, 180 = at +Y, 270 = at -X
views = [("from -Y", 0, 20), ("from +X", 90, 20), ("from +Y", 180, 20), ("from -X", 270, 20)]
d = radius * 1.15 / math.sin(cam.data.angle / 2)
tiles = []
tmp = os.path.abspath(out) + ".tile.png"
for name, yaw, pitch in views:
    y, p = math.radians(yaw), math.radians(pitch)
    cam.location = center + mathutils.Vector((math.sin(y) * math.cos(p), -math.cos(y) * math.cos(p), math.sin(p))) * d
    cam.rotation_euler = (center - cam.location).to_track_quat("-Z", "Y").to_euler()
    scene.render.filepath = tmp
    bpy.ops.render.render(write_still=True)
    img = bpy.data.images.load(tmp, check_existing=False)
    px = np.empty(tile * tile * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    tiles.append(px.reshape(tile, tile, 4))
    bpy.data.images.remove(img)
os.remove(tmp)

# 2x2 sheet; Blender pixel rows start at the bottom, so the top row of the sheet is the later block
top = np.concatenate(tiles[:2], axis=1)
bottom = np.concatenate(tiles[2:], axis=1)
sheet = np.concatenate([bottom, top], axis=0)
img = bpy.data.images.new("sheet", tile * 2, tile * 2, alpha=True)
img.pixels.foreach_set(sheet.ravel())
img.filepath_raw = os.path.abspath(out)
img.file_format = "PNG"
os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
img.save()
size = hi - lo
print("PREVIEW " + json.dumps({"tris": tris, "size": [round(size.x, 3), round(size.y, 3), round(size.z, 3)]}))
