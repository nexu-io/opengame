> See [source and execution notes](../PROVENANCE.md).

# Procedural Animation — Non-Humanoid Branch (Three.js)

Use for non-humanoid creatures and machines where Mixamo humanoid rigging does not apply: dragons, quadrupeds, snakes, spiders, fish, slimes, drones, mechs. Build the creature as a **hierarchy of pivoted Three.js groups** and drive motion analytically in code. (For articulated humanoids, always use real Mixamo rigging + `vendor/HumanoidRigController.js` per [game-3d-animation.md](game-3d-animation.md).)

## 1. Hierarchy & Optional Soft-Body Skinning

```
root (Group)          ← world position, facing, bob
 └ body  → chest → neck → head
 └ tail_0 → tail_1 → tail_2 → tail_3
 └ wing_L_inner → wing_L_outer   (and R)
 └ leg_LF_upper → leg_LF_lower   (×4)
```

- Pivot every segment `Group` at its joint (offset the child mesh so it rotates around the joint, not its center) and express dimensions as fractions of one body length in `config`.
- Share geometries/materials across instances; use `InstancedMesh` per segment type for swarms.
- **Optional runtime `SkinnedMesh`** (strictly for soft/ribbon non-humanoids like serpents, tails, tentacles, banners — **never** for unrigged humanoid GLBs): call `skinnedMesh.bind(skeleton, new THREE.Matrix4())` in clean unparented local space before attaching to the scene, blend weights with C1 `smoothstep` across joints, and verify weighted vertices > 0.

## 2. Locomotion Recipes (`angle(t) = A * sin(2π * t / T + φ)`)

Evaluate from game time (so pauses/slow-mo work) and scale gait amplitude smoothly by continuous speed rather than snapping between states. Keep gameplay authority in rules/physics — animation is presentation only.

| Creature | Skeleton | Locomotion formula |
|---|---|---|
| Winged (dragon, bird) | spine + 2-segment wings + tail | Wings ±35–45°, outer lags inner by 0.15–0.25 cycle; body bobs counter-phase to downstroke; tail wave |
| Quadruped (wolf, dog) | spine + neck/head + 4× 2-seg legs + tail | Diagonal pairs in counter-phase (LF+RH φ=0, RF+LH φ=π); half-amplitude lateral spine sway |
| Hexapod (insect) | thorax + 6 legs | Alternating tripod: {L1,R2,L3} φ=0, {R1,L2,R3} φ=π |
| Octopod (spider) | cephalothorax + 8 legs | Two counter-phase tetrapod groups; adjacent legs offset by π/4 |
| Serpentine (snake) | 8–12 spine segments | Traveling wave `φ = i * 2π/N`, lateral ±20–30°, amplitude grows toward tail |
| Aquatic (fish) | spine + fins | Rear-weighted traveling wave; fins counter-flap at 2× frequency |
| Slime / blob | none or 1 root | Volume-preserving squash/stretch: `sz = 1 + A*sin(ωt)`, `sx = sy = 1/sqrt(sz)` + synced bounce |

Idle for any creature: subtle breathing (`±2–4°`, ~4 s cycle), slow head sway, gentle tail/wing micro-wave.

## 3. Visual QC & Rigged Non-Humanoid GLBs

- Verify motion in `openmotion_game_playtest` using `{ type: "burst", count: 4, intervalMs: 110, label: "gait" }` (or non-uniform phase samples `0.0, 0.23, 0.41, 0.68, 0.87` so captures do not alias the period) to confirm phases differ and joints stay connected.
- If a rigged non-humanoid `.glb` is supplied or generated, inspect it with `scripts/game-glb-inspect.mjs` and drive it with `GLTFLoader` + `AnimationMixer` like any rigged GLB.
