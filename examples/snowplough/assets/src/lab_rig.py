"""lab_rig — automatic rigging + procedural animation clips for characters, in headless Blender (5.2 LTS+).

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


# ---------------------------------------------------------------- review


def render_pose_sheet(arm, path, frames_per_clip=4, tile=256, style=None):
    """Render each clip at evenly spaced frames from a 3/4 front view: one row per clip. Look at it before using
    the character: limbs must bend at the joints, nothing may tear or stretch across the body."""
    import numpy as np

    style = style or L.load_style()
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH" and o.parent == arm]
    tracks = list(arm.animation_data.nla_tracks)
    for tr in tracks:
        tr.mute = True
    L.setup_lighting(style)
    H = json.loads(arm["landmarks"])["head_top"][2]
    # frame the body's height, not the rest pose's arm span; side-on enough to see limbs swing
    cam = L.setup_camera(meshes, yaw_deg=-55, pitch_deg=12, target=Vector((0, 0, H * 0.5)), distance=H * 0.62 / math.sin(math.radians(20)))
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
            bpy.ops.render.render(write_still=True)
            img = bpy.data.images.load(scene.render.filepath, check_existing=False)
            px = np.empty(tile * tile * 4, dtype=np.float32)
            img.pixels.foreach_get(px)
            cols.append(px.reshape(tile, tile, 4))
            bpy.data.images.remove(img)
        tr.mute = True
        rows.append(np.concatenate(cols, axis=1))
    for tr in tracks:
        tr.mute = False
    os.remove(scene.render.filepath)
    sheet = np.concatenate(rows[::-1], axis=0)  # Blender rows start at the bottom
    img = bpy.data.images.new("poses", sheet.shape[1], sheet.shape[0], alpha=True)
    img.pixels.foreach_set(sheet.ravel())
    img.filepath_raw = os.path.abspath(path)
    img.file_format = "PNG"
    img.save()
    bpy.data.objects.remove(cam, do_unlink=True)
    for o in [o for o in scene.objects if o.type == "LIGHT"]:
        bpy.data.objects.remove(o, do_unlink=True)
    scene.frame_set(1)
    print(f"[lab_rig] pose sheet {path} (rows: {[t.name for t in tracks]})")
