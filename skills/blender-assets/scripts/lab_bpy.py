"""lab_bpy — tiny helper module for headless Blender asset scripts (Blender 5.2 LTS+).

Copy this file next to your asset scripts (e.g. assets/src/lab_bpy.py) and:

    import sys, os; sys.path.insert(0, os.path.dirname(__file__))
    import lab_bpy as L

Conventions (the web-game-runtime reads these):
  * Units are meters, +Z up in Blender (exported as +Y up glTF).
  * Physics tags are custom properties exported as glTF extras -> three.js userData:
      collider  = "trimesh" | "hull" | "cuboid" | "ball"
      friction, restitution  (floats)
      sensor    = 1 for trigger volumes (e.g. a goal / cup)
      collider_only = 1 to hide the mesh at runtime (invisible collision proxy)
    Name suffixes `_col` (trimesh) and `_hull` (convex hull) work as a fallback.
"""
import json
import math
import os
import sys

import bpy
import mathutils

MIN_BLENDER = (5, 2)
if bpy.app.version[:2] < MIN_BLENDER:
    print(f"[lab_bpy] WARNING: Blender {bpy.app.version_string} is older than the supported "
          f"{MIN_BLENDER[0]}.{MIN_BLENDER[1]} LTS; install the latest LTS (brew upgrade --cask blender)", file=sys.stderr)

# ---------------------------------------------------------------- args / style

def args():
    """Arguments passed after `--` on the blender command line."""
    argv = sys.argv
    return argv[argv.index("--") + 1:] if "--" in argv else []


DEFAULT_STYLE = {
    "palette": {"primary": "#3a9d5d", "secondary": "#f2e8cf", "accent": "#e4572e", "dark": "#2b2d42", "sky": "#9ad1f5"},
    "background": "#9ad1f5",
    "sun": {"color": "#fff4e0", "intensity": 3.0, "elevation": 50, "azimuth": 35},
    "ambient": {"color": "#bcd7ff", "intensity": 0.6},
    "materials": {"roughness": 0.7, "metalness": 0.0},
}


def load_style(path=None):
    """Load design/style.json (searched upward from cwd if path is None), merged over defaults."""
    style = json.loads(json.dumps(DEFAULT_STYLE))
    if path is None:
        d = os.getcwd()
        while True:
            cand = os.path.join(d, "design", "style.json")
            if os.path.exists(cand):
                path = cand
                break
            parent = os.path.dirname(d)
            if parent == d:
                break
            d = parent
    if path and os.path.exists(path):
        with open(path) as f:
            user = json.load(f)
        for k, v in user.items():
            if isinstance(v, dict) and isinstance(style.get(k), dict):
                style[k].update(v)
            else:
                style[k] = v
    return style


def color(hex_or_name, style=None):
    """'#rrggbb' or a palette key -> linear RGBA tuple."""
    if style and not str(hex_or_name).startswith("#"):
        hex_or_name = style["palette"][hex_or_name]
    h = hex_or_name.lstrip("#")
    srgb = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    lin = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in srgb]
    return (*lin, 1.0)

# ---------------------------------------------------------------- scene

def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    return scene


def material(name, rgba, roughness=0.7, metallic=0.0, emission=None, emission_strength=1.0):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = rgba
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    if emission:
        bsdf.inputs["Emission Color"].default_value = emission
        bsdf.inputs["Emission Strength"].default_value = emission_strength
    mat.diffuse_color = rgba
    return mat


def assign(obj, mat):
    obj.data.materials.clear()
    obj.data.materials.append(mat)
    return obj


def box(name, size, location=(0, 0, 0), mat=None):
    """Axis-aligned box. size=(x,y,z) full extents in meters."""
    bpy.ops.mesh.primitive_cube_add(size=1, location=location)
    o = bpy.context.active_object
    o.name = name
    o.scale = size
    apply_transform(o)
    if mat:
        assign(o, mat)
    return o


def cylinder(name, radius, depth, location=(0, 0, 0), vertices=32, mat=None):
    bpy.ops.mesh.primitive_cylinder_add(radius=radius, depth=depth, vertices=vertices, location=location)
    o = bpy.context.active_object
    o.name = name
    if mat:
        assign(o, mat)
    return o


def sphere(name, radius, location=(0, 0, 0), subdivisions=3, mat=None, smooth=None):
    """Ico sphere; smooth-shaded unless subdivisions <= 1 (low-poly rocks) or smooth=False."""
    bpy.ops.mesh.primitive_ico_sphere_add(radius=radius, subdivisions=subdivisions, location=location)
    o = bpy.context.active_object
    o.name = name
    if smooth if smooth is not None else subdivisions > 1:
        bpy.ops.object.shade_smooth()
    if mat:
        assign(o, mat)
    return o


