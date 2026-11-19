"""lab_rig — automatic rigging + procedural animation clips for characters, animals and vehicles, in headless
Blender (5.2 LTS+).

Copy next to lab_bpy.py (assets/src/lab_rig.py; the build skips lab_* helpers) and:

    import lab_bpy as L, lab_rig as R
    body = L.import_glb("assets/generated/villager.glb", "Villager", forward="-Y", height=1.1, max_tris=6000)
    rig = R.rig_biped(body)                  # landmarks measured from the mesh; pass overrides if a sheet looks off
    R.add_biped_clips(rig)                   # idle, walk, run, jump (in place, loopable)
    R.add_hang_clips(rig)                    # optional: hang, swing, climb, pull (rope / ladder / bell-rope)
    R.render_pose_sheet(rig, ".lab/previews/villager-poses.png")
    L.finish(__file__)                       # GLB with skin + one glTF animation per clip

Assumes the lab's conventions: Z up, the character faces -Y, origin at the feet (L.import_glb does this), and a
T- or A-pose (arms away from the body). The character's left side (.L bones) is +X.
"""
import json
import math
import os

import bpy
import mathutils
from mathutils import Quaternion, Vector

import lab_bpy as L

FPS = 30

# ---------------------------------------------------------------- landmarks


def biped_landmarks(obj):
    """Measure joint positions of a T/A-pose biped from its vertices. Returns {name: Vector} in object space."""
    vs = [obj.matrix_world @ v.co for v in obj.data.vertices]
    H = max(v.z for v in vs)
    bins = 60
    # rows of the body: the vertices of every face that overlaps each height band. Faces, not vertices: on a
    # coarse mesh a band can fall between vertex rings and would see only a small feature (a nose)
    rows = [[] for _ in range(bins)]
    spans = [[] for _ in range(bins)]  # the x range each face covers in the band (for gaps between parts)
    for poly in obj.data.polygons:
        pts = [vs[i] for i in poly.vertices]
        lo_i = min(bins - 1, int(min(p.z for p in pts) / H * bins))
        hi_i = min(bins - 1, int(max(p.z for p in pts) / H * bins))
        span = (min(p.x for p in pts), max(p.x for p in pts))
        for i in range(lo_i, hi_i + 1):
            rows[i].extend(pts)
            spans[i].append(span)
    z_of = lambda i: (i + 0.5) / bins * H

    # crotch: the highest row in the lower 60% that has a gap between the legs (no vertex near x = 0)
    gap = 0.01 * H  # legs of toy characters nearly touch: a wider "gap" test misses the space between them
    crotch_i = 0
    for i in range(int(bins * 0.6)):
        if rows[i] and not any(abs(v.x) < gap for v in rows[i]):
            crotch_i = i
    crotch = z_of(crotch_i) if crotch_i else 0.45 * H
    legs = [v for v in vs if v.z < crotch]
    leg_x = sorted(abs(v.x) for v in legs)[len(legs) // 2] if legs else 0.1 * H

    # torso half-width: median extent of the centre part of the rows just above the crotch. In an A-pose the
    # hands hang beside the hem, so a row's outer extent is the hand: merge the x ranges the row's faces cover,
    # outwards from the centre, and stop at the first gap (the air between the coat and the arm). Face ranges,
    # not vertices: a coarse mesh has big gaps between the vertices of one flat side.
    def inner_extent(i):
        ext = []
        for sign in (1, -1):
            ivs = sorted((min(sign * a, sign * b), max(sign * a, sign * b)) for a, b in spans[i])
            ivs = [iv for iv in ivs if iv[1] > -0.02 * H]
            if not ivs:
                continue
            e = ivs[0][1]
            for lo, hi in ivs[1:]:
                if lo > e + 0.005 * H:
                    break
                e = max(e, hi)
            ext.append(e)
        return max(ext) if ext else 0.0
    body = [inner_extent(i) for i in range(crotch_i + 1, min(bins, crotch_i + 1 + bins // 8)) if rows[i]]
    torso_hw = sorted(body)[len(body) // 2] if body else 0.2 * H
    # arm vertices: well outside the torso, above the crotch
    arm_cut = torso_hw * 1.2
    out = {}
    for side, sign in (("L", 1), ("R", -1)):
        arm = [v for v in vs if sign * v.x > arm_cut and v.z > crotch]
        if not arm:
            raise RuntimeError("rig_biped: no arms found outside the torso; the character must be in a T- or A-pose")
        reach = max(sign * v.x for v in arm)
        tip = [v for v in arm if sign * v.x > reach * 0.97]
        hand_tip = sum(tip, Vector()) / len(tip)
        # the arm's line: through the middle of its outer part and the hand (the inner part merges with the
        # coat/torso, so its centroid drags the shoulder down). Works for T-pose (flat) and A-pose (sloped).
        # Only vertices of the arm count: scarf ends, a flared coat or a cape hanging at the sides are also
        # "outside the torso" and dragged the line far down (a T-posed girl's shoulders came out at her waist).
        # In a T- or A-pose the hand is the arm's lowest point, so drop what hangs well below the hand.
        on_arm = lambda v: v.z >= hand_tip.z - 0.15 * H  # noqa: E731
        mid = [v for v in arm if reach * 0.45 < sign * v.x < reach * 0.75 and on_arm(v)] or tip
        mid_c = sum(mid, Vector()) / len(mid)
        d = hand_tip - mid_c
        sx = sign * torso_hw * 0.75
        k = (sx - mid_c.x) / d.x if abs(d.x) > 1e-6 else 0.0
        shoulder = mid_c + d * k
        wrist = shoulder.lerp(hand_tip, 0.85)
        out[f"shoulder.{side}"] = shoulder
        out[f"elbow.{side}"] = shoulder.lerp(wrist, 0.5)
        out[f"wrist.{side}"] = wrist
        out[f"hand.{side}"] = hand_tip
        foot = [v for v in legs if sign * v.x > 0 and v.z < 0.08 * H] or [Vector((sign * leg_x, 0, 0))]
        toe_y = min(v.y for v in foot)
        out[f"hip.{side}"] = Vector((sign * leg_x, 0, crotch))
        out[f"ankle.{side}"] = Vector((sign * leg_x, 0, max(0.06 * H, 0.12 * crotch)))
        out[f"knee.{side}"] = out[f"hip.{side}"].lerp(out[f"ankle.{side}"], 0.5) + Vector((0, -0.02 * H, 0))
        out[f"toe.{side}"] = Vector((sign * leg_x, toe_y, 0.02 * H))
    shoulder_z = (out["shoulder.L"].z + out["shoulder.R"].z) / 2
    # neck: the narrowest row (arms excluded) between the shoulders and 60% of the way to the top
    # (the lowest row within 5% of the narrowest: a straight neck or a boxy head has many equal rows)
    widths = []
    for i in range(int(shoulder_z / H * bins) + 1, int((shoulder_z + 0.6 * (H - shoulder_z)) / H * bins)):
        w = [abs(v.x) for v in rows[i] if abs(v.x) < arm_cut]
        if w:
            widths.append((max(w), z_of(i)))
    neck = shoulder_z + 0.15 * (H - shoulder_z)
    if widths:
        narrow = min(w for w, _ in widths)
        neck = next(z for w, z in widths if w <= narrow * 1.05)
    out["hips"] = Vector((0, 0, crotch + 0.05 * H))
    out["chest"] = Vector((0, 0, crotch + 0.6 * (shoulder_z - crotch)))
    out["neck"] = Vector((0, 0, min(neck, shoulder_z + 0.05 * H) if neck < shoulder_z else neck))
    out["head_top"] = Vector((0, 0, H))
    # the head's half-width (centre cluster of the rows above the neck): rig_biped binds everything inside it rigidly
    # Only rows above the arms: on a big-headed character in a T-pose the arms are at neck height, and a row
    # through them would make the "head" as wide as the arm span (the arms then get bound rigidly to the head).
    arm_top = max(out["hand.L"].z, out["hand.R"].z, shoulder_z) + 0.05 * H
    head_from = max(out["neck"].z, arm_top)
    above = [inner_extent(i) for i in range(int(head_from / H * bins) + 1, bins) if rows[i]]
    out["head_side"] = Vector((max(above) if above else 0.1 * H, 0, out["neck"].z))
    return out


# ---------------------------------------------------------------- armature + skin

# bone: (head landmark, tail landmark, parent, connected)
BIPED = {
    "root": (None, None, None, False),
    "hips": ("hips", "chest", "root", False),
    "chest": ("chest", "neck", "hips", True),
    "head": ("neck", "head_top", "chest", True),
}
for _s in ("L", "R"):
    BIPED.update({
        f"upper_arm.{_s}": (f"shoulder.{_s}", f"elbow.{_s}", "chest", False),
        f"forearm.{_s}": (f"elbow.{_s}", f"wrist.{_s}", f"upper_arm.{_s}", True),
        f"hand.{_s}": (f"wrist.{_s}", f"hand.{_s}", f"forearm.{_s}", True),
        f"thigh.{_s}": (f"hip.{_s}", f"knee.{_s}", "hips", False),
        f"shin.{_s}": (f"knee.{_s}", f"ankle.{_s}", f"thigh.{_s}", True),
        f"foot.{_s}": (f"ankle.{_s}", f"toe.{_s}", f"shin.{_s}", True),
    })


def _segment_distance(p, a, b):
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / max(ab.length_squared, 1e-12)))
    return (p - (a + ab * t)).length


def rig_biped(obj, landmarks=None, name="Rig"):
    """Build a biped armature from measured (or given) landmarks and skin `obj` to it. Weights: each vertex is
    bound to its nearest bones (distance to the bone segment, never across the body's centre line), so it works
    on the non-manifold meshes image-to-3D models produce, where Blender's heat weighting fails.
    Returns the armature object; its ["landmarks"] holds the measured points (JSON)."""
    lm = biped_landmarks(obj)
    lm.update({k: Vector(v) for k, v in (landmarks or {}).items()})
    print("[lab_rig] landmarks " + json.dumps({k: [round(c, 3) for c in v] for k, v in lm.items()}))
    data = bpy.data.armatures.new(name)
    arm = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(arm)
    L.select_only(arm)
    bpy.ops.object.mode_set(mode="EDIT")
    for bname, (h, t, parent, connect) in BIPED.items():
        b = data.edit_bones.new(bname)
        if bname == "root":
            b.head, b.tail = Vector((0, 0, 0)), Vector((0, 0.2 * lm["hips"].z, 0))
        else:
            b.head, b.tail = lm[h], lm[t]
        if parent:
            b.parent = data.edit_bones[parent]
            b.use_connect = connect and (b.parent.tail - b.head).length < 1e-4
        b.use_deform = bname != "root"
        b.roll = 0.0
    bpy.ops.object.mode_set(mode="OBJECT")

    deform = [b for b in data.bones if b.use_deform]
    segs = {b.name: (b.head_local.copy(), b.tail_local.copy()) for b in deform}
    groups = {b.name: obj.vertex_groups.new(name=b.name) for b in deform}
    H = lm["head_top"].z
    for v in obj.data.vertices:
        p = obj.matrix_world @ v.co
        side = "L" if p.x > 0.01 * H else "R" if p.x < -0.01 * H else None
        cands = [(n, _segment_distance(p, *segs[n])) for n in segs if not (n.endswith(".L") and side == "R") and not (n.endswith(".R") and side == "L")]
        cands.sort(key=lambda c: c[1])
        best = cands[:2]
        # the head is rigid: a big (boxy) head's lower corners are nearer the shoulders than the head bone, and
        # the arms would drag the face down when they lift. Only arms reaching outside the head keep their bones.
        if p.z >= lm["neck"].z - 0.01 * H and abs(p.x) <= lm["head_side"].x * 1.05:
            best = [("head", 0.0)]
        ws = [1.0 / (d * d * d * d + 1e-10) for _, d in best]
        total = sum(ws)
        for (n, _), w in zip(best, ws):
            if w / total > 0.05:
                groups[n].add([v.index], w / total, "REPLACE")
    mod = obj.modifiers.new("Armature", "ARMATURE")
    mod.object = arm
    obj.parent = arm
    arm["landmarks"] = json.dumps({k: list(v) for k, v in lm.items()})
    L._EXPORT_OPTS.update(export_animation_mode="NLA_TRACKS", export_skins=True, export_animations=True)
    return arm


# ---------------------------------------------------------------- procedural clips


def _rest_q(arm, bone):
    return arm.data.bones[bone].matrix_local.to_quaternion()


def _world_rot(arm, bone, axis, deg):
    """Pose-space rotation of `bone` by `deg` around an armature-space axis (bone rolls don't matter)."""
    r = _rest_q(arm, bone)
    return r.inverted() @ Quaternion(Vector(axis), math.radians(deg)) @ r


def _arm_down_deg(arm, side):
    """Degrees to rotate an upper arm from its rest angle to 70 degrees below horizontal."""
    b = arm.data.bones[f"upper_arm.{side}"]
    d = (b.tail_local - b.head_local).normalized()
    below = math.degrees(math.asin(max(-1.0, min(1.0, -d.z))))
    return 70.0 - below


def _pose_key(arm, frame, pose):
    """pose: {bone: [(axis, deg), ...]} or {"root_z": metres}. Keys every bone so clips never inherit poses."""
    for pb in arm.pose.bones:
        q = Quaternion()
        for axis, deg in pose.get(pb.name, []):
            q = _world_rot(arm, pb.name, axis, deg) @ q
        pb.rotation_mode = "QUATERNION"
        pb.rotation_quaternion = q
        pb.location = (0, 0, 0)
        if pb.name == "root":  # vertical bob, given in armature space
            pb.location = _rest_q(arm, "root").inverted() @ Vector((0, 0, pose.get("root_z", 0.0)))
        pb.keyframe_insert("rotation_quaternion", frame=frame)
        pb.keyframe_insert("location", frame=frame)


def _clip(arm, name, keys, fps=FPS):
    """keys: [(seconds, pose)]. Creates an action pushed onto an NLA track named `name` (one glTF animation)."""
    arm.animation_data_create()
    act = bpy.data.actions.new(name)
    arm.animation_data.action = act
    for t, pose in keys:
        _pose_key(arm, 1 + round(t * fps), pose)
    track = arm.animation_data.nla_tracks.new()
    track.name = name
    track.strips.new(name, 1, act)
    track.mute = False
    arm.animation_data.action = None
    return act


def add_biped_clips(arm, clips=("idle", "walk", "run", "jump"), stride_deg=28):
    """In-place, loopable clips (the game moves the character): idle (2 s), walk (1 s), run (0.6 s), jump (0.8 s,
    crouch → stretch → tuck → land, not looped). Arms are lowered from the T/A-pose in every clip."""
    X, Y, Z = (1, 0, 0), (0, 1, 0), (0, 0, 1)
    down = {"L": _arm_down_deg(arm, "L"), "R": _arm_down_deg(arm, "R")}
    H = json.loads(arm["landmarks"])["head_top"][2]

    def base(arm_swing=0.0, elbow=10.0):
        # lower each arm about the forward axis (Y), then swing it about X (forward = -Y)
        return {
            "upper_arm.L": [(Y, down["L"]), (X, arm_swing)],
            "upper_arm.R": [(Y, -down["R"]), (X, -arm_swing)],
            "forearm.L": [(X, -elbow)],
            "forearm.R": [(X, -elbow)],
        }

    def cycle(period, swing, knee, bob, lean, arm_amp, elbow):
        keys = []
        for i in range(9):  # 8 segments, last key == first: seamless loop
            ph = i / 8 * 2 * math.pi
            s = math.sin(ph)
            p = base(arm_swing=arm_amp * s, elbow=elbow)
            p.update({
                "thigh.L": [(X, -swing * s)],
                "thigh.R": [(X, swing * s)],
                "shin.L": [(X, knee * max(0.0, math.sin(ph + math.pi / 2)))],
                "shin.R": [(X, knee * max(0.0, math.sin(ph - math.pi / 2)))],
                "hips": [(X, -lean), (Z, 4 * s)],
                "chest": [(Z, -6 * s)],
                "root_z": bob * abs(math.cos(ph)),
            })
            keys.append((i / 8 * period, p))
        return keys

    made = []
    if "idle" in clips:
        keys = []
        for i in range(5):
            s = math.sin(i / 4 * 2 * math.pi)
            p = base(arm_swing=2 * s, elbow=8)
            p.update({"chest": [(X, -2 * s)], "head": [(X, 3 * s)], "root_z": 0.004 * H * s})
            keys.append((i / 4 * 2.0, p))
        made.append(_clip(arm, "idle", keys))
    if "walk" in clips:
        made.append(_clip(arm, "walk", cycle(1.0, stride_deg, 35, 0.025 * H, 4, stride_deg * 0.8, 15)))
    if "run" in clips:
        made.append(_clip(arm, "run", cycle(0.6, stride_deg * 1.6, 70, 0.05 * H, 14, stride_deg * 1.4, 70)))
    if "jump" in clips:
        crouch = {**base(arm_swing=20, elbow=20), "thigh.L": [(X, -40)], "thigh.R": [(X, -40)], "shin.L": [(X, 70)], "shin.R": [(X, 70)], "hips": [(X, -15)], "root_z": -0.12 * H}
        up = {**base(arm_swing=-60, elbow=5), "thigh.L": [(X, 5)], "thigh.R": [(X, 5)], "hips": [(X, 5)]}
        tuck = {**base(arm_swing=-30, elbow=40), "thigh.L": [(X, -50)], "thigh.R": [(X, -35)], "shin.L": [(X, 80)], "shin.R": [(X, 60)]}
        made.append(_clip(arm, "jump", [(0, base()), (0.15, crouch), (0.3, up), (0.5, tuck), (0.7, crouch), (0.8, base())]))
    print(f"[lab_rig] clips: {[a.name for a in made]}")
    return made


def _arm_up_deg(arm, side, above=80.0):
    """Degrees (about armature Y) that raise an upper arm from its rest angle to `above` degrees over horizontal."""
    b = arm.data.bones[f"upper_arm.{side}"]
    d = (b.tail_local - b.head_local).normalized()
    rest = math.degrees(math.asin(max(-1.0, min(1.0, d.z))))
    return -(above - rest) if side == "L" else above - rest


def add_hang_clips(arm, clips=("hang", "swing", "climb", "pull")):
    """Clips for a character holding a rope, bar or ledge above its head (rope swings, ladders, monkey bars, bell
    ropes). The game pins the midpoint of the hand bones to the grip point every frame and moves/rotates the root.
      hang  (2 s loop)  arms overhead, legs dangling, a slow sway
      swing (1 s, scrub it: `animator.scrub('swing', u)`) u=0 legs kicked forward (front of a swing), u=0.5 hanging
            straight, u=1 legs tucked back (back of a swing). Map the pendulum's angle to u; don't play it in time.
      climb (0.8 s loop) hand over hand, knees lifting in turn
      pull  (1 s, scrub or loop) standing, both hands up on a line: u=0 arms up, u=0.5 pulled down with a dip
    Forward is the character's -Y (the lab convention), so "forward" = the direction it faces."""
    X, Y = (1, 0, 0), (0, 1, 0)
    up = {"L": _arm_up_deg(arm, "L"), "R": _arm_up_deg(arm, "R")}
    down = {"L": _arm_down_deg(arm, "L"), "R": _arm_down_deg(arm, "R")}
    H = json.loads(arm["landmarks"])["head_top"][2]

    def arms_up(reach_l=0.0, reach_r=0.0, elbow=8.0, fwd=8.0):
        # raise about Y, bring slightly forward about X; reach_* lifts one hand higher (degrees)
        return {
            "upper_arm.L": [(Y, up["L"] - reach_l), (X, -fwd)],
            "upper_arm.R": [(Y, up["R"] + reach_r), (X, -fwd)],
            "forearm.L": [(X, -elbow)],
            "forearm.R": [(X, -elbow)],
        }

    def legs(thigh, shin, spread=0.0):
        return {"thigh.L": [(X, thigh + spread)], "thigh.R": [(X, thigh - spread)], "shin.L": [(X, shin)], "shin.R": [(X, shin)]}

    made = []
    if "hang" in clips:
        keys = []
        for i in range(5):
            s = math.sin(i / 4 * 2 * math.pi)
            keys.append((i / 4 * 2.0, {**arms_up(), **legs(-6 - 6 * s, 14 + 8 * s), "hips": [(X, 3 * s)], "head": [(X, -4)]}))
        made.append(_clip(arm, "hang", keys))
    if "swing" in clips:
        fwd = {**arms_up(elbow=4), **legs(-55, 12), "hips": [(X, -12)], "chest": [(X, 6)], "head": [(X, 6)]}
        mid = {**arms_up(), **legs(-30, 40), "hips": [(X, -4)]}  # hanging still, the knees come up a little: no stiff plumb line
        back = {**arms_up(elbow=14, fwd=2), **legs(18, 75), "hips": [(X, 10)], "chest": [(X, -6)], "head": [(X, -8)]}
        made.append(_clip(arm, "swing", [(0, fwd), (0.5, mid), (1.0, back)]))
    if "climb" in clips:
        keys = []
        for i in range(5):
            s = math.sin(i / 4 * 2 * math.pi)
            p = {**arms_up(reach_l=18 * s, reach_r=-18 * s, elbow=18 - 10 * s), "hips": [(X, -4)]}
            p.update({"thigh.L": [(X, -20 - 35 * max(0.0, s))], "thigh.R": [(X, -20 - 35 * max(0.0, -s))],
                      "shin.L": [(X, 30 + 50 * max(0.0, s))], "shin.R": [(X, 30 + 50 * max(0.0, -s))]})
            keys.append((i / 4 * 0.8, p))
        made.append(_clip(arm, "climb", keys))
    if "pull" in clips:
        high = {**arms_up(elbow=6, fwd=20), "head": [(X, -10)]}
        low = {"upper_arm.L": [(Y, up["L"] * 0.35 + down["L"] * 0.0), (X, -55)], "upper_arm.R": [(Y, up["R"] * 0.35), (X, -55)],
               "forearm.L": [(X, -50)], "forearm.R": [(X, -50)], "hips": [(X, -12)], "chest": [(X, -10)],
               **legs(-25, 45), "root_z": -0.06 * H}
        made.append(_clip(arm, "pull", [(0, high), (0.5, low), (1.0, high)]))
    print(f"[lab_rig] clips: {[a.name for a in made]}")
    return made


def add_seated_clips(arm, clips=("sit", "kick", "fly", "land")):
    """Clips for a character sitting on a swing seat, bench, cart or boat and holding on at its sides. The game puts
    the `hips` bone on the seat every frame (move the model so hips' world position = seat point) and moves the seat.
      sit  (2 s loop)  seated, thighs forward, shins hanging, hands gripping at chest height beside the body
      kick (1 s, scrub it: `animator.scrub('kick', u)`) u=0 legs stretched out forward and leaning back (the front of
           a swing), u=0.5 sitting, u=1 legs tucked under and leaning forward (the back of a swing)
      fly  (0.8 s loop) let go: arms flung up and out, legs bicycling a little
      land (0.6 s, once) sitting on the ground, legs out in front, hands behind on the ground
    Forward is the character's -Y (the lab convention)."""
    X, Y = (1, 0, 0), (0, 1, 0)
    up = {"L": _arm_up_deg(arm, "L"), "R": _arm_up_deg(arm, "R")}
    down = {"L": _arm_down_deg(arm, "L"), "R": _arm_down_deg(arm, "R")}

    def grip(fwd=45.0, elbow=75.0, out=0.0):
        # arms lowered, upper arms swung forward, elbows bent up: hands in front of the chest at the sides
        return {"upper_arm.L": [(Y, down["L"] - out), (X, -fwd)], "upper_arm.R": [(Y, -down["R"] + out), (X, -fwd)],
                "forearm.L": [(X, -elbow)], "forearm.R": [(X, -elbow)]}

    def legs(thigh, shin, spread=0.0):
        return {"thigh.L": [(X, thigh + spread)], "thigh.R": [(X, thigh - spread)], "shin.L": [(X, shin)], "shin.R": [(X, shin)]}

    made = []
    if "sit" in clips:
        keys = []
        for i in range(5):
            s = math.sin(i / 4 * 2 * math.pi)
            keys.append((i / 4 * 2.0, {**grip(), **legs(-85, 80 + 6 * s), "head": [(X, 2 * s)]}))
        made.append(_clip(arm, "sit", keys))
    if "kick" in clips:
        out_ = {**grip(fwd=30, elbow=60), **legs(-95, 8), "hips": [(X, 14)], "chest": [(X, 4)], "head": [(X, -6)]}
        mid = {**grip(), **legs(-85, 80)}
        tuck = {**grip(fwd=55, elbow=85), **legs(-70, 125), "hips": [(X, -12)], "chest": [(X, -6)], "head": [(X, 6)]}
        made.append(_clip(arm, "kick", [(0, out_), (0.5, mid), (1.0, tuck)]))
    if "fly" in clips:
        keys = []
        for i in range(5):
            s = math.sin(i / 4 * 2 * math.pi)
            p = {"upper_arm.L": [(Y, up["L"] * 0.7), (X, -15 - 8 * s)], "upper_arm.R": [(Y, up["R"] * 0.7), (X, -15 + 8 * s)],
                 "forearm.L": [(X, -15)], "forearm.R": [(X, -15)], "head": [(X, -8)]}
            p.update({"thigh.L": [(X, -50 - 20 * s)], "thigh.R": [(X, -50 + 20 * s)],
                      "shin.L": [(X, 50 + 25 * s)], "shin.R": [(X, 50 - 25 * s)]})
            keys.append((i / 4 * 0.8, p))
        made.append(_clip(arm, "fly", keys))
    if "land" in clips:
        sitg = {"upper_arm.L": [(Y, down["L"] * 0.8), (X, 35)], "upper_arm.R": [(Y, -down["R"] * 0.8), (X, 35)],
                "forearm.L": [(X, -5)], "forearm.R": [(X, -5)], **legs(-80, 12, spread=4), "hips": [(X, 8)], "head": [(X, -4)]}
        made.append(_clip(arm, "land", [(0, {**grip(), **legs(-60, 60)}), (0.3, sitg), (0.6, sitg)]))
    print(f"[lab_rig] clips: {[a.name for a in made]}")
    return made


# ---------------------------------------------------------------- quadrupeds


def quadruped_landmarks(obj):
    """Measure the joints of a four-legged animal standing on all fours (front -Y, up Z, feet at z = 0) from its
    faces. Returns {name: Vector} in object space; legs are FL, FR (front), HL, HR (hind), L = +X."""
    vs = [obj.matrix_world @ v.co for v in obj.data.vertices]
    H = max(v.z for v in vs)
    ylo, yhi = min(v.y for v in vs), max(v.y for v in vs)
    Ly = yhi - ylo
    bins = 50
    # the y ranges each face covers per height band: the belly is the highest band with air between the front and
    # hind legs (a y gap in the middle of the body)
    spans = [[] for _ in range(bins)]
    for poly in obj.data.polygons:
        pts = [vs[i] for i in poly.vertices]
        lo_i = min(bins - 1, int(min(p.z for p in pts) / H * bins))
        hi_i = min(bins - 1, int(max(p.z for p in pts) / H * bins))
        for i in range(lo_i, hi_i + 1):
            spans[i].append((min(p.y for p in pts), max(p.y for p in pts)))

    def gap(i):  # the widest uncovered y interval in the band, as (start, end), or None
        ivs = sorted(spans[i])
        if not ivs:
            return None
        best, e = None, ivs[0][1]
        for lo, hi in ivs[1:]:
            if lo > e and (best is None or lo - e > best[1] - best[0]):
                best = (e, lo)
            e = max(e, hi)
        return best
    # from the feet up, while the gap lasts (higher up, the space between a raised head and the tail is a gap too)
    belly_i = 0
    for i in range(int(bins * 0.8)):
        g = gap(i)
        if g and g[1] - g[0] > 0.12 * Ly:
            belly_i = i
        elif belly_i or i > bins * 0.2:
            break
    if not belly_i:
        raise RuntimeError("rig_quadruped: no space between the front and hind legs; the animal must stand on four legs")
    belly = (belly_i + 1) / bins * H
    g = gap(max(0, belly_i // 2)) or gap(belly_i)
    mid_y = (g[0] + g[1]) / 2
    # the legs: vertices below the belly, in four groups by side and by front/hind of the gap
    out = {}
    feet = {}
    for leg, front in (("FL", True), ("FR", True), ("HL", False), ("HR", False)):
        sign = 1 if leg[1] == "L" else -1
        ps = [v for v in vs if v.z < belly * 0.9 and sign * v.x > 0 and ((v.y < mid_y) if front else (v.y > mid_y))]
        if not ps:
            raise RuntimeError(f"rig_quadruped: no {leg} leg found below the belly (z {belly:.2f})")
        low = [v for v in ps if v.z < 0.35 * belly] or ps
        x = sorted(sign * v.x for v in low)[len(low) // 2] * sign
        y = sorted(v.y for v in low)[len(low) // 2]
        feet[leg] = (x, y)
    top = [v for v in vs if abs(v.y - mid_y) < 0.1 * Ly]
    back_z = max(v.z for v in top) if top else H
    spine_z = belly + 0.55 * (back_z - belly)
    y_front = (feet["FL"][1] + feet["FR"][1]) / 2
    y_hind = (feet["HL"][1] + feet["HR"][1]) / 2
    for leg, (x, y) in feet.items():
        top_z = belly + 0.45 * (spine_z - belly)
        out[f"hip.{leg}"] = Vector((x * 0.85, y, top_z))
        out[f"knee.{leg}"] = Vector((x, y + (0.02 if leg[0] == "F" else -0.03) * Ly, 0.5 * belly))
        out[f"ankle.{leg}"] = Vector((x, y, 0.14 * belly))
        out[f"toe.{leg}"] = Vector((x, y - 0.06 * Ly, 0.02 * H))
    out["pelvis"] = Vector((0, y_hind, spine_z))
    out["withers"] = Vector((0, y_front, spine_z))
    out["spine_mid"] = Vector((0, (y_front + y_hind) / 2, spine_z))
    # head and neck: what sticks out in front of the front legs above the belly
    head = [v for v in vs if v.y < y_front - 0.08 * Ly and v.z > belly]
    if len(head) > 10:
        nose_y = min(v.y for v in head)
        front_half = [v for v in head if v.y < (nose_y + y_front) / 2] or head
        hc = sum(front_half, Vector()) / len(front_half)
        hz = max(hc.z, spine_z)
    else:  # no head forward of the legs (a squat animal): the head sits on top of the front
        nose_y, hz = ylo, max(spine_z, 0.8 * H)
        hc = Vector((0, ylo + 0.1 * Ly, hz))
    out["head"] = Vector((0, y_front + 0.55 * (hc.y - y_front), hz))
    out["nose"] = Vector((0, nose_y, hz))
    out["neck"] = Vector((0, y_front - 0.05 * Ly, spine_z + 0.25 * (hz - spine_z)))
    # tail: what sticks out behind the hind legs above half the belly height
    tail = [v for v in vs if v.y > y_hind + 0.1 * Ly and v.z > 0.5 * belly]
    if len(tail) > 5:
        tip = max(tail, key=lambda v: v.y)
        out["tail_base"] = Vector((0, y_hind + 0.06 * Ly, spine_z))
        out["tail_tip"] = Vector((0, tip.y, tip.z))
        out["tail_mid"] = out["tail_base"].lerp(out["tail_tip"], 0.5)
    out["top"] = Vector((0, 0, H))
    return out


def _quad_bones(lm):
    """bone: (head landmark, tail landmark, parent)."""
    b = {"root": (None, None, None), "hips": ("pelvis", "spine_mid", "root"), "chest": ("spine_mid", "withers", "hips"),
         "neck": ("withers", "head", "chest"), "head": ("head", "nose", "neck")}
    if "tail_base" in lm:
        b.update({"tail.1": ("tail_base", "tail_mid", "hips"), "tail.2": ("tail_mid", "tail_tip", "tail.1")})
    for leg in ("FL", "FR", "HL", "HR"):
        b.update({f"thigh.{leg}": (f"hip.{leg}", f"knee.{leg}", "chest" if leg[0] == "F" else "hips"),
                  f"shin.{leg}": (f"knee.{leg}", f"ankle.{leg}", f"thigh.{leg}"),
                  f"foot.{leg}": (f"ankle.{leg}", f"toe.{leg}", f"shin.{leg}")})
    return b


def rig_quadruped(obj, landmarks=None, name="Rig"):
    """Build a four-legged armature (root, hips, chest, neck, head, tail.1/2 if there is a tail, thigh/shin/foot per
    leg .FL .FR .HL .HR) from measured (or given) landmarks and skin `obj` to it like rig_biped: nearest bones, never
    across the centre line, the head rigid in front of the head joint. Returns the armature; ["landmarks"] = JSON."""
    lm = quadruped_landmarks(obj)
    lm.update({k: Vector(v) for k, v in (landmarks or {}).items()})
    print("[lab_rig] landmarks " + json.dumps({k: [round(c, 3) for c in v] for k, v in lm.items()}))
    bones = _quad_bones(lm)
    data = bpy.data.armatures.new(name)
    arm = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(arm)
    L.select_only(arm)
    bpy.ops.object.mode_set(mode="EDIT")
    H = lm["top"].z
    for bname, (h, t, parent) in bones.items():
        b = data.edit_bones.new(bname)
        if bname == "root":
            b.head, b.tail = Vector((0, 0, 0)), Vector((0, 0, 0.2 * H))
        else:
            b.head, b.tail = lm[h], lm[t]
        if parent:
            b.parent = data.edit_bones[parent]
            b.use_connect = (b.parent.tail - b.head).length < 1e-4
        b.use_deform = bname != "root"
        b.roll = 0.0
    bpy.ops.object.mode_set(mode="OBJECT")
    deform = [b for b in data.bones if b.use_deform]
    segs = {b.name: (b.head_local.copy(), b.tail_local.copy()) for b in deform}
    groups = {b.name: obj.vertex_groups.new(name=b.name) for b in deform}
    side_of = lambda n: n[-1] if "." in n and n[-2] in "FH" else None  # noqa: E731
    W = max(abs(v.co.x) for v in obj.data.vertices)
    for v in obj.data.vertices:
        p = obj.matrix_world @ v.co
        side = "L" if p.x > 0.02 * W else "R" if p.x < -0.02 * W else None
        cands = [(n, _segment_distance(p, *segs[n])) for n in segs if not (side and side_of(n) and side_of(n) != side)]
        # a leg bone only takes what is below its hip joint (plus a little): the flank above a thigh moves with the body
        cands = [(n, d) for n, d in cands if not (n.startswith("thigh.") and p.z > segs[n][0].z + 0.1 * H)]
        cands.sort(key=lambda c: c[1])
        best = cands[:2]
        if p.y <= lm["head"].y and p.z > 2 * lm["knee.FL"].z:  # the head is rigid: the jaw and ears must not bend with the neck
            best = [("head", 0.0)]
        ws = [1.0 / (d ** 4 + 1e-10) for _, d in best]
        total = sum(ws)
        for (n, _), w in zip(best, ws):
            if w / total > 0.05:
                groups[n].add([v.index], w / total, "REPLACE")
    mod = obj.modifiers.new("Armature", "ARMATURE")
    mod.object = arm
    obj.parent = arm
    arm["landmarks"] = json.dumps({k: list(v) for k, v in lm.items()})
    arm["head_top"] = H
    L._EXPORT_OPTS.update(export_animation_mode="NLA_TRACKS", export_skins=True, export_animations=True)
    return arm


# gaits: (period s, leg phases, thigh swing deg, knee lift deg, body bob as a share of the height, spine flex deg)
GAITS = {
    "walk": (1.0, {"HL": 0.0, "FL": 0.25, "HR": 0.5, "FR": 0.75}, 22, 40, 0.01, 0),
    "trot": (0.6, {"FL": 0.0, "HR": 0.0, "FR": 0.5, "HL": 0.5}, 30, 60, 0.025, 0),
    "gallop": (0.45, {"HL": 0.0, "HR": 0.1, "FL": 0.45, "FR": 0.55}, 42, 80, 0.05, 8),
}


def add_quadruped_clips(arm, clips=("idle", "walk", "trot", "gallop")):
    """In-place loops for a rig_quadruped animal (the game moves it): idle (2 s: breathing, a look around, a tail
    wag), walk (1 s, one foot at a time), trot (0.6 s, diagonal pairs), gallop (0.45 s, a bounding gait with the
    spine flexing). Match the clip to the speed with play(name, { timeScale })."""
    X, Z = (1, 0, 0), (0, 0, 1)
    H = arm["head_top"]
    has_tail = "tail.1" in arm.data.bones

    def tail(a):
        return {"tail.1": [(Z, a)], "tail.2": [(Z, a * 1.5)]} if has_tail else {}

    made = []
    if "idle" in clips:
        keys = []
        for i in range(5):
            s = math.sin(i / 4 * 2 * math.pi)
            c = math.cos(i / 4 * 2 * math.pi)
            keys.append((i / 4 * 2.0, {"chest": [(X, 1.5 * s)], "neck": [(Z, 8 * s), (X, -3 * c)], "head": [(X, 4 * c)],
                                       **tail(15 * s), "root_z": 0.004 * H * s}))
        made.append(_clip(arm, "idle", keys))
    for name, (period, phases, swing, knee, bob, flex) in GAITS.items():
        if name not in clips:
            continue
        keys = []
        for i in range(9):  # 8 segments, the last key = the first: a seamless loop
            t = i / 8
            p = {}
            for leg, ph in phases.items():
                a = 2 * math.pi * (t + ph)
                p[f"thigh.{leg}"] = [(X, -swing * math.sin(a))]  # negative = forward
                p[f"shin.{leg}"] = [(X, knee * max(0.0, math.sin(a + math.pi / 2)))]
                p[f"foot.{leg}"] = [(X, -0.4 * knee * max(0.0, math.sin(a + math.pi / 2)))]
            s2 = math.sin(2 * math.pi * 2 * t)
            p["hips"] = [(X, flex * math.sin(2 * math.pi * t))]
            p["chest"] = [(X, -flex * math.sin(2 * math.pi * t))]
            p["neck"] = [(X, 3 * s2 + flex * 0.5 * math.sin(2 * math.pi * t))]
            p.update(tail(10 * math.sin(2 * math.pi * t)))
            p["root_z"] = bob * H * (abs(s2) if not flex else math.sin(2 * math.pi * t))
            keys.append((t * period, p))
        made.append(_clip(arm, name, keys))
    print(f"[lab_rig] clips: {[a.name for a in made]}")
    return made


# ---------------------------------------------------------------- rigid parts: wheels and rotors
# Vehicles and machines need no skeleton: each moving part becomes its own node with its origin on its axis, and the
# game turns it (engine/animation.ts createParts). Custom properties become glTF extras -> three.js userData.


def rig_root(obj):
    """The empty that holds `obj` and its moving parts. The first call creates it with obj's name and transform and
    renames the mesh to <name>Body: a mesh node with child nodes would be split up by the release's meshopt step."""
    if obj.parent and obj.parent.type == "EMPTY" and obj.name == obj.parent.name + "Body":
        return obj.parent
    name = obj.name
    root = bpy.data.objects.new(name + "_root", None)
    bpy.context.scene.collection.objects.link(root)
    root.matrix_world = obj.matrix_world.copy()
    obj.name = name + "Body"
    root.name = name
    obj.parent = root
    obj.matrix_parent_inverse = mathutils.Matrix.Identity(4)
    obj.location, obj.rotation_euler, obj.scale = (0, 0, 0), (0, 0, 0), (1, 1, 1)
    return root


def split_part(obj, name, inside, pivot, props=None):
    """Move the faces of `obj` whose vertices all pass `inside(co)` (object space) into a new mesh `<name>_mesh` under
    an empty `name` at `pivot` (object space), a sibling of `obj` under rig_root(obj): the game turns the empty.
    Faces that straddle the boundary stay on `obj`. `props` become custom properties (glTF extras) of the empty.
    Returns the empty."""
    import bmesh
    root = rig_root(obj)
    me = obj.data
    pts = [v.co.copy() for v in me.vertices]
    ok = [inside(p) for p in pts]
    sel = [all(ok[i] for i in poly.vertices) for poly in me.polygons]
    if not any(sel):
        raise RuntimeError(f"split_part {name}: no faces inside the region")
    part = obj.copy()
    part.data = me.copy()
    part.modifiers.clear()
    for k in list(part.keys()):
        del part[k]
    part.name = name + "_mesh"
    bpy.context.scene.collection.objects.link(part)
    for target, keep in ((part, True), (obj, False)):
        bm = bmesh.new()
        bm.from_mesh(target.data)
        bm.faces.ensure_lookup_table()
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if sel[f.index] != keep], context="FACES")
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
        bm.to_mesh(target.data)
        bm.free()
    pivot = Vector(pivot)
    part.data.transform(mathutils.Matrix.Translation(-pivot))
    # the turning node is an empty on the axis, the mesh its child: the release's meshopt quantization rewrites a
    # mesh node's transform (it moved a wheel's pivot 1 cm off the hub), but never an empty's
    hub = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(hub)
    for child, parent, at in ((hub, root, pivot), (part, hub, Vector())):
        child.parent = parent
        child.matrix_parent_inverse = mathutils.Matrix.Identity(4)
        child.location, child.rotation_euler, child.scale = at, (0, 0, 0), (1, 1, 1)
    for k, v in (props or {}).items():
        hub[k] = v
    print(f"[lab_rig] part {name}: {len(part.data.polygons)} faces, pivot {tuple(round(c, 3) for c in pivot)}")
    return hub


def _contact_patches(vs, ground, H, cell):
    """Groups of vertices touching the ground (z within 2% of the height), joined over neighbouring grid cells."""
    cells = {}
    for v in vs:
        if v.z < ground + 0.02 * H:
            cells.setdefault((math.floor(v.x / cell), math.floor(v.y / cell)), []).append(v)
    seen, patches = set(), []
    for start in cells:
        if start in seen:
            continue
        stack, group = [start], []
        seen.add(start)
        while stack:
            c = stack.pop()
            group.extend(cells[c])
            for dx in (-2, -1, 0, 1, 2):  # 2 cells: tread grooves must not split one tyre into two patches
                for dy in (-2, -1, 0, 1, 2):
                    n = (c[0] + dx, c[1] + dy)
                    if n in cells and n not in seen:
                        seen.add(n)
                        stack.append(n)
        if len(group) >= 3:
            patches.append(group)
    # tread blocks of one tyre can touch the ground further apart than the 2-cell join: merge boxes closer than 3%
    gap = 0.05 * cell / 0.015
    box = lambda g: (min(v.x for v in g), max(v.x for v in g), min(v.y for v in g), max(v.y for v in g))  # noqa: E731
    merged = True
    while merged:
        merged = False
        for i in range(len(patches)):
            for j in range(i + 1, len(patches)):
                a, b = box(patches[i]), box(patches[j])
                if a[0] - gap <= b[1] and b[0] - gap <= a[1] and a[2] - gap <= b[3] and b[2] - gap <= a[3] and (a[0] < 0) == (b[0] < 0):
                    patches[i] += patches.pop(j)
                    merged = True
                    break
            if merged:
                break
    return patches


def _fit_wheel(vs, edges, x0, x1, yc0, ground, H, L):
    """Fit the circle of a tyre touching the ground from the mesh's bottom profile (lowest point per slice along Y)
    in the tyre's x range: (y - yc)^2 + (z - r)^2 = r^2 with the hub at height r. Returns (yc, r) or None."""
    import numpy as np
    step = 0.012 * L
    prof = {}
    # sample along the edges, not only the vertices: one long flat tread face can span a slice with no vertex in it
    for i, j in edges:
        a, b = vs[i], vs[j]
        n = 1 + int(abs(b.y - a.y) / step * 2)
        for k in range(n + 1):
            p = a.lerp(b, k / n)
            if x0 <= p.x <= x1:
                s = math.floor((p.y - yc0) / step)
                z = p.z - ground
                if z < prof.get(s, 1e9):
                    prof[s] = z
    pts = []
    for d in (1, -1):  # walk out from the contact while the profile keeps rising (the arch or a step ends it)
        b, last, gaps = 0 if d == 1 else -1, -1.0, 0
        while abs(b) < 1 / 0.012 and gaps <= 3:
            if b not in prof:
                gaps += 1
            else:
                z = prof[b]
                if z < last - 0.01 * H or z > 0.6 * H:
                    break
                last = max(last, z)
                pts.append((yc0 + (b + 0.5) * step, z))
                gaps = 0
            b += d
    # least squares on y^2 + z^2 = 2y*yc - c + 2z*r, then drop the worst point until all sit on the circle: the
    # profile may run on into a flat underside or a step at hub height, which is not the tyre
    while True:
        if len(pts) < 5:
            return None
        A = np.array([[2 * y, -1.0, 2 * z] for y, z in pts])
        rhs = np.array([y * y + z * z for y, z in pts])
        yc, _, r = (float(x) for x in np.linalg.lstsq(A, rhs, rcond=None)[0])
        if r <= 0:
            return None
        res = [abs(math.hypot(y - yc, z - r) - r) if z <= r else r for y, z in pts]
        worst = max(range(len(pts)), key=lambda i: res[i])
        if res[worst] <= 0.03 * r:
            break
        pts.pop(worst)
    # a tyre: the arc rises on both sides of the contact (a blade or a step doesn't)
    reach = (min(y for y, _ in pts) - yc, max(y for y, _ in pts) - yc)
    if reach[0] > -0.35 * r or reach[1] < 0.35 * r:
        return None
    return float(yc), float(r)


def find_wheels(obj):
    """Measure the wheels of a vehicle (lab conventions: front -Y, up Z, wheels on the ground at the lowest point):
    returns [{"name", "center", "radius", "width"}] in object space. Wheels are the parts touching the ground that
    don't straddle the centre line (a plough blade or a skid does), with a circle fitted to each tyre's profile."""
    vs = [v.co.copy() for v in obj.data.vertices]
    edges = [tuple(e.vertices) for e in obj.data.edges]
    lo = Vector((min(v.x for v in vs), min(v.y for v in vs), min(v.z for v in vs)))
    hi = Vector((max(v.x for v in vs), max(v.y for v in vs), max(v.z for v in vs)))
    W, L, H = hi.x - lo.x, hi.y - lo.y, hi.z - lo.z
    wheels = []
    for patch in _contact_patches(vs, lo.z, H, 0.015 * max(W, L)):
        x0, x1 = min(v.x for v in patch), max(v.x for v in patch)
        if x0 < 0 < x1 and x1 - x0 > 0.25 * W:  # a blade, skid or bumper across the middle
            continue
        yc0 = sum(v.y for v in patch) / len(patch)
        fit = _fit_wheel(vs, edges, x0, x1, yc0, lo.z, H, L)
        if not fit or not (0.04 * H < fit[1] < 0.6 * H):
            print(f"[lab_rig] find_wheels: skipped a ground contact at x {x0:.2f}..{x1:.2f} y {yc0:.2f} (no tyre arc)")
            continue
        yc, r = fit
        if yc - r < lo.y - 0.02 * L or yc + r > hi.y + 0.02 * L:
            continue
        wheels.append({"center": Vector(((x0 + x1) / 2, yc, lo.z + r)), "radius": r, "width": x1 - x0})
    if not wheels:
        raise RuntimeError("find_wheels: no wheels found; pass rig_vehicle(obj, wheels=[...]) by hand")
    # axles front (-Y) to back; a wheel within 15% of the length of the axle's first wheel shares it
    wheels.sort(key=lambda w: w["center"].y)
    axles = []
    for w in wheels:
        if axles and abs(w["center"].y - axles[-1][0]["center"].y) < 0.15 * L:
            axles[-1].append(w)
        else:
            axles.append([w])
    tags = {1: ["F"], 2: ["F", "R"], 3: ["F", "M", "R"]}.get(len(axles)) or [str(i) for i in range(len(axles))]
    for tag, axle in zip(tags, axles):
        for w in axle:
            side = "C" if abs(w["center"].x) < 0.05 * W else "L" if w["center"].x > 0 else "R"
            w["name"] = f"wheel.{tag}{side}"
    return wheels


def rig_vehicle(obj, wheels=None, steer=("F",)):
    """Cut each wheel out of `obj` into its own node `wheel.<axle><side>` (axles F/R or F/M/R front to back, sides
    L = +X / R / C = centre; e.g. wheel.FL), origin on the hub, with extras `wheel_radius` (m) and `steer` (1 on
    the axles in `steer`). The game rolls and steers them with createParts (engine/animation.ts). The vehicle becomes
    an empty with obj's name holding <name>Body and the wheels (rig_root); the GLB's top node keeps the name.
    wheels: None to measure them (find_wheels; the printed list is the place to start a fix), or
    [{"name", "center": (x, y, z), "radius", "width"}] in object space. Returns the wheel objects."""
    if wheels is None:
        wheels = find_wheels(obj)
    print("[lab_rig] wheels " + json.dumps([{"name": w["name"], "center": [round(c, 3) for c in w["center"]],
                                             "radius": round(w["radius"], 3), "width": round(w["width"], 3)} for w in wheels]))
    out = []
    for w in wheels:
        c, r, hw = Vector(w["center"]), w["radius"], w["width"] / 2
        # rounded sidewalls and hub caps reach past the tread that touches the ground: more outwards than inwards
        side = 0 if w["name"].endswith("C") else 1 if c.x > 0 else -1
        a, b = c.x - hw * (1.3 + 0.3 * side), c.x + hw * (1.3 + 0.3 * side)
        a, b = (c.x - hw * 1.2, c.x + hw * 1.6) if side > 0 else (c.x - hw * 1.6, c.x + hw * 1.2) if side < 0 else (a, b)
        inside = lambda p, c=c, r=r, a=a, b=b: a <= p.x <= b and (p.y - c.y) ** 2 + (p.z - c.z) ** 2 <= (r * 1.04) ** 2  # noqa: E731
        axle = w["name"][len("wheel."):-1]
        out.append(split_part(obj, w["name"], inside, c, {"wheel_radius": r, "steer": 1 if axle in steer else 0}))
    return out


def rig_rotor(obj, name, center, axis="Y", radius=None, depth=None):
    """Cut a spinning part (propeller, fan, windmill sails, rotor blades, a saw) out of `obj` into its own node
    `name` with its origin at `center` (world space, metres). It takes the faces inside a disc of `radius` around it,
    `depth` thick along `axis` ("X", "Y" or "Z" in Blender; "Y" = the front-back axis, "Z" = up for a helicopter).
    Extras: `spin_axis` (the glTF axis: Blender X/Y/Z = three.js x / -z / y). createParts spins it."""
    c = obj.matrix_world.inverted() @ Vector(center)  # L.join keeps the first part's origin: object space differs
    i = "XYZ".index(axis)
    r = radius or 1e9
    d = (depth or 1e9) / 2

    def inside(p):
        q = p - c
        radial = sum(q[k] ** 2 for k in range(3) if k != i)
        return abs(q[i]) <= d and radial <= r * r
    gl = {"X": [1, 0, 0], "Y": [0, 0, -1], "Z": [0, 1, 0]}[axis]
    return split_part(obj, name, inside, c, {"spin_axis": gl})


# ---------------------------------------------------------------- review


def _render_tile(tile):
    """Render the scene camera to a tile x tile RGBA float array."""
    import numpy as np
    scene = bpy.context.scene
    bpy.ops.render.render(write_still=True)
    img = bpy.data.images.load(scene.render.filepath, check_existing=False)
    px = np.empty(tile * tile * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    bpy.data.images.remove(img)
    return px.reshape(tile, tile, 4)


def _save_sheet(rows, path):
    """Write rows of tiles (top row first) as one PNG, and remove the render's temp file and the lights."""
    import numpy as np
    scene = bpy.context.scene
    os.remove(scene.render.filepath)
    sheet = np.concatenate([np.concatenate(r, axis=1) for r in rows][::-1], axis=0)  # Blender rows start at the bottom
    img = bpy.data.images.new("sheet", sheet.shape[1], sheet.shape[0], alpha=True)
    img.pixels.foreach_set(sheet.ravel())
    img.filepath_raw = os.path.abspath(path)
    img.file_format = "PNG"
    img.save()
    bpy.data.images.remove(img)
    for o in [o for o in scene.objects if o.type == "LIGHT"]:
        bpy.data.objects.remove(o, do_unlink=True)


def render_parts_sheet(obj, path, tile=256, style=None):
    """Review sheet for rig_vehicle / rig_rotor: top row from the front three-quarter, bottom row from the side, 4
    columns with the parts turned further each time (wheels rolled 0/60/120/180 degrees, steering 0/+25/0/-25,
    rotors 0/30/60/90). The cut must be clean: no body faces turning with a wheel, no tyre left on the body."""
    style = style or L.load_style()
    root = rig_root(obj) if obj.type == "MESH" else obj
    parts = [o for o in root.children if "wheel_radius" in o or "spin_axis" in o]
    obj = next(o for o in root.children if o.name == root.name + "Body")
    if not parts:
        raise RuntimeError("render_parts_sheet: no wheels or rotors on the object (rig_vehicle / rig_rotor first)")
    L.setup_lighting(style)
    L.configure_render(path + ".tile.png", (tile, tile))
    rows = []
    for yaw, pitch in ((-35, 20), (-90, 5)):
        cam = L.setup_camera([obj, *[p.children[0] for p in parts]], yaw_deg=yaw, pitch_deg=pitch, margin=1.05)
        cols = []
        for k in range(4):
            for p in parts:
                p.rotation_mode = "XYZ"
                if "wheel_radius" in p:  # rolling forward (-Y) is +X; steering left is +Z
                    p.rotation_euler = (math.radians(60 * k), 0, math.radians((0, 25, 0, -25)[k]) if p["steer"] else 0)
                else:
                    ax = list(p["spin_axis"])
                    p.rotation_euler = [math.radians(30 * k) * c for c in (ax[0], -ax[2], ax[1])]  # glTF -> Blender axes
            cols.append(_render_tile(tile))
        rows.append(cols)
        bpy.data.objects.remove(cam, do_unlink=True)
    for p in parts:
        p.rotation_euler = (0, 0, 0)
    _save_sheet(rows, path)
    print(f"[lab_rig] parts sheet {path} ({[p.name for p in parts]})")


def render_pose_sheet(arm, path, frames_per_clip=4, tile=256, style=None):
    """Render each clip at evenly spaced frames from a 3/4 front view: one row per clip. Look at it before using
    the character: limbs must bend at the joints, nothing may tear or stretch across the body."""
    style = style or L.load_style()
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH" and o.parent == arm]
    tracks = list(arm.animation_data.nla_tracks)
    for tr in tracks:
        tr.mute = True
    L.setup_lighting(style)
    H = arm["head_top"] if "head_top" in arm else json.loads(arm["landmarks"])["head_top"][2]
    ys = [(m.matrix_world @ v.co).y for m in meshes for v in m.data.vertices]
    size = max(H, 0.95 * (max(ys) - min(ys)))  # a long animal is framed by its length
    # frame the body's height (or length), not the rest pose's arm span; side-on enough to see limbs swing
    cam = L.setup_camera(meshes, yaw_deg=-55, pitch_deg=12, target=Vector((0, (max(ys) + min(ys)) / 2, H * 0.5)), distance=size * 0.62 / math.sin(math.radians(20)))
    L.configure_render(path + ".tile.png", (tile, tile))
    scene = bpy.context.scene
    rows = []
    for tr in tracks:
        strip = tr.strips[0]
        tr.mute = False
        cols = []
        for k in range(frames_per_clip):
            f = strip.frame_start + (strip.frame_end - strip.frame_start) * k / frames_per_clip
            scene.frame_set(int(round(f)))
            cols.append(_render_tile(tile))
        tr.mute = True
        rows.append(cols)
    for tr in tracks:
        tr.mute = False
    _save_sheet(rows, path)
    bpy.data.objects.remove(cam, do_unlink=True)
    scene.frame_set(1)
    print(f"[lab_rig] pose sheet {path} (rows: {[t.name for t in tracks]})")
