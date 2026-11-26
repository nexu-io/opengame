---
name: openmotion-video
description: >-
  Plan, create, edit, recreate, template-adapt, preview, and export editable motion videos and motion graphics in
  OpenMotion. Covers original films and creative direction (director), scoped edits and exports on existing projects
  (production), reference-video recreation (recreate), catalog template browsing and adaptation (template-to-video),
  and reusable template production (video-to-template). For standalone media assets or atomic capabilities use
  openmotion-media; for Design Studio HTML prototypes/decks use openmotion-design; for playable games use
  openmotion-game. Repository development does not trigger video production.
---

# OpenMotion Video

Unified video production router. Select the single matching workflow below before authoring, editing, or exporting any film project.

## Route first — read the matching workflow before acting

<!-- model-scaffolding: reason="prevent skipping workflow read before tool execution on mid-tier hosts" review-on="next-frontier-model" -->
This entry is a thin router, not an execution playbook. **Always read the matching workflow file (or its MCP resource) in full before creating projects, editing source files, or running exports** unless its complete body is already in context. When a tool payload (such as `openmotion_get_template`'s `workflowGuide`) or task instruction specifies a route, follow it directly without re-routing.
<!-- /model-scaffolding -->

| User intent | Workflow file (read first) | MCP resource |
| --- | --- | --- |
| Original film, creative plan, motion/narrative/sound redesign, creative review, or a reference used only as loose style inspiration | [director](workflows/director.md) | `openmotion://workflow/director/start` |
| Scoped edits on an existing editable project under established decisions (copy, color, local timing, asset/audio swap, preview, troubleshooting, export) | [production](workflows/production.md) | `openmotion://workflow/production/start` |
| Browse/recommend catalog templates, or build/adapt a video from an existing editable template, folder, ZIP, or accepted onboarding sample | [template-to-video](workflows/template-to-video.md) | `openmotion://workflow/template/start` |
| Rebuild a reference video link or finished MP4 into the user's own editable film (including small edits when no editable project exists, or catalog entries with `hasHtmlProject: false`) | [recreate](workflows/recreate.md) | `openmotion://workflow/recreate/start` |
| Rebuild a reference video specifically into a reusable editable template package (folder or ZIP) | [video-to-template](workflows/video-to-template.md) | `openmotion://workflow/video-to-template/start` |

For vertical video recipes (digital-human presenter, dubbing, long-to-short clips, growth teardowns, style packs), query the on-demand library with `openmotion_list_skills` and `openmotion_get_skill`.

## Shared video invariants

- **Connection & identity first**: discover connected OpenMotion MCP tools before claiming execution; report missing/failed connections immediately. Inspect `openmotion_get_project` for `projectId`, `revision`, and `currentVersionId` before editing or exporting, and reuse confirmed projects and completed jobs instead of duplicating work.
- **Read before dependent writes**: finish reading missing workflow docs, target sources, and the pinned engine guide (`openmotion://engine/SKILL.md`) in a read-only step that returns to the model before executing template application, imports, writes, or exports.
- **One active execution context**: switching task scope mid-conversation (e.g. from original creation to a local audio swap) keeps established decisions, locked elements, and existing project history — load only the delta references needed for the new scope.
- **Single-source contracts**: video execution references live under `references/shared/` (full scoped read index and storyboard preview helper in [shared context](references/shared/context.md)); cross-platform multimodal generation boundaries, capability discovery, asset naming, and cross-shot consistency live in [openmotion-media](../openmotion-media/SKILL.md) and its [shared media contracts](../openmotion-media/references/materials.md).
- **Honest evidence**: never claim preview visibility, playback smoothness, audible quality, or visual acceptance without real observed evidence.
