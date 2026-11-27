import { templateEntries } from '../shared/template-attribution.ts';
import { uuid } from './core.ts';
const legacyAssetActions = ['list', 'get', 'import', 'update', 'generate', 'jobs', 'status', 'cancel', 'retry_save', 'resume', 'import_to_project'] as const;
export const assetActions = [...legacyAssetActions, 'read', 'brand_kit', 'transcript', 'scenario', 'batch', 'trigger', 'web_publish'] as const;
const actionSets = {
  openmotion_capability_discover: ['list', 'describe', 'quote', 'providers', 'models'],
  openmotion_capability_run: ['run'],
  openmotion_job_manage: ['list', 'status', 'cancel', 'retry_save', 'resume'],
  openmotion_asset_manage: ['list', 'get', 'read', 'import', 'update', 'import_to_project', 'brand_kit'],
  openmotion_game_trailer: ['start', 'status'],
  openmotion_game_wechat: ['status', 'set_appid', 'confirm', 'confirm_upload', 'ip_check', 'preview', 'upload'],
  openmotion_assets_use: assetActions,
  openmotion_assets: legacyAssetActions,
  openmotion_media_use: ['inspect', 'reference', 'models', 'generate', 'status', 'cancel', 'retry_save', 'resume'],
  openmotion_open_preview: ['open', 'record_review', 'record_display', 'begin', 'complete_generation'],
  openmotion_export_request: ['request', 'record_review'],
  openmotion_project_archive: ['export', 'import'],
  openmotion_manage_project: ['comments', 'info', 'rename', 'duplicate', 'reveal', 'trash', 'restore', 'delete'],
  openmotion_design_catalog: ['list_scenarios', 'list_templates', 'get_template', 'list_skills', 'get_skill', 'list_design_systems', 'get_design_system', 'get_craft'],
  openmotion_design_project: ['create', 'list', 'get', 'rename', 'duplicate', 'trash', 'restore', 'delete', 'open', 'open_in', 'export', 'import', 'deploy', 'deploy_status', 'unpublish'],
  openmotion_design_edit: ['read_file', 'write', 'list_versions', 'restore_version', 'import_asset'],
  openmotion_design_comments: ['list', 'create', 'update', 'delete'],
} as const;
const targets = ['project', 'templates', 'providers', 'game'] as const;
export const capabilityExecutorKinds = ['model', 'prompt-preset', 'dedicated-model', 'service', 'script'] as const;
export const mediaModalities = ['image', 'video', 'audio', '3d'] as const;
export type MediaTelemetryModality = typeof mediaModalities[number];
export const mediaGenerationExecutorKinds = ['gateway', 'script'] as const;
export type MediaGenerationExecutorKind = typeof mediaGenerationExecutorKinds[number];
export const mediaGenerationSpatialKinds = ['asset', 'world'] as const;
export type MediaGenerationSpatialKind = typeof mediaGenerationSpatialKinds[number];
export const mediaGenerationPipelineSteps = ['base', 'rig', 'retarget', 'postprocess', 'world'] as const;
export type MediaGenerationPipelineStep = typeof mediaGenerationPipelineSteps[number];
export const mediaGenerationRouteChannels = ['amr_account', 'amr_opendesign', 'byok_builtin', 'byok_agent', 'byok_custom'] as const;
export type MediaGenerationRouteChannel = typeof mediaGenerationRouteChannels[number];
export const mediaGenerationEntrySurfaces = ['studio', 'mcp_media_use', 'mcp_assets_use', 'mcp_capability_run', 'scenario', 'unknown'] as const;
export type MediaGenerationEntrySurface = typeof mediaGenerationEntrySurfaces[number];
export const mediaGenerationDestinations = ['library', 'project'] as const;
export type MediaGenerationDestination = typeof mediaGenerationDestinations[number];
export const mediaGenerationModes = [
  'text-to-image', 'text-to-video', 'text-to-audio', 'text-to-speech',
  'text-to-3d', 'image-to-3d', 'rig-3d', 'retarget-3d', 'edit-3d',
  'text-to-world', 'image-to-world', 'edit-world',
] as const;
export type MediaGenerationMode = typeof mediaGenerationModes[number];
export const mediaGenerationAudioKinds = ['speech', 'music', 'sfx', 'other'] as const;
export type MediaGenerationAudioKind = typeof mediaGenerationAudioKinds[number];
export const mediaGenerationAccountPlans = ['free', 'go', 'plus', 'pro', 'team', 'enterprise', 'unknown'] as const;
export type MediaGenerationAccountPlan = typeof mediaGenerationAccountPlans[number];
export const mediaGenerationRejectionCategories = [
  'commercial_gate', 'auth_credential', 'client_validation', 'provider_unavailable',
  'runtime_unavailable', 'reference_invalid', 'project_missing', 'config_changed',
  'queue_full', 'local_storage', 'other',
] as const;
export type MediaGenerationRejectionCategory = typeof mediaGenerationRejectionCategories[number];
export const mediaGenerationRejectionReasons = [
  'INVALID_PROMPT', 'INVALID_PARAMETERS', 'INVALID_MODE', 'INVALID_DESTINATION', 'INVALID_USAGE',
  'INVALID_IDEMPOTENCY_KEY', 'IDEMPOTENCY_CONFLICT', 'PROJECT_NOT_FOUND', 'PROJECT_NOT_OPEN',
  'STUDIO_NOT_OPEN', 'NATIVE_RUNTIME_MISSING',
  'CAPABILITY_NOT_FOUND', 'CAPABILITY_COMING_SOON', 'CAPABILITY_DEPRECATED', 'CAPABILITY_CHANNEL_DISABLED',
  'CAPABILITY_UNAVAILABLE', 'CAPABILITY_MODEL_INCOMPATIBLE',
  'ACCOUNT_SIGNED_OUT', 'ACCOUNT_NOT_ENTITLED', 'KEY_REJECTED', 'PROVIDER_NOT_CONFIGURED', 'MODEL_UNAVAILABLE',
  'CONFIG_CHANGED', 'OPTIONS_INVALID', 'REFERENCE_UNSUPPORTED', 'REFERENCE_LIMIT_EXCEEDED',
  'REFERENCE_TOO_LARGE', 'REFERENCE_INVALID_FORMAT', 'REFERENCE_UNREADABLE', 'REFERENCE_CONFLICT',
  'LIBRARY_INVALID', 'QUEUE_FULL', 'NOT_RESUMABLE', 'SAVE_UNAVAILABLE', 'PREFLIGHT_FAILED',
] as const;
export type MediaGenerationRejectionReason = typeof mediaGenerationRejectionReasons[number];
export const mediaGenerationFailurePhases = [
  'precheck', 'uploading', 'submitting', 'generating', 'polling', 'remote_task',
  'downloading', 'decoding', 'saving', 'save_unavailable', 'interrupted', 'cancelled',
] as const;
export type MediaGenerationFailurePhase = typeof mediaGenerationFailurePhases[number];
export const mediaGenerationCancelPhases = [
  'queued', 'starting', 'uploading', 'submitting', 'submitted', 'provider_queue',
  'generating', 'reconnecting', 'downloading', 'saving', 'resuming', 'unknown',
] as const;
export type MediaGenerationCancelPhase = typeof mediaGenerationCancelPhases[number];
export const mediaGenerationCancelSources = ['studio', 'mcp', 'unknown'] as const;
export type MediaGenerationCancelSource = typeof mediaGenerationCancelSources[number];
export const mediaGenerationUpstreamErrorCodes = [
  'unauthorized', 'invalid_request', 'tier_model_not_entitled', 'tier_request_kind_not_entitled',
  'model_access_denied', 'insufficient_balance', 'tier_limit_exceeded', 'video_concurrency_limit_exceeded', 'provider_error',
  'provider_concurrency_exceeded', 'upstream_rate_limited', 'upstream_request_failed',
  'upstream_provider_forbidden', 'audio_outcome_unknown',
  'request_state_unknown', 'media_execution_unknown', 'asset_too_large', 'unsupported_media_type',
  'content_policy_violation', 'safety_blocked', 'rate_limit_exceeded', 'timeout',
  'cancelled', 'internal_error', 'service_unavailable', 'other',
] as const;
export type MediaGenerationUpstreamErrorCode = typeof mediaGenerationUpstreamErrorCodes[number];
export const mediaGenerationErrorCodes = [
  'AUTH_REJECTED', 'PLAN_NOT_ENTITLED', 'BALANCE_LOW', 'RATE_LIMITED', 'INVALID_REQUEST',
  'CONTENT_BLOCKED', 'UPSTREAM_5XX', 'NETWORK_ERROR', 'UPLOAD_FAILED', 'EMPTY_OUTPUT',
  'PROVIDER_UNAVAILABLE', 'CONFIG_CHANGED',
  'TIMEOUT', 'WORKER_INTERRUPTED', 'DOWNLOAD_FAILED', 'INVALID_MEDIA', 'SAVE_FAILED',
  'SAVE_UNAVAILABLE', 'REMOTE_FAILED', 'CANCELLED', 'PROVIDER_ERROR',
] as const;
export type MediaGenerationErrorCode = typeof mediaGenerationErrorCodes[number];
export const mediaGenerationErrorCategories = [
  'commercial_gate', 'byok_billing', 'auth_credential', 'rate_limit', 'client_validation',
  'content_policy', 'timeout', 'provider_unavailable', 'upstream_error', 'network_download',
  'media_invalid', 'local_storage', 'client_interrupted', 'user_cancelled',
] as const;
export type MediaGenerationErrorCategory = typeof mediaGenerationErrorCategories[number];
export const mediaGenerationAspectRatios = [
  '1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9', '4:5', '5:4', 'auto', 'other',
] as const;
export type MediaGenerationAspectRatio = typeof mediaGenerationAspectRatios[number];
export const mediaGenerationResolutions = [
  '480p', '540p', '720p', '1080p', '1k', '2k', '4k', 'auto', 'other',
] as const;
export type MediaGenerationResolution = typeof mediaGenerationResolutions[number];
export const superAgentErrorCodes = [
  'ABORTED', 'INTERRUPTED', 'TIMEOUT', 'AUTH_ERROR', 'RATE_LIMITED', 'RUNTIME_UNAVAILABLE', 'TURN_FAILED',
] as const;

