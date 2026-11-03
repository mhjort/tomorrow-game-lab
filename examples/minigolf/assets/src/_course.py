"""Shared minigolf course builder (helper — skipped by build-assets because of the leading underscore).

Blender coordinates: X right, +Y down the course, Z up. Exported glTF/three.js: (x, z, -y).
"""
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(__file__))
import bmesh  # noqa: E402
import bpy  # noqa: E402
import lab_bpy as L  # noqa: E402

TURF_T = 0.1      # turf slab thickness
RAIL_T = 0.1      # rail thickness
RAIL_H = 0.12     # rail height above turf
CUP_R = 0.09
CUP_DEPTH = 0.15
ISLAND_TOP = -0.1


def slab(name, x0, y0, x1, y1, z0, z1=None, thickness=TURF_T, mat=None):
    """Axis-aligned slab whose top goes from z0 (at y0) to z1 (at y1) — ramps slope along Y."""
    z1 = z0 if z1 is None else z1
    t = thickness
    verts = [(x0, y0, z0 - t), (x1, y0, z0 - t), (x1, y1, z1 - t), (x0, y1, z1 - t),
             (x0, y0, z0), (x1, y0, z0), (x1, y1, z1), (x0, y1, z1)]
    faces = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    if mat:
        L.assign(o, mat)
    return o


