# Rapier 2D variant

Use 2D physics for side-scrollers, top-down games and pinball. The rendering stays three.js; use an orthographic camera or a fixed perspective camera.

```bash
npm rm @dimforge/rapier3d && npm i @dimforge/rapier2d
```

Changes to `src/engine/physics.ts`:
- `await import('@dimforge/rapier2d')` (same dynamic-import pattern as the 3D wrapper)
- Gravity becomes `{ x: 0, y: -9.81 }`. Vectors have only `x` and `y`. Rotation is a scalar angle (`body.rotation()`).
- In `sync()`: `object.position.set(p.x, p.y, object.position.z); object.rotation.z = body.rotation();`
- Colliders:
  - `ball(r)`, `cuboid(hx, hy)`, `capsule(halfHeight, r)`
  - `convexHull(Float32Array[x,y,…])`
  - `polyline(verts)` for terrain outlines
  - `trimesh` exists, but FIX_INTERNAL_EDGES is **not supported** in 2D. Use `polyline` for ground.
- `collidersFromGltf` for 2D: project the mesh onto XY (Blender X/Z → three X/Y) and use the outline. For simple levels, place `cuboid`-tagged boxes and read their bounding boxes. That path already works if you drop the z component.

Camera tips:
- Orthographic: `new THREE.OrthographicCamera(-w/2, w/2, h/2, -h/2, 0.1, 100)` and follow the player with a smoothed lerp.
- Keep 1 unit = 1 m. Size the game world in the 1–100 m range, not in pixels.
