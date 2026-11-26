import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { inspectGlb } from '../scripts/game-glb-inspect.mjs';
import { verificationBinaries } from '../scripts/verify-export.ts';
import type { WorkspaceStore } from '../workspace.ts';
import { atomicAssetJson, assetHash } from './asset-library.ts';
import type { CapabilityScriptContext, CapabilityScriptOutput } from './capability-scripts.ts';
import { optimizeGlbTexturesForPublish } from './glb-optimize.ts';
import { ProviderError, publicProviderFetch, retryRead, type Fetcher } from './network.ts';
import { cloud3dModels, cloudSpatialCatalog, cloudWorldModels, mediaSubmitHeaders, productionApi, type Cloud3dModelEntry } from './opendesign.ts';
import { gatewayFor } from './service.ts';

const DEFAULT_TRIPO_MODEL = 'tripo-3.0';
const DEFAULT_WORLD_MODEL = 'worldlabs-atlas';
const DEFAULT_RIG_MODEL_VERSION = 'v1.0-20240301';
const POLL_INTERVAL_MS = 2500;
const REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_TASK_TIMEOUT_MS = 300_000;
const DISCOVERY_CACHE_TTL_MS = 60_000;
const MAX_REFERENCE_IMAGE_BYTES = 20 * 1024 * 1024; // 20 MiB local safety cap before reading into memory
const MAX_SPATIAL_DOWNLOAD_BYTES = 100 * 1024 * 1024; // 100 MiB hard streaming cap

const QUALITY_PRESETS: Record<string, { faceLimit: number }> = {
  'prop-low': { faceLimit: 5000 },
  'hero-balanced': { faceLimit: 10000 },
  'hero-high': { faceLimit: 18000 },
};

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

type SpatialProvider = 'account' | 'opendesign' | 'env';

type Resolved3dEndpoint = {
  provider: SpatialProvider;
  baseUrl: string;
  apiKey: string;
  taskTimeoutMs: number;
  models: Cloud3dModelEntry[];
};

export type OpenDesign3dDiscovery = {
  available: boolean;
  provider?: SpatialProvider;
  models: Cloud3dModelEntry[];
};

type SpatialCheckpoint = {
  inputFingerprint?: string;
  uploadAssetIds?: string[];
  baseTaskId?: string;
  rigTaskId?: string;
  retargetTaskId?: string;
  worldTaskId?: string;
};

const discoveryCache = new Map<string, { at: number; result: Resolved3dEndpoint | null }>();
const worldDiscoveryCache = new Map<string, { at: number; result: Resolved3dEndpoint | null }>();

export function clearOpenDesign3dDiscoveryCache() {
  discoveryCache.clear();
  worldDiscoveryCache.clear();
}

function readEnvConfig(
  enabledKey: string,
  apiKeyEnv: string,
  keyFileEnv: string,
  baseUrlEnv: string,
): { baseUrl: string; apiKey: string } | undefined {
  if (process.env[enabledKey] === '0' || process.env[enabledKey] === 'false') {
    return undefined;
  }
  const inline = process.env[apiKeyEnv]?.trim();
  const keyFile = process.env[keyFileEnv]?.trim();
  let apiKey = inline;
  if (!apiKey && keyFile && existsSync(keyFile)) {
    try {
      apiKey = readFileSync(keyFile, 'utf8').trim() || undefined;
    } catch {
      apiKey = undefined;
    }
  }
  if (!apiKey) return undefined;
  const baseUrl = (process.env[baseUrlEnv]?.trim() || productionApi).replace(/\/+$/, '');
  return { baseUrl, apiKey };
}

function resolveTaskTimeoutMs(): number {
  const rawTimeout = Number(process.env.OPENMOTION_TRIPO_TIMEOUT_MS);
  return Number.isFinite(rawTimeout) && rawTimeout >= 30_000 ? rawTimeout : DEFAULT_TASK_TIMEOUT_MS;
}

function resolveFetcher(store: WorkspaceStore): Fetcher {
  const gateway = gatewayFor(store);
  const custom = gateway.options.fetcher;
  return !custom || custom === fetch ? publicProviderFetch : custom;
}

function parseProviderModel(rawModel?: string): { provider?: string; modelId?: string } {
  const trimmed = rawModel?.trim();
  if (!trimmed) return {};
  const colon = trimmed.indexOf(':');
  if (colon > 0) {
    return { provider: trimmed.slice(0, colon), modelId: trimmed.slice(colon + 1) };
  }
  return { modelId: trimmed };
}

async function resolveSpatialEndpoint(
  store: WorkspaceStore,
  domain: '3d' | 'world',
  refresh = false,
  requestedProvider?: string,
): Promise<Resolved3dEndpoint | null> {
  const taskTimeoutMs = resolveTaskTimeoutMs();
  const envCfg = domain === 'world'
    ? readEnvConfig('OPENMOTION_WORLD_ENABLED', 'OPENMOTION_WORLD_API_KEY', 'OPENMOTION_WORLD_KEY_FILE', 'OPENMOTION_WORLD_BASE_URL')
    : readEnvConfig('OPENMOTION_TRIPO_ENABLED', 'OPENMOTION_TRIPO_API_KEY', 'OPENMOTION_TRIPO_KEY_FILE', 'OPENMOTION_TRIPO_BASE_URL');

  if (envCfg && (!requestedProvider || requestedProvider === 'env')) {
    return {
      provider: 'env',
      baseUrl: envCfg.baseUrl,
      apiKey: envCfg.apiKey,
      taskTimeoutMs,
      models: [
        domain === 'world'
          ? {
              modelId: DEFAULT_WORLD_MODEL,
              label: 'World Labs Atlas v2 (Scene frames, RGB-D, Splats & Mesh)',
              tier: 'flagship',
              bestFor: ['3d-world', 'atlas-v2', 'scene-frame', 'world-mesh'],
              description: 'Run World Labs Atlas v2 tasks (atlasTextToImage, images2PosedRGBD, atlasGenerate, atlasChisel, posedImages2Splats, splats2Mesh).',
            }
          : {
              modelId: DEFAULT_TRIPO_MODEL,
              label: 'Tripo 3D v3 (GLB + PBR + optional rig/retarget)',
              tier: 'flagship',
              bestFor: ['3d-mesh', 'text-to-3d', 'image-to-3d', 'humanoid-rig'],
              description: 'Generate PBR textured .glb meshes from text or a single reference image, with optional humanoid rig and animation retargeting.',
            },
      ],
    };
  }
  if (requestedProvider === 'env') return null;

  const cache = domain === 'world' ? worldDiscoveryCache : discoveryCache;
  const cacheKey = `${(store.workspaceStore ?? store).directory}::${requestedProvider ?? '*'}`;
  const cached = !refresh ? cache.get(cacheKey) : undefined;
  if (cached && Date.now() - cached.at < DISCOVERY_CACHE_TTL_MS) {
    return cached.result;
  }

  const gateway = gatewayFor(store);
  const fetcher = resolveFetcher(store);
  const candidates: { provider: 'account' | 'opendesign'; baseUrl: string; key: string }[] = [];

  if (!requestedProvider || requestedProvider === 'account') {
    const status = await gateway.status().catch(() => undefined);
    const accountState = status?.providers.find(p => p.id === 'account');
    const accountEntitled = !accountState || (accountState.available && accountState.mediaEntitlement !== 'not-included');
    if (accountEntitled) {
      const accountAccess = await gateway.account.controlAccess().catch(() => undefined);
      if (accountAccess) {
        candidates.push({ provider: 'account', baseUrl: accountAccess.baseUrl, key: accountAccess.key });
      }
    }
  }
  if (!requestedProvider || requestedProvider === 'opendesign') {
    const cloudCred = await gateway.connections.resolveCredential('opendesign').catch(() => ({ key: '' }));
    const cloudBase = await gateway.connections.baseUrl('opendesign').catch(() => undefined);
    if (cloudCred.key && cloudBase) {
      candidates.push({ provider: 'opendesign', baseUrl: cloudBase.replace(/\/+$/, ''), key: cloudCred.key });
    }
  }

  const loader = domain === 'world' ? cloudWorldModels : cloud3dModels;
  for (const candidate of candidates) {
    try {
      const models = await loader(candidate.baseUrl, candidate.key, fetcher);
      if (models.length > 0) {
        const resolved: Resolved3dEndpoint = {
          provider: candidate.provider,
          baseUrl: candidate.baseUrl,
          apiKey: candidate.key,
          taskTimeoutMs,
          models,
        };
        cache.set(cacheKey, { at: Date.now(), result: resolved });
        return resolved;
      }
    } catch {
      // Keep probing remaining configured OpenDesign credentials.
    }
  }

  cache.set(cacheKey, { at: Date.now(), result: null });
  return null;
}

