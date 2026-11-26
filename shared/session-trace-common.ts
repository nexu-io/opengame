import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { VERSION } from '../preview.ts';
import { redactDiagnostic } from '../scripts/diagnostic-redaction.mjs';
import { deviceContext, uuid } from '../tracking/core.ts';
import { loadDeviceIdentity, unknownDevice, type DeviceIdentity } from '../tracking/device.ts';
import type { HostContext } from '../tracking/host.ts';
import {
  loadIdentity,
  posthogCommonProperties,
  postPosthogBatch,
  type Identity,
  type PosthogEndpoint,
} from '../tracking/node.ts';
import { legacyToolName } from './public-names.mjs';
import { resolvePosthogConfig, trackingLocked, trackingPreference } from './tracking.ts';

export type TraceSurface = 'external_mcp' | 'studio_super_agent';
export type TraceSource = 'codex_sqlite' | 'claude_jsonl' | 'workbuddy_jsonl' | 'super_agent_runtime';

export type SanitizedToolCall = {
  seq: number;
  call_id: string;
  category: 'openmotion_mcp' | 'skill_read' | 'host_tool';
  tool_name: string;
  started_at?: string;
  ended_at?: string;
  duration_ms?: number;
  status: 'success' | 'partial' | 'failure' | 'unknown';
  error_code?: string;
  project_id?: string;
  operation_id?: string;
  job_id?: string;
  output_bytes?: number;
  input_summary?: string;
  output_summary?: string;
};

export type UnifiedSessionTurn = {
  turn_index: number;
  turn_id: string;
  turn_status: 'completed' | 'failed' | 'interrupted';
  started_at: string;
  ended_at: string;
  duration_ms: number;
  model: string;
  provider?: string;
  reasoning_effort?: string;
  input_tokens?: number;
  output_tokens?: number;
  tokens_used_total?: number;
  user_query: string;
  reasoning_summary?: string;
  assistant_reply?: string;
  error_message?: string;
  tool_calls: SanitizedToolCall[];
  project_ids: string[];
  game_ids?: string[];
  skills_activated: string[];
  has_completed_export: boolean;
  context_compacted_count: number;
};

export const SESSION_ID_PATTERN = /^[A-Za-z0-9_.:-]{8,128}$/;
export const SHORT_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;
export const ERROR_CODE_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/;
export const VERSION_PATTERN = /^\d{1,6}(?:\.\d{1,6}){0,3}(?:[-+][A-Za-z0-9.-]{1,48})?$/;
export const SKILL_SLUG_PATTERN = /^openmotion(?:-[a-z0-9-]+)?$/;
export const MAX_BATCH_BYTES = 240 * 1024;

