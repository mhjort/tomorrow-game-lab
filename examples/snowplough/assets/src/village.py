"""The village (static level): houses, lamp posts, pines, fences and the festival square, from src/village.json.
Collision is not in the GLB: the game treats every non-road tile of village.json as solid (src/world.js), and
fences, lamp posts and walls are built to sit at or inside those tile edges.

The snow itself is not here: the game builds it as a heightfield (src/snow.js) so the plough can clear it.
Named meshes the game uses:
  Lamp_<i>    the lamp head next to house i's door (unlit until the house is reached; i in reading order)
  Fire        the flames and embers of the square's fire pit (pivot at its foot: the festival scales it up)
Everything else is joined into a few multi-material meshes (draw calls = materials).
Coordinates: map col -> three +x, row -> three +z; Blender (x, y, z) = three (x, -z, y).
"""
import json, math, os, random, sys
sys.path.insert(0, os.path.dirname(__file__))  # noqa: E401
import bmesh
import bpy
import mathutils
import lab_bpy as L

L.reset_scene()
style = L.load_style()
village = json.load(open("src/village.json"))
T = village["tile"]
rows = village["rows"]
H, W = len(rows), len(rows[0])
rng = random.Random(7)  # houses and yard pines
forest_rng = random.Random(11)  # the forest outside the map: editing village.json doesn't reshuffle it


def tile_center(r, c):
    """Tile centre in Blender coordinates."""
    return ((c + 0.5) * T - W * T / 2, -((r + 0.5) * T - H * T / 2))


m = lambda key, **kw: L.material(key, L.color(key, style), roughness=style["materials"]["roughness"], **kw)  # noqa: E731
MAT = {k: m(k) for k in ("wood", "roofDark", "door", "pine", "heap")}
MAT["window"] = L.material("window", L.color("window", style), emission=L.color("window", style), emission_strength=1.0)  # stays amber under ACES (higher clips to cream)
MAT["lampOn"] = L.material("lampOn", L.color("window", style), emission=L.color("window", style), emission_strength=1.3)
MAT["lampOff"] = m("windowOff", emission=L.color("windowOff", style), emission_strength=0.4)  # dark glass, still a lantern
MAT["snowcap"] = L.material("snowcap", L.color("roofSnow", style), roughness=0.95)  # light blue, unlit: the moon makes lit slopes pale and shaded slopes deep blue, as measured in keyart.png
MAT["snowRim"] = L.material("snowRim", L.color("snowRim", style), emission=L.color("snowRim", style), emission_strength=0.12, roughness=0.95)  # the white lip on roof edges
MAT["field"] = m("snow")  # the snowfield past the map edge: same blue as the snow heightfield (src/snow.js), so no seam
MAT["post"] = m("wood", emission=L.color("wood", style), emission_strength=0.25)  # thin posts stay brown, not black, under the moon
MAT["stone"] = m("stone")
MAT["plaster"] = m("plaster", emission=L.color("plaster", style), emission_strength=0.1)  # warm under the moon, as in the video (lit by its windows)
MAT["timber"] = m("timber")
MAT["trimGreen"] = m("trimGreen")
MAT["doorGreen"] = m("doorGreen")
MAT["leaf"] = m("leaf")
MAT["fire"] = L.material("fire", L.color("fire", style), emission=L.color("fire", style), emission_strength=1.0)
for mat in MAT.values():
    mat.use_backface_culling = True  # closed meshes only: exported single-sided (half the fragment cost)
static = []  # joined at the end
pools = 0


def pool_marker(x, y):
    """Empty `Pool_<k>` at an always-lit lamp: the game paints a warm pool on the snow there."""
    global pools
    e = bpy.data.objects.new(f"Pool_{pools}", None)
    e.location = (x, y, 0)
    bpy.context.scene.collection.objects.link(e)
    pools += 1


def keep(o):
    static.append(o)
    return o


def mesh(name, verts, faces, mat):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    L.assign(o, mat)
    return o


