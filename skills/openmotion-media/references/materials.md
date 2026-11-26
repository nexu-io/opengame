# Shared media generation and asset contracts

Cross-domain rules for multimodal generation boundaries, capability discovery, asset naming and cross-shot consistency. Every Studio workflow shares this single source of truth; read only the sections needed for the current task.

## Generation boundary

OpenMotion includes built-in AIGC generation for images, video, speech and music. Explicit AIGC requests or missing visual/audio roles that native HTML/SVG/CSS cannot faithfully provide must enter [openmotion-media](../SKILL.md) to inspect the OpenDesign account, OpenDesign Cloud and configured providers; do not fake required imagery, footage, narration or music with native code. Pure native motion graphics without an explicit generation request or new speech/music stay outside media setup, login and billing prompts: do not call, suggest or ask about generation in that case. Preserve user-supplied and approved media, follow the source rules below for factual retrieval, and obtain missing spend consent before generation.

### Generation timing ladder

Choose the lowest-complexity, highest-control source for each shot or audio role from what must actually change on screen or in the mix — across original films, recreations, template adaptations, reusable templates, designs and games:

1. **Reuse or retrieve first**: keep user-supplied and confirmed project assets; for real events, existing brands or known works, retrieve authentic original material instead of fabricating factual evidence with AIGC.
2. **Native code first for editable graphics**: build typography, UI, charts, logos, captions, cards, vector geometry, graphic transitions and camera moves over clean plates in native HTML/SVG/CSS/GSAP/Canvas/WebGL. Never bake editable text, logos, UI or captions into generated pixels.
3. **Generated still + native motion before generated video**: when a shot needs a photographic product, portrait, texture or backdrop whose movement can be carried by native camera pushes, pans, parallax, masks or layered compositing, prefer a clean generated still (or separated subject and backdrop) over video generation — it is faster, steadier, cheaper and easier to keep consistent.
4. **Generated video only for continuous physical motion**: generate video only when the shot requires continuous subject or environmental motion a still cannot carry (hands holding or unfolding a product, human performance, fluid/fabric/smoke, changing reflections, or real 3D parallax and occlusion). Prefer **image-to-video (I2V)** from a verified first frame whenever a specific product, person or setting must stay recognizable; reserve text-to-video (T2V) for pure atmosphere or unanchored scenery.
5. **Audio by role**: keep usable original audio when it serves the project; generate new narration through TTS paired with editable captions when needed; generate new music beds or sound effects with music/SFX models.

Do not upgrade a pure motion-graphics shot to generated video just to look richer, and do not fabricate identifiable real-world product details or people with unanchored T2V.

## Tool selection and discovery

Choose the material source from its content role before selecting tools. Real events and identifiable subjects need corresponding original material; original scenes and supporting expression may use generation or native graphics. For a League of Legends champion's award-ceremony photo, search official or original published photos. Image generation is not a matching capability for retrieving that real event.

For each required operation, inspect OpenMotion's actual available capabilities (`openmotion_capability_discover` when exposed, alongside `openmotion_media_use`). Whenever a live atomic capability in the Unified Capability Center matches the operation (such as `remove-background`, `relight`, `character`, `camera-control`, `multi-shot`, `native-audio`, `speech`, `music` or `asr-transcribe`), invoke it by `capabilityId` through `openmotion_capability_run` rather than simulating background removal or relighting with ad-hoc generic image prompts. Prefer OpenMotion when it can meet that operation's content and output requirements. When it lacks a suitable available capability, use an appropriate external search, browsing, stock-media or generation tool, including tools from other production platforms such as ChatCut. This fallback does not require the user to name the platform; retain existing authorization and explicit source/tool preferences. Retrieval and generation are different operations, as are finding an existing soundtrack and composing a new one.

Use external tools for the operation that needs them and identify their contribution. Continue supported project authoring, editing, preview and export in OpenMotion; sourcing one asset does not move the whole workflow to another platform. OpenMotion's configured BYOK generation remains available through the supporting [media Skill](../SKILL.md) when generation is the appropriate source.

If available tools cannot supply the material, report the specific gap and continue independent work within scope. Use a suitable alternative when it preserves the request; keep original and generated material distinct and report missing media accurately.

## Asset naming

Apply this section when generating, acquiring, importing, deriving or organizing assets. A name helps the user recognize an asset; storage paths and IDs identify its bytes. Change display metadata without moving files, replacing IDs or rewriting composition references.

### 1. Preserve or assign a name

| Asset being added or organized | Action |
| --- | --- |
| Existing asset with a user-assigned name | Preserve it. Rename or translate only when the user requests it. |
| Existing asset with a meaningful filename, library name or template name | Preserve it, even when its use in the film changes. |
| New generated asset | Assign a concise name based on its content and, when useful, its purpose. |
| New asset derived from an existing asset | Retain the recognizable source name and add the confirmed segment or transformation. Keep the original asset unchanged. |
| Existing asset without a meaningful name | Inspect the asset or reliable metadata, then assign a name using confirmed information. |

