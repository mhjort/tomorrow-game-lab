# Blossom Swing

An original game made with the lab's video-first path: the lab generated its own gameplay video
(`design/reference/gameplay.mp4`, MiniMax H3 via `generate-media`) from a one-line pitch, read it with
`key-art-direction`, and built the game to look like it. Every asset is the lab's: a generated child model rigged in
Blender (`lab_rig.add_seated_clips`), Blender-scripted hill, tree, valley and orchard, generated sound and music.

**Controls:** Space (or ↑ / W / Enter, or tap) = kick · M mute · any key starts.

Kick as the swing passes the bottom: one kick per half-swing, and the closer to the bottom the stronger. Every high
forward swing blows petals over the valley, and a high enough one makes the next row of the orchard bloom. When the
whole valley is pink, let go on the upswing (~20° is best) and see how far you fly.

Deep links: `?skip` (straight to play), `?rows=N` (start with N rows in bloom; `?rows=5` is ready to leap).

```bash
pnpm dev            # play
pnpm media          # regenerate media (needs RUNWARE_API_KEY; locked files are reused)
pnpm assets         # rebuild the GLBs in Blender
node ../../skills/game-judge/scripts/playtest.ts
```
Design: `design/brief.md` (rules, additions to the video), `design/art-bible.md`, `design/reference/inventory.md`.
