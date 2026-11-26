---
name: openmotion
description: Connect, set up, and route to OpenMotion's local Studio and MCP workflows across video, games, HTML design, and multimodal media. Use for OpenMotion installation, onboarding, and first-use discovery; an already-selected domain Skill (openmotion-video, openmotion-game, openmotion-design, openmotion-media) continues directly. Repository development does not trigger production workflows.
---

# OpenMotion

Connect your Agent to the local OpenMotion Studio and MCP runtime for editable motion videos, playable browser games, HTML design deliverables, and multimodal media generation through one workspace.

## Connect once

Discover the current host's OpenMotion MCP tools first. If connected, call `openmotion_get_project` to identify the workspace and resume existing work. Preserve projects, credentials, project/version identities and unrelated host settings. Do not reinstall a working connection.

If OpenMotion is missing or disconnected, read the maintained [installation guide](https://github.com/nexu-io/openmotion/blob/main/docs/install.md) and follow its current-host instructions. Source installation is the repository default; follow that same guide's published-application section only when the user explicitly chooses npm. Reuse an existing installation rather than mixing source and npm. Derive onboarding language from the user's request. Follow the guide's shared welcome, three-card and template-library procedure. Show cards whenever this host supports them; use the same three recommendations as text only when card presentation is unsupported or fails. Do not treat the host name as a capability check.

Installing this Skill with Skills CLI installs instructions only. Complete runtime, Studio, MCP and the guide's browser/media prerequisites before claiming production readiness. Use actual startup URLs and transport settings; the Studio URL is not an HTTP MCP endpoint. This version provides local stdio, not a ChatGPT cloud endpoint. Native tools must be discovered and `openmotion_get_project` must succeed in the calling host before claiming that host is connected. A standalone probe has a separate verification scope. Report the concrete blocker when host recovery is needed.

Installation alone does not request a film, project edit, export or paid generation. If the user only asked to install, finish the maintained onboarding and wait. If they already supplied a creative brief, continue with it after setup.

## Continue with the matching domain

Read the selected installed domain Skill, or its full MCP resource through `resources/read`. Resources remain available when only this entry Skill was installed; do not depend on sibling files in a standalone Skills CLI copy.

| User intent | Domain Skill | MCP resource |
| --- | --- | --- |
| Motion video creation, editing, template adaptation, reference recreation, or reusable template packaging | openmotion-video | `openmotion://workflow/video/start` (or direct route: `director`, `production`, `template`, `recreate`, `video-to-template` `/start`) |
| Build or remix a playable browser game | openmotion-game | `openmotion://workflow/game/start` |
| Interactive HTML prototypes, 16:9 slide decks, documents or WebGL deliverables in Design Studio | openmotion-design | `openmotion://workflow/design/start` |
| Atomic capabilities (`remove-background`, `relight`, `camera-control`, `asr-transcribe`) or standalone image/video/audio generation | openmotion-media | `openmotion://workflow/media/start` |

For vertical video recipes (such as digital-human presenter, video dubbing, long-to-short clips or growth teardowns), query the on-demand Skill library with `openmotion_list_skills` and `openmotion_get_skill`.

Continue directly in that domain, preserving the user's brief and existing decisions. These are instructions for the same Agent, not recursive tasks or a new creative intake. The selected domain owns workflow selection, reference reading, revision protection, asset generation, preview and delivery. Read its conditional references as needed; do not load every workflow. Technical export validation, actual playback and human visual acceptance remain separate.
