"""Orchard tree templates, instanced by the game at world.glb's `Orchard_r<row>_<i>` empties.
  BareTree  short stout grey-brown trunk splitting into 4 crooked upturned branches, a dark green tuft at its foot
            (crops/bare_tree.png). Origin at the foot, ~2 m tall.
  Blossom   the round lumpy canopy of 4 overlapping pink balls dotted with small 5-petal white flowers with yellow
            centres (crops/blossom_tree.png). Origin at the foot like the trunk, so the game can scale it from the
            branch fork (Blossom's own origin point `Fork` is where it grows from)."""
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(__file__))
import bmesh  # noqa: E402
import bpy  # noqa: E402
import mathutils  # noqa: E402
import lab_bpy as L  # noqa: E402
from _shapes import flower, link, tube  # noqa: E402

L.reset_scene()
style = L.load_style()
rng = random.Random(3)
wood = L.material("bareWood", L.color("bareWood", style), roughness=0.9)
tuftm = L.material("bush", L.color("bush", style), roughness=0.9)
pink = L.material("blossom", L.color("blossom", style), roughness=0.8)
white = L.material("flower", L.color("flower", style), roughness=0.8)
yellow = L.material("flowerCentre", L.color("flowerCentre", style), roughness=0.8)

# a short stout trunk, flared at the foot, about 0.4 of the tree (crops/bare_tree.png)
FORK = 0.6  # a short stout trunk (~1/3 of the tree) that splits low (crops/bare_tree.png)
trunk = [tube("Trunk", [(0, 0, -0.15), (0, 0, 0.1), (0.02, 0, 0.35), (0, 0.02, FORK)], [0.34, 0.24, 0.19, 0.17], wood, n=10, sides=14)]
parts = []
for k in range(4):
    a = 2 * math.pi * k / 4 + rng.uniform(-0.35, 0.35)
    out = rng.uniform(0.75, 0.95)  # spread wide, 35-60 degrees off vertical (crops/bare_tree.png)
    up = rng.uniform(0.7, 0.9)
    bend = rng.choice((-1, 1)) * rng.uniform(0.3, 0.55)  # an elbow  # crooked: each branch kinks sideways once
    p0 = (0, 0, FORK - 0.05)
    p1 = (math.cos(a) * out * 0.45, math.sin(a) * out * 0.45, FORK + up * 0.35)
    p2 = (math.cos(a + bend) * out * 0.8, math.sin(a + bend) * out * 0.8, FORK + up * 0.7)
    p3 = (math.cos(a + bend * 0.5) * out, math.sin(a + bend * 0.5) * out, FORK + up)
    parts.append(tube(f"Branch{k}", [p0, p1, p2, p3], [0.13, 0.09, 0.055, 0.025], wood, n=10, sides=10))
    # a small upturned fork near the tip
    parts.append(tube(f"Twig{k}", [p2, (p2[0] * 1.25, p2[1] * 1.25, p2[2] + 0.22)], [0.035, 0.012], wood, n=4, sides=6))
tuft = L.sphere("FootTuft", 0.17, (0.3, -0.26, 0.02), 2, tuftm)  # beside the trunk, on the ground
tuft.scale = (1.2, 1, 0.55)
L.apply_transform(tuft)
# two meshes: the trunk (with its foot tuft) stays, the branches shrink away as the blossom canopy grows (otherwise
# their tips poke through it). Each is one node with no children (the release build's quantization splits those).
L.join(trunk + [tuft], "BareTrunk")
L.join(parts, "BareBranches")

# the blossom canopy: 4 balls round the branch tips, flowers scattered over their outward faces
# raised on the trunk with its base just over the fork, big enough to swallow every branch tip (crops/blossom_tree.png)
# low on the short trunk, wide enough to swallow the branch crown (crops/blossom_tree.png: only a short stub shows)
balls = [(0.0, 0.0, FORK + 0.75, 0.68), (0.45, 0.2, FORK + 0.52, 0.52), (-0.45, 0.15, FORK + 0.54, 0.54), (0.05, -0.44, FORK + 0.5, 0.5), (0.0, 0.32, FORK + 1.0, 0.46)]
bm = bmesh.new()
for x, y, z, r in balls:
    g = bmesh.ops.create_icosphere(bm, subdivisions=3, radius=r)
    for v in g["verts"]:
        v.co = v.co + mathutils.Vector((x, y, z))
for f in bm.faces:
    f.material_index = 0
for k in range(120):
    x, y, z, r = balls[rng.randrange(len(balls))]
    d = mathutils.Vector((rng.gauss(0, 1), rng.gauss(0, 1), abs(rng.gauss(0, 1)) * 0.8 + 0.1)).normalized()
    c = mathutils.Vector((x, y, z)) + d * (r + 0.005)
    # only flowers that stick out of the merged blob (not buried inside a neighbouring ball)
    if any((c - mathutils.Vector(b[:3])).length < b[3] - 0.02 for b in balls if b[:3] != (x, y, z)):
        continue
    flower(bm, c, d, rng.uniform(0.12, 0.16), petal_mat_index=1, centre_mat_index=2)
blossom = link("Blossom", bm, pink)
blossom.data.materials.append(white)
blossom.data.materials.append(yellow)
L.finish(__file__, style, {"yaw_deg": 20, "pitch_deg": 10})