export async function discoverOpenDesign3d(
  store: WorkspaceStore,
  refresh = false,
  requestedProvider?: string,
): Promise<OpenDesign3dDiscovery> {
  const endpoint = await resolveSpatialEndpoint(store, '3d', refresh, requestedProvider);
  if (!endpoint) return { available: false, models: [] };
  return { available: true, provider: endpoint.provider, models: endpoint.models };
}

export async function discoverOpenDesignWorld(
  store: WorkspaceStore,
  refresh = false,
  requestedProvider?: string,
): Promise<OpenDesign3dDiscovery> {
  const endpoint = await resolveSpatialEndpoint(store, 'world', refresh, requestedProvider);
  if (!endpoint) return { available: false, models: [] };
  return { available: true, provider: endpoint.provider, models: endpoint.models };
}

/** Discover both 3D asset and 3D world availability using one shared catalogue request per configured OpenDesign credential. */
export async function discoverOpenDesignSpatial(
  store: WorkspaceStore,
  refresh = false,
): Promise<{ live3d: OpenDesign3dDiscovery; liveWorld: OpenDesign3dDiscovery }> {
  const env3d = readEnvConfig('OPENMOTION_TRIPO_ENABLED', 'OPENMOTION_TRIPO_API_KEY', 'OPENMOTION_TRIPO_KEY_FILE', 'OPENMOTION_TRIPO_BASE_URL');
  const envWorld = readEnvConfig('OPENMOTION_WORLD_ENABLED', 'OPENMOTION_WORLD_API_KEY', 'OPENMOTION_WORLD_KEY_FILE', 'OPENMOTION_WORLD_BASE_URL');
  const cacheKey = `${(store.workspaceStore ?? store).directory}::*`;
  const now = Date.now();
  const cached3d = !refresh && !env3d ? discoveryCache.get(cacheKey) : undefined;
  const cachedWorld = !refresh && !envWorld ? worldDiscoveryCache.get(cacheKey) : undefined;
  const hasFresh3d = Boolean(env3d || (cached3d && now - cached3d.at < DISCOVERY_CACHE_TTL_MS));
  const hasFreshWorld = Boolean(envWorld || (cachedWorld && now - cachedWorld.at < DISCOVERY_CACHE_TTL_MS));
  if (hasFresh3d && hasFreshWorld) {
    return {
      live3d: await discoverOpenDesign3d(store, false),
      liveWorld: await discoverOpenDesignWorld(store, false),
    };
  }

  const taskTimeoutMs = resolveTaskTimeoutMs();
  const gateway = gatewayFor(store);
  const fetcher = resolveFetcher(store);
  const candidates: { provider: 'account' | 'opendesign'; baseUrl: string; key: string }[] = [];

  const status = await gateway.status().catch(() => undefined);
  const accountState = status?.providers.find(p => p.id === 'account');
  const accountEntitled = !accountState || (accountState.available && accountState.mediaEntitlement !== 'not-included');
  if (accountEntitled) {
    const accountAccess = await gateway.account.controlAccess().catch(() => undefined);
    if (accountAccess) {
      candidates.push({ provider: 'account', baseUrl: accountAccess.baseUrl, key: accountAccess.key });
    }
  }
  const cloudCred = await gateway.connections.resolveCredential('opendesign').catch(() => ({ key: '' }));
  const cloudBase = await gateway.connections.baseUrl('opendesign').catch(() => undefined);
  if (cloudCred.key && cloudBase) {
    candidates.push({ provider: 'opendesign', baseUrl: cloudBase.replace(/\/+$/, ''), key: cloudCred.key });
  }

  let resolved3d: Resolved3dEndpoint | null = null;
  let resolvedWorld: Resolved3dEndpoint | null = null;
  for (const candidate of candidates) {
    if ((env3d || resolved3d) && (envWorld || resolvedWorld)) break;
    try {
      const { models3d, modelsWorld } = await cloudSpatialCatalog(candidate.baseUrl, candidate.key, fetcher);
      if (!env3d && !resolved3d && models3d.length > 0) {
        resolved3d = { provider: candidate.provider, baseUrl: candidate.baseUrl, apiKey: candidate.key, taskTimeoutMs, models: models3d };
      }
      if (!envWorld && !resolvedWorld && modelsWorld.length > 0) {
        resolvedWorld = { provider: candidate.provider, baseUrl: candidate.baseUrl, apiKey: candidate.key, taskTimeoutMs, models: modelsWorld };
      }
    } catch {
      // Keep probing remaining configured OpenDesign credentials.
    }
  }

  const stamp = Date.now();
  if (!env3d) discoveryCache.set(cacheKey, { at: stamp, result: resolved3d });
  if (!envWorld) worldDiscoveryCache.set(cacheKey, { at: stamp, result: resolvedWorld });

  return {
    live3d: env3d
      ? await discoverOpenDesign3d(store, false)
      : resolved3d ? { available: true, provider: resolved3d.provider, models: resolved3d.models } : { available: false, models: [] },
    liveWorld: envWorld
      ? await discoverOpenDesignWorld(store, false)
      : resolvedWorld ? { available: true, provider: resolvedWorld.provider, models: resolvedWorld.models } : { available: false, models: [] },
  };
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function checkpointFileFor(store: WorkspaceStore, domain: '3d' | 'world', requestId: string): string {
  const root = (store.workspaceStore ?? store).directory;
  return path.join(root, 'assets', 'requests', `spatial-${domain}-${assetHash(requestId)}.json`);
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(',')}}`;
}

function spatialInputFingerprint(input: {
  domain: '3d' | 'world';
  provider: SpatialProvider;
  modelId: string;
  operation: string;
  prompt: string;
  references: CapabilityScriptContext['references'];
  options: Record<string, unknown>;
  parameters: Record<string, unknown>;
}): string {
  return createHash('sha256')
    .update(stableJson({
      domain: input.domain,
      provider: input.provider,
      modelId: input.modelId,
      operation: input.operation,
      prompt: input.prompt.trim(),
      references: input.references.map(ref => `${ref.assetId}:${ref.versionId}`),
      options: input.options,
      parameters: input.parameters,
    }))
    .digest('hex');
}

function assertCheckpointMatchesInput(checkpoint: SpatialCheckpoint, fingerprint: string, requestId: string): void {
  const hasSavedState = Boolean(
    checkpoint.uploadAssetIds?.length
    || checkpoint.baseTaskId
    || checkpoint.rigTaskId
    || checkpoint.retargetTaskId
    || checkpoint.worldTaskId,
  );
  if (hasSavedState && checkpoint.inputFingerprint !== fingerprint) {
    throw new Error(
      `REQUEST_ID_CONFLICT: requestId "${requestId}" already has a saved 3D checkpoint for different inputs. Reuse the exact original inputs to resume, or supply a new requestId.`,
    );
  }
  checkpoint.inputFingerprint = fingerprint;
}

async function readCheckpoint(file: string): Promise<SpatialCheckpoint> {
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Checkpoint JSON must be an object');
    }
    return parsed as SpatialCheckpoint;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw new Error(
      `3D request checkpoint is unreadable (${file}): ${error instanceof Error ? error.message : String(error)}. Refusing to restart a potentially billed 3D task; inspect or remove the corrupt checkpoint before retrying.`,
    );
  }
}

async function saveCheckpoint(file: string, data: SpatialCheckpoint): Promise<void> {
  try {
    await atomicAssetJson(file, data);
  } catch (error) {
    throw new Error(
      `Failed to persist 3D request checkpoint (${file}): ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function tripoJson<T = any>(
  fetcher: Fetcher,
  config: Resolved3dEndpoint,
  endpoint: string,
  init: RequestInit = {},
): Promise<T> {
  const url = `${config.baseUrl}${endpoint}`;
  const res = await fetcher(url, {
    ...init,
    redirect: 'error',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await res.text();
  let parsed: any;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = { raw: text.slice(0, 500) };
  }
  if (!res.ok) {
    const detail = parsed?.error?.message || parsed?.error || parsed?.message || parsed?.detail || text.slice(0, 300);
    throw new ProviderError(`3D gateway HTTP ${res.status} on ${endpoint}: ${String(detail)}`, res.status);
  }
  return parsed as T;
}

function detectReferenceImageMime(bytes: Buffer): 'image/png' | 'image/jpeg' | 'image/webp' | undefined {
  if (bytes.length >= 8
    && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) {
    return 'image/png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (bytes.length >= 12
    && bytes.toString('ascii', 0, 4) === 'RIFF'
    && bytes.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  return undefined;
}

const EXT_BY_MIME: Record<'image/png' | 'image/jpeg' | 'image/webp', string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
};

async function prepareUploadReferenceBytes(filePath: string): Promise<{ bytes: Buffer; contentType: string; filename: string }> {
  const info = await stat(filePath);
  if (info.size <= 0 || info.size > MAX_REFERENCE_IMAGE_BYTES) {
    throw new Error(`3D reference image must be between 1 byte and 20 MiB (got ${info.size} bytes)`);
  }
  let bytes = await readFile(filePath);
  const detectedMime = detectReferenceImageMime(bytes);
  if (!detectedMime) {
    throw new Error('3D reference asset must be a PNG, JPEG, or WebP image');
  }
  let contentType: string = detectedMime;
  const ext = path.extname(filePath).toLowerCase();
  const base = path.parse(path.basename(filePath)).name || 'reference';
  let filename = MIME_BY_EXT[ext] === detectedMime ? path.basename(filePath) : `${base}${EXT_BY_MIME[detectedMime]}`;

  // AMR /api/v1/media/uploads rejects >2MB 2K PNGs with HTTP 413 asset_too_large; transcode large references cleanly to JPEG.
  if (bytes.length > 1_800_000 && (contentType === 'image/png' || contentType === 'image/webp' || contentType === 'image/jpeg')) {
    const tmpOut = path.join(os.tmpdir(), `om-3d-ref-${randomUUID()}.jpg`);
    try {
      const { execFile } = await import('node:child_process');
      const { promisify } = await import('node:util');
      const execFileAsync = promisify(execFile);
      if (process.platform === 'darwin') {
        await execFileAsync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '86', '-Z', '1536', filePath, '--out', tmpOut], { timeout: 15_000 });
      } else {
        const { ffmpeg } = verificationBinaries();
        await execFileAsync(ffmpeg, ['-y', '-i', filePath, '-vf', "scale='min(1536,iw)':'min(1536,ih)':force_original_aspect_ratio=decrease", '-q:v', '4', tmpOut], { timeout: 15_000 });
      }
      const compressed = await readFile(tmpOut);
      if (compressed.length > 0 && compressed.length < bytes.length) {
        bytes = compressed;
        contentType = 'image/jpeg';
        filename = `${path.parse(filename).name}.jpg`;
      }
    } catch {
      // Fall back to original bytes if local transcoder is unavailable
    } finally {
      await rm(tmpOut, { force: true }).catch(() => {});
    }
  }
  return { bytes, contentType, filename };
}

