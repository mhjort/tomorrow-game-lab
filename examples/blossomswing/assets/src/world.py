"""The hilltop, the big tree with its swing branch, the valley, pond, green trees, bushes, grass and clouds
(design/reference/inventory.md). Orchard trees are NOT here: `orchard.py` builds the bare/blossom templates and
this script places `Orchard_r<row>_<i>` empties (position, yaw, scale) that the game instances.
Blender axes: x = screen right, y = away from the camera, z = up.
Markers: Pivot (rope top, on the branch's underside), CamSwing (camera target), Orchard_* empties."""
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(__file__))
import bmesh  # noqa: E402
import bpy  # noqa: E402
import mathutils  # noqa: E402
import mathutils.bvhtree  # noqa: E402
import lab_bpy as L  # noqa: E402
from _shapes import blob, link, tube  # noqa: E402

L.reset_scene()
style = L.load_style()
rng = random.Random(7)


def M(role, rough=0.85):
    return L.material(role, L.color(role, style), roughness=rough)


MAT = {k: M(k) for k in ("grass", "grassLit", "hillMid", "trunk", "trunkShade", "canopy", "leaf", "bush", "water",
                         "pebble", "cloud", "seat", "flower", "flowerCentre", "bareWood")}
MAT["water"] = L.material("water", L.color("water", style), roughness=0.35)

PIVOT = (0.7, 0.08, 3.11)  # frame_08: the rope hangs from the branch's underside, ~2.3 m right of the trunk's edge
ROPE = 2.4
POND = (3.5, 22.0)  # frame_08: the pond sits in the middle of the view, at the valley floor


