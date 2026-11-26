# OpenDesign Cloud media

Based on the Cloud media API contract; reviewed 2026-11-17. This is a test-stage contract. Sections: discovery, video model choice, request templates, polling, errors, boundaries.

## Setup and discovery

Open the [Cloud dashboard](https://open-design.ai/cloud/dashboard), select the workspace and open API keys. Save its Cloud Key and the gateway origin shown there in editor **Model providers**. Do not substitute the website origin. A trailing `/v1` is normalized away. Environment alternatives are `OPENDESIGN_API_KEY` and `OPENDESIGN_MEDIA_ORIGIN`; the saved configuration takes priority.

The service injects `Authorization: Bearer ...`. Agents discover with `openmotion_media_use` and generate with `openmotion_assets_use`, never with credential files or key arguments. `OPENDESIGN_MEDIA_ORIGIN` is the dashboard's HTTPS origin without `/v1` or a trailing slash.

```json
{"action":"models","provider":"opendesign","refresh":true,"modality":"image","limit":20}
```

Discovery calls the authenticated `GET /api/v1/media/models?include_audio=true` on the dashboard API origin. The response is `{models:[{model,kind,capabilities}]}`. Change/omit modality to discover video/audio/3D. Account/workspace availability comes from this list, not the example names below. Tool entries are normalized; check the current contract/model capabilities for required options. Cached entries do not establish current entitlement. Billing and credentials belong to the Cloud workspace, not its upstream model vendor; workspace allowance is used first and additional use may consume recharge balance.

The catalogue is bound to the configured key and API origin. Use `action: "models"` with `refresh: true` or Settings → Sync models to refresh it. Explicit `capabilities.edits: false` disables image references; absent or malformed values mean unknown and remain disabled. Refreshing never submits a generation request. Model names and generic image-input metadata do not establish editing access.

Cloud catalogue kinds `audio_speech`, `audio_music`, and `audio_sound_effects` all appear as `modality: "audio"`, with `mode: "text-to-speech"` for speech and `mode: "text-to-audio"` for music (`audioKind: "music"`) and sound effects (`audioKind: "sfx"`, e.g. `elevenlabs-sound-v3`). Spatial kinds `3d_generations` (e.g. `tripo-3.0`) and `world_generations` (e.g. `worldlabs-atlas`) surface through `openmotion_capability_discover` (`modality: "3d"`) as capabilities `3d-asset` and `3d-world` only when returned active by discovery. Legacy `audio` entries retain speech behavior. Use the discovered model's mode and capability; a vendor name alone does not establish what it generates.

## Choosing a video model

When the user has not named a video model and discovery lists both `wan-2.7` and `doubao-seedance-2-5-260628`, use `wan-2.7` for every clip whose duration, resolution and ratio it lists; in OpenMotion trials it finished short clips faster and failed less often. Use Seedance for a clip that needs a longer duration or an option only Seedance lists (at review: Wan 2–15 s, Seedance 4–30 s, with 480p and 21:9 only on Seedance). Read the current values from the catalogue. When a confirmed remote failure leaves a clip to regenerate within the approved retries, switch to the other model only when its current catalogue supports the clip's full duration, resolution and ratio and the user's approval covers that model; otherwise retry on the same model or report the limitation, without changing the requested clip.

## Request templates

These are `openmotion_assets_use` arguments. Select a model actually enabled for this workspace. Each new intended generation needs a unique requestId and may incur charges.

Image:

```json
{"action":"generate","requestId":"cloud-image-01","model":"opendesign:seedream-5.0-flash","modality":"image","mode":"text-to-image","prompt":"A ceramic cup on a wooden table, soft morning light","parameters":{}}
```

Video:

```json
{"action":"generate","requestId":"cloud-video-01","model":"opendesign:doubao-seedance-2-5-260628","modality":"video","mode":"text-to-video","prompt":"Steam rises from a ceramic cup as the camera slowly moves closer","parameters":{"duration":5,"resolution":"720p"}}
```

Speech:

```json
{"action":"generate","requestId":"cloud-speech-01","model":"opendesign:elevenlabs-v3","modality":"audio","mode":"text-to-speech","prompt":"Welcome to a quiet morning.","parameters":{"voice":"JBFqnCBsd6RMkjVDRZzb"}}
```

For Chinese, use model `byteplus-tts-2` with voice `zh_female_vv_uranus_bigtts`. For `elevenlabs-v3` and `byteplus-tts-2`, the `models` action lists checked voices and the default voice in `generationOptions`, and another voice ID belonging to that model is passed through unchecked; other speech models require a voice ID belonging to that model. Neither example proves workspace access.

Image edit and image-to-video take workspace library references through `openmotion_assets_use` (`references: [{assetId, versionId}]`), not provider asset IDs; OpenMotion uploads them. Check `supportsImageReference`, `maxInputImages` and `nativeOptions` from discovery first. For example, edit with two references:

```json
{"action":"generate","requestId":"cloud-edit-01","model":"opendesign:gpt-image-2.6-flare","modality":"image","prompt":"Keep the banana from the first image; light it like the second","references":[{"assetId":"A","versionId":"A1"},{"assetId":"B","versionId":"B1"}],"parameters":{"quality":"low"}}
```

Image-to-video with one first frame:

```json
{"action":"generate","requestId":"cloud-i2v-01","model":"opendesign:wan-2.7","modality":"video","prompt":"The camera slowly moves closer","references":[{"assetId":"A","versionId":"A1"}],"parameters":{"duration":5,"resolution":"720p","ratio":"adaptive"}}
```

For `wan-2.7` and `doubao-seedance-2-5-260628`, a first-frame video follows the input image's aspect ratio. Omit `parameters.ratio` or set it to `"adaptive"`; a fixed value such as `"16:9"` is incompatible with a first frame. The catalogue also lists text-to-video ratios, so its general default does not establish a valid image-to-video combination. If the brief requires a fixed frame, prepare and inspect a reference image at that ratio before submission, keeping the original asset. Do not silently replace an explicitly requested ratio or change the reference image to make a request pass validation.

Native speech options pass through `parameters` unchanged, such as ElevenLabs `voice_settings.speed` or BytePlus `audio_params.speech_rate`. Seedream 5.5 and both video models currently accept one input image; first-and-last-frame video is rejected by the service.

Music:

```json
{"action":"generate","requestId":"cloud-music-01","model":"opendesign:elevenlabs-music-v2","modality":"audio","mode":"text-to-audio","prompt":"Gentle instrumental piano, warm and calm, no vocals","parameters":{"music_length_ms":10000}}
```

`elevenlabs-music-v2` is a built-in entry: the Cloud catalogue does not list it yet, so discovery shows it with `source: "builtin"`. Like the speech examples, it does not prove workspace access. Music does not require a voice. The example requests 10 seconds using the provider-native `music_length_ms` option; accepted parameters and duration limits depend on the selected model. OpenMotion passes music options through without rounding the duration to a preset.

Sound effects (when `audio_sound_effects` such as `elevenlabs-sound-v3` is active in live discovery; keep prompt concise, **≤ 400 characters**, hard cap 450):

```json
{"tool":"openmotion_capability_run","arguments":{"capabilityId":"sound-effects","requestId":"cloud-sfx-01","prompt":"Crisp retro arcade coin pickup chime, bright metallic ping","parameters":{"duration_seconds":1.5,"loop":false,"prompt_influence":0.5}}}
```

3D assets and 3D worlds (only when `openmotion_capability_discover(modality="3d", refresh=true)` reports `3d-asset` or `3d-world` available):

```json
{"tool":"openmotion_capability_run","arguments":{"capabilityId":"3d-asset","requestId":"cloud-3d-01","prompt":"Stylized steampunk knight","references":[{"assetId":"A","versionId":"A1"}],"options":{"operation":"image_to_model","quality":"hero-balanced","rigPreset":"mixamo-run"}}}
```

`3d-asset` supports `operation`: `text_to_model`, `image_to_model` (1 pinned reference image), `rig`, `rig_retarget` (base → Mixamo rig → retarget; up to 3 paid tasks), plus `retarget` / `decimate` / `texture` / `convert` with `parameters.original_model_task_id`; quality presets `prop-low` / `hero-balanced` / `hero-high`; never pass `quad: true`. `3d-world` (`worldlabs-atlas`) follows the Atlas v2 task contract: pure text defaults to `operation: "atlasTextToImage"` (returns a scene concept PNG frame such as `frames_0_image`), `images2PosedRGBD` estimates poses/RGB-D from uploaded reference images, `atlasGenerate` requires native `parameters.contextFrames` + `parameters.targetCameras`, `atlasChisel` performs structural graybox edits, `posedImages2Splats` builds `.spz` Gaussian Splats, and `splats2Mesh` converts splats into a polygonal `.glb` mesh. Downloaded `.glb` or image/video artifacts are imported into Workspace Assets (with optional `parameters.artifact` selection) while preserving all returned `artifacts[]` descriptors in `version.result.artifacts`. On client timeout for `3d-asset`/`3d-world`, re-invoke `openmotion_capability_run` with the exact same `requestId` and inputs to resume from its saved remote task checkpoint without re-billing.

Wire mapping (all paths are relative to the dashboard API origin):

| Type | POST path | JSON body | Poll path |
| --- | --- | --- | --- |
| Image | `/api/v1/media/images/generations` (or `/api/v1/media/images/edits` with references) | `{model,prompt,...parameters}` (top-level `aspect_ratio` + `resolution` packed as `output:{aspect_ratio,resolution}`) | `/api/v1/media/images/tasks/{task_id}` |
| Video | `/api/v1/media/videos/tasks` | `{model,prompt,...parameters}` | `/api/v1/media/videos/tasks/{task_id}` |
| Speech | `/api/v1/media/audio/speech` | `{model,voice,parameters:{text,...options}}` | `/api/v1/media/audio/tasks/{task_id}` |
| Music | `/api/v1/media/audio/music` | `{model,parameters:{prompt,...options}}` | `/api/v1/media/audio/tasks/{task_id}` |
| Sound effects | `/api/v1/media/audio/sound-effects` | `{model,parameters:{text,duration_seconds?,loop?,prompt_influence?}}` | `/api/v1/media/audio/tasks/{task_id}` |
| 3D asset | `/api/v1/media/3d/tasks` | `{model,operation,prompt?,image_asset_ids?,parameters}` | `/api/v1/media/3d/tasks/{task_id}` |
| 3D world | `/api/v1/media/worlds/tasks` | `{model,operation,prompt?,image_asset_ids?,parameters?}` | `/api/v1/media/worlds/tasks/{task_id}` |

For Cloud image requests, `aspect_ratio` and `resolution` represent a paired output profile: when the synced catalogue publishes `capabilities.profiles` (using the `edits` envelope when input references or `parameters.images` are present, and `generations` otherwise), OpenMotion validates against the active envelope, completes a missing half using the envelope's default or first matching pair, and packs the pair into `output: { aspect_ratio, resolution }` on the wire. Unpublished ratios, resolutions, or pairs, as well as combining `size` or `output` with `aspect_ratio`/`resolution`, are rejected before submission. An explicit `parameters.output` object passes through unchanged. When a model publishes no `capabilities.profiles`, passing only one of `aspect_ratio` or `resolution` is rejected before submission; supply both together or pass an explicit `output` object.

The speech adapter extracts `parameters.voice` and nests the remaining options, using the tool's prompt as `parameters.text`. Do not send fal-style flat speech fields.

Every provider submission includes `Idempotency-Key`. The service maps a stable tool requestId to its persisted local job and uses that job's UUID as the provider header; the strings need not match. Repeating an identical tool requestId/body returns the original local job and does not restart it. An exact provider-level submission retry must retain its original idempotency header/body. Changed inputs require a new intended task, not reuse of an old token.

## Polling and output retrieval

Submission returns HTTP 202 and `task_id`; this is acceptance, not an output file. The adapter polls the matching path in the wire mapping above. Wait through `queued`, `pending`, `running`, `processing` or `submitted`. `succeeded` retrieves output; `failed` / `cancelled` ends local work. In the Agent workflow, poll the local ID:

```json
{"action":"status","jobId":"LOCAL_JOB_ID_FROM_GENERATE"}
```

- Image/audio: download `assets[].url` without Cloud Authorization. If a signed URL expires, query the same task for renewed links rather than generating again.
- Video: after success, authenticated GET `/api/v1/media/videos/tasks/{task_id}/content`. The adapter handles direct bytes or a redirect, downloading the redirected media without forwarding Cloud credentials.
- Only local `completed` with imported assets establishes project media availability. Generation alone does not insert timeline clips.

## Error interpretation

The supplied contract does **not** define a complete authoritative Cloud HTTP error-code table. The HTTP rows below are diagnostic hypotheses to confirm using an actual response/current Cloud documentation, not an invented guarantee of Cloud-specific meanings.

| Signal | Interpretation / next action |
| --- | --- |
| HTTP 401 | Authentication was not accepted. Check dashboard API origin/path, Bearer header, selected workspace key and saved-vs-environment source. Do not assert expired key, wrong key or insufficient balance without provider evidence. |
| HTTP 403 / 404 | Check workspace/model/task ownership, endpoint path and access. Confirm the actual Cloud code/message; HTTP status alone does not identify the exact permission/resource issue. |
| HTTP 400 / 422 | Check current contract fields: paired image `aspect_ratio`/`resolution` are sent inside `output`, other image/video fields are flat, speech text is nested and voice must match the model. Inspect actual validation detail if available. |
| Quota/balance rejection | Check workspace model allowance and recharge balance. The contract does not assign one guaranteed HTTP status to this case. |
| HTTP 429 / 5xx / network timeout | Possible limits/transient failure or uncertain outcome. Check the original task/history before another paid submit; do not assume a timeout means no task was created. |
| `audio_outcome_unknown` | Explicit unknown audio outcome. Query the original task and workspace usage before considering another generation. Do not treat it as a definite failure or a refund. |
| `status: failed` / `cancelled` | Terminal task state. Preserve task ID and available detail; transport success is not media success. Local cancellation alone does not prove the provider stopped. |
| Asset download failure after success | Check the original task/output link and expiry first. Regeneration can double-charge and does not fix a stale link. |

Current OpenMotion non-2xx handling does not expose raw Cloud error bodies/headers, and generic failed-task text may omit application codes such as `audio_outcome_unknown`. The suffix `credentials or permissions rejected` is synthesized locally. Report only observed status/detail; when absent, state that the exact cause is unknown and consult the workspace's task/usage view. Never expose keys or authenticated headers.

## Integration boundaries

The contract supplied for this integration is the source for the paths and examples above; no public per-endpoint specification is asserted. Use the [Cloud dashboard](https://open-design.ai/cloud/dashboard) for current API origin, workspace models and access instructions. Verify changed test-stage behavior against the current contract before adapting requests.

Cloud speech and music use distinct submit endpoints and share audio task polling and asset retrieval. Reference images are snapshotted when queued, then uploaded with the three-step upload (create, credential-free PUT, commit). Image models whose catalogue publishes `capabilities.edits: true` submit the returned asset IDs as `images` to `/api/v1/media/images/edits`, up to their `max_input_images`; video models that publish `max_input_images` receive one as `images:[{asset_id, role:"first_frame"}]` on `/api/v1/media/videos/tasks`. Speech result metadata (ElevenLabs character `alignment`, BytePlus `sentences` with word timings) is kept as `job.result` and returned by `status`. Cancellation stops local work without promising a remote cancellation or refund; polling errors/timeouts never trigger automatic paid resubmission.

## Original Cloud task recovery

`resume`, `retry_save` and regeneration follow the [job procedure](../jobs.md). Cloud tasks keep bounded read retries (five attempts) and local timeouts (30 minutes for video, 15 for other media). Interrupted tasks remain failed until explicitly resumed; reconnection never retries upload or generation POSTs. Status and generated asset versions preserve bounded, redacted structured result metadata. Confirmed remote failures retain short error codes and retryable flags and cannot resume, even if the provider labels them retryable. Every returned output is saved with existing media validation. Non-empty parameters.images selects image edits; combining it with pinned local references is rejected before submission.