def apply_transform(obj):
    select_only(obj)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)


def select_only(obj):
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def bevel(obj, width=0.01, segments=2):
    m = obj.modifiers.new("Bevel", "BEVEL")
    m.width = width
    m.segments = segments
    m.limit_method = "ANGLE"
    return obj


def boolean_cut(obj, cutter, apply=True):
    m = obj.modifiers.new("Cut", "BOOLEAN")
    m.operation = "DIFFERENCE"
    m.object = cutter
    m.solver = "EXACT"
    if apply:
        select_only(obj)
        bpy.ops.object.modifier_apply(modifier=m.name)
        bpy.data.objects.remove(cutter, do_unlink=True)
    return obj


def cut_hole(surface, x, y, z, radius, depth, mat=None, name="Hole", sensor=True, vertices=32,
             friction=0.6, restitution=0.1):
    """Real hole in a walkable/rollable surface (golf cup, pit, goal, drain): boolean-cuts `surface`,
    adds an open wall + floor tagged as trimesh colliders, and (optionally) a hidden trigger sensor at the
    bottom named <name>Sensor. z = surface top height at (x, y). Never fake holes with a dark decal:
    physics needs geometry to drop into, and judges notice.
    Returns dict(wall=, floor=, sensor=)."""
    cutter = cylinder(f"{name}Cutter", radius, depth * 4 + 1.0, (x, y, z), vertices)
    boolean_cut(surface, cutter)
    bpy.ops.mesh.primitive_cylinder_add(radius=radius, depth=depth, vertices=vertices, end_fill_type="NOTHING",
                                        location=(x, y, z - depth / 2))
    wall = bpy.context.active_object
    wall.name = f"{name}Wall"
    floor = cylinder(f"{name}Floor", radius + 0.01, 0.02, (x, y, z - depth - 0.01), vertices)
    for o in (wall, floor):
        if mat:
            assign(o, mat)
        tag_collider(o, "trimesh", friction=friction, restitution=restitution)
    out = {"wall": wall, "floor": floor, "sensor": None}
    if sensor:
        s = box(f"{name}Sensor", (radius * 1.4, radius * 1.4, min(0.06, depth / 2)), (x, y, z - depth + min(0.03, depth / 4)))
        tag_collider(s, "cuboid", sensor=True, collider_only=True)
        out["sensor"] = s
    return out


def apply_all_modifiers(obj):
    select_only(obj)
    for m in list(obj.modifiers):
        bpy.ops.object.modifier_apply(modifier=m.name)


def join(objs, name):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    o = bpy.context.active_object
    o.name = name
    return o


def tag_collider(obj, kind="trimesh", friction=0.6, restitution=0.2, sensor=False, collider_only=False):
    """Mark an object for the runtime's collidersFromGltf()."""
    obj["collider"] = kind
    obj["friction"] = float(friction)
    obj["restitution"] = float(restitution)
    if sensor:
        obj["sensor"] = 1
    if collider_only:
        obj["collider_only"] = 1
    return obj


def triangle_count(objs=None):
    objs = objs or [o for o in bpy.context.scene.objects if o.type == "MESH"]
    dg = bpy.context.evaluated_depsgraph_get()
    n = 0
    for o in objs:
        me = o.evaluated_get(dg).to_mesh()
        me.calc_loop_triangles()
        n += len(me.loop_triangles)
        o.evaluated_get(dg).to_mesh_clear()
    return n

# ---------------------------------------------------------------- export / preview

def export_glb(path):
    for o in bpy.context.scene.objects:  # mesh data names = object names (no 'Cylinder.002' in the GLB)
        if o.type == "MESH" and o.data.users == 1:
            o.data.name = o.name
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=os.path.abspath(path),
        export_format="GLB",
        export_yup=True,
        export_apply=True,
        export_extras=True,
        export_cameras=False,
        export_lights=False,
    )
    print(f"[lab_bpy] exported {path} ({triangle_count()} tris)")


def _scene_bounds(objs):
    pts = [o.matrix_world @ mathutils.Vector(c) for o in objs for c in o.bound_box]
    lo = mathutils.Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = mathutils.Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return lo, hi


