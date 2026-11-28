/**
 * Native Meshy API client for the `3d-asset` capability.
 *
 * Meshy is reached directly with the user's own key (`MESHY_API_KEY`), not through the
 * OpenDesign media gateway. Protocol reference: https://docs.meshy.ai/en/api
 * (Text to 3D v2 preview/refine, Image to 3D, Multi-Image to 3D, Rigging, Animation).
 *
 * This module owns only the Meshy wire protocol: environment configuration, request
 * payloads, task submission/polling, animation id resolution and GLB URL selection.
 * Orchestration, checkpoints, download, texture slimming and asset inspection stay in
 * `opendesign-3d.ts` so every 3D provider shares the same output contract.
 */
import { existsSync, readFileSync } from 'node:fs';
import type { CapabilityScriptStage, CapabilityScriptTelemetryMeta } from './capability-scripts.ts';
import { ProviderError, retryRead, withErrorMeta, type Fetcher } from './network.ts';
import type { Cloud3dModelEntry } from './opendesign.ts';

export const MESHY_PROVIDER = 'meshy';
export const MESHY_DEFAULT_BASE_URL = 'https://api.meshy.ai';
export const DEFAULT_MESHY_MODEL = 'meshy-7.1';
const DEFAULT_MESHY_TASK_TIMEOUT_MS = 600_000;
const MESHY_REQUEST_TIMEOUT_MS = 30_000;
/** Meshy rejects rigging inputs above 380,000 triangles; keep generated meshes well below it. */
const MESHY_MAX_TARGET_POLYCOUNT = 300_000;

export const meshyModels: Cloud3dModelEntry[] = [
  {
    modelId: 'meshy-7.1',
    label: 'Meshy 7.1 (GLB + PBR + optional rig/animation)',
    tier: 'flagship',
    bestFor: ['3d-mesh', 'text-to-3d', 'image-to-3d', 'multiview-to-3d', 'humanoid-rig'],
    description: 'Generate PBR textured .glb meshes from text, 1 reference image or 2–4 multi-angle images, with optional Meshy auto-rigging and animation library clips.',
  },
  {
    modelId: 'meshy-6',
    label: 'Meshy 6',
    tier: 'balanced',
    bestFor: ['3d-mesh', 'text-to-3d', 'image-to-3d', 'multiview-to-3d'],
    description: 'Previous-generation Meshy model for textured .glb meshes.',
  },
  {
    modelId: 'meshy-6-lite',
    label: 'Meshy 6 Lite',
    tier: 'fast',
    bestFor: ['3d-mesh', 'text-to-3d', 'image-to-3d', 'multiview-to-3d', 'low-poly-prop'],
    description: 'Fast, low-cost Meshy model for props and drafts.',
  },
];

export type MeshyEnvConfig = { baseUrl: string; apiKey: string; taskTimeoutMs: number };

/**
 * Read Meshy credentials from the environment. `MESHY_API_KEY` (or a file named by
 * `MESHY_API_KEY_FILE`) enables the provider; `OPENMOTION_MESHY_ENABLED=0` disables it;
 * `MESHY_BASE_URL` overrides the API origin and `MESHY_TASK_TIMEOUT_MS` the per-task deadline.
 */
export function readMeshyEnvConfig(env: NodeJS.ProcessEnv = process.env): MeshyEnvConfig | undefined {
  if (env.OPENMOTION_MESHY_ENABLED === '0' || env.OPENMOTION_MESHY_ENABLED === 'false') return undefined;
  let apiKey = env.MESHY_API_KEY?.trim();
  const keyFile = env.MESHY_API_KEY_FILE?.trim();
  if (!apiKey && keyFile && existsSync(keyFile)) {
    try {
      apiKey = readFileSync(keyFile, 'utf8').trim() || undefined;
    } catch {
      apiKey = undefined;
    }
  }
  if (!apiKey) return undefined;
  const baseUrl = (env.MESHY_BASE_URL?.trim() || MESHY_DEFAULT_BASE_URL).replace(/\/+$/, '');
  const rawTimeout = Number(env.MESHY_TASK_TIMEOUT_MS);
  const taskTimeoutMs = Number.isFinite(rawTimeout) && rawTimeout >= 30_000 ? rawTimeout : DEFAULT_MESHY_TASK_TIMEOUT_MS;
  return { baseUrl, apiKey, taskTimeoutMs };
}

export type MeshyClient = {
  fetcher: Fetcher;
  baseUrl: string;
  apiKey: string;
  taskTimeoutMs: number;
  pollMs: number;
  report?: (stage: CapabilityScriptStage, meta?: CapabilityScriptTelemetryMeta) => void;
};

export type MeshyTaskKind = 'text-to-3d' | 'image-to-3d' | 'multi-image-to-3d' | 'rigging' | 'animations';

