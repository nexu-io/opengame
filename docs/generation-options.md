# Generation options

Studio, external MCP callers and the embedded asset Agent receive the same optional `Model.generationOptions` from Model Gateway discovery. `shared/generation-options.ts` maintains exact provider/model profiles. The service validates known fields before queueing a new job; idempotent replay returns the original job. Unknown model IDs receive no guessed profile. Advanced JSON remains available for provider-specific fields, including custom FLUX image dimensions.

Quick controls override matching advanced fields; request parameters override saved model defaults. Unchanged fields are omitted and inherit saved/provider defaults. Studio preserves separate parameter drafts for each model while the creator is open. These drafts are not account settings. Returned jobs and asset versions record actual submitted parameters. Local Codex image preferences are appended to its instruction: they are creative requests, not guaranteed raster specifications.

## Maintained profiles

Checked on 2026-11-15 against the following official endpoint schemas and current adapters:

| Exact endpoint | Quick controls | Source |
| --- | --- | --- |
| `codex:image-generation` | Requested aspect ratio and background, delivered as prompt preferences | `gateway/agents.ts`, `gateway/service.ts` |
| `atlascloud:google/nano-banana-2/text-to-image` | Aspect ratio, resolution, format, thinking level, web search, seed | [Atlas schema](https://www.atlascloud.ai/docs/more-models/google/nano-banana-2-text-to-image/generateImage) |
| `atlascloud:bytedance/seedance-2.0/text-to-video` | Ratio, resolution, integer duration, audio, bitrate, seed | [Atlas schema](https://www.atlascloud.ai/docs/more-models/bytedance/seedance-2.0-text-to-video/generateVideo) |
| `atlascloud:suno/chirp-v4` | Instrumental-only and vocal gender; prompt remains an inspiration brief | [Atlas schema](https://www.atlascloud.ai/docs/more-models/suno/chirp-v4/generateAudio) |
| `fal:fal-ai/flux/schnell` | Image size, output count, format, seed | [fal schema](https://fal.ai/models/fal-ai/flux/schnell/api) |
| `fal:fal-ai/wan/v2.2-a14b/text-to-video` | Ratio, resolution, frames, frame rate, prompt expansion, negative prompt, seed | [fal schema](https://fal.ai/models/fal-ai/wan/v2.2-a14b/text-to-video/api) |
| `fal:fal-ai/kokoro/american-english` | Voice (20 American English presets with bundled Apache-2.0 Kokoro-82M audition samples in Sound Studio) and speed; spoken input uses `prompt` | [fal schema](https://fal.ai/models/fal-ai/kokoro/american-english/api) |
| `fal:fal-ai/elevenlabs/sound-effects/v2` | Duration (0.5–22s) and seamless loop; sound cue input uses `text` | [fal schema](https://fal.ai/models/fal-ai/elevenlabs/sound-effects/v2/api) |
| OpenDesign Cloud/account image | Aspect ratio, resolution (paired from the active `generations` or `edits` envelope in `capabilities.profiles`; both Cloud and account pack paired fields into `output: { aspect_ratio, resolution }` over HTTP and reject incomplete pairs when no profiles are published as well as `size` combined with `aspect_ratio`, `resolution` or `output`), legacy image size (when no profiles are published), and quality | Current Cloud/account `/api/v1/media/models` catalogue contract |
| OpenDesign Cloud/account video | Dynamic `ratio`, `resolution`, integer `duration` (slider for contiguous ranges, discrete pills for small sets) from published `capabilities` (plain AMR arrays default to their first published value), plus `generate_audio` (enabled by default for Seedance 2.5; always on for `wan-2.7` and `magi-2`, rejecting `generate_audio=false` locally and omitting unchanged fields on direct HTTP `/api/v1/media/videos/tasks`; forward-compatible with JSON Schema `const: true` / single-value `enum: [true]`) | Current Cloud/account `/api/v1/media/models` catalogue contract |
| OpenDesign Cloud/account speech | `elevenlabs-v3` (with official premade `previewUrl`s) and `byteplus-tts-2` (10 preset voices from the OpenDesign Cloud API docs, with bundled Vivi audition sample in Sound Studio), defaulting to the first; another non-empty voice ID for the same model is passed through unchecked. Other speech models require a voice ID | Current Cloud/account adapter & OpenDesign Cloud API docs |
| OpenDesign Cloud/account music | Optional whole-second duration | Both Cloud and account map `duration` to `music_length_ms` on `/api/v1/media/audio/music`; the catalogue publishes no range |

**Interim fallback priority & retirement (`OPEND-5839`)**: For OpenDesign Cloud and account models, live `/api/v1/media/models` `capabilities` (and future `expand=schema` JSON Schema definitions) always take precedence over static rules. Every interim local fallback that fills missing server schema fields (speech voices, audio/SFX/3D static parameters, forced-audio video model IDs, GPT Image 2.6 transparent background, first-frame ratio rules, and 2 MiB upload cap) is tagged with `TODO(OPEND-5839)` so it can be cleanly removed once AMR ships full schema expansion. If a newly surfaced model still publishes empty capabilities or fails with an unexpected `400`/`422`, Agent references direct fallback lookup exclusively to the official OpenDesign Cloud API docs (`https://open-design.ai/help/cloud-api`)—never upstream vendor API docs.

These controls cover a maintained subset, not all models or all provider parameters. Custom model names and live catalogue labels do not establish wire compatibility. Provider-native types remain intact: Seedance duration is an integer, audio is a boolean, and Wan takes frames rather than a fabricated duration field. Local asset references are limited to image models that report `supportsImageReference`: the Codex image adapter and OpenDesign account image models whose catalogue publishes `edits`. No local-upload support is inferred from a model accepting remote reference URLs.

The embedded Codex conversation separately exposes model selection and discovered reasoning efforts. Effort is passed as `turn/start.effort`, with `null` restoring the model default on subsequent turns. This field was checked against the installed Codex app-server JSON schema. Other Agents continue to use external MCP; selecting a local CLI in settings does not add an embedded runner.

## Interaction and validation

Generation settings use an anchored, non-modal popover with ratio tiles, selections, switches and bounded numeric controls. Known failures use the shared Toast layer. The asset navigation and creation pane have drag separators, keyboard arrows (Shift for larger steps), Home/End limits and double-click reset. Width preferences survive reloads; available content space bounds their rendered widths, and narrow creation uses the whole workspace.

Deterministic tests cover model discovery, invalid native parameter types, queued parameter identity, replay without another submission, Kokoro wire mapping, reasoning forwarding, JSON/control precedence and pane persistence/bounds. Browser inspection covers opened nested menus, actual drags, both themes and narrow layouts. Live paid generation, provider entitlement and human visual acceptance remain separate.