def keep_faces(o, ok):
    """Delete the faces of o whose normal fails ok(normal): hidden faces of flat-on-wall or buried parts (budget)."""
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if not ok(f.normal)], context="FACES")
    bm.to_mesh(o.data)
    bm.free()
    return o


def prism(name, w, d, z0, h, mat, overhang=0.0):
    """Gable roof volume: ridge along x, eaves at z0, ridge at z0 + h."""
    x, y = w / 2 + overhang, d / 2 + overhang
    v = [(-x, -y, z0), (x, -y, z0), (x, y, z0), (-x, y, z0), (-x, 0, z0 + h), (x, 0, z0 + h)]
    f = [(0, 1, 5, 4), (2, 3, 4, 5), (0, 4, 3), (1, 2, 5)]  # no bottom face (never seen)
    o = mesh(name, v, f, mat)
    # materials are single-sided (backface culling), so the hand-built faces must point outwards
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    if sum((f.calc_center_median() - mathutils.Vector((0, 0, z0 + h / 3))).dot(f.normal) for f in bm.faces) < 0:
        for f in bm.faces:  # open shell: make sure "consistent" means outwards
            f.normal_flip()
    bm.to_mesh(o.data)
    bm.free()
    return o


def rim(name, p0, p1, size, mat):
    """A rounded snow lip from p0 to p1: a hexagonal tube with open ends (hidden where the lips meet), 12 triangles."""
    a, b = mathutils.Vector(p0), mathutils.Vector(p1)
    bpy.ops.mesh.primitive_cylinder_add(vertices=6, radius=size / 2, depth=(b - a).length, end_fill_type="NOTHING")
    o = bpy.context.active_object
    o.name = name
    L.assign(o, mat)
    o.rotation_mode = "QUATERNION"
    o.rotation_quaternion = (b - a).to_track_quat("Z", "Y")
    o.location = (a + b) / 2
    L.apply_transform(o)
    return o


def cone(name, r, depth, loc, mat, verts=7):
    bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r, radius2=0, depth=depth, location=loc, end_fill_type="NOTHING")
    o = bpy.context.active_object
    o.name = name
    L.assign(o, mat)
    return o


def place(objs, x, y, rot):
    """Move objects built around the origin (front = -Y) to (x, y), turned by rot radians about Z."""
    m = mathutils.Matrix.Translation((x, y, 0)) @ mathutils.Matrix.Rotation(rot, 4, "Z")
    for o in objs:  # rotate about the house origin, not each part's own centre
        o.matrix_world = m @ o.matrix_world
        L.apply_transform(o)


def lump(name, size, loc, mat, bevel):
    """A chamfered box: reads as a rounded rock or a lump of snow at game distance (26 faces)."""
    o = L.box(name, size, loc, mat)
    b = o.modifiers.new("Bevel", "BEVEL")
    b.width, b.segments = bevel, 1
    L.apply_all_modifiers(o)
    return o




HOUSE_GLOW = 0.4  # the texture as its own faint emission: windows (painted bright amber) glow, timber stays brown


def bake_window_glow(obj):
    """Lit windows for a generated house. A generated texture has no emission, so under the blue moon its painted
    panes read dull green and the walls near-black. The pane texels are repainted the palette's bright amber, and the
    texture is also the emission map at HOUSE_GLOW: the panes glow, the rest keeps a faint self-light.
    (A separate emission texture rendered as the base texture in this scene, washing every house out white.)"""
    import numpy as np
    amber = np.array(L.color("window", style)[:3], dtype=np.float32)  # linear
    for mat in obj.data.materials:
        nt = mat.node_tree
        bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
        tex = next((l.from_node for l in bsdf.inputs["Base Color"].links if l.from_node.type == "TEX_IMAGE"), None)
        if tex is None:
            continue
        img = tex.image
        px = np.array(img.pixels[:], dtype=np.float32).reshape(-1, 4)
        srgb = np.where(px[:, :3] <= 0.0031308, px[:, :3] * 12.92, 1.055 * np.power(np.clip(px[:, :3], 0, 1), 1 / 2.4) - 0.055) * 255
        r, g, b = srgb[:, 0], srgb[:, 1], srgb[:, 2]
        win = (r > 150) & (g > 0.6 * r) & (b < 0.6 * g)  # bright, warm, yellow: the painted panes
        px[win, :3] = amber
        img.pixels[:] = px.ravel()
        img.update()
        img.pack()
        nt.links.new(tex.outputs["Color"], bsdf.inputs["Emission Color"])
        bsdf.inputs["Emission Strength"].default_value = HOUSE_GLOW
        print(f"[lab_bpy] {obj.name}: {int(win.sum())} window texels of {len(px)} painted amber")


