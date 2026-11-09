"""Shared shape builders for the Blossom Swing asset scripts (skipped by the build: leading underscore)."""
import math

import bmesh
import bpy
import mathutils


def link(name, bm, mat=None, smooth=True):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    if smooth:
        for p in o.data.polygons:
            p.use_smooth = True
    if mat:
        o.data.materials.append(mat)
    return o


def catmull(points, n):
    """n samples along a Catmull-Rom spline through points (list of 3-tuples)."""
    P = [mathutils.Vector(p) for p in points]
    P = [P[0] * 2 - P[1]] + P + [P[-1] * 2 - P[-2]]
    out = []
    segs = len(P) - 3
    for k in range(n):
        t = k / (n - 1) * segs
        i = min(int(t), segs - 1)
        u = t - i
        p0, p1, p2, p3 = P[i], P[i + 1], P[i + 2], P[i + 3]
        out.append(0.5 * ((2 * p1) + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (-p0 + 3 * p1 - 3 * p2 + p3) * u * u * u))
    return out


def tube(name, points, radii, mat=None, n=24, sides=16, cap_end=True, wobble=0.0, seed=0, grain=0.13, bulge=None):
    """A smooth tube along a spline; radii are interpolated along it. Both ends are closed.
    UVs: u counts bark-grain lines round the tube (a whole number, ~`grain` m apart, so the seam at the back matches),
    v is the length along it in metres. The game draws the grain from them (src/main.ts, trunk material).
    bulge(centre, direction) -> extra radius (m) per vertex: e.g. a trunk's root flare, part of the same surface."""
    path = catmull(points, n)
    rs = [0.0] * n
    for k in range(n):  # piecewise-linear radius over the control points
        t = k / (n - 1) * (len(radii) - 1)
        i = min(int(t), len(radii) - 2)
        rs[k] = radii[i] + (radii[i + 1] - radii[i]) * (t - i)
    bm = bmesh.new()
    rings = []
    up = mathutils.Vector((0, 0, 1))
    for k, c in enumerate(path):
        d = (path[min(k + 1, n - 1)] - path[max(k - 1, 0)]).normalized()
        a = up if abs(d.dot(up)) < 0.9 else mathutils.Vector((1, 0, 0))
        u = d.cross(a).normalized()
        v = d.cross(u).normalized()
        ring = []
        for j in range(sides):
            ang = 2 * math.pi * j / sides
            r = rs[k] * (1 + wobble * math.sin(3 * ang + seed + k * 0.7))
            dirn = u * math.cos(ang) + v * math.sin(ang)
            if bulge:
                r += bulge(c, dirn)
            ring.append(bm.verts.new(c + dirn * r))
        rings.append(ring)
    lines = max(3, round(2 * math.pi * sum(rs) / n / grain))
    vs = [0.0]
    for p0, p1 in zip(path, path[1:]):
        vs.append(vs[-1] + (p1 - p0).length)
    uv = bm.loops.layers.uv.new("UVMap")
    for k, (a_, b_) in enumerate(zip(rings, rings[1:])):
        for j in range(sides):
            j2 = (j + 1) % sides
            f = bm.faces.new((a_[j], a_[j2], b_[j2], b_[j]))
            u0, u1 = j / sides * lines, (j + 1) / sides * lines
            for loop, (u, v) in zip(f.loops, ((u0, vs[k]), (u1, vs[k]), (u1, vs[k + 1]), (u0, vs[k + 1]))):
                loop[uv].uv = (u, v)
    bm.faces.new(rings[0][::-1])
    if cap_end:
        bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return link(name, bm, mat)


def blob(name, balls, mat, subdiv=3):
    """Several spheres (x, y, z, r[, sz]) joined into one smooth mesh; sz squashes a ball vertically."""
    bm = bmesh.new()
    for b in balls:
        x, y, z, r = b[:4]
        sz = b[4] if len(b) > 4 else 1.0
        geo = bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=r)
        for v in geo["verts"]:
            v.co = mathutils.Vector((v.co.x + x, v.co.y + y, v.co.z * sz + z))
    return link(name, bm, mat)


def flower(bm, centre, normal, size, petal_mat_index=0, centre_mat_index=1):
    """A small 5-petal flower facing `normal`: 5 flat petal fans + a raised centre. Appends to bm."""
    n = mathutils.Vector(normal).normalized()
    a = mathutils.Vector((0, 0, 1)) if abs(n.z) < 0.9 else mathutils.Vector((1, 0, 0))
    u = n.cross(a).normalized()
    v = n.cross(u)
    c = mathutils.Vector(centre)
    faces = []
    for p in range(5):
        ang = 2 * math.pi * p / 5
        d = u * math.cos(ang) + v * math.sin(ang)
        s = u * math.cos(ang + math.pi / 2) + v * math.sin(ang + math.pi / 2)
        tip = c + d * size + n * size * 0.08
        v0 = bm.verts.new(c + n * size * 0.06)
        v1 = bm.verts.new(c + d * size * 0.55 + s * size * 0.32 + n * size * 0.1)
        v2 = bm.verts.new(tip)
        v3 = bm.verts.new(c + d * size * 0.55 - s * size * 0.32 + n * size * 0.1)
        f = bm.faces.new((v0, v1, v2, v3))
        f.material_index = petal_mat_index
        faces.append(f)
    ctr = bmesh.ops.create_icosphere(bm, subdivisions=1, radius=size * 0.2)
    for vv in ctr["verts"]:
        vv.co = vv.co + c + n * size * 0.14
    for f in {f for vv in ctr["verts"] for f in vv.link_faces}:
        f.material_index = centre_mat_index
    return faces
