import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, link, lstat, mkdir, open, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { OmTracking } from '../shared/tracking.ts';
import { WorkspaceStore } from '../workspace.ts';
import { accountResumableMedia, legacyRemoteTerminal, modelReferenceLimit, resumableJob, mediaProviders, modalities, type Agent, type GenerateInput, type GenerationJob, type GatewayStatus, type Model, type Modality, type ProviderId, type ProviderState } from '../shared/gateway.ts';
import { builtinModels, discoverModels, modelKey, providerIds, providerLabels, validModelId } from './catalog.ts';
import { detectAgents, generateCodexImage } from './agents.ts';
import { downloadMedia, mediaType, publicProviderFetch, ProviderError, retryRead, type Fetcher } from './network.ts';
import { providerAdapters, waveSpeedModels } from './providers.ts';
import { cloudModels } from './opendesign.ts';
import { ProviderConnections, type GatewayConfig } from './connections.ts';
import { isGatewayProvider, isMediaProvider, registeredProvider } from '../shared/provider-registry.ts';
import { compatibleProvider } from './compatible.ts';
import { OpenDesignAccount } from './account.ts';
import { accountMediaState } from './account-media.ts';
import { AssetLibrary } from './asset-library.ts';
import { requireLibraryMediaRuntime } from './asset-probe.ts';
import { generationOptions, resolveGenerationParameters, validateGenerationOptions } from '../shared/generation-options.ts';
import { loadRegistry, toOpenMotionGenerationOptions } from '../packages/multimodal-models/src/query.ts';
import { audioAssetTitle, classifyAudioKind } from '../shared/audio-kind.ts';
import { MAX_ASSET_BYTES } from '../shared/asset-limits.ts';
import { rankSearchResults } from '../shared/fuzzy-search.ts';
import { type HostContext } from '../tracking/host.ts';
import {
  extractUpstreamErrorCode,
  mediaGenerationModes,
  normalizeAccountPlan,
  normalizeCancelPhase,
  safeCapabilityId,
  type MediaGenerationAccountPlan,
  type MediaGenerationCancelPhase,
  type MediaGenerationCancelSource,
  type MediaGenerationDestination,
  type MediaGenerationEntrySurface,
  type MediaGenerationErrorCode,
  type MediaGenerationFailurePhase,
  type MediaGenerationMode,
  type MediaGenerationRejectionCategory,
  type MediaGenerationRejectionReason,
} from '../tracking/tool-fields.ts';
import {
  clampMs,
  classifyRejectionError,
  extractRequestReferenceMeta,
  createStageTimingTracker,
  generationTrackingFields,
  jobTrackingHost,
  normalizeTrackingHost,
  providerTrackingMeta,
  recordMediaGenerationRejected,
  recordMediaGenerationReplayed,
  recordMediaGenerationRequested,
  recordMediaGenerationResult,
  recordMediaGenerationRetryRejected,
  recordMediaGenerationRetryStarted,
  recordMediaGenerationSubmitted,
  resolveResultErrorFields,
  type LiveTimings,
} from './media-telemetry.ts';

type SubmitTrackingOptions = { entrySurface?: MediaGenerationEntrySurface };
type CancelTrackingOptions = { source?: MediaGenerationCancelSource };
type ResultTelemetry = LiveTimings & {
  cause?: unknown;
  failurePhase?: MediaGenerationFailurePhase;
  phaseBeforeCancel?: MediaGenerationCancelPhase;
  lastActivePhase?: MediaGenerationCancelPhase;
  cancelSource?: MediaGenerationCancelSource;
  cancelWaitMs?: number;
  totalOutputBytes?: number;
  previousErrorCode?: MediaGenerationErrorCode;
  previousFailurePhase?: MediaGenerationFailurePhase;
};

/** Queued input-image snapshot; the first keeps its historical name for older jobs. */
const referenceFile = (index: number, mimeType: string) => (index ? `reference-${index}.` : 'reference.') + (mimeType === 'image/jpeg' ? 'jpg' : mimeType.split('/')[1]);

type Options = { tracking?: OmTracking; fetcher?: Fetcher; detect?: () => Promise<Agent[]>; codex?: typeof generateCodexImage; download?: typeof downloadMedia; pollMs?: number; maxConcurrentJobs?: number };
// 4 keeps OpenDesign Cloud/account batches 2x faster than the previous cap of 2 while staying below Cloud's 5-concurrent per-tier limit.
// Other providers (local Codex CLI and BYOK APIs without verified higher concurrency limits) remain capped at 2.
const DEFAULT_MAX_CONCURRENT_JOBS = 4;
const DEFAULT_MAX_CONCURRENT_OTHER_JOBS = 2;
const isOpenDesignConcurrencyProvider = (provider: string) => provider === 'opendesign' || provider === 'account';
type SavedOutput = { path: string; mimeType: string; bytes: number; sha256: string };
const saveUnavailable = 'SAVE_NOT_AVAILABLE: retained outputs are missing, changed or unreadable; no model request was made';
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const uuid = (id: unknown): id is string => typeof id === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id);
function alive(pid?: number) { try { if (!pid) return false; process.kill(pid, 0); return true; } catch { return false; } }
async function readJson<T>(file: string, fallback: T): Promise<T> {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback; throw new Error('Model gateway data is unreadable'); }
}
async function atomic(file: string, value: unknown) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = file + '.' + randomUUID() + '.tmp';
  try { await writeFile(temp, JSON.stringify(value, null, 2), { mode: 0o600 }); await rename(temp, file); }
  finally { await rm(temp, { force: true }); }
}
function providerId(value: unknown): asserts value is ProviderId {
  if (!providerIds.includes(value as ProviderId)) throw new Error('Unknown model provider');
}
function modality(value: unknown): asserts value is Modality {
  if (!modalities.includes(value as Modality)) throw new Error('modality must be image, video or audio');
}
function parameters(value: unknown): Record<string, unknown> {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value) || JSON.stringify(value).length > 64_000) throw new Error('parameters must be an object under 64 KB');
  if (Object.keys(value).some(key => /^(?:model|prompt|api[_-]?key|authorization|webhook_url|__proto__|constructor|prototype)$/i.test(key))) throw new Error('parameters contains a reserved field');
  return value as Record<string, unknown>;
}

function resolveRegistryGenerationOptions(model: Model) {
  const builtinOrMeasured = generationOptions(model);
  if (builtinOrMeasured) return builtinOrMeasured;
  if (model.provider === 'opendesign' || model.provider === 'account') return undefined;
  try {
    const registry = loadRegistry();
    const endpoint = registry.endpoints[model.id];
    if (!endpoint || endpoint.modality !== model.modality || endpoint.schemaQuality === 'catalog-metadata' || !endpoint.parameters.length) {
      return undefined;
    }
    return toOpenMotionGenerationOptions(endpoint);
  } catch {
    return undefined;
  }
}