HOUSE_MODELS = (  # generated from crops/house.png (generate-media models.house-a/-b); front = where the door is
    ("assets/generated/house-a.glb", "+X"),  # green door, dormer
    ("assets/generated/house-b.glb", "+Y"),  # red door, no dormer
)
HOUSE_HEIGHT = 5.2  # chimney top; the footprint comes out about 4.5 m, inside the 6 m plot
house_templates = []
houses = []  # textured: joined into their own "Houses" mesh (the untextured parts lose their UVs below)


def house(i, x, y, facing, var):
    """A cabin like design/reference/crops/house.png: a generated model (thick rounded snow on a steep roof, timber
    frame, lit 2x2 windows, a chimney, a green or red door with the green box), alternating between two variants,
    sized a little differently each time. Door on the -Y side before placing, like the procedural house it replaced."""
    if not house_templates:
        for path, fwd in HOUSE_MODELS:
            t = L.import_glb(path, f"HouseT{len(house_templates)}", forward=fwd, height=HOUSE_HEIGHT, max_texture=1024)
            t.hide_render = True
            bake_window_glow(t)
            house_templates.append(t)
    t = house_templates[var % len(house_templates)]
    o = t.copy()
    o.data = t.data.copy()
    o.name = f"H{i}_house"
    o.hide_render = False
    bpy.context.collection.objects.link(o)
    o.scale = (1, 1, 1)
    k = 0.92 + 0.05 * var  # sizes vary like the video's (0.92-1.07)
    o.matrix_world = mathutils.Matrix.Scale(k, 4) @ o.matrix_world
    L.apply_transform(o)
    parts = [o]
    door_x = 0.0
    # lamp post on the door side, at the edge of the plot (the street side)
    lx = -door_x * 2.6 if abs(door_x) > 0 else 1.8
    post = L.cylinder(f"H{i}_lpost", 0.11, 2.6, (lx, -2.6, 1.3), vertices=6, mat=MAT["post"])
    arm = L.box(f"H{i}_arm", (0.13, 0.55, 0.13), (lx, -2.75, 2.55), MAT["post"])
    lamp = L.box(f"Lamp_{i}", (0.32, 0.32, 0.4), (lx, -2.95, 2.35), MAT["lampOff"])
    lamp_cap = L.box(f"H{i}_lampcap", (0.42, 0.42, 0.1), (lx, -2.95, 2.6), MAT["snowcap"])
    rot = {"s": 0.0, "n": math.pi, "e": math.pi / 2, "w": -math.pi / 2}[facing]
    place(parts + [post, arm, lamp_cap, lamp], x, y, rot)
    houses.extend(parts)
    for o in (post, arm, lamp_cap):
        keep(o)
    lamp.name = f"Lamp_{i}"
    return lamp


