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


def _merge(style, over):
    for k, v in over.items():
        if isinstance(v, dict) and isinstance(style.get(k), dict):
            style[k].update(v)
        else:
            style[k] = v


def load_style(path=None, theme=None):
    """Load design/style.json (searched upward from cwd if path is None), merged over defaults.

    theme: a key of style.json "themes" (per-level looks); its partial style is merged over the base, the same way
    the runtime's setTheme() does, so a level's palette, background and sun match in Blender and in the game."""
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
        _merge(style, user)
    if theme is not None:
        themes = style.get("themes", {})
        if theme not in themes:
            raise KeyError(f"style.json has no theme {theme!r} (have {sorted(themes)})")
        _merge(style, themes[theme])
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


def instances(name, placements):
    """One small mesh drawn many times (grass blades, fence posts, pebbles), stored once in the GLB.
    `placements` is a list of (mesh, location, rotation_euler, scale): each becomes a child of an empty `name`
    that shares the mesh data. The GLB gets one node per distinct mesh with EXT_mesh_gpu_instancing (a list of
    transforms), and three.js GLTFLoader loads it as an InstancedMesh. Joined copies would store every vertex of
    every copy. Use a few mesh variants instead of a non-uniform scale that would squash rounded parts. Returns the empty."""
    parent = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(parent)
    for i, (mesh, loc, rot, scale) in enumerate(placements):
        o = bpy.data.objects.new(f"{name}_{i}", mesh)
        o.location, o.rotation_euler, o.scale = loc, rot, scale
        o.parent = parent
        bpy.context.scene.collection.objects.link(o)
    _EXPORT_OPTS["export_gpu_instances"] = True
    return parent


_EXPORT_IMAGE_FORMAT = "AUTO"
_EXPORT_OPTS = {}  # extra glTF exporter options set by helpers (lab_rig: skins + one animation per NLA track; instances)
_FORWARD_YAW = {"-Y": 0.0, "+X": -90.0, "+Y": 180.0, "-X": 90.0}


def import_glb(path, name, forward="-Y", height=None, length=None, max_tris=None, max_texture=1024, pbr=False):
    """Import a generated GLB (generate-media `models`, in assets/generated/) as ONE game-ready object:
    joined meshes, front turned to -Y (three.js +Z), uniformly scaled to `height` or `length` (meters, Blender Z
    and Y extents), origin at bottom-center, decimated to `max_tris`, textures shrunk to `max_texture` px and
    re-encoded as JPEG (no alpha), and (pbr=False) metallic/roughness/normal maps dropped for a flat toy look.
    `forward` is the axis the model's front points along as imported ("+X", "-X", "+Y", "-Y"): read it from the
    preview sheet's "front" tile (the camera there sits at -Y). Returns the object; tag colliders yourself."""
    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.abspath(path))
    new = [o for o in bpy.context.scene.objects if o not in before]
    meshes = [o for o in new if o.type == "MESH"]
    if not meshes:
        raise RuntimeError(f"import_glb: no meshes in {path}")
    for o in meshes:  # keep world transforms, drop the importer's empties/armatures
        mw = o.matrix_world.copy()
        o.parent = None
        o.matrix_world = mw
    for o in new:
        if o.type != "MESH":
            bpy.data.objects.remove(o, do_unlink=True)
    obj = join(meshes, name) if len(meshes) > 1 else meshes[0]
    obj.name = name
    select_only(obj)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    if max_tris:  # before measuring: decimation moves the outer vertices
        n = triangle_count([obj])
        if n > max_tris:
            m = obj.modifiers.new("Decimate", "DECIMATE")
            m.ratio = max_tris / n * 0.98
            apply_all_modifiers(obj)
    obj.data.transform(mathutils.Matrix.Rotation(math.radians(_FORWARD_YAW[forward]), 4, "Z"))  # mesh data: the importer's quaternion mode ignores rotation_euler
    vs = [v.co for v in obj.data.vertices]  # not bound_box: it is stale until the depsgraph updates
    lo = mathutils.Vector((min(v.x for v in vs), min(v.y for v in vs), min(v.z for v in vs)))
    hi = mathutils.Vector((max(v.x for v in vs), max(v.y for v in vs), max(v.z for v in vs)))
    size = hi - lo
    s = height / size.z if height else length / size.y if length else 1.0
    obj.data.transform(mathutils.Matrix.Scale(s, 4) @ mathutils.Matrix.Translation(-mathutils.Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z))))
    obj.location = (0, 0, 0)
    for slot in obj.material_slots:
        nt = slot.material and slot.material.node_tree
        if not nt:
            continue
        bsdf = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
        if bsdf and not pbr:
            for sock in ("Metallic", "Roughness", "Normal"):
                for link in list(bsdf.inputs[sock].links):
                    nt.links.remove(link)
            bsdf.inputs["Metallic"].default_value = 0.0
            bsdf.inputs["Roughness"].default_value = 0.8
            for n in [n for n in nt.nodes if n.type in ("TEX_IMAGE", "NORMAL_MAP", "SEPARATE_COLOR") and not any(l.to_node == bsdf and l.to_socket.name == "Base Color" for out in n.outputs for l in out.links)]:
                nt.nodes.remove(n)
        for n in nt.nodes:
            img = n.type == "TEX_IMAGE" and n.image
            if not img:
                continue
            w, h = img.size
            if max(w, h) > max_texture:
                k = max_texture / max(w, h)
                img.scale(max(1, round(w * k)), max(1, round(h * k)))
    global _EXPORT_IMAGE_FORMAT
    _EXPORT_IMAGE_FORMAT = "JPEG"  # generated textures carry no alpha; JPEG is ~5x smaller than PNG
    print(f"[lab_bpy] imported {path} -> {name}: {triangle_count([obj])} tris, {tuple(round(v, 3) for v in obj.dimensions)} m")
    return obj


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


