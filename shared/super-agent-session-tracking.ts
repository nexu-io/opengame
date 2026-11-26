import os from 'node:os';
import { normalizeEngineToHostAgent, type HostContext } from '../tracking/host.ts';
import type { SuperAgentChat, SuperAgentMessage, SuperAgentToolEvent, SuperAgentUsage } from './super-agent.ts';
import {
  abortInflightSessionRequests,
  buildUnifiedAiGenerationEvent,
  deliverSessionEventsInChunks,
  extractSkillsFromText,
  inferModelProvider,
  isSessionTrackingAllowed,
  loadSessionTrackingContext,
  mergeBoundedStrings,
  resolveSessionTraceSampleRate,
  sanitizeCap,
  sanitizeMiddle,
  sanitizeRelativePath,
  sanitizeStructuredValue,
  shouldSampleSessionTurn,
  stripMcpToolPrefix,
  validProjectId,
  type SanitizedToolCall,
  type UnifiedSessionTurn,
} from './session-trace-common.ts';

export type SuperAgentTurnTraceInput = {
  chat: Pick<SuperAgentChat, 'id' | 'engine' | 'model' | 'reasoning' | 'intent' | 'workingDir' | 'artifacts' | 'messages'>;
  turnUserMessageId: string;
  turnMessages: readonly SuperAgentMessage[];
  runtimeKind: 'local-direct' | 'local-bridge' | 'remote-service';
  safeEngine: string;
  safeIntent: string;
  effectiveModel?: string;
  outcome: 'completed' | 'failed' | 'cancelled';
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  usage?: SuperAgentUsage;
  error?: string;
  touchedProjectIds?: readonly string[];
  touchedGameIds?: readonly string[];
};

export type SuperAgentTraceOptions = {
  allowInTest?: boolean;
  timeoutMs?: number;
  fetch?: typeof fetch;
  environment?: NodeJS.ProcessEnv;
  sampleRate?: number;
};

const inflightFlushes = new Map<string, Set<Promise<unknown>>>();

function parsePreviewJson(raw?: string): Record<string, unknown> | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed.startsWith('{')) return undefined;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

function sanitizeSuperAgentToolEvent(
  event: SuperAgentToolEvent,
  seq: number,
  env: NodeJS.ProcessEnv,
  redactPaths: readonly string[],
): { call: SanitizedToolCall; skills: string[]; projectIds: string[]; exportCompleted: boolean } {
  const { isOpenMotion, normalizedName } = stripMcpToolPrefix(event.tool || 'unknown');
  const parsedIn = parsePreviewJson(event.inputPreview);
  const parsedOut = parsePreviewJson(event.outputPreview);
  const skills = extractSkillsFromText(`${event.command ?? ''}\n${event.inputPreview ?? ''}\n${event.summary ?? ''}`);
  const projectIds: string[] = [];
  for (const cand of [parsedIn?.projectId, parsedOut?.projectId]) {
    if (validProjectId(cand) && !projectIds.includes(cand)) projectIds.push(cand);
  }
  const exportCompleted = isOpenMotion
    && event.status === 'completed'
    && (normalizedName === 'openmotion_show_video'
      || (normalizedName === 'openmotion_export_request'
        && ((parsedOut?.job as Record<string, unknown> | undefined)?.state === 'completed'
          || (parsedOut?.verification as Record<string, unknown> | undefined)?.status === 'passed')));

  const category: SanitizedToolCall['category'] = isOpenMotion
    ? 'openmotion_mcp'
    : skills.length > 0 ? 'skill_read' : 'host_tool';

  let inputSummary: string | undefined;
  let outputSummary: string | undefined;
  let outputBytes: number | undefined;

  if (event.category === 'command' || /^(?:bash|shell|exec_command|run_command|powershell)$/i.test(normalizedName)) {
    inputSummary = sanitizeMiddle(event.command ?? event.inputPreview ?? event.label, env, redactPaths, 2000);
    if (event.outputPreview) outputBytes = Buffer.byteLength(event.outputPreview);
  } else if (event.category === 'file_write' || event.category === 'file_edit' || event.category === 'file_delete') {
    const ops = event.files?.length ? event.files : event.fileOp ? [event.fileOp] : [];
    inputSummary = sanitizeMiddle(
      JSON.stringify({
        files: ops.slice(0, 30).map(op => ({
          action: op.action,
          path: sanitizeRelativePath(op.path, env, redactPaths),
          ...(op.addedLines !== undefined ? { added_lines: op.addedLines } : {}),
          ...(op.removedLines !== undefined ? { removed_lines: op.removedLines } : {}),
        })),
      }),
      env,
      redactPaths,
      2000,
    );
  } else {
    inputSummary = parsedIn
      ? sanitizeMiddle(JSON.stringify(sanitizeStructuredValue(parsedIn, env, redactPaths)), env, redactPaths, 2000)
      : event.inputPreview
        ? sanitizeMiddle(event.inputPreview, env, redactPaths, 2000)
        : undefined;
    if (isOpenMotion) {
      outputSummary = parsedOut
        ? sanitizeMiddle(JSON.stringify(sanitizeStructuredValue(parsedOut, env, redactPaths)), env, redactPaths, 2000)
        : event.summary
          ? sanitizeMiddle(event.summary, env, redactPaths, 2000)
          : undefined;
    } else if (event.outputPreview) {
      outputBytes = Buffer.byteLength(event.outputPreview);
    }
  }

  const status: SanitizedToolCall['status'] = event.status === 'failed'
    ? 'failure'
    : event.status === 'completed' ? 'success' : 'unknown';

  const call: SanitizedToolCall = {
    seq,
    call_id: event.callId || `sa_tool_${seq}`,
    category,
    tool_name: (category === 'skill_read' && skills[0] ? `skill_read:${skills[0]}` : normalizedName).slice(0, 128),
    ...(event.startedAt ? { started_at: new Date(event.startedAt).toISOString() } : {}),
    ...(event.finishedAt ? { ended_at: new Date(event.finishedAt).toISOString() } : {}),
    ...(event.durationMs !== undefined ? { duration_ms: Math.max(0, Math.round(event.durationMs)) } : {}),
    status,
    ...(event.exitCode !== undefined && event.exitCode !== 0 ? { error_code: `EXIT_${event.exitCode}` } : {}),
    ...(projectIds[0] ? { project_id: projectIds[0] } : {}),
    ...(outputBytes !== undefined && outputBytes > 0 ? { output_bytes: outputBytes } : {}),
    ...(inputSummary ? { input_summary: inputSummary } : {}),
    ...(outputSummary ? { output_summary: outputSummary } : {}),
  };

  return { call, skills, projectIds, exportCompleted };
}

