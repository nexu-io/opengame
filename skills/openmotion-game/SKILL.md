---
name: openmotion-game
description: Preview existing game models, animation clips, sprite atlases, maps and sounds in Studio chat. Build, remix, validate and locally publish playable single-player browser games through the OpenMotion game tools, including a consistent art direction and real generated image, music and voice assets when media models are available.
---

# OpenMotion Game Studio

## Preview existing assets in chat

When the user asks to inspect existing files, finish with the preview. Game creation, media generation and edits belong to separate requests.

- **Discuss or compare files.** Link each existing file naturally in the answer, using its path relative to the conversation workspace. For example, if the files exist, write `Follow the [coastal path](./maps/coast.tmj) and listen for the [beacon bell](./sound/beacon-chime.wav).` The reader chooses which preview to open. For a sprite atlas or Tiled map, link the manifest and keep its companion images and tilesets at the referenced paths.
- **Open a specific asset now.** Use `openmotion_asset_manage` with `action: "present_asset"` and the target Studio `conversationId`. Supply either a workspace-relative `path` or the library's exact `assetId` and `versionId`. If an external caller lacks the conversation ID, ask for the target Studio conversation URL. The call leaves a link the user can reopen.
- **Show an animation.** For a named clip embedded in a GLB, pass its exact name as `animation`. If the tool reports an unknown name, use the returned available names to resolve the request. Open a standalone BVH by its own path to show the skeleton; applying that motion to a character requires a separate retargeting step.

## Build or remix a game

Turn a brief into a verified local single-player browser game. Resume an explicitly supplied game id, or call `openmotion_game_create` (**pass `style: "3d"` on any 3D brief** so vendored Three.js and `vendor/HumanoidRigController.js` are scaffolded) and read `openmotion_game_get` before editing. Use Remix on a read-only template to create an owned draft. If the user asks for multiplayer, explain that authoring is single-player and ask before adapting (existing multiplayer games remain playable/inspectable). Starter drafts (`plan.md`/`verification.md`) are inputs to revise, never evidence.

`openmotion_game_create` silently checks for updates on a clean `main` checkout at most once per 24 hours (`OPENMOTION_AUTO_UPDATE=0` disables it). If `runtimeUpdate.skillChanged === true`, re-read `openmotion://workflow/game/start`; if `mcpSchemaChanged === true`, note in your final reply that refreshing MCP or starting a new chat exposes new tools; if `restartDeferred === true`, note that restarting the local OpenGame server loads the updated backend.

## 0. Built-in Template Remix Fast Path

When working on an owned copy of a complete, playable built-in template (`remixOf` points to a built-in template with files, cover, controls, and metadata intact), infer whether the user asked for any custom modifications:

- **No custom modifications requested** (empty message, unchanged template brief, or generic "build/make/remix this game" as-is with no overrides or custom assets): deliver immediately with zero rebuild. Do **not** call `openmotion_game_write_files`, `validate`, `playtest`, `simulate`, or `capture_cover`. Silently call `openmotion_game_set_status(id, "ready")` (read `openmotion_game_get(id)` first only if controls/details are missing).
- **Custom modifications requested**: inspect via `openmotion_game_get(id)` and `openmotion_game_read_file(id, path)`, **edit the existing files in place** instead of rewriting from scratch, then verify and deliver below.
- **Reply voice (both paths)**: open your final reply in the user's language as the builder who just finished the game (e.g. `"《<title>》已为你制作完成……"` / `"I've built <title> for you — ..."`), summarize gameplay highlights and controls, and invite next edits. Never mention copying a template, returning existing source files, internal skills/tools, or skipping checks, and never fabricate checks you did not run.

## 1. Route First — Read Only What Applies

Ask **at most two short questions** only when missing: local-market publication consent and (when paid multimodal assets are planned) one batched spend confirmation. Load **only matching references** via MCP resources (`openmotion://workflow/game/<section>`, never stale local plugin caches) — read each needed section completely without slicing off later sections:

| Decision | Options & Rule | Read Only When Matched |
|---|---|---|
| **3C & Space** | `discrete-ui` / `realtime-2d` / `realtime-3d` | [game-3c-modules.md](references/game-3c-modules.md) + [game-feel-craft.md](references/game-feel-craft.md) |
| **Core Loop** | 1 primary (+ ≤ 1 secondary): `puzzle-pressure` / `strategy-combo` / `skill-flow` / `progression-rng` / `sandbox-explore` | [game-genres.md](references/game-genres.md) |
| **Runtime** | Rule/score/turn-heavy → deterministic `logic.js` + `simulate`. Realtime 3D / sandbox → modular local ESM (`src/*.js`) verified via `window.__omGame.runSelfTests()` + `playtest`. Hybrid is also valid. | [game-flow.md](references/game-flow.md) |
| **Track** | **`Full Track`** for `realtime-3d`, `puzzle-pressure`, `strategy-combo`, multi-level/playable-ad, or generated visual/multi-asset packs (BGM-only generation does not upgrade an otherwise **`Fast Track`** game) | [game-gates.md](references/game-gates.md) |
| **Audio & BGM** | Read whenever the game includes music, SFX, or voice (default unless silence is requested) | [game-audio.md](references/game-audio.md) |
| **Specialty Visuals** | Load strictly on demand (`openmotion://workflow/game/animation` mandatory on `realtime-3d` before asset planning) | [sprites](references/game-2d-animation.md), [textures](references/game-textures.md), [3D](references/game-3d-animation.md), [procedural](references/game-procedural-animation.md) |
| **Playable Ad** | Only when brief says **Format: playable ad** | [game-playable-ad.md](references/game-playable-ad.md) |
| **External Lookup** | Only when naming a reference game ("like X") or non-trivial genre/physics/solvable-deal math | [game-lookup.md](references/game-lookup.md) |