// Mirror of `defaultCapabilities.map(c => c.id)` in `shared/capability-registry.ts` (kept local for Studio/WebMCP bundle isolation; pinned by tests).
export const approvedCapabilityIds = [
  'text-to-image', 'image-edit', 'remove-background', 'image-blend', 'relight',
  'character', 'shot-image', 'inpainting', 'expand-image', 'upscale-4k',
  'batch-set', 'image-layers', 'text-to-video', 'image-to-video', 'camera-control',
  'multi-shot', 'native-audio', 'start-end-frames', 'omni-reference', 'video-edit',
  'video-extend', 'video-upscale-4k', 'motion-control', 'lipsync', 'music',
  'sound-effects', 'speech', 'asr-transcribe', 'voice-clone', 'voice-changer',
  'dubbing', 'stems', 'digital-human', '3d-asset', '3d-world',
] as const;
const approvedCapabilityIdSet: ReadonlySet<string> = new Set(approvedCapabilityIds);
export function safeCapabilityId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return approvedCapabilityIdSet.has(trimmed) ? trimmed : 'other';
}

export function normalizeAccountPlan(plan: unknown): MediaGenerationAccountPlan | undefined {
  if (typeof plan !== 'string') return undefined;
  const normalized = plan.trim().toLowerCase();
  if (!normalized) return undefined;
  return (mediaGenerationAccountPlans as readonly string[]).includes(normalized)
    ? normalized as MediaGenerationAccountPlan
    : 'unknown';
}

