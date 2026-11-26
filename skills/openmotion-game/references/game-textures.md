> See [source and execution notes](../PROVENANCE.md).

# Seamless Textures & PBR Maps

Use for tileable ground, wall, floor, track, or skybox textures and derived PBR maps (`map`, `normalMap`, `roughnessMap`). Embed the game's `design/style.md` direction in English prompts. Discover live edit-capable image models first (`openmotion_capability_discover` / `openmotion_media_use`); if no generation model is available or declined, synthesize seamless tiles procedurally with wrap-around noise/fBm and still run Step 2–3.

## 1. Seamless Edit (When Generating From a Reference)

- Pick the sharpest square region of the reference (avoid perspective or depth-of-field blur). Skip generation if the tile is already seamless (wrap-edge difference / interior neighbor difference `≤ 1.3`).
- Submit an edit referencing the library asset (`references: [{ assetId, versionId }]`), passing only parameters listed by live discovery (crop/scale to power-of-two in code if the model does not accept square sizing):
  > *Reproduce the attached image as faithfully as possible: the SAME `{MATERIAL}`, same colors, lighting, shapes and detail. Make only the minimal adjustments needed for a perfectly seamless tileable texture where left continues into right and top continues into bottom with no visible seam. Flat even lighting, no shadows, no restyling.*
  - Add alignment wording for structured tiles/bricks/planks, anti-repetition wording for periodic previews, or watermark removal for stock inputs.
- Inspect side-by-side against the reference (`action:"read"`). Cap retries at 1 within approved budget; if structured seams survive, switch to the offset-inpaint pass below instead of rerolling.

### Offset-Inpaint Pass (For Stubborn Structured Seams)

1. Roll the tile 50% on both axes so the old edge seams form a center cross, import as a reference, and prompt the edit model to **replace damaged/cut elements along the center horizontal and vertical lines with complete sharp elements** (never say "smooth/repair the seam" — that causes blurry ghosts).
2. **Never trust the model's full output:** edit models subtly repaint outside the cross and cause color drift or smears. Composite in code by taking **only a feathered ~20% band around the center cross** from the edit, keeping the rolled original elsewhere, then roll back 50%.

## 2. Deterministic Post-Process & PBR Derivation (In Code)

Load `/motion-api/assets/<assetId>/versions/<versionId>/media` into an offscreen canvas once at load time (cache results; never recompute per frame):

1. **Trim & resize:** Trim ~4% blurred outer border on generated outputs and rescale to a power-of-two size (`256` or `512`).
2. **Palette lock (optional):** Match per-channel color stats back to the reference if the edit drifted.
3. **Seam cross-fade:** Offset 50% on both axes and cosine-blend a narrow `8–12%` band across the center seams with the unshifted tile (keep narrow on structured bricks/planks).
4. **Wrap-around PBR maps:** Compute height from lightly blurred luminance, Sobel normal map with toroidal wrap sampling, and roughness from inverted contrast-stretched height (stone/earth) or constant (metal/plastic). Apply with `THREE.RepeatWrapping` (`SRGBColorSpace` on albedo only; linear on normal/roughness).

## 3. Verification

- Check the tile repeated `2×2` **and at 1:1 (100% zoom) across wrap junctions and center** — downscaled previews hide translucent smears and interior patch ghosts.
- Confirm wrap-edge mean pixel delta / interior neighbor delta `≤ 1.3`, and record asset IDs and seam quality in `design/assets.csv`.
