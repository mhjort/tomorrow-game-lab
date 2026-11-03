"""Render the ORIGINAL minigolf key-art fixtures used by the lab tests and evals.

Outputs (next to this file):
  minigolf.png  — 1280x720 hero still
  minigolf.mp4  — ~4s orbit (rendered PNG frames -> ffmpeg)

Run: npm run keyart   (or skills/blender-assets/scripts/run_blender.sh lab/fixtures/keyart/build_keyart.py)
Pass `-- --quick` for a fast low-res render.
"""
import math
import os
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "..", "skills", "blender-assets", "scripts"))
import bpy  # noqa: E402
import mathutils  # noqa: E402
import lab_bpy as L  # noqa: E402

quick = "--quick" in L.args()
style = {
    **L.DEFAULT_STYLE,
    "sun": {"color": "#ffe2b8", "intensity": 4.0, "elevation": 32, "azimuth": 60},
    "ambient": {"color": "#a7c8ff", "intensity": 0.8},
}

L.reset_scene()
turf = L.material("Turf", L.color("#47b36b"), roughness=0.9)
rail = L.material("Rail", L.color("#f4ead5"), roughness=0.5)
trim = L.material("Trim", L.color("#e4572e"), roughness=0.4)
ball_m = L.material("Ball", L.color("#ffffff"), roughness=0.25)
cup_m = L.material("Cup", L.color("#1d1f2b"), roughness=0.6)
rock = L.material("Rock", L.color("#8c7b6b"), roughness=0.95)
water = L.material("Water", L.color("#3aa7d8"), roughness=0.08)

# An L-shaped course on a floating island, a ramp and a windmill-free original prop: a stack of rocks.
W, H = 1.2, 0.12  # lane width, rail height
L.box("Lane_A", (1.2, 5.0, 0.1), (0, 0, 0), turf)
L.box("Lane_B", (4.0, 1.2, 0.1), (1.4, 3.1, 0), turf)
L.bevel(L.box("RailLeft", (0.1, 6.3, H), (-0.65, 0.6, 0.08), rail), 0.02)
L.bevel(L.box("RailRight", (0.1, 5.1, H), (0.65, 0.0, 0.08), rail), 0.02)
L.bevel(L.box("RailTop", (4.2, 0.1, H), (1.4, 3.75, 0.08), rail), 0.02)
L.bevel(L.box("RailIn", (2.8, 0.1, H), (2.0, 2.5, 0.08), rail), 0.02)
L.bevel(L.box("RailEnd", (0.1, 1.4, H), (3.45, 3.1, 0.08), rail), 0.02)
L.bevel(L.box("RailStart", (1.4, 0.1, H), (0, -2.55, 0.08), rail), 0.02)
for i in range(6):
    L.box(f"TrimA{i}", (0.14, 0.14, 0.04), (-0.65, -2.4 + i * 0.95, 0.16), trim)
cup = L.cylinder("Cup", 0.07, 0.02, (2.9, 3.1, 0.046), mat=cup_m)
L.cylinder("Pole", 0.01, 0.8, (2.9, 3.1, 0.45), 8, rail)
flag = L.box("Flag", (0.3, 0.01, 0.18), (3.05, 3.1, 0.75), trim)
L.sphere("Ball", 0.045, (0, -2.0, 0.095), mat=ball_m)
# island + rocks + water
bpy.ops.mesh.primitive_cylinder_add(radius=4.5, depth=1.2, vertices=12, location=(1.0, 0.8, -0.65))
isl = bpy.context.active_object
L.assign(isl, rock)
isl.scale = (1, 1, 1)
bpy.ops.mesh.primitive_cone_add(radius1=4.5, radius2=0.5, depth=2.5, vertices=12, location=(1.0, 0.8, -2.5))
L.assign(bpy.context.active_object, rock)
bpy.context.active_object.rotation_euler = (math.pi, 0, 0)
L.box("TopGrass", (8.6, 8.6, 0.05), (1.0, 0.8, -0.06), L.material("Grass", L.color("#2f8a4f"), roughness=1.0))
for i, (x, y, s) in enumerate([(-2.0, 2.5, 0.5), (-1.6, 2.9, 0.35), (-1.9, 3.3, 0.25), (4.0, -1.0, 0.45)]):
    L.sphere(f"Rock{i}", s, (x, y, s * 0.6), 1, rock)
L.cylinder("Pond", 0.9, 0.02, (2.5, -0.8, -0.02), 24, water)
for i, (x, y) in enumerate([(-2.6, -1.5), (4.3, 4.5), (-2.4, 4.6), (4.6, 1.2)]):
    L.cylinder(f"Trunk{i}", 0.08, 0.6, (x, y, 0.3), 8, L.material("Wood", L.color("#7a4f2b")))
    bpy.ops.mesh.primitive_cone_add(radius1=0.5, depth=1.2, vertices=8, location=(x, y, 1.1))
    L.assign(bpy.context.active_object, L.material("Leaf", L.color("#2e7d4a"), roughness=0.9))

scene = bpy.context.scene
scene.world = bpy.data.worlds.new("World")
scene.world.use_nodes = True
sky = scene.world.node_tree.nodes["Background"]
sky.inputs["Color"].default_value = L.color("#ffcf9e")
sky.inputs["Strength"].default_value = 0.9
L.setup_lighting(style)
scene.world.node_tree.nodes["Background"].inputs["Color"].default_value = L.color("#ffc89a")

cam = L.setup_camera([o for o in scene.objects if o.name.startswith("Lane")], yaw_deg=-25, pitch_deg=42, fov_deg=45, margin=1.35)
target = mathutils.Vector((1.2, 1.2, 0))
size = (640, 360) if quick else (1280, 720)

L.configure_render(os.path.join(HERE, "minigolf.png"), size, samples=8 if quick else 48)
bpy.ops.render.render(write_still=True)

# orbit video
frames_dir = os.path.join(HERE, "_frames")
shutil.rmtree(frames_dir, ignore_errors=True)
n = 24 if quick else 96
dist = (cam.location - target).length
for f in range(n):
    a = math.radians(-25 + 70 * f / (n - 1))
    pitch = math.radians(38 - 10 * f / (n - 1))
    cam.location = target + mathutils.Vector((math.sin(a) * math.cos(pitch), -math.cos(a) * math.cos(pitch), math.sin(pitch))) * dist
    cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()
    scene.render.filepath = os.path.join(frames_dir, f"f{f:04d}.png")
    bpy.ops.render.render(write_still=True)
subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-framerate", "24", "-i", os.path.join(frames_dir, "f%04d.png"),
                "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "26", os.path.join(HERE, "minigolf.mp4")], check=True)
shutil.rmtree(frames_dir)
print("[keyart] wrote minigolf.png + minigolf.mp4")