**Priority order:** `1. Safety / IP / runtime / spend boundaries` > `2. Explicit user intent ([locked])` > `3. Genre authenticity, 3C readability & invariants` > `4. Open creative exploration` (when style is unlocked, reject generic starter-kit clichés).

## 2. Core Workflow (Concurrent Overlap → Single Integration)

1. **Plan & Genre Authenticity** ([brief](references/game-brief.md), [style](references/game-stylization.md)). In `design/plan.md`, answer: *first-glance identity*, *native fun engine*, and *native outcome model*; list **1 Signature Twist + 1 Peak Moment**, 3–5 concrete invariants (Hard Fails), top `config` levers, `design/style.md` (concise English visual direction), and `design/assets.csv` (tag 3D targets with `priority` `P0-focal` / `P1-instanced` and `reuse_count`, with isolated concept images in Batch 1).
2. **Multimodal-First Asset Routing.** Prioritize generated multimodal assets by default (focal art/sprites/textures, looping BGM/voice/signature SFX, and concept or orthographic 3-view turnaround images → Image-to-3D when live 3D is available) unless the user explicitly requested pure-code / zero-asset output:
   - **Discover live capabilities first (mandatory read-only check):** Run live capability discovery for each planned modality (`"image"`, `"audio"`, `"video"`, plus `"3d"` on 3D briefs) via `openmotion_capability_discover` when exposed, otherwise `openmotion_media_use` (`action:"inspect"` passing `modality`, then `models` with `refresh:true` and `reference`). Prefer usable signed-in OpenDesign (`account` → `opendesign`, `mediaEntitlement` `"included"` or signed-in `"unknown"`, not `"not-included"`), then configured BYOK providers. Use only live-returned IDs.
   - **Route by visual dominance, audio & 3D:** Focus generation on focal anchors (key art/cover, characters, sprites, seamless PBR textures, looping BGM, voice, and live `sound-effects` for signature SFX; synthesize instant UI/micro-SFX in Web Audio). Wire a looping BGM track alongside SFX for every playable game (including playable ads) unless silence is requested. On 3D briefs, read `openmotion://workflow/game/animation` ([game-3d-animation.md](references/game-3d-animation.md)) completely before asset planning: allocate 3D calls strictly to P0 focal actors/weapons and 1–2 P1 instanced props (P2 floors/water/skyboxes stay procedural + 2D PBR), generate isolated concepts or orthographic 3-view turnarounds in Batch 1, use `operation:"rig_retarget"` (plus 1-step `retarget` reusing `rigTaskId`) + `vendor/HumanoidRigController.js` for animated humanoids, and reserve `rigPreset:"none"` for rigid objects. If no live 3D executor is available, fall back only the 3D mesh step to imported/CC0 `.glb` or procedural Three.js while keeping image/audio generation active.
   - **Unavailable, plan-gated, or low-balance recovery (mandatory onboarding):**
     - *Usable Plus+ (`mediaEntitlement:"included"` or signed-in `"unknown"`) or BYOK*: generate normally; never prompt for sign-in or upgrades.
     - *Signed out with no usable API key (`agent_media_signed_out`)*: even if the user did not ask for AI assets, you **must** call `openmotion_open_preview` with the modality-scoped `settingsHandoff` (`target:"providers"`, `entry:"agent_media_signed_out"`), guide the user to sign in (or save an API key), and pause with the two choices below.
     - *Signed in without multimodal subscription (`mediaEntitlement:"not-included"`, Free → `agent_media_upgrade_free`, Go → `agent_media_upgrade_go`) and no BYOK*: you **must** call `openmotion_open_preview` with the modality-scoped `settingsHandoff` (and share `upgrade.url` if returned), explicitly state that their current plan requires subscribing/upgrading to OpenDesign Plus (or adding an API key), and pause with the two choices below.
     - *Rejected API key (`agent_media_key_rejected`)*: call `openmotion_open_preview` with `settingsHandoff` and ask to replace the key (or sign in with OpenDesign Plus).
     - *Two clear pause choices*: (1) sign in / subscribe to OpenDesign Plus (or save an API key) and reply to continue generating AI assets (re-inspect after confirmation), or (2) build a playable code-placeholder prototype first (procedural visuals + WebAudio SFX/BGM). Only fall back without this handoff when the user chooses (2), declines generation, or explicitly requested pure-code output (or for 3D meshes alone when no live 3D model exists); record the reason in `design/assets.csv`.
     - *Plus+ low balance*: never pre-block on cached `hasBalance`; if a real job fails with low balance (`balance is too low` / `insufficient_balance`), stop without retrying, call `openmotion_open_preview(target:"providers", entry:"agent_media_balance_low")`, and ask the user to top up and reply.
   - **One consent → concurrent launch → single inspection:** Ask spend consent once for the planned batch (skip if already granted or managed by host approval; stop after planning if waiting). Submit independent assets concurrently with unique `requestId`s (`openmotion_capability_run` / `openmotion_assets_use action:"generate"`), **build core logic and 3C chassis while jobs run**, poll `openmotion_job_manage` / `action:"status"` (resume timed-out `3d-asset`/`3d-world` calls with the exact same `requestId` and inputs without re-billing), inspect images together via batch contact-sheet `read`, and embed literal `/motion-api/assets/<assetId>/versions/<versionId>/media` URLs (never base64 or dynamic concatenation).
