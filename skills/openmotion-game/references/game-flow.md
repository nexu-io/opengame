> See [source and execution notes](../PROVENANCE.md).

# Game Flow — Local Projects, Verification & Delivery

A game is a local HTML/ESM project under workspace `games/<id>/`. HTTP and MCP operate on the same service and files. Follow `SKILL.md` for multimodal asset discovery, spend consent, and routing — this reference covers the execution, verification, and delivery contracts.

## 1. Create & Project Layout

```json
{"tool":"openmotion_game_create","arguments":{"prompt":"<brief summary>","genre":"shooter","style":"3d"}}
```

- Supported `genre` values (`shared/game-contract.ts`): `shooter`, `platformer`, `story` (visual novel), `casual`, `racing`, `horror` (defaults to `casual`). Preserve the exact sub-genre/concept in `prompt`.
- Leave `style` omitted or `null` unless the user requested one of `pixel`, `minimal`, `ascii`, `voxel`, `anime`, `3d`. **Always pass `style: "3d"` on 3D briefs** so vendored Three.js and `vendor/HumanoidRigController.js` are scaffolded.
- Replace the neutral starter (`templates/game-kits/arcade-2d/`) palette, copy, and rules completely.

| Path | Responsibility | Editable via `write_files`? |
|---|---|---|
| `index.html`, `client.js`, `style.css`, `src/*.js` | Presentation, inputs, modular game code | Yes (UTF-8 text only, ≤ 8 MiB/batch) |
| `logic.js` | Optional deterministic 6-export rule module (`meta`, `setup`, `validateAction`, `applyAction`, `isGameOver`, `viewFor`, plus optional `referenceRoute`, `summarize`) | Yes |
| `design/plan.md`, `design/style.md`, `design/assets.csv`, `design/verification.md` | Brief, style, manifest, verification evidence (excluded from publish/export) | Yes |
| `vendor/`, `characters/`, `assets/` | Local runtime libraries/media (preserve licenses) | Local files only (never base64 binaries) |
| `assets-raw/` | Optional 4K raw masters/working files (excluded from publish/export) | Local files only |
| `game.json`, `trailer/` | Service-owned metadata & trailer outputs | Never via `write_files` |

**Media & `.glb` wiring:** Embed generated or imported library media by its complete literal `/motion-api/assets/<assetId>/versions/<versionId>/media` URL (never dynamic string concatenation, or `web_publish` and `exportZip` cannot rewrite it). Local `.glb` models can be imported into the library via `openmotion_asset_manage` / `openmotion_assets_use` (`action:"import"`, `sourcePath:"/abs/path/model.glb"`) — validated with `scripts/game-glb-inspect.mjs` automatically.

## 2. Adaptive Validation & Simulation

- **`openmotion_game_validate`**: checks entry dependencies, CSP/host allowlists, and recursively inspects local relative ESM `import` graphs from `index.html`.
  - When a game uses `logic.js` (or is multiplayer), `validate` runs the deterministic 50-tick `GameRuntime` smoke check (`ctx.random()`, `ctx.now`, `ctx.tick`; no `import`/`require`/`Math.random`/`Date.now`).
  - Solo games authored with custom modular ESM entries that do not import `logic.js` validate cleanly via their ESM graph without false `logic.js` errors.
- **`openmotion_game_simulate`** (for games using `logic.js`): runs seeded deterministic ticks (`players` 1–4, `maxTicks` 1–10000, up to 100,000 scripted inputs, 32 KiB summary via optional `summarize(state)`). Verify `reference` terminal win, explicit weak route struggling/losing, and `idle` terminal loss (`over: true, winners: []`). Never build a fake stub `logic.js` for open sandbox/3D worlds just to call `simulate`; verify those through `openmotion_game_playtest` and `window.__omGame.runSelfTests()`.

## 3. Server-Owned Playtest & Cover Capture

**Never operate or screenshot the user's visible browser, desktop, tabs or profile.** `openmotion_game_playtest` and `openmotion_game_capture_cover` run isolated headless Chrome (SwiftShader, 1280×720, ephemeral loopback server, offline request blocking).

### Client Hook Contract (`window.__omGame`)

