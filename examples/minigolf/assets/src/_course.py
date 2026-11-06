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
        host = next(o for o, r in zip(self.turf, self.rects) if r[0] <= x <= r[2] and r[1] <= y <= r[3])
        L.cut_hole(host, x, y, z, CUP_R, CUP_DEPTH, self.m_cup, name="Cup")
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
    def mat(self, role, roughness=0.9, glow=0.0):
        """Material for a palette role (created once). glow > 0 makes it emissive (city windows, lamps)."""
        name = f"{role.capitalize()}{'Glow' if glow else ''}"
        c = L.color(role, self.style)
        return L.material(name, c, roughness=roughness, emission=c if glow else None, emission_strength=glow)

    def island(self, cx, cy, radius, theme, seed=1, pond=None):
        """Floating island under the course, dressed for `theme` (beach / snow / desert / city)."""
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
            if theme == "city":  # fountain: stone rim + water
                L.cylinder("FountainRim", pr, 0.08, (px, py, ISLAND_TOP + 0.04), 24, self.mat("concrete"))
                L.cylinder("Pond", pr * 0.85, 0.02, (px, py, ISLAND_TOP + 0.075), 24, self.m_water)
                L.cylinder("FountainCol", 0.08, 0.35, (px, py, ISLAND_TOP + 0.2), 8, self.mat("concrete"))
            else:  # snow: the "water" role is pale ice
                L.cylinder("Pond", pr, 0.02, (px, py, ISLAND_TOP + 0.005), 24, self.m_water)

        def free(x, y, margin, rim=0.6):
            if math.hypot(x - cx, y - cy) > radius - rim:
                return False
            if pond and math.hypot(x - pond[0], y - pond[1]) < pond[2] + margin:
                return False
            return all(not (r[0] - margin < x < r[2] + margin and r[1] - margin < y < r[3] + margin) for r in self.rects)

        props = {"beach": self._beach_prop, "snow": self._snow_prop, "desert": self._desert_prop, "city": self._city_prop}[theme]
        if theme == "city":  # a ring of low towers on the rim, behind the street furniture
            for i in range(9):
                a = rnd.uniform(0, math.tau)
                x, y = cx + math.cos(a) * (radius - 0.85), cy + math.sin(a) * (radius - 0.85)
                if free(x, y, 1.1, rim=0.0):
                    self._tower(f"Tower{i}", x, y, rnd)
        placed = 0
        for _ in range(400):
            if placed >= 10:
                break
            x, y = cx + rnd.uniform(-radius, radius), cy + rnd.uniform(-radius, radius)
            if not free(x, y, 0.9):
                continue
            props(f"P{placed}", x, y, rnd)
            placed += 1
        if pond and theme in ("beach", "desert"):  # a palm by the water
            self._palm("PondPalm", pond[0] + pond[2] * 0.8, pond[1] + pond[2] * 0.6, rnd)

    def _rock(self, n, x, y, rnd, mat=None):
        s = rnd.uniform(0.2, 0.45)
        L.sphere(f"Rock{n}", s, (x, y, ISLAND_TOP + s * 0.5), 1, mat or self.m_rock)

    def _palm(self, n, x, y, rnd):
        s = rnd.uniform(0.85, 1.2)
        lean = rnd.uniform(-0.25, 0.25)  # sideways offset per trunk segment, growing upward (a gentle curve)
        seg = 0.38 * s
        x0, z0 = x, ISLAND_TOP
        for k in range(4):  # each segment tilts toward where the next one starts, so the trunk stays joined
            dx = lean * 0.12 * (k + 1)
            L.cylinder(f"Trunk{n}_{k}", 0.07 * s * (1 - k * 0.12), seg, (x0 + dx / 2, y, z0 + seg / 2 - 0.01), 6,
                       self.m_wood).rotation_euler = (0, math.atan2(dx, seg), 0)
            x0, z0 = x0 + dx, z0 + seg - 0.02
        top = (x0, y, z0 + 0.04)
        for k in range(6):
            a = k * math.tau / 6 + rnd.uniform(-0.2, 0.2)
            frond = L.box(f"Frond{n}_{k}", (0.75 * s, 0.2 * s, 0.03), (top[0] + math.cos(a) * 0.32 * s, top[1] + math.sin(a) * 0.32 * s, top[2] - 0.06), self.m_leaf)
            frond.rotation_euler = (0, 0.35, a)

    def _beach_prop(self, n, x, y, rnd):
        r = rnd.random()
        if r < 0.45:
            self._palm(n, x, y, rnd)
        elif r < 0.75:  # beach umbrella + towel
            L.cylinder(f"UmbPole{n}", 0.02, 0.9, (x, y, ISLAND_TOP + 0.45), 6, self.m_wood)
            bpy.ops.mesh.primitive_cone_add(radius1=0.5, depth=0.25, vertices=8, location=(x, y, ISLAND_TOP + 0.95))
            bpy.context.active_object.name = f"Umbrella{n}"
            L.assign(bpy.context.active_object, self.mat("canopy") if rnd.random() < 0.5 else self.m_accent)
            towel = L.box(f"Towel{n}", (0.35, 0.7, 0.01), (x + 0.35, y, ISLAND_TOP + 0.005), self.m_accent)
            towel.rotation_euler = (0, 0, rnd.uniform(-0.6, 0.6))
        else:
            self._rock(n, x, y, rnd)

    def _snow_prop(self, n, x, y, rnd):
        r = rnd.random()
        if r < 0.55:  # snowy pine: stacked cones, white tip
            s = rnd.uniform(0.8, 1.3)
            L.cylinder(f"Trunk{n}", 0.07 * s, 0.3 * s, (x, y, ISLAND_TOP + 0.15 * s), 6, self.m_wood)
            for k, (rad, h) in enumerate(((0.5, 0.6), (0.38, 0.5), (0.26, 0.42))):
                bpy.ops.mesh.primitive_cone_add(radius1=rad * s, depth=h * s, vertices=7,
                                                location=(x, y, ISLAND_TOP + (0.5 + k * 0.33) * s))
                bpy.context.active_object.name = f"Pine{n}_{k}"
                L.assign(bpy.context.active_object, self.m_leaf)
            bpy.ops.mesh.primitive_cone_add(radius1=0.14 * s, depth=0.2 * s, vertices=7, location=(x, y, ISLAND_TOP + 1.33 * s))
            bpy.context.active_object.name = f"PineSnow{n}"
            L.assign(bpy.context.active_object, self.mat("snow"))
        elif r < 0.8:  # snowman
            for k, rad in enumerate((0.22, 0.16, 0.11)):
                z = ISLAND_TOP + (0.2, 0.52, 0.76)[k]
                L.sphere(f"Snowman{n}_{k}", rad, (x, y, z), 2, self.mat("snow"))
            bpy.ops.mesh.primitive_cone_add(radius1=0.025, depth=0.14, vertices=6, location=(x, y - 0.16, ISLAND_TOP + 0.77))
            nose = bpy.context.active_object
            nose.name = f"Carrot{n}"
            nose.rotation_euler = (math.pi / 2, 0, 0)
            L.assign(nose, self.mat("carrot"))
        else:  # rock with a snow cap
            s = rnd.uniform(0.2, 0.4)
            L.sphere(f"Rock{n}", s, (x, y, ISLAND_TOP + s * 0.5), 1, self.m_rock)
            L.sphere(f"RockSnow{n}", s * 0.75, (x, y, ISLAND_TOP + s * 0.85), 1, self.mat("snow"))

    def _desert_prop(self, n, x, y, rnd):
        r = rnd.random()
        if r < 0.5:  # saguaro: trunk + two arms
            s = rnd.uniform(0.8, 1.25)
            L.cylinder(f"Cactus{n}", 0.11 * s, 1.1 * s, (x, y, ISLAND_TOP + 0.55 * s), 8, self.m_leaf)
            for side in (-1, 1):
                if rnd.random() < 0.8:
                    h = rnd.uniform(0.35, 0.6) * s
                    L.cylinder(f"CactusArmH{n}{side}", 0.07 * s, 0.24 * s, (x + side * 0.16 * s, y, ISLAND_TOP + h), 8, self.m_leaf).rotation_euler = (0, math.pi / 2, 0)
                    L.cylinder(f"CactusArmV{n}{side}", 0.07 * s, 0.32 * s, (x + side * 0.27 * s, y, ISLAND_TOP + h + 0.13 * s), 8, self.m_leaf)
        elif r < 0.8:  # little mesa: stacked sandstone slabs
            w = rnd.uniform(0.4, 0.7)
            for k in range(3):
                L.box(f"Mesa{n}_{k}", (w * (1 - k * 0.2), w * 0.8 * (1 - k * 0.2), 0.22), (x, y, ISLAND_TOP + 0.11 + k * 0.22), self.m_rock)
        else:
            self._rock(n, x, y, rnd)

    def _tower(self, n, x, y, rnd):
        w, d, h = rnd.uniform(0.6, 0.9), rnd.uniform(0.6, 0.9), rnd.uniform(1.2, 2.4)
        L.box(n, (w, d, h), (x, y, ISLAND_TOP + h / 2), self.m_rock)
        for k in range(int(h / 0.4)):  # lit window bands
            L.box(f"{n}Win{k}", (w + 0.02, d + 0.02, 0.1), (x, y, ISLAND_TOP + 0.3 + k * 0.4), self.mat("glass", glow=1.5))
        L.box(f"{n}Roof", (w * 0.4, d * 0.4, 0.12), (x, y, ISLAND_TOP + h + 0.06), self.mat("concrete"))

    def _city_prop(self, n, x, y, rnd):
        r = rnd.random()
        if r < 0.4:  # street lamp
            L.cylinder(f"Lamp{n}", 0.025, 1.0, (x, y, ISLAND_TOP + 0.5), 6, self.m_rock)
            L.sphere(f"LampGlow{n}", 0.08, (x, y, ISLAND_TOP + 1.04), 1, self.mat("glass", glow=3.0))
        elif r < 0.8:  # planter tree
            L.box(f"Planter{n}", (0.4, 0.4, 0.2), (x, y, ISLAND_TOP + 0.1), self.mat("concrete"))
            L.cylinder(f"Trunk{n}", 0.05, 0.5, (x, y, ISLAND_TOP + 0.45), 6, self.m_wood)
            L.sphere(f"Crown{n}", 0.3, (x, y, ISLAND_TOP + 0.85), 1, self.m_leaf)
        else:  # bench
            L.box(f"Bench{n}", (0.6, 0.18, 0.04), (x, y, ISLAND_TOP + 0.2), self.m_wood)
            for side in (-1, 1):
                L.box(f"BenchLeg{n}{side}", (0.04, 0.16, 0.2), (x + side * 0.26, y, ISLAND_TOP + 0.1), self.m_rock)
