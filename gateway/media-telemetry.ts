import { randomUUID } from 'node:crypto';
import type { OmTracking } from '../shared/tracking.ts';
import type { GenerationJob, Model } from '../shared/gateway.ts';
import { isGatewayProvider } from '../shared/provider-registry.ts';
import { classifyAudioKind } from '../shared/audio-kind.ts';
import { ToolInputError } from '../shared/tool-input-error.ts';
import { modelId as modelIdPattern, slug, uuid as uuidPattern } from '../tracking/core.ts';
import { validHostContext, type HostContext } from '../tracking/host.ts';
import {
  extractErrorSource,
  extractHttpStatus,
  extractRequestedMediaParams,
  extractUpstreamErrorCode,
  mediaGenerationError,
  mediaGenerationErrorCategory,
  mediaGenerationModes,
  mediaModalities,
  normalizeAccountPlan,
  safeCapabilityId,
  type MediaGenerationAccountPlan,
  type MediaGenerationAudioKind,
  type MediaGenerationCancelPhase,
  type MediaGenerationCancelSource,
  type MediaGenerationDestination,
  type MediaGenerationEntrySurface,
  type MediaGenerationErrorCategory,
  type MediaGenerationErrorCode,
  type MediaGenerationExecutorKind,
  type MediaGenerationFailurePhase,
  type MediaGenerationMode,
  type MediaGenerationPipelineStep,
  type MediaGenerationRejectionCategory,
  type MediaGenerationRejectionReason,
  type MediaGenerationRouteChannel,
  type MediaGenerationSpatialKind,
  type MediaTelemetryModality,
} from '../tracking/tool-fields.ts';
import { productionApi } from './opendesign.ts';

const APPROVED_SPATIAL_MODELS = new Set(['tripo-3.0', 'worldlabs-atlas']);
const MAX_OUTPUT_BYTES_FIELD = 536_870_912;

export function clampMs(value: number): number {
  return Math.min(86_400_000, Math.max(0, Math.round(value)));
}

export function isMediaTelemetryModality(value: unknown): value is MediaTelemetryModality {
  return typeof value === 'string' && (mediaModalities as readonly string[]).includes(value);
}

export function normalizeTrackingHost(host?: HostContext): HostContext | undefined {
  return validHostContext(host) && host.host_agent !== 'unknown' ? host : undefined;
}

export function jobTrackingHost(job: GenerationJob): HostContext | undefined {
  return validHostContext(job.trackingHost) ? job.trackingHost : undefined;
}

export function spatialKindForCapability(capabilityId?: string, scriptId?: string): MediaGenerationSpatialKind | undefined {
  if (capabilityId === '3d-world' || scriptId === 'opendesign-world') return 'world';
  if (capabilityId === '3d-asset' || scriptId === 'opendesign-3d') return 'asset';
  return undefined;
}

export function extractRequestReferenceMeta(input?: {
  references?: unknown;
  referenceAsset?: unknown;
  parentVersionId?: unknown;
  parameters?: unknown;
  library?: { references?: unknown; parentVersionId?: unknown } | null;
}): { referenceCount: number; isEdit: boolean } {
  const paramImagesCount = input?.parameters && typeof input.parameters === 'object' && !Array.isArray(input.parameters)
    && Array.isArray((input.parameters as { images?: unknown }).images)
    ? (input.parameters as { images: unknown[] }).images.length
    : 0;
  const topRefs = Array.isArray(input?.references) ? input.references.length : 0;
  const libRefs = Array.isArray(input?.library?.references) ? input.library.references.length : 0;
  const refAsset = typeof input?.referenceAsset === 'string' && input.referenceAsset ? 1 : 0;
  const referenceCount = topRefs + libRefs + refAsset + paramImagesCount;
  const isEdit = referenceCount > 0 || Boolean(input?.parentVersionId ?? input?.library?.parentVersionId);
  return { referenceCount, isEdit };
}

export function providerTrackingMeta(model: Model) {
  const provider_kind: 'builtin' | 'custom' | 'account' | 'agent' =
    model.provider === 'account' ? 'account'
      : model.provider === 'codex' ? 'agent'
        : isGatewayProvider(model.provider) ? 'builtin' : 'custom';
  const route_channel: MediaGenerationRouteChannel =
    model.provider === 'account' ? 'amr_account'
      : model.provider === 'opendesign' ? 'amr_opendesign'
        : model.provider === 'codex' ? 'byok_agent'
          : isGatewayProvider(model.provider) ? 'byok_builtin' : 'byok_custom';
  const model_provider = provider_kind !== 'custom' && slug.test(model.provider) ? model.provider : undefined;
  const model_id = provider_kind !== 'custom' && model.source !== 'custom' && modelIdPattern.test(model.modelId)
    ? model.modelId : undefined;
  const generation_mode = (mediaGenerationModes as readonly string[]).includes(model.mode)
    ? model.mode as MediaGenerationMode : undefined;
  let audio_kind: MediaGenerationAudioKind | undefined;
  if (model.modality === 'audio') {
    const rawKind = classifyAudioKind(model.id, model.mode, 'generated', `${model.modelId} ${model.label}`);
    audio_kind = rawKind === 'speech' || rawKind === 'music' || rawKind === 'sfx' ? rawKind : 'other';
  }
  return {
    provider_kind,
    route_channel,
    ...(model_provider ? { model_provider } : {}),
    ...(model_id ? { model_id } : {}),
    ...(generation_mode ? { generation_mode } : {}),
    ...(audio_kind ? { audio_kind } : {}),
  };
}

