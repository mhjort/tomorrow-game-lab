"""Villager (NPC), generated model (generate-media models.villager), rigged and animated in Blender. 1.1 m tall.
One GLB, one outfit (red coat, brown hair): the game recolours its texture into the crowd's five outfits at load
(src/outfits.js), so there is no per-outfit asset here."""
import os, sys; sys.path.insert(0, os.path.dirname(__file__))  # noqa: E401
import lab_bpy as L, lab_rig as R  # noqa: E401

L.reset_scene()
body = L.import_glb("assets/generated/villager.glb", "Villager", forward="+X", height=1.1, max_tris=6000, max_texture=512)
rig = R.rig_biped(body)
R.add_biped_clips(rig)
R.render_pose_sheet(rig, ".lab/previews/villager-poses.png")
L.finish(__file__)