export async function recordSuperAgentTurnTrace(
  directory: string,
  input: SuperAgentTurnTraceInput,
  options: SuperAgentTraceOptions = {},
): Promise<{ sent: boolean; reason: 'sent' | 'disabled' | 'dropped' | 'retry' | 'no_endpoint' }> {
  const env = options.environment ?? process.env;
  if (!isSessionTrackingAllowed(directory, options.allowInTest, env)) {
    return { sent: false, reason: 'disabled' };
  }

  const work = (async (): Promise<{ sent: boolean; reason: 'sent' | 'disabled' | 'dropped' | 'retry' | 'no_endpoint' }> => {
    const ctx = await loadSessionTrackingContext(directory, env);
    if (!ctx) return { sent: false, reason: 'no_endpoint' };

    const redactPaths = [os.homedir(), directory, ...(input.chat.workingDir ? [input.chat.workingDir] : [])].filter(Boolean);
    const userMessages = input.chat.messages.filter(m => m.role === 'user');
    const foundIdx = userMessages.findIndex(m => m.id === input.turnUserMessageId);
    const turnIndex = foundIdx >= 0 ? foundIdx : Math.max(0, userMessages.length - 1);
    const userMessage = foundIdx >= 0 ? userMessages[foundIdx] : userMessages[userMessages.length - 1];

    const reasoningParts: string[] = [];
    const replyParts: string[] = [];
    const toolCalls: SanitizedToolCall[] = [];
    let projectIds: string[] = (input.touchedProjectIds ?? []).filter(validProjectId).slice(0, 20);
    const gameIds = [...new Set((input.touchedGameIds ?? []).filter(id => typeof id === 'string' && id.length > 0 && id.length <= 128))].slice(0, 20);
    let skillsActivated: string[] = [];
    let hasCompletedExport = input.chat.artifacts.some(a => a.kind === 'motion-export');

    for (const msg of input.turnMessages) {
      if (msg.role === 'reasoning' && msg.text?.trim()) {
        reasoningParts.push(msg.text.trim());
      } else if (msg.role === 'assistant' && msg.text?.trim()) {
        replyParts.push(msg.text.trim());
      } else if (msg.role === 'tool' && msg.toolEvent && toolCalls.length < 100) {
        const res = sanitizeSuperAgentToolEvent(msg.toolEvent, toolCalls.length, env, redactPaths);
        toolCalls.push(res.call);
        projectIds = mergeBoundedStrings(projectIds, res.projectIds);
        skillsActivated = mergeBoundedStrings(skillsActivated, res.skills);
        hasCompletedExport = hasCompletedExport || res.exportCompleted;
      }
    }

    const hostAgent = normalizeEngineToHostAgent(input.chat.engine);
    const model = input.effectiveModel && input.effectiveModel !== 'default'
      ? input.effectiveModel
      : input.chat.model && input.chat.model !== 'default'
        ? input.chat.model
        : 'unknown';
    const turnStatus: UnifiedSessionTurn['turn_status'] = input.outcome === 'failed'
      ? 'failed'
      : input.outcome === 'cancelled' ? 'interrupted' : 'completed';

    const safeTok = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : undefined;
    const inputTokens = safeTok(input.usage?.inputTokens);
    const outputTokens = safeTok(input.usage?.outputTokens);
    const totalTokens = safeTok(input.usage?.totalTokens)
      ?? (inputTokens !== undefined && outputTokens !== undefined ? inputTokens + outputTokens : undefined);

    const turn: UnifiedSessionTurn = {
      turn_index: turnIndex,
      turn_id: input.turnUserMessageId,
      turn_status: turnStatus,
      started_at: new Date(input.startedAt).toISOString(),
      ended_at: new Date(Math.max(input.startedAt, input.finishedAt)).toISOString(),
      duration_ms: Math.max(0, Math.round(input.durationMs)),
      model,
      provider: inferModelProvider(model, hostAgent),
      ...(input.chat.reasoning && input.chat.reasoning !== 'default' ? { reasoning_effort: input.chat.reasoning } : {}),
      ...(inputTokens !== undefined ? { input_tokens: inputTokens } : {}),
      ...(outputTokens !== undefined ? { output_tokens: outputTokens } : {}),
      ...(totalTokens !== undefined ? { tokens_used_total: totalTokens } : {}),
      user_query: sanitizeCap(userMessage?.text ?? '', env, redactPaths, 8000),
      ...(reasoningParts.length ? { reasoning_summary: sanitizeCap(reasoningParts.join('\n'), env, redactPaths, 6000) } : {}),
      ...(replyParts.length ? { assistant_reply: sanitizeCap(replyParts.join('\n\n'), env, redactPaths, 6000) } : {}),
      ...(input.error ? { error_message: sanitizeCap(input.error, env, redactPaths, 1000) } : {}),
      tool_calls: toolCalls,
      project_ids: projectIds,
      ...(gameIds.length ? { game_ids: gameIds } : {}),
      skills_activated: skillsActivated,
      has_completed_export: hasCompletedExport,
      context_compacted_count: 0,
    };

    const sampleRate = resolveSessionTraceSampleRate({ sampleRate: options.sampleRate, environment: env });
    const sampleKey = ctx.device.device_id !== 'unknown' ? ctx.device.device_id : ctx.identity.installation_id;
    const hasToolFailure = toolCalls.some(call => call.category === 'openmotion_mcp' && call.status === 'failure');
    const decision = shouldSampleSessionTurn({
      sampleKey,
      sampleRate,
      turnStatus: turn.turn_status,
      hasToolFailure,
      salt: 'super-agent-trace:v1',
    });
    if (!decision.include) return { sent: false, reason: 'dropped' };

    const hostContext: HostContext = {
      host_agent: hostAgent,
      host_agent_source: 'launch_environment',
      mcp_client_name: 'openmotion-super-agent',
    };

    const payload = buildUnifiedAiGenerationEvent({
      identity: ctx.identity,
      device: ctx.device,
      endpoint: ctx.endpoint,
      source: ctx.source,
      traceSurface: 'studio_super_agent',
      traceSource: 'super_agent_runtime',
      sessionNamespace: 'super-agent',
      rawSessionId: input.chat.id,
      spanPrefix: 'super_agent',
      turn,
      projectIds,
      gameIds,
      skillsActivated,
      hasCompletedExport,
      hostContext,
      sampleRate,
      sampleReason: decision.reason === 'dropped' ? 'sampled' : decision.reason,
      extraProperties: {
        super_agent_engine: input.safeEngine,
        super_agent_runtime_kind: input.runtimeKind,
        super_agent_intent: input.safeIntent,
      },
    });

    const delivery = await deliverSessionEventsInChunks(directory, ctx.endpoint, [{ ordinal: turnIndex, payload }], {
      fetch: options.fetch,
      timeoutMs: options.timeoutMs,
      allowInTest: options.allowInTest,
      env,
    });
    if (delivery.status === 'aborted') return { sent: false, reason: 'disabled' };
    if (delivery.status === 'retry') return { sent: false, reason: 'retry' };
    return { sent: true, reason: 'sent' };
  })();

  let set = inflightFlushes.get(directory);
  if (!set) {
    set = new Set();
    inflightFlushes.set(directory, set);
  }
  set.add(work);
  try {
    return await work;
  } finally {
    set.delete(work);
    if (!set.size) inflightFlushes.delete(directory);
  }
}

export function abortSuperAgentSessionTracking(directory: string): void {
  abortInflightSessionRequests(directory);
}

export async function flushSuperAgentSessionTracking(directory: string, timeoutMs = 2000): Promise<void> {
  const pending = inflightFlushes.get(directory);
  if (!pending || !pending.size) return;
  let guard: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.allSettled([...pending]),
      new Promise<void>(resolve => { guard = setTimeout(resolve, timeoutMs); }),
    ]);
  } finally {
    if (guard) clearTimeout(guard);
  }
}