export function scriptProviderTrackingMeta(input: {
  provider?: string;
  modelId?: string;
  providerOrigin?: string;
  mode?: MediaGenerationMode;
  accountPlan?: string;
}): {
  provider_kind?: 'builtin' | 'custom' | 'account' | 'agent';
  route_channel?: MediaGenerationRouteChannel;
  model_provider?: string;
  model_id?: string;
  generation_mode?: MediaGenerationMode;
  account_plan?: MediaGenerationAccountPlan;
} {
  const generation_mode = input.mode && (mediaGenerationModes as readonly string[]).includes(input.mode)
    ? input.mode
    : undefined;
  if (!input.provider) {
    return generation_mode ? { generation_mode } : {};
  }
  if (input.provider === 'account') {
    const model_id = input.modelId && APPROVED_SPATIAL_MODELS.has(input.modelId) ? input.modelId : undefined;
    const account_plan = normalizeAccountPlan(input.accountPlan);
    return {
      provider_kind: 'account' as const,
      route_channel: 'amr_account' as const,
      model_provider: 'account',
      ...(model_id ? { model_id } : {}),
      ...(generation_mode ? { generation_mode } : {}),
      ...(account_plan ? { account_plan } : {}),
    };
  }
  if (input.provider === 'opendesign') {
    const model_id = input.modelId && APPROVED_SPATIAL_MODELS.has(input.modelId) ? input.modelId : undefined;
    return {
      provider_kind: 'builtin' as const,
      route_channel: 'amr_opendesign' as const,
      model_provider: 'opendesign',
      ...(model_id ? { model_id } : {}),
      ...(generation_mode ? { generation_mode } : {}),
    };
  }
  if (input.provider === 'env') {
    const normalizedOrigin = input.providerOrigin?.replace(/\/+$/, '');
    const isProdSpatial = normalizedOrigin === productionApi && !!input.modelId && APPROVED_SPATIAL_MODELS.has(input.modelId);
    if (isProdSpatial) {
      return {
        provider_kind: 'builtin' as const,
        route_channel: 'amr_opendesign' as const,
        model_provider: 'opendesign',
        model_id: input.modelId,
        ...(generation_mode ? { generation_mode } : {}),
      };
    }
    return {
      provider_kind: 'custom' as const,
      route_channel: 'byok_custom' as const,
      ...(generation_mode ? { generation_mode } : {}),
    };
  }
  return {
    provider_kind: 'custom' as const,
    route_channel: 'byok_custom' as const,
    ...(generation_mode ? { generation_mode } : {}),
  };
}

export function generationTrackingFields(job: GenerationJob) {
  const capability_id = safeCapabilityId(job.capabilityId ?? job.library?.capabilityId);
  const paramImages = Array.isArray(job.parameters?.images) ? job.parameters.images.length : 0;
  const reference_count = (job.references?.length ?? (job.reference ? 1 : 0)) + paramImages;
  const destination: MediaGenerationDestination = job.library ? 'library' : 'project';
  const is_edit = reference_count > 0 || Boolean(job.library?.parentVersionId);
  const entry_surface: MediaGenerationEntrySurface = job.entrySurface ?? 'unknown';
  const account_plan = job.model.provider === 'account' ? job.accountPlan : undefined;
  return {
    executor_kind: 'gateway' as const,
    ...providerTrackingMeta(job.model),
    ...(capability_id ? { capability_id } : {}),
    entry_surface,
    destination,
    reference_count,
    is_edit,
    ...(account_plan ? { account_plan } : {}),
    ...extractRequestedMediaParams(job.parameters),
  };
}

export type LiveTimings = {
  uploadMs?: number;
  remoteMs?: number;
  downloadMs?: number;
  saveMs?: number;
  reconnectedCount?: number;
};

export type StageTimingTracker = {
  get activeStage(): MediaGenerationFailurePhase;
  get pipelineStep(): MediaGenerationPipelineStep | undefined;
  get remoteTerminal(): boolean;
  get hasRemoteId(): boolean;
  get remoteId(): string | undefined;
  setActiveStage: (stage: MediaGenerationFailurePhase) => void;
  startRemoteDirect: (now?: number) => void;
  markStage: (
    phase: string,
    options?: {
      isAgentProvider?: boolean;
      remoteId?: string;
      remoteTerminal?: boolean;
      pipelineStep?: MediaGenerationPipelineStep;
      now?: number;
    },
  ) => void;
  snapshot: (now?: number) => LiveTimings;
  finish: (now?: number) => LiveTimings;
};