export function normalizeCancelPhase(phase: unknown): MediaGenerationCancelPhase {
  if (typeof phase !== 'string') return 'unknown';
  const normalized = phase === 'provider-queue' ? 'provider_queue' : phase;
  return (mediaGenerationCancelPhases as readonly string[]).includes(normalized)
    ? normalized as MediaGenerationCancelPhase
    : 'unknown';
}

export function normalizeAspectRatio(raw: unknown): MediaGenerationAspectRatio | undefined {
  if (typeof raw !== 'string') return undefined;
  const normalized = raw.trim().toLowerCase();
  if (!normalized) return undefined;
  return (mediaGenerationAspectRatios as readonly string[]).includes(normalized)
    ? normalized as MediaGenerationAspectRatio
    : 'other';
}

export function normalizeResolution(raw: unknown): MediaGenerationResolution | undefined {
  if (typeof raw !== 'string') return undefined;
  const normalized = raw.trim().toLowerCase();
  if (!normalized) return undefined;
  return (mediaGenerationResolutions as readonly string[]).includes(normalized)
    ? normalized as MediaGenerationResolution
    : 'other';
}

export function extractRequestedMediaParams(parameters?: Record<string, unknown>) {
  if (!parameters || typeof parameters !== 'object') return {};
  const output = parameters.output && typeof parameters.output === 'object' && !Array.isArray(parameters.output)
    ? parameters.output as Record<string, unknown>
    : undefined;
  const rawDuration = parameters.duration ?? parameters.duration_seconds;
  const parsedDuration = typeof rawDuration === 'number'
    ? rawDuration
    : typeof rawDuration === 'string' && /^\d+(?:\.\d+)?s?$/i.test(rawDuration.trim())
      ? Number(rawDuration.trim().replace(/s$/i, ''))
      : undefined;
  const requested_duration_sec = parsedDuration !== undefined && Number.isFinite(parsedDuration) && parsedDuration >= 0 && parsedDuration <= 600
    ? Math.round(parsedDuration)
    : undefined;
  const requested_aspect_ratio = normalizeAspectRatio(parameters.aspect_ratio ?? parameters.ratio ?? output?.aspect_ratio);
  const requested_resolution = normalizeResolution(parameters.resolution ?? output?.resolution);
  const requested_audio = typeof parameters.generate_audio === 'boolean' ? parameters.generate_audio : undefined;
  return {
    ...(requested_duration_sec !== undefined ? { requested_duration_sec } : {}),
    ...(requested_aspect_ratio ? { requested_aspect_ratio } : {}),
    ...(requested_resolution ? { requested_resolution } : {}),
    ...(requested_audio !== undefined ? { requested_audio } : {}),
  };
}

export function extractHttpStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const raw = (error as { status?: unknown }).status;
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= 100 && raw <= 599 ? raw : undefined;
}

export function extractErrorSource(error: unknown): 'api' | 'storage' | 'download' | 'local' | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const raw = (error as { errorSource?: unknown }).errorSource;
  return raw === 'api' || raw === 'storage' || raw === 'download' || raw === 'local' ? raw : undefined;
}

const upstreamErrorCodeSet: ReadonlySet<string> = new Set(mediaGenerationUpstreamErrorCodes);
export function normalizeUpstreamErrorCode(raw: unknown): MediaGenerationUpstreamErrorCode | undefined {
  if (typeof raw !== 'string') return undefined;
  const normalized = raw.trim().toLowerCase();
  if (!normalized) return undefined;
  return upstreamErrorCodeSet.has(normalized) ? normalized as MediaGenerationUpstreamErrorCode : 'other';
}

export function extractUpstreamErrorCode(error: unknown): MediaGenerationUpstreamErrorCode | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const record = error as { upstreamCode?: unknown };
  // Only read explicit upstreamCode attached by gateway/account error parsers; never read Node/undici errno strings.
  return normalizeUpstreamErrorCode(record.upstreamCode);
}

export const toolDimensions = {
  template_id: 'code', copy_attempt_id: 'uuid', template_entry: templateEntries,
  action: [...new Set(Object.values(actionSets).flat())],
  target: targets,
  modality: mediaModalities,
  capability_id: 'code',
  dry_run: 'boolean',
  executor_kind: capabilityExecutorKinds,
  fallback_raw_model: 'boolean',
} as const;

export function toolInputFields(tool: string, input: unknown) {
  const canonicalTool = tool.startsWith('opengame_') ? 'openmotion_game_' + tool.slice(9) : tool;
  const args = input && typeof input === 'object' && !Array.isArray(input)
    ? input as { action?: unknown; target?: unknown; modality?: unknown; capabilityId?: unknown; dryRun?: unknown; model?: unknown; templateId?: unknown; copyAttemptId?: unknown; templateEntry?: unknown }
    : {};
  const actions: readonly typeof toolDimensions.action[number][] = Object.hasOwn(actionSets, canonicalTool) ? actionSets[canonicalTool as keyof typeof actionSets] : [];
  const defaultAction =
    tool === 'openmotion_export_request'
      ? 'request'
      : tool === 'openmotion_open_preview'
        ? 'open'
        : tool === 'openmotion_capability_run'
          ? 'run'
          : undefined;
  const action = actions.find(value => value === (args.action === undefined ? defaultAction : args.action));
  const target = tool === 'openmotion_open_preview'
    ? targets.find(value => value === (args.target === undefined ? 'project' : args.target)) : undefined;
  const supportsModality = tool === 'openmotion_media_use'
    || tool === 'openmotion_assets_use'
    || tool === 'openmotion_assets'
    || tool === 'openmotion_capability_run'
    || tool === 'openmotion_capability_discover'
    || tool === 'openmotion_open_preview';
  const modality = supportsModality ? mediaModalities.find(value => value === args.modality) : undefined;
  const supportsCapability = tool === 'openmotion_capability_run'
    || tool === 'openmotion_capability_discover'
    || tool === 'openmotion_assets_use';
  const capability_id = supportsCapability ? safeCapabilityId(args.capabilityId) : undefined;
  const dry_run = tool === 'openmotion_capability_run' && typeof args.dryRun === 'boolean' ? args.dryRun : undefined;
  const fallback_raw_model = tool === 'openmotion_capability_run' && !capability_id && typeof args.model === 'string' && args.model.trim().length > 0
    ? true : undefined;
  const templateRead = tool === 'openmotion_get_template' || tool === 'motion_get_template';
  const templateId = templateRead && typeof args.templateId === 'string' && /^[A-Za-z0-9_.-]{1,100}$/.test(args.templateId) ? args.templateId : undefined;
  const copyAttemptId = templateRead && typeof args.copyAttemptId === 'string' && uuid.test(args.copyAttemptId) ? args.copyAttemptId : undefined;
  const templateEntry = templateRead ? templateEntries.find(value => value === args.templateEntry) : undefined;
  return {
    ...(templateId ? { template_id: templateId } : {}), ...(copyAttemptId ? { copy_attempt_id: copyAttemptId } : {}),
    ...(templateEntry ? { template_entry: templateEntry } : {}),
    ...(action ? { action } : {}),
    ...(target ? { target } : {}),
    ...(modality ? { modality } : {}),
    ...(capability_id ? { capability_id } : {}),
    ...(dry_run !== undefined ? { dry_run } : {}),
    ...(fallback_raw_model !== undefined ? { fallback_raw_model } : {}),
  };
}

