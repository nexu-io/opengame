> See [source and execution notes](../PROVENANCE.md).

# Stylization — Cohesive Art Direction for Generated & Code-Made Assets

Independent model calls have no memory of each other. Without a shared visual contract, a game quickly drifts into clashing art styles (photoreal backdrop + flat vector hero + neon UI). Store one concise English style direction in `design/style.md` and carry it consistently across every asset prompt and engine lighting choice.

## 1. Visual Style Direction (`design/style.md`)

Compose one concise English paragraph covering five roles — derived from the user's `[locked]` style or a fresh non-cliché direction:

| Role | What It Pins Down |
|---|---|
| **1. Rendering medium** | Physical/artistic craft and surface grain (e.g., *2D Japanese cel-shaded anime illustration with crisp ink lineart*, *tactile matte miniature diorama*, *gritty neon-lit cyberpunk PBR*). Never let 2D/anime briefs drift into live-action DSLR photography. |
| **2. Shape & silhouette language** | Proportions, contour clarity, and edge treatment so actors read cleanly at gameplay scale. |
| **3. Palette by readability role** | **Roles, not one flat tint**: muted/cohesive ground & environment base; high-contrast hero hue/luminance that pops cleanly; one unmistakable signal hue reserved for hazards/pickups/objectives. |
| **4. Light & mood** | Lighting direction, temperature, atmosphere, and time of day. |
| **5. Camera / perspective consistency** | Match the genre (`side-view`, `top-down`, `isometric`, `flat frontal` for 2D; `three-quarter orthographic/isometric reference` for 3D concepts). |

Reuse this direction verbatim (or a condensed token for length-limited fields) across every generation prompt in the run. Only re-derive it when the user asks to restyle the whole game.

## 2. Prompt Assembly & Transparency

Combine: `<asset role & clear visual shorthand> + <style direction> + <framing/seam/transparency constraints>`.

- **Sprites & UI needing transparency:** Prefer live native `parameters.background: "transparent"` when the discovered model lists it, or dedicated live `remove-background` via `openmotion_capability_run`. Only fall back to solid-color chroma-keying (choosing a key color absent from the subject and clearing enclosed holes as well as corners) when neither is available.
- **Seamless tiles & 3D textures:** Request flat, even, shadowless lighting with wrapping edges; finish tiling/PBR map derivation in code per [game-textures.md](game-textures.md).
- **Backdrops & key art:** Keep foreground/title safe space clean so HUD, characters, and typography remain effortless to read.

## 3. Model Selection, Batching & Inspection

- **Discover live capabilities/models first** (`SKILL.md` §2). Pair higher-quality models for 1–4 focal hero visuals/covers with faster models for tiles/icons/props so batches complete quickly. Pass only live-listed model parameters.
- **Submit approved assets concurrently** right after planning while writing game logic and UI.
- **Inspect together before wiring:** Call batch contact-sheet `read` (`items: [{ assetId, versionId }, ...]`, up to 12 images on one neutral-gray sheet) to check style cohesion, rendering-medium fidelity, silhouette clarity, and real alpha cutouts in one turn without bloating context. Cap retries at 2 per asset within approved spend.
- **Visual reference sheets & isolated 3D concept sheets (high-ROI for 3D action / boss fights):** Before authoring complex 3D combat choreography or lighting, generate one 4-panel Pose & Lighting Art Direction Sheet into `assets-raw/` (excluded automatically from publish/ZIP) to lock key poses, contrast ratios, and mirror/rim lighting, and generate clean isolated neutral-background concept images (`≤ 1.5 MB` JPEG/PNG) for hero characters and 1–3 reusable primary-sightline architectural landmarks to feed into Image-to-3D (`tripo-3.0`); skip for simple 2D/arcade builds.
- **Right-size raster payload:** Request game-appropriate sizes matched to actual rendering pixels rather than defaulting every tile or icon to 4K PNGs (during `web_publish`/`exportZip`, large PNG/JPEG assets and embedded GLB textures are automatically WebP-optimized while preserving resolution).

## 4. 3D Style Synchronization

In 3D scenes, textures alone never sell a style — **engine lighting, skybox/IBL, fog, tone mapping, and geometry density must match `design/style.md`**:
- Derive directional key light, hemisphere fill, fog tint, and skybox from the style's palette and mood.
- Fix color drift by retinting materials or adjusting lighting before rebuilding clean meshes; on a full restyle, update lighting, fog, textures, and materials together.
- Verify same-frame consistency: once a focal hero or vehicle looks sharp, ensure neighboring primary-sightline props do not break immersion with flat unshaded placeholders.

## 5. Multimodal-First vs. Procedural Fallback

Procedural Canvas/SVG art excels for abstract, geometric, pixel, or minimalist briefs, but is the wrong tool for illustrated characters, key art, or atmospheric audio when real models are available. Generate real assets first whenever fitting models are connected and approved; use crisp code-drawn art and Web Audio synthesis cleanly whenever generation is unavailable or declined, and record the reason in `design/assets.csv`. Style cohesion and visual clarity always outrank provenance — if a generated or external asset looks blurry, fused, or jarring in live captures, drop and replace it or fall back to crisp procedural craft rather than keeping it out of sunk cost.
