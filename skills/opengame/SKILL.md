---
name: opengame
description: Build, remix, validate, playtest, and publish playable 2D, 3D, and 9:16 browser games with OpenGame. Preview existing game assets in Studio conversations, including models, animations, sprite atlases, maps and sounds. Set up the local OpenGame Studio and stdio MCP connection when missing. Repository development does not trigger game production.
---

# OpenGame

Turn a brief or built-in template into a verified, playable single-player browser game in the local OpenGame Studio, with headless playtesting, cover capture, trailers, and local or web publishing through the same workspace.

## Connect once

Discover the current host's OpenGame MCP tools first (`openmotion_game_*`, such as `openmotion_game_get` or `openmotion_game_create`). Preserve existing games, credentials, `MOTION_DATA_DIR`, and unrelated host settings. Do not reinstall a working connection.

If OpenGame is missing or disconnected, read the maintained [OpenGame setup guide](https://github.com/nexu-io/opengame/blob/main/docs/opengame-setup.md) and follow its local source-checkout and stdio MCP instructions. Skip the guide's Skills CLI step when this `opengame` Skill is already installed from `nexu-io/opengame`.

Installing this Skill with Skills CLI installs instructions only. Complete the local source checkout, Studio build, stdio MCP registration, and browser/media prerequisites in the setup guide before claiming production readiness. Use actual startup URLs and transport settings; the Studio URL is not an HTTP MCP endpoint. This version provides local stdio MCP, not a hosted cloud MCP endpoint. Native tools must be discovered and verified against the intended workspace before claiming the host is connected. Report concrete blockers when host recovery is needed.

Current public tool names keep the `openmotion_game_*` prefix, the specialist game workflow Skill remains `openmotion-game`, and its MCP resource URI remains `openmotion://workflow/game/start`.

Installation alone does not request creating a game, editing a project, publishing, or paid media generation. If the user only asked to install or connect, finish setup, report the live Game Studio URL (`/game`), and wait. If they already supplied a game brief or template remix request, continue with it after setup.

## Continue with the matching workflow

Read the selected installed Skill, or its full MCP resource through `resources/read`. Resources remain available when only this entry Skill was installed; do not depend on sibling files in a standalone Skills CLI copy.

| User intent | Skill | MCP resource |
| --- | --- | --- |
| Show an existing game asset or link several files for the user to inspect in a Studio conversation | openmotion-game | `openmotion://workflow/game/start` |
| Build, remix, re-style, validate, simulate, playtest, capture cover, export a playable ad or WeChat Mini Game, or publish a playable browser game | openmotion-game | `openmotion://workflow/game/start` |
| Generate standalone game art, textures, sprites, 3D assets, BGM, SFX, or voice via configured BYOK providers or an OpenDesign account | openmotion-media | `openmotion://workflow/media/start` |

Continue directly in that workflow, preserving the user's brief and existing decisions. These are instructions for the same Agent, not recursive tasks or a new intake. The selected workflow owns planning, 3C controls, asset generation, validation, playtesting, and delivery. Read its conditional references only as needed. Technical validation, automated playtesting, and human gameplay acceptance remain separate.
