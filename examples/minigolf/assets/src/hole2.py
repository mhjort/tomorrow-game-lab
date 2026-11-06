"""Hole 2 — 'Snowdrift Dogleg' (par 3, snow): L-shaped lane turning right, like the key art."""
import os, sys; sys.path.insert(0, os.path.dirname(__file__))  # noqa: E401
import lab_bpy as L
from _course import Course

L.reset_scene()
style = L.load_style(theme="snow")
c = Course("hole2", style)
c.turf_rect(-0.6, -2.5, 0.6, 2.5)
c.turf_rect(-0.6, 2.5, 3.4, 3.7)
c.rails([(-0.6, -2.5), (0.6, -2.5), (0.6, 2.5), (3.4, 2.5), (3.4, 3.7), (-0.6, 3.7)])
c.trim_blocks([(-0.65, -1.8 + i * 1.1) for i in range(5)])
c.block("Bumper", 1.0, 3.1, 0.2, 0.5)
c.cup(2.9, 3.1)
c.tee(0.0, -2.0)
c.finish_turf()
c.island(1.2, 0.8, 5.2, "snow", seed=22, pond=(2.6, -0.8, 0.9))
L.finish(__file__, style, {"yaw_deg": -25, "pitch_deg": 42})