export function createStageTimingTracker(initialStage: MediaGenerationFailurePhase = 'precheck'): StageTimingTracker {
  let activeStage: MediaGenerationFailurePhase = initialStage;
  let pipelineStep: MediaGenerationPipelineStep | undefined;
  let remoteTerminal = false;
  let hasRemoteId = false;
  let remoteId: string | undefined;
  let uploadStartMs: number | undefined;
  let uploadMs: number | undefined;
  let remoteStartMs: number | undefined;
  let remoteMs: number | undefined;
  let downloadStartMs: number | undefined;
  let downloadMs: number | undefined;
  let saveStartMs: number | undefined;
  let saveMs: number | undefined;
  let reconnectedCount = 0;

  const closeUpload = (now: number) => {
    if (uploadStartMs !== undefined) {
      uploadMs = (uploadMs ?? 0) + Math.max(0, now - uploadStartMs);
      uploadStartMs = undefined;
    }
  };
  const closeRemote = (now: number) => {
    if (remoteStartMs !== undefined) {
      remoteMs = (remoteMs ?? 0) + Math.max(0, now - remoteStartMs);
      remoteStartMs = undefined;
    }
  };
  const closeDownload = (now: number) => {
    if (downloadStartMs !== undefined) {
      downloadMs = (downloadMs ?? 0) + Math.max(0, now - downloadStartMs);
      downloadStartMs = undefined;
    }
  };
  const closeSave = (now: number) => {
    if (saveStartMs !== undefined) {
      saveMs = (saveMs ?? 0) + Math.max(0, now - saveStartMs);
      saveStartMs = undefined;
    }
  };

  return {
    get activeStage() { return activeStage; },
    get pipelineStep() { return pipelineStep; },
    get remoteTerminal() { return remoteTerminal; },
    get hasRemoteId() { return hasRemoteId; },
    get remoteId() { return remoteId; },
    setActiveStage(stage: MediaGenerationFailurePhase) {
      activeStage = stage;
    },
    startRemoteDirect(now = Date.now()) {
      remoteStartMs ??= now;
    },
    markStage(phase, options = {}) {
      const now = options.now ?? Date.now();
      if (options.pipelineStep && options.pipelineStep !== pipelineStep && !options.remoteId) {
        remoteId = undefined;
      }
      if (options.remoteId) {
        hasRemoteId = true;
        remoteId = options.remoteId;
      }
      if (options.remoteTerminal) remoteTerminal = true;
      if (options.pipelineStep) pipelineStep = options.pipelineStep;

      if (phase === 'uploading') {
        if (remoteMs === undefined && !hasRemoteId) {
          remoteStartMs = undefined;
        } else {
          closeRemote(now);
        }
        closeDownload(now);
        closeSave(now);
        activeStage = 'uploading';
        uploadStartMs ??= now;
      } else if (phase === 'submitting') {
        closeUpload(now);
        closeDownload(now);
        closeSave(now);
        activeStage = 'submitting';
        remoteStartMs ??= now;
      } else if (phase === 'polling') {
        closeUpload(now);
        closeDownload(now);
        closeSave(now);
        activeStage = 'polling';
        remoteStartMs ??= now;
      } else if (phase === 'submitted' || phase === 'provider-queue' || phase === 'generating') {
        closeUpload(now);
        closeDownload(now);
        closeSave(now);
        activeStage = options.isAgentProvider
          ? 'generating'
          : (options.remoteId || hasRemoteId) ? 'polling' : 'submitting';
        remoteStartMs ??= now;
      } else if (phase === 'reconnecting') {
        reconnectedCount++;
      } else if (phase === 'remote_failed') {
        closeUpload(now);
        closeRemote(now);
        remoteTerminal = true;
        activeStage = 'remote_task';
      } else if (phase === 'downloading') {
        closeUpload(now);
        closeRemote(now);
        closeSave(now);
        activeStage = 'downloading';
        downloadStartMs ??= now;
      } else if (phase === 'decoding') {
        closeUpload(now);
        closeRemote(now);
        closeDownload(now);
        closeSave(now);
        activeStage = 'decoding';
      } else if (phase === 'saving') {
        closeUpload(now);
        closeRemote(now);
        closeDownload(now);
        activeStage = 'saving';
        saveStartMs ??= now;
      }
    },
    snapshot(now = Date.now()): LiveTimings {
      const curUpload = uploadStartMs !== undefined ? (uploadMs ?? 0) + Math.max(0, now - uploadStartMs) : uploadMs;
      const curRemote = remoteStartMs !== undefined ? (remoteMs ?? 0) + Math.max(0, now - remoteStartMs) : remoteMs;
      const curDownload = downloadStartMs !== undefined ? (downloadMs ?? 0) + Math.max(0, now - downloadStartMs) : downloadMs;
      const curSave = saveStartMs !== undefined ? (saveMs ?? 0) + Math.max(0, now - saveStartMs) : saveMs;
      return {
        ...(curUpload !== undefined ? { uploadMs: curUpload } : {}),
        ...(curRemote !== undefined ? { remoteMs: curRemote } : {}),
        ...(curDownload !== undefined ? { downloadMs: curDownload } : {}),
        ...(curSave !== undefined ? { saveMs: curSave } : {}),
        ...(reconnectedCount ? { reconnectedCount } : {}),
      };
    },
    finish(now = Date.now()): LiveTimings {
      closeUpload(now);
      closeRemote(now);
      closeDownload(now);
      closeSave(now);
      return {
        ...(uploadMs !== undefined ? { uploadMs } : {}),
        ...(remoteMs !== undefined ? { remoteMs } : {}),
        ...(downloadMs !== undefined ? { downloadMs } : {}),
        ...(saveMs !== undefined ? { saveMs } : {}),
        ...(reconnectedCount ? { reconnectedCount } : {}),
      };
    },
  };
}