const TASK_PATHS: Record<MeshyTaskKind, string> = {
  'text-to-3d': '/openapi/v2/text-to-3d',
  'image-to-3d': '/openapi/v1/image-to-3d',
  'multi-image-to-3d': '/openapi/v1/multi-image-to-3d',
  rigging: '/openapi/v1/rigging',
  animations: '/openapi/v1/animations',
};

export type MeshyTask = {
  id: string;
  status: string;
  model_urls?: Record<string, string>;
  result?: Record<string, unknown>;
  task_error?: { type?: string; message?: string; code?: string } | null;
  [key: string]: unknown;
};

async function meshyJson<T = any>(client: MeshyClient, endpoint: string, init: RequestInit = {}): Promise<T> {
  const res = await client.fetcher(`${client.baseUrl}${endpoint}`, {
    ...init,
    redirect: 'error',
    headers: {
      Authorization: `Bearer ${client.apiKey}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(MESHY_REQUEST_TIMEOUT_MS),
  });
  const text = await res.text();
  let parsed: any;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = {};
  }
  if (!res.ok) {
    // Meshy error bodies are `{ "message": "..." }`; keep them short and never echo request input.
    const detail = typeof parsed?.message === 'string' ? parsed.message.slice(0, 300) : `HTTP ${res.status}`;
    const hint = res.status === 401 ? ' (check MESHY_API_KEY)'
      : res.status === 402 ? ' (Meshy credits exhausted or plan does not include API access)'
        : '';
    throw new ProviderError(`Meshy HTTP ${res.status} on ${endpoint}: ${detail}${hint}`, res.status, undefined, 'api');
  }
  return parsed as T;
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Submit one Meshy task (unless `existingTaskId` resumes it) and poll until it reaches a terminal state.
 * Meshy documents no idempotency header, so callers persist the task id via `onSubmitted` before polling
 * and resume with `existingTaskId` instead of submitting again.
 */
export async function submitAndWaitMeshyTask(
  client: MeshyClient,
  kind: MeshyTaskKind,
  body: Record<string, unknown>,
  options: {
    existingTaskId?: string;
    onSubmitted?: (taskId: string) => Promise<void>;
    telemetry?: CapabilityScriptTelemetryMeta;
  } = {},
): Promise<MeshyTask> {
  const basePath = TASK_PATHS[kind];
  const meta = options.telemetry ?? {};
  let taskId = options.existingTaskId;
  if (!taskId) {
    client.report?.('submitting', meta);
    const submitted = await meshyJson<any>(client, basePath, { method: 'POST', body: JSON.stringify(body) });
    taskId = typeof submitted?.result === 'string' ? submitted.result : '';
    if (!taskId) {
      throw new Error(`Meshy ${kind} submit returned no task id`);
    }
    await options.onSubmitted?.(taskId);
  }

  client.report?.('polling', { ...meta, remoteId: taskId });
  const deadline = Date.now() + client.taskTimeoutMs;
  const controller = new AbortController();
  while (Date.now() < deadline) {
    const task = await retryRead(
      () => meshyJson<MeshyTask>(client, `${basePath}/${encodeURIComponent(taskId)}`),
      controller.signal,
      4,
      async () => { client.report?.('reconnecting', { ...meta, remoteId: taskId }); },
      async () => { client.report?.('polling', { ...meta, remoteId: taskId }); },
    );
    const status = String(task?.status ?? '').toUpperCase();
    if (status === 'SUCCEEDED') return { ...task, id: String(task.id ?? taskId), status };
    if (status === 'FAILED' || status === 'CANCELED') {
      const message = task?.task_error?.message || status.toLowerCase();
      const code = typeof task?.task_error?.code === 'string' ? task.task_error.code : undefined;
      client.report?.('remote_failed', { ...meta, remoteId: taskId, remoteTerminal: true });
      throw withErrorMeta(
        new Error(`Meshy ${kind} task ${taskId} ${status.toLowerCase()}: ${String(message)}`),
        { ...(code ? { upstreamCode: code } : {}), errorSource: 'api' },
      );
    }
    await sleep(client.pollMs);
  }
  throw new Error(`Meshy ${kind} task ${taskId} timed out after ${Math.round(client.taskTimeoutMs / 1000)}s`);
}

/** Pick the downloadable GLB URL from a succeeded Meshy task of any kind. */
export function meshyGlbUrl(task: MeshyTask, kind: MeshyTaskKind): string {
  const result = (task.result && typeof task.result === 'object' ? task.result : {}) as Record<string, unknown>;
  const candidates: unknown[] = kind === 'rigging'
    ? [result.rigged_character_glb_url, task.rigged_character_glb_url]
    : kind === 'animations'
      ? [result.animation_glb_url, task.animation_glb_url]
      : [task.model_urls?.glb];
  const url = candidates.find((value): value is string => typeof value === 'string' && value.trim().length > 0);
  if (!url) {
    throw new Error(`Meshy ${kind} task ${task.id} succeeded without a GLB download URL`);
  }
  return url.trim();
}

/** Build the mesh parameters shared by Text to 3D preview, Image to 3D and Multi-Image to 3D. */
export function meshyMeshParameters(
  params: Record<string, unknown>,
  faceLimit: number,
): Record<string, unknown> {
  const rawPolycount = Number(params.target_polycount ?? faceLimit);
  const targetPolycount = Number.isFinite(rawPolycount)
    ? Math.max(100, Math.min(MESHY_MAX_TARGET_POLYCOUNT, Math.round(rawPolycount)))
    : faceLimit;
  const mesh: Record<string, unknown> = {
    should_remesh: params.should_remesh !== undefined ? Boolean(params.should_remesh) : true,
    // Quad topology is valid on Meshy, but the game runtime and rig limits are computed for triangles.
    topology: params.topology === 'quad' ? 'quad' : 'triangle',
    target_polycount: targetPolycount,
    target_formats: ['glb'],
  };
  for (const key of ['pose_mode', 'geometry_resolution', 'decimation_mode', 'moderation', 'auto_size', 'origin_at']) {
    if (params[key] !== undefined) mesh[key] = params[key];
  }
  return mesh;
}

/** Texture parameters shared by Text to 3D refine, Image to 3D and Multi-Image to 3D. */
export function meshyTextureParameters(params: Record<string, unknown>): Record<string, unknown> {
  const texture: Record<string, unknown> = {
    enable_pbr: params.pbr !== undefined ? Boolean(params.pbr) : true,
  };
  for (const key of ['texture_prompt', 'texture_image_url', 'texture_resolution', 'remove_lighting']) {
    if (params[key] !== undefined) texture[key] = params[key];
  }
  return texture;
}

/**
 * Verified Meshy animation library ids for the shared rig presets. Everything else is resolved
 * by name through the free `GET /openapi/v1/animations/library?search=` endpoint at run time.
 */
const MESHY_BIPED_ACTION_IDS: Record<string, number> = {
  idle: 0,
  walk: 30,
  run: 14,
  slash: 97,
  attack: 4,
};

function presetShortName(raw: string): string {
  const lower = raw.trim().toLowerCase();
  const withoutPreset = lower.startsWith('preset:') ? lower.slice('preset:'.length) : lower;
  return withoutPreset.startsWith('mixamo-') ? withoutPreset.slice('mixamo-'.length) : withoutPreset;
}

/**
 * Resolve requested animations to Meshy action ids. Accepts numeric ids, shared presets
 * (`preset:idle`, `mixamo-run`, `walk`) and free-text library names (`Left_Slash`).
 */
export async function resolveMeshyActionIds(
  client: MeshyClient,
  requested: readonly (string | number)[],
  rigType: 'biped' | 'quadruped' = 'biped',
): Promise<{ actionIds: number[]; labels: string[] }> {
  const actionIds: number[] = [];
  const labels: string[] = [];
  for (const entry of requested) {
    if (typeof entry === 'number' || /^\d+$/.test(String(entry).trim())) {
      const id = Number(entry);
      if (!actionIds.includes(id)) { actionIds.push(id); labels.push(String(id)); }
      continue;
    }
    const name = presetShortName(String(entry));
    if (!name) continue;
    let id = rigType === 'biped' ? MESHY_BIPED_ACTION_IDS[name] : undefined;
    let label = name;
    if (id === undefined) {
      const library = await meshyJson<any>(client, `/openapi/v1/animations/library?search=${encodeURIComponent(name)}`);
      const items: any[] = Array.isArray(library) ? library : Array.isArray(library?.result) ? library.result : Array.isArray(library?.items) ? library.items : [];
      const match = items.find(item => typeof item?.action_id === 'number' && (!item.rig_type || String(item.rig_type).toLowerCase() === rigType));
      if (!match) {
        throw new Error(`Meshy animation "${String(entry)}" was not found in the Meshy animation library for ${rigType} rigs; pass a numeric parameters.action_ids entry from https://docs.meshy.ai/en/api/animation-library`);
      }
      id = match.action_id as number;
      label = typeof match.name === 'string' ? match.name : name;
    }
    if (!actionIds.includes(id)) { actionIds.push(id); labels.push(label); }
  }
  if (actionIds.length > 10) {
    throw new Error(`Meshy animation requests accept at most 10 actions (got ${actionIds.length})`);
  }
  return { actionIds, labels };
}