async function uploadReferenceImage(
  fetcher: Fetcher,
  config: Resolved3dEndpoint,
  filePath: string,
  idempotencyKey: string,
): Promise<string> {
  const { bytes, contentType, filename } = await prepareUploadReferenceBytes(filePath);

  const created = await tripoJson<any>(fetcher, config, '/api/v1/media/uploads', {
    method: 'POST',
    headers: { 'Idempotency-Key': `${idempotencyKey}-upload` },
    body: JSON.stringify({
      filename,
      mime_type: contentType,
      content_type: contentType,
      size_bytes: bytes.length,
    }),
  });
  const uploadId = created.asset_id ?? created.id ?? created.upload_id;
  const uploadUrl = created.upload_url ?? created.upload?.url;
  if (typeof uploadId !== 'string' || !uploadId || typeof uploadUrl !== 'string' || !uploadUrl.startsWith('https://')) {
    throw new Error(`3D image upload init returned unexpected payload: ${JSON.stringify(created).slice(0, 300)}`);
  }

  const putHeaders: Record<string, string> = { 'Content-Type': contentType, 'Content-Length': String(bytes.length) };
  if (created.upload?.headers && typeof created.upload.headers === 'object') {
    for (const [k, v] of Object.entries(created.upload.headers)) {
      if (typeof v === 'string' && !/^authorization$/i.test(k)) putHeaders[k] = v;
    }
  }
  const putRes = await fetcher(uploadUrl, {
    method: 'PUT',
    headers: putHeaders,
    body: new Uint8Array(bytes),
    redirect: 'error',
    signal: AbortSignal.timeout(60_000),
  });
  if (!putRes.ok) {
    throw new Error(`3D reference image PUT failed with HTTP ${putRes.status}`);
  }

  await tripoJson(fetcher, config, `/api/v1/media/uploads/${encodeURIComponent(uploadId)}/commit`, {
    method: 'POST',
    headers: { 'Idempotency-Key': `${idempotencyKey}-commit` },
    body: JSON.stringify({}),
  });
  return String(uploadId);
}

type TripoArtifact = {
  name?: string;
  format?: string;
  asset_id?: string;
  content_path?: string;
  url?: string;
  content_type?: string;
};