export function sanitizeScriptTelemetryAttribution(raw: unknown): {
  providerKind?: 'builtin' | 'custom' | 'account' | 'agent';
  routeChannel?: MediaGenerationRouteChannel;
  modelProvider?: string;
  modelId?: string;
  generationMode?: MediaGenerationMode;
  accountPlan?: MediaGenerationAccountPlan;
} | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const rec = raw as Record<string, unknown>;
  const providerKind: 'builtin' | 'custom' | 'account' | 'agent' | undefined =
    rec.providerKind === 'builtin' || rec.providerKind === 'custom' || rec.providerKind === 'account' || rec.providerKind === 'agent'
      ? rec.providerKind : undefined;
  const routeChannel: MediaGenerationRouteChannel | undefined =
    rec.routeChannel === 'amr_account' || rec.routeChannel === 'amr_opendesign'
    || rec.routeChannel === 'byok_builtin' || rec.routeChannel === 'byok_agent' || rec.routeChannel === 'byok_custom'
      ? rec.routeChannel : undefined;
  const modelProvider = providerKind !== 'custom' && (rec.modelProvider === 'account' || rec.modelProvider === 'opendesign')
    ? rec.modelProvider : undefined;
  const modelId = providerKind !== 'custom' && typeof rec.modelId === 'string' && APPROVED_SPATIAL_MODELS.has(rec.modelId)
    ? rec.modelId : undefined;
  const generationMode = typeof rec.generationMode === 'string' && (mediaGenerationModes as readonly string[]).includes(rec.generationMode)
    ? rec.generationMode as MediaGenerationMode : undefined;
  const accountPlan = providerKind === 'account' ? normalizeAccountPlan(rec.accountPlan) : undefined;
  const clean = {
    ...(providerKind ? { providerKind } : {}),
    ...(routeChannel ? { routeChannel } : {}),
    ...(modelProvider ? { modelProvider } : {}),
    ...(modelId ? { modelId } : {}),
    ...(generationMode ? { generationMode } : {}),
    ...(accountPlan ? { accountPlan } : {}),
  };
  return Object.keys(clean).length ? clean : undefined;
}

