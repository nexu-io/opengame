> See [source and execution notes](../PROVENANCE.md).

# Game Review Rubric

Run this before setting `status: "ready"` or publishing. Automated checks raise the floor; headless captures do not replace human play, real GPU/touch performance, or audible review.

## 1. Mechanical & Functional Gate (Fix Every Failure Before `ready`)

1. **Zero starter residue:** No leftover starter copy/titles (`TODO`, `lorem`, empty `src=""`, or default placeholder theme).
2. **Entry & viewport fit (`100dvh`):** Full-viewport playfield with no landing-page layout beside a boxed canvas. Lightweight 2D/arcade games play from frame one; heavy-asset 3D builds using a loading cover must show real progress, block gameplay inputs while loading, enter via `#start`, and remove/hide the cover completely on entry.
3. **Readability & style cohesion:** Clear figure-ground separation (`ground < obstacles < hero & signals`), consistent rendering medium, and no glaring fidelity cliff between hero anchors and primary-sightline neighbors.
4. **Assets complete & clean:** Zero 404/network errors in playtest; library assets use literal `/motion-api/assets/<assetId>/versions/<versionId>/media` URLs; 3D `.glb` assets inspected via `version.result.glb` / `scripts/game-glb-inspect.mjs`.
5. **Multimodal-first honoured:** When fitting models are available and approved, real generated/imported assets appear inside active gameplay (not title-only); record any fallback reason in `design/assets.csv`.
6. **Verification matched to architecture:**
   - `openmotion_game_validate` passes with zero blocking diagnostics (and resolve any 3D kinematics static warnings).
   - Games using `logic.js`: 3-tier `openmotion_game_simulate` passes (`reference` wins, degraded struggles, `idle` loses cleanly).
   - All games (primary for `realtime-3d` / `sandbox-explore`): `openmotion_game_playtest` passes all assertions — `window.__omGame.runSelfTests()`, `stats.kinematics` stability assertions on 3D humanoid builds, multi-point `{ type: "screenshot" }` + `{ type: "burst" }` motion inspection, and zero horizontal overflow at `390×844` under peak HUD density.
7. **Visual Critique & Focused Polish Pass (`Full Track` / `realtime-3d`):** Inspect the first passing contact sheet against `design/style.md` across 5 pillars and run one focused polish pass if any underperforms:
   - *Lighting & Atmosphere:* Style-matched key/fill/fog/IBL, selective bloom where fitting, zero GLSL `NaN` artifacts.
   - *Pose, Rig & Smooth Motion:* Native Mixamo clips and/or `vendor/HumanoidRigController.js` driving grounded stances, real hand-socket weapons, smooth `Quaternion.slerp`, and clean `burst` motion continuity — no upright A-pose puppets, 30 Hz leg flicker, or 1-frame limb snaps ([game-3d-animation.md](game-3d-animation.md)).
   - *Material & Landmark Parity:* Held gear and primary-sightline props match hero PBR fidelity (no flat single-color extrusions beside sculpted PBR characters).
   - *Action Feedback:* Crisp trails, radial sparks (`fog: false`), hit-stop/recoil, and reciprocal hit reactions.
   - *Camera Stability:* Smooth follow/lookAt damping, bounded yaw deltas, unobstructed sightlines in close quarters.
8. **Audio & accessibility:** User-gesture AudioContext unlock, responsive SFX **and** a looping BGM bed (generated or WebAudio fallback unless silence was requested), mute toggle for both, playable muted, graceful asset-load fallbacks, `prefers-reduced-motion` respect (no > 3 Hz full-screen flashes), and touch controls (≥ 48–56 px targets).
9. **Metadata, cover & licenses:** Game-only 1280×720 cover via `openmotion_game_capture_cover`, concise English + `zh-CN` metadata via `openmotion_game_update_meta`, and preserved `vendor/` / `characters/` licenses.

## 2. Playable-Ad Addendum

For **Format: playable ad**, score each criterion 0 (missing), 1 (partial), or 2 (meets [game-playable-ad.md](game-playable-ad.md)) in `design/verification.md`. Ship only with zero `0`s and total ≥ 10/12:

| Criterion | 2 means |
|---|---|
| First-frame play | Playable scene on frame one, no title card; first touch plays and scores within 1 s |
| Tutorial | Animated hand on exact first target + short cue; hides on input, returns after idle hint delay |
| Level arc | 3–8 levels (easy L1 win, high-tension level, twist); `reference` wins and `idle` loses in `simulate` |
| End card & CTA | Both win/fail cards verified in playtest; CTA logs `cta_click` via `openStore()`, Play again does not |
| Audio & runtime | First-touch SFX + looping BGM (generated or WebAudio), mute toggles both, Replay never stacks BGM; zero third-party CDNs, storage, dialogs, or SDK stubs |
| Polish | Clean `390×844` layout, free corners, immediate feedback on every tap, localized copy fits |

## 3. Optional Post-Publish Checks

- **Trailer (`openmotion_game_trailer`):** Only on user request; inspect actual clips and final silent MP4 before claiming ready.
- **Existing multiplayer projects:** Apply [Mandatory Multiplayer Entry Acceptance](../SKILL.md#mandatory-multiplayer-entry-acceptance).