def pine(x, y, s, far=False):
    """Three snowy tiers with dark needles under each edge. Forest pines (far) skip the hidden trunk and use 5 sides."""
    if not far:
        keep(keep_faces(L.cylinder("trunk", 0.15 * s, 0.8 * s, (x, y, 0.4 * s), vertices=5, mat=MAT["wood"]), lambda n: abs(n.z) < 0.5))  # no hidden caps
    n = 5 if far else 7
    for r, z in ((1.25, 1.3), (0.95, 2.2), (0.62, 3.0)):
        if not far:  # the forest pines are too far for their dark undersides to read
            keep(cone("needles", r * s, 1.4 * s, (x, y, z * s), MAT["pine"], verts=n))  # dark needles show under the snow
        keep(cone("pinesnow", r * s * 0.93, 1.3 * s, (x, y, (z + 0.1) * s), MAT["snowcap"], verts=n))


def fence(x0, y0, x1, y1):
    n = max(2, round(math.hypot(x1 - x0, y1 - y0) / 1.1))
    ang = math.atan2(y1 - y0, x1 - x0)
    length = math.hypot(x1 - x0, y1 - y0)
    for k in range(n + 1):
        px, py = x0 + (x1 - x0) * k / n, y0 + (y1 - y0) * k / n
        keep(keep_faces(L.box("fpost", (0.12, 0.12, 0.9), (px, py, 0.45), MAT["timber"]), lambda n: n.z > -0.5))  # bottom is in the snow
        keep(keep_faces(L.box("fcap", (0.18, 0.18, 0.1), (px, py, 0.95), MAT["snowRim"]), lambda n: n.z > -0.5))
    for k in range(n):  # two pickets between each pair of posts (crops/villagers.png: a picket fence)
        for f in (1 / 3, 2 / 3):
            t = (k + f) / n
            keep(keep_faces(L.box("picket", (0.08, 0.05, 0.75), (x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, 0.38), MAT["wood"]), lambda n: n.z > -0.5))  # bottom is in the snow
    for z in (0.35, 0.62):
        rail = L.box("frail", (length, 0.06, 0.1), ((x0 + x1) / 2, (y0 + y1) / 2, z), MAT["wood"])
        rail.rotation_euler.z = ang
        L.apply_transform(rail)
        keep(rail)


def street(r, c):
    return 0 <= r < H and 0 <= c < W and rows[r][c] in ".SP"


lamps = []
house_i = 0
for r in range(H):
    for c in range(W):
        ch = rows[r][c]
        x, y = tile_center(r, c)
        if ch in "ewns":
            lamps.append(house(house_i, x, y, ch, rng.randrange(4)))
            house_i += 1
        elif ch == "T":
            for _ in range(rng.randint(2, 3)):
                pine(x + rng.uniform(-1.8, 1.8), y + rng.uniform(-1.8, 1.8), rng.uniform(0.8, 1.15))
            # fences on edges that face a street, 0.4 m inside the tile
            h = T / 2 - 0.4
            for dr, dc, (ax, ay, bx, by) in ((-1, 0, (-h, h, h, h)), (1, 0, (-h, -h, h, -h)), (0, -1, (-h, -h, -h, h)), (0, 1, (h, -h, h, h))):
                if street(r + dr, c + dc):
                    fence(x + ax, y + ay, x + bx, y + by)

def street_lamp(x, y, toward):
    """A wooden post with an arm, the lantern hanging under it (crops/lamp.png). The arm points `toward` (radians)."""
    ax, ay = math.cos(toward), math.sin(toward)
    keep(L.cylinder("lpost", 0.11, 3.0, (x, y, 1.5), vertices=6, mat=MAT["post"]))
    for name, size, z, mat in (("larm", (0.75, 0.13, 0.13), 2.9, MAT["post"]), ("lsnow", (0.8, 0.14, 0.06), 2.98, MAT["snowcap"])):
        o = L.box(name, size, (x + ax * 0.32, y + ay * 0.32, z), mat)
        o.rotation_euler.z = toward
        L.apply_transform(o)
        keep(o)
    lx, ly = x + ax * 0.55, y + ay * 0.55
    keep(L.box("lhang", (0.03, 0.03, 0.18), (lx, ly, 2.78), MAT["roofDark"]))
    keep(L.box("lantern", (0.3, 0.3, 0.38), (lx, ly, 2.5), MAT["lampOn"]))
    keep(L.box("lcap", (0.4, 0.4, 0.08), (lx, ly, 2.72), MAT["roofDark"]))
    pool_marker(lx, ly)