export function classifyRejectionError(error: unknown): {
  reason: MediaGenerationRejectionReason;
  category: MediaGenerationRejectionCategory;
} {
  const code = error && typeof error === 'object' && 'code' in error && typeof (error as { code?: unknown }).code === 'string'
    ? (error as { code: string }).code
    : undefined;
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const lower = message.toLowerCase();

  if (code === 'NATIVE_RUNTIME_NOT_READY' || message.startsWith('NATIVE_RUNTIME_NOT_READY:') || lower.includes('native runtime')) {
    return { reason: 'NATIVE_RUNTIME_MISSING', category: 'runtime_unavailable' };
  }
  if (message.startsWith('CAPABILITY_NOT_FOUND:')) return { reason: 'CAPABILITY_NOT_FOUND', category: 'client_validation' };
  if (message.startsWith('CAPABILITY_COMING_SOON:')) return { reason: 'CAPABILITY_COMING_SOON', category: 'provider_unavailable' };
  if (message.startsWith('CAPABILITY_DEPRECATED:')) return { reason: 'CAPABILITY_DEPRECATED', category: 'client_validation' };
  if (message.startsWith('CAPABILITY_CHANNEL_DISABLED:')) return { reason: 'CAPABILITY_CHANNEL_DISABLED', category: 'client_validation' };
  if (message.startsWith('CAPABILITY_UNAVAILABLE:')) return { reason: 'CAPABILITY_UNAVAILABLE', category: 'provider_unavailable' };
  if (message.startsWith('CAPABILITY_MODEL_INCOMPATIBLE:')) return { reason: 'CAPABILITY_MODEL_INCOMPATIBLE', category: 'client_validation' };
  if (message.startsWith('CAPABILITY_EXECUTOR_UNSUPPORTED:')) return { reason: 'CAPABILITY_MODEL_INCOMPATIBLE', category: 'client_validation' };
  if (message.startsWith('REQUEST_ID_CONFLICT:') || message.startsWith('REQUEST_IN_PROGRESS:')) return { reason: 'IDEMPOTENCY_CONFLICT', category: 'client_validation' };
  if (message.startsWith('SAVE_NOT_AVAILABLE:')) return { reason: 'SAVE_UNAVAILABLE', category: 'local_storage' };
  if (message.startsWith('PROJECT_NOT_FOUND') || lower === 'project not found') return { reason: 'PROJECT_NOT_FOUND', category: 'project_missing' };

  if (error instanceof ToolInputError) {
    if (error.invalid_field === 'prompt') return { reason: 'INVALID_PROMPT', category: 'client_validation' };
    if (error.invalid_field === 'mode') return { reason: 'INVALID_MODE', category: 'client_validation' };
    if (error.invalid_field === 'requestId') return { reason: 'INVALID_IDEMPOTENCY_KEY', category: 'client_validation' };
    if (error.invalid_field === 'references') {
      return {
        reason: error.validation_rule === 'out_of_range' ? 'REFERENCE_LIMIT_EXCEEDED' : 'REFERENCE_UNREADABLE',
        category: 'reference_invalid',
      };
    }
    return { reason: 'INVALID_PARAMETERS', category: 'client_validation' };
  }

  if (lower.includes('open the studio before generating')) return { reason: 'STUDIO_NOT_OPEN', category: 'runtime_unavailable' };
  if (lower.includes('queue is full')) return { reason: 'QUEUE_FULL', category: 'queue_full' };
  if (lower.includes('origin changed') || lower.includes('account changed') || lower.includes('configuration changed')) {
    return { reason: 'CONFIG_CHANGED', category: 'config_changed' };
  }
  if (lower.includes('cannot be resumed') || lower.includes('can be resumed') || lower.includes('use retry_save')) {
    return { reason: 'NOT_RESUMABLE', category: 'client_validation' };
  }
  if (lower.includes('no longer available')) return { reason: 'PROVIDER_NOT_CONFIGURED', category: 'provider_unavailable' };
  if (lower.includes('choose a model')) return { reason: 'INVALID_PARAMETERS', category: 'client_validation' };
  if (lower.includes('stable requestid') || lower.includes('idempotency key')) return { reason: 'INVALID_IDEMPOTENCY_KEY', category: 'client_validation' };
  if (lower.includes('requires a non-empty prompt') || lower.includes('prompt is required')) return { reason: 'INVALID_PROMPT', category: 'client_validation' };
  if (lower.includes('reference') && (lower.includes('at most') || lower.includes('exactly 1') || lower.includes('at least 1'))) {
    return { reason: 'REFERENCE_LIMIT_EXCEEDED', category: 'reference_invalid' };
  }
  if (lower.includes('pinned references or parameters.images')) return { reason: 'REFERENCE_CONFLICT', category: 'reference_invalid' };
  const upstreamCode = extractUpstreamErrorCode(error);
  const status = extractHttpStatus(error);
  if (code === 'REFERENCE_TOO_LARGE' || upstreamCode === 'asset_too_large' || status === 413) {
    return { reason: 'REFERENCE_TOO_LARGE', category: 'reference_invalid' };
  }
  if (code === 'REFERENCE_INVALID_FORMAT' || upstreamCode === 'unsupported_media_type' || status === 415) {
    return { reason: 'REFERENCE_INVALID_FORMAT', category: 'reference_invalid' };
  }
  if (code === 'REFERENCE_ENCODER_UNAVAILABLE') {
    return { reason: 'NATIVE_RUNTIME_MISSING', category: 'runtime_unavailable' };
  }
  if (lower.includes('reference') && (lower.includes('png, jpeg') || lower.includes('format'))) {
    return { reason: 'REFERENCE_INVALID_FORMAT', category: 'reference_invalid' };
  }
  if (lower.includes('reference') && (lower.includes('30 mib') || lower.includes('20 mib') || lower.includes('20 mb') || lower.includes('2 mib') || lower.includes('upload size limit') || lower.includes('upload limit') || lower.includes('too large'))) {
    return { reason: 'REFERENCE_TOO_LARGE', category: 'reference_invalid' };
  }
  if (lower.includes('asset_not_found') || lower.includes('asset_version_not_found') || lower.includes('asset versions')) {
    return { reason: 'LIBRARY_INVALID', category: 'client_validation' };
  }
  if (lower.includes('requires an animation') || lower.includes('requires parameters.') || lower.includes('unsupported 3d-asset operation') || lower.includes('invalid tripo animation') || lower.includes('invalid option')) {
    return { reason: 'OPTIONS_INVALID', category: 'client_validation' };
  }
  return { reason: 'PREFLIGHT_FAILED', category: 'other' };
}

export function isScriptPreflightError(error: unknown): boolean {
  if (error instanceof ToolInputError) return true;
  if (extractHttpStatus(error) !== undefined || extractErrorSource(error) !== undefined) return false;
  const classified = classifyRejectionError(error);
  return classified.reason !== 'PREFLIGHT_FAILED';
}