export function toolResultFields(tool: string, input: unknown, result: unknown) {
  const args = input && typeof input === 'object' && !Array.isArray(input)
    ? input as { capabilityId?: unknown; model?: unknown; modality?: unknown }
    : {};
  const value = result && typeof result === 'object' && !Array.isArray(result)
    ? result as { capabilityId?: unknown; executorKind?: unknown; dryRun?: unknown; modality?: unknown; job?: { modality?: unknown } }
    : {};
  const supportsModality = tool === 'openmotion_media_use'
    || tool === 'openmotion_assets_use'
    || tool === 'openmotion_assets'
    || tool === 'openmotion_capability_run'
    || tool === 'openmotion_capability_discover'
    || tool === 'openmotion_job_manage';
  const modality = supportsModality
    ? mediaModalities.find(m => m === (value.modality ?? value.job?.modality ?? args.modality))
    : undefined;
  if (tool !== 'openmotion_capability_run' && tool !== 'openmotion_capability_discover') {
    return modality ? { modality } : {};
  }
  const capability_id = safeCapabilityId(value.capabilityId ?? args.capabilityId);
  const executor_kind = capabilityExecutorKinds.find(kind => kind === value.executorKind);
  const dry_run = typeof value.dryRun === 'boolean' ? value.dryRun : undefined;
  const fallback_raw_model = tool === 'openmotion_capability_run'
    ? (!capability_id && typeof args.model === 'string' && args.model.trim().length > 0)
    : undefined;
  return {
    ...(modality ? { modality } : {}),
    ...(capability_id ? { capability_id } : {}),
    ...(executor_kind ? { executor_kind } : {}),
    ...(dry_run !== undefined ? { dry_run } : {}),
    ...(fallback_raw_model !== undefined ? { fallback_raw_model } : {}),
  };
}

function inspectWrappedCause(error: unknown): 'timeout' | 'provider_unavailable' | 'network' | undefined {
  let cur: unknown = error && typeof error === 'object' && 'cause' in error ? (error as { cause?: unknown }).cause : undefined;
  for (let depth = 0; depth < 3 && cur && typeof cur === 'object'; depth++) {
    const rec = cur as { name?: unknown; code?: unknown; killed?: unknown; signal?: unknown; message?: unknown; cause?: unknown };
    const code = typeof rec.code === 'string' ? rec.code : '';
    const msg = typeof rec.message === 'string' ? rec.message.toLowerCase() : '';
    if (
      rec.name === 'TimeoutError'
      || code === 'ETIMEDOUT'
      || (rec.killed === true && (rec.signal === 'SIGTERM' || rec.signal === 'SIGKILL'))
      || msg.includes('timed out')
      || msg.includes('timeout')
    ) return 'timeout';
    if (
      rec.name === 'ConnectorUnavailable'
      || code === 'ENOENT'
      || msg.includes('connector unavailable')
      || msg.includes('prepare the account service')
    ) return 'provider_unavailable';
    if (
      /^(ECONNRESET|ECONNREFUSED|ECONNABORTED|EPIPE|ENOTFOUND|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|UND_ERR_)/.test(code)
      || msg.includes('fetch failed')
      || msg.includes('socket hang up')
      || msg.includes('econnreset')
      || msg.includes('enotfound')
      || msg.includes('econnrefused')
    ) return 'network';
    cur = rec.cause;
  }
  return undefined;
}

