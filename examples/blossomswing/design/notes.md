# Iteration notes (no judge reads this)

## Round 1 → 2
- Orchard trees read as "twig bundles with no trunk": measured, not buried (markers sit 5 cm under the raycast
  ground) but hidden: the rows stood on the near side of the valley, whose convex bulge hid the trunks from the
  hilltop. Moved the rows onto the slopes that face the camera.
- Props were placed on the smooth height function h(); the valley mesh is linear between grid points and differs on
  slopes, so everything is now placed by raycasting the mesh (BVH).
- The pond was a disc cutting the coarse grid (straight edges): now an oval basin in the terrain; the waterline is a
  contour of it. Pebbles are marched out to where the ground rises over the water.
- Palette: grass desaturated (#9cb446 → #9aae58), hillMid back toward the measured sage (#8db58a), fog 25–230,
  ambient 1.85, trunk/rope emissive fill (their shade side crushed to near-black).
- Camera pulled back to 4.8 m and 0.6 m right: the trunk filled 15% of the frame.
