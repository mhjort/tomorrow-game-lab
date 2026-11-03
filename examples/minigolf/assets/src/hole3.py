"""Hole 3 — 'The Climb' (par 3): flat run-up, ramp, raised green with a guard block."""
import os, sys; sys.path.insert(0, os.path.dirname(__file__))  # noqa: E401
import lab_bpy as L
from _course import Course

RAMP_Y0, RAMP_Y1, TOP = 0.0, 1.6, 0.16


def height(x, y):
    if y <= RAMP_Y0:
        return 0.0
    if y >= RAMP_Y1:
        return TOP
    return TOP * (y - RAMP_Y0) / (RAMP_Y1 - RAMP_Y0)


L.reset_scene()
style = L.load_style()
c = Course("hole3", style, height)
c.turf_rect(-0.6, -3.0, 0.6, RAMP_Y0)
c.turf_rect(-0.6, RAMP_Y0, 0.6, RAMP_Y1)
c.turf_rect(-1.0, RAMP_Y1, 1.0, 3.8)
c.rails([(-0.6, -3.0), (0.6, -3.0), (0.6, RAMP_Y1), (1.0, RAMP_Y1), (1.0, 3.8), (-1.0, 3.8), (-1.0, RAMP_Y1), (-0.6, RAMP_Y1)],
        breaks_y=(RAMP_Y0,))
c.trim_blocks([(-0.65, -2.2), (-0.65, -0.8), (0.65, -1.5)])
c.block("Guard", 0.0, 2.4, 0.6, 0.15)
c.cup(0.0, 3.2)
c.tee(0.0, -2.4)
c.finish_turf()
c.island(0.0, 0.4, 5.0, seed=33, pond=(-2.6, -1.0, 0.8))
L.finish(__file__, style, {"yaw_deg": 30, "pitch_deg": 38})