export class ModelGateway {
  store: WorkspaceStore;
  options: Options;
  root: string;
  connections: ProviderConnections;
  account: OpenDesignAccount;
  active = new Map<string, { controller: AbortController; done: Promise<void>; snapshotTimings?: () => LiveTimings }>();
  private cloudFailure?: { identity: string; time: number };
  private cloudReads = new Map<string, Promise<string | undefined>>();
  private detecting?: Promise<Agent[]>;
  private agentCache?: { time: number; agents: Agent[] };
  private ticking = false;
  private closed = false;
  constructor(store: WorkspaceStore, options: Options = {}) {
    this.store = store; this.options = options; this.root = path.join(store.directory, 'model-gateway');
    this.connections = new ProviderConnections(store, options.fetcher ?? publicProviderFetch);
    this.account = new OpenDesignAccount(store.directory);
  }
  config(): Promise<GatewayConfig> { return this.connections.gatewayConfig(); }
  private credential(id: ProviderId) { return this.connections.resolveCredential(id); }
  async configureProvider(id: unknown, input: Record<string, unknown>) {
    if (typeof id !== 'string') throw new Error('Unknown model provider');
    await this.connections.configure(id, input);
    return this.status();
  }
  private cloudOrigin() { return this.connections.baseUrl('opendesign'); }
  async agents(refresh = false) {
    if (!refresh && this.agentCache && Date.now() - this.agentCache.time < 30_000) return this.agentCache.agents;
    if (!this.detecting) this.detecting = (this.options.detect ?? detectAgents)().then(agents => { this.agentCache = { time: Date.now(), agents }; return agents; }).finally(() => { this.detecting = undefined; });
    return this.detecting;
  }
  /** Bind private catalogue metadata to its effective credential, origin and configuration generation. */
  private async cloudContext() {
    const key = (await this.credential('opendesign')).key, baseUrl = await this.cloudOrigin();
    const state = (await this.config()).providers.opendesign;
    return { key, baseUrl, identity: key && baseUrl && state?.enabled !== false ? hash(JSON.stringify([baseUrl, key, state?.catalogRevision])) : undefined };
  }
  private async cachedCloudModels(): Promise<Model[]> {
    const context = await this.cloudContext();
    const cached = await readJson<{ identity?: string; models?: Model[] }>(path.join(this.root, 'cloud-catalog.json'), {});
    return context.identity && cached.identity === context.identity && Array.isArray(cached.models) && (await this.cloudContext()).identity === context.identity ? cached.models : [];
  }
  private async syncCloudModels(refresh: boolean): Promise<string | undefined> {
    const context = await this.store.lock(() => this.cloudContext());
    if (!context.identity) return;
    const cached = await readJson<{ identity?: string; models?: Model[] }>(path.join(this.root, 'cloud-catalog.json'), {});
    if (!refresh && cached.identity === context.identity && Array.isArray(cached.models)) return;
    if (!refresh && this.cloudFailure?.identity === context.identity && Date.now() - this.cloudFailure.time < 30_000) return 'OpenDesign Cloud catalogue unavailable; sync models to retry';
    const current = this.cloudReads.get(context.identity);
    if (current) return current;
    const read = (async (): Promise<string | undefined> => {
      try {
        const models = await cloudModels(context.baseUrl!, context.key, this.options.fetcher ?? publicProviderFetch);
        return await this.store.lock(async () => {
          if ((await this.cloudContext()).identity !== context.identity) return undefined;
          await atomic(path.join(this.root, 'cloud-catalog.json'), { identity: context.identity, models });
          this.cloudFailure = undefined;
          return undefined;
        });
      } catch {
        if ((await this.cloudContext()).identity !== context.identity) return;
        this.cloudFailure = { identity: context.identity, time: Date.now() };
        return 'OpenDesign Cloud catalogue unavailable; only cached models for the current connection and built-in models are shown';
      }
    })();
    this.cloudReads.set(context.identity, read);
    try { return await read; } finally { this.cloudReads.delete(context.identity); }
  }
  async models(): Promise<Model[]> {
    const cached = await readJson<Model[]>(path.join(this.root, 'catalog.json'), []);
    const overrides = await this.connections.modelOverrides();
    const custom = (await this.config()).customModels, compatible = await this.connections.mediaModels(), account = await this.account.mediaModels();
    // Read bound Cloud rows last: no asynchronous work may revive them after this identity check.
    const cloud = await this.cachedCloudModels();
    return [...new Map([...builtinModels, ...cached.filter(model => model.provider !== 'opendesign'), ...cloud, ...custom, ...compatible, ...account].map(model => [model.id, model])).values()].map(model => {
      const live = cloud.find(row => row.id === model.id);
      const merged = { ...model, ...overrides[model.id], ...(live ? { supportsImageReference: live.supportsImageReference, maxInputImages: live.maxInputImages, nativeOptions: live.nativeOptions } : {}) };
      const normalized = ['opendesign', 'account'].includes(merged.provider) && merged.modality === 'image' && merged.supportsImageReference
        ? { ...merged, maxInputImages: modelReferenceLimit(merged) }
        : merged;
      return { ...normalized, generationOptions: resolveRegistryGenerationOptions(normalized) };
    });
  }
  async listModels(input: { provider?: unknown; modality?: unknown; query?: unknown; refresh?: unknown; offset?: unknown; limit?: unknown } = {}) {
    if (input.provider !== undefined && input.provider !== 'account' && !providerIds.includes(input.provider as string) && !(await this.connections.list()).some(p => p.id === input.provider)) throw new Error('Unknown model provider');
    if (input.modality !== undefined) modality(input.modality);
    if (input.query !== undefined && (typeof input.query !== 'string' || input.query.length > 200)) throw new Error('Invalid model search');
    if (input.refresh !== undefined && typeof input.refresh !== 'boolean') throw new Error('refresh must be boolean');
    const warnings: string[] = [];
    if (input.provider === 'opendesign' || input.refresh === true && !input.provider) { const warning = await this.syncCloudModels(input.refresh === true); if (warning) warnings.push(warning); }
    if (input.refresh && input.provider === 'account') await this.account.models(true);
    if (input.refresh && typeof input.provider === 'string' && input.provider !== 'account' && !providerIds.includes(input.provider)) await this.connections.sync(input.provider);
    if (input.refresh) {
      const selected = mediaProviders.filter(id => id !== 'opendesign').filter(id => !input.provider || input.provider === id);
      const discovered = await Promise.all(selected.map(async id => {
        try {
          if (id === 'wavespeed') {
            const key = (await this.credential(id)).key;
            return key ? await waveSpeedModels(key, this.options.fetcher ?? fetch) : [];
          }
          return await discoverModels(id, String(input.query ?? ''), this.options.fetcher ?? fetch);
        }
        catch { warnings.push(`${providerLabels[id]} catalogue unavailable; showing cached and built-in models`); return []; }
      }));
      await this.store.lock(async () => {
        const cached = await readJson<Model[]>(path.join(this.root, 'catalog.json'), []);
        const merged = [...new Map([...cached.filter(model => model.provider !== 'opendesign'), ...discovered.flat()].map(model => [model.id, model])).values()].slice(-5000);
        await atomic(path.join(this.root, 'catalog.json'), merged);
      });
    }
    const query = String(input.query ?? '').trim();
    const scoped = (await this.models()).filter(model => (!input.provider || model.provider === input.provider) && (!input.modality || model.modality === input.modality));
    const all = query
      ? rankSearchResults(scoped, query, model => ({
          id: model.modelId,
          title: model.label,
          subtitle: model.provider,
          description: model.description,
          tags: [model.modality, model.mode, model.provider],
          aliases: [model.id],
        })).map(result => result.item)
      : scoped;
    const offset = input.offset ?? 0, limit = input.limit ?? 100;
    if (!Number.isInteger(offset) || Number(offset) < 0 || !Number.isInteger(limit) || Number(limit) < 1 || Number(limit) > 100) throw new Error('Invalid model pagination');
    return { models: all.slice(Number(offset), Number(offset) + Number(limit)), total: all.length,
      nextOffset: Number(offset) + Number(limit) < all.length ? Number(offset) + Number(limit) : null, warnings };
  }
  async registerModel(input: { provider?: unknown; modelId?: unknown; label?: unknown; modality?: unknown; mode?: unknown; defaults?: unknown }) {
    providerId(input.provider); validModelId(input.modelId); modality(input.modality);
    if (input.provider === 'codex') throw new Error('Codex exposes its built-in image model only');
    if (typeof input.label !== 'string' || !input.label.trim() || input.label.length > 180) throw new Error('A model label is required');
    if (typeof input.mode !== 'string' || !/^[a-z-]{3,60}$/.test(input.mode)) throw new Error('A generation mode is required');
    const model: Model = { id: modelKey(input.provider, input.modelId), provider: input.provider, modelId: input.modelId, label: input.label.trim(),
      modality: input.modality, mode: input.mode, source: 'custom', defaults: parameters(input.defaults) };
    await this.connections.saveMediaModel(model);
    return { model };
  }
  async setRoute(kind: unknown, modelId: unknown) {
    modality(kind);
    if (modelId !== null && !(await this.models()).some(m => m.id === modelId && m.modality === kind)) throw new Error('Route must select a model of the same modality');
    await this.connections.setDefault(kind, modelId as string | null);
    return this.status();
  }
  async status(refreshAgents = false, options: { refreshAccount?: boolean } = {}): Promise<GatewayStatus> {
    const accountSummary = this.account.summary(options.refreshAccount === true);
    const [config, agents, models, account] = await Promise.all([
      this.config(), this.agents(refreshAgents),
      // A billing refresh can sync newly entitled models before we calculate media capabilities.
      options.refreshAccount ? accountSummary.then(() => this.models()) : this.models(),
      accountSummary,
    ]);
    const providers: ProviderState[] = await Promise.all(providerIds.map(async id => {
      const saved = config.providers[id] ?? {};
      const enabled = saved.enabled !== false;
      if (id === 'codex') {
        const agent = agents.find(a => a.id === id);
        return { id, label: providerLabels[id], enabled, configured: !!agent?.authenticated, available: enabled && !!agent?.available,
          credentialSource: 'local-agent', verification: 'unverified', reason: !enabled ? 'Disabled' : agent?.reason ?? 'Not detected' };
      }
      const credentials = await this.credential(id);
      const definition = registeredProvider(id)!;
      const baseUrl = definition.baseUrlEditable ? await this.connections.baseUrl(id) : undefined;
      const active = !!credentials.key;
      const verification = credentials.key && saved.keyHash === hash(credentials.key) ? saved.verification ?? 'unverified' : 'unverified';
      return { id, label: providerLabels[id], enabled: active && enabled, configured: !!credentials.key, available: active && enabled && (!definition.baseUrlEditable || !!baseUrl) && verification !== 'rejected',
        ...(definition.baseUrlEditable ? { baseUrl: baseUrl ?? '' } : {}),
        credentialSource: credentials.source, verification, checkedAt: saved.checkedAt,
        reason: !active ? 'API key required' : !enabled ? 'Disabled' : definition.baseUrlEditable && !baseUrl ? `${definition.label} API origin required` : verification === 'rejected' ? 'Credentials or permissions rejected; update the key' : verification === 'verified' ? 'A generation request succeeded with this key' : 'Configured; availability and quota are checked when generating' };
    }));
    providers.push(...await this.connections.states());
    const accountMedia = accountMediaState(account);
    providers.push({ id: 'account', label: registeredProvider('account')!.label, enabled: account.state === 'signed-in', configured: account.state === 'signed-in', available: account.state === 'signed-in', credentialSource: 'account', verification: 'unverified', ...accountMedia });
    const mediaProviders = new Set(providers.filter(p => p.available && !(p.id === 'account' && accountMedia.mediaEntitlement === 'not-included')).map(p => p.id));
    const capabilities = modalities.map(kind => {
      const available = models.filter(model => model.modality === kind && mediaProviders.has(model.provider));
      const selected = config.routes[kind] ? available.find(m => m.id === config.routes[kind]) : available.find(m => m.mode.startsWith('text-to-'));
      return { modality: kind, available: available.length > 0, modelIds: available.map(m => m.id), selectedModelId: selected?.id };
    });
    return { providers, agents, routes: config.routes, capabilities };
  }
  async getJob(id: unknown) {
    if (!uuid(id)) throw new Error('Invalid generation job ID');
    const job = await readJson<GenerationJob | null>(path.join(this.root, 'jobs', id + '.json'), null);
    if (!job) throw new Error('Generation job not found');
    // Jobs preserve their original output paths. Studio can subsequently rename/delete files.
    for (const asset of job.assets) {
      const target = job.library ? await this.store.safePath(asset.path, new AssetLibrary(this.store).root)
        : await this.store.safePath(asset.path, this.store.projectDirectoryFor(job.projectId!));
      asset.available = await lstat(target).then(info => info.isFile() && !info.isSymbolicLink(), () => false);
    }
    return job;
  }
  async listJobs(projectId?: string) {
    const names = await readdir(path.join(this.root, 'jobs')).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return []; throw error; });
    const jobs = await Promise.all(names.filter(name => uuid(name.slice(0, -5)) && name.endsWith('.json')).map(name => this.getJob(name.slice(0, -5))));
    return jobs.filter(job => !projectId || job.projectId === projectId).sort((a, b) => b.createdAt - a.createdAt);
  }
  private saveJob(job: GenerationJob) { return atomic(path.join(this.root, 'jobs', job.id + '.json'), job); }
  private async saveResult(job: GenerationJob, details: ResultTelemetry = {}) {
    if (job.state === 'queued' || job.state === 'running') throw new Error('Expected a terminal generation job');
    const attemptStart = job.startedAt ?? job.attemptCreatedAt ?? job.createdAt;
    const durationMs = clampMs(job.updatedAt - attemptStart);
    const queueWaitMs = job.startedAt !== undefined
      ? clampMs(job.startedAt - (job.attemptCreatedAt ?? job.createdAt)) : undefined;
    const endToEndMs = clampMs(job.updatedAt - job.createdAt);
    const failurePhase: MediaGenerationFailurePhase | undefined = job.state === 'completed'
      ? undefined
      : details.failurePhase
        ?? (job.state === 'cancelled' ? 'cancelled'
          : job.phase === 'interrupted' ? 'interrupted'
            : job.phase === 'save_unavailable' ? 'save_unavailable'
              : job.phase === 'save_failed' ? 'saving'
                : 'submitting');
    const cause = details.cause ?? job.error;
    const baseFields = generationTrackingFields(job);
    const { errorCode } = resolveResultErrorFields({
      jobState: job.state,
      cause,
      failurePhase,
      fallbackPhase: job.phase,
      providerKind: baseFields.provider_kind,
      routeChannel: baseFields.route_channel,
    });
    const previousErrorCode = details.previousErrorCode ?? (job.attemptKind && job.attemptKind !== 'initial' ? job.lastErrorCode : undefined);
    const previousFailurePhase = details.previousFailurePhase ?? (job.attemptKind && job.attemptKind !== 'initial' ? job.lastFailurePhase : undefined);
    if (errorCode) job.lastErrorCode = errorCode;
    if (failurePhase) job.lastFailurePhase = failurePhase;
    if (job.state === 'failed' && errorCode) job.errorCode = errorCode;
    else delete job.errorCode;
    await this.saveJob(job);
    const totalOutputBytes = details.totalOutputBytes !== undefined
      ? details.totalOutputBytes
      : job.state === 'completed' && job.assets.length
        ? job.assets.reduce((sum, asset) => sum + Math.max(0, Math.round(asset.bytes || 0)), 0)
        : undefined;
    recordMediaGenerationResult(this.options.tracking, {
      modality: job.modality,
      executorKind: 'gateway',
      providerKind: baseFields.provider_kind,
      routeChannel: baseFields.route_channel,
      modelProvider: baseFields.model_provider,
      modelId: baseFields.model_id,
      capabilityId: baseFields.capability_id,
      entrySurface: baseFields.entry_surface,
      destination: baseFields.destination,
      generationMode: baseFields.generation_mode,
      audioKind: baseFields.audio_kind,
      referenceCount: baseFields.reference_count,
      isEdit: baseFields.is_edit,
      accountPlan: baseFields.account_plan,
      parameters: job.parameters,
      jobId: job.id,
      requestId: job.telemetryRequestId,
      attemptId: job.attemptId,
      attemptNumber: job.attemptCount,
      attemptKind: job.attemptKind ?? 'initial',
      jobState: job.state,
      assetCount: Math.max(job.assets.length, job.libraryAssets?.length ?? 0),
      durationMs,
      queueWaitMs,
      endToEndMs,
      uploadMs: details.uploadMs,
      remoteMs: details.remoteMs,
      downloadMs: details.downloadMs,
      saveMs: details.saveMs,
      cancelWaitMs: details.cancelWaitMs,
      reconnectedCount: details.reconnectedCount,
      remoteTerminal: typeof job.remoteTerminal === 'boolean' ? job.remoteTerminal : undefined,
      hasRemoteId: Boolean(job.remoteId),
      isResumable: job.state === 'failed' ? resumableJob(job) : undefined,
      savePending: job.state !== 'completed' ? Boolean(job.savePending) : undefined,
      totalOutputBytes,
      failurePhase,
      phaseBeforeCancel: details.phaseBeforeCancel,
      lastActivePhase: details.lastActivePhase,
      cancelSource: details.cancelSource,
      cause,
      previousErrorCode,
      previousFailurePhase,
    }, jobTrackingHost(job));
  }
  async submit(input: GenerateInput, host?: HostContext, meta?: SubmitTrackingOptions): Promise<GenerationJob> {
    if (!input || typeof input !== 'object') throw new Error('Generation input required');
    modality(input.modality);
    const validHost = normalizeTrackingHost(host);
    const requestedCap = safeCapabilityId(input.capabilityId ?? input.library?.capabilityId);
    const requestId = randomUUID();
    const entrySurface: MediaGenerationEntrySurface = meta?.entrySurface ?? 'unknown';
    const destination: MediaGenerationDestination = input.library ? 'library' : 'project';
    const { referenceCount: rawRefCount, isEdit } = extractRequestReferenceMeta(input);
    const hasIdempotencyKey = typeof input.idempotencyKey === 'string' && input.idempotencyKey.length > 0;
    const requestedMode = typeof input.mode === 'string' && (mediaGenerationModes as readonly string[]).includes(input.mode)
      ? input.mode as MediaGenerationMode : undefined;
    recordMediaGenerationRequested(this.options.tracking, {
      modality: input.modality,
      requestId,
      executorKind: 'gateway',
      capabilityId: requestedCap,
      entrySurface,
      destination,
      generationMode: requestedMode,
      referenceCount: rawRefCount,
      isEdit,
      hasIdempotencyKey,
    }, validHost);
    let resolvedModel: Model | undefined;
    let resolvedAccountPlan: MediaGenerationAccountPlan | undefined;
    let rejection: { reason: MediaGenerationRejectionReason; category: MediaGenerationRejectionCategory } | undefined;
    const failSubmit = (reason: MediaGenerationRejectionReason, category: MediaGenerationRejectionCategory, message: string): never => {
      rejection = { reason, category };
      throw new Error(message);
    };
    try {
      if (typeof input.prompt !== 'string' || !input.prompt.trim() || input.prompt.length > 20_000) failSubmit('INVALID_PROMPT', 'client_validation', 'Prompt must contain 1–20000 characters');
      let params: Record<string, unknown>;
      try { params = parameters(input.parameters); } catch (error) { rejection = { reason: 'INVALID_PARAMETERS', category: 'client_validation' }; throw error; }
      if (input.library && input.projectId) failSubmit('INVALID_DESTINATION', 'client_validation', 'Choose either an asset library or a project destination');
      const library = new AssetLibrary(this.store);
      if (input.library?.references !== undefined && !Array.isArray(input.library.references)) failSubmit('REFERENCE_UNREADABLE', 'reference_invalid', 'Asset references must be an array');
      if (input.referenceAsset !== undefined && (typeof input.referenceAsset !== 'string' || !input.referenceAsset || input.referenceAsset.length > 1024)) failSubmit('REFERENCE_UNREADABLE', 'reference_invalid', 'Invalid reference image path');
      if (input.idempotencyKey !== undefined && (typeof input.idempotencyKey !== 'string' || !/^[\w-]{1,100}$/.test(input.idempotencyKey))) failSubmit('INVALID_IDEMPOTENCY_KEY', 'client_validation', 'Invalid idempotency key');
      if (input.usage && (typeof input.usage !== 'object' || Object.entries(input.usage).some(([key, value]) => !['compositionId', 'elementId', 'property'].includes(key) || typeof value !== 'string' || value.length > 240))) failSubmit('INVALID_USAGE', 'client_validation', 'Invalid editor usage context');
      const cloudIdentity = await this.store.lock(async () => (await this.cloudContext()).identity);
      const status = await this.status();
      const accountProvider = status.providers.find(p => p.id === 'account');
      resolvedAccountPlan = normalizeAccountPlan(accountProvider?.plan);
      const selected = input.model ?? status.routes[input.modality] ?? status.capabilities.find(c => c.modality === input.modality)?.selectedModelId;
      let model = (await this.models()).find(m => m.id === selected && m.modality === input.modality);
      if (!model && typeof selected === 'string') {
        const colon = selected.indexOf(':'), provider = mediaProviders.find(id => id === selected.slice(0, colon)), modelId = selected.slice(colon + 1);
        if (provider) {
          try { validModelId(modelId); } catch (error) { rejection = { reason: 'MODEL_UNAVAILABLE', category: 'client_validation' }; throw error; }
          model = { id: selected, provider, modelId, label: modelId, modality: input.modality, mode: input.mode ?? `text-to-${input.modality}`, source: 'custom' };
        }
      }
      resolvedModel = model;
      if (input.mode !== undefined && !['text-to-image', 'text-to-video', 'text-to-audio', 'text-to-speech'].includes(input.mode)) failSubmit('INVALID_MODE', 'client_validation', 'Unsupported generation mode');
      if (input.mode && input.mode !== `text-to-${input.modality}` && !(input.modality === 'audio' && input.mode === 'text-to-speech')) failSubmit('INVALID_MODE', 'client_validation', 'Generation mode does not match modality');
      // Account and Cloud catalogues select distinct operations for speech and other audio.
      if (model && ['account', 'opendesign'].includes(model.provider) && input.mode && input.mode !== model.mode) failSubmit('INVALID_MODE', 'client_validation', `Generation mode does not match the selected ${model.provider === 'account' ? 'account' : 'Cloud'} model`);
      if (model && input.mode) { model = { ...model, mode: input.mode }; resolvedModel = model; }
      const projectId = input.library ? undefined : input.projectId ?? this.store.projectCatalog().activeId;
      const requestHash = hash(JSON.stringify({ projectId, library: input.library, model: input.model ?? null, modality: input.modality, prompt: input.prompt, parameters: params, mode: input.mode, usage: input.usage, ...(input.referenceAsset ? { referenceAsset: input.referenceAsset } : {}) }));
      return await this.store.lock(async () => {
        if (!input.library) {
          if (!this.store.projectCatalog().projects.some(p => p.id === projectId)) failSubmit('PROJECT_NOT_FOUND', 'project_missing', 'Project not found');
          const entry = await this.store.safePath('index.html', this.store.projectDirectoryFor(projectId!));
          await lstat(entry).catch(() => { failSubmit('PROJECT_NOT_OPEN', 'project_missing', 'Open a project before generating media'); });
        }
        const jobs = await this.listJobs();
        const previous = input.idempotencyKey ? jobs.find(j => j.idempotencyKey === input.idempotencyKey && j.projectId === projectId) : undefined;
        if (previous) {
          if (previous.requestHash !== requestHash) failSubmit('IDEMPOTENCY_CONFLICT', 'client_validation', 'Idempotency key was already used for another request');
          const prevFields = generationTrackingFields(previous);
          recordMediaGenerationReplayed(this.options.tracking, {
            modality: previous.modality,
            executorKind: 'gateway',
            providerKind: prevFields.provider_kind,
            routeChannel: prevFields.route_channel,
            modelProvider: prevFields.model_provider,
            modelId: prevFields.model_id,
            capabilityId: prevFields.capability_id,
            // Attribute the replay to the calling surface and host so per-surface funnels conserve requested = submitted + rejected + replayed.
            entrySurface,
            destination: prevFields.destination,
            generationMode: prevFields.generation_mode,
            audioKind: prevFields.audio_kind,
            referenceCount: prevFields.reference_count,
            isEdit: prevFields.is_edit,
            accountPlan: prevFields.account_plan,
            parameters: previous.parameters,
            requestId,
            jobId: previous.id,
            existingJobState: previous.state,
          }, validHost);
          return previous;
        }
        const providerState = model ? status.providers.find(p => p.id === model.provider) : undefined;
        if (!model || !providerState?.available) {
          const explicitAccountModel = typeof input.model === 'string' && input.model.startsWith('account:');
          const explicitOtherProvider = typeof input.model === 'string' && input.model.includes(':') && !explicitAccountModel
            ? input.model.slice(0, input.model.indexOf(':')) : undefined;
          const explicitOtherState = explicitOtherProvider ? status.providers.find(p => p.id === explicitOtherProvider) : undefined;
          const targetedAccount = model?.provider === 'account' || explicitAccountModel || (input.model === undefined && !model);
          if (targetedAccount && accountProvider) {
            if (accountProvider.mediaEntitlement === 'not-included') failSubmit('ACCOUNT_NOT_ENTITLED', 'commercial_gate', 'Selected model is unavailable; configure an available provider or choose a different model');
            if (!accountProvider.configured) failSubmit('ACCOUNT_SIGNED_OUT', 'commercial_gate', 'Selected model is unavailable; configure an available provider or choose a different model');
          }
          const effectiveState = providerState ?? explicitOtherState;
          if (effectiveState?.verification === 'rejected') failSubmit('KEY_REJECTED', 'auth_credential', 'Selected model is unavailable; configure an available provider or choose a different model');
          if (effectiveState && !effectiveState.configured) failSubmit('PROVIDER_NOT_CONFIGURED', 'provider_unavailable', 'Selected model is unavailable; configure an available provider or choose a different model');
          failSubmit('MODEL_UNAVAILABLE', 'provider_unavailable', 'Selected model is unavailable; configure an available provider or choose a different model');
        }
        if (model.provider === 'opendesign' && (await this.cloudContext()).identity !== cloudIdentity) failSubmit('CONFIG_CHANGED', 'config_changed', 'Cloud configuration changed; reload models before generating');
        const referenceCount = (input.library?.references?.length ?? 0) + (input.referenceAsset ? 1 : 0);
        let resolvedParameters: Record<string, unknown>;
        try {
          resolvedParameters = resolveGenerationParameters(model, params, referenceCount > 0);
          validateGenerationOptions(model, resolvedParameters, referenceCount > 0, model.generationOptions);
        } catch (error) { rejection = { reason: 'OPTIONS_INVALID', category: 'client_validation' }; throw error; }
        // Video sends only a first frame; the project-direct referenceAsset route stays image-only as before.
        const referenceLimit = input.referenceAsset && input.modality !== 'image' ? 0 : modelReferenceLimit(model);
        if (referenceCount && model.provider === 'opendesign' && model.modality === 'image' && model.supportsImageReference === undefined) failSubmit('REFERENCE_UNSUPPORTED', 'reference_invalid', 'Image editing capability is unknown. Sync Cloud models before using references.');
        if (referenceCount && !referenceLimit) failSubmit('REFERENCE_UNSUPPORTED', 'reference_invalid', input.modality === 'video' ? 'This video model does not accept an input image. Choose a video model with maxInputImages, or remove the reference.'
          : input.referenceAsset ? 'Selected model does not support reference image editing' : 'This model does not support asset references. Choose an image model that supports editing, or remove the reference.');
        if (referenceCount > referenceLimit) failSubmit('REFERENCE_LIMIT_EXCEEDED', 'reference_invalid', `This model accepts at most ${referenceLimit} input image${referenceLimit === 1 ? '' : 's'}`);
        if (referenceCount && input.referenceAsset && input.library) failSubmit('REFERENCE_CONFLICT', 'reference_invalid', 'Choose library references or a project referenceAsset');
        if (model.provider === 'opendesign' && referenceCount && resolvedParameters.images !== undefined) failSubmit('REFERENCE_CONFLICT', 'reference_invalid', 'Choose pinned references or parameters.images for Cloud input');
        if (input.library) {
          try { await library.validateGeneration(input.library); }
          catch (error) { rejection = { reason: 'LIBRARY_INVALID', category: 'client_validation' }; throw error; }
        }
        if (input.library?.assetId) {
          let existingAsset: Awaited<ReturnType<AssetLibrary['get']>>;
          try { existingAsset = await library.get(input.library.assetId); }
          catch (error) { rejection = { reason: 'LIBRARY_INVALID', category: 'client_validation' }; throw error; }
          if (existingAsset.modality !== input.modality) failSubmit('LIBRARY_INVALID', 'client_validation', 'Asset versions must have the same media type');
        }
        const activeQueueDepth = jobs.filter(j => j.state === 'queued' || j.state === 'running').length;
        if (activeQueueDepth >= 20) failSubmit('QUEUE_FULL', 'queue_full', 'Generation queue is full (20 jobs)');
        const storedParameters = model.mode === 'text-to-speech' && typeof resolvedParameters.voice === 'string' && !params.voice
          ? { ...params, voice: resolvedParameters.voice }
          : params;
        const attemptId = randomUUID();
        const now = Date.now();
        const job: GenerationJob = { id: randomUUID(), saveToLibrary: true, ...(input.library ? { library: { ...input.library, createNew: !input.library.assetId, assetId: input.library.assetId ?? randomUUID() } } : { projectId }), state: 'queued', modality: input.modality, prompt: input.prompt.trim(), model,
          ...(model.provider === 'account' ? { providerOrigin: await this.account.identity() } : model.provider === 'opendesign' ? { providerOrigin: await this.cloudOrigin() }
            : !isGatewayProvider(model.provider) ? { providerOrigin: await this.connections.baseUrl(model.provider) } : {}),
          ...(!isGatewayProvider(model.provider) && model.provider !== 'account' ? { providerRevision: await this.connections.identity(model.provider) } : {}),
          parameters: storedParameters,
          ...(input.capabilityId ?? input.library?.capabilityId ? { capabilityId: input.capabilityId ?? input.library?.capabilityId } : {}),
          ...(input.capabilityOptions ?? input.library?.capabilityOptions ? { capabilityOptions: input.capabilityOptions ?? input.library?.capabilityOptions } : {}),
          usage: input.usage, idempotencyKey: input.idempotencyKey, requestHash,
          createdAt: now, updatedAt: now, attemptCreatedAt: now, phase: 'queued', assets: [],
          attemptKind: 'initial', telemetryRequestId: requestId, attemptId, attemptCount: 1, entrySurface,
          ...(model.provider === 'account' && resolvedAccountPlan ? { accountPlan: resolvedAccountPlan } : {}),
          ...(validHost ? { trackingHost: validHost } : {}) };
        const work = path.join(this.root, 'work', job.id);
        try {
          const sources: { asset?: { assetId: string; versionId: string }; projectPath?: string }[] = input.referenceAsset ? [{ projectPath: input.referenceAsset }]
            : (input.library?.references ?? []).map(asset => ({ asset }));
          // TODO(OPEND-5839): interim hardcoded 2 MiB OpenDesign reference upload cap until expand=schema publishes per-model media limits.
          const openDesignUpload = ['account', 'opendesign'].includes(model.provider);
          const maxReferenceBytes = openDesignUpload ? 2 * 1024 * 1024 : 20 * 1024 * 1024;
          for (const [index, item] of sources.entries()) {
            let reference: Awaited<ReturnType<AssetLibrary['resolve']>> | undefined;
            let source: string;
            let info: Awaited<ReturnType<typeof lstat>>;
            try {
              reference = item.asset ? await library.resolve(item.asset) : undefined;
              source = reference?.filename ?? await this.store.safePath(item.projectPath!, this.store.projectDirectoryFor(projectId!));
              info = await lstat(source);
            } catch (error) {
              rejection = { reason: 'REFERENCE_UNREADABLE', category: 'reference_invalid' };
              throw error;
            }
            if (!info.isFile() || info.isSymbolicLink()) failSubmit('REFERENCE_UNREADABLE', 'reference_invalid', 'Reference image must be a local file under 20 MB');
            if (info.size > maxReferenceBytes) failSubmit('REFERENCE_TOO_LARGE', 'reference_invalid', openDesignUpload ? 'The reference image is larger than the 2 MiB OpenDesign upload limit.' : 'Reference image must be a local file under 20 MB');
            const bytes = await readFile(source);
            let media: ReturnType<typeof mediaType>;
            try { media = mediaType(bytes, 'image'); } catch (error) { rejection = { reason: 'REFERENCE_INVALID_FORMAT', category: 'reference_invalid' }; throw error; }
            if (bytes.length > maxReferenceBytes) failSubmit('REFERENCE_TOO_LARGE', 'reference_invalid', openDesignUpload ? 'The reference image is larger than the 2 MiB OpenDesign upload limit.' : 'Reference image exceeds 20 MB');
            if (!['png', 'jpg', 'webp'].includes(media.extension)) failSubmit('REFERENCE_INVALID_FORMAT', 'reference_invalid', 'Use a PNG, JPEG or WebP reference image');
            if (['opendesign', 'account'].includes(model.provider) && bytes.length > 2 * 1024 * 1024) failSubmit('REFERENCE_TOO_LARGE', 'reference_invalid', 'The reference image is larger than the 2 MiB OpenDesign upload limit.');
            if (reference && hash(bytes) !== reference.version.sha256) failSubmit('REFERENCE_UNREADABLE', 'reference_invalid', 'Reference asset bytes have changed');
            const snapshot = { path: item.projectPath ?? `asset:${item.asset!.assetId}/${item.asset!.versionId}`, sha256: hash(bytes), mimeType: media.mimeType, bytes: bytes.length };
            (job.references ??= []).push(snapshot); job.reference ??= snapshot;
            await mkdir(work, { recursive: true, mode: 0o700 });
            await writeFile(path.join(work, referenceFile(index, media.mimeType)), bytes, { flag: 'wx', mode: 0o600 });
          }
          await this.saveJob(job);
          const subFields = generationTrackingFields(job);
          recordMediaGenerationSubmitted(this.options.tracking, {
            modality: job.modality,
            executorKind: 'gateway',
            providerKind: subFields.provider_kind,
            routeChannel: subFields.route_channel,
            modelProvider: subFields.model_provider,
            modelId: subFields.model_id,
            capabilityId: subFields.capability_id,
            entrySurface: subFields.entry_surface,
            destination: subFields.destination,
            generationMode: subFields.generation_mode,
            audioKind: subFields.audio_kind,
            referenceCount: subFields.reference_count,
            isEdit: subFields.is_edit,
            accountPlan: subFields.account_plan,
            parameters: job.parameters,
            requestId,
            jobId: job.id,
            attemptId,
            attemptNumber: 1,
            attemptKind: 'initial',
            hasIdempotencyKey,
            queueDepth: activeQueueDepth,
          }, jobTrackingHost(job));
          return job;
        } catch (error) { await rm(work, { recursive: true, force: true }); throw error; }
      });
    } catch (error) {
      const reason: MediaGenerationRejectionReason = rejection?.reason ?? 'PREFLIGHT_FAILED';
      const category: MediaGenerationRejectionCategory = rejection?.category ?? 'other';
      const modelMeta = resolvedModel ? providerTrackingMeta(resolvedModel) : undefined;
      recordMediaGenerationRejected(this.options.tracking, {
        modality: input.modality,
        executorKind: 'gateway',
        requestId,
        hasIdempotencyKey,
        reason,
        category,
        entrySurface,
        destination,
        capabilityId: requestedCap,
        providerKind: modelMeta?.provider_kind,
        routeChannel: modelMeta?.route_channel,
        modelProvider: modelMeta?.model_provider,
        modelId: modelMeta?.model_id,
        generationMode: modelMeta?.generation_mode ?? requestedMode,
        audioKind: modelMeta?.audio_kind,
        referenceCount: rawRefCount,
        isEdit,
        accountPlan: resolvedModel?.provider === 'account' ? resolvedAccountPlan : undefined,
        parameters: input.parameters && typeof input.parameters === 'object' && !Array.isArray(input.parameters)
          ? input.parameters as Record<string, unknown> : undefined,
      }, validHost);
      throw error;
    }
  }
  recordRetryRejection(job: GenerationJob, attemptKind: 'resume' | 'retry_save', error: unknown) {
    const fields = generationTrackingFields(job);
    const { reason, category } = classifyRejectionError(error);
    recordMediaGenerationRetryRejected(this.options.tracking, {
      modality: job.modality,
      executorKind: 'gateway',
      providerKind: fields.provider_kind,
      routeChannel: fields.route_channel,
      modelProvider: fields.model_provider,
      modelId: fields.model_id,
      capabilityId: fields.capability_id,
      entrySurface: fields.entry_surface,
      destination: fields.destination,
      generationMode: fields.generation_mode,
      audioKind: fields.audio_kind,
      referenceCount: fields.reference_count,
      isEdit: fields.is_edit,
      accountPlan: fields.account_plan,
      parameters: job.parameters,
      jobId: job.id,
      requestId: job.telemetryRequestId,
      attemptKind,
      reason,
      category,
    }, jobTrackingHost(job));
  }
  async resume(id: unknown, requestId: unknown) {
    if (typeof requestId !== 'string' || !/^[\w-]{1,100}$/.test(requestId)) {
      const err = new Error('A stable requestId is required');
      const job = await this.getJob(id).catch(() => undefined);
      if (job) this.recordRetryRejection(job, 'resume', err);
      throw err;
    }
    return this.store.lock(async () => {
      const job = await this.getJob(id);
      try {
        if (!(job.model.provider === 'opendesign' || accountResumableMedia(job)) || !job.remoteId || !/^[a-zA-Z0-9_-]{1,180}$/.test(job.remoteId)) throw new Error('Only an existing Cloud or account media task can be resumed');
        if (['queued', 'running', 'completed'].includes(job.state)) return job;
        if (!resumableJob(job)) throw new Error(job.savePending ? 'Use retry_save for retained local outputs' : 'This task cannot be resumed');
        if (job.projectId && !this.store.projectCatalog().projects.some(project => project.id === job.projectId)) throw new Error('Project not found');
        if (job.model.provider === 'account') {
          if (job.providerOrigin !== await this.account.identity()) throw new Error('Account changed; the original task was not resumed');
        } else if (job.providerOrigin !== await this.cloudOrigin()) throw new Error('Provider API origin changed; the original task was not resumed');
        if (job.model.provider === 'opendesign' && !(await this.credential('opendesign')).key || !(await this.status()).providers.find(provider => provider.id === job.model.provider)?.available) throw new Error('Provider is no longer available');
        if ((await this.listJobs()).filter(item => ['queued', 'running'].includes(item.state)).length >= 20) throw new Error('Generation queue is full (20 jobs)');
      } catch (error) {
        this.recordRetryRejection(job, 'resume', error);
        throw error;
      }
      const now = Date.now();
      job.state = 'queued'; job.phase = 'resuming'; job.attemptKind = 'resume';
      job.attemptCount = (job.attemptCount ?? 1) + 1; job.attemptId = randomUUID(); job.attemptCreatedAt = now;
      delete job.startedAt; delete job.workerPid;
      job.updatedAt = now; delete job.error; delete job.errorCode;
      await this.saveJob(job);
      const retryFields = generationTrackingFields(job);
      recordMediaGenerationRetryStarted(this.options.tracking, {
        modality: job.modality,
        executorKind: 'gateway',
        providerKind: retryFields.provider_kind,
        routeChannel: retryFields.route_channel,
        modelProvider: retryFields.model_provider,
        modelId: retryFields.model_id,
        capabilityId: retryFields.capability_id,
        entrySurface: retryFields.entry_surface,
        destination: retryFields.destination,
        generationMode: retryFields.generation_mode,
        audioKind: retryFields.audio_kind,
        referenceCount: retryFields.reference_count,
        isEdit: retryFields.is_edit,
        accountPlan: retryFields.account_plan,
        parameters: job.parameters,
        jobId: job.id,
        requestId: job.telemetryRequestId,
        attemptId: job.attemptId,
        attemptNumber: job.attemptCount,
        attemptKind: 'resume',
        previousErrorCode: job.lastErrorCode,
        previousFailurePhase: job.lastFailurePhase,
      }, jobTrackingHost(job));
      return job;
    });
  }
  async cancel(id: unknown, options?: CancelTrackingOptions) {
    const job = await this.store.lock(async () => {
      const job = await this.getJob(id);
      // A queued recovery has no worker for this attempt; its PID may belong to a prior attempt.
      if (job.state === 'queued') delete job.workerPid;
      if (job.state === 'queued' || job.state === 'running') {
        const phaseBeforeCancel = normalizeCancelPhase(job.phase);
        const liveTimings = job.state === 'running' ? this.active.get(job.id)?.snapshotTimings?.() : undefined;
        const now = Date.now();
        job.state = 'cancelled'; job.phase = 'cancelled'; job.updatedAt = now;
        await this.saveResult(job, {
          ...liveTimings,
          failurePhase: 'cancelled',
          phaseBeforeCancel,
          lastActivePhase: phaseBeforeCancel,
          cancelSource: options?.source ?? 'unknown',
          cancelWaitMs: clampMs(now - (job.attemptCreatedAt ?? job.createdAt)),
        });
      }
      return job;
    });
    const worker = this.active.get(job.id);
    worker?.controller.abort();
    if (job.state === 'cancelled' && !job.savePending && !worker && !alive(job.workerPid)) await rm(path.join(this.root, 'work', job.id), { recursive: true, force: true });
    return job;
  }
  private async savedOutputs(job: GenerationJob): Promise<SavedOutput[]> {
    try {
      const files = JSON.parse(await readFile(path.join(this.root, 'work', job.id, 'outputs.json'), 'utf8'));
      if (!Array.isArray(files) || !files.length || files.some((file, index) => !file
        || !new RegExp(`^assets/generated/${job.id}-${index + 1}\\.[a-z0-9]+$`).test(file.path)
        || !/^[a-f0-9]{64}$/.test(file.sha256) || !Number.isSafeInteger(file.bytes) || file.bytes <= 0 || file.bytes > MAX_ASSET_BYTES
        || typeof file.mimeType !== 'string' || !file.mimeType.startsWith(job.modality + '/'))) throw new Error(saveUnavailable);
      return files;
    } catch (error) {
      if (error instanceof SyntaxError || ['ENOENT', 'ENOTDIR', 'ELOOP'].includes((error as NodeJS.ErrnoException).code!)) throw new Error(saveUnavailable);
      throw error;
    }
  }
  private async prepareOutput(library: AssetLibrary, file: SavedOutput, dir: string) {
    let snapshot: Awaited<ReturnType<AssetLibrary['prepare']>> | undefined;
    const source = path.join(dir, path.basename(file.path));
    try {
      snapshot = await library.prepare(await this.store.safePath(path.basename(file.path), dir));
      if (snapshot.sha256 !== file.sha256 || snapshot.bytes !== file.bytes || snapshot.media.mimeType !== file.mimeType) throw new Error(saveUnavailable);
      return snapshot;
    } catch (error) {
      if (snapshot) await rm(snapshot.file, { force: true });
      if (['ENOENT', 'ENOTDIR', 'ELOOP'].includes((error as NodeJS.ErrnoException).code!) && (error as NodeJS.ErrnoException & { path?: string }).path === source
        || error instanceof Error && /not readable|could not be decoded|Unsupported media type|Asset must be a file|符号链接/.test(error.message)) throw new Error(saveUnavailable);
      throw error;
    }
  }
  async retrySave(id: unknown) {
    const original = await this.getJob(id);
    if (['completed', 'queued', 'running'].includes(original.state)) return original;
    try {
      const library = new AssetLibrary(this.store);
      for (const file of await this.savedOutputs(original)) {
        const snapshot = await this.prepareOutput(library, file, path.join(this.root, 'work', original.id));
        await rm(snapshot.file, { force: true });
      }
    } catch (error) {
      if (!(error instanceof Error) || !error.message.startsWith('SAVE_NOT_AVAILABLE:')) {
        this.recordRetryRejection(original, 'retry_save', error);
        throw error;
      }
      return this.store.lock(async () => {
        const job = await this.getJob(id);
        if (['completed', 'queued', 'running'].includes(job.state)) return job;
        // Cancellation is final for this route: report that nothing was saved, but keep the job cancelled.
        if (job.state === 'cancelled') {
          this.recordRetryRejection(job, 'retry_save', error);
          throw error;
        }
        const alreadyFailed = job.state === 'failed';
        // Keep Cloud-terminal provenance before the error text is replaced.
        if (legacyRemoteTerminal(job)) job.remoteTerminal = true;
        job.state = 'failed'; job.phase = 'save_unavailable'; job.savePending = false; job.error = error.message; job.updatedAt = Date.now();
        if (alreadyFailed) {
          await this.saveJob(job);
          this.recordRetryRejection(job, 'retry_save', error);
        } else {
          await this.saveResult(job, { cause: error, failurePhase: 'save_unavailable' });
        }
        throw error;
      });
    }
    return this.store.lock(async () => {
      const job = await this.getJob(id);
      if (['completed', 'queued', 'running'].includes(job.state)) return job;
      const now = Date.now();
      job.savePending = true; job.state = 'queued'; job.phase = 'saving'; job.attemptKind = 'retry_save';
      job.attemptCount = (job.attemptCount ?? 1) + 1; job.attemptId = randomUUID(); job.attemptCreatedAt = now;
      delete job.startedAt; delete job.workerPid;
      job.updatedAt = now; delete job.error; delete job.errorCode;
      await this.saveJob(job);
      const retryFields = generationTrackingFields(job);
      recordMediaGenerationRetryStarted(this.options.tracking, {
        modality: job.modality,
        executorKind: 'gateway',
        providerKind: retryFields.provider_kind,
        routeChannel: retryFields.route_channel,
        modelProvider: retryFields.model_provider,
        modelId: retryFields.model_id,
        capabilityId: retryFields.capability_id,
        entrySurface: retryFields.entry_surface,
        destination: retryFields.destination,
        generationMode: retryFields.generation_mode,
        audioKind: retryFields.audio_kind,
        referenceCount: retryFields.reference_count,
        isEdit: retryFields.is_edit,
        accountPlan: retryFields.account_plan,
        parameters: job.parameters,
        jobId: job.id,
        requestId: job.telemetryRequestId,
        attemptId: job.attemptId,
        attemptNumber: job.attemptCount,
        attemptKind: 'retry_save',
        previousErrorCode: job.lastErrorCode,
        previousFailurePhase: job.lastFailurePhase,
      }, jobTrackingHost(job));
      return job;
    });
  }
  async tick() {
    if (this.ticking || this.closed) return;
    this.ticking = true;
    try {
      if (!(await this.listJobs()).some(job => job.state === 'queued' || job.state === 'running' && !alive(job.workerPid))) return;
      const claimed = await this.store.lock(async () => {
        const jobs = await this.listJobs();
        for (const job of jobs.filter(j => j.state === 'running' && !alive(j.workerPid))) {
          const lastActivePhase = normalizeCancelPhase(job.phase);
          job.savePending = !!job.savePending || await lstat(path.join(this.root, 'work', job.id, 'outputs.json')).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; });
          job.state = 'failed'; job.phase = job.savePending ? 'save_failed' : 'interrupted'; job.error = job.savePending ? 'Saving was interrupted. Local outputs are retained; retry_save saves them without another model request.' : 'Worker stopped; request was not automatically resubmitted. Check provider history before retrying.'; if (resumableJob(job) && job.model.provider === 'opendesign') job.error += ' Check the original Cloud task with action=resume without paying again.'; job.updatedAt = Date.now();
          await this.saveResult(job, { failurePhase: job.savePending ? 'saving' : 'interrupted', lastActivePhase });
          if (!job.savePending && !(job.model.provider === 'account' && resumableJob(job))) await rm(path.join(this.root, 'work', job.id), { recursive: true, force: true });
        }
        const running = jobs.filter(j => j.state === 'running');
        const maxTotal = Math.max(1, Math.min(20, this.options.maxConcurrentJobs ?? DEFAULT_MAX_CONCURRENT_JOBS));
        const maxOther = Math.min(maxTotal, DEFAULT_MAX_CONCURRENT_OTHER_JOBS);
        let totalSlots = Math.max(0, maxTotal - running.length);
        let otherSlots = Math.max(0, maxOther - running.filter(j => !isOpenDesignConcurrencyProvider(j.model.provider)).length);
        const next: GenerationJob[] = [];
        for (const job of jobs.filter(j => j.state === 'queued' && !this.active.has(j.id)).reverse()) {
          if (totalSlots <= 0) break;
          const isOpenDesign = isOpenDesignConcurrencyProvider(job.model.provider);
          if (!isOpenDesign && otherSlots <= 0) continue;
          next.push(job);
          totalSlots--;
          if (!isOpenDesign) otherSlots--;
        }
        for (const job of next) { job.state = 'running'; job.phase = 'starting'; job.startedAt = Date.now(); job.updatedAt = Date.now(); job.workerPid = process.pid; await this.saveJob(job); }
        return next;
      });
      for (const job of claimed) {
        const controller = new AbortController();
        const entry: { controller: AbortController; done: Promise<void>; snapshotTimings?: () => LiveTimings } = {
          controller,
          done: Promise.resolve(),
        };
        this.active.set(job.id, entry);
        entry.done = this.run(job, controller, entry).catch(() => {
          // A storage failure must not become an unhandled rejection or retry a paid request.
          console.error(`Model gateway could not persist job ${job.id}; check local data storage`);
        }).finally(() => this.active.delete(job.id));
      }
    } finally { this.ticking = false; }
  }
  private async run(job: GenerationJob, controller: AbortController, activeEntry?: { snapshotTimings?: () => LiveTimings }) {
    const dir = path.join(this.root, 'work', job.id);
    let key = '';
    let retained = !!job.savePending;
    const priorErrorCode = job.attemptKind && job.attemptKind !== 'initial' ? job.lastErrorCode : undefined;
    const priorFailurePhase = job.attemptKind && job.attemptKind !== 'initial' ? job.lastFailurePhase : undefined;
    const stages = createStageTimingTracker(retained ? 'saving' : 'precheck');
    if (activeEntry) {
      activeEntry.snapshotTimings = () => stages.snapshot();
    }
    const timeout = setTimeout(() => controller.abort(new Error('Generation timed out')), (job.modality === 'video' ? 30 : 15) * 60_000);
    let checking = false;
    const cancelPoll = setInterval(() => {
      if (checking) return; checking = true;
      void this.getJob(job.id).then(latest => { if (latest.state === 'cancelled') controller.abort(); }).catch(() => controller.abort(new Error('Cancel status poll failed'))).finally(() => { checking = false; });
    }, 500);
    const progress = async (phase: string, remoteId?: string, download?: GenerationJob['download']) => {
      const now = Date.now();
      stages.markStage(phase, {
        isAgentProvider: job.model.provider === 'codex',
        remoteId: remoteId ?? job.remoteId,
        now,
      });
      await this.store.lock(async () => { const current = await this.getJob(job.id); if (current.state !== 'running') { controller.abort(); return; }
        current.phase = phase; if (remoteId) { current.remoteId = remoteId; job.remoteId = remoteId; } if (download) current.download = download;
        if (phase === 'remote_failed') current.remoteTerminal = true;
        current.updatedAt = now; await this.saveJob(current); });
    };
    try {
      retained ||= await lstat(path.join(dir, 'outputs.json')).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; });
      let files = retained ? await this.savedOutputs(job) : null;
      if (!files) {
        stages.setActiveStage('precheck');
        if (job.projectId && !this.store.projectCatalog().projects.some(project => project.id === job.projectId)) throw new Error('Project not found');
        key = (await this.credential(job.model.provider)).key;
        const provider = (await this.status()).providers.find(p => p.id === job.model.provider);
        if (!provider?.available) throw new Error('Provider is no longer available');
        if (job.model.provider === 'opendesign' && job.providerOrigin !== await this.cloudOrigin()) throw new Error('Provider API origin changed; the queued task was not submitted');
        if (job.model.provider !== 'account' && !isGatewayProvider(job.model.provider) && job.providerOrigin !== await this.connections.baseUrl(job.model.provider)) throw new Error('Provider API origin changed; the queued task was not submitted');
        if (job.model.provider !== 'account' && !isGatewayProvider(job.model.provider) && (job.providerRevision !== await this.connections.identity(job.model.provider) || !(await this.connections.mediaModels()).some(model => model.id === job.model.id))) throw new Error('Provider or model configuration changed; the queued task was not submitted');
        await requireLibraryMediaRuntime();
        await mkdir(dir, { recursive: true, mode: 0o700 });
        let buffers: Buffer[];
        const inputs = (job.references ?? (job.reference ? [job.reference] : [])).map((item, index) => ({ file: path.join(dir, referenceFile(index, item.mimeType)), mimeType: item.mimeType, bytes: item.bytes }));
        const reference = inputs[0]?.file;
        const willUploadReferences = !job.remoteId && inputs.length > 0 && job.modality !== 'audio'
          && (job.model.provider === 'opendesign' || job.model.provider === 'account');
        stages.setActiveStage(job.model.provider === 'codex'
          ? 'generating'
          : job.remoteId ? 'polling' : willUploadReferences ? 'uploading' : 'submitting');
        if (!willUploadReferences) stages.startRemoteDirect();
        const keepResult = async (data: Record<string, unknown>, remoteTerminal = false) => {
          if (!data || Object.getPrototypeOf(data) !== Object.prototype || JSON.stringify(data).length > 2_000_000) return;
          const redact = (value: unknown): unknown => typeof value === 'string' ? key ? value.replaceAll(key, '[redacted]') : value
            : Array.isArray(value) ? value.map(redact) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([name, item]) => [key ? name.replaceAll(key, '[redacted]') : name, redact(item)])) : value;
          const clean = redact(data) as Record<string, unknown>;
          if (JSON.stringify(clean).length > 2_000_000) return;
          await this.store.lock(async () => { const current = await this.getJob(job.id); if (current.state !== 'running') return; current.result = clean; if (remoteTerminal) current.remoteTerminal = true; current.updatedAt = Date.now(); await this.saveJob(current); });
        };
        if (job.model.provider === 'account') {
          buffers = await this.account.generate(job, dir, controller.signal, progress, reference, inputs, keepResult);
        } else if (job.model.provider === 'codex') {
          await progress('generating');
          const imageOptions = { ...job.model.defaults, ...job.parameters };
          buffers = [await (this.options.codex ?? generateCodexImage)(job.prompt + (Object.keys(imageOptions).length ? '\nImage options: ' + JSON.stringify(imageOptions) : ''), dir, controller.signal, reference)];
        } else {
          const adapter = isMediaProvider(job.model.provider) ? providerAdapters[job.model.provider] : compatibleProvider;
          const urls = await adapter.generate(job, { key, baseUrl: job.providerOrigin, fetcher: this.options.fetcher ?? fetch, signal: controller.signal, progress, pollMs: this.options.pollMs, references: inputs, result: keepResult });
          await this.connections.verifyKey(job.model.provider, key, 'verified', job.providerOrigin);
          await progress('downloading');
          buffers = [];
          for (const url of urls) buffers.push(Buffer.isBuffer(url) ? url : await retryRead(() => (this.options.download ?? downloadMedia)(url, controller.signal), controller.signal, 5, () => progress('reconnecting'), () => progress('downloading')));
        }
        stages.markStage('decoding');
        files = [];
        if (!buffers.length) throw new Error('Provider returned no media');
        for (const [i, bytes] of buffers.entries()) {
          const media = mediaType(bytes, job.modality), filename = `${job.id}-${i + 1}.${media.extension}`;
          // This path has no committed output manifest. Replace a prior worker's unfinished result,
          // while keeping the separately verified image download and checkpoint available for recovery.
          await rm(path.join(dir, filename), { force: true });
          await writeFile(path.join(dir, filename), bytes, { flag: 'wx', mode: 0o600 });
          files.push({ path: `assets/generated/${filename}`, mimeType: media.mimeType, bytes: bytes.length, sha256: hash(bytes) });
        }
        await atomic(path.join(dir, 'outputs.json'), files);
        retained = true;
      }
      stages.markStage('saving');
      await this.store.lock(async () => {
        const current = await this.getJob(job.id); current.savePending = true;
        if (current.state === 'running') current.phase = 'saving';
        current.updatedAt = Date.now(); await this.saveJob(current);
      });
      controller.signal.throwIfAborted();
      const library = new AssetLibrary(this.store);
      const prepared: Awaited<ReturnType<AssetLibrary['prepare']>>[] = [];
      try {
        for (const file of files) prepared.push(await this.prepareOutput(library, file, dir));
        await this.store.lock(async () => {
          const current = await this.getJob(job.id); if (current.state !== 'running') return;
          current.libraryAssets = [];
          for (const [index, file] of files.entries()) {
            controller.signal.throwIfAborted();
            const digest = hash(`${job.id}:${index}`);
            const targetId = job.library && (!index || !job.library.createNew) ? job.library.assetId : `${digest.slice(0, 8)}-${digest.slice(8, 12)}-${digest.slice(12, 16)}-${digest.slice(16, 20)}-${digest.slice(20, 32)}`;
            const existing = await library.get(targetId).catch(error => { if (error.message !== 'ASSET_NOT_FOUND') throw error; return undefined; });
            const asset = await library.addLocked(prepared[index], { assetId: existing?.id, createId: targetId,
              name: job.library?.title || (job.modality === 'audio' ? audioAssetTitle(job.prompt) : job.prompt.replace(/\s+/g, ' ').trim().slice(0, 80)), expectedModality: job.modality,
              version: { source: 'generated', prompt: job.prompt, model: job.model.id, parameters: job.parameters,
                ...(job.capabilityId ?? job.library?.capabilityId ? { capabilityId: job.capabilityId ?? job.library?.capabilityId } : {}),
                ...(job.capabilityOptions ?? job.library?.capabilityOptions ? { capabilityOptions: job.capabilityOptions ?? job.library?.capabilityOptions } : {}),
                references: job.library?.references ?? [],
                ...(job.modality === 'audio' ? { audioKind: classifyAudioKind(job.model.id, job.model.mode, 'generated', `${job.model.modelId} ${job.model.label}`) } : {}),
                parentVersionId: job.library?.parentVersionId, jobId: job.id, requestId: `${job.id}-${index}`, requestHash: file.sha256, conversationId: job.library?.conversationId, result: current.result } });
            const version = asset.versions.find(v => v.requestId === `${job.id}-${index}`)!;
            current.libraryAssets.push({ assetId: asset.id, versionId: version.id });
            current.updatedAt = Date.now(); await this.saveJob(current);
          }
          if (job.projectId) {
            if (!this.store.projectCatalog().projects.some(p => p.id === job.projectId)) throw new Error('Target project no longer exists; outputs remain in the asset library');
            for (const [index, file] of files.entries()) {
              controller.signal.throwIfAborted();
              const target = await this.store.safePath(file.path, this.store.projectDirectoryFor(job.projectId));
              await mkdir(path.dirname(target), { recursive: true });
              const snapshot = path.join(dir, `project-${randomUUID()}`);
              try {
                const { filename } = await library.resolve(current.libraryAssets[index], true);
                await copyFile(filename, snapshot);
                try { await link(snapshot, target); }
                catch (error) {
                  if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
                  const existing = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
                  try {
                    const info = await existing.stat();
                    if (!info.isFile() || info.size !== file.bytes || hash(await existing.readFile()) !== file.sha256) throw new Error('Project output changed; refusing to overwrite it');
                  } finally { await existing.close(); }
                }
              } finally { await rm(snapshot, { force: true }); }
              current.assets[index] = { path: file.path, mimeType: file.mimeType, bytes: file.bytes };
            }
          }
          const doneAt = Date.now();
          const finalTimings = stages.finish(doneAt);
          const totalOutputBytes = files.reduce((sum, f) => sum + f.bytes, 0);
          current.state = 'completed'; current.phase = 'completed'; current.savePending = false; delete current.error; current.updatedAt = doneAt;
          await this.saveResult(current, {
            ...finalTimings,
            totalOutputBytes,
            previousErrorCode: priorErrorCode,
            previousFailurePhase: priorFailurePhase,
          });
          retained = false;
        });
      } finally { await Promise.all(prepared.map(file => rm(file.file, { force: true }))); }
    } catch (error) {
      // Only mark an API key rejected on confirmed API credential rejections (HTTP 401 or explicit 403 unauthorized) —
      // never on CDN/content download 403, presigned storage PUT 403, model/plan entitlement 403, or empty/unknown 403.
      if (
        error instanceof ProviderError
        && error.errorSource !== 'download'
        && error.errorSource !== 'storage'
        && (error.status === 401 || (error.status === 403 && extractUpstreamErrorCode(error) === 'unauthorized'))
      ) {
        await this.connections.verifyKey(job.model.provider, key, 'rejected', job.providerOrigin);
      }
      await this.store.lock(async () => {
        const current = await this.getJob(job.id); if (current.state !== 'running') return;
        const failedAt = Date.now();
        const finalTimings = stages.finish(failedAt);
        const unavailable = error instanceof Error && error.message.startsWith('SAVE_NOT_AVAILABLE:');
        current.state = 'failed'; current.phase = unavailable ? 'save_unavailable' : retained ? 'save_failed' : 'failed'; current.savePending = retained && !unavailable; current.updatedAt = failedAt;
        let message = controller.signal.aborted ? 'Generation stopped or timed out; no automatic retry was made' : error instanceof Error ? error.message : 'Generation failed';
        if (key) message = message.replaceAll(key, '[redacted]');
        if (resumableJob(current) && current.model.provider === 'opendesign') message += ' Check the original Cloud task with action=resume without paying again.';
        current.error = message.slice(0, 500);
        const failurePhase: MediaGenerationFailurePhase = unavailable
          ? 'save_unavailable'
          : retained || stages.activeStage === 'saving'
            ? 'saving'
            : stages.activeStage === 'remote_task' || current.remoteTerminal
              ? 'remote_task'
              : stages.activeStage;
        const cause = controller.signal.aborted && controller.signal.reason instanceof Error ? controller.signal.reason : error;
        await this.saveResult(current, {
          cause,
          failurePhase,
          ...finalTimings,
          previousErrorCode: priorErrorCode,
          previousFailurePhase: priorFailurePhase,
        });
      });
    } finally {
      clearTimeout(timeout); clearInterval(cancelPoll);
      const current = await this.getJob(job.id);
      const keepDownload = current.model.provider === 'account' && (current.modality === 'image' || current.modality === 'audio') && resumableJob(current);
      if (!retained && !keepDownload) await rm(dir, { recursive: true, force: true });
    }
  }
  async close() { this.closed = true; this.account.close(); for (const task of this.active.values()) task.controller.abort(); await Promise.allSettled([...this.active.values()].map(task => task.done)); }
}
const gateways = new WeakMap<WorkspaceStore, ModelGateway>();
export function gatewayFor(store: WorkspaceStore, tracking?: OmTracking) {
  store = store.workspaceStore ?? store;
  let gateway = gateways.get(store);
  if (!gateway) {
    gateway = new ModelGateway(store, { tracking });
    gateways.set(store, gateway);
  } else if (tracking) {
    gateway.options.tracking = tracking;
  }
  return gateway;
}
