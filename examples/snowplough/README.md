# Little Plough

Clear the snowed-in streets of a toy village so every villager can walk from their door to the lantern square before the 18:00 festival.

The lab's **video-first** proof. The art bible, camera, avatar and core verb come from a generated gameplay video (`design/reference/gameplay.mp4`, MiniMax H3 Max). Read `design/brief.md` for the gameplay read and the rules. The assets:
- **plough:** generated (key-art frame → reference image → Tripo image-to-3D), imported, oriented and sized in Blender (`assets/src/plough.py`).
- **villager:** generated from a full-resolution crop of the video (`design/reference/crops/`), in an A-pose, then auto-rigged and animated in Blender (`assets/src/villager.py`, `lab_rig`). The game recolours its texture into 5 outfits (`src/outfits.js`), like the crowd in the video.
- **village:** a Blender script that builds houses, lamps, pines, fences and the square from `src/village.json`.
- **snow:** a deformable heightfield in the game (`src/snow.js`), with warm lamp pools painted into its vertex colours.
- **music, sounds, splash and icon:** `design/media.json`, locked in `assets/media.lock.json`.

```bash
pnpm dev            # play at http://localhost:5173/ (?time=60 for a shorter clock)
pnpm assets         # rebuild the GLBs (Blender 5.2)
pnpm media          # regenerate media (needs RUNWARE_API_KEY; locked entries are free)
pnpm release        # optimized build in dist/
```

**Controls:** ↑/W drive · ↓/S brake, then reverse · ←/→ steer · or drag anywhere like a joystick · C camera · R restart · M sound.

Generated media for this game cost about $1.22 (`assets/media.lock.json`): video $0.34, two 3D models $0.60, two reference images $0.07, splash, icon, sounds and music $0.21.