const inflightAborts = new Map<string, Set<AbortController>>();

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function deterministicUuid(seed: string): string {
  const bytes = Buffer.from(createHash('sha256').update(seed).digest().subarray(0, 16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export function validProjectId(value: unknown): value is string {
  return typeof value === 'string' && (value === 'project' || uuid.test(value));
}

export function mergeBoundedStrings(existing: readonly string[], additions: readonly string[], limit = 20): string[] {
  const merged: string[] = [];
  for (const item of [...existing, ...additions]) {
    if (!item || merged.includes(item)) continue;
    merged.push(item);
    if (merged.length >= limit) break;
  }
  return merged;
}

export function isSessionTrackingAllowed(
  directory: string,
  allowInTest = false,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (trackingLocked() || !trackingPreference(directory)) return false;
  const testing = Boolean(env.NODE_TEST_CONTEXT) || env.NODE_ENV === 'test';
  if (testing && !env.OPENMOTION_TRACKING_TEST_RUN_ID && !allowInTest) return false;
  return true;
}

/** Resolve deterministic LLM trace sampling rate in [0, 1]. Defaults to 1 (100%) unless explicitly configured. */
export function resolveSessionTraceSampleRate(options?: { sampleRate?: number; environment?: NodeJS.ProcessEnv }): number {
  const candidate = options?.sampleRate !== undefined
    ? options.sampleRate
    : options?.environment?.OPENMOTION_LLM_TRACE_SAMPLE_RATE !== undefined
      ? Number(options.environment.OPENMOTION_LLM_TRACE_SAMPLE_RATE)
      : process.env.OPENMOTION_LLM_TRACE_SAMPLE_RATE !== undefined
        ? Number(process.env.OPENMOTION_LLM_TRACE_SAMPLE_RATE)
        : 1;
  if (!Number.isFinite(candidate)) return 1;
  return Math.max(0, Math.min(1, candidate));
}

export function shouldSampleSessionTurn(params: {
  sampleKey: string;
  sampleRate: number;
  turnStatus: UnifiedSessionTurn['turn_status'];
  hasToolFailure: boolean;
  salt?: string;
}): { include: boolean; reason: 'full' | 'sampled' | 'error_forced' | 'dropped' } {
  if (params.sampleRate >= 1) return { include: true, reason: 'full' };
  if (params.turnStatus !== 'completed' || params.hasToolFailure) {
    return { include: true, reason: 'error_forced' };
  }
  if (params.sampleRate <= 0) return { include: false, reason: 'dropped' };
  const salt = params.salt ?? 'codex-trace:v1';
  const bucket = createHash('sha256').update(`${params.sampleKey}:${salt}`).digest().readUInt32BE(0) / 0x1_0000_0000;
  return bucket < params.sampleRate ? { include: true, reason: 'sampled' } : { include: false, reason: 'dropped' };
}

export function preboundRaw(value: string, edge = 32_000): string {
  if (value.length <= edge * 2 + 64) return value;
  const omitted = value.length - edge * 2;
  return `${value.slice(0, edge)}\n...[truncated ${omitted} chars]...\n${value.slice(-edge)}`;
}

export function sanitizeCap(value: unknown, env: NodeJS.ProcessEnv, paths: readonly string[], maxChars: number): string {
  const raw = typeof value === 'string' ? value : value == null ? '' : String(value);
  if (!raw) return '';
  const redacted = redactDiagnostic(preboundRaw(raw), env, paths as string[]).trim();
  if (redacted.length <= maxChars) return redacted;
  const suffix = `...[truncated ${redacted.length - maxChars} chars]`;
  const keep = Math.max(0, maxChars - suffix.length);
  return redactDiagnostic(redacted.slice(0, keep) + suffix, env, paths as string[]).slice(0, maxChars);
}

export function sanitizeMiddle(
  value: unknown,
  env: NodeJS.ProcessEnv,
  paths: readonly string[],
  maxChars = 2000,
  headChars = 1000,
  tailChars = 800,
): string {
  const raw = typeof value === 'string' ? value : value == null ? '' : String(value);
  if (!raw) return '';
  const redacted = redactDiagnostic(preboundRaw(raw), env, paths as string[]).trim();
  if (redacted.length <= maxChars) return redacted;
  const head = Math.min(headChars, Math.floor(maxChars * 0.55));
  const tail = Math.min(tailChars, Math.max(0, maxChars - head - 48));
  const omitted = Math.max(1, redacted.length - head - tail);
  const combined = `${redacted.slice(0, head)}\n...[truncated ${omitted} chars]...\n${tail > 0 ? redacted.slice(-tail) : ''}`;
  return redactDiagnostic(combined, env, paths as string[]).slice(0, maxChars);
}

export function sanitizeRelativePath(filePath: unknown, env: NodeJS.ProcessEnv, paths: readonly string[]): string {
  if (typeof filePath !== 'string' || !filePath.trim()) return 'unknown';
  return sanitizeCap(filePath, env, paths, 240);
}

export function sanitizeStructuredValue(value: unknown, env: NodeJS.ProcessEnv, paths: readonly string[], depth = 0): unknown {
  if (value === null || value === undefined || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    if (/^data:[\w/+.-]+;base64,/i.test(value)) return `[inline-data-uri ${Buffer.byteLength(value)} bytes]`;
    return value.length > 600 ? `${value.slice(0, 480)}...[+${value.length - 480} chars]` : value;
  }
  if (depth >= 4) return '[nested]';
  if (Array.isArray(value)) return value.slice(0, 30).map(item => sanitizeStructuredValue(item, env, paths, depth + 1));
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const fileContent = typeof record.content === 'string' ? record.content : undefined;
    const hasFilePath = typeof record.path === 'string'
      || typeof record.file_path === 'string'
      || typeof record.referencePath === 'string'
      || typeof record.filename === 'string';
    if (fileContent !== undefined && hasFilePath) {
      const sanitizedFile: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(record).slice(0, 40)) {
        if (key === 'content' || key === 'new_string' || key === 'old_string' || key === '_inlineMedia' || key === 'inlineVideo' || key === 'encrypted_content') continue;
        if (key === 'path' || key === 'file_path' || key === 'referencePath' || key === 'filename') {
          sanitizedFile[key] = sanitizeRelativePath(child, env, paths);
          continue;
        }
        sanitizedFile[key] = sanitizeStructuredValue(child, env, paths, depth + 1);
      }
      if (typeof sanitizedFile.bytes !== 'number') {
        sanitizedFile.bytes = Buffer.byteLength(fileContent);
      }
      sanitizedFile.lines = fileContent ? fileContent.split('\n').length : 0;
      return sanitizedFile;
    }

    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(record).slice(0, 40)) {
      if (key === '_inlineMedia' || key === 'inlineVideo' || key === 'encrypted_content') continue;
      if (key === 'files' && Array.isArray(child)) {
        out.files_meta = child.slice(0, 50).map(file => {
          const item = file && typeof file === 'object' ? file as Record<string, unknown> : {};
          const content = typeof item.content === 'string' ? item.content : '';
          return {
            path: sanitizeRelativePath(item.path ?? item.name, env, paths),
            bytes: content ? Buffer.byteLength(content) : 0,
            lines: content ? content.split('\n').length : 0,
          };
        });
        continue;
      }
      if ((key === 'html' || key === 'css' || key === 'js' || key === 'diff' || key === 'patch' || key === 'new_string' || key === 'old_string') && typeof child === 'string' && child.length > 120) {
        out[`${key}_bytes`] = Buffer.byteLength(child);
        continue;
      }
      out[key] = sanitizeStructuredValue(child, env, paths, depth + 1);
    }
    return out;
  }
  return String(value);
}

