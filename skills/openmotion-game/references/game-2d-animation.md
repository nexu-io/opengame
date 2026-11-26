> See [source and execution notes](../PROVENANCE.md).

# 2D Sprite Animation (Video-to-Spritesheet Pipeline)

Use for animated 2D characters, objects, and effects. Embed the game's `design/style.md` direction in every prompt; discover live image/video/background-removal capabilities first (`openmotion_capability_discover` / `openmotion_media_use`).

**Why video → frames:** Generating independent frames per pose causes silhouette drift ("boiling"). Animating ONE approved key-pose image with a first-frame video model preserves character identity across frames.

## 1. Choose the Route

| Available Capabilities | Route |
|---|---|
| Image + first-frame video models live | Full key-pose → video → frame extraction → alpha → grid pipeline below |
| Image model only (or short fast-turnaround sprites) | Generate 2–4 key poses (idle, action peak, hit) as edits referencing the same source sprite (`remove-background` or native `background:"transparent"`), then tween/squash/flip in code |
| No media model / declined | Code-drawn Canvas/SVG sprites + procedural motion ([game-procedural-animation.md](game-procedural-animation.md)) |

## 2. Hard Rules (Known Failure Modes)

- **Never crop the subject:** Full body in frame with visible top/bottom margin at every stage. A clipped key pose or video frame cannot be fixed downstream — regenerate within the approved budget (max 2 retries/stage).
- **Use only live-discovered model IDs & parameters** (never pass fixed `ratio` with a first-frame video input; omit `ratio` or pass `"adaptive"`).
- **Close loops in frame selection, not the prompt:** First-frame video models cannot lock an end frame. Find the best start→end match in code, keep both endpoints during selection, and drop the duplicate last frame at sheet assembly for loops.
- **Key alpha per frame** (never across the raw video).

## 3. Pipeline Stages

1. **Source & Key-Pose Image (image edit referencing source):**
   - Put the subject in the action's **characteristic mid/peak phase** (`idle` relaxed stance, `walk/run` mid-stride, `attack` wind-up, `jump` crouch, `cast` gathered energy).
   - Demand full body with top/bottom margin and a **flat uniform chroma-key background** whose hue never appears on the subject (video frames cannot carry alpha, so do not request transparent PNGs for Stage 2→3 video inputs; for static/key-pose-only sprites without video, prefer native `background:"transparent"` or live `remove-background`).
2. **First-Frame Video Generation:**
   - Pass the Stage-2 key pose in `references`, shortest clip duration covering one full cycle (~4–5 s), `720p`, `ratio: "adaptive"` (or omit), `generate_audio: false` where supported.
   - **Prompt = ONE motion verb + mandatory negative lock block:**
     - *Camera lock:* `camera locked, no camera movement, no zoom, subject stays fully in frame, plain static background`.
     - *Prop/action inertia:* `the character performs ONLY this action, nothing else happens` (if holding a weapon/tool during locomotion, explicitly keep it inert).
     - *Facing lock:* `the subject keeps facing the SAME direction for the entire video — never turns around` (except when the action itself is a turn).
   - Inspect with `action:"read"` passing explicit `timestamps` (start/mid/end) before proceeding.
3. **In-Browser Frame Extraction & Selection:**
   - Never decode 5 s of full-res 720p frames into memory (~420 MiB) or block boot indefinitely: keep the static sprite as an immediate fallback, attach load/seek timeouts, scan downscaled grayscale frames (e.g. `96×96`) to find a real motion cycle with minimal start/end seam error, then decode only the selected `frame_count` timestamps at sprite size.
   - **Frame counts:** idle/breathing `8–16`; pixel walk/run `8–12`; HD walk/run `16–24`; attack/hit/jump `10–20`; fluid FX `24–48` (default `25`). Keep pixel art strictly `8–16` frames at `8–12 fps` and downscale with **nearest-neighbor** only to prevent shimmer.
4. **Per-Frame Alpha & Grid Assembly:**
   - Remove the key-color background per frame (chroma distance + 1–2 px soft edge + despill; clear enclosed background holes as well as corners), or use live `remove-background` for small key-pose sets.
   - Crop ALL frames to their **union non-transparent bounding box** (per-frame cropping causes jitter), pad to a uniform bottom-center-anchored cell, drop the final duplicate frame for loops, and pack into a near-square grid (`≤ 4096 px` per side; downscale cells rather than dropping frames).

## 4. Failure Recovery

| Symptom | Root Cause | Fix |
|---|---|---|
| Subject clipped / drifting | Tight key pose or missing camera lock | Add margin in Stage 2 + strengthen camera lock |
| Sprite jitters in-game | Per-frame crop instead of union bbox | Re-crop all frames to union bounding box |
| Loop jumps or stalls 1 beat | Bad seam window or duplicate last frame | Re-run loop-seam search; drop last frame on loops |
| Color halo / holes in matte | Key color present on subject or no despill | Switch Stage-2 key color away from subject palette + despill |
| Subject turns around mid-clip | Missing facing lock | Add explicit facing lock to video prompt |
| Pixel sprite shimmers | Too many frames or bilinear smoothing | Cap to `8–12` frames, nearest-neighbor downscale only |