class Course:
    def __init__(self, name, style, height=lambda x, y: 0.0):
        self.name = name
        self.style = style
        self.height = height  # turf height function
        s = style
        self.m_turf = L.material("Turf", L.color("turf", s), roughness=0.95)
        self.m_rail = L.material("Rail", L.color("rail", s), roughness=0.6)
        self.m_accent = L.material("Accent", L.color("accent", s), roughness=0.5)
        self.m_cup = L.material("Cup", L.color("cup", s), roughness=0.8)
        self.m_grass = L.material("Grass", L.color("grass", s), roughness=1.0)
        self.m_rock = L.material("Rock", L.color("rock", s), roughness=0.95)
        self.m_wood = L.material("Wood", L.color("wood", s), roughness=0.9)
        self.m_leaf = L.material("Leaf", L.color("leaf", s), roughness=0.9)
        self.m_water = L.material("Water", L.color("water", s), roughness=0.1)
        self.turf = []
        self.rects = []

    # ------------------------------------------------------------ turf
    def turf_rect(self, x0, y0, x1, y1):
        z0, z1 = self.height(x0, y0), self.height(x0, y1)
        self.rects.append((x0, y0, x1, y1))
        o = slab(f"Turf{len(self.turf)}", x0, y0, x1, y1, z0, z1, mat=self.m_turf)
        self.turf.append(o)
        return o

    def rails(self, outline, breaks_y=()):
        """Rails along a CCW outline polygon [(x,y),...], split at slope breaks so they follow the turf."""
        n = len(outline)
        for i in range(n):
            (ax, ay), (bx, by) = outline[i], outline[(i + 1) % n]
            dx, dy = bx - ax, by - ay
            length = math.hypot(dx, dy)
            nx, ny = dy / length, -dx / length  # outward normal for CCW
            h = RAIL_T / 2
            if abs(dy) < 1e-6:  # along X
                x0, x1 = sorted((ax, bx))
                y = ay + ny * h
                z = self.height(ax, ay)
                self._rail(x0 - h, y - h, x1 + h, y + h, z, z)
            else:  # along Y — split at breaks
                y0, y1 = sorted((ay, by))
                x = ax + nx * h
                cuts = [y0] + [b for b in sorted(breaks_y) if y0 < b < y1] + [y1]
                for j in range(len(cuts) - 1):
                    ya, yb = cuts[j], cuts[j + 1]
                    ya2, yb2 = (ya - h if j == 0 else ya), (yb + h if j == len(cuts) - 2 else yb)
                    self._rail(x - h, ya2, x + h, yb2, self.height(x, ya), self.height(x, yb))

    def _rail(self, x0, y0, x1, y1, z0, z1):
        o = slab(f"Rail{len(bpy.data.objects)}", x0, y0, x1, y1, z0 + RAIL_H, z1 + RAIL_H, thickness=RAIL_H + TURF_T, mat=self.m_rail)
        L.tag_collider(o, "trimesh", friction=0.3, restitution=0.75)
        return o

    def trim_blocks(self, points):
        for i, (x, y) in enumerate(points):
            z = self.height(x, y) + RAIL_H
            L.box(f"Trim{i}", (0.14, 0.14, 0.04), (x, y, z + 0.02), self.m_accent)

    def block(self, name, x, y, sx, sy):
        z = self.height(x, y)
        o = slab(name, x - sx / 2, y - sy / 2, x + sx / 2, y + sy / 2, z + RAIL_H, thickness=RAIL_H + TURF_T, mat=self.m_rail)
        L.tag_collider(o, "trimesh", friction=0.3, restitution=0.75)
        return o

    # ------------------------------------------------------------ cup / tee
    def cup(self, x, y):
        z = self.height(x, y)
        cutter = L.cylinder("CupCutter", CUP_R, 1.0, (x, y, z), 32)
        host = next(o for o, r in zip(self.turf, self.rects) if r[0] <= x <= r[2] and r[1] <= y <= r[3])
        L.boolean_cut(host, cutter)
        bpy.ops.mesh.primitive_cylinder_add(radius=CUP_R, depth=CUP_DEPTH, vertices=32, end_fill_type="NOTHING",
                                            location=(x, y, z - CUP_DEPTH / 2))
        wall = bpy.context.active_object
        wall.name = "CupWall"
        L.assign(wall, self.m_cup)
        L.tag_collider(wall, "trimesh", friction=0.6, restitution=0.1)
        bottom = L.cylinder("CupBottom", CUP_R + 0.01, 0.02, (x, y, z - CUP_DEPTH - 0.01), 32, self.m_cup)
        L.tag_collider(bottom, "trimesh", friction=0.9, restitution=0.0)
        sensor = L.box("CupSensor", (CUP_R * 1.4, CUP_R * 1.4, 0.06), (x, y, z - CUP_DEPTH + 0.03))
        L.tag_collider(sensor, "cuboid", sensor=True, collider_only=True)
        L.cylinder("FlagPole", 0.012, 0.9, (x, y, z + 0.45 - 0.05), 8, self.m_rail)
        L.box("FlagCloth", (0.32, 0.012, 0.2), (x + 0.17, y, z + 0.72), self.m_accent)
        e = bpy.data.objects.new("CupCenter", None)
        e.location = (x, y, z)
        bpy.context.scene.collection.objects.link(e)

    def tee(self, x, y):
        z = self.height(x, y)
        L.box("TeePad", (0.36, 0.24, 0.006), (x, y, z + 0.003), self.m_rail)
        e = bpy.data.objects.new("Tee", None)
        e.location = (x, y, z)
        bpy.context.scene.collection.objects.link(e)

    def finish_turf(self):
        for o in self.turf:
            L.tag_collider(o, "trimesh", friction=0.8, restitution=0.05)

    # ------------------------------------------------------------ island decor
    def island(self, cx, cy, radius, seed=1, pond=None):
        rnd = random.Random(seed)
        bpy.ops.mesh.primitive_cylinder_add(radius=radius, depth=0.05, vertices=12, location=(cx, cy, ISLAND_TOP - 0.025))
        top = bpy.context.active_object
        top.name = "IslandTop"
        L.assign(top, self.m_grass)
        L.tag_collider(top, "trimesh", friction=0.9, restitution=0.05)
        bpy.ops.mesh.primitive_cone_add(radius1=radius, radius2=radius * 0.15, depth=radius * 0.7, vertices=12,
                                        location=(cx, cy, ISLAND_TOP - 0.05 - radius * 0.35))
        base = bpy.context.active_object
        base.name = "IslandBase"
        base.rotation_euler = (math.pi, 0, 0)
        L.assign(base, self.m_rock)
        if pond:
            px, py, pr = pond
            L.cylinder("Pond", pr, 0.02, (px, py, ISLAND_TOP + 0.005), 24, self.m_water)

        def free(x, y, margin):
            if math.hypot(x - cx, y - cy) > radius - 0.6:
                return False
            if pond and math.hypot(x - pond[0], y - pond[1]) < pond[2] + margin:
                return False
            return all(not (r[0] - margin < x < r[2] + margin and r[1] - margin < y < r[3] + margin) for r in self.rects)

        placed = 0
        for _ in range(400):
            if placed >= 9:
                break
            x, y = cx + rnd.uniform(-radius, radius), cy + rnd.uniform(-radius, radius)
            if not free(x, y, 0.9):
                continue
            if rnd.random() < 0.6:
                s = rnd.uniform(0.8, 1.3)
                L.cylinder(f"Trunk{placed}", 0.08 * s, 0.5 * s, (x, y, ISLAND_TOP + 0.25 * s), 6, self.m_wood)
                bpy.ops.mesh.primitive_cone_add(radius1=0.45 * s, depth=1.1 * s, vertices=7, location=(x, y, ISLAND_TOP + 1.0 * s))
                bpy.context.active_object.name = f"Tree{placed}"
                L.assign(bpy.context.active_object, self.m_leaf)
            else:
                s = rnd.uniform(0.2, 0.45)
                L.sphere(f"Rock{placed}", s, (x, y, ISLAND_TOP + s * 0.5), 1, self.m_rock)
            placed += 1
