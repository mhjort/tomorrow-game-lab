"""Hole 4 — 'Downtown Chicane' (par 3, city): straight lane with two staggered blocks to weave through."""
import os, sys; sys.path.insert(0, os.path.dirname(__file__))  # noqa: E401
import lab_bpy as L
from _course import Course

L.reset_scene()
style = L.load_style(theme="city")
c = Course("hole4", style)
c.turf_rect(-0.7, -3.0, 0.7, 3.0)
c.rails([(-0.7, -3.0), (0.7, -3.0), (0.7, 3.0), (-0.7, 3.0)])
c.trim_blocks([(-0.75, -2.0), (-0.75, 0.0), (-0.75, 2.0), (0.75, -1.0), (0.75, 1.0)])
c.block("BlockA", -0.35, -1.0, 0.7, 0.2)  # closes the left half: go right first
c.block("BlockB", 0.35, 1.0, 0.7, 0.2)  # closes the right half: then cut back left
c.cup(0.0, 2.3)
c.tee(0.0, -2.4)
c.finish_turf()
c.island(0.0, 0.0, 5.0, "city", seed=44, pond=(2.6, 1.4, 0.7))
L.finish(__file__, style, {"yaw_deg": -30, "pitch_deg": 40})