Empty names, UUIDs, hashes and generic temporary names such as `untitled`, `temp` or `image_001` are not meaningful source names. A meaningful name identifies the material without requiring the user to open it.

### 2. Choose the naming language

For newly assigned names, use this order:

1. An explicit user instruction, within its stated asset or project scope.
2. The project's saved `namingLanguage`.
3. For a project without a saved language, the primary language of its initial creative brief.
4. The interface language when the brief provides no language signal.

Supply a BCP 47 language tag, such as `zh-CN` or `en`, when creating the project. For an existing project without a saved language, set it with the guarded project-edit operation before assigning names. Change a saved language only on explicit user instruction; a single-asset exception does not change it. Later conversation or interface language changes do not change the project's naming language or translate existing names.

Keep established brand, product and font spellings. Write added descriptions in the selected language: `Dia 参考视频－原声` in Chinese, `Dia reference – original audio` in English. Preserve meaningful existing names in any language unless translation is requested. For standalone assets outside a project, use the explicit naming instruction, otherwise the current request's language, then the interface language.

### 3. Write a recognizable name

- Use **content + optional purpose**. Include purpose only when it helps distinguish the asset; do not rename a recognizable source merely because it is used in another scene.
- Use a short noun phrase. Avoid full generation prompts, invented facts, UUIDs, hashes and redundant file-type labels.
- Keep meaningful dates, version numbers, segment ranges and other distinguishing details.
- For a derived asset, use **source name – segment or transformation**, such as `Founder interview – 00:12–00:20` or `Product photo – transparent background`.
- For an unnamed font, use its parsed family and distinguishing weight/style, such as `Inter 700` or `EB Garamond Italic`. Do not infer the family from a UUID.
- If content cannot be identified confidently, use the localized media type and a short sequence, such as `音频 1` or `Audio 1`. Do not infer narration, music or a subject from the extension alone.

### 4. Save and confirm

- Read the project's `namingLanguage`, `assets` and `assetNames` through `openmotion_get_project` before organizing existing material.
- Pass the chosen name through `items[].name` in `openmotion_import_assets`, or `name` in `openmotion_assets_use` when generating or importing library material. Importing a pinned library version preserves its saved library name by default.
- To rename or repair an existing project asset, use `openmotion_edit_project` with `assetNames: [{path, name}]`, the current revision/version guards and a stable request ID. Use `files: []` for a metadata-only change. Do not reimport, regenerate or render merely to change a name.
- Confirm the saved name in the operation result or a project read. The project read model supplies `assetNames` for consistent captions, search and preview. Known media extensions are omitted from captions; original names, paths and IDs remain available as metadata.
- The project display layer distinguishes duplicate captions with `(2)`, `(3)`, etc. Do not scan the entire workspace or add UUID suffixes to deduplicate names. Workspace-library names remain independent of project captions.

Platform type-name fallbacks are localized for the eleven Studio interface languages; unsupported languages currently fall back to English. For another requested naming language, provide a meaningful name explicitly. Semantic naming requires the Agent to inspect the material; the platform does not infer content from file bytes automatically.

## Cross-shot consistency

Apply this pipeline whenever the same product, person or recurring setting spans multiple generated shots across any entry:

1. **Lock one visual anchor first**: start from the user's clean photo or generate and inspect **one** anchor still establishing exact silhouette, details, material, colorway and lighting before generating follow-up shots. Never launch multiple unreferenced text-to-video clips for the same recurring subject.
2. **Choose the first-frame derivation path by shot relationship** (avoid feeding the same initial raw photo into every consecutive clip, which makes the subject snap back to its starting pose and framing on every cut):
   - **Continuous action in the same scene (continuation cut)**: extract a clean handoff or end frame from the verified previous video clip (cropped or reframed to the output aspect ratio) and import it into the library as the next I2V clip's first frame. This preserves spatial continuity, lighting and pose with zero extra image spend.
   - **New camera angle, closer framing, pose or setting (angle/scene change)**: when a reference-capable image-edit model is available and included in the approved spend plan, derive each shot's dedicated first frame from the locked anchor still (plus style/scene reference if needed) at the target canvas aspect ratio. If the user's approved budget covers only the requested video clips without extra paid image edits, stay within that budget by using a clean extracted frame or reframed crop from the previous clip or anchor, and explain any resulting angle limit plainly rather than spending unapproved credits.
3. **Verify every first frame as action-ready before I2V**: inspect each prepared still before submitting video generation — confirm subject identity and key details match the anchor, aspect ratio matches the film canvas (omitting `ratio` or using `"adaptive"` where I2V follows the first frame), the subject starts in the **beginning pose** of the requested action rather than an already-finished state, and every moving part has clear space inside the frame.
4. **Reuse one visual style anchor and plan cut bridges**: carry one concise lighting, color-temperature, lens and texture description across all shots, changing only framing, pose and action per shot. Connect shots intentionally with continuation frames, motion cuts, clean hard cuts or native transitions.
5. **Cross-check frames side-by-side before delivery**: inspect the anchor still alongside each clip's start, mid and end frames to confirm shape, details, palette and cut continuity before polishing or exporting.