type TripoTaskResult = {
  taskId: string;
  status: string;
  artifacts: TripoArtifact[];
  raw: Record<string, unknown>;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Production AMR validates `X-OpenMotion-Job-Id` as a canonical RFC 4122 UUID (rejecting non-UUID
 * strings with HTTP 400 `invalid_media_attribution`). Derive a deterministic UUID from each
 * per-step idempotency key so retries keep the exact same job attribution & idempotency key.
 */
function deterministicAttributionUuid(key: string): string {
  const trimmed = key.trim();
  if (UUID_PATTERN.test(trimmed)) return trimmed.toLowerCase();
  const bytes = createHash('sha256').update(`openmotion-3d:${trimmed}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50; // version 5
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

async function submitAndWaitTask(
  fetcher: Fetcher,
  config: Resolved3dEndpoint,
  payload: Record<string, unknown>,
  idempotencyKey: string,
  pollMs: number,
  options: {
    taskBasePath?: string;
    existingTaskId?: string;
    onSubmitted?: (taskId: string) => Promise<void>;
  } = {},
): Promise<TripoTaskResult> {
  const taskBasePath = options.taskBasePath ?? '/api/v1/media/3d/tasks';
  let taskId = options.existingTaskId;
  if (!taskId) {
    const submissionJobId = deterministicAttributionUuid(idempotencyKey);
    const submitted = await tripoJson<any>(fetcher, config, taskBasePath, {
      method: 'POST',
      headers: mediaSubmitHeaders(config.baseUrl, submissionJobId),
      body: JSON.stringify(payload),
    });
    taskId = String(submitted.task_id ?? submitted.id ?? '');
    if (!taskId) {
      throw new Error(`3D task submit returned no task_id: ${JSON.stringify(submitted).slice(0, 300)}`);
    }
    await options.onSubmitted?.(taskId);
  }

  const deadline = Date.now() + config.taskTimeoutMs;
  const pollController = new AbortController();
  while (Date.now() < deadline) {
    const polled = await retryRead(
      () => tripoJson<any>(fetcher, config, `${taskBasePath}/${encodeURIComponent(taskId)}`),
      pollController.signal,
      4,
    );
    const status = String(polled.status ?? polled.state ?? '').toLowerCase();
    if (status === 'succeeded' || status === 'completed' || status === 'success') {
      const artifacts = Array.isArray(polled.artifacts) ? polled.artifacts : [];
      return { taskId, status, artifacts, raw: polled };
    }
    if (status === 'failed' || status === 'cancelled' || status === 'canceled' || status === 'error') {
      const errMsg = polled?.error?.message || polled?.error || polled?.message || status;
      throw new Error(`3D task ${taskId} (${String(payload.operation ?? 'unknown')}) ${status}: ${String(errMsg)}`);
    }
    await sleep(pollMs);
  }
  throw new Error(`3D task ${taskId} timed out after ${Math.round(config.taskTimeoutMs / 1000)}s`);
}

function selectGlbArtifact(artifacts: TripoArtifact[]): TripoArtifact {
  const chosen =
    artifacts.find(a => a.name === 'pbr_model') ??
    artifacts.find(a => a.name === 'model') ??
    artifacts.find(a => a.name === 'base_model') ??
    artifacts.find(a => a.name === 'colliderMesh') ??
    artifacts.find(a => a.name === 'mesh') ??
    artifacts.find(a => typeof a.format === 'string' && a.format.toLowerCase() === 'glb') ??
    artifacts.find(a => typeof a.content_path === 'string' && a.content_path.includes('artifact=pbr_model')) ??
    artifacts.find(a => typeof a.content_path === 'string' && a.content_path.includes('artifact=model')) ??
    artifacts.find(a => a.content_type === 'model/gltf-binary') ??
    artifacts.find(a => typeof a.content_path === 'string' && a.content_path.endsWith('.glb')) ??
    artifacts[0];
  if (!chosen || (!chosen.content_path && !chosen.url)) {
    throw new Error(`3D task completed without a downloadable model artifact: ${JSON.stringify(artifacts).slice(0, 300)}`);
  }
  return chosen;
}

function resolveArtifactDownloadTarget(config: Resolved3dEndpoint, artifact: TripoArtifact): { url: string; headers: Record<string, string> } {
  const baseOrigin = new URL(config.baseUrl).origin;
  if (typeof artifact.content_path === 'string' && artifact.content_path.trim()) {
    const rawPath = artifact.content_path.trim();
    if (!rawPath.startsWith('/') || rawPath.startsWith('//')) {
      throw new Error('3D artifact content_path must be a relative path starting with /');
    }
    const resolved = new URL(rawPath, `${config.baseUrl}/`);
    if (resolved.origin !== baseOrigin) {
      throw new Error('3D artifact content_path escaped configured gateway origin');
    }
    return { url: resolved.href, headers: { Authorization: `Bearer ${config.apiKey}` } };
  }
  const rawUrl = String(artifact.url ?? '').trim();
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('3D artifact download URL is invalid');
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    throw new Error('3D artifact download URL must use clean HTTPS');
  }
  return { url: parsed.href, headers: {} };
}

async function readBoundedResponseBuffer(res: Response, maxBytes: number): Promise<Buffer> {
  const declared = Number(res.headers.get('content-length') || 0);
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error(`Downloaded 3D artifact exceeds ${Math.round(maxBytes / (1024 * 1024))} MiB limit`);
  }
  if (!res.body) {
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > maxBytes) throw new Error(`Downloaded 3D artifact exceeds ${Math.round(maxBytes / (1024 * 1024))} MiB limit`);
    return buf;
  }
  const reader = res.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new Error(`Downloaded 3D artifact exceeds ${Math.round(maxBytes / (1024 * 1024))} MiB limit`);
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

async function downloadArtifact(
  fetcher: Fetcher,
  config: Resolved3dEndpoint,
  artifact: TripoArtifact,
  destination: string,
): Promise<number> {
  const target = resolveArtifactDownloadTarget(config, artifact);
  const controller = new AbortController();
  const buffer = await retryRead(async () => {
    const res = await fetcher(target.url, {
      headers: target.headers,
      redirect: 'error',
      signal: AbortSignal.timeout(90_000),
    });
    if (!res.ok) {
      throw new ProviderError(`Failed to download 3D GLB artifact: HTTP ${res.status}`, res.status);
    }
    return readBoundedResponseBuffer(res, MAX_SPATIAL_DOWNLOAD_BYTES);
  }, controller.signal, 3);

  if (buffer.length < 20 || buffer.readUInt32LE(0) !== 0x46546c67) {
    throw new Error(`Downloaded 3D artifact is not a valid binary .glb file (size=${buffer.length})`);
  }
  await writeFile(destination, buffer);
  return buffer.length;
}

function sanitizeMeshParameters(raw: Record<string, unknown>, defaultFaceLimit: number): { params: Record<string, unknown>; faceLimit: number } {
  const faceRaw = Number(raw.face_limit);
  const faceLimit = Number.isFinite(faceRaw) ? Math.max(1000, Math.min(30000, Math.round(faceRaw))) : defaultFaceLimit;
  const params: Record<string, unknown> = {
    pbr: raw.pbr !== undefined ? Boolean(raw.pbr) : true,
    texture: raw.texture !== undefined ? Boolean(raw.texture) : true,
    face_limit: faceLimit,
  };
  for (const key of ['texture_quality', 'geometry_quality', 'style', 'negative_prompt', 'auto_size', 'orientation', 'model_seed', 'texture_seed']) {
    if (raw[key] !== undefined) params[key] = raw[key];
  }
  // Never forward quad=true because Tripo returns FBX instead of GLB.
  return { params, faceLimit };
}

const TRIPO_BIPED_ANIMATION_SHORT_NAMES = new Set([
  'idle', 'walk', 'run', 'dive', 'climb', 'jump', 'slash', 'shoot', 'hurt', 'fall', 'turn',
]);
const TRIPO_CREATURE_ANIMATION_SHORT_NAMES = new Set([
  'quadruped:walk', 'hexapod:walk', 'octopod:walk', 'serpentine:march', 'aquatic:march',
]);
const TRIPO_RIG_V3_MODEL_VERSION = 'v3.0-20260909';
const TRIPO_RIG_V3_ONLY_SPECS = new Set(['actorcore', 'unity', 'unreal', 'vrm']);
const TRIPO_TASK_CHAIN_OPERATIONS = new Set([
  'decimate', 'retarget', 'texture', 'convert',
  'segment', 'smartsegment', 'complete', 'uv', 'edit', 'rig-check',
]);
const TRIPO_MEDIA_PASSTHROUGH_OPERATIONS = new Set([
  'multiview_to_model', 'image_to_splat', 'text_to_image', 'image_to_image',
  'image_to_multiview', 'edit_multiview', 'import',
]);

/** Normalize Tripo v3 animation identifiers to the required `preset:*` format and fail fast on invalid names. */
export function normalizeTripoAnimation(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error('Tripo retarget animation name must be non-empty (e.g. "preset:idle", "preset:run", "preset:slash")');
  }
  if (/^preset:[a-z0-9_:-]+$/i.test(trimmed)) {
    return trimmed;
  }
  const lower = trimmed.toLowerCase();
  const withoutMixamo = lower.startsWith('mixamo-') ? lower.slice('mixamo-'.length) : lower;
  if (TRIPO_BIPED_ANIMATION_SHORT_NAMES.has(withoutMixamo)) {
    return `preset:${withoutMixamo}`;
  }
  if (TRIPO_CREATURE_ANIMATION_SHORT_NAMES.has(lower)) {
    return `preset:${lower}`;
  }
  throw new Error(
    `Invalid Tripo animation "${trimmed}": Tripo v3 retarget requires "preset:*" identifiers (for example ["preset:idle", "preset:run", "preset:slash"]).`,
  );
}

/** Re-encode embedded PNG/JPEG textures inside a GLB 2 file to EXT_texture_webp via pure-Node glb-optimize.ts (preserving resolution, alpha, geometry, skins, and animations). */
async function maybeOptimizeGlb(rawPath: string, optimizedPath: string): Promise<{ file: string; slimmed: boolean; bytes: number; convertedImages: number; savedBytes: number }> {
  const rawBytes = await readFile(rawPath);
  try {
    const opt = await optimizeGlbTexturesForPublish(rawBytes);
    if (opt.optimized && opt.data.length > 0 && opt.data.length < rawBytes.length) {
      await writeFile(optimizedPath, opt.data);
      return {
        file: optimizedPath,
        slimmed: true,
        bytes: opt.data.length,
        convertedImages: opt.convertedImages,
        savedBytes: opt.savedBytes,
      };
    }
  } catch {
    // Graceful fallback to raw GLB if no WebP encoder is available.
  }
  return { file: rawPath, slimmed: false, bytes: rawBytes.length, convertedImages: 0, savedBytes: 0 };
}

export async function runOpenDesign3dScript(ctx: CapabilityScriptContext): Promise<CapabilityScriptOutput> {
  const params = ctx.parameters ?? {};
  const requestedRaw = ctx.model || (typeof params.model === 'string' ? params.model : undefined);
  const requested = parseProviderModel(requestedRaw);
  const config = await resolveSpatialEndpoint(ctx.store, '3d', false, requested.provider);
  if (!config) {
    throw new Error(
      requested.provider
        ? `CAPABILITY_UNAVAILABLE: Provider ${requested.provider} has no active 3D generation model`
        : 'CAPABILITY_UNAVAILABLE: No active 3D generation model (tripo-3.0) is available on the signed-in OpenDesign account or configured OpenDesign Cloud connection.',
    );
  }
  if (requested.modelId && !config.models.some(m => m.modelId === requested.modelId)) {
    throw new Error(`CAPABILITY_MODEL_INCOMPATIBLE: Model ${requestedRaw} is not available on provider ${config.provider}`);
  }
  const gateway = gatewayFor(ctx.store);
  const fetcher = resolveFetcher(ctx.store);
  const pollMs = gateway.options.pollMs ?? POLL_INTERVAL_MS;
  const modelId = requested.modelId
    ?? config.models.find(m => m.modelId === DEFAULT_TRIPO_MODEL)?.modelId
    ?? config.models[0]?.modelId
    ?? DEFAULT_TRIPO_MODEL;

  const qualityKey = typeof ctx.options.quality === 'string' && ctx.options.quality in QUALITY_PRESETS
    ? ctx.options.quality
    : 'hero-balanced';
  const preset = QUALITY_PRESETS[qualityKey];

  const explicitParamOp = typeof params.operation === 'string' && params.operation.trim() ? params.operation.trim() : undefined;
  const optionOp = typeof ctx.options.operation === 'string' && ctx.options.operation.trim() ? ctx.options.operation.trim() : 'auto';
  const originalTaskIdParam = typeof params.original_model_task_id === 'string' && params.original_model_task_id.trim()
    ? params.original_model_task_id.trim()
    : undefined;
  const rigPresetMap: Record<string, string> = {
    'mixamo-idle': 'preset:idle',
    'mixamo-walk': 'preset:walk',
    'mixamo-run': 'preset:run',
    'mixamo-slash': 'preset:slash',
  };
  const rigPresetOpt = typeof ctx.options.rigPreset === 'string' ? ctx.options.rigPreset : undefined;
  const rigOnlyPreset = rigPresetOpt === 'mixamo-only';
  const rigPresetAnimation = rigPresetOpt ? rigPresetMap[rigPresetOpt] : undefined;
  const rawAnimationsList = Array.isArray(params.animations)
    ? params.animations.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    : [];
  const animationsList = rawAnimationsList.map(normalizeTripoAnimation);
  const rawAnimation = (typeof params.animation === 'string' && params.animation.trim())
    || rigPresetAnimation
    || (typeof ctx.options.animation === 'string' && ctx.options.animation !== 'none' ? ctx.options.animation : undefined);
  const animation = rawAnimation ? normalizeTripoAnimation(rawAnimation) : undefined;
  const hasRetargetAnimation = Boolean(animation || animationsList.length > 0);

  let effectiveOp = explicitParamOp ?? optionOp;
  if (effectiveOp === 'auto') {
    if (originalTaskIdParam) {
      effectiveOp = hasRetargetAnimation ? 'rig_retarget' : 'rig';
    } else if (ctx.references.length === 1) {
      effectiveOp = hasRetargetAnimation ? 'rig_retarget' : rigOnlyPreset ? 'rig' : 'image_to_model';
    } else {
      effectiveOp = hasRetargetAnimation ? 'rig_retarget' : rigOnlyPreset ? 'rig' : 'text_to_model';
    }
  } else if (!explicitParamOp && effectiveOp === 'text_to_model' && ctx.references.length === 1) {
    // Never silently ignore a pinned reference image when the caller left operation at text_to_model.
    effectiveOp = hasRetargetAnimation ? 'rig_retarget' : rigOnlyPreset ? 'rig' : 'image_to_model';
  } else if ((effectiveOp === 'text_to_model' || effectiveOp === 'image_to_model') && (hasRetargetAnimation || rigOnlyPreset)) {
    if (effectiveOp === 'image_to_model' && ctx.references.length !== 1) {
      throw new Error('3d-asset image_to_model requires exactly 1 reference image asset');
    }
    if (effectiveOp === 'text_to_model' && !ctx.prompt.trim()) {
      throw new Error('3d-asset text_to_model requires a non-empty prompt');
    }
    effectiveOp = hasRetargetAnimation ? 'rig_retarget' : 'rig';
  } else if (effectiveOp === 'rig' && hasRetargetAnimation) {
    effectiveOp = 'rig_retarget';
  }
  if (effectiveOp === 'rig_retarget' && !hasRetargetAnimation) {
    throw new Error(
      '3d-asset operation=rig_retarget requires an animation (pass options.rigPreset such as mixamo-idle/mixamo-walk/mixamo-run/mixamo-slash, or parameters.animation / parameters.animations; use operation="rig" for skeleton-only rigging)',
    );
  }

  const checkpointPath = checkpointFileFor(ctx.store, '3d', ctx.requestId);
  const checkpoint = await readCheckpoint(checkpointPath);
  const inputFingerprint = spatialInputFingerprint({
    domain: '3d',
    provider: config.provider,
    modelId,
    operation: effectiveOp,
    prompt: ctx.prompt,
    references: ctx.references,
    options: ctx.options,
    parameters: params,
  });
  assertCheckpointMatchesInput(checkpoint, inputFingerprint, ctx.requestId);
  const ensureUploadedRef = async (): Promise<string> => {
    if (checkpoint.uploadAssetIds?.[0]) return checkpoint.uploadAssetIds[0];
    const uploadId = await uploadReferenceImage(fetcher, config, ctx.references[0].filename, ctx.requestId);
    checkpoint.uploadAssetIds = [uploadId];
    await saveCheckpoint(checkpointPath, checkpoint);
    return uploadId;
  };

  const { params: meshParams, faceLimit } = sanitizeMeshParameters(params, preset.faceLimit);
  let baseTaskId = originalTaskIdParam ?? checkpoint.baseTaskId;
  let rigTaskId = checkpoint.rigTaskId;
  let retargetRan = false;
  let finalTask: TripoTaskResult;

  if (effectiveOp === 'text_to_model') {
    if (!ctx.prompt.trim()) {
      throw new Error('3d-asset text_to_model requires a non-empty prompt');
    }
    finalTask = await submitAndWaitTask(fetcher, config, {
      model: modelId,
      operation: 'text_to_model',
      prompt: ctx.prompt.trim(),
      parameters: meshParams,
    }, `${ctx.requestId}-t2m`, pollMs, {
      existingTaskId: checkpoint.baseTaskId,
      onSubmitted: async id => { checkpoint.baseTaskId = id; await saveCheckpoint(checkpointPath, checkpoint); },
    });
    baseTaskId = finalTask.taskId;
  } else if (effectiveOp === 'image_to_model') {
    if (ctx.references.length !== 1) {
      throw new Error('3d-asset image_to_model requires exactly 1 reference image asset');
    }
    const uploadId = await ensureUploadedRef();
    finalTask = await submitAndWaitTask(fetcher, config, {
      model: modelId,
      operation: 'image_to_model',
      image_asset_ids: [uploadId],
      ...(ctx.prompt.trim() ? { prompt: ctx.prompt.trim() } : {}),
      parameters: meshParams,
    }, `${ctx.requestId}-i2m`, pollMs, {
      existingTaskId: checkpoint.baseTaskId,
      onSubmitted: async id => { checkpoint.baseTaskId = id; await saveCheckpoint(checkpointPath, checkpoint); },
    });
    baseTaskId = finalTask.taskId;
  } else if (effectiveOp === 'rig_retarget' || effectiveOp === 'rig') {
    if (!baseTaskId) {
      if (ctx.references.length === 1) {
        const uploadId = await ensureUploadedRef();
        const generated = await submitAndWaitTask(fetcher, config, {
          model: modelId,
          operation: 'image_to_model',
          image_asset_ids: [uploadId],
          ...(ctx.prompt.trim() ? { prompt: ctx.prompt.trim() } : {}),
          parameters: meshParams,
        }, `${ctx.requestId}-base`, pollMs, {
          existingTaskId: checkpoint.baseTaskId,
          onSubmitted: async id => { checkpoint.baseTaskId = id; await saveCheckpoint(checkpointPath, checkpoint); },
        });
        baseTaskId = generated.taskId;
      } else if (ctx.prompt.trim()) {
        const generated = await submitAndWaitTask(fetcher, config, {
          model: modelId,
          operation: 'text_to_model',
          prompt: ctx.prompt.trim(),
          parameters: meshParams,
        }, `${ctx.requestId}-base`, pollMs, {
          existingTaskId: checkpoint.baseTaskId,
          onSubmitted: async id => { checkpoint.baseTaskId = id; await saveCheckpoint(checkpointPath, checkpoint); },
        });
        baseTaskId = generated.taskId;
      } else {
        throw new Error('3d-asset rig_retarget requires parameters.original_model_task_id, a prompt, or 1 reference image');
      }
    }
    const rigType = typeof params.rig_type === 'string' && params.rig_type.trim() ? params.rig_type.trim() : 'biped';
    const rigSpec = typeof params.spec === 'string' && params.spec.trim() ? params.spec.trim() : 'mixamo';
    const defaultRigVersion = rigType !== 'biped' || TRIPO_RIG_V3_ONLY_SPECS.has(rigSpec)
      ? TRIPO_RIG_V3_MODEL_VERSION
      : DEFAULT_RIG_MODEL_VERSION;
    const rigTask = await submitAndWaitTask(fetcher, config, {
      model: modelId,
      operation: 'rig',
      parameters: {
        original_model_task_id: baseTaskId,
        model_version: typeof params.model_version === 'string' && params.model_version.trim()
          ? params.model_version.trim()
          : defaultRigVersion,
        rig_type: rigType,
        spec: rigSpec,
        out_format: 'glb',
      },
    }, `${ctx.requestId}-rig`, pollMs, {
      existingTaskId: checkpoint.rigTaskId,
      onSubmitted: async id => { checkpoint.rigTaskId = id; await saveCheckpoint(checkpointPath, checkpoint); },
    });
    rigTaskId = rigTask.taskId;
    if (effectiveOp === 'rig_retarget' && hasRetargetAnimation) {
      retargetRan = true;
      finalTask = await submitAndWaitTask(fetcher, config, {
        model: modelId,
        operation: 'retarget',
        parameters: {
          original_model_task_id: rigTaskId,
          ...(animationsList.length > 0 ? { animations: animationsList } : { animation }),
          out_format: 'glb',
          animate_in_place: params.animate_in_place !== undefined ? Boolean(params.animate_in_place) : true,
        },
      }, `${ctx.requestId}-retarget`, pollMs, {
        existingTaskId: checkpoint.retargetTaskId,
        onSubmitted: async id => { checkpoint.retargetTaskId = id; await saveCheckpoint(checkpointPath, checkpoint); },
      });
    } else {
      finalTask = rigTask;
    }
  } else if (TRIPO_TASK_CHAIN_OPERATIONS.has(effectiveOp)) {
    if (!originalTaskIdParam) {
      throw new Error(`3d-asset operation=${effectiveOp} requires parameters.original_model_task_id`);
    }
    const passthrough: Record<string, unknown> = { ...params };
    delete passthrough.model;
    delete passthrough.operation;
    delete passthrough.slim;
    delete passthrough.max_texture_size;
    delete passthrough.jpeg_quality;
    delete passthrough.quad;
    if (effectiveOp === 'retarget' || effectiveOp === 'convert') {
      passthrough.out_format ??= 'glb';
    }
    if (effectiveOp === 'retarget') {
      if (!hasRetargetAnimation) {
        throw new Error(
          '3d-asset operation=retarget requires an animation (pass parameters.animation="preset:idle" or parameters.animations=["preset:idle","preset:run","preset:slash"], or options.rigPreset)',
        );
      }
      retargetRan = true;
      // Tripo v3 treats `animation` and `animations` as mutually exclusive; normalize and send only one.
      if (animationsList.length > 0) {
        passthrough.animations = animationsList;
        delete passthrough.animation;
      } else if (animation) {
        passthrough.animation = animation;
        delete passthrough.animations;
      }
    }
    finalTask = await submitAndWaitTask(fetcher, config, {
      model: modelId,
      operation: effectiveOp,
      ...(ctx.prompt.trim() ? { prompt: ctx.prompt.trim() } : {}),
      parameters: passthrough,
    }, `${ctx.requestId}-${effectiveOp}`, pollMs, {
      existingTaskId: checkpoint.retargetTaskId,
      onSubmitted: async id => { checkpoint.retargetTaskId = id; await saveCheckpoint(checkpointPath, checkpoint); },
    });
  } else if (TRIPO_MEDIA_PASSTHROUGH_OPERATIONS.has(effectiveOp) || effectiveOp.startsWith('/v3/')) {
    const passthrough: Record<string, unknown> = { ...params };
    delete passthrough.model;
    delete passthrough.operation;
    delete passthrough.slim;
    delete passthrough.max_texture_size;
    delete passthrough.jpeg_quality;
    delete passthrough.quad;
    let uploadedIds: string[] | undefined = checkpoint.uploadAssetIds;
    if (!uploadedIds && ctx.references.length > 0) {
      uploadedIds = [];
      for (const [idx, ref] of ctx.references.entries()) {
        const uploadId = await uploadReferenceImage(fetcher, config, ref.filename, `${ctx.requestId}-ref-${idx}`);
        uploadedIds.push(uploadId);
      }
      checkpoint.uploadAssetIds = uploadedIds;
      await saveCheckpoint(checkpointPath, checkpoint);
    }
    finalTask = await submitAndWaitTask(fetcher, config, {
      model: modelId,
      operation: effectiveOp,
      ...(ctx.prompt.trim() ? { prompt: ctx.prompt.trim() } : {}),
      ...(uploadedIds?.length ? { image_asset_ids: uploadedIds } : {}),
      ...(Object.keys(passthrough).length ? { parameters: passthrough } : {}),
    }, `${ctx.requestId}-${effectiveOp.replace(/[^a-zA-Z0-9_-]/g, '_')}`, pollMs, {
      existingTaskId: checkpoint.baseTaskId,
      onSubmitted: async id => { checkpoint.baseTaskId = id; await saveCheckpoint(checkpointPath, checkpoint); },
    });
    baseTaskId = finalTask.taskId;
  } else {
    throw new Error(`Unsupported 3d-asset operation: ${effectiveOp}`);
  }

  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'openmotion-3d-'));
  const cleanup = async () => {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  };
  const onCommitted = async () => {
    await rm(checkpointPath, { force: true }).catch(() => {});
  };
  try {
    const rawPath = path.join(tempDir, 'raw.glb');
    const slimPath = path.join(tempDir, 'slim.glb');
    const artifact = selectGlbArtifact(finalTask.artifacts);
    const rawBytes = await downloadArtifact(fetcher, config, artifact, rawPath);

    const shouldSlim = params.slim !== false;
    const finalGlb = shouldSlim
      ? await maybeOptimizeGlb(rawPath, slimPath)
      : { file: rawPath, slimmed: false, bytes: rawBytes, convertedImages: 0, savedBytes: 0 };

    const glbInfo = inspectGlb(await readFile(finalGlb.file));
    return {
      sourcePath: finalGlb.file,
      name: ctx.prompt.trim() ? ctx.prompt.trim().slice(0, 80) : `3D Asset (${effectiveOp})`,
      cleanup,
      onCommitted,
      result: {
        provider: config.provider,
        model: modelId,
        operation: effectiveOp,
        taskId: finalTask.taskId,
        ...(baseTaskId && baseTaskId !== finalTask.taskId ? { baseTaskId } : {}),
        ...(rigTaskId ? { rigTaskId } : {}),
        ...(retargetRan && animation ? { animation } : {}),
        ...(retargetRan && animationsList.length > 0 ? { requestedAnimations: animationsList } : {}),
        faceLimit,
        rawBytes,
        bytes: finalGlb.bytes,
        slimmed: finalGlb.slimmed,
        ...(finalGlb.slimmed ? { convertedImages: finalGlb.convertedImages, savedBytes: finalGlb.savedBytes } : {}),
        triangles: glbInfo.triangleCount,
        meshes: glbInfo.meshes.length,
        skins: glbInfo.skins.length,
        ...(glbInfo.boneNames?.length ? { boneNames: glbInfo.boneNames } : {}),
        animations: glbInfo.animations.length,
        animationNames: glbInfo.animations.map((a: { name: string }) => a.name),
      },
    };
  } catch (error) {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

function isGlbArtifactDescriptor(artifact: TripoArtifact): boolean {
  const name = (artifact.name ?? '').toLowerCase();
  const format = (artifact.format ?? '').toLowerCase();
  const contentType = (artifact.content_type ?? '').toLowerCase();
  const contentPath = (artifact.content_path ?? '').toLowerCase();
  return name === 'model'
    || name === 'collidermesh'
    || name === 'mesh'
    || name.endsWith('.glb')
    || format === 'glb'
    || contentType === 'model/gltf-binary'
    || contentPath.includes('artifact=model')
    || contentPath.includes('artifact=collidermesh')
    || contentPath.includes('artifact=mesh')
    || contentPath.endsWith('.glb');
}

function isMediaArtifactDescriptor(artifact: TripoArtifact): boolean {
  const name = (artifact.name ?? '').toLowerCase();
  const format = (artifact.format ?? '').toLowerCase();
  const contentType = (artifact.content_type ?? '').toLowerCase();
  const contentPath = (artifact.content_path ?? '').toLowerCase();
  return contentType.startsWith('image/')
    || contentType.startsWith('video/')
    || ['png', 'jpg', 'jpeg', 'webp', 'gif', 'mp4', 'webm'].includes(format)
    || /\.(png|jpe?g|webp|gif|mp4|webm)(?:$|\?)/i.test(contentPath)
    || /\.(png|jpe?g|webp|gif|mp4|webm)$/i.test(name)
    || /(?:^|[_-])(image|frame|preview|render|rgb)(?:$|[_-])/i.test(name)
    || name.includes('_image');
}

function selectWorldArtifact(artifacts: TripoArtifact[], preferredName?: string): TripoArtifact {
  const downloadable = artifacts.filter(a => Boolean(a.content_path || a.url));
  if (downloadable.length === 0) {
    throw new Error(`3D world task completed without a downloadable artifact: ${JSON.stringify(artifacts).slice(0, 300)}`);
  }
  if (preferredName) {
    const exact = downloadable.find(a => a.name === preferredName);
    if (!exact) {
      const availableNames = downloadable.map(a => a.name || a.content_path || 'unnamed').join(', ');
      throw new Error(`3D world artifact "${preferredName}" was not returned by the task (available: ${availableNames})`);
    }
    return exact;
  }
  return downloadable.find(isGlbArtifactDescriptor)
    ?? downloadable.find(isMediaArtifactDescriptor)
    ?? downloadable[0];
}

type DetectedArtifactFormat = {
  kind: 'glb' | 'image' | 'video' | 'unknown';
  extension: string;
  mimeType: string;
};

function detectDownloadedArtifactFormat(
  buffer: Buffer,
  contentTypeHeader: string | null,
  artifact: TripoArtifact,
): DetectedArtifactFormat {
  if (buffer.length >= 20 && buffer.readUInt32LE(0) === 0x46546c67) {
    return { kind: 'glb', extension: 'glb', mimeType: 'model/gltf-binary' };
  }
  if (buffer.length >= 8
    && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47
    && buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a) {
    return { kind: 'image', extension: 'png', mimeType: 'image/png' };
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { kind: 'image', extension: 'jpg', mimeType: 'image/jpeg' };
  }
  if (buffer.length >= 12
    && buffer.toString('ascii', 0, 4) === 'RIFF'
    && buffer.toString('ascii', 8, 12) === 'WEBP') {
    return { kind: 'image', extension: 'webp', mimeType: 'image/webp' };
  }
  if (buffer.length >= 6 && (buffer.toString('ascii', 0, 6) === 'GIF87a' || buffer.toString('ascii', 0, 6) === 'GIF89a')) {
    return { kind: 'image', extension: 'gif', mimeType: 'image/gif' };
  }
  if (buffer.length >= 12 && buffer.toString('ascii', 4, 8) === 'ftyp') {
    const brand = buffer.toString('ascii', 8, 12).trim();
    if (/^avi[fs]$/.test(brand)) return { kind: 'image', extension: 'avif', mimeType: 'image/avif' };
    return { kind: 'video', extension: 'mp4', mimeType: 'video/mp4' };
  }
  if (buffer.length >= 4 && buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) {
    return { kind: 'video', extension: 'webm', mimeType: 'video/webm' };
  }
  const declaredMime = (contentTypeHeader?.split(';')[0] ?? artifact.content_type ?? '').trim().toLowerCase();
  const declaredExt = (artifact.format ?? '').trim().toLowerCase().replace(/^\./, '');
  return {
    kind: 'unknown',
    extension: declaredExt || 'bin',
    mimeType: declaredMime || 'application/octet-stream',
  };
}

async function downloadRawArtifact(
  fetcher: Fetcher,
  config: Resolved3dEndpoint,
  artifact: TripoArtifact,
): Promise<{ buffer: Buffer; contentType: string | null }> {
  const target = resolveArtifactDownloadTarget(config, artifact);
  const controller = new AbortController();
  return retryRead(async () => {
    const res = await fetcher(target.url, {
      headers: target.headers,
      redirect: 'error',
      signal: AbortSignal.timeout(90_000),
    });
    if (!res.ok) {
      throw new ProviderError(`Failed to download 3D world artifact: HTTP ${res.status}`, res.status);
    }
    const buffer = await readBoundedResponseBuffer(res, MAX_SPATIAL_DOWNLOAD_BYTES);
    return { buffer, contentType: res.headers.get('content-type') };
  }, controller.signal, 3);
}

export async function runOpenDesignWorldScript(ctx: CapabilityScriptContext): Promise<CapabilityScriptOutput> {
  const params = ctx.parameters ?? {};
  const requestedRaw = ctx.model || (typeof params.model === 'string' ? params.model : undefined);
  const requested = parseProviderModel(requestedRaw);
  const config = await resolveSpatialEndpoint(ctx.store, 'world', false, requested.provider);
  if (!config) {
    throw new Error(
      requested.provider
        ? `CAPABILITY_UNAVAILABLE: Provider ${requested.provider} has no active 3D world model`
        : 'CAPABILITY_UNAVAILABLE: No active 3D world model (e.g. worldlabs-atlas) is exposed on your configured OpenDesign account or Cloud gateway.',
    );
  }
  if (requested.modelId && !config.models.some(m => m.modelId === requested.modelId)) {
    throw new Error(`CAPABILITY_MODEL_INCOMPATIBLE: Model ${requestedRaw} is not available on provider ${config.provider}`);
  }
  const gateway = gatewayFor(ctx.store);
  const fetcher = resolveFetcher(ctx.store);
  const pollMs = gateway.options.pollMs ?? POLL_INTERVAL_MS;
  const modelId = requested.modelId
    ?? config.models.find(m => m.modelId === DEFAULT_WORLD_MODEL)?.modelId
    ?? config.models[0]?.modelId
    ?? DEFAULT_WORLD_MODEL;

  const rawParamOp = typeof params.operation === 'string' && params.operation.trim() ? params.operation.trim() : undefined;
  const explicitParamOp = rawParamOp && rawParamOp !== 'auto' ? rawParamOp : undefined;
  const rawOptionOp = typeof ctx.options.operation === 'string' && ctx.options.operation.trim() ? ctx.options.operation.trim() : undefined;
  const optionOp = rawOptionOp && rawOptionOp !== 'auto' ? rawOptionOp : undefined;
  const hasAtlasGenerateInputs = Array.isArray(params.contextFrames) && params.contextFrames.length > 0
    && Array.isArray(params.targetCameras) && params.targetCameras.length > 0;

  let operation: string;
  if (explicitParamOp) {
    operation = explicitParamOp;
  } else if (optionOp) {
    operation = optionOp;
  } else if (hasAtlasGenerateInputs) {
    operation = 'atlasGenerate';
  } else if (ctx.references.length > 0 && !ctx.prompt.trim()) {
    operation = 'images2PosedRGBD';
  } else {
    operation = 'atlasTextToImage';
  }

  const preferredArtifact = typeof params.artifact === 'string' && params.artifact.trim() ? params.artifact.trim() : undefined;
  const passthrough: Record<string, unknown> = { ...params };
  delete passthrough.model;
  delete passthrough.operation;
  delete passthrough.artifact;
  delete passthrough.slim;
  delete passthrough.max_texture_size;
  delete passthrough.jpeg_quality;

  if (operation === 'atlasTextToImage') {
    if (!ctx.prompt.trim()) {
      throw new Error('3d-world operation=atlasTextToImage requires a non-empty prompt');
    }
  } else if (operation === 'atlasGenerate') {
    const contextFrames = Array.isArray(passthrough.contextFrames) ? passthrough.contextFrames : [];
    const targetCameras = Array.isArray(passthrough.targetCameras) ? passthrough.targetCameras : [];
    if (contextFrames.length === 0 || targetCameras.length === 0) {
      throw new Error(
        '3d-world operation=atlasGenerate requires non-empty parameters.contextFrames and parameters.targetCameras (for text-only scene generation use operation="atlasTextToImage")',
      );
    }
    const validFrame = contextFrames.every(frame =>
      Boolean(frame) && typeof frame === 'object' && !Array.isArray(frame)
      && Boolean((frame as Record<string, unknown>).imageAsset) && Boolean((frame as Record<string, unknown>).camera),
    );
    const validCam = targetCameras.every(cam =>
      Boolean(cam) && typeof cam === 'object' && !Array.isArray(cam)
      && Boolean((cam as Record<string, unknown>).extrinsics) && Boolean((cam as Record<string, unknown>).intrinsics),
    );
    if (!validFrame || !validCam) {
      throw new Error(
        '3d-world operation=atlasGenerate expects contextFrames items with { imageAsset, camera, depth? } and targetCameras items with { extrinsics, intrinsics } (from images2PosedRGBD or aligned RGB-D assets).',
      );
    }
  } else if (operation === 'images2PosedRGBD') {
    const hasParamImages = (Array.isArray(passthrough.image_asset_ids) && passthrough.image_asset_ids.length > 0)
      || (Array.isArray(passthrough.images) && passthrough.images.length > 0)
      || (Array.isArray(passthrough.frames) && passthrough.frames.length > 0);
    if (ctx.references.length === 0 && !hasParamImages) {
      throw new Error('3d-world operation=images2PosedRGBD requires at least 1 reference image asset');
    }
  } else if (!ctx.prompt.trim() && ctx.references.length === 0 && Object.keys(passthrough).length === 0) {
    throw new Error(`3d-world operation=${operation} requires a prompt, reference images, or native Atlas v2 parameters`);
  }

  const checkpointPath = checkpointFileFor(ctx.store, 'world', ctx.requestId);
  const checkpoint = await readCheckpoint(checkpointPath);
  const inputFingerprint = spatialInputFingerprint({
    domain: 'world',
    provider: config.provider,
    modelId,
    operation,
    prompt: ctx.prompt,
    references: ctx.references,
    options: ctx.options,
    parameters: params,
  });
  assertCheckpointMatchesInput(checkpoint, inputFingerprint, ctx.requestId);
  let imageAssetIds: string[] | undefined = checkpoint.uploadAssetIds;
  if (!imageAssetIds && ctx.references.length > 0) {
    imageAssetIds = [];
    for (const [idx, ref] of ctx.references.entries()) {
      const uploadId = await uploadReferenceImage(fetcher, config, ref.filename, `${ctx.requestId}-wref-${idx}`);
      imageAssetIds.push(uploadId);
    }
    checkpoint.uploadAssetIds = imageAssetIds;
    await saveCheckpoint(checkpointPath, checkpoint);
  }

  const task = await submitAndWaitTask(
    fetcher,
    config,
    {
      model: modelId,
      operation,
      ...(ctx.prompt.trim() ? { prompt: ctx.prompt.trim() } : {}),
      ...(imageAssetIds?.length ? { image_asset_ids: imageAssetIds } : {}),
      ...(Object.keys(passthrough).length ? { parameters: passthrough } : {}),
    },
    `${ctx.requestId}-world`,
    pollMs,
    {
      taskBasePath: '/api/v1/media/worlds/tasks',
      existingTaskId: checkpoint.worldTaskId,
      onSubmitted: async id => { checkpoint.worldTaskId = id; await saveCheckpoint(checkpointPath, checkpoint); },
    },
  );

  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'openmotion-world-'));
  const cleanup = async () => {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  };
  const onCommitted = async () => {
    await rm(checkpointPath, { force: true }).catch(() => {});
  };
  try {
    const artifact = selectWorldArtifact(task.artifacts, preferredArtifact);
    const { buffer, contentType } = await downloadRawArtifact(fetcher, config, artifact);
    const detected = detectDownloadedArtifactFormat(buffer, contentType, artifact);
    const artifactDescriptors = task.artifacts.map(a => ({
      ...(a.name ? { name: a.name } : {}),
      ...(a.format ? { format: a.format } : {}),
      ...(a.asset_id ? { asset_id: a.asset_id } : {}),
      ...(a.content_path ? { content_path: a.content_path } : {}),
    }));

    if (detected.kind === 'glb') {
      const rawPath = path.join(tempDir, 'world.glb');
      const slimPath = path.join(tempDir, 'world-slim.glb');
      await writeFile(rawPath, buffer);
      const rawBytes = buffer.length;
      const shouldSlim = params.slim !== false;
      const finalGlb = shouldSlim
        ? await maybeOptimizeGlb(rawPath, slimPath)
        : { file: rawPath, slimmed: false, bytes: rawBytes, convertedImages: 0, savedBytes: 0 };
      const glbInfo = inspectGlb(await readFile(finalGlb.file));
      return {
        sourcePath: finalGlb.file,
        name: ctx.prompt.trim() ? ctx.prompt.trim().slice(0, 80) : `3D World (${operation})`,
        cleanup,
        onCommitted,
        result: {
          provider: config.provider,
          model: modelId,
          operation,
          taskId: task.taskId,
          selectedArtifact: artifact.name ?? 'colliderMesh',
          artifactFormat: 'glb',
          mimeType: 'model/gltf-binary',
          artifacts: artifactDescriptors,
          rawBytes,
          bytes: finalGlb.bytes,
          slimmed: finalGlb.slimmed,
          ...(finalGlb.slimmed ? { convertedImages: finalGlb.convertedImages, savedBytes: finalGlb.savedBytes } : {}),
          triangles: glbInfo.triangleCount,
          meshes: glbInfo.meshes.length,
          skins: glbInfo.skins.length,
          animations: glbInfo.animations.length,
          animationNames: glbInfo.animations.map((a: { name: string }) => a.name),
        },
      };
    }

    if (detected.kind === 'image' || detected.kind === 'video') {
      const mediaPath = path.join(tempDir, `world.${detected.extension}`);
      await writeFile(mediaPath, buffer);
      return {
        sourcePath: mediaPath,
        name: ctx.prompt.trim() ? ctx.prompt.trim().slice(0, 80) : `3D World (${operation})`,
        cleanup,
        onCommitted,
        result: {
          provider: config.provider,
          model: modelId,
          operation,
          taskId: task.taskId,
          selectedArtifact: artifact.name ?? `world.${detected.extension}`,
          artifactFormat: detected.extension,
          mimeType: detected.mimeType,
          artifacts: artifactDescriptors,
          bytes: buffer.length,
        },
      };
    }

    throw new Error(
      `3D world task ${task.taskId} (${operation}) returned artifact "${artifact.name ?? 'unknown'}" (${detected.mimeType}, .${detected.extension}), which cannot be imported directly into Workspace Assets. Run operation="splats2Mesh" for a polygonal .glb mesh or select an image/mesh artifact via parameters.artifact. Returned artifacts: ${JSON.stringify(artifactDescriptors).slice(0, 300)}`,
    );
  } catch (error) {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}