# festival square (design/reference/crops/square.png): a ring of snowy stones around a log fire pit, a small
# sapling with a flat green crown behind the fire, and four lamp posts with hanging lanterns (always lit)
sq = [tile_center(r, c) for r in range(H) for c in range(W) if rows[r][c] == "S"]
sx, sy = sum(p[0] for p in sq) / len(sq), sum(p[1] for p in sq) / len(sq)
for k in range(11):  # the stone ring, r 1.7 m: grey-green rocks packed close round the pit, each under a lump of snow
    a = k * math.tau / 11 + 0.2
    s = 0.6 + 0.25 * ((k * 7) % 5) / 4
    stone = [lump("stone", (0.85 * s, 0.6, 0.45 * s), (0, 0, 0.22 * s), MAT["stone"], 0.12),
             lump("stonesnow", (0.62 * s, 0.42, 0.16), (0, 0.03, 0.45 * s + 0.02), MAT["snowRim"], 0.06)]
    for o in stone:  # irregular: each rock leans a little
        o.rotation_euler = (0.08 * ((k * 3) % 5 - 2), 0.06 * ((k * 5) % 3 - 1), 0)
        L.apply_transform(o)
    place(stone, sx + math.cos(a) * 1.7, sy + math.sin(a) * 1.7, a + math.pi / 2)
    for o in stone:
        keep(o)
keep(L.cylinder("pitfloor", 1.45, 0.1, (sx, sy, 0.05), vertices=12, mat=MAT["roofDark"]))  # the dark pit
for k in range(3):  # three crossed logs over the embers (four read as a 'starburst')
    log = L.cylinder("log", 0.13, 1.3, (0, 0, 0), vertices=6, mat=MAT["wood"])
    log.rotation_euler = (math.pi / 2, 0, k * math.pi / 3 + 0.3)
    log.location = (sx, sy - 0.2, 0.2 + 0.06 * (k % 2))
    L.apply_transform(log)
    keep(log)
flames = [L.cylinder("embers", 0.42, 0.1, (sx, sy - 0.2, 0.08), vertices=6, mat=MAT["fire"])]
for k, (fx, fy, fh) in enumerate(((0, 0, 0.9), (0.22, 0.12, 0.6), (-0.2, 0.1, 0.65), (0.05, -0.2, 0.55))):
    flames.append(cone("flame", 0.2 if k == 0 else 0.13, fh, (sx + fx, sy - 0.2 + fy, 0.2 + fh / 2), MAT["fire"], verts=4))
fire = L.join(flames, "Fire")
keep(L.cylinder("sapling", 0.08, 1.2, (sx, sy + 1.2, 0.6), vertices=5, mat=MAT["wood"]))  # behind the pit (north)
for (w, d, z, rz) in ((0.8, 0.6, 1.25, 0.2), (0.6, 0.45, 1.45, -0.4)):  # the small flat green crown, snow on top
    crown = L.box("crown", (w, d, 0.24), (sx, sy + 1.2, z), MAT["leaf"])
    crown.rotation_euler.z = rz
    L.apply_transform(crown)
    keep(crown)
keep(L.box("crownsnow", (0.3, 0.24, 0.05), (sx, sy + 1.2, 1.6), MAT["snowRim"]))
for ox, oy in ((-6.5, -2.2), (6.5, -2.2), (-6.5, 2.2), (6.5, 2.2)):  # the square is one tile deep, ringed by houses
    street_lamp(sx + ox, sy + oy, math.atan2(-oy, -ox))  # lanterns hang towards the fire