export function mediaGenerationError(error: unknown, phase?: string): MediaGenerationErrorCode {
  if (phase === 'cancelled') return 'CANCELLED';
  if (phase === 'interrupted') return 'WORKER_INTERRUPTED';
  if (phase === 'save_unavailable') return 'SAVE_UNAVAILABLE';
  const status = extractHttpStatus(error);
  const upstreamCode = extractUpstreamErrorCode(error);
  const source = extractErrorSource(error);
  const text = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const lower = text.toLowerCase();
  const causeKind = status === undefined && !upstreamCode ? inspectWrappedCause(error) : undefined;
  if (lower.startsWith('save_not_available:')) return 'SAVE_UNAVAILABLE';
  // Timeouts (local deadline, subprocess kill timeout, or remote timeout) take precedence over generic phase buckets.
  if (upstreamCode === 'timeout' || lower.includes('timed out') || lower.includes('timeout') || causeKind === 'timeout') return 'TIMEOUT';
  if (phase === 'uploading' && (source === 'storage' || lower.includes('reference upload storage') || lower.includes('reference image put failed'))) return 'UPLOAD_FAILED';
  if (phase === 'downloading' || source === 'download') {
    if (status === 401 && upstreamCode === 'unauthorized') return 'AUTH_REJECTED';
    return 'DOWNLOAD_FAILED';
  }
  if (phase === 'save_failed' || phase === 'saving') return 'SAVE_FAILED';
  if (phase === 'decoding') {
    if (lower.includes('returned no media') || lower.includes('returned no images') || lower.includes('returned no generated image') || lower.includes('without media output') || lower.includes('without a downloadable')) return 'EMPTY_OUTPUT';
    return 'INVALID_MEDIA';
  }
  if (upstreamCode === 'content_policy_violation' || upstreamCode === 'safety_blocked') return 'CONTENT_BLOCKED';
  if (upstreamCode === 'insufficient_balance' || status === 402) return 'BALANCE_LOW';
  if (upstreamCode === 'tier_model_not_entitled' || upstreamCode === 'tier_request_kind_not_entitled' || upstreamCode === 'model_access_denied') return 'PLAN_NOT_ENTITLED';
  if (upstreamCode === 'tier_limit_exceeded' || upstreamCode === 'video_concurrency_limit_exceeded' || upstreamCode === 'rate_limit_exceeded' || upstreamCode === 'provider_concurrency_exceeded' || upstreamCode === 'upstream_rate_limited' || status === 429) return 'RATE_LIMITED';
  if (upstreamCode === 'upstream_provider_forbidden') return 'PROVIDER_UNAVAILABLE';
  if (upstreamCode === 'unauthorized' || status === 401) return 'AUTH_REJECTED';
  if (upstreamCode === 'invalid_request' || upstreamCode === 'asset_too_large' || upstreamCode === 'unsupported_media_type' || status === 400 || status === 413 || status === 422) return 'INVALID_REQUEST';
  if (status !== undefined && status >= 500 && status <= 599) return 'UPSTREAM_5XX';
  if (upstreamCode === 'upstream_request_failed' || phase === 'remote_task') return 'REMOTE_FAILED';
  if (causeKind === 'provider_unavailable' || lower.includes('codex cli is no longer installed')) return 'PROVIDER_UNAVAILABLE';
  if (lower.includes('content policy') || lower.includes('safety policy') || lower.includes('safety system') || lower.includes('prohibited_content') || lower.includes('violates policy') || lower.includes('violates platform security policy')) return 'CONTENT_BLOCKED';
  if (lower.includes('plan does not include') || lower.includes('upgrade your plan')) return 'PLAN_NOT_ENTITLED';
  if (lower.includes('balance') || lower.includes('credit') || lower.includes('insufficient') || lower.includes('quota') || lower.includes('entitlement')) return 'BALANCE_LOW';
  const decisiveNonAuthCode = upstreamCode === 'cancelled';
  const genericApi403Message = status === 403 && lower === 'provider http 403: credentials or permissions rejected';
  const allowGeneric403Auth = !upstreamCode || upstreamCode === 'provider_error' || upstreamCode === 'internal_error' || upstreamCode === 'service_unavailable' || upstreamCode === 'request_state_unknown';
  if (
    !decisiveNonAuthCode
    && (
      lower.includes('401')
      || lower.includes('unauthorized')
      || lower.includes('api key')
      || lower.includes('personal engine key')
      || lower.includes('sign-in is no longer accepted')
      || lower.includes('sign-in was rejected')
      || (genericApi403Message
        ? allowGeneric403Auth
        : ((!upstreamCode && lower.includes('403')) || lower.includes('forbidden') || lower.includes('credentials')))
    )
  ) return 'AUTH_REJECTED';
  if (lower.includes('429') || lower.includes('rate limit') || lower.includes('concurrency limit')) return 'RATE_LIMITED';
  if (lower.includes('configuration changed') || lower.includes('origin changed') || lower.includes('account changed')) return 'CONFIG_CHANGED';
  if (lower.includes('no longer available') || lower.includes('unavailable')) return 'PROVIDER_UNAVAILABLE';
  if (lower.includes('worker stopped') || lower.includes('interrupted')) return 'WORKER_INTERRUPTED';
  if (lower.includes('returned no media') || lower.includes('returned no images') || lower.includes('returned no generated image') || lower.includes('without media output')) return 'EMPTY_OUTPUT';
  if (lower.includes('unsupported media') || lower.includes('could not be decoded') || lower.includes('did not return valid')) return 'INVALID_MEDIA';
  if (lower.includes('download')) return 'DOWNLOAD_FAILED';
  if (causeKind === 'network' || lower.includes('fetch failed') || lower.includes('econnreset') || lower.includes('enotfound') || lower.includes('econnrefused') || lower.includes('socket hang up') || lower.includes('public dns') || lower.includes('check your connection')) return 'NETWORK_ERROR';
  if (lower.includes('task failed') || lower.includes('remote') || lower.includes('generation failed') || lower.includes('generation cancelled') || lower.includes('generation canceled')) return 'REMOTE_FAILED';
  if (status === 403 && !upstreamCode) return 'AUTH_REJECTED';
  return 'PROVIDER_ERROR';
}

export function mediaGenerationErrorCategory(
  errorCode: MediaGenerationErrorCode,
  failurePhase?: MediaGenerationFailurePhase,
  routeChannel?: MediaGenerationRouteChannel,
): MediaGenerationErrorCategory {
  if (errorCode === 'CANCELLED' || failurePhase === 'cancelled') return 'user_cancelled';
  if (errorCode === 'WORKER_INTERRUPTED' || failurePhase === 'interrupted') return 'client_interrupted';
  if (errorCode === 'CONTENT_BLOCKED') return 'content_policy';
  if (errorCode === 'TIMEOUT') return 'timeout';
  if (errorCode === 'BALANCE_LOW' || errorCode === 'PLAN_NOT_ENTITLED') {
    return routeChannel === undefined || routeChannel === 'amr_account' || routeChannel === 'amr_opendesign'
      ? 'commercial_gate'
      : 'byok_billing';
  }
  if (errorCode === 'AUTH_REJECTED') return 'auth_credential';
  if (errorCode === 'RATE_LIMITED') return 'rate_limit';
  if (errorCode === 'INVALID_REQUEST' || errorCode === 'CONFIG_CHANGED') return 'client_validation';
  if (errorCode === 'PROVIDER_UNAVAILABLE') return 'provider_unavailable';
  if (errorCode === 'UPLOAD_FAILED' || errorCode === 'DOWNLOAD_FAILED' || errorCode === 'NETWORK_ERROR' || failurePhase === 'downloading') return 'network_download';
  if (errorCode === 'INVALID_MEDIA') return 'media_invalid';
  if (errorCode === 'SAVE_FAILED' || errorCode === 'SAVE_UNAVAILABLE' || failurePhase === 'saving' || failurePhase === 'save_unavailable') return 'local_storage';
  return 'upstream_error';
}