def smooth(e0, e1, x):
    t = max(0.0, min(1.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


# ------------------------------------------------------------------ terrain
def near_hill(x, y):
    """The hilltop the tree stands on: flat-ish under the swing, falling away to the right (the leap lands there)
    and quickly behind (so the valley shows over it, frame_08)."""
    # frame_08: the ground falls away diagonally to the right of the swing, so the camera sees over it into the valley
    crest = 0.15 - 0.006 * (x + 1) ** 2 if x < 0.8 else 0.15 - 0.006 * 1.8 ** 2 - 0.22 * (x - 0.8) - 0.03 * (x - 0.8) ** 2
    back = 0.22 * max(0.0, y - 1.2) ** 2  # the far side of the hilltop drops away fast: the pond shows over it
    front = 0.02 * max(0.0, -y - 2) ** 2  # toward the camera it rolls down a little
    return crest - back - front


def valley(x, y):
    """Valley slopes, a floor around the pond, rolling hills behind."""
    # a bowl round the pond: deepest at its middle, the slopes rising to the left and right (frame_08: the orchard
    # slopes climb either side of the pond, above the hilltop's shoulder)
    floor = -5.2 * math.exp(-(((x - 3) / 13) ** 2)) * smooth(2, 18, y) * (1 - smooth(34, 70, y))
    sides = 0.06 * abs(x - 3) * smooth(6, 30, y) * (1 - smooth(50, 80, y))
    roll = 1.3 * math.sin(x * 0.11 + y * 0.09) * smooth(8, 40, y) + 0.8 * math.sin(x * 0.23 - y * 0.05 + 1.3) * smooth(20, 60, y)
    far = 7.5 * smooth(55, 95, y) + 3.0 * math.sin(x * 0.07 + 0.5) * smooth(70, 110, y)
    # near the camera the valley stays under the hilltop; to the right it drops with the hill, so the hill's slope
    # runs on instead of meeting a flat shelf (judges saw a hard seam there)
    under = 3.0 * (1 - smooth(2, 9, y)) * (1 + 0.35 * max(0.0, x - 3))
    # the pond's basin: an oval dip, so the waterline (where the flat water meets it) is a smooth oval (crops/pond.png)
    dip = 1.4 * math.exp(-(((x - POND[0]) / 6.5) ** 2 + ((y - POND[1]) / 4.2) ** 2))
    return floor + sides + roll + far - 0.4 - under - dip


def h(x, y):
    """The one ground surface: the hilltop where it is higher, the valley elsewhere."""
    return max(near_hill(x, y), valley(x, y))


def terrain(name, fn, xs, ys, mat):
    bm = bmesh.new()
    grid = [[bm.verts.new((x, y, fn(x, y))) for x in xs] for y in ys]
    for j in range(len(ys) - 1):
        for i in range(len(xs) - 1):
            bm.faces.new((grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    o = link(name, bm, mat)
    return o


def spaced(a, b, n, power=1.0):
    return [a + (b - a) * (k / (n - 1)) ** power for k in range(n)]


# the near hill (grass) and the valley + far hills (hillMid; the game's fog hazes them with distance)
# Two meshes of the same surface h: where they overlap (y 4..5.5) the valley mesh sits 15 cm lower (4 cm was not enough on steep faces: a vertical
# offset barely separates near-vertical planes), so they never
# share a plane (z-fighting; lab_bpy's finish() check)
terrain("Hill", h, spaced(-14, 22, 90), spaced(-9, 5.5, 40), MAT["grass"])
terrain("Valley", lambda x, y: h(x, y) - 0.15 * (1 - smooth(5.5, 6.0, y)), spaced(-60, 80, 200), spaced(4, 160, 130, 1.6), MAT["hillMid"])
L.tag_collider(bpy.data.objects["Valley"], "trimesh")
# everything stands on the MESH, found by raycasting it: the mesh is linear between grid points, and props placed on
# the smooth function h() sank up to a metre into the slopes (orchard trees showed only their branch tips)
dg = bpy.context.evaluated_depsgraph_get()
BVH = [mathutils.bvhtree.BVHTree.FromObject(bpy.data.objects[n], dg) for n in ("Hill", "Valley")]


def ground(x, y):
    zs = [hit[0].z for b in BVH for hit in [b.ray_cast(mathutils.Vector((x, y, 60)), mathutils.Vector((0, 0, -1)))] if hit[0] is not None]
    return max(zs) if zs else h(x, y)

L.tag_collider(bpy.data.objects["Hill"], "trimesh")

# ------------------------------------------------------------------ pond (frame_08: round, at the valley floor)
pz = ground(*POND) + 0.9  # water 0.9 m up the 1.4 m basin
bm = bmesh.new()
bmesh.ops.create_circle(bm, cap_ends=True, segments=40, radius=1.0)
for v in bm.verts:
    v.co.x = v.co.x * 8.0 + POND[0]  # larger than the waterline: its edge is under the basin's sides
    v.co.y = v.co.y * 5.5 + POND[1]
    v.co.z = pz
pond = link("Pond", bm, MAT["water"])
# pebbles hugging the far half of the waterline (crops/pond.png): march out from the middle until the ground rises
# above the water, jittered in size and spacing
for k in range(18):
    a = math.pi * (0.18 + 0.64 * k / 17) + rng.uniform(-0.03, 0.03)  # the far arc only (crops/pond.png)
    r = 0.5
    while r < 12 and ground(POND[0] + math.cos(a) * r * 1.5, POND[1] + math.sin(a) * r) < pz:
        r += 0.05
    px, py = POND[0] + math.cos(a) * r * 1.5, POND[1] + math.sin(a) * r
    L.sphere(f"Pebble{k}", 0.15 + rng.random() * 0.14, (px, py, ground(px, py) + 0.04), 2, MAT["pebble"])

# ------------------------------------------------------------------ the big tree (crops/big_tree.png)
# wide at the foot and leaning into the branch at the top (frame_01: the trunk is ~1.4 child-heights wide)
trunk = tube("Trunk", [(-2.5, 0.7, -0.6), (-2.4, 0.7, 0.6), (-2.2, 0.65, 1.8), (-1.9, 0.6, 3.0), (-1.6, 0.6, 5.0)],
             [1.6, 1.05, 0.88, 0.82, 0.7], MAT["trunk"], n=40, sides=36, wobble=0.04, seed=1, cap_end=False)
# root flare: three low lobes sinking into the hill
for k, (dx, dy, r) in enumerate(((0.75, -0.35, 0.5), (-0.6, -0.5, 0.55), (0.1, -0.7, 0.42), (1.0, -0.75, 0.42))):  # the last one reaches into the frame
    tube(f"Root{k}", [(-2.3, 0.7, 0.6), (-2.3 + dx * 0.6, 0.7 + dy * 0.6, 0.15), (-2.3 + dx * 1.3, 0.7 + dy * 1.3, -0.35)],
         [r, r * 0.8, r * 0.45], MAT["trunk"], n=10, sides=14)
# the dark knot hole facing the camera (frame_01): a flattened dark ellipsoid set into the bark, a bark rim round it
# on the trunk's front-right face, the part the swing camera sees; its thin axis along the bark's normal
knot = L.sphere("Knot", 1.0, (-1.74, -0.14, 1.75), 3, MAT["trunkShade"])
knot.scale = (0.17, 0.09, 0.3)
knot.rotation_euler = (0, 0, math.radians(30))
L.apply_transform(knot)
rim = L.sphere("KnotRim", 1.0, (-1.76, -0.11, 1.75), 3, MAT["trunk"])
rim.scale = (0.24, 0.1, 0.38)
rim.rotation_euler = (0, 0, math.radians(30))
L.apply_transform(rim)
# the swing branch: out of the trunk, arcing right over the swing (frames 01, 08)
branch = tube("Branch", [(-1.75, 0.55, 2.65), (-0.9, 0.35, 3.05), (0.1, 0.15, 3.28), (0.7, 0.08, 3.29), (1.7, 0.0, 3.45), (2.8, -0.05, 3.85), (3.6, 0.0, 4.4)],
              [0.38, 0.27, 0.22, 0.2, 0.18, 0.16, 0.13], MAT["trunk"], n=40, sides=18)  # it rises out of the trunk, arcs and tapers; its tip ends in a canopy ball  # thinner: it framed the top as a heavy band
# a second limb up into the canopy, and a short stub
tube("Limb", [(-1.9, 0.6, 3.6), (-1.2, 0.9, 4.8), (-0.3, 1.2, 5.8)], [0.4, 0.3, 0.2], MAT["trunk"], n=12, sides=14)
tube("Limb2", [(-2.0, 0.6, 3.9), (-3.0, 0.9, 5.4)], [0.35, 0.18], MAT["trunk"], n=8, sides=12)
# the rope's wraps round the branch at the pivot: three tan rings (crops/rope_top.png)
for k in range(3):
    # centred on the branch's axis at the pivot, just outside its bark (radius ~0.17 there)
    bpy.ops.mesh.primitive_torus_add(major_segments=24, minor_segments=8, major_radius=0.205, minor_radius=0.026, location=(PIVOT[0] - 0.08 + k * 0.08, 0.08, 3.29), rotation=(0, math.pi / 2, 0))
    t = bpy.context.active_object
    t.name = f"Wrap{k}"
    L.apply_transform(t)
    L.assign(t, L.material("rope", L.color("rope", style), roughness=0.9))
# the salmon-pink canopy: big soft balls, mostly above the frame top (frames 01, 08)
# their bottoms sit just over the branch: frame_08 shows them along the top edge of the frame
# plus a row of smaller balls along the front edge, so round silhouettes (not a flat underside) show at the frame top
# the front row hangs low, in front of the branch, so the camera sees their round lower halves (key art), not a sheet
balls = [(-0.7, -0.7, 4.05, 0.62), (0.5, -0.85, 4.15, 0.55), (1.6, -0.8, 4.1, 0.6), (2.7, -0.7, 4.3, 0.58), (3.55, -0.2, 4.45, 0.7),  # swallows the branch tip

         (0.3, -0.3, 4.6, 0.9), (1.9, -0.2, 4.75, 0.85), (3.3, -0.1, 4.95, 0.8), (-0.9, -0.2, 4.7, 0.95),
         (-3.8, 1.2, 5.0, 1.6), (-2.0, 0.6, 5.6, 1.9), (0.0, 0.8, 5.0, 1.75), (1.9, 0.6, 4.9, 1.6), (3.5, 0.9, 5.2, 1.5),
         (-1.0, 1.8, 6.8, 1.7), (1.2, 2.0, 6.6, 1.6), (4.8, 1.6, 6.2, 1.3), (-4.9, 2.0, 6.3, 1.3)]
blob("Canopy", balls, MAT["canopy"], subdiv=4)  # seen big and close: smooth silhouettes

# ------------------------------------------------------------------ the swing seat (moved by the game)
# the plank lies across the swing (along y): the two ropes run from one wrap down to its two ends
seat = L.box("Seat", (0.22, 0.64, 0.05), (PIVOT[0], PIVOT[1], PIVOT[2] - ROPE), MAT["seat"])  # ropes pass outside the hood
L.bevel(seat, 0.015, 2)

# ------------------------------------------------------------------ boulder, bushes, green trees, grass
boulder = L.sphere("Boulder", 1.0, (-1.45, -0.9, 0.05), 3, MAT["pebble"])  # bottom-left, by the trunk (frame_01)
boulder.scale = (0.75, 0.6, 0.5)
L.apply_transform(boulder)


bush_spots = [(-0.8, 3.0, 3), (-4.6, 2.6, 4), (3.3, 2.2, 2), (5.0, 21.0, 3), (10.5, 21.5, 3), (-3.0, 14.0, 3), (14.0, 15.0, 2), (2.0, 28.0, 3)]
for k, (x, y, n) in enumerate(bush_spots):
    s = 0.55 if y < 6 else 1.0
    balls = [(x + (i - n / 2) * 0.7 * s, y + rng.uniform(-0.2, 0.2), ground(x + (i - n / 2) * 0.7 * s, y) + 0.05, (0.45 + rng.random() * 0.25) * s, 0.75) for i in range(n)]
    blob(f"Bush{k}", balls, MAT["bush"], subdiv=2)

green_spots = [(12.5, 13.0, 1.0), (5.5, 30.0, 1.2), (-5.5, 22.0, 1.1), (17.0, 28.0, 1.3), (-1.0, 40.0, 1.4), (22.0, 42.0, 1.5), (9.0, 46.0, 1.4), (-10.0, 35.0, 1.3), (27.0, 20.0, 1.2), (3.5, 17.0, 0.9)]
for k, (x, y, s) in enumerate(green_spots):
    z = ground(x, y)
    L.cylinder(f"GreenTrunk{k}", 0.12 * s, 0.9 * s, (x, y, z + 0.4 * s), 10, MAT["trunkShade"])
    # a cloud-like canopy of merged balls, wider than tall (crops/green_tree.png)
    blob(f"GreenTree{k}", [(x, y, z + 1.3 * s, 0.62 * s), (x - 0.5 * s, y, z + 1.15 * s, 0.5 * s), (x + 0.5 * s, y + 0.1, z + 1.18 * s, 0.52 * s), (x + 0.1 * s, y - 0.2, z + 1.6 * s, 0.45 * s)], MAT["leaf"], subdiv=3)

# grass tufts: clumps of 5-9 rounded blades on the near hill (crops/ground_front.png), denser near the camera
bm = bmesh.new()
for k in range(380):
    x = rng.uniform(-6, 15)
    y = rng.uniform(-4.5, 1.8)
    if math.hypot(x + 2.5, y - 0.7) < 1.8:
        continue  # not inside the trunk
    z = near_hill(x, y)
    for b in range(rng.randint(5, 9)):
        bx, by = x + rng.uniform(-0.12, 0.12), y + rng.uniform(-0.06, 0.06)
        ht = rng.uniform(0.05, 0.1)
        # thick rounded blades (crops/ground_front.png): a fat cone with a blunt tip
        # a rounded blob-tipped blade (crops/ground_front.png): a stretched smooth sphere, half sunk in the ground
        blade = bmesh.ops.create_icosphere(bm, subdivisions=1, radius=1.0)
        lean = rng.uniform(-0.3, 0.3)
        gz = ground(bx, by)
        for v in blade["verts"]:
            zz = (v.co.z * 0.5 + 0.5) * ht
            v.co.x = v.co.x * 0.03 + bx + lean * zz
            v.co.y = v.co.y * 0.022 + by
            v.co.z = zz + gz - 0.03
link("Tufts", bm, MAT["grassLit"])
# daisies: tiny white discs with a yellow centre, a few cm over the grass
bm = bmesh.new()
for k in range(70):
    x, y = rng.uniform(-5, 8), rng.uniform(-4, 1.5)
    if math.hypot(x + 2.5, y - 0.7) < 1.8:
        continue
    z = ground(x, y) + 0.03
    d = bmesh.ops.create_circle(bm, cap_ends=True, segments=8, radius=0.045)
    for v in d["verts"]:
        v.co = (v.co.x + x, v.co.y + y, z)
    c = bmesh.ops.create_icosphere(bm, subdivisions=1, radius=0.016)
    for v in c["verts"]:
        v.co = (v.co.x + x, v.co.y + y, v.co.z + z + 0.012)
        for f in v.link_faces:
            f.material_index = 1
daisy = link("Daisies", bm, MAT["flower"], smooth=False)
daisy.data.materials.append(MAT["flowerCentre"])

# ------------------------------------------------------------------ clouds: soft white balls with flat bottoms
for k, (x, y, z, s) in enumerate(((-20, 150, 36, 12), (45, 160, 42, 14), (85, 170, 30, 7), (-65, 165, 48, 7))):  # two big ones (key art)
    blob(f"Cloud{k}", [(x, y, z, s, 0.7), (x - s * 0.9, y, z - s * 0.2, s * 0.7, 0.65), (x + s * 1.0, y, z - s * 0.15, s * 0.75, 0.65), (x + s * 0.3, y, z + s * 0.45, s * 0.6)], MAT["cloud"], subdiv=3)

# ------------------------------------------------------------------ orchard markers: 5 rows (brief "Rules")
# row 0 the near left slope, 1 the far left, 2 the near right, 3 the far right, 4 the far slopes (frames 07→12)
def row(x0, x1, y0, y1, n):
    """n trees in three staggered lines between x0..x1, from depth y0 to y1."""
    return [(x0 + (x1 - x0) * k / (n - 1), (y0, (y0 + y1) / 2, y1)[k % 3]) for k in range(n)]


# on the valley's slopes either side of the pond (frame_08: left slope in bloom, right slope still bare)
# rows on the slopes that FACE the camera: on the near side of the valley the ground falls away from the hilltop and
# its bulge hid every trunk (the trees read as twig bundles on the grass)
# row 0 stays left of the band behind the swing: canopies right behind the child hid its silhouette
ROWS = [row(-19, -4, 15, 24, 10), row(-22, -2, 27, 36, 12), row(8, 24, 11, 22, 14), row(10, 29, 26, 33, 11), row(-16, 30, 40, 48, 14)]
placed = []
for r, trees in enumerate(ROWS):
    for i, (x, y) in enumerate(trees):
        if math.hypot((x - POND[0]) / 6.5, (y - POND[1]) / 4.5) < 1:
            x += 8 if x > POND[0] else -8
        px, py = x + rng.uniform(-0.5, 0.5), y + rng.uniform(-0.6, 0.6)
        if any(math.hypot(px - qx, py - qy) < 2.6 for qx, qy in placed):
            continue  # a minimum spacing: no interpenetrating trees
        placed.append((px, py))
        e = bpy.data.objects.new(f"Orchard_r{r}_{i}", None)
        e.location = (px, py, 0)
        e.location.z = ground(e.location.x, e.location.y) - 0.05
        e.rotation_euler = (0, 0, rng.uniform(0, 2 * math.pi))
        s = rng.uniform(1.1, 1.5)
        e.scale = (s, s, s)
        bpy.context.scene.collection.objects.link(e)

for name, loc in (("Pivot", PIVOT), ("CamSwing", (PIVOT[0], 0, 1.45))):
    e = bpy.data.objects.new(name, None)
    e.location = loc
    bpy.context.scene.collection.objects.link(e)

# preview from about where the game camera stands (the whole 160 m valley would be a few pixels per tree)
L.finish(__file__, style, {"yaw_deg": 0, "pitch_deg": 3, "target": (0.8, 3, 1.4), "distance": 9, "fov_deg": 62, "size": (1344, 768)})