# street lamps at junctions (always lit)
for r in range(H):
    for c in range(W):
        if rows[r][c] == "." and street(r, c - 1) + street(r, c + 1) and street(r - 1, c) + street(r + 1, c):
            # in the corner of a diagonal neighbour that is a yard (never on the road)
            corner = next(((dr, dc) for dr, dc in ((-1, -1), (-1, 1), (1, 1), (1, -1)) if not street(r + dr, c + dc)), None)
            if corner is None:
                continue
            x, y = tile_center(r, c)
            ox, oy = x + corner[1] * (T / 2 + 0.6), y - corner[0] * (T / 2 + 0.6)
            street_lamp(ox, oy, math.atan2(y - oy, x - ox))  # the lantern hangs over the junction

# forest beyond the village edge, and the snowfield under it all
for _ in range(70):
    while True:
        x, y = forest_rng.uniform(-W * T / 2 - 9, W * T / 2 + 9), forest_rng.uniform(-H * T / 2 - 9, H * T / 2 + 9)  # a tight band: a wall of pines, not a scatter
        if abs(x) > W * T / 2 + 1 or abs(y) > H * T / 2 + 1:
            break
    pine(x, y, forest_rng.uniform(0.9, 1.4), far=True)
ground = L.box("ground", (W * T + 60, H * T + 60, 0.2), (0, 0, -0.1), MAT["field"])
keep(ground)

for o in static + [fire] + lamps:  # untextured: drop the UVs the primitives come with
    while o.data.uv_layers:
        o.data.uv_layers.remove(o.data.uv_layers[0])
# triangles by part: a report for the optimize-web-game pass (no cap while matching the reference)
_by = {}
for o in static:
    key = o.name.split(".")[0].split("_")[-1] if o.name.startswith("H") else o.name.split(".")[0]
    _by[key] = _by.get(key, 0) + sum(len(p.vertices) - 2 for p in o.data.polygons)
print("[lab_bpy] tris by part: " + ", ".join(f"{k} {v}" for k, v in sorted(_by.items(), key=lambda kv: -kv[1])[:12]))
village_mesh = L.join(static, "Village")
houses_mesh = L.join(houses, "Houses")  # textured cabins (window glow is made at load: src/houseGlow.js)
for t in house_templates:
    bpy.data.objects.remove(t, do_unlink=True)
bpy.context.scene.cursor.location = (0, 0, 0)
L.select_only(village_mesh)
bpy.ops.object.origin_set(type="ORIGIN_CURSOR")  # pivot at the village centre
L.select_only(houses_mesh)
bpy.ops.object.origin_set(type="ORIGIN_CURSOR")
bpy.context.scene.cursor.location = (sx, sy - 0.2, 0)
L.select_only(fire)
bpy.ops.object.origin_set(type="ORIGIN_CURSOR")  # pivot at the fire's foot
sq_marker = bpy.data.objects.new("Square", None)
sq_marker.location = (sx, sy, 0)
bpy.context.scene.collection.objects.link(sq_marker)
print(f"[lab_bpy] village: {house_i} houses, {pools} lamp pools, {L.triangle_count()} tris")
L.export_glb("public/models/village.glb")
# preview: the hero shot (key art), from behind the start looking up the avenue to the square
L.setup_lighting(style)
cam = bpy.data.objects.new("Cam", bpy.data.cameras.new("Cam"))
cam.data.angle = math.radians(45)
bpy.context.scene.collection.objects.link(cam)
for lamp in lamps:  # preview with every house reached, like the end of a game
    lamp.data.materials[0] = MAT["lampOn"]
cam.location = (0, -H * T / 2 - 4, 20)  # high over the start, looking up the avenue to the square (key art)
cam.rotation_euler = (mathutils.Vector((0, H * T / 2 - 14, 0)) - cam.location).to_track_quat("-Z", "Y").to_euler()
bpy.context.scene.camera = cam
L.configure_render(".lab/previews/village.png", (1024, 576))
bpy.ops.render.render(write_still=True)
