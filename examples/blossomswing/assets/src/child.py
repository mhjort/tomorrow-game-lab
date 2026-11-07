"""The child (player), generated model (generate-media models.child), rigged and animated in Blender.
1.2 m tall standing (the video's child is ~1/4 of the frame height, art bible scale; big head ~0.4 of the height, crops/child.png). Clips: idle (the title card)
+ sit / kick / fly / land (lab_rig add_seated_clips). The game puts the hips bone on the swing seat."""
import os, sys; sys.path.insert(0, os.path.dirname(__file__))  # noqa: E401
import lab_bpy as L, lab_rig as R  # noqa: E401

L.reset_scene()
body = L.import_glb("assets/generated/child.glb", "Child", forward="+X", height=1.2, max_tris=8000, max_texture=512)
body.active_material.name = "child"  # stable name instead of the provider's uuid
# measured from the mesh's height bands: the A-line coat hides the crotch and the T-pose arms sit level with the
# coat's shoulders, so the auto landmarks put the hips at the ankles and the shoulders on the centre line
LM = {"hips": (0, 0, 0.22), "chest": (0, 0, 0.4), "neck": (0, 0, 0.53), "head_top": (0, 0, 1.0), "head_side": (0.25, 0, 0.75)}
for side, sx in (("L", 1), ("R", -1)):
    LM.update({f"shoulder.{side}": (0.17 * sx, -0.02, 0.48), f"elbow.{side}": (0.26 * sx, -0.02, 0.48),
               f"wrist.{side}": (0.33 * sx, -0.02, 0.48), f"hand.{side}": (0.36 * sx, -0.02, 0.48),
               f"hip.{side}": (0.065 * sx, 0, 0.2), f"knee.{side}": (0.065 * sx, -0.01, 0.11),
               f"ankle.{side}": (0.065 * sx, 0, 0.045), f"toe.{side}": (0.065 * sx, -0.1, 0.02)})
LM = {k: tuple(c * 1.2 for c in v) for k, v in LM.items()}  # measured on the 1.0 m import
rig = R.rig_biped(body, landmarks=LM)
R.add_biped_clips(rig, clips=("idle",))
R.add_seated_clips(rig)
R.render_pose_sheet(rig, ".lab/previews/child-poses.png")
L.finish(__file__)
