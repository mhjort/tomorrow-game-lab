# Rapier 3D cheat sheet (`@dimforge/rapier3d` 0.21, loaded lazily by engine/physics.js)

```js
const physics = await createPhysics({ substeps: 1 });      // engine/physics.js
const { RAPIER, world } = physics;
const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, z).setCcdEnabled(true));
const col = world.createCollider(RAPIER.ColliderDesc.ball(r).setDensity(1000).setFriction(0.6).setRestitution(0.3), body);
physics.bind(body, mesh);                                   // mesh follows body in physics.sync()
```

## Body types
- `fixed()` for level geometry. Put all of a level's colliders on **one** fixed body so it can be removed in one call.
- `dynamic()` for balls, crates and ragdolls.
- `kinematicPositionBased()` for moving platforms and doors. Drive it with `setNextKinematicTranslation`.
- Characters: use `world.createCharacterController(0.01)` with a kinematic body. Don't build a dynamic capsule; it fights you on slopes and steps.

## Colliders
- `ball`, `cuboid(hx,hy,hz)` (half extents!), `capsule(halfHeight, r)`, `cylinder`
- `convexHull(Float32Array)`
- `trimesh(verts, indices, RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES)`: static only. Vertices must be welded, which `collidersFromGltf` does.
- Sensors: `.setSensor(true)`, then `physics.onSensor(collider, (other, started) => …)`. That call enables `ActiveEvents.COLLISION_EVENTS`.
- Friction combines by average by default. Use `setFrictionCombineRule(RAPIER.CoefficientCombineRule.Max)` for sticky surfaces.

## Queries
```js
const hit = world.castRay(new RAPIER.Ray(origin, dir), maxToi, true);   // hit?.timeOfImpact, hit.collider
world.intersectionsWithShape(pos, rot, shape, (c) => …);
```

## Tuning gotchas (learned the hard way)
- **Rotation clamp.** Rapier limits rotation per step to about π/4. At 60 Hz that is about 47 rad/s. A small ball rolling fast needs `v/r` rad/s: 4 m/s at r = 5 cm is 80 rad/s. Above the clamp it *decelerates mysteriously*. Fix: `createPhysics({ substeps: 4 })`, or use bigger objects.
- **Rolling resistance.** Rapier has none. Without it a ball rolls forever, unless you use linear damping, which feels floaty because the drag is proportional to speed. For arcade feel, subtract a constant `decel·dt` from horizontal speed each tick while grounded, and scale angular velocity by the same factor. Stopping distance is then `v²/(2·decel)`, which bots and judges can reason about.
- **Start balls rolling.** When launching a ball along the ground, also set `angvel = (up × v) / r`. Otherwise it loses about 2/7 of its speed in the slide-to-roll transition.
- **Ghost bumps** on flat trimesh: use FIX_INTERNAL_EDGES with welded vertices, and avoid long sliver triangles in the level mesh.
- **Tunnelling.** Enable `setCcdEnabled(true)` on small, fast bodies. Keep thin walls at least 2× the step distance.
- **Sleeping.** A body that falls asleep stops generating sensor events. Call `setCanSleep(false)` on the player or ball, or wake it with `wakeUp()`.
- Units are meters and kilograms. Keep objects between 0.05 and 50 m. Gravity −9.81 is fine; raise it (−20…−30) for snappy platformers.
