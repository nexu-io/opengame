> See [source and execution notes](../PROVENANCE.md).

# 3D Assets, Rigging & Motion (Three.js + GLB)

Use for 3D characters, vehicles, props, environments, and animation in Three.js. Pair with [game-stylization.md](game-stylization.md) for cohesive lighting, textures, and skyboxes.

## 1. Non-Negotiable 3D Humanoid & Kinematics Contract (Read First)

Passing `style: "3d"` scaffolds `./vendor/HumanoidRigController.js` alongside Three.js (`GLTFLoader.js`, `SkeletonUtils.js`, `BufferGeometryUtils.js`). **Use it for every rigged humanoid actor** instead of hand-writing bone resets, raw `Math.hypot` walk toggles, or ad-hoc arm IK:

```js
import { createHumanoidRig, sampleActionCurve } from './vendor/HumanoidRigController.js';

const rig = createHumanoidRig(heroGltf, { height: 1.78, name: 'hero' });
rig.retargetClipsFrom(otherAnimatedGltf);                // optional: share clips across rigged humanoids
rig.attachToBone('RightHand', weaponMesh, { rotation: [0, 0, 0] }); // real hand socket + scale fix
scene.add(rig.root);

// Each render frame:
rig.syncTransform(actor.x, actor.y, actor.z, actor.yaw, dt, { speed01: moveIntent01 });
rig.playClip(isMoving ? 'run' : 'idle', { fade: 0.16 }); // loop clip; use rig.playOnce('slash' | 'hurt' | 'fall', { holdEnd }) for actions
rig.update(dt, optionalAimOverlayOrNull);                // persistent Quaternion.slerp + reach-clamped IK
```

**Five invariants (enforced automatically by `HumanoidRigController.js`, audited by `openmotion_game_validate` & `openmotion_game_playtest`):**
1. **Default to multi-clip Mixamo animations for animated humanoids:** When live `3d-asset` is available, generate animated humanoid actors with **`operation:"rig_retarget"`** using multi-clip presets (**`rigPreset:"mixamo-combat"`** = `idle/run/slash/hurt/fall`, or **`"mixamo-locomotion"`** = `idle/walk/run/jump`, or mutually exclusive Tripo v3 `preset:*` `parameters.animation` / `parameters.animations` up to 5 presets in one retarget step) from a **front-facing symmetric empty-handed A-pose** concept. **If reusing an existing workspace rigged GLB with `animations: 0`**, do **not** hand-animate full-body actions via arm IK alone — upgrade it in 1 step with **`operation:"retarget"`** + `parameters.original_model_task_id` (`version.result.rigTaskId`) + a multi-clip `rigPreset`, or transfer clips from another animated humanoid via **`rig.retargetClipsFrom(sourceGltf)`**. Never apply DIY bounding-box `SkinnedMesh` skinning to unrigged humanoids.
2. **Zero 30 Hz square-wave leg flicker:** Never snap `root.position.set(actor.x, 0, actor.z)` or derive `walking = delta > 0.001` from adjacent render-frame displacement against a 20/30 Hz logic loop — non-tick frames drop `delta` to `0` on 60/120 Hz displays. Use `rig.syncTransform(...)` (exponential position/yaw damping + continuous `walk01`).
3. **Zero 1-frame joint snaps:** Never reset rigged bones to rest pose without slerping persistent `curQ` quaternions or using `AnimationMixer.crossFadeTo()`.
4. **Real bone sockets & reach-safe overlays:** Mount handheld weapons onto real `RightHand` / `LeftHand` bones via `rig.attachToBone(...)` and let the hand bone drive weapon swing orientation naturally (avoid overwriting weapon world quaternions every frame). Reserve manual IK (`rightHand`/`leftHand`) for light aim/reach overlays inside `rig.metrics.*.maxReach` — drive full-body swings, hit reactions, and defeat falls with real clips (`playOnce(..., { holdEnd: true })` for defeat) rather than stacking extreme spine/root pitch bends.
5. **Report kinematics telemetry & run a motion burst in playtest:** Expose `kinematics: { hero: heroRig.getTelemetry(), boss: bossRig.getTelemetry() }` inside `window.__omGame.getStats()` (checked automatically by `openmotion_game_playtest`: `walkZeroFlips <= 1`, `maxBoneRadPerSec <= 22`, `maxYawRadPerSec <= 18`, `overExtendedIkCount / frames <= 0.35`) and capture a 3–4 frame `{ type: "burst", count: 4, intervalMs: 100, label: "strike" }` sequence during real movement/combat into the contact sheet.

**Meshy provider:** when discovery returns `meshy:*` models (`MESHY_API_KEY`), the same `operation` and `rigPreset` values apply: rigging uses the Mixamo skeleton by default and clips come from the Meshy animation library (`parameters.action_ids` for exact clips). Task-chain edits (`decimate`, `texture`, `segment`, …) are Tripo-only. Read `openmotion://workflow/media/meshy` for Meshy parameters and limits.

## 2. Screen-Dominance 3D Asset Budget

Check live capability discovery (`openmotion_capability_discover` `modality:"3d"`) first, then allocate 3D budget strictly by **Screen-Dominance × Gameplay-Focus**:

- **P0 — Focal Interactive Subjects (first priority):** Near-camera player hero/vehicle, primary boss/rival, and signature handheld weapon. Never spend 3D calls on corner/background ornaments while P0 actors remain primitive stacks. Tag targets in `design/assets.csv` with `priority` (`P0-focal` / `P1-instanced`) and `reuse_count`.
- **P1 — Reusable Primary-Sightline Landmarks (1–2 instanced props):** High-reuse foreground props (`reuse_count >= 2`, e.g., braziers, pillars, gates, turrets) placed via clones or `InstancedMesh`.
- **P2 — Arenas, water reflectors, colliders & VFX:** Build playable floors, reflection planes, collision geometry, skyboxes, and particles in Three.js code + seamless 2D PBR textures so colliders match visuals 1:1.
- **Image-to-3D input preflight (Batch 1):** Generate one clean isolated studio concept per P0/P1 mesh (uniform plain background, full uncropped silhouette, no shadows/text/props; or split orthographic 3-view turnaround for multi-view endpoints). For humanoid rigging, enforce **straight front symmetric A-pose/T-pose, limbs separated from torso, empty hands, no fused cloak**. Never pass uncropped multi-panel sheets to single-image `image_to_model`.
- **Weapon & attachment PBR parity:** Never attach flat single-color extrusions to PBR characters — generate the signature weapon via `3d-asset` (`prop-low`) or build multi-part PBR metal with procedural normal/roughness maps and realistic proportions.

| Priority | Route | Best For | Notes |
| :---: | :--- | :--- | :--- |
| **1** | **Rigged & animated GLB** (`3d-asset` `operation:"rig_retarget"` + `retarget`, or user/CC0 `.glb`) | Humanoid heroes, bosses, NPCs | `rig_retarget` chains up to 3 paid tasks (base → Mixamo rig → clip); reuse `rigTaskId` via 1-step `retarget` for additional clips. Drive via `HumanoidRigController.js` |
| **2** | **Static PBR GLB** (`3d-asset` `image_to_model` / `text_to_model`, `rigPreset:"none"`) | Rigid objects: vehicles, weapons, instanced props/landmarks | Prefer `image_to_model` from 1 isolated concept. Never pass `quad:true` (returns FBX). Never use for articulated humanoids |
| **3** | **Procedural PBR Three.js + 2D textures/skybox** | Arenas, terrain, modular architecture, non-humanoid rigs ([procedural](game-procedural-animation.md)) | Note: `3d-world` (`worldlabs-atlas`) is a multi-step pipeline (`atlasTextToImage` → `atlasGenerate` → `splats2Mesh` `.glb`; no runtime `.spz` renderer) — do not rely on a single `3d-world` call alone |
| **4** | **Bundled CC0 fallback** (`templates/game-kits/characters/Mage.glb`, `Knight.glb`) | Stylized fantasy humanoids when live `3d-asset` is unavailable | Keep `LICENSE-KayKit.txt`; retint materials and attach props via `HumanoidRigController.js` |

**Timeout recovery & URLs:** On MCP timeout for `3d-asset`/`3d-world`, re-invoke `openmotion_capability_run` with the **identical `requestId` and arguments** to resume from the saved checkpoint without re-billing. Embed completed/imported GLBs by their literal `/motion-api/assets/<assetId>/versions/<versionId>/media` URL (never base64).

## 3. Pre-Integration GLB Gate & Payload Discipline

Inspect `version.result.glb` / `version.result.boneNames` (or run `node scripts/game-glb-inspect.mjs <file.glb>`):
- **Scale, grounding & `alphaMode: BLEND`:** Check `bounds`, `minY`, `boneNames`, and `materials.blendMaterials` (`HumanoidRigController.js` grounds feet to `y = 0`, orients `+Z`, and hardens misflagged opaque `BLEND` materials automatically).
- **Textures, not triangles, dominate size:** AI-generated GLBs are ~90% embedded PNG/JPEG bytes. `web_publish` and `exportZip` automatically transcode embedded GLB textures to **`EXT_texture_webp`** while preserving geometry, skins, and clips (`vendor/GLTFLoader.js` decodes natively). Avoid worker-based Draco decoders (CSP sets `worker-src 'none'`). Archive raw masters in `assets-raw/`.

## 4. Lighting, Shaders & Performance Craft

- **Style-matched lighting & rear readability:** Match directional key, hemisphere fill (keep `HemisphereLight <= 0.35` in moody/night arenas so shadows hold depth), skybox/IBL (`PMREMGenerator`), rim light, and fog to `design/style.md`. Use `ACESFilmicToneMapping` + `SRGBColorSpace` on color/emissive maps only. In third-person cameras where the hero is viewed from behind, give the hero clear rear silhouette landmarks and a subtle rim/back fill so rear geometry stays legible.
- **GLSL `NaN` firewall & combat VFX:** On Metal/ANGLE WebGL2, `pow(<=0.0, k)` or reversed `smoothstep(hi, lo, x)` creates `NaN` black squares under `HalfFloatType` bloom. Always clamp `pow(max(0.001, base), k)` and sanitize float bloom taps. For melee/action VFX, prefer multi-segment additive ribbon trails, circular radial sparks (`if (dot(c, c) > 1.0) discard;`, `fog: false`), brief hit-stop (`50–75 ms`), and damped camera feedback.
- **Camera & pacing safety:** Smooth both camera position and `lookAt` target, use `shortestAngleDelta(cur, tgt)` for turns, call `camera.updateMatrixWorld()` before projecting HUD markers, hold lock-on yaw when fighters cross at very close range (`d < 1.8m`), and clamp `dt <= 1/30`.
- **Budget & rejection valve:** Merge static geometry (`BufferGeometryUtils.mergeGeometries`), use `InstancedMesh` for repeated props (never merge skinned meshes), cap DPR `<= 1.5`, target `<= 120` draw calls / `<= 150k` triangles (report real pre-postprocess counts in `getStats()`), and discard/replace any external or generated mesh that reads blurry or fused in live captures.