export function superAgentError(error: unknown, cancelled = false): typeof superAgentErrorCodes[number] {
  if (cancelled) return 'ABORTED';
  const text = (error instanceof Error ? error.message : typeof error === 'string' ? error : '').toLowerCase();
  if (text.includes('abort') || text.includes('cancel')) return 'ABORTED';
  if (text.includes('restart') || text.includes('interrupted')) return 'INTERRUPTED';
  if (text.includes('timeout') || text.includes('timed out')) return 'TIMEOUT';
  if (text.includes('401') || text.includes('403') || text.includes('auth') || text.includes('login') || text.includes('credential') || text.includes('api key')) return 'AUTH_ERROR';
  if (text.includes('429') || text.includes('rate limit') || text.includes('quota')) return 'RATE_LIMITED';
  if (text.includes('bridge') || text.includes('offline') || text.includes('unavailable') || text.includes('not installed') || text.includes('not found')) return 'RUNTIME_UNAVAILABLE';
  return 'TURN_FAILED';
}

export const validationRules = ['missing', 'invalid_type', 'invalid_enum', 'invalid_format', 'out_of_range', 'unknown_field', 'invalid_combination'] as const;
// Keep the ingress allowlist independent of the app and its schema implementation.
const invalidFields = [
  'operation', 'commentId', 'expectedCommentRevision', 'text', 'status', 'anchor', 'anchor.scope',
  'anchor.compositionPath', 'anchor.time', 'anchor.element', 'anchor.element.handle', 'anchor.element.sourceFile',
  'anchor.element.label', 'anchor.element.tagName', 'anchor.element.hfId', 'anchor.element.domId',
  'anchor.element.selector', 'anchor.element.selectorIndex', 'anchor.element.text', 'anchor.element.box',
  'anchor.element.box.x', 'anchor.element.box.y', 'anchor.element.box.width', 'anchor.element.box.height',
  'anchor.annotation', 'anchor.annotation.version', 'anchor.annotation.coordinateSpace', 'anchor.annotation.width',
  'anchor.annotation.height', 'anchor.annotation.marks', 'anchor.annotation.marks[]', 'anchor.annotation.marks[].kind',
  'anchor.annotation.marks[].text', 'anchor.annotation.marks[].points', 'anchor.annotation.marks[].points[]',
  'anchor.annotation.marks[].points[].x', 'anchor.annotation.marks[].points[].y',
  'copyAttemptId', 'templateEntry', 'action', 'all', 'arguments', 'assetId', 'assetNames', 'assetNames[]', 'assetNames[].name',
  'assetNames[].path', 'audio', 'brandKit', 'brandKit.catalogId', 'brandKit.expectedUpdatedAt', 'brandKit.file',
  'brandKit.file.data', 'brandKit.file.name', 'brandKit.kitId', 'brandKit.name', 'brandKit.operation',
  'brandKit.query', 'brandKit.remove', 'brandKit.requestId', 'brandKit.rules', 'brandKit.rules[]', 'brandKit.style',
  'brandKit.style.background', 'brandKit.style.bodyFont', 'brandKit.style.foreground', 'brandKit.style.gradient',
  'brandKit.style.headingFont', 'brandKit.style.onPrimary', 'brandKit.style.primary', 'brandKit.style.radius',
  'brandKit.style.surface', 'brandKit.url', 'changes', 'changes.currentVersionId', 'changes.name',
  'changes.trashed', 'compositionPath', 'conversationId', 'cursor', 'display', 'display.contentVerified',
  'display.evidence', 'display.hostStatus', 'display.hostTabId', 'display.previewUrl', 'display.revision',
  'display.versionId', 'display.visibility', 'duration', 'embedded', 'entry', 'expectedRevision',
  'expectedRevisions', 'expectedTitle', 'expectedVersionId', 'exportJobId', 'file', 'file.length',
  'file.offset', 'file.path', 'files', 'files[]', 'files[].content', 'files[].path', 'generation',
  'includeVideo', 'items', 'items[]', 'items[].itemId', 'items[].licensePath', 'items[].name',
  'items[].sourcePath', 'jobId', 'language', 'limit', 'modality', 'mode', 'model', 'name', 'namingLanguage',
  'offset', 'onboarding', 'parameters', 'parentVersionId', 'presentation', 'projectId', 'projectIds',
  'projectIds[]', 'projectType', 'prompt', 'provider', 'query', 'referenceAsset', 'referenceUrl',
  'referenceVideoId', 'references', 'references[]', 'references[].assetId', 'references[].versionId', 'refresh',
  'requestId', 'requirements', 'review', 'review.conclusion', 'review.evidence', 'review.objectId',
  'review.range', 'review.range.end', 'review.range.start', 'review.source', 'review.versionId', 'sessionId',
  'sort', 'source', 'sourcePath', 'start', 'summary', 'target', 'templateId', 'templateIds', 'templateIds[]',
  'timestamps', 'timestamps[]', 'title', 'transcript', 'transcript.captionSettings',
  'transcript.captionSettings.pacing', 'transcript.captionSettings.position',
  'transcript.captionSettings.preset', 'transcript.captionSettings.scale', 'transcript.captionSettings.visible',
  'transcript.command', 'transcript.compositionPath', 'transcript.expectedRevision',
  'transcript.expectedTranscriptRevision', 'transcript.expectedVersionId', 'transcript.format',
  'transcript.jobId', 'transcript.language', 'transcript.model', 'transcript.parameters',
  'transcript.playbackRate', 'transcript.projectId', 'transcript.remove', 'transcript.requestId',
  'transcript.segments', 'transcript.segments[]', 'transcript.segments[].end', 'transcript.segments[].id',
  'transcript.segments[].speaker', 'transcript.segments[].start', 'transcript.segments[].text',
  'transcript.segments[].words', 'transcript.segments[].words[]', 'transcript.segments[].words[].end',
  'transcript.segments[].words[].start', 'transcript.segments[].words[].text', 'transcript.sourceEnd',
  'transcript.sourcePath', 'transcript.sourceStart', 'transcript.subtitles', 'transcript.textKind',
  'transcript.timelineStart', 'transcript.transcriptId', 'trash', 'trashed', 'unknown_field', 'versionId',
  'workId',
  'id', 'scenario', 'category', 'q', 'referencePath', 'designSystemId', 'editorId', 'format', 'filePath',
  'outputPath', 'path', 'deletes', 'deletes[]', 'anchor.filePath', 'anchor.viewport', 'anchor.viewport.id',
  'anchor.viewport.width', 'anchor.viewport.height', 'anchor.slideIndex', 'anchor.element.elementId',
  'anchor.element.htmlHint', 'anchor.region', 'anchor.region.x', 'anchor.region.y', 'anchor.region.width',
  'anchor.region.height', 'capabilityId', 'capabilityOptions', 'dryRun', 'includeComingSoon', 'options',
  'scenario.command', 'scenario.runId', 'scenario.expectedRevision', 'scenario.requestId', 'scenario.scenarioId',
  'scenario.includeArchived', 'scenario.offset', 'scenario.limit', 'scenario.title', 'scenario.locale',
  'scenario.brief', 'scenario.changes', 'scenario.changes.title', 'scenario.changes.archived',
  'scenario.changes.activeStepId', 'scenario.changes.label', 'scenario.changes.tags', 'scenario.changes.tags[]',
  'scenario.changes.pinned', 'scenario.stepId', 'scenario.status', 'scenario.draft', 'scenario.bindings',
  'scenario.activeIterationId', 'scenario.iterationNote', 'scenario.iterationNote.iterationId',
  'scenario.iterationNote.note', 'scenario.items', 'scenario.items[]', 'scenario.items[].ref',
  'scenario.items[].label', 'scenario.items[].tags', 'scenario.items[].tags[]', 'scenario.items[].stepId',
  'scenario.items[].source', 'scenario.poolItemId', 'scenario.iteration', 'scenario.iteration.source',
  'scenario.iteration.prompt', 'scenario.iteration.settings', 'scenario.iteration.inputs',
  'scenario.iteration.inputs[]', 'scenario.iteration.outputs', 'scenario.iteration.outputs[]',
  'scenario.iteration.note', 'scenario.iterationId', 'scenario.modality', 'scenario.model', 'scenario.mode',
  'scenario.prompt', 'scenario.parameters', 'scenario.referencePoolItemIds', 'scenario.referencePoolItemIds[]',
  'scenario.scene', 'scenario.templateId', 'scenario.designProjectId', 'scenario.expectedDesignRevision',
  'scenario.target', 'scenario.alt', 'scenario.projectType', 'scenario.requirements', 'scenario.poolItemIds',
  'scenario.poolItemIds[]', 'scenario.projectId', 'scenario.stepIds', 'scenario.stepIds[]',
  'scenario.activeOnly', 'scenario.includeStandaloneHtml', 'scenario.includeMotionSource',
] as const;
export const toolErrorCodes = [
  'CAPABILITY_NOT_FOUND', 'CAPABILITY_COMING_SOON', 'CAPABILITY_DEPRECATED', 'CAPABILITY_CHANNEL_DISABLED',
  'CAPABILITY_UNAVAILABLE', 'CAPABILITY_MODEL_INCOMPATIBLE',
  'COMMENT_TARGET_NOT_FOUND', 'COMMENT_NOT_FOUND', 'COMMENT_CONFLICT', 'COMMENT_LIMIT', 'NOT_FOUND', 'UNSUPPORTED',
  'INVALID_ARGUMENT', 'VERSION_CONFLICT', 'PROJECT_NOT_BOUND', 'PROJECT_NOT_FOUND', 'PROJECT_SESSION_MISMATCH',
  'REQUEST_ID_CONFLICT', 'REQUEST_STATE_UNKNOWN', 'MCP_TOOL_NOT_EXPOSED', 'EXPORT_BUSY', 'EXPORT_NOT_FOUND',
  'EXPORT_NOT_COMPLETED', 'TEMPLATE_NOT_FOUND', 'TEMPLATE_NOT_EDITABLE', 'SOURCE_BATCH_TOO_LARGE',
  'INVALID_FILE_TYPE_OR_RESERVED_PATH', 'PROJECT_VALIDATION_FAILED', 'VERSION_NOT_FOUND',
  'WORK_CLOSED', 'WORK_NOT_FOUND', 'WORK_VERSION_MISMATCH', 'WORK_GENERATION_UNTRACKED', 'GENERATION_CONTENT_UNCHANGED',
  'GENERATION_ARTIFACT_INVALID', 'VERSION_NOT_RESTORABLE', 'REVIEW_VERSION_MISMATCH', 'REVIEW_OBJECT_MISMATCH',
  'PREVIEW_TARGET_MISMATCH', 'NATIVE_RUNTIME_NOT_READY', 'EDITOR_RUNTIME_INCOMPATIBLE', 'RUNTIME_NOT_READY',
  'SESSION_NOT_FOUND', 'PROJECT_TRASHED', 'INVALID_CURSOR', 'INVALID_PROJECT_ARCHIVE', 'PROJECT_ARCHIVE_TOO_LARGE',
  'TEMPLATE_NOT_COPYABLE', 'INVALID_REFERENCE_URL', 'INVALID_REVIEW_RANGE', 'UNSUPPORTED_TEXT_TYPE',
  'INVALID_FILE_OFFSET', 'INVALID_UTF8_OFFSET', 'READ_WINDOW_TOO_SMALL', 'TRANSCRIPT_CONFLICT',
  'PROJECT_ARCHIVE_VALIDATION_UNAVAILABLE', 'PROJECT_NOT_READY', 'REVEAL_UNAVAILABLE', 'GENERATION_NOT_FOUND',
  'ASSET_JOB_NOT_FOUND', 'ASSET_NOT_FOUND', 'ASSET_VERSION_NOT_FOUND', 'ASSET_IMPORT_FAILED', 'DUPLICATE_ITEM_ID',
  'FINAL_VIDEO_NOT_READY', 'TEMPLATE_PRESENTATION_INVALID', 'WEBMCP_TRANSPORT_ERROR', 'WEBMCP_CALL_FAILED',
  'STUDIO_TOOL_BLOCKED', 'STUDIO_TOOL_INTERNAL', 'OPENDESIGN_SIGN_IN_REQUIRED', 'ABORTED', 'TOOL_FAILED',
] as const;
export const toolFailureDimensions = { error_code: toolErrorCodes, invalid_field: invalidFields, validation_rule: validationRules } as const;

