"""Hole 1 — "Beach Break" (par 2, beach): straight lane, cup at the far end."""
import os, sys; sys.path.insert(0, os.path.dirname(__file__))  # noqa: E401
import lab_bpy as L
from _course import Course

L.reset_scene()
style = L.load_style(theme="beach")
c = Course("hole1", style)
c.turf_rect(-0.6, -3.0, 0.6, 3.0)
c.rails([(-0.6, -3.0), (0.6, -3.0), (0.6, 3.0), (-0.6, 3.0)])
c.trim_blocks([(-0.65, -2.0), (-0.65, 0.0), (-0.65, 2.0), (0.65, -1.0), (0.65, 1.0)])
c.cup(0.0, 2.3)
c.tee(0.0, -2.4)
c.finish_turf()
c.island(0.3, 0.0, 5.0, "beach", seed=11, pond=(2.6, -1.2, 0.8))
L.finish(__file__, style, {"yaw_deg": -30, "pitch_deg": 40})
