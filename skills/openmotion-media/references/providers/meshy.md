# Meshy 3D (BYOK)

Checked against the official [Meshy API documentation](https://docs.meshy.ai/en/api) on 2026-11-27. Sections: setup, operations, parameters, animations, errors, sources.

Meshy backs the `3d-asset` capability only. Image, video and audio generation continue through the other providers.

## Setup and discovery

Set `MESHY_API_KEY` in the environment that starts the local OpenGame server or MCP process (`MESHY_API_KEY_FILE` may point to a file containing the key instead). API keys require a paid Meshy plan; there is no free test key. Optional settings:

| Variable | Purpose |
| --- | --- |
| `MESHY_BASE_URL` | API origin, default `https://api.meshy.ai` |
| `MESHY_TASK_TIMEOUT_MS` | Per-task polling deadline, default `600000` (minimum `30000`) |
| `OPENMOTION_MESHY_ENABLED=0` | Ignore a Meshy key that is present in the environment |

When `MESHY_API_KEY` is set, `openmotion_capability_discover(modality="3d", refresh=true)` reports `3d-asset` available with the models `meshy:meshy-7.1` (default), `meshy:meshy-6` and `meshy:meshy-6-lite`. An `OPENMOTION_TRIPO_API_KEY` takes precedence when both are set; pass `model: "meshy:meshy-7.1"` to select Meshy explicitly. Agents never read the key or pass it in tool arguments.

## Operations

Call `openmotion_capability_run` with `capabilityId: "3d-asset"`. Every operation returns one `.glb` asset with the shared result fields (`taskId`, `baseTaskId`, `rigTaskId`, `triangles`, `skins`, `boneNames`, `animationNames`).

| `options.operation` | Meshy tasks | Inputs |
| --- | --- | --- |
| `text_to_model` | Text to 3D preview, then refine (PBR texture) | Prompt, no references |
| `image_to_model` | Image to 3D | Exactly 1 pinned reference image |
| `multiview_to_model` | Multi-Image to 3D (first image is the front view) | 2–4 pinned reference images |
| `rig` | Base mesh (unless `parameters.original_model_task_id`), then Rigging | Prompt or 1–4 references; textured humanoid or quadruped |
| `rig_retarget` | Base mesh, Rigging, then one Animation task with all clips merged | As `rig`, plus animations |
| `retarget` | Animation on an existing rig | `parameters.original_model_task_id` = a previous `rigTaskId` |

`auto` infers the operation from inputs exactly as for other providers. `decimate`, `texture`, `convert`, `segment`, `smartsegment`, `complete`, `uv` and `edit` are not implemented for Meshy and fail before any request.

```json
{"tool":"openmotion_capability_run","arguments":{"capabilityId":"3d-asset","requestId":"meshy-hero-01","model":"meshy:meshy-7.1","prompt":"Stylized knight hero","references":[{"assetId":"A","versionId":"A1"}],"options":{"operation":"rig_retarget","quality":"hero-balanced","rigPreset":"mixamo-locomotion"}}}
```

## Parameters

- `options.quality` sets `target_polycount` (`prop-low` 5,000, `hero-balanced` 10,000, `hero-high` 18,000) with `should_remesh: true` and triangle topology. `parameters.target_polycount` overrides it (100–300,000).
- `parameters.pbr` (default `true`) maps to `enable_pbr`; `parameters.texture: false` returns an untextured mesh (skips the Text to 3D refine step). Rigging needs a textured mesh, so `rig` and `rig_retarget` reject `texture: false` before any request when they would generate the base mesh.
- Forwarded when present: `pose_mode` (`a-pose` or `t-pose`; prefer `a-pose` before rigging), `geometry_resolution`, `decimation_mode`, `moderation`, `auto_size`, `origin_at`, `texture_prompt`, `texture_image_url`, `texture_resolution`, `remove_lighting`.
- Rigging: `parameters.rig_type` (`biped` default, or `quadruped`), `parameters.skeleton_template` (default `mixamo`, so bone names match `vendor/HumanoidRigController.js`), `parameters.height_meters`, `parameters.include_fingers`.
- Reference images are sent as data URIs (PNG, JPEG or WebP; large images are re-encoded to JPEG locally).

## Animations

Animations come from the [Meshy animation library](https://docs.meshy.ai/en/api/animation-library); up to 10 clips per request are merged into one GLB.

- `options.rigPreset` presets work unchanged (`mixamo-idle`, `mixamo-walk`, `mixamo-run`, `mixamo-slash`, `mixamo-locomotion`, `mixamo-combat`).
- `idle`, `walk`, `run`, `slash` and `attack` map to library ids 0, 30, 14, 97 and 4. Other names (`preset:jump`, `hurt`, or a library name such as `Left_Slash`) are looked up with the free `GET /openapi/v1/animations/library?search=` endpoint, taking the first match for the rig type.
- `parameters.action_ids: [0, 92]` passes exact library ids and takes precedence over names; only integers or all-digit strings count, and blank or non-numeric entries are ignored.
- The result reports resolved clip names as `meshyAnimations`.

## Costs, retries and errors

Meshy charges credits per task (about 20–35 for a base mesh, 5 for rigging, 3 per animation clip; see [pricing](https://docs.meshy.ai/en/api/pricing)), so `rig_retarget` submits up to four paid tasks for text input. Confirm spend before submitting.

Meshy has no idempotency header. Each task id is stored in the request checkpoint before polling, so retrying the same `requestId` resumes the original tasks rather than paying again; a different input under the same `requestId` is rejected. Failed tasks surface Meshy's `task_error.message` (for example `image_too_complex` or `moderation_blocked`) and are not resubmitted automatically. HTTP 401 means a missing or invalid key, 402 means insufficient credits or a plan without API access, and 429 is a rate or concurrency limit.

Generated download links expire (three days on most plans); the GLB is copied into the workspace asset library when the task completes.

## Sources

- [Text to 3D](https://docs.meshy.ai/en/api/text-to-3d), [Image to 3D](https://docs.meshy.ai/en/api/image-to-3d), [Multi-Image to 3D](https://docs.meshy.ai/en/api/multi-image-to-3d)
- [Rigging](https://docs.meshy.ai/en/api/rigging), [Animation](https://docs.meshy.ai/en/api/animation), [Animation library](https://docs.meshy.ai/en/api/animation-library)
- [Authentication](https://docs.meshy.ai/en/api/authentication), [Errors](https://docs.meshy.ai/en/api/errors), [Rate limits](https://docs.meshy.ai/en/api/rate-limits), [Pricing](https://docs.meshy.ai/en/api/pricing)