```js
window.__omGame = {
  getState() { /* cloned snapshot: { selfId, players: { [id]: { connected: true, x, z } }, phase, result } */ },
  getStats() { /* { fps, drawCalls, triangles, entities, tick, kinematics? } */ },
  sendAction(action) { /* optional validated input helper */ },
  runSelfTests() { /* optional deterministic invariants: { [checkName]: { pass: true, detail: '...' } } */ },
};
```

- `phase` should be `'loading' | 'ready' | 'playing' | 'explore' | 'sandbox' | 'win' | 'loss'`.
- When `phase === 'loading'` (or `#start` is disabled during async GLB/media loading), `playtest` and `capture_cover` wait up to `waitForReadyMs` (0–30000 ms, default 10000 ms) before clicking `#start`.
- **`openmotion_game_playtest` scripts** support `key`, `mouse`, `wait`, `action`, **`{ "type": "screenshot", "label": "midgame" }`**, and **`{ "type": "burst", "count": 4, "intervalMs": 100, "label": "strike" }`** (up to 8 total captures per client under `assets/playtests/`, automatically tiled into `contactSheetPath`). Always pass explicit `scripts` matching real bindings (pass `movementThreshold: 0` for non-moving puzzle/card games).
- If `window.__omGame.runSelfTests()` or `getStats().kinematics` exists, `playtest` automatically runs/checks them and merges assertions alongside `playerCount`, `phase`, `scriptedMovement`, `mobileHorizontalOverflow` (`390×844`), and multiplayer `autoJoin`.
- **`openmotion_game_capture_cover`** captures only the game canvas/`#game` at 1280×720 to `assets/cover.png` and sets metadata. `openmotion_game_update_meta` enforces ≥ 960×540 and 16:9 ±5% covers, plus concise `title`, `description`, `controls`, and `zh-CN` `i18n`.

## 4. Local Publish, Cloud Share (`web_publish`) & Offline ZIP (`exportZip`)

- **Local publish:** `openmotion_game_validate` → `openmotion_game_set_status("ready")` → authorized `openmotion_game_publish` (workspace catalog only; never implies public hosting). Editing source via `write_files` demotes `ready`/`published` back to `building`.
- **Cloud share (`openmotion_assets_use` `action:"web_publish"`, `targetKind:"game"`):** Explicitly requested only (requires signed-in OpenDesign account). Supports `command: "publish" | "status" | "unpublish" | "list"`.
- **Unified lossless delivery (`web_publish` + `exportZip`):** Both share `buildPublishBundle()`:
  1. Excludes `game.json`, `design/`, `trailer/`, `assets/playtests/`, and `assets-raw/`.
  2. Bundles referenced `/motion-api/assets/...` media into `_shared-assets/` and rewrites literal URLs to relative paths.
  3. Automatically transcodes large (≥ 256 KiB) library PNG/JPEG assets to WebP and re-encodes embedded PNG/JPEG textures inside `.glb` files to `EXT_texture_webp` (preserving original resolution, mesh geometry, skins, and animations; falls back cleanly if no local encoder is present).
  4. Reports `sizeBreakdown` (`originalBytes`, `totalBytes`, `savedBytes`, `topFiles`, `advisories`).
  5. `exportZip` also includes zero-dependency local launchers (`serve.mjs` with gzip, `Start-Mac.command`, `Start-Windows.bat`, `PLAY-README.txt`) so unzipped archives run cleanly without `file://` CORS failures.

## 5. Optional Gameplay Trailer & Legacy Multiplayer Rooms

- **Trailer:** Only after local publish and when requested, call `openmotion_game_trailer` (`action: "start" | "status"`). Records three 5-second headless clips, builds an editable Motion project, and exports a silent MP4; report `projectId`, `status`, and `videoUrl` once `ready`.
- **Existing multiplayer rooms (read/verify only):** Connect via `ws(s)://<same-host>/(api|motion-api)/games/<id>/rooms/<room>`, auto-join from `?room=` within 5 s, store opaque `reconnectToken` in `sessionStorage` (30 s seat reservation, in-process only). Public `web_publish` snapshots are static and do not host remote rooms. Apply [Mandatory Multiplayer Entry Acceptance](../SKILL.md#mandatory-multiplayer-entry-acceptance).
