"""Snowplough (player vehicle), from the generated GLB (generate-media models.plough, made from crops/plough.png):
a boxy orange cab with dark windows, red tail lights, an exhaust stack, big tyres and a wide curved yellow-orange
mouldboard on push arms. 3.6 m long including the blade, front = -Y. The blade is widened to the 2.6 m the game clears.
The earlier model's blade was a flat plate that read as a spoiler; it was cut off and replaced with a modelled one.
This model has the crop's blade, so it is imported as it is."""
import os, sys; sys.path.insert(0, os.path.dirname(__file__))  # noqa: E401
import lab_bpy as L

L.reset_scene()
style = L.load_style()
body = L.import_glb("assets/generated/plough.glb", "Plough", forward="-X", length=3.6, max_texture=1024)
front = min(v.co.y for v in body.data.vertices)
# the generated blade is 2.25 m; the game clears a 2.6 m lane (src/plough.js), so widen the blade to match what the
# player sees being cleared: full stretch on the blade, easing to none over 15 cm behind it (the push arms)
BLADE_DEPTH, STRETCH = 0.45, 2.6 / 2.25 - 1
for v in body.data.vertices:
    t = (front + BLADE_DEPTH - v.co.y) / 0.15
    if t > 0:
        v.co.x *= 1 + STRETCH * min(1.0, t)
xs = [v.co.x for v in body.data.vertices if v.co.y < front + 0.5]
print(f"[lab_bpy] plough blade width {max(xs) - min(xs):.2f} m (the game clears 2.6 m: src/plough.js)")
L.finish(__file__, style)