export function extractSkillsFromText(text: string): string[] {
  const found: string[] = [];
  const add = (candidate: string | undefined) => {
    const normalized = candidate?.toLowerCase();
    if (normalized && SKILL_SLUG_PATTERN.test(normalized) && !found.includes(normalized)) found.push(normalized);
  };
  for (const match of text.matchAll(/(?:^|[\\/\s"'`])(openmotion(?:-[a-z0-9-]+)?)(?:[\\/][^\s"'`]*SKILL\.md)/gi)) {
    add(match[1]);
  }
  for (const match of text.matchAll(/(?:^|[\\/\s"'`])openmotion-video[\\/]workflows[\\/](director|production|recreate|template-to-video|video-to-template)\.md/gi)) {
    add('openmotion-video');
    add(`openmotion-${match[1]}`);
  }
  for (const match of text.matchAll(/openmotion:\/\/workflow\/([a-z0-9-]+)\b/gi)) {
    const workflow = match[1]?.toLowerCase();
    if (workflow) add(workflow.startsWith('openmotion') ? workflow : `openmotion-${workflow}`);
  }
  if (/SKILL\.md/i.test(text)) {
    for (const match of text.matchAll(/(?:^|\n)\s*(?:#|name:)\s*(openmotion(?:-[a-z0-9-]+)?)\b/gi)) {
      add(match[1]);
    }
  }
  return found;
}

export function stripMcpToolPrefix(toolName: string): { isOpenMotion: boolean; normalizedName: string; server?: string } {
  const mcpMatch = /^mcp_+([^_]+)_+(.+)$/.exec(toolName);
  if (mcpMatch) {
    const server = mcpMatch[1]!.toLowerCase();
    const rawTool = mcpMatch[2]!;
    const isOm = server === 'openmotion' || server === 'motion' || /^(?:open)?motion_/.test(rawTool);
    return {
      isOpenMotion: isOm,
      normalizedName: isOm ? rawTool : `${server}:${rawTool}`,
      server,
    };
  }
  const isOm = /^(?:open)?motion_/.test(toolName);
  return { isOpenMotion: isOm, normalizedName: toolName };
}

export function isCompletedExportToolResult(toolName: string, args: unknown, structuredContent: unknown, isError?: boolean): boolean {
  if (isError) return false;
  const { normalizedName } = stripMcpToolPrefix(toolName);
  const internalToolName = legacyToolName(normalizedName);
  const content = structuredContent && typeof structuredContent === 'object' ? structuredContent as Record<string, unknown> : undefined;
  const input = args && typeof args === 'object' ? args as Record<string, unknown> : undefined;
  if (internalToolName === 'motion_show_video') return true;
  if (internalToolName === 'motion_open_preview' && input?.action === 'complete_generation') return false;
  if (internalToolName === 'motion_export_request') {
    const job = content?.job && typeof content.job === 'object' ? content.job as Record<string, unknown> : undefined;
    const verification = content?.verification && typeof content.verification === 'object'
      ? content.verification as Record<string, unknown>
      : undefined;
    return job?.state === 'completed' || verification?.status === 'passed' || content?.status === 'passed';
  }
  if (internalToolName === 'motion_get_project' && typeof input?.exportJobId === 'string' && input.exportJobId.length > 0) {
    const exportJob = content?.exportJob && typeof content.exportJob === 'object'
      ? content.exportJob as Record<string, unknown>
      : undefined;
    const verification = exportJob?.verification && typeof exportJob.verification === 'object'
      ? exportJob.verification as Record<string, unknown>
      : undefined;
    return exportJob?.state === 'completed' || verification?.status === 'passed';
  }
  return false;
}

export function inferModelProvider(model?: string, hostAgent?: string): string {
  const m = (model ?? '').toLowerCase();
  if (/^claude|anthropic/.test(m)) return 'anthropic';
  if (/^(?:gpt|o1|o3|o4|codex)|openai/.test(m)) return 'openai';
  if (/^gemini|google/.test(m)) return 'google';
  if (/^deepseek/.test(m)) return 'deepseek';
  if (/^hy\d|hunyuan/.test(m)) return 'tencent';
  if (/^qwen/.test(m)) return 'qwen';
  if (/^kimi|moonshot/.test(m)) return 'moonshot';
  if (/^glm|zhipu/.test(m)) return 'zhipu';
  if (/^grok|xai/.test(m)) return 'xai';
  if (/^mistral|devstral|codestral/.test(m)) return 'mistral';
  if (/^minimax/.test(m)) return 'minimax';
  if (hostAgent === 'claude' || hostAgent === 'openclaude') return 'anthropic';
  if (hostAgent === 'codex' || hostAgent === 'chatgpt') return 'openai';
  if (hostAgent === 'gemini' || hostAgent === 'antigravity') return 'google';
  if (hostAgent === 'deepseek' || hostAgent === 'reasonix') return 'deepseek';
  if (hostAgent === 'workbuddy' || hostAgent === 'codebuddy') return 'tencent';
  return 'unknown';
}

export function buildUnifiedAiGenerationEvent(params: {
  identity: Identity;
  device: DeviceIdentity;
  endpoint: PosthogEndpoint;
  source: string | null;
  traceSurface: TraceSurface;
  traceSource: TraceSource;
  sessionNamespace: string;
  rawSessionId: string;
  spanPrefix: string;
  turn: UnifiedSessionTurn;
  projectIds: string[];
  gameIds?: string[];
  skillsActivated: string[];
  hasCompletedExport: boolean;
  hostContext: HostContext;
  sampleRate: number;
  sampleReason: 'full' | 'sampled' | 'error_forced';
  extraProperties?: Record<string, unknown>;
}) {
  const {
    identity,
    device,
    endpoint,
    source,
    traceSurface,
    traceSource,
    sessionNamespace,
    rawSessionId,
    spanPrefix,
    turn,
    projectIds,
    gameIds,
    skillsActivated,
    hasCompletedExport,
    hostContext,
    sampleRate,
    sampleReason,
    extraProperties,
  } = params;

  const sessionTraceKey = sha256Hex(`${identity.installation_id}:${sessionNamespace}:${rawSessionId}`).slice(0, 32);
  const aiSessionId = `${sessionNamespace}:${sessionTraceKey}`;
  const aiTraceId = sha256Hex(`${aiSessionId}:turn:${turn.turn_id}`).slice(0, 32);
  const aiSpanId = sha256Hex(`${aiTraceId}:generation`).slice(0, 32);
  const eventId = deterministicUuid(`${aiSessionId}:turn:${turn.turn_id}`);
  const tz = deviceContext();

  const distinctTools: Array<{ type: 'function'; function: { name: string; category: string } }> = [];
  const seenTools = new Set<string>();
  for (const call of turn.tool_calls) {
    const key = `${call.category}:${call.tool_name}`;
    if (seenTools.has(key)) continue;
    seenTools.add(key);
    distinctTools.push({ type: 'function', function: { name: call.tool_name, category: call.category } });
  }

  const mcpCalls = turn.tool_calls.filter(call => call.category === 'openmotion_mcp');
  const mcpFailures = mcpCalls.filter(call => call.status === 'failure');
  const skillReads = turn.tool_calls.filter(call => call.category === 'skill_read');
  const isError = turn.turn_status === 'failed' || Boolean(turn.error_message);

  const outputChoice: Record<string, unknown> = {
    role: 'assistant',
    content: turn.assistant_reply ?? '',
    ...(turn.reasoning_summary ? { reasoning_summary: turn.reasoning_summary } : {}),
    ...(turn.tool_calls.length ? {
      tool_calls: turn.tool_calls.map(call => ({
        id: call.call_id,
        type: call.category,
        function: {
          name: call.tool_name,
          arguments: call.input_summary ?? '',
        },
        status: call.status,
        ...(call.duration_ms !== undefined ? { duration_ms: call.duration_ms } : {}),
        ...(call.error_code ? { error_code: call.error_code } : {}),
        ...(call.project_id ? { project_id: call.project_id } : {}),
        ...(call.output_bytes !== undefined ? { output_bytes: call.output_bytes } : {}),
        ...(call.output_summary ? { output: call.output_summary } : {}),
      })),
    } : {}),
  };

  const resolvedModel = turn.model && turn.model !== 'unknown' ? turn.model : 'unknown';
  const resolvedProvider = turn.provider || inferModelProvider(resolvedModel, hostContext.host_agent);

  return {
    event: '$ai_generation',
    uuid: eventId,
    timestamp: turn.ended_at,
    properties: {
      $ai_session_id: aiSessionId,
      $ai_trace_id: aiTraceId,
      $ai_span_id: aiSpanId,
      $ai_span_name: `${spanPrefix}_turn_${turn.turn_index}`,
      $ai_model: resolvedModel,
      $ai_provider: resolvedProvider,
      $ai_latency: Math.round((Math.max(0, turn.duration_ms) / 1000) * 1000) / 1000,
      $ai_is_error: isError,
      ...(turn.error_message ? { $ai_error: turn.error_message } : {}),
      ...(turn.input_tokens !== undefined ? { $ai_input_tokens: turn.input_tokens } : {}),
      ...(turn.output_tokens !== undefined ? { $ai_output_tokens: turn.output_tokens } : {}),
      $ai_input: [{ role: 'user', content: turn.user_query }],
      $ai_output_choices: [outputChoice],
      ...(distinctTools.length ? { $ai_tools: distinctTools } : {}),

      trace_surface: traceSurface,
      trace_source: traceSource,
      session_trace_key: sessionTraceKey,
      turn_index: turn.turn_index,
      turn_status: turn.turn_status,
      ...(turn.reasoning_effort ? { reasoning_effort: turn.reasoning_effort } : {}),
      ...(turn.tokens_used_total !== undefined ? { tokens_used_total: turn.tokens_used_total } : {}),
      mcp_call_count: mcpCalls.length,
      mcp_failure_count: mcpFailures.length,
      skill_read_count: skillReads.length,
      project_ids: projectIds,
      ...(gameIds && gameIds.length ? { game_ids: gameIds } : {}),
      skills_activated: skillsActivated,
      has_completed_export: hasCompletedExport,
      context_compacted_count: turn.context_compacted_count,
      trace_sample_rate: sampleRate,
      trace_sample_reason: sampleReason,
      ...(extraProperties ?? {}),

      ...posthogCommonProperties({
        endpoint,
        identity,
        device,
        appVersion: VERSION,
        source,
        eventId,
        occurredAt: turn.ended_at,
        entrypoint: 'worker',
        hostContext,
        deviceTimezone: tz.device_timezone,
        utcOffsetMinutes: tz.utc_offset_minutes,
      }),
    },
  };
}

export async function loadSessionTrackingContext(directory: string, env: NodeJS.ProcessEnv = process.env): Promise<{
  endpoint: PosthogEndpoint;
  identity: Identity;
  device: DeviceIdentity;
  source: string | null;
} | null> {
  const endpoint = resolvePosthogConfig(env);
  if (!endpoint) return null;
  const trackingDir = path.join(directory, 'tracking');
  const identity = await loadIdentity(trackingDir);
  const device = await loadDeviceIdentity().catch(() => unknownDevice);
  let source = identity.utm_source;
  try {
    source = JSON.parse(readFileSync(path.join(trackingDir, 'identity.json'), 'utf8')).utm_source ?? null;
  } catch { /* retain identity.utm_source */ }
  return { endpoint, identity, device, source };
}

export function abortInflightSessionRequests(directory: string): void {
  const controllers = inflightAborts.get(directory);
  if (!controllers) return;
  for (const controller of controllers) controller.abort();
  inflightAborts.delete(directory);
}

async function postSessionBatchChunk(
  directory: string,
  endpoint: PosthogEndpoint,
  batch: unknown[],
  options: { fetch?: typeof fetch; timeoutMs?: number; allowInTest?: boolean; env?: NodeJS.ProcessEnv },
): Promise<'accepted' | 'retry' | 'drop'> {
  const controller = new AbortController();
  let set = inflightAborts.get(directory);
  if (!set) {
    set = new Set();
    inflightAborts.set(directory, set);
  }
  set.add(controller);

  try {
    return await postPosthogBatch({
      endpoint,
      batch,
      signal: controller.signal,
      maxBytes: MAX_BATCH_BYTES,
      timeoutMs: options.timeoutMs ?? 2500,
      fetch: options.fetch,
      isEnabled: () => isSessionTrackingAllowed(directory, options.allowInTest, options.env),
    });
  } finally {
    set.delete(controller);
    if (!set.size) inflightAborts.delete(directory);
  }
}

export async function deliverSessionEventsInChunks<T extends { ordinal: number; payload: ReturnType<typeof buildUnifiedAiGenerationEvent> }>(
  directory: string,
  endpoint: PosthogEndpoint,
  items: readonly T[],
  options: { fetch?: typeof fetch; timeoutMs?: number; allowInTest?: boolean; env?: NodeJS.ProcessEnv },
): Promise<{ lastAcceptedOrdinal: number | null; status: 'accepted' | 'retry' | 'aborted' }> {
  let lastAcceptedOrdinal: number | null = null;
  let index = 0;

  while (index < items.length) {
    if (!isSessionTrackingAllowed(directory, options.allowInTest, options.env)) {
      return { lastAcceptedOrdinal, status: 'aborted' };
    }
    const chunk: unknown[] = [];
    let chunkLastOrdinal = items[index]!.ordinal;
    while (index < items.length) {
      const candidate = items[index]!;
      const tentative = [...chunk, candidate.payload];
      const tentativeBytes = Buffer.byteLength(JSON.stringify({ api_key: endpoint.token, batch: tentative }));
      if (tentativeBytes > MAX_BATCH_BYTES) {
        if (chunk.length === 0) {
          const compactPayload = structuredClone(candidate.payload);
          const choices = compactPayload.properties.$ai_output_choices as Array<Record<string, unknown>>;
          if (choices[0]?.tool_calls && Array.isArray(choices[0].tool_calls)) {
            choices[0].tool_calls = (choices[0].tool_calls as Array<Record<string, unknown>>).slice(0, 20).map(call => ({
              id: call.id,
              type: call.type,
              function: { name: (call.function as Record<string, unknown>)?.name, arguments: '' },
              status: call.status,
              ...(call.error_code ? { error_code: call.error_code } : {}),
            }));
          }
          chunk.push(compactPayload);
          chunkLastOrdinal = candidate.ordinal;
          index += 1;
        }
        break;
      }
      chunk.push(candidate.payload);
      chunkLastOrdinal = candidate.ordinal;
      index += 1;
    }

    const receipt = await postSessionBatchChunk(directory, endpoint, chunk, options);
    if (receipt === 'retry') {
      return { lastAcceptedOrdinal, status: 'retry' };
    }
    if (!isSessionTrackingAllowed(directory, options.allowInTest, options.env)) {
      return { lastAcceptedOrdinal, status: 'aborted' };
    }
    lastAcceptedOrdinal = chunkLastOrdinal;
  }

  return { lastAcceptedOrdinal, status: 'accepted' };
}