export type MediaGenerationCommonInput = {
  modality: MediaTelemetryModality;
  executorKind: MediaGenerationExecutorKind;
  capabilityId?: string;
  spatialKind?: MediaGenerationSpatialKind;
  pipelineStep?: MediaGenerationPipelineStep;
  entrySurface: MediaGenerationEntrySurface;
  destination: MediaGenerationDestination;
  referenceCount: number;
  isEdit: boolean;
  providerKind?: 'builtin' | 'custom' | 'account' | 'agent';
  routeChannel?: MediaGenerationRouteChannel;
  modelProvider?: string;
  modelId?: string;
  generationMode?: MediaGenerationMode;
  audioKind?: MediaGenerationAudioKind;
  accountPlan?: MediaGenerationAccountPlan;
  parameters?: Record<string, unknown>;
};

function commonFields(input: MediaGenerationCommonInput) {
  const capability_id = safeCapabilityId(input.capabilityId);
  return {
    executor_kind: input.executorKind,
    ...(input.providerKind ? { provider_kind: input.providerKind } : {}),
    ...(input.routeChannel ? { route_channel: input.routeChannel } : {}),
    ...(input.modelProvider ? { model_provider: input.modelProvider } : {}),
    ...(input.modelId ? { model_id: input.modelId } : {}),
    ...(capability_id ? { capability_id } : {}),
    entry_surface: input.entrySurface,
    destination: input.destination,
    ...(input.generationMode ? { generation_mode: input.generationMode } : {}),
    ...(input.audioKind ? { audio_kind: input.audioKind } : {}),
    ...(input.spatialKind ? { spatial_kind: input.spatialKind } : {}),
    ...(input.pipelineStep ? { pipeline_step: input.pipelineStep } : {}),
    reference_count: Math.max(0, Math.round(input.referenceCount)),
    is_edit: input.isEdit,
    ...(input.accountPlan ? { account_plan: input.accountPlan } : {}),
    ...(input.parameters ? extractRequestedMediaParams(input.parameters) : {}),
  };
}

export function recordMediaGenerationRequested(
  tracking: OmTracking | undefined,
  input: {
    modality: MediaTelemetryModality;
    requestId: string;
    executorKind: MediaGenerationExecutorKind;
    capabilityId?: string;
    spatialKind?: MediaGenerationSpatialKind;
    entrySurface: MediaGenerationEntrySurface;
    destination: MediaGenerationDestination;
    generationMode?: MediaGenerationMode;
    referenceCount: number;
    isEdit: boolean;
    hasIdempotencyKey: boolean;
  },
  host?: HostContext,
) {
  const capability_id = safeCapabilityId(input.capabilityId);
  tracking?.track('media_generation_requested', {
    modality: input.modality,
    request_id: input.requestId,
    executor_kind: input.executorKind,
    ...(capability_id ? { capability_id } : {}),
    ...(input.spatialKind ? { spatial_kind: input.spatialKind } : {}),
    entry_surface: input.entrySurface,
    destination: input.destination,
    ...(input.generationMode ? { generation_mode: input.generationMode } : {}),
    reference_count: Math.max(0, Math.round(input.referenceCount)),
    is_edit: input.isEdit,
    has_idempotency_key: input.hasIdempotencyKey,
  }, undefined, 'worker', normalizeTrackingHost(host));
}

export function recordMediaGenerationRejected(
  tracking: OmTracking | undefined,
  input: MediaGenerationCommonInput & {
    requestId: string;
    hasIdempotencyKey: boolean;
    reason: MediaGenerationRejectionReason;
    category: MediaGenerationRejectionCategory;
  },
  host?: HostContext,
) {
  tracking?.track('media_generation_rejected', {
    modality: input.modality,
    request_id: input.requestId,
    has_idempotency_key: input.hasIdempotencyKey,
    rejection_reason: input.reason,
    rejection_category: input.category,
    ...commonFields(input),
  }, undefined, 'worker', normalizeTrackingHost(host));
}

export function recordPreGatewayRejection(
  tracking: OmTracking | undefined,
  input: Omit<MediaGenerationCommonInput, 'referenceCount' | 'isEdit'> & {
    referenceCount?: number;
    isEdit?: boolean;
    hasIdempotencyKey: boolean;
    reason: MediaGenerationRejectionReason;
    category: MediaGenerationRejectionCategory;
  },
  host?: HostContext,
) {
  if (!tracking) return;
  const requestId = randomUUID();
  const referenceCount = Math.max(0, Math.round(input.referenceCount ?? 0));
  const isEdit = input.isEdit ?? referenceCount > 0;
  recordMediaGenerationRequested(tracking, {
    modality: input.modality,
    requestId,
    executorKind: input.executorKind,
    capabilityId: input.capabilityId,
    spatialKind: input.spatialKind,
    entrySurface: input.entrySurface,
    destination: input.destination,
    generationMode: input.generationMode,
    referenceCount,
    isEdit,
    hasIdempotencyKey: input.hasIdempotencyKey,
  }, host);
  recordMediaGenerationRejected(tracking, {
    ...input,
    requestId,
    referenceCount,
    isEdit,
  }, host);
}