# ---------------------------------------------------------------- z-fighting check

def _clip(poly, a, b):
    """Sutherland-Hodgman: keep the part of convex `poly` left of the directed edge a->b (2D)."""
    out = []
    side = lambda p: (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])
    for i, p in enumerate(poly):
        q = poly[(i + 1) % len(poly)]
        sp, sq = side(p), side(q)
        if sp >= 0:
            out.append(p)
        if (sp >= 0) != (sq >= 0):
            t = sp / (sp - sq)
            out.append((p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t))
    return out


def _tri_overlap(t1, t2):
    """Overlap polygon of two counter-clockwise 2D triangles (empty list if none)."""
    poly = list(t1)
    for i in range(3):
        if not poly:
            break
        poly = _clip(poly, t2[i], t2[(i + 1) % 3])
    return poly


def _area(poly):
    return 0.5 * sum(p[0] * q[1] - q[0] * p[1] for p, q in zip(poly, poly[1:] + poly[:1]))


def _inside(p, tri):
    return all((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) >= -1e-9 for a, b in zip(tri, tri[1:] + tri[:1]))


def find_coplanar_overlaps(objs=None, dist=1e-3, min_area=1e-4):
    """Pairs of faces that lie in the same plane, face the same way and overlap: they z-fight in the game
    (stripes that crawl as the camera moves). A shaft top flush with the plinth top on the bell tower's floor
    flickered for five judge rounds before a player saw it. Overlaps covered by an opposite-facing coplanar face
    (one solid resting on another: their contact faces are hidden) and overlaps of one material (they shade to the
    same pixels) are ignored. Returns [(objA, objB, area, (x,y,z))]."""
    objs = objs or [o for o in bpy.context.scene.objects if o.type == "MESH" and not o.get("collider_only") and not o.get("sensor")]
    dg = bpy.context.evaluated_depsgraph_get()
    buckets = {}  # (rounded normal, plane-distance cell) -> [(obj name, 3D verts, d)]
    for o in objs:
        ev = o.evaluated_get(dg)
        me = ev.to_mesh()
        me.calc_loop_triangles()
        mw = o.matrix_world
        mats = [m.name if m else "" for m in me.materials]
        for lt in me.loop_triangles:
            vs = [mw @ me.vertices[i].co for i in lt.vertices]
            mat = mats[lt.material_index] if lt.material_index < len(mats) else ""
            n = (vs[1] - vs[0]).cross(vs[2] - vs[0])
            if n.length < 1e-9:
                continue
            n.normalize()
            d = n.dot(vs[0])
            key = (round(n.x, 2) + 0.0, round(n.y, 2) + 0.0, round(n.z, 2) + 0.0, math.floor(d / (2 * dist)))
            buckets.setdefault(key, []).append((f"{o.name}[{mat}]", vs, n, d))
        ev.to_mesh_clear()

    def frame(n):
        u = n.orthogonal().normalized()
        return u, n.cross(u)

    def proj(vs, u, v):
        pts = [(p.dot(u), p.dot(v)) for p in vs]
        return pts if _area(pts) > 0 else pts[::-1]

    found = {}
    for (nx, ny, nz, cell), tris in buckets.items():
        near = [t for c in (cell, cell + 1) for t in buckets.get((nx, ny, nz, c), [])]
        if len(near) < 2:
            continue
        u, v = frame(tris[0][2])
        d0 = tris[0][3]
        opp = [proj(vs, u, v) for c in (-cell - 2, -cell - 1, -cell) for _, vs, _, d2 in buckets.get((-nx + 0.0, -ny + 0.0, -nz + 0.0, c), []) if abs(d2 + d0) < dist]
        own = len(tris)
        # sweep along u: only triangles whose u-ranges overlap are compared (big flat floors have thousands)
        items = sorted(((min(p[0] for p in t), max(p[0] for p in t), i, name, t, d, vs) for i, (name, vs, _, d) in enumerate(near) for t in [proj(vs, u, v)]))
        active = []
        for lo, hi, i, na, ta, da, va in items:
            active = [x for x in active if x[1] > lo + 1e-6]
            for _, _, j, nb, tb, db, _ in active:
                if (i >= own and j >= own) or abs(da - db) >= dist or na.split("[")[-1] == nb.split("[")[-1]:
                    continue  # next cell's own pair, or the same material (identical pixels: no visible fight)
                ov = _tri_overlap(ta, tb)
                if len(ov) < 3 or abs(_area(ov)) < min_area:
                    continue
                c2 = (sum(p[0] for p in ov) / len(ov), sum(p[1] for p in ov) / len(ov))
                if any(_inside(c2, t) for t in opp):
                    continue  # hidden contact between two solids
                k = tuple(sorted((na, nb)))
                a, at = found.get(k, (0.0, None))
                found[k] = (a + abs(_area(ov)), at or tuple(round(x, 3) for x in (sum(va, mathutils.Vector()) / 3)))
            active.append((lo, hi, i, na, ta, da, va))
    return [(k[0], k[1], a, at) for k, (a, at) in sorted(found.items(), key=lambda kv: -kv[1][0])]


