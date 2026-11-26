> See [source and execution notes](../PROVENANCE.md).

# Stylization — Cohesive Art Direction

Independent model calls share no memory. Pin one concise English visual direction in `design/style.md` and reuse it across every asset prompt and engine lighting setup so the game reads as one world.

## 1. Visual Style Direction (`design/style.md`)

Write one compact English paragraph covering five roles (honoring any `[locked]` user style; otherwise rejecting the genre's most predictable cliché):

| Role | What It Pins Down |
|---|---|
| **1. Rendering medium** | Physical/artistic craft and surface grain (e.g., *2D cel-shaded anime with crisp ink lineart*, *tactile matte diorama*, *stylized PBR*). Never mix live-action DSLR photos into 2D/anime scenes. |
| **2. Silhouette language** | Proportions and contour clarity that read cleanly at gameplay camera distance. |
| **3. Palette by readability role** | Muted cohesive environment base < medium obstacles < high-contrast hero < one reserved signal hue for hazards/pickups/objectives. |
| **4. Light & mood** | Key light direction, color temperature, atmosphere, and time of day. |
| **5. Perspective** | Match camera grammar (`side-view`, `top-down`, `isometric`, `flat frontal` for 2D; clean neutral isolated concept views for 3D). |

## 2. Prompt Assembly, Batching & Inspection

Combine `<asset role & clear silhouette> + <style direction> + <framing/background constraints>`:
- **Transparent sprites/UI:** Prefer live native `parameters.background: "transparent"` or live `remove-background`; fall back to solid-color chroma-keying (key hue absent from subject, clearing enclosed holes) only when unavailable.
- **Seamless tiles & 3D textures:** Request flat, even, shadowless lighting with wrapping edges; finish tiling/PBR maps per [game-textures.md](game-textures.md).
- **Isolated 3D concepts:** Generate clean uniform-background full-body concepts (front symmetric empty-handed A-pose for rigged humanoids) for P0/P1 meshes per [game-3d-animation.md](game-3d-animation.md).
- **Batch & inspect once:** Submit approved assets concurrently while coding core mechanics, then inspect up to 12 outputs together via batch contact-sheet `read` (max 2 retries/asset within approved spend). Right-size rasters to on-screen resolution (`web_publish`/`exportZip` auto-transcode large images and GLB textures to WebP).

## 3. 3D Lighting Sync & Quality Valve

- **Engine lighting must match `design/style.md`:** Align key/fill light, skybox/IBL, fog tint, and tone mapping with the palette. Fix color drift via lighting/material tint before regenerating meshes, and keep primary-sightline props at comparable material fidelity to hero anchors.
- **Cohesion beats provenance:** Generate real assets first whenever fitting models are connected and approved; fall back cleanly to crisp procedural visuals and WebAudio when unavailable or declined (recording why in `design/assets.csv`). If any generated or external asset looks blurry, fused, or stylistically jarring in live captures, replace or discard it rather than defending sunk cost.