def setup_lighting(style):
    scene = bpy.context.scene
    world = scene.world or bpy.data.worlds.new("World")
    scene.world = world
    nt = world.node_tree
    bg = nt.nodes["Background"]  # lighting: ambient colour/intensity
    bg.inputs["Color"].default_value = color(style["ambient"]["color"])
    bg.inputs["Strength"].default_value = style["ambient"]["intensity"]
    # camera rays see style["background"] (like the game's clear colour) without changing the lighting
    seen = nt.nodes.new("ShaderNodeBackground")
    seen.inputs["Color"].default_value = color(style.get("background", style["ambient"]["color"]))
    seen.inputs["Strength"].default_value = 1.0
    path = nt.nodes.new("ShaderNodeLightPath")
    mix = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(path.outputs["Is Camera Ray"], mix.inputs["Fac"])
    nt.links.new(bg.outputs["Background"], mix.inputs[1])
    nt.links.new(seen.outputs["Background"], mix.inputs[2])
    nt.links.new(mix.outputs["Shader"], nt.nodes["World Output"].inputs["Surface"])
    sun_cfg = style["sun"]
    sun = bpy.data.lights.new("Sun", "SUN")
    sun.energy = sun_cfg["intensity"]
    sun.color = color(sun_cfg["color"])[:3]
    sun.angle = math.radians(3)
    so = bpy.data.objects.new("Sun", sun)
    scene.collection.objects.link(so)
    el, az = math.radians(sun_cfg["elevation"]), math.radians(sun_cfg["azimuth"])
    so.rotation_euler = (math.pi / 2 - el, 0, az)
    return so


def setup_camera(objs, yaw_deg=35, pitch_deg=30, fov_deg=40, margin=1.15, target=None, distance=None):
    lo, hi = _scene_bounds(objs)
    center = target if target is not None else (lo + hi) / 2
    radius = max((hi - lo).length / 2, 0.05)
    cam_data = bpy.data.cameras.new("Cam")
    cam_data.angle = math.radians(fov_deg)
    cam = bpy.data.objects.new("Cam", cam_data)
    bpy.context.scene.collection.objects.link(cam)
    d = distance or radius * margin / math.sin(math.radians(fov_deg) / 2)
    yaw, pitch = math.radians(yaw_deg), math.radians(pitch_deg)
    off = mathutils.Vector((math.sin(yaw) * math.cos(pitch), -math.cos(yaw) * math.cos(pitch), math.sin(pitch))) * d
    cam.location = mathutils.Vector(center) + off
    cam.rotation_euler = (mathutils.Vector(center) - cam.location).to_track_quat("-Z", "Y").to_euler()
    cam_data.clip_end = d * 10
    bpy.context.scene.camera = cam
    return cam


def configure_render(path, size=(768, 768), engine="BLENDER_EEVEE", samples=32):
    scene = bpy.context.scene
    scene.render.engine = engine
    if scene.render.engine.startswith("BLENDER_EEVEE"):
        scene.eevee.taa_render_samples = samples
    else:
        scene.cycles.samples = samples
    scene.render.resolution_x, scene.render.resolution_y = size
    scene.render.resolution_percentage = 100
    scene.render.filepath = os.path.abspath(path)
    scene.view_settings.view_transform = "AgX" if "AgX" in [i.identifier for i in scene.view_settings.bl_rna.properties["view_transform"].enum_items] else "Filmic"
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)


def render_preview(path, style=None, size=(768, 768), yaw_deg=35, pitch_deg=30):
    """Render a 3/4 preview PNG of all visible meshes. Call AFTER export_glb (adds lights/camera)."""
    style = style or load_style()
    objs = [o for o in bpy.context.scene.objects if o.type == "MESH" and not o.get("collider_only")]
    for o in bpy.context.scene.objects:
        if o.get("collider_only"):
            o.hide_render = True
    setup_lighting(style)
    setup_camera(objs, yaw_deg=yaw_deg, pitch_deg=pitch_deg)
    configure_render(path, size)
    bpy.ops.render.render(write_still=True)
    print(f"[lab_bpy] preview {path}")


def finish(script_file, style=None, preview_kwargs=None):
    """Standard ending for an asset script run from the game project root:
    exports public/models/<script-stem>.glb and renders .lab/previews/<script-stem>.png
    (skip the preview with `-- --no-preview`)."""
    name = os.path.splitext(os.path.basename(script_file))[0]
    export_glb(os.path.join("public", "models", f"{name}.glb"))
    if "--no-preview" not in args():
        render_preview(os.path.join(".lab", "previews", f"{name}.png"), style, **(preview_kwargs or {}))