export function recordMediaGenerationReplayed(
  tracking: OmTracking | undefined,
  input: MediaGenerationCommonInput & {
    requestId: string;
    jobId: string;
    existingJobState: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  },
  host?: HostContext,
) {
  const safeJobId = uuidPattern.test(input.jobId) ? input.jobId : randomUUID();
  tracking?.track('media_generation_replayed', {
    modality: input.modality,
    request_id: input.requestId,
    job_id: safeJobId,
    existing_job_state: input.existingJobState,
    ...commonFields(input),
  }, undefined, 'worker', normalizeTrackingHost(host));
}

export function recordMediaGenerationSubmitted(
  tracking: OmTracking | undefined,
  input: MediaGenerationCommonInput & {
    requestId: string;
    jobId: string;
    attemptId: string;
    attemptNumber: number;
    attemptKind: 'initial' | 'resume' | 'retry_save';
    hasIdempotencyKey: boolean;
    queueDepth?: number;
  },
  host?: HostContext,
) {
  tracking?.track('media_generation_submitted', {
    modality: input.modality,
    job_id: input.jobId,
    request_id: input.requestId,
    attempt_id: input.attemptId,
    attempt_number: input.attemptNumber,
    attempt_kind: input.attemptKind,
    has_idempotency_key: input.hasIdempotencyKey,
    ...(input.queueDepth !== undefined ? { queue_depth: Math.max(0, Math.round(input.queueDepth)) } : {}),
    ...commonFields(input),
  }, undefined, 'worker', normalizeTrackingHost(host));
}

export function recordMediaGenerationRetryStarted(
  tracking: OmTracking | undefined,
  input: MediaGenerationCommonInput & {
    jobId: string;
    requestId?: string;
    attemptId: string;
    attemptNumber: number;
    attemptKind: 'resume' | 'retry_save';
    previousErrorCode?: MediaGenerationErrorCode;
    previousFailurePhase?: MediaGenerationFailurePhase;
  },
  host?: HostContext,
) {
  tracking?.track('media_generation_retry_started', {
    modality: input.modality,
    job_id: input.jobId,
    ...(input.requestId ? { request_id: input.requestId } : {}),
    attempt_id: input.attemptId,
    attempt_number: input.attemptNumber,
    attempt_kind: input.attemptKind,
    ...commonFields(input),
    ...(input.previousErrorCode ? { previous_error_code: input.previousErrorCode } : {}),
    ...(input.previousFailurePhase ? { previous_failure_phase: input.previousFailurePhase } : {}),
  }, undefined, 'worker', normalizeTrackingHost(host));
}

export function recordMediaGenerationRetryRejected(
  tracking: OmTracking | undefined,
  input: MediaGenerationCommonInput & {
    jobId: string;
    requestId?: string;
    attemptKind: 'resume' | 'retry_save';
    reason: MediaGenerationRejectionReason;
    category: MediaGenerationRejectionCategory;
  },
  host?: HostContext,
) {
  tracking?.track('media_generation_retry_rejected', {
    modality: input.modality,
    job_id: input.jobId,
    ...(input.requestId ? { request_id: input.requestId } : {}),
    attempt_kind: input.attemptKind,
    rejection_reason: input.reason,
    rejection_category: input.category,
    ...commonFields(input),
  }, undefined, 'worker', normalizeTrackingHost(host));
}

export type RecordMediaGenerationResultInput = MediaGenerationCommonInput & LiveTimings & {
  jobId: string;
  requestId?: string;
  attemptId?: string;
  attemptNumber?: number;
  attemptKind: 'initial' | 'resume' | 'retry_save';
  jobState: 'completed' | 'failed' | 'cancelled';
  assetCount: number;
  durationMs: number;
  queueWaitMs?: number;
  endToEndMs: number;
  cancelWaitMs?: number;
  remoteTerminal?: boolean;
  hasRemoteId: boolean;
  remoteTaskId?: string;
  providerOrigin?: string;
  isResumable?: boolean;
  savePending?: boolean;
  totalOutputBytes?: number;
  failurePhase?: MediaGenerationFailurePhase;
  phaseBeforeCancel?: MediaGenerationCancelPhase;
  lastActivePhase?: MediaGenerationCancelPhase;
  cancelSource?: MediaGenerationCancelSource;
  cause?: unknown;
  previousErrorCode?: MediaGenerationErrorCode;
  previousFailurePhase?: MediaGenerationFailurePhase;
};

