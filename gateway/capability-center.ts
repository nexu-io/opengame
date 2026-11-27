import { readFile, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { ToolInputError } from '../shared/tool-input-error.ts';
import type { OmTracking } from '../shared/tracking.ts';
import type { HostContext } from '../tracking/host.ts';
import type {
  MediaGenerationEntrySurface,
  MediaGenerationMode,
  MediaGenerationPipelineStep,
} from '../tracking/tool-fields.ts';
import type { WorkspaceStore } from '../workspace.ts';
import { assetMediaUrl, type AssetReference, type AssetVersion, type LibraryAsset } from '../shared/asset-library.ts';
import { mediaProviders, modelReferenceLimit, type Modality, type Model } from '../shared/gateway.ts';
import { generationOptions, resolveGenerationParameters, validateGenerationOptions } from '../shared/generation-options.ts';
import {
  buildCapabilityParameters,
  buildCapabilityPrompt,
  capabilityControlSchema,
  capabilitySupportsModel,
  findCapability,
  listCapabilitiesForChannel,
  resolveCapabilityCatalog,
  resolveCapabilityOptions,
  type CapabilityCostTier,
  type CapabilityDefinition,
  type CapabilityOverride,
} from '../shared/capability-registry.ts';
import { videoFeatureParameters, type VideoFeatureId } from '../shared/video-features.ts';
import { atomicAssetJson, AssetLibrary, assetHash } from './asset-library.ts';
import { assetOperation } from './asset-operations.ts';
import { brandKitOperation } from './brand-kit-operation.ts';
import { brandKitsFor } from './brand-kits.ts';
import {
  builtinCapabilityScripts,
  type CapabilityScriptContext,
  type CapabilityScriptHandler,
  type CapabilityScriptOutput,
  type CapabilityScriptTelemetryMeta,
} from './capability-scripts.ts';
import {
  classifyRejectionError,
  createStageTimingTracker,
  extractRequestReferenceMeta,
  isMediaTelemetryModality,
  isScriptPreflightError,
  recordMediaGenerationRejected,
  recordMediaGenerationReplayed,
  recordMediaGenerationRequested,
  recordMediaGenerationResult,
  recordMediaGenerationSubmitted,
  recordPreGatewayRejection,
  sanitizeScriptTelemetryAttribution,
  scriptProviderTrackingMeta,
  spatialKindForCapability,
} from './media-telemetry.ts';
import { balanceLowTopupForJob, mediaUse, type McpChannel } from './media-use.ts';
import { discoverOpenDesign3d, discoverOpenDesignSpatial, discoverOpenDesignWorld, type OpenDesign3dDiscovery } from './opendesign-3d.ts';
import { gatewayFor } from './service.ts';
import { transcriptOperation } from './transcript-operations.ts';
import { transcriptsFor } from './transcription.ts';
import { requireNativeRuntime } from '../scripts/npm-runtime.mjs';
import { pluginRoot } from '../hyperframes.ts';

export type { CapabilityScriptContext, CapabilityScriptHandler, CapabilityScriptOutput };

const scriptExecutors = new Map<string, CapabilityScriptHandler>();

export function registerCapabilityScriptExecutor(scriptId: string, handler: CapabilityScriptHandler) {
  scriptExecutors.set(scriptId, handler);
}

export function unregisterCapabilityScriptExecutor(scriptId: string) {
  scriptExecutors.delete(scriptId);
}

function resolveScriptExecutor(scriptId: string): CapabilityScriptHandler | undefined {
  return scriptExecutors.get(scriptId) ?? builtinCapabilityScripts[scriptId];
}

// ==================== PLUGGABLE REMOTE HOT-CONFIG HOOK ====================
export type CapabilityRemoteConfigFetcher = () => Promise<readonly CapabilityOverride[]>;

let remoteConfigFetcher: CapabilityRemoteConfigFetcher | undefined;

/**
 * Extension hook for OpenDesign Cloud / AMR remote capability directory.
 * Registering a fetcher (or setting `OPENMOTION_CAPABILITY_CONFIG_URL`) enables
 * zero-release capability hot-swapping and soft-deprecation cached per workspace.
 */
export function setCapabilityRemoteConfigFetcher(fetcher: CapabilityRemoteConfigFetcher | undefined) {
  remoteConfigFetcher = fetcher;
}

// ==================== PLUGGABLE SPEND QUOTE ESTIMATOR HOOK ====================
export type CapabilityQuote = {
  capabilityId: string;
  costTier: CapabilityCostTier;
  requiresExplicitApproval: boolean;
  estimatedCredits: number | null;
  currency: string | null;
  quoteSource: 'static-policy' | 'cloud-quote';
  selectedModel?: string | null;
};

export type CapabilityQuoteContext = {
  store: WorkspaceStore;
  capability?: CapabilityDefinition;
  modality?: Modality;
  model?: Model;
  options: Record<string, unknown>;
  parameters: Record<string, unknown>;
  referenceCount: number;
};

export type CapabilityQuoteEstimator = (ctx: CapabilityQuoteContext) => Promise<CapabilityQuote>;

let customQuoteEstimator: CapabilityQuoteEstimator | undefined;

/**
 * Extension hook for AMR real-time billing / credit estimation.
 * Defaults to static tier policy until the cloud billing quote API is wired in.
 */
export function registerCapabilityQuoteEstimator(estimator: CapabilityQuoteEstimator | undefined) {
  customQuoteEstimator = estimator;
}

async function estimateCapabilityQuote(ctx: CapabilityQuoteContext): Promise<CapabilityQuote> {
  if (customQuoteEstimator) return customQuoteEstimator(ctx);
  const modality = ctx.capability?.modality ?? ctx.modality ?? ctx.model?.modality;
  const costTier: CapabilityCostTier = ctx.capability?.costTier ?? (modality === 'video' ? 'medium' : 'low');
  const requiresExplicitApproval = ctx.capability?.requiresExplicitApproval ?? (ctx.capability?.executor.kind !== 'service');
  return {
    capabilityId: ctx.capability?.id ?? 'raw-model',
    costTier,
    requiresExplicitApproval,
    estimatedCredits: null,
    currency: null,
    quoteSource: 'static-policy',
    selectedModel: ctx.model?.id ?? null,
  };
}

const overrideFilename = 'capabilities-override.json';
const remoteCacheFilename = 'capabilities-remote-cache.json';

async function readOverrideFile(file: string): Promise<CapabilityOverride[]> {
  try {
    const raw = JSON.parse(await readFile(file, 'utf8'));
    return Array.isArray(raw) ? raw : Array.isArray(raw?.overrides) ? raw.overrides : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

export async function syncCapabilityRemoteConfig(store: WorkspaceStore): Promise<CapabilityDefinition[]> {
  const root = (store.workspaceStore ?? store).directory;
  const remoteUrl = process.env.OPENMOTION_CAPABILITY_CONFIG_URL;
  let fetched: readonly CapabilityOverride[] | undefined;
  if (remoteConfigFetcher) {
    fetched = await remoteConfigFetcher();
  } else if (remoteUrl) {
    const res = await fetch(remoteUrl, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) throw new Error(`Remote capability config HTTP ${res.status}`);
    const data = await res.json();
    fetched = Array.isArray(data) ? data : Array.isArray(data?.overrides) ? data.overrides : [];
  }
  if (fetched) {
    await atomicAssetJson(path.join(root, remoteCacheFilename), {
      syncedAt: Date.now(),
      overrides: fetched,
    });
  }
  return loadCapabilityCatalog(store);
}

export async function loadCapabilityCatalog(store: WorkspaceStore): Promise<CapabilityDefinition[]> {
  const root = (store.workspaceStore ?? store).directory;
  const [remoteCached, localPinned] = await Promise.all([
    readOverrideFile(path.join(root, remoteCacheFilename)),
    readOverrideFile(path.join(root, overrideFilename)),
  ]);
  return resolveCapabilityCatalog([...remoteCached, ...localPinned]);
}

export async function saveCapabilityOverrides(store: WorkspaceStore, overrides: readonly CapabilityOverride[]) {
  const root = (store.workspaceStore ?? store).directory;
  await atomicAssetJson(path.join(root, overrideFilename), { overrides });
  return loadCapabilityCatalog(store);
}

function providerRank(providerId: string): number {
  if (providerId === 'account') return 0;
  if (providerId === 'opendesign') return 1;
  return 2;
}

function recommendedModelFor(capability: CapabilityDefinition): string | undefined {
  if (capability.executor.kind === 'prompt-preset' || capability.executor.kind === 'dedicated-model') {
    return capability.executor.recommendedModel;
  }
  return undefined;
}

function selectCompatibleModels(
  capability: CapabilityDefinition,
  models: readonly Model[],
  availableProviders: ReadonlySet<string>,
  referenceCount = capability.input.minReferences,
): Model[] {
  const recId = recommendedModelFor(capability);
  const matches = models.filter(model => {
    if (!availableProviders.has(model.provider)) return false;
    if (!capabilitySupportsModel(capability, model)) return false;
    if (referenceCount >= 1 && (model.modality === 'image' || model.modality === 'video') && modelReferenceLimit(model) < referenceCount) return false;
    return true;
  });
  return matches.sort((a, b) => {
    if (recId) {
      const aRec = a.modelId === recId ? 0 : 1;
      const bRec = b.modelId === recId ? 0 : 1;
      if (aRec !== bRec) return aRec - bRec;
    }
    const pDiff = providerRank(a.provider) - providerRank(b.provider);
    if (pDiff !== 0) return pDiff;
    return a.id.localeCompare(b.id);
  });
}

type ScriptTelemetryAttribution = {
  providerKind?: 'builtin' | 'custom' | 'account' | 'agent';
  routeChannel?: 'amr_account' | 'amr_opendesign' | 'byok_builtin' | 'byok_agent' | 'byok_custom';
  modelProvider?: string;
  modelId?: string;
  generationMode?: MediaGenerationMode;
  accountPlan?: 'free' | 'go' | 'plus' | 'pro' | 'team' | 'enterprise' | 'unknown';
};

type ScriptReceipt = {
  inputHash: string;
  assetId: string;
  jobId?: string;
  workerPid?: number;
  status?: 'pending' | 'completed';
  versionId?: string;
  telemetry?: ScriptTelemetryAttribution;
};

function isPidAlive(pid?: number): boolean {
  if (!pid || !Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

type ScriptExecutionResult = {
  capabilityId: string;
  executorKind: 'script';
  costTier: CapabilityCostTier;
  asset: LibraryAsset;
  version: AssetVersion;
  mediaUrl: string;
  result?: Record<string, unknown>;
  _telemetry?: ScriptTelemetryAttribution;
};

const inFlightScriptRuns = new Map<string, { jobId: string; promise: Promise<ScriptExecutionResult> }>();

async function readScriptReceipt(receiptPath: string): Promise<ScriptReceipt | undefined> {
  return readFile(receiptPath, 'utf8').then(
    raw => JSON.parse(raw) as ScriptReceipt,
    (err: NodeJS.ErrnoException) => {
      if (err.code !== 'ENOENT') throw err;
      return undefined;
    },
  );
}

function validateCapabilityOptions(capability: CapabilityDefinition, options: unknown): Record<string, unknown> {
  if (options !== undefined && (!options || typeof options !== 'object' || Array.isArray(options))) {
    throw new ToolInputError('options must be an object', 'options', 'invalid_type');
  }
  const controls = capability.input.controls ?? [];
  const record = (options ?? {}) as Record<string, unknown>;
  if (controls.length > 0) {
    for (const [key, value] of Object.entries(record)) {
      const control = controls.find(item => item.key === key);
      if (!control) throw new ToolInputError(`unknown options.${key} for capability ${capability.id}`, 'unknown_field', 'unknown_field');
      if (typeof value !== 'string' || !control.choices.some(choice => choice.value === value)) {
        throw new ToolInputError(`invalid choice for options.${key}`, 'options', 'invalid_enum');
      }
    }
  }
  return resolveCapabilityOptions(capability, record);
}

export async function capabilityDiscover(
  store: WorkspaceStore,
  args: any,
  tracking?: OmTracking,
  channel: 'gui' | 'mcp' = 'mcp',
  host?: HostContext,
  mcpChannel: McpChannel = 'mcp_stdio',
) {
  const inspectModality = args.modality === 'image' || args.modality === 'video' || args.modality === 'audio'
    ? args.modality
    : undefined;
  if (args.action === 'providers') {
    if (args.provider) return mediaUse(store, { action: 'reference', provider: args.provider }, tracking, host, { channel, mcpChannel });
    return mediaUse(store, { action: 'inspect', ...(inspectModality ? { modality: inspectModality } : {}) }, tracking, host, { channel, mcpChannel });
  }
  if (args.action === 'models') {
    if (args.modality === '3d') {
      const { live3d, liveWorld } = await discoverOpenDesignSpatial(store, args.refresh === true);
      const byProvider = new Map<string, any[]>();
      if (live3d.available && live3d.provider) {
        byProvider.set(live3d.provider, [
          ...(byProvider.get(live3d.provider) ?? []),
          ...live3d.models.map(item => ({
            id: `${live3d.provider}:${item.modelId}`,
            provider: live3d.provider,
            modelId: item.modelId,
            label: item.label,
            modality: '3d',
            mode: 'text-to-3d',
            capabilityId: '3d-asset',
            source: 'live',
            ...(item.tier ? { tier: item.tier } : {}),
            ...(item.bestFor?.length ? { bestFor: item.bestFor } : {}),
            ...(item.description ? { description: item.description } : {}),
            ...(item.capabilities ? { nativeOptions: item.capabilities } : {}),
          })),
        ]);
      }
      if (liveWorld.available && liveWorld.provider) {
        byProvider.set(liveWorld.provider, [
          ...(byProvider.get(liveWorld.provider) ?? []),
          ...liveWorld.models.map(item => ({
            id: `${liveWorld.provider}:${item.modelId}`,
            provider: liveWorld.provider,
            modelId: item.modelId,
            label: item.label,
            modality: '3d',
            mode: 'text-to-world',
            capabilityId: '3d-world',
            source: 'live',
            ...(item.tier ? { tier: item.tier } : {}),
            ...(item.bestFor?.length ? { bestFor: item.bestFor } : {}),
            ...(item.description ? { description: item.description } : {}),
            ...(item.capabilities ? { nativeOptions: item.capabilities } : {}),
          })),
        ]);
      }
      if (byProvider.size === 0) {
        return { providers: [], catalogs: [], setupRequired: true };
      }
      return {
        providers: [...byProvider.keys()],
        catalogs: [...byProvider.entries()].map(([provider, models]) => ({ provider, models })),
        setupRequired: false,
      };
    }
    return mediaUse(
      store,
      {
        action: 'models',
        provider: args.provider,
        modality: args.modality,
        refresh: args.refresh,
        query: args.query,
        offset: args.offset,
        limit: args.limit,
      },
      tracking,
      host,
      { channel, mcpChannel },
    );
  }

  if (args.refresh === true) {
    await syncCapabilityRemoteConfig(store).catch(() => {});
  }
  const catalog = await loadCapabilityCatalog(store);
  const gateway = gatewayFor(store, tracking);
  const emptySpatial: OpenDesign3dDiscovery = { available: false, models: [] };
  const targetCap = (args.action === 'describe' || args.action === 'quote') && typeof args.capabilityId === 'string'
    ? findCapability(args.capabilityId, catalog)
    : undefined;
  const needs3d = targetCap
    ? targetCap.executor.kind === 'script' && targetCap.executor.scriptId === 'opendesign-3d'
    : !args.modality || args.modality === '3d';
  const needsWorld = targetCap
    ? targetCap.executor.kind === 'script' && targetCap.executor.scriptId === 'opendesign-world'
    : !args.modality || args.modality === '3d';

  const spatialPromise: Promise<{ live3d: OpenDesign3dDiscovery; liveWorld: OpenDesign3dDiscovery }> = needs3d && needsWorld
    ? discoverOpenDesignSpatial(store, args.refresh === true).catch(() => ({ live3d: emptySpatial, liveWorld: emptySpatial }))
    : needs3d
      ? discoverOpenDesign3d(store, args.refresh === true).catch(() => emptySpatial).then(live3d => ({ live3d, liveWorld: emptySpatial }))
      : needsWorld
        ? discoverOpenDesignWorld(store, args.refresh === true).catch(() => emptySpatial).then(liveWorld => ({ live3d: emptySpatial, liveWorld }))
        : Promise.resolve({ live3d: emptySpatial, liveWorld: emptySpatial });

  const [status, models, asrCatalog, { live3d, liveWorld }] = await Promise.all([
    gateway.status(),
    gateway.models(),
    transcriptsFor(store).models().catch(() => ({ models: [] as unknown[] })),
    spatialPromise,
  ]);
  const availableProviders = new Set(
    status.providers
      .filter(p => p.available && !(p.id === 'account' && p.mediaEntitlement === 'not-included'))
      .map(p => p.id),
  );

  const summarize = (cap: CapabilityDefinition) => {
    if (cap.executor.kind === 'script') {
      const registered = Boolean(resolveScriptExecutor(cap.executor.scriptId)) && cap.status === 'live';
      if (cap.executor.scriptId === 'opendesign-3d' || cap.executor.scriptId === 'opendesign-world') {
        const discovery = cap.executor.scriptId === 'opendesign-world' ? liveWorld : live3d;
        const ready = registered && discovery.available;
        const primary = discovery.models[0];
        return {
          id: cap.id,
          title: cap.title,
          summary: cap.summary,
          modality: cap.modality,
          category: cap.category,
          icon: cap.icon,
          status: cap.status,
          channels: cap.channels,
          costTier: cap.costTier,
          requiresExplicitApproval: cap.requiresExplicitApproval,
          executorKind: cap.executor.kind,
          available: ready,
          recommendedModel: ready && primary && discovery.provider ? `${discovery.provider}:${primary.modelId}` : `script:${cap.executor.scriptId}`,
          compatibleModelCount: ready ? discovery.models.length : 0,
        };
      }
      return {
        id: cap.id,
        title: cap.title,
        summary: cap.summary,
        modality: cap.modality,
        category: cap.category,
        icon: cap.icon,
        status: cap.status,
        channels: cap.channels,
        costTier: cap.costTier,
        requiresExplicitApproval: cap.requiresExplicitApproval,
        executorKind: cap.executor.kind,
        available: registered,
        recommendedModel: `script:${cap.executor.scriptId}`,
        compatibleModelCount: registered ? 1 : 0,
      };
    }
    if (cap.executor.kind === 'service' && cap.executor.serviceId === 'asr-transcribe') {
      const count = Array.isArray(asrCatalog.models) ? asrCatalog.models.length : 0;
      return {
        id: cap.id,
        title: cap.title,
        summary: cap.summary,
        modality: cap.modality,
        category: cap.category,
        icon: cap.icon,
        status: cap.status,
        channels: cap.channels,
        costTier: cap.costTier,
        requiresExplicitApproval: cap.requiresExplicitApproval,
        executorKind: cap.executor.kind,
        available: cap.status === 'live' && count > 0,
        recommendedModel: null,
        compatibleModelCount: count,
      };
    }
    const compatible = selectCompatibleModels(cap, models, availableProviders);
    const defaultRoute = cap.modality !== '3d' ? status.routes[cap.modality] : undefined;
    const preferred = compatible.find(m => m.id === defaultRoute) ?? compatible[0];
    return {
      id: cap.id,
      title: cap.title,
      summary: cap.summary,
      modality: cap.modality,
      category: cap.category,
      icon: cap.icon,
      status: cap.status,
      channels: cap.channels,
      costTier: cap.costTier,
      requiresExplicitApproval: cap.requiresExplicitApproval,
      executorKind: cap.executor.kind,
      available: cap.status === 'live' && compatible.length > 0,
      recommendedModel: preferred?.id ?? recommendedModelFor(cap) ?? null,
      compatibleModelCount: compatible.length,
    };
  };

  if (args.action === 'list') {
    if (args.offset !== undefined && (!Number.isInteger(args.offset) || args.offset < 0)) {
      throw new ToolInputError('offset must be a non-negative integer', 'offset', 'out_of_range');
    }
    if (args.limit !== undefined && (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 100)) {
      throw new ToolInputError('limit must be an integer between 1 and 100', 'limit', 'out_of_range');
    }
    const entries = listCapabilitiesForChannel(catalog, channel, {
      modality: args.modality,
      includeComingSoon: args.includeComingSoon,
    }).map(summarize);
    const offset = args.offset ?? 0;
    const sliced = args.limit === undefined ? entries.slice(offset) : entries.slice(offset, offset + args.limit);
    const inspected = (await mediaUse(
      store,
      { action: 'inspect', ...(inspectModality ? { modality: inspectModality } : {}) },
      tracking,
      host,
      { channel, mcpChannel },
    )) as {
      providers: unknown;
      defaults: unknown;
      settingsHandoff: unknown;
      upgrade?: unknown;
      _upgradeLinkResult?: unknown;
    };
    return {
      capabilities: sliced,
      total: entries.length,
      offset,
      ...(args.limit !== undefined ? { limit: args.limit } : {}),
      hasMore: offset + sliced.length < entries.length,
      providers: inspected.providers,
      defaults: inspected.defaults,
      settingsHandoff: inspected.settingsHandoff,
      // MCP callers get the same attributed Free/Go upgrade link as inspect; the MCP boundary strips and tracks
      // _upgradeLinkResult. The Studio (gui) list never exposes either field.
      ...(channel === 'mcp' && inspected.upgrade ? { upgrade: inspected.upgrade } : {}),
      ...(channel === 'mcp' && inspected._upgradeLinkResult ? { _upgradeLinkResult: inspected._upgradeLinkResult } : {}),
    };
  }

  if (args.action === 'describe') {
    const cap = findCapability(args.capabilityId, catalog);
    if (!cap) throw new Error(`CAPABILITY_NOT_FOUND: Unknown capability ${String(args.capabilityId)}`);
    const base = summarize(cap);
    const isModelBacked =
      cap.executor.kind === 'model' || cap.executor.kind === 'prompt-preset' || cap.executor.kind === 'dedicated-model';
    const scriptId = cap.executor.kind === 'script' ? cap.executor.scriptId : undefined;
    const compatible = isModelBacked
      ? selectCompatibleModels(cap, models, availableProviders).map(m => ({
          id: m.id,
          provider: m.provider,
          modelId: m.modelId,
          label: m.label,
          mode: m.mode,
        }))
      : scriptId === 'opendesign-3d' || scriptId === 'opendesign-world'
        ? (() => {
            const discovery = scriptId === 'opendesign-world' ? liveWorld : live3d;
            return discovery.available && discovery.provider
              ? discovery.models.map(m => ({
                  id: `${discovery.provider}:${m.modelId}`,
                  provider: discovery.provider,
                  modelId: m.modelId,
                  label: m.label,
                  mode: scriptId === 'opendesign-world' ? 'text-to-world' : 'text-to-3d',
                }))
              : [];
          })()
        : [];
    return {
      capability: {
        ...base,
        ...(cap.replacementCapabilityId ? { replacementCapabilityId: cap.replacementCapabilityId } : {}),
        input: {
          promptRequired: cap.input.promptRequired,
          minReferences: cap.input.minReferences,
          maxReferences: cap.input.maxReferences,
          controls: cap.input.controls ?? [],
          optionsSchema: capabilityControlSchema(cap),
        },
        compatibleModels: compatible,
      },
    };
  }

  if (args.action === 'quote') {
    const cap = findCapability(args.capabilityId, catalog);
    if (!cap) throw new Error(`CAPABILITY_NOT_FOUND: Unknown capability ${String(args.capabilityId)}`);
    const options = validateCapabilityOptions(cap, args.options);
    const compatible = selectCompatibleModels(cap, models, availableProviders);
    const chosen = args.model ? models.find(m => m.id === args.model) : compatible[0];
    const quote = await estimateCapabilityQuote({
      store,
      capability: cap,
      model: chosen,
      options,
      parameters: args.parameters ?? {},
      referenceCount: cap.input.minReferences,
    });
    return { quote };
  }

  throw new ToolInputError('unsupported capability discover action', 'action', 'invalid_enum');
}

export async function preflightAssetCapabilityGenerate(
  store: WorkspaceStore,
  args: {
    capabilityId: string;
    capabilityOptions?: Record<string, unknown>;
    model: string;
    modality?: string;
    prompt?: string;
    references?: AssetReference[];
  },
  tracking?: OmTracking,
  channel: 'gui' | 'mcp' = 'gui',
): Promise<{ capability: CapabilityDefinition; options: Record<string, unknown>; model: Model }> {
  const catalog = await loadCapabilityCatalog(store);
  const cap = findCapability(args.capabilityId, catalog);
  if (!cap) throw new Error(`CAPABILITY_NOT_FOUND: Unknown capability ${args.capabilityId}`);
  if (cap.status === 'coming_soon') {
    throw new Error(`CAPABILITY_COMING_SOON: ${cap.title} (${cap.id}) is coming soon and cannot be executed yet`);
  }
  if (cap.status === 'deprecated' || cap.status === 'hidden') {
    throw new Error(
      `CAPABILITY_DEPRECATED: ${cap.id} is no longer active${cap.replacementCapabilityId ? `; use ${cap.replacementCapabilityId} instead` : ''}`,
    );
  }
  if (!cap.channels[channel]) {
    throw new Error(`CAPABILITY_CHANNEL_DISABLED: ${cap.id} is not enabled on channel ${channel}`);
  }
  if (cap.modality === '3d' || (args.modality && args.modality !== cap.modality)) {
    throw new Error(`CAPABILITY_UNAVAILABLE: Capability ${cap.id} (${cap.modality}) cannot execute for modality ${args.modality ?? 'unknown'}`);
  }
  if (cap.executor.kind === 'script' || cap.executor.kind === 'service') {
    throw new Error(
      `CAPABILITY_EXECUTOR_UNSUPPORTED: ${cap.id} uses the ${cap.executor.kind} executor; run it through openmotion_capability_run or /motion-api/capabilities/run`,
    );
  }

  const options = validateCapabilityOptions(cap, args.capabilityOptions);
  const rawPrompt = typeof args.prompt === 'string' ? args.prompt : '';
  if (cap.input.promptRequired && !rawPrompt.trim()) {
    throw new ToolInputError(`prompt is required for capability ${cap.id}`, 'prompt', 'missing');
  }
  const references: AssetReference[] = Array.isArray(args.references) ? args.references : [];
  if (references.length < cap.input.minReferences || references.length > cap.input.maxReferences) {
    throw new ToolInputError(
      `capability ${cap.id} requires ${cap.input.minReferences}..${cap.input.maxReferences} reference assets`,
      'references',
      'out_of_range',
    );
  }

  const gateway = gatewayFor(store, tracking);
  const [status, models] = await Promise.all([gateway.status(), gateway.models()]);
  const availableProviders = new Set(
    status.providers
      .filter(p => p.available && !(p.id === 'account' && p.mediaEntitlement === 'not-included'))
      .map(p => p.id),
  );
  const compatible = selectCompatibleModels(cap, models, availableProviders, references.length);
  const chosen = compatible.find(m => m.id === args.model)
    ?? (typeof args.model === 'string' && !args.model.includes(':')
      ? compatible.find(m => m.modelId === args.model)
      : undefined);
  if (!chosen) {
    const catalogModel = models.find(m => m.id === args.model);
    if (catalogModel && capabilitySupportsModel(cap, catalogModel)) {
      if (!availableProviders.has(catalogModel.provider)) {
        throw new Error(`CAPABILITY_UNAVAILABLE: Provider ${catalogModel.provider} is not ready for model ${args.model}`);
      }
      if (references.length >= 1 && (catalogModel.modality === 'image' || catalogModel.modality === 'video') && modelReferenceLimit(catalogModel) < references.length) {
        throw new Error(`CAPABILITY_MODEL_INCOMPATIBLE: Model ${args.model} accepts at most ${modelReferenceLimit(catalogModel)} reference image(s)`);
      }
    }
    throw new Error(`CAPABILITY_MODEL_INCOMPATIBLE: Model ${args.model} does not support capability ${cap.id}`);
  }

  return { capability: cap, options, model: chosen };
}

export async function capabilityRun(
  store: WorkspaceStore,
  args: any,
  tracking?: OmTracking,
  channel: 'gui' | 'mcp' = 'mcp',
  host?: HostContext,
) {
  const gateway = gatewayFor(store, tracking);
  const effectiveTracking = tracking ?? gateway.options.tracking;
  const entrySurface: MediaGenerationEntrySurface = channel === 'gui' ? 'studio' : 'mcp_capability_run';
  const isDryRun = args.dryRun === true;
  let resolvedCap: CapabilityDefinition | undefined;
  let telemetryOwned = false;
  try {
    const action = args.action ?? 'run';
    if (action !== 'run') throw new ToolInputError('unsupported capability run action', 'action', 'invalid_enum');
    if (!isDryRun && (typeof args.requestId !== 'string' || !/^[\w-]{1,100}$/.test(args.requestId))) {
      throw new ToolInputError('requestId is required', 'requestId', 'missing');
    }

    const library = new AssetLibrary(store);

    if (args.capabilityId) {
      const catalog = await loadCapabilityCatalog(store);
      const cap = findCapability(args.capabilityId, catalog);
      resolvedCap = cap;
      if (!cap) throw new Error(`CAPABILITY_NOT_FOUND: Unknown capability ${args.capabilityId}`);
      if (cap.status === 'coming_soon') {
        throw new Error(`CAPABILITY_COMING_SOON: ${cap.title} (${cap.id}) is coming soon and cannot be executed yet`);
      }
      if (cap.status === 'deprecated' || cap.status === 'hidden') {
        throw new Error(
          `CAPABILITY_DEPRECATED: ${cap.id} is no longer active${cap.replacementCapabilityId ? `; use ${cap.replacementCapabilityId} instead` : ''}`,
        );
      }
      if (!cap.channels[channel]) {
        throw new Error(`CAPABILITY_CHANNEL_DISABLED: ${cap.id} is not enabled on channel ${channel}`);
      }

      const options = validateCapabilityOptions(cap, args.options);
      const rawPrompt = typeof args.prompt === 'string' ? args.prompt : '';
      if (cap.input.promptRequired && !rawPrompt.trim()) {
        throw new ToolInputError(`prompt is required for capability ${cap.id}`, 'prompt', 'missing');
      }

      const references: AssetReference[] = args.references ?? [];
      if (cap.executor.kind !== 'service') {
        if (references.length < cap.input.minReferences || references.length > cap.input.maxReferences) {
          throw new ToolInputError(
            `capability ${cap.id} requires ${cap.input.minReferences}..${cap.input.maxReferences} reference assets`,
            'references',
            'out_of_range',
          );
        }
      }

      if (cap.executor.kind === 'script') {
        const scriptId = cap.executor.scriptId;
        const handler = resolveScriptExecutor(scriptId);
        if (!handler) throw new Error(`CAPABILITY_UNAVAILABLE: Script executor ${scriptId} is not registered`);
        if (isDryRun) {
          let selectedModel = `script:${scriptId}`;
          if (scriptId === 'opendesign-3d' || scriptId === 'opendesign-world') {
            const requestedModel = typeof args.model === 'string' && args.model.trim() ? args.model.trim() : undefined;
            const colon = requestedModel?.indexOf(':') ?? -1;
            const requestedProvider = colon > 0 && requestedModel ? requestedModel.slice(0, colon) : undefined;
            const requestedModelId = colon > 0 && requestedModel ? requestedModel.slice(colon + 1) : requestedModel;
            const liveSpatial = scriptId === 'opendesign-world'
              ? await discoverOpenDesignWorld(store, false, requestedProvider)
              : await discoverOpenDesign3d(store, false, requestedProvider);
            if (!liveSpatial.available || !liveSpatial.provider) {
              throw new Error(
                scriptId === 'opendesign-world'
                  ? 'CAPABILITY_UNAVAILABLE: No active 3D world model is currently exposed on your configured OpenDesign account or Cloud gateway'
                  : 'CAPABILITY_UNAVAILABLE: No active 3D model is currently exposed on your configured OpenDesign account or Cloud gateway',
              );
            }
            const matchedModel = requestedModelId
              ? liveSpatial.models.find(m => m.modelId === requestedModelId)
              : liveSpatial.models[0];
            if (requestedModelId && !matchedModel) {
              throw new Error(`CAPABILITY_MODEL_INCOMPATIBLE: Model ${requestedModel} is not available for capability ${cap.id}`);
            }
            if (matchedModel) {
              selectedModel = `${liveSpatial.provider}:${matchedModel.modelId}`;
            }
          }
          const quote = await estimateCapabilityQuote({
            store,
            capability: cap,
            options,
            parameters: args.parameters ?? {},
            referenceCount: references.length,
          });
          return { dryRun: true, capabilityId: cap.id, executorKind: 'script' as const, selectedModel, quote };
        }

        const scriptModality = isMediaTelemetryModality(cap.modality) ? cap.modality : '3d';
        const spatialKind = spatialKindForCapability(cap.id, scriptId);
        const telemetryRequestId = randomUUID();
        const attemptId = randomUUID();
        const scriptParameters = args.parameters && typeof args.parameters === 'object' && !Array.isArray(args.parameters)
          ? args.parameters as Record<string, unknown>
          : {};
        const isEdit = references.length > 0 || Boolean(args.parentVersionId);
        const requestCreatedAt = Date.now();
        let executionStartedAt = requestCreatedAt;
        let scriptJobId: string = randomUUID();
        let submittedEmitted = false;
        let terminalRecorded = false;
        let scriptMeta: CapabilityScriptTelemetryMeta = { ...(spatialKind ? { spatialKind } : {}) };
        let sanitizedReplayAttribution: ScriptTelemetryAttribution | undefined;
        const stages = createStageTimingTracker('precheck');
        const currentSanitizedAttribution = (): ScriptTelemetryAttribution => {
          if (sanitizedReplayAttribution) return sanitizedReplayAttribution;
          const providerMeta = scriptProviderTrackingMeta({
            provider: scriptMeta.provider,
            modelId: scriptMeta.modelId,
            providerOrigin: scriptMeta.providerOrigin,
            mode: scriptMeta.mode,
            accountPlan: scriptMeta.accountPlan,
          });
          return {
            ...(providerMeta.provider_kind ? { providerKind: providerMeta.provider_kind } : {}),
            ...(providerMeta.route_channel ? { routeChannel: providerMeta.route_channel } : {}),
            ...(providerMeta.model_provider ? { modelProvider: providerMeta.model_provider } : {}),
            ...(providerMeta.model_id ? { modelId: providerMeta.model_id } : {}),
            ...(providerMeta.generation_mode ? { generationMode: providerMeta.generation_mode } : {}),
            ...(providerMeta.account_plan ? { accountPlan: providerMeta.account_plan } : {}),
          };
        };
        const buildCommonInput = () => {
          const attr = currentSanitizedAttribution();
          return {
            modality: scriptModality,
            executorKind: 'script' as const,
            capabilityId: cap.id,
            spatialKind: scriptMeta.spatialKind ?? spatialKind,
            pipelineStep: stages.pipelineStep ?? scriptMeta.pipelineStep,
            entrySurface,
            destination: 'library' as const,
            referenceCount: references.length,
            isEdit,
            providerKind: attr.providerKind,
            routeChannel: attr.routeChannel,
            modelProvider: attr.modelProvider,
            modelId: attr.modelId,
            generationMode: attr.generationMode,
            accountPlan: attr.accountPlan,
            parameters: scriptParameters,
          };
        };
        const emitScriptSubmitted = () => {
          if (submittedEmitted) return;
          submittedEmitted = true;
          recordMediaGenerationSubmitted(effectiveTracking, {
            ...buildCommonInput(),
            requestId: telemetryRequestId,
            jobId: scriptJobId,
            attemptId,
            attemptNumber: 1,
            attemptKind: 'initial',
            hasIdempotencyKey: true,
            queueDepth: Math.max(0, inFlightScriptRuns.size - 1),
          }, host);
        };
        const reportStage: NonNullable<CapabilityScriptContext['reportStage']> = (stage, meta) => {
          if (meta) {
            scriptMeta = {
              ...scriptMeta,
              ...meta,
              ...(meta.spatialKind ? { spatialKind: meta.spatialKind } : {}),
            };
          }
          emitScriptSubmitted();
          stages.markStage(stage, {
            remoteId: meta?.remoteId,
            remoteTerminal: meta?.remoteTerminal,
            pipelineStep: meta?.pipelineStep,
          });
        };

        telemetryOwned = true;
        recordMediaGenerationRequested(effectiveTracking, {
          modality: scriptModality,
          requestId: telemetryRequestId,
          executorKind: 'script',
          capabilityId: cap.id,
          spatialKind,
          entrySurface,
          destination: 'library',
          referenceCount: references.length,
          isEdit,
          hasIdempotencyKey: true,
        }, host);

        let reservation:
          | { kind: 'replayed'; jobId: string; telemetry?: ScriptTelemetryAttribution; result: ScriptExecutionResult & { replayed: true } }
          | { kind: 'wait'; jobId: string; promise: Promise<ScriptExecutionResult> }
          | {
              kind: 'run';
              jobId: string;
              targetAssetId: string;
              gate: Promise<ScriptExecutionResult>;
              resolveInFlight: (value: ScriptExecutionResult) => void;
              rejectInFlight: (reason?: unknown) => void;
            };
        const normalizedModel = typeof args.model === 'string' && args.model.trim() ? args.model.trim() : undefined;
        const inputHash = assetHash({
          capabilityId: cap.id,
          ...(normalizedModel ? { model: normalizedModel } : {}),
          prompt: rawPrompt,
          options,
          parameters: scriptParameters,
          assetId: args.assetId ?? null,
          parentVersionId: args.parentVersionId ?? null,
          references,
        });
        const receiptPath = path.join(library.root, 'requests', `${assetHash(`script:${args.requestId}`)}.json`);
        const workspaceLock = store.workspaceStore ?? store;

        try {
          await requireNativeRuntime(pluginRoot, 'media');
          await library.validateGeneration({
            assetId: args.assetId,
            title: args.name,
            parentVersionId: args.parentVersionId,
            capabilityId: cap.id,
            capabilityOptions: Object.keys(options).length ? options : undefined,
            references,
            conversationId: args.conversationId,
          });
          reservation = await workspaceLock.lock(async () => {
            const existingReceipt = await readScriptReceipt(receiptPath);
            if (existingReceipt) {
              if (existingReceipt.inputHash !== inputHash) {
                throw new Error('REQUEST_ID_CONFLICT: requestId was already used with different capability inputs');
              }
              const saved = await library.get(existingReceipt.assetId).catch(() => undefined);
              const priorVersion = saved?.versions.find(v => v.requestId === args.requestId);
              if (saved && priorVersion) {
                const replayJobId = existingReceipt.jobId ?? saved.id;
                return {
                  kind: 'replayed' as const,
                  jobId: replayJobId,
                  telemetry: sanitizeScriptTelemetryAttribution(existingReceipt.telemetry),
                  result: {
                    capabilityId: cap.id,
                    executorKind: 'script' as const,
                    costTier: cap.costTier,
                    asset: saved,
                    version: priorVersion,
                    mediaUrl: assetMediaUrl(saved.id, priorVersion.id),
                    ...(priorVersion.result ? { result: priorVersion.result } : {}),
                    replayed: true as const,
                  },
                };
              }
              if (existingReceipt.status === 'pending') {
                const inFlight = inFlightScriptRuns.get(receiptPath);
                if (inFlight) {
                  return { kind: 'wait' as const, jobId: existingReceipt.jobId ?? inFlight.jobId, promise: inFlight.promise };
                }
                if (existingReceipt.workerPid && existingReceipt.workerPid !== process.pid && isPidAlive(existingReceipt.workerPid)) {
                  throw new Error('REQUEST_IN_PROGRESS: requestId is already being executed by another active process');
                }
              }
            }
            const targetAssetId = existingReceipt?.assetId ?? args.assetId ?? crypto.randomUUID();
            // Always mint a fresh jobId for a new run (even when recovering an abandoned pending receipt after a crash).
            const runJobId = scriptJobId;
            await atomicAssetJson(receiptPath, {
              inputHash,
              assetId: targetAssetId,
              jobId: runJobId,
              workerPid: process.pid,
              status: 'pending',
            } satisfies ScriptReceipt);
            let resolveInFlight!: (value: ScriptExecutionResult) => void;
            let rejectInFlight!: (reason?: unknown) => void;
            const gate = new Promise<ScriptExecutionResult>((resolve, reject) => {
              resolveInFlight = resolve;
              rejectInFlight = reject;
            });
            gate.catch(() => {});
            inFlightScriptRuns.set(receiptPath, { jobId: runJobId, promise: gate });
            return {
              kind: 'run' as const,
              jobId: runJobId,
              targetAssetId,
              gate,
              resolveInFlight,
              rejectInFlight,
            };
          });
        } catch (error) {
          const { reason, category } = classifyRejectionError(error);
          recordMediaGenerationRejected(effectiveTracking, {
            ...buildCommonInput(),
            requestId: telemetryRequestId,
            hasIdempotencyKey: true,
            reason,
            category,
          }, host);
          throw error;
        }

        if (reservation.kind === 'replayed') {
          if (reservation.telemetry) sanitizedReplayAttribution = reservation.telemetry;
          recordMediaGenerationReplayed(effectiveTracking, {
            ...buildCommonInput(),
            requestId: telemetryRequestId,
            jobId: reservation.jobId,
            existingJobState: 'completed',
          }, host);
          return reservation.result;
        }
        if (reservation.kind === 'wait') {
          try {
            const completed = await reservation.promise;
            if (completed._telemetry) sanitizedReplayAttribution = completed._telemetry;
            recordMediaGenerationReplayed(effectiveTracking, {
              ...buildCommonInput(),
              requestId: telemetryRequestId,
              jobId: reservation.jobId,
              existingJobState: 'completed',
            }, host);
            const { _telemetry: _, ...publicCompleted } = completed;
            return { ...publicCompleted, replayed: true };
          } catch (error) {
            const { reason, category } = classifyRejectionError(error);
            recordMediaGenerationRejected(effectiveTracking, {
              ...buildCommonInput(),
              requestId: telemetryRequestId,
              hasIdempotencyKey: true,
              reason,
              category,
            }, host);
            throw error;
          }
        }

        scriptJobId = reservation.jobId;
        try {
          const resolvedRefs = await Promise.all(
            references.map(async ref => {
              const item = await library.resolve(ref);
              return { assetId: ref.assetId, versionId: ref.versionId, filename: item.filename };
            }),
          );
          executionStartedAt = Date.now();
          const output = await handler({
            store,
            capability: cap,
            requestId: args.requestId,
            ...(normalizedModel ? { model: normalizedModel } : {}),
            prompt: rawPrompt,
            options,
            parameters: scriptParameters,
            references: resolvedRefs,
            reportStage,
          });
          stages.markStage('saving');
          let prepared: Awaited<ReturnType<AssetLibrary['prepare']>> | undefined;
          let finalResult: (ScriptExecutionResult & { replayed?: boolean }) | undefined;
          try {
            prepared = await library.prepare(output.sourcePath);
            const committedTelemetry = currentSanitizedAttribution();
            const committed = await workspaceLock.lock(async () => {
              const latestReceipt = await readScriptReceipt(receiptPath);
              if (latestReceipt && latestReceipt.inputHash !== inputHash) {
                throw new Error('REQUEST_ID_CONFLICT: requestId was already used with different capability inputs');
              }
              if (latestReceipt) {
                const saved = await library.get(latestReceipt.assetId).catch(() => undefined);
                const priorVersion = saved?.versions.find(v => v.requestId === args.requestId);
                if (saved && priorVersion) {
                  return {
                    asset: saved,
                    version: priorVersion,
                    replayed: true,
                    jobId: latestReceipt.jobId ?? saved.id,
                    telemetry: sanitizeScriptTelemetryAttribution(latestReceipt.telemetry),
                  };
                }
              }
              const asset = await library.addLocked(prepared!, {
                assetId: args.assetId,
                createId: latestReceipt?.assetId ?? reservation.targetAssetId,
                name: args.name || output.name || cap.title,
                expectedModality: cap.modality === '3d' ? undefined : cap.modality,
                version: {
                  source: 'generated',
                  prompt: rawPrompt || cap.title,
                  model: `script:${cap.executor.kind === 'script' ? cap.executor.scriptId : cap.id}`,
                  parameters: scriptParameters,
                  capabilityId: cap.id,
                  ...(Object.keys(options).length ? { capabilityOptions: options } : {}),
                  references,
                  parentVersionId: args.parentVersionId,
                  requestId: args.requestId,
                  requestHash: inputHash,
                  conversationId: args.conversationId,
                  ...(output.result ? { result: output.result } : {}),
                },
              });
              const version = asset.versions.find(v => v.requestId === args.requestId) ?? asset.versions[asset.versions.length - 1];
              await atomicAssetJson(receiptPath, {
                inputHash,
                assetId: asset.id,
                jobId: scriptJobId,
                status: 'completed',
                versionId: version.id,
                ...(Object.keys(committedTelemetry).length ? { telemetry: committedTelemetry } : {}),
              } satisfies ScriptReceipt);
              return { asset, version, replayed: false, jobId: scriptJobId, telemetry: committedTelemetry };
            });
            try {
              await output.onCommitted?.();
            } catch {
              // Best-effort post-commit hook must not fail a committed asset.
            }
            const doneAt = Date.now();
            const finalTimings = stages.finish(doneAt);
            const outputBytes = typeof output.result?.bytes === 'number' && Number.isFinite(output.result.bytes)
              ? output.result.bytes
              : prepared?.bytes;
            if (committed.replayed && !submittedEmitted) {
              if (committed.telemetry) sanitizedReplayAttribution = committed.telemetry;
              terminalRecorded = true;
              recordMediaGenerationReplayed(effectiveTracking, {
                ...buildCommonInput(),
                requestId: telemetryRequestId,
                jobId: committed.jobId,
                existingJobState: 'completed',
              }, host);
            } else {
              emitScriptSubmitted();
              terminalRecorded = true;
              recordMediaGenerationResult(effectiveTracking, {
                ...buildCommonInput(),
                jobId: scriptJobId,
                requestId: telemetryRequestId,
                attemptId,
                attemptNumber: 1,
                attemptKind: 'initial',
                jobState: 'completed',
                assetCount: 1,
                durationMs: doneAt - executionStartedAt,
                queueWaitMs: Math.max(0, executionStartedAt - requestCreatedAt),
                endToEndMs: doneAt - requestCreatedAt,
                ...finalTimings,
                hasRemoteId: stages.hasRemoteId || typeof output.result?.taskId === 'string',
                remoteTaskId: stages.remoteId ?? (typeof output.result?.taskId === 'string' ? output.result.taskId : undefined),
                providerOrigin: scriptMeta.providerOrigin,
                totalOutputBytes: outputBytes,
              }, host);
            }
            const publicResult: ScriptExecutionResult = {
              capabilityId: cap.id,
              executorKind: 'script',
              costTier: cap.costTier,
              asset: committed.asset,
              version: committed.version,
              mediaUrl: assetMediaUrl(committed.asset.id, committed.version.id),
              ...(committed.version.result ? { result: committed.version.result } : {}),
            };
            reservation.resolveInFlight({ ...publicResult, _telemetry: committed.telemetry });
            finalResult = committed.replayed ? { ...publicResult, replayed: true } : publicResult;
          } finally {
            if (prepared) await rm(prepared.file, { force: true }).catch(() => {});
            // Best-effort temp cleanup (including sync throws) must never convert a committed asset into a failed call or double-emit telemetry.
            try {
              await output.cleanup?.();
            } catch {
              // Ignore cleanup failures after commit or error handling.
            }
          }
          return finalResult;
        } catch (error) {
          if (!terminalRecorded) {
            terminalRecorded = true;
            if (!submittedEmitted && isScriptPreflightError(error)) {
              const { reason, category } = classifyRejectionError(error);
              recordMediaGenerationRejected(effectiveTracking, {
                ...buildCommonInput(),
                requestId: telemetryRequestId,
                hasIdempotencyKey: true,
                reason,
                category,
              }, host);
            } else {
              emitScriptSubmitted();
              const failedAt = Date.now();
              const finalTimings = stages.finish(failedAt);
              const failurePhase = stages.activeStage === 'remote_task' || stages.remoteTerminal
                ? 'remote_task'
                : stages.activeStage === 'precheck'
                  ? 'submitting'
                  : stages.activeStage;
              recordMediaGenerationResult(effectiveTracking, {
                ...buildCommonInput(),
                jobId: scriptJobId,
                requestId: telemetryRequestId,
                attemptId,
                attemptNumber: 1,
                attemptKind: 'initial',
                jobState: 'failed',
                assetCount: 0,
                durationMs: failedAt - executionStartedAt,
                queueWaitMs: Math.max(0, executionStartedAt - requestCreatedAt),
                endToEndMs: failedAt - requestCreatedAt,
                ...finalTimings,
                remoteTerminal: stages.remoteTerminal ? true : undefined,
                hasRemoteId: stages.hasRemoteId,
                remoteTaskId: stages.remoteId,
                providerOrigin: scriptMeta.providerOrigin,
                isResumable: false,
                savePending: false,
                failurePhase,
                cause: error,
              }, host);
            }
          }
          await workspaceLock.lock(async () => {
            const latestReceipt = await readScriptReceipt(receiptPath).catch(() => undefined);
            if (latestReceipt?.status === 'pending' && latestReceipt.inputHash === inputHash && latestReceipt.jobId === scriptJobId) {
              const saved = await library.get(latestReceipt.assetId).catch(() => undefined);
              if (!saved?.versions.some(v => v.requestId === args.requestId)) {
                await rm(receiptPath, { force: true }).catch(() => {});
              }
            }
          }).catch(() => {});
          reservation.rejectInFlight(error);
          throw error;
        } finally {
          if (inFlightScriptRuns.get(receiptPath)?.promise === reservation.gate) {
            inFlightScriptRuns.delete(receiptPath);
          }
        }
      }

      if (cap.executor.kind === 'service' && cap.executor.serviceId === 'asr-transcribe') {
        telemetryOwned = true;
        let sourcePath = args.sourcePath;
        if (!sourcePath && references.length === 1) {
          sourcePath = (await library.resolve(references[0])).filename;
        }
        if (!sourcePath) {
          throw new ToolInputError('sourcePath or 1 audio/video asset reference is required for asr-transcribe', 'sourcePath', 'missing');
        }
        if (isDryRun) {
          if (args.language !== undefined && (typeof args.language !== 'string' || !/^(auto|[a-z]{2,3})$/.test(args.language))) {
            throw new Error('Choose an ISO language code or auto');
          }
          const asrCatalog = await transcriptsFor(store).models();
          const asrModel = asrCatalog.models.find(item => item.id === (args.model ?? asrCatalog.defaultModel));
          if (!asrModel) {
            throw new Error('CAPABILITY_UNAVAILABLE: Configure an enabled transcription model in Settings > Model providers');
          }
          const quote = await estimateCapabilityQuote({
            store,
            capability: cap,
            options,
            parameters: args.parameters ?? {},
            referenceCount: references.length,
          });
          return {
            dryRun: true,
            capabilityId: cap.id,
            executorKind: 'service' as const,
            selectedModel: asrModel.id,
            quote: { ...quote, selectedModel: quote.selectedModel ?? asrModel.id },
          };
        }
        const submitted = await transcriptOperation(store, {
          command: 'submit',
          projectId: args.projectId ?? 'project',
          sourcePath,
          requestId: args.requestId,
          model: args.model,
          language: args.language,
          parameters: args.parameters,
        });
        return {
          capabilityId: cap.id,
          executorKind: 'service' as const,
          costTier: cap.costTier,
          ...submitted,
        };
      }

      if (cap.modality === '3d') {
        throw new Error(`CAPABILITY_UNAVAILABLE: No 3D executor is configured for ${cap.id}`);
      }

      const [status, models] = await Promise.all([gateway.status(), gateway.models()]);
      const availableProviders = new Set(
        status.providers
          .filter(p => p.available && !(p.id === 'account' && p.mediaEntitlement === 'not-included'))
          .map(p => p.id),
      );
      const compatible = selectCompatibleModels(cap, models, availableProviders, references.length);
      let chosen: Model | undefined;
      if (args.model) {
        chosen = compatible.find(m => m.id === args.model)
          ?? (typeof args.model === 'string' && !args.model.includes(':')
            ? compatible.find(m => m.modelId === args.model)
            : undefined);
        if (!chosen) {
          const catalogModel = models.find(m => m.id === args.model);
          if (catalogModel && capabilitySupportsModel(cap, catalogModel)) {
            if (!availableProviders.has(catalogModel.provider)) {
              throw new Error(`CAPABILITY_UNAVAILABLE: Provider ${catalogModel.provider} is not ready for model ${args.model}`);
            }
            if (references.length >= 1 && (catalogModel.modality === 'image' || catalogModel.modality === 'video') && modelReferenceLimit(catalogModel) < references.length) {
              throw new Error(`CAPABILITY_MODEL_INCOMPATIBLE: Model ${args.model} accepts at most ${modelReferenceLimit(catalogModel)} reference image(s)`);
            }
          }
          throw new Error(`CAPABILITY_MODEL_INCOMPATIBLE: Model ${args.model} does not support capability ${cap.id}`);
        }
      } else {
        const routeId = status.routes[cap.modality];
        chosen = (cap.executor.kind === 'model' ? compatible.find(m => m.id === routeId) : undefined) ?? compatible[0];
      }
      if (!chosen) {
        throw new Error(`CAPABILITY_UNAVAILABLE: No configured provider/model is ready for capability ${cap.id}`);
      }

      if (args.mode !== undefined) {
        if (!['text-to-image', 'text-to-video', 'text-to-audio', 'text-to-speech'].includes(args.mode)) {
          throw new ToolInputError('Unsupported generation mode', 'mode', 'invalid_enum');
        }
        if (args.mode !== `text-to-${cap.modality}` && !(cap.modality === 'audio' && args.mode === 'text-to-speech')) {
          throw new ToolInputError('Generation mode does not match modality', 'mode', 'invalid_enum');
        }
      }
      const executorMode =
        cap.executor.kind === 'model' || cap.executor.kind === 'prompt-preset' || cap.executor.kind === 'dedicated-model'
          ? cap.executor.mode
          : undefined;
      const requestedMode = args.mode ?? executorMode;
      if (['account', 'opendesign'].includes(chosen.provider) && requestedMode && requestedMode !== chosen.mode) {
        throw new Error(`CAPABILITY_MODEL_INCOMPATIBLE: Generation mode ${requestedMode} does not match the selected ${chosen.provider === 'account' ? 'account' : 'Cloud'} model`);
      }
      const resolvedModel: Model = requestedMode ? { ...chosen, mode: requestedMode } : chosen;

      const videoPresetParams: Record<string, unknown> =
        cap.id === 'camera-control' || cap.id === 'multi-shot'
          ? videoFeatureParameters(cap.id as VideoFeatureId, resolvedModel)
          : {};
      if (cap.executor.kind === 'prompt-preset' && cap.executor.forceAudio) {
        const audioField = (resolvedModel.generationOptions ?? generationOptions(resolvedModel))?.fields.find(
          field => field.key === 'generate_audio' || field.key === 'audio',
        );
        videoPresetParams[audioField?.key ?? 'generate_audio'] = true;
      }
      const mergedParameters = buildCapabilityParameters(cap, options, { ...videoPresetParams, ...(args.parameters ?? {}) });
      const resolvedParameters = resolveGenerationParameters(resolvedModel, mergedParameters, references.length > 0);
      validateGenerationOptions(resolvedModel, resolvedParameters, references.length > 0);
      if (resolvedModel.provider === 'opendesign' && references.length > 0 && resolvedParameters.images !== undefined) {
        throw new Error('Choose pinned references or parameters.images for Cloud input');
      }
      const effectivePrompt =
        cap.executor.kind === 'dedicated-model'
          ? rawPrompt.trim() || cap.title
          : buildCapabilityPrompt(cap.id, rawPrompt, options, catalog);

      const quote = await estimateCapabilityQuote({
        store,
        capability: cap,
        model: resolvedModel,
        options,
        parameters: resolvedParameters,
        referenceCount: references.length,
      });
      if (isDryRun) {
        return {
          dryRun: true,
          capabilityId: cap.id,
          executorKind: cap.executor.kind,
          selectedModel: resolvedModel.id,
          mode: resolvedModel.mode,
          effectiveParameters: resolvedParameters,
          quote,
        };
      }

      await requireNativeRuntime(pluginRoot, 'media');
      telemetryOwned = true;
      const job = await gateway.submit({
        modality: cap.modality,
        prompt: effectivePrompt,
        model: resolvedModel.id,
        mode: requestedMode ?? resolvedModel.mode,
        idempotencyKey: args.requestId,
        parameters: mergedParameters,
        capabilityId: cap.id,
        ...(Object.keys(options).length ? { capabilityOptions: options } : {}),
        library: {
          assetId: args.assetId,
          title: args.name,
          parentVersionId: args.parentVersionId,
          capabilityId: cap.id,
          ...(Object.keys(options).length ? { capabilityOptions: options } : {}),
          references,
          conversationId: args.conversationId,
        },
      }, host, { entrySurface });
      return {
        capabilityId: cap.id,
        executorKind: cap.executor.kind,
        selectedModel: job.model.id,
        costTier: cap.costTier,
        quote,
        job,
        next: { tool: 'openmotion_job_manage', action: 'status', jobId: job.id },
      };
    }

    // Raw model fallback when no dedicated capabilityId is specified
    if (!args.model) throw new ToolInputError('capabilityId or model is required', 'capabilityId', 'missing');
    if (args.modality !== 'image' && args.modality !== 'video' && args.modality !== 'audio') {
      throw new ToolInputError('modality must be image, video, or audio when calling by raw model', 'modality', args.modality ? 'invalid_enum' : 'missing');
    }
    const rawModality = args.modality as Modality;
    if (typeof args.prompt !== 'string' || !args.prompt.trim()) {
      throw new ToolInputError('prompt is required when calling by raw model', 'prompt', 'missing');
    }
    if (args.mode !== undefined) {
      if (!['text-to-image', 'text-to-video', 'text-to-audio', 'text-to-speech'].includes(args.mode)) {
        throw new ToolInputError('Unsupported generation mode', 'mode', 'invalid_enum');
      }
      if (args.mode !== `text-to-${rawModality}` && !(rawModality === 'audio' && args.mode === 'text-to-speech')) {
        throw new ToolInputError('Generation mode does not match modality', 'mode', 'invalid_enum');
      }
    }
    if (isDryRun) {
      const [status, models] = await Promise.all([gateway.status(), gateway.models()]);
      const availableProviders = new Set(
        status.providers
          .filter(p => p.available && !(p.id === 'account' && p.mediaEntitlement === 'not-included'))
          .map(p => p.id),
      );
      let chosen = models.find(m => m.id === args.model && m.modality === rawModality);
      if (!chosen && models.some(m => m.id === args.model)) {
        throw new Error(`CAPABILITY_MODEL_INCOMPATIBLE: Model ${args.model} does not match modality ${rawModality}`);
      }
      if (!chosen && typeof args.model === 'string') {
        const colon = args.model.indexOf(':');
        const provider = colon > 0 ? mediaProviders.find(id => id === args.model.slice(0, colon)) : undefined;
        const modelId = colon > 0 ? args.model.slice(colon + 1) : '';
        if (provider && /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,140}$/.test(modelId)) {
          chosen = {
            id: args.model,
            provider,
            modelId,
            label: modelId,
            modality: rawModality,
            mode: args.mode ?? `text-to-${rawModality}`,
            source: 'custom',
          };
        }
      }
      if (!chosen || !availableProviders.has(chosen.provider)) {
        throw new Error(`CAPABILITY_UNAVAILABLE: Selected model ${args.model} is unavailable; configure an available provider or choose a different model`);
      }
      if (['account', 'opendesign'].includes(chosen.provider) && args.mode && args.mode !== chosen.mode) {
        throw new Error(`CAPABILITY_MODEL_INCOMPATIBLE: Generation mode ${args.mode} does not match the selected ${chosen.provider === 'account' ? 'account' : 'Cloud'} model`);
      }
      const resolvedModel: Model = args.mode ? { ...chosen, mode: args.mode } : chosen;
      const rawRefs: AssetReference[] = Array.isArray(args.references) ? args.references : [];
      const rawParams = args.parameters && typeof args.parameters === 'object' && !Array.isArray(args.parameters)
        ? args.parameters as Record<string, unknown>
        : {};
      const resolvedParameters = resolveGenerationParameters(resolvedModel, rawParams, rawRefs.length > 0);
      validateGenerationOptions(resolvedModel, resolvedParameters, rawRefs.length > 0);
      const referenceLimit = modelReferenceLimit(resolvedModel);
      if (rawRefs.length && resolvedModel.provider === 'opendesign' && resolvedModel.modality === 'image' && resolvedModel.supportsImageReference === undefined) {
        throw new Error('Image editing capability is unknown. Sync Cloud models before using references.');
      }
      if (rawRefs.length && !referenceLimit) {
        throw new Error(rawModality === 'video'
          ? 'This video model does not accept an input image. Choose a video model with maxInputImages, or remove the reference.'
          : 'This model does not support asset references. Choose an image model that supports editing, or remove the reference.');
      }
      if (rawRefs.length > referenceLimit) {
        throw new Error(`This model accepts at most ${referenceLimit} input image${referenceLimit === 1 ? '' : 's'}`);
      }
      if (resolvedModel.provider === 'opendesign' && rawRefs.length && resolvedParameters.images !== undefined) {
        throw new Error('Choose pinned references or parameters.images for Cloud input');
      }
      const quote = await estimateCapabilityQuote({
        store,
        modality: rawModality,
        model: resolvedModel,
        options: {},
        parameters: resolvedParameters,
        referenceCount: rawRefs.length,
      });
      return {
        dryRun: true,
        executorKind: 'model' as const,
        selectedModel: resolvedModel.id,
        modality: rawModality,
        mode: resolvedModel.mode,
        effectiveParameters: resolvedParameters,
        quote,
      };
    }
    await requireNativeRuntime(pluginRoot, 'media');
    telemetryOwned = true;
    const job = await gateway.submit({
      modality: rawModality,
      prompt: args.prompt,
      model: args.model,
      mode: args.mode,
      idempotencyKey: args.requestId,
      parameters: args.parameters,
      library: {
        assetId: args.assetId,
        title: args.name,
        parentVersionId: args.parentVersionId,
        references: args.references,
        conversationId: args.conversationId,
      },
    }, host, { entrySurface });
    return {
      executorKind: 'model' as const,
      selectedModel: job.model.id,
      job,
      next: { tool: 'openmotion_job_manage', action: 'status', jobId: job.id },
    };
  } catch (error) {
    if (!isDryRun && !telemetryOwned) {
      const cap = resolvedCap ?? (typeof args.capabilityId === 'string' ? findCapability(args.capabilityId) : undefined);
      if (cap?.executor.kind !== 'service') {
        const resolvedModality = isMediaTelemetryModality(cap?.modality)
          ? cap.modality
          : isMediaTelemetryModality(args.modality) ? args.modality : undefined;
        if (resolvedModality) {
          const { reason, category } = classifyRejectionError(error);
          const { referenceCount, isEdit } = extractRequestReferenceMeta(args);
          recordPreGatewayRejection(effectiveTracking, {
            modality: resolvedModality,
            executorKind: cap?.executor.kind === 'script' ? 'script' : 'gateway',
            capabilityId: typeof args.capabilityId === 'string' ? args.capabilityId : undefined,
            spatialKind: spatialKindForCapability(cap?.id),
            entrySurface,
            destination: 'library',
            referenceCount,
            isEdit,
            hasIdempotencyKey: typeof args.requestId === 'string' && args.requestId.length > 0,
            parameters: args.parameters && typeof args.parameters === 'object' && !Array.isArray(args.parameters) ? args.parameters : undefined,
            reason,
            category,
          }, host);
        }
      }
    }
    throw error;
  }
}

export async function jobManage(
  store: WorkspaceStore,
  args: any,
  tracking?: OmTracking,
  channel: 'gui' | 'mcp' = 'mcp',
  host?: HostContext,
  mcpChannel: McpChannel = 'mcp_stdio',
  emitUpgradeLinkResult = true,
) {
  const gateway = gatewayFor(store, tracking);
  if (args.action === 'list') {
    const cap = typeof args.limit === 'number' ? Math.max(1, Math.min(100, args.limit)) : 100;
    const jobs = (await gateway.listJobs(args.projectId))
      .filter(job => !args.conversationId || job.library?.conversationId === args.conversationId)
      .slice(0, cap);
    return { jobs };
  }
  if (args.action === 'status' || args.action === 'cancel' || args.action === 'retry_save' || args.action === 'resume') {
    const job = await gateway.getJob(args.jobId);
    if (args.projectId && job.projectId !== args.projectId) {
      throw new Error('GENERATION_NOT_FOUND: job does not belong to this project');
    }
    if ((args.action === 'retry_save' || args.action === 'resume') && !args.requestId) {
      const err = new ToolInputError('requestId is required', 'requestId', 'missing');
      gateway.recordRetryRejection(job, args.action, err);
      throw err;
    }
    if (args.action === 'resume') return { job: await gateway.resume(job.id, args.requestId) };
    if (args.action === 'retry_save') return { job: await gateway.retrySave(job.id) };
    if (args.action === 'cancel') return { job: await gateway.cancel(job.id, { source: 'mcp' }) };
    const topupFields = await balanceLowTopupForJob(gateway, job, {
      channel,
      mcpChannel,
      studioId: job.projectId ? 'motion' : 'assets',
      directory: (store.workspaceStore ?? store).directory,
      tracking,
      host,
      emitUpgradeLinkResult,
    });
    return { job, ...topupFields };
  }
  throw new ToolInputError('unsupported job manage action', 'action', 'invalid_enum');
}

export async function assetManage(
  store: WorkspaceStore,
  args: any,
  importProject?: (input: any, options?: { receiptName: string; reusePinnedContent: boolean }) => Promise<any>,
  origin?: string,
  tracking?: OmTracking,
) {
  if (args.action === 'brand_kit') {
    return brandKitOperation(brandKitsFor((store.workspaceStore ?? store).directory), args.brandKit, origin ?? '');
  }
  if (['list', 'get', 'read', 'import', 'update', 'import_to_project'].includes(args.action)) {
    return assetOperation(store, args, importProject, tracking);
  }
  throw new ToolInputError('unsupported asset manage action', 'action', 'invalid_enum');
}