def check_zfighting(objs=None, fail=True):
    """Print every z-fighting overlap; raise (fails the asset build) unless fail=False."""
    hits = find_coplanar_overlaps(objs)
    for a, b, area, at in hits:
        print(f"[lab_bpy] Z-FIGHT {a} / {b}: {area:.4f} m2 of coplanar same-facing faces near {at}", file=sys.stderr)
    if hits and fail:
        raise RuntimeError(f"[lab_bpy] {len(hits)} z-fighting face overlaps (see above): move one surface by >= 1 cm "
                           "or remove the hidden one; pass check_coplanar=False to finish() only for intended decals")
    return hits

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
        export_image_format=_EXPORT_IMAGE_FORMAT,
        **_EXPORT_OPTS,
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


def render_preview(path, style=None, size=(768, 768), yaw_deg=35, pitch_deg=30, target=None, distance=None, fov_deg=40):
    """Render a 3/4 preview PNG of all visible meshes. Call AFTER export_glb (adds lights/camera).
    A big level or landscape framed whole is a few pixels per prop: pass `target` (x, y, z) and `distance` to frame
    the part the player sees (e.g. the game camera's view), and `size` for its aspect."""
    style = style or load_style()
    objs = [o for o in bpy.context.scene.objects if o.type == "MESH" and not o.get("collider_only")]
    for o in bpy.context.scene.objects:
        if o.get("collider_only"):
            o.hide_render = True
    setup_lighting(style)
    cam = setup_camera(objs, yaw_deg=yaw_deg, pitch_deg=pitch_deg, fov_deg=fov_deg,
                       target=mathutils.Vector(target) if target is not None else None, distance=distance)
    cam.data.clip_end = max(cam.data.clip_end, 2000)
    configure_render(path, size)
    bpy.ops.render.render(write_still=True)
    print(f"[lab_bpy] preview {path}")


def finish(script_file, style=None, preview_kwargs=None, check_coplanar=True):
    """Standard ending for an asset script run from the game project root:
    checks for z-fighting (coplanar overlapping faces; fails the build), exports public/models/<script-stem>.glb
    and renders .lab/previews/<script-stem>.png (skip the preview with `-- --no-preview`)."""
    name = os.path.splitext(os.path.basename(script_file))[0]
    check_zfighting(fail=check_coplanar)
    export_glb(os.path.join("public", "models", f"{name}.glb"))
    if "--no-preview" not in args():
        render_preview(os.path.join(".lab", "previews", f"{name}.png"), style, **(preview_kwargs or {}))