export function resolveResultErrorFields(input: {
  jobState: 'completed' | 'failed' | 'cancelled';
  cause?: unknown;
  failurePhase?: MediaGenerationFailurePhase;
  fallbackPhase?: string;
  providerKind?: 'builtin' | 'custom' | 'account' | 'agent';
  routeChannel?: MediaGenerationRouteChannel;
}): {
  errorCode?: MediaGenerationErrorCode;
  errorCategory?: MediaGenerationErrorCategory;
  httpStatus?: number;
  upstreamErrorCode?: ReturnType<typeof extractUpstreamErrorCode>;
} {
  if (input.jobState === 'completed') return {};
  const errorCode = mediaGenerationError(input.cause, input.failurePhase ?? input.fallbackPhase);
  const httpStatus = extractHttpStatus(input.cause);
  const errorCategory = mediaGenerationErrorCategory(errorCode, input.failurePhase, input.routeChannel);
  const upstreamErrorCode = input.providerKind === 'custom'
    ? undefined
    : extractUpstreamErrorCode(input.cause);
  return { errorCode, errorCategory, httpStatus, upstreamErrorCode };
}

export function recordMediaGenerationResult(
  tracking: OmTracking | undefined,
  input: RecordMediaGenerationResultInput,
  host?: HostContext,
) {
  const { errorCode, errorCategory, httpStatus, upstreamErrorCode } = resolveResultErrorFields({
    jobState: input.jobState,
    cause: input.cause,
    failurePhase: input.failurePhase,
    providerKind: input.providerKind,
    routeChannel: input.routeChannel,
  });
  const total_output_bytes = input.totalOutputBytes !== undefined && input.jobState === 'completed'
    ? Math.min(MAX_OUTPUT_BYTES_FIELD, Math.max(0, Math.round(input.totalOutputBytes)))
    : undefined;
  const OFFICIAL_AMR_ORIGIN = 'https://amr-api.open-design.ai';
  const normalizedOrigin = typeof input.providerOrigin === 'string' ? input.providerOrigin.trim().replace(/\/+$/, '') : '';
  const isOfficialAmr = (input.routeChannel === 'amr_account' || input.routeChannel === 'amr_opendesign')
    && normalizedOrigin === OFFICIAL_AMR_ORIGIN;
  const rawRemoteTaskId = isOfficialAmr && typeof input.remoteTaskId === 'string' ? input.remoteTaskId : '';
  const remote_task_id = /^[A-Za-z0-9_.-]{1,128}$/.test(rawRemoteTaskId) ? rawRemoteTaskId : undefined;
  tracking?.track('media_generation_result', {
    modality: input.modality,
    job_id: input.jobId,
    job_state: input.jobState,
    asset_count: Math.max(0, Math.round(input.assetCount)),
    ...commonFields(input),
    ...(input.requestId ? { request_id: input.requestId } : {}),
    ...(input.attemptId ? { attempt_id: input.attemptId } : {}),
    ...(input.attemptNumber ? { attempt_number: input.attemptNumber } : {}),
    duration_ms: clampMs(input.durationMs),
    ...(input.queueWaitMs !== undefined ? { queue_wait_ms: clampMs(input.queueWaitMs) } : {}),
    end_to_end_ms: clampMs(input.endToEndMs),
    ...(input.uploadMs !== undefined ? { upload_ms: clampMs(input.uploadMs) } : {}),
    ...(input.remoteMs !== undefined ? { remote_ms: clampMs(input.remoteMs) } : {}),
    ...(input.downloadMs !== undefined ? { download_ms: clampMs(input.downloadMs) } : {}),
    ...(input.saveMs !== undefined ? { save_ms: clampMs(input.saveMs) } : {}),
    ...(input.cancelWaitMs !== undefined ? { cancel_wait_ms: clampMs(input.cancelWaitMs) } : {}),
    attempt_kind: input.attemptKind,
    ...(typeof input.remoteTerminal === 'boolean' ? { remote_terminal: input.remoteTerminal } : {}),
    has_remote_id: input.hasRemoteId,
    ...(remote_task_id ? { remote_task_id } : {}),
    ...(input.jobState === 'failed' && input.isResumable !== undefined ? { is_resumable: input.isResumable } : {}),
    ...(input.jobState !== 'completed' && input.savePending !== undefined ? { save_pending: input.savePending } : {}),
    ...(input.reconnectedCount ? { reconnected_count: Math.min(86_400_000, input.reconnectedCount) } : {}),
    ...(total_output_bytes !== undefined ? { total_output_bytes } : {}),
    ...(input.failurePhase ? { failure_phase: input.failurePhase } : {}),
    ...(input.phaseBeforeCancel ? { phase_before_cancel: input.phaseBeforeCancel } : {}),
    ...(input.lastActivePhase ? { last_active_phase: input.lastActivePhase } : {}),
    ...(input.cancelSource ? { cancel_source: input.cancelSource } : {}),
    ...(httpStatus !== undefined ? { http_status: httpStatus } : {}),
    ...(upstreamErrorCode ? { upstream_error_code: upstreamErrorCode } : {}),
    ...(errorCode ? { error_code: errorCode } : {}),
    ...(errorCategory ? { error_category: errorCategory } : {}),
    ...(input.previousErrorCode ? { previous_error_code: input.previousErrorCode } : {}),
    ...(input.previousFailurePhase ? { previous_failure_phase: input.previousFailurePhase } : {}),
  }, undefined, 'worker', normalizeTrackingHost(host));
  return { errorCode, errorCategory, httpStatus, upstreamErrorCode };
}