export function trackingError(error: unknown) {
  const explicit = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
  const code = typeof explicit === 'string' ? explicit : error instanceof Error ? /^([A-Z_]+)(?::|$)/.exec(error.message)?.[1] : undefined;
  return toolErrorCodes.find(value => value === code) ?? 'TOOL_FAILED';
}

export function toolFailureFields(error: unknown) {
  const error_code = trackingError(error);
  if (error_code === 'INVALID_ARGUMENT' && error && typeof error === 'object') {
    const fields = error as { invalid_field?: unknown; validation_rule?: unknown };
    const invalid_field = invalidFields.find(value => value === fields.invalid_field);
    const validation_rule = validationRules.find(value => value === fields.validation_rule);
    if (invalid_field && validation_rule) return { error_code, invalid_field, validation_rule };
  }
  return { error_code };
}

export const assetImportErrorCodes = ['ATTACHMENT_NOT_READABLE', 'ASSET_TOO_LARGE_OR_NOT_FILE', 'INVALID_MEDIA',
  'ITEM_ID_CONFLICT', 'ASSET_NOT_IN_CURRENT_VERSION', 'ASSET_CONTENT_CHANGED', 'FONT_LICENSE_REQUIRES_FONT'] as const;

export function assetImportError(error: unknown) {
  const explicit = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
  if (['ENOENT', 'EACCES', 'EPERM', 'ENOTDIR'].some(value => value === explicit)) return 'ATTACHMENT_NOT_READABLE';
  const code = explicit ?? (error instanceof Error ? /^([A-Z_]+)(?::|$)/.exec(error.message)?.[1] : undefined);
  return assetImportErrorCodes.find(value => value === code) ?? trackingError(error);
}