3. **Build (`set_status("building")`, `write_files`)** ([gates](references/game-gates.md), [flow](references/game-flow.md)). Batch cohesive multi-file edits into single `openmotion_game_write_files` calls. Wire completed assets into active gameplay with graceful load fallbacks. Expose `window.__omGame = { getState, getStats, sendAction, runSelfTests }`.
4. **Verify & Polish.**
   - Run `openmotion_game_validate` (checks ESM import graph, CSP/hosts, optional `logic.js` VM, and 3D kinematics static warnings).
   - For games using `logic.js`, run 3-tier `openmotion_game_simulate` (`reference` win, explicit weak route struggling/losing, `idle` loss `< 2500` ticks).
   - Run consolidated `openmotion_game_playtest` with explicit `scripts` (`action`, `screenshot`, and on 3D action games a 3–4 frame `{ type: "burst", count: 4, intervalMs: 100 }` motion capture), `waitForReadyMs` for async builds, and `runSelfTests()` checking your 3–5 core invariants (plus `stats.kinematics` on 3D humanoid builds).
   - For `Full Track` / `realtime-3d`, audit the first passing contact sheet against [review-rubric.md](references/review-rubric.md), fix top defects in one focused polish pass, re-verify with `playtest`, and log real measurements + `Known gaps (P2)` in `design/verification.md`.
5. **Deliver (`capture_cover` → `verification.md` → `validate` → `update_meta` → `ready` → authorized `publish`).** Capture a game-only 1280×720 cover via `openmotion_game_capture_cover` (never the user's browser/desktop), inspect it, then update concise metadata + `zh-CN` translations via `openmotion_game_update_meta`. Remember `write_files` demotes `ready` to `building`.
6. **Sharing, WeChat Mini Game & Offline Export.** `openmotion_game_publish` is workspace-local only. For a public link (only when requested and signed in), call `openmotion_assets_use` (`action:"web_publish"`, `targetKind:"game"`). If it fails with `OPENDESIGN_SIGN_IN_REQUIRED` / `AUTH_REQUIRED`, do not retry — direct the user to click the inline "Sign in & publish" card (inside Studio do not also open `/settings/providers`; external MCP-only hosts may call `openmotion_open_preview(target:"providers", entry:"agent_media_signed_out")`). Both `web_publish` and `exportZip` exclude `design/`, `trailer/`, `publish/`, `assets/playtests/`, `assets-raw/`, rewrite literal `/motion-api/assets/...` URLs, and auto-optimize large images and GLB textures to WebP. For WeChat Mini Game export, follow [wechat-minigame-port.md](references/wechat-minigame-port.md) one step at a time with `openmotion_game_wechat`.
7. **Final message** (plain language, user's language, no tool names/ids/JSON): bold playable summary; play link; real controls + 3–5 `config` levers; verified vs unverified (human fun, real GPU/touch, audio); spend note & cover path; up to 5 numbered P2 items per [game-gates.md](references/game-gates.md#reporting-p2-to-the-user).

## MCP Resources & Optional Post-Publish Trailer

MCP-only hosts read `openmotion://workflow/game/<section>` (`start`, `brief`, `gates`, `controls`, `craft`, `lookup`, `design`, `style`, `genres`, `playable`, `flow`, `sprites`, `animation`, `procedural`, `textures`, `audio`, `review`, `provenance`, `wechat`) and `openmotion://workflow/media/*`.

After publishing, optionally offer `openmotion_game_trailer` (`{ id, action: "start" | "status" }`). Wait for `status: "ready"`, inspect the silent 1280×720 MP4/clips, and report `projectId` and `videoUrl`.

## Mandatory Multiplayer Entry Acceptance

For diagnosing or verifying existing multiplayer projects only: clients must auto-join from `?room=` within 5 seconds without room-code inputs or a Join room button, expose Copy invite link + Start, pass `openmotion_game_validate` room checks, and pass `openmotion_game_playtest` `autoJoin` assertions before inputs.

See [PROVENANCE.md](PROVENANCE.md) and [LICENSE-HIGGSFIELD](LICENSE-HIGGSFIELD).
