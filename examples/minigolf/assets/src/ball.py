"""Golf ball (radius 0.05 m — oversized for readability). Physics body is created in code."""
import os, sys; sys.path.insert(0, os.path.dirname(__file__))  # noqa: E401
import lab_bpy as L

L.reset_scene()
style = L.load_style()
L.sphere("Ball", 0.05, (0, 0, 0), subdivisions=2, mat=L.material("Ball", L.color("ball", style), roughness=0.35))
L.finish(__file__, style)