export const exportFailureStages = ['queued', 'lint', 'render', 'output', 'verification', 'finalize', 'unknown'] as const;
export const exportFailureCodes = ['EXPORT_LINT_FAILED', 'EXPORT_RENDER_FAILED', 'EXPORT_RENDER_TIMEOUT',
  'EXPORT_OUTPUT_MISSING', 'EXPORT_OUTPUT_INVALID', 'EXPORT_VERIFICATION_FAILED', 'EXPORT_VERIFICATION_BLOCKED',
  'EXPORT_FINALIZE_FAILED', 'EXPORT_DEADLINE_EXCEEDED', 'EXPORT_WORKER_INTERRUPTED', 'EXPORT_FAILED'] as const;

export type ExportFailure = { failureStage: typeof exportFailureStages[number]; failureCode: typeof exportFailureCodes[number] };

const gameIdPattern = /^[A-Za-z0-9_.-]{1,128}$/;
const gameStatuses = ['draft', 'building', 'ready', 'published', 'failed'] as const;
type GameToolFields = { game_id?: string; game_status?: typeof gameStatuses[number] };

/**
 * Joins Agent-side game tool calls to the Game Studio funnel. `game_id` is the same catalogue id or UUID that Studio
 * reports; for create it comes from the created card. `game_status` is the game's lifecycle status after the call
 * (set_status, publish, get, create), not the tool outcome. Titles, briefs, files and URLs are never read.
 */
export function gameToolFields(tool: string, input: unknown, result?: unknown): GameToolFields {
  if (!/^(?:(?:openmotion|motion)_game|opengame)_/.test(tool)) return {};
  const args = input && typeof input === 'object' && !Array.isArray(input) ? input as { id?: unknown } : {};
  const value = result && typeof result === 'object' && !Array.isArray(result) ? result as { id?: unknown; status?: unknown; game?: unknown } : {};
  const card = value.game && typeof value.game === 'object' ? value.game as { id?: unknown; status?: unknown } : undefined;
  const id = [args.id, card?.id, /(?:_game|opengame)_(?:get|set_status|update_meta)$/.test(tool) ? value.id : undefined]
    .find(candidate => typeof candidate === 'string' && gameIdPattern.test(candidate)) as string | undefined;
  // Only GameCard shapes carry a lifecycle status; trailer results carry a job status that must not be reported here.
  const statusSource = card ? card.status : /(?:_game|opengame)_(?:get|set_status|update_meta)$/.test(tool) ? value.status : undefined;
  const status = gameStatuses.find(candidate => candidate === statusSource);
  return { ...(id ? { game_id: id } : {}), ...(status ? { game_status: status } : {}) };
}

/** Game tools return a GameCard whose `status: 'failed'` is the game's lifecycle, not a failed tool call. */
export function gameResultStatusIsLifecycle(tool: string) {
  return /^(?:(?:openmotion|motion)_game|opengame)_(?:create|get|set_status|update_meta|publish)$/.test(tool);
}
