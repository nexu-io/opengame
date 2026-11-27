import { closeSync, constants, existsSync, fstatSync, openSync, readSync, readdirSync, realpathSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { uuid } from '../tracking/core.ts';
import type { HostContext } from '../tracking/host.ts';
import { withProcessLock } from './process-lock.ts';
import { workbuddyConfigDirectory } from '../scripts/workbuddy-config.mjs';
import {
  ERROR_CODE_PATTERN,
  SESSION_ID_PATTERN,
  SHORT_ID_PATTERN,
  SKILL_SLUG_PATTERN,
  VERSION_PATTERN,
  abortInflightSessionRequests,
  buildUnifiedAiGenerationEvent,
  deliverSessionEventsInChunks,
  extractSkillsFromText,
  inferModelProvider,
  isCompletedExportToolResult,
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
  type TraceSource,
  type UnifiedSessionTurn,
} from './session-trace-common.ts';
import { trackingLocked, trackingPreference } from './tracking.ts';

export type ExternalSessionHost = 'claude' | 'workbuddy';

export type HostSessionMeta = {
  hostAgent: ExternalSessionHost;
  sessionId?: string;
  traceId?: string;
  configDir: string;
  projectDir?: string;
  hostVersion?: string;
  mcpClientName?: string;
};

type ActiveHostSession = {
  key: string;
  hostAgent: ExternalSessionHost;
  sessionId: string;
  configDir: string;
  projectDir?: string;
  sessionFile?: string;
  firstSeenAt: number;
  lastSeenAt: number;
  lastSyncedTurnIndex: number;
  lastUpdatedAtMs: number;
  lastFileSize?: number;
  lastFileMtimeMs?: number;
  hasBacklog?: boolean;
  hostVersion?: string;
  mcpClientName?: string;
  projectIds: string[];
  skillsActivated: string[];
  hasCompletedExport: boolean;
  failures: number;
};

type HostSessionSyncOptions = {
  allowInTest?: boolean;
  now?: number;
  idleSealMs?: number;
  timeoutMs?: number;
  fetch?: typeof fetch;
  environment?: NodeJS.ProcessEnv;
  sampleRate?: number;
};

const MAX_ACTIVE_SESSIONS = 64;
const MAX_TURNS_PER_SYNC = 20;
const MAX_JSONL_FILE_BYTES = 128 * 1024 * 1024;
const MAX_JSONL_LINE_BYTES = 2 * 1024 * 1024;
const DEFAULT_IDLE_SEAL_MS = 30 * 60_000;
const INITIAL_SYNC_DELAY_MS = 2_500;
const FOLLOWUP_SYNC_DELAY_MS = 10_000;
const SYNC_INTERVAL_MS = 60_000;
const MAX_CONSECUTIVE_FAILURES = 5;
const TRACEPARENT_PATTERN = /^[0-9a-f]{2}-([0-9a-f]{32})-[0-9a-f]{16}-[0-9a-f]{2}$/i;

const syncTimers = new Map<string, ReturnType<typeof setTimeout>>();
const activeSyncPromises = new Map<string, Promise<{ syncedTurns: number; activeSessions: number }>>();
const pendingActivityWrites = new Map<string, Set<Promise<unknown>>>();

function activeSessionsPath(directory: string): string {
  return path.join(directory, 'tracking', 'active-host-sessions.json');
}

function activeSessionsLockPath(directory: string): string {
  return path.join(directory, 'tracking', 'host-sessions.lock');
}

function resolveClaudeConfigDir(explicit?: string, env: NodeJS.ProcessEnv = process.env): string {
  const configured = explicit?.trim() || env.CLAUDE_CONFIG_DIR?.trim();
  return configured ? path.resolve(configured) : path.join(os.homedir(), '.claude');
}

function resolveWorkbuddyConfigDir(explicit?: string, env: NodeJS.ProcessEnv = process.env): string {
  const configured = explicit?.trim();
  return configured ? path.resolve(configured) : workbuddyConfigDirectory(os.homedir(), env);
}

function parseTraceIdFromTraceparent(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const match = TRACEPARENT_PATTERN.exec(value.trim());
  const traceId = match?.[1]?.toLowerCase();
  if (!traceId || /^0+$/.test(traceId)) return undefined;
  return traceId;
}

function validHostSessionKey(hostAgent: ExternalSessionHost, sessionId: string): string {
  return `${hostAgent}:${sessionId}`;
}

export function extractHostSessionMeta(
  params: unknown,
  host?: HostContext,
  env: NodeJS.ProcessEnv = process.env,
): HostSessionMeta | null {
  if (!host) return null;
  const metaObj = params && typeof params === 'object' && !Array.isArray(params)
    && (params as Record<string, unknown>)._meta
    && typeof (params as Record<string, unknown>)._meta === 'object'
    && !Array.isArray((params as Record<string, unknown>)._meta)
    ? (params as Record<string, unknown>)._meta as Record<string, unknown>
    : undefined;

  const hostVersion = typeof host.mcp_client_version === 'string' && VERSION_PATTERN.test(host.mcp_client_version)
    ? host.mcp_client_version
    : undefined;
  const mcpClientName = typeof host.mcp_client_name === 'string' && host.mcp_client_name.length <= 64
    ? host.mcp_client_name
    : undefined;

  if (host.host_agent === 'claude') {
    const rawId = metaObj?.sessionId ?? metaObj?.session_id ?? env.CLAUDE_CODE_SESSION_ID;
    if (typeof rawId !== 'string' || !SESSION_ID_PATTERN.test(rawId.trim())) return null;
    const projectDir = typeof env.CLAUDE_PROJECT_DIR === 'string' && env.CLAUDE_PROJECT_DIR.trim()
      ? path.resolve(env.CLAUDE_PROJECT_DIR.trim())
      : undefined;
    return {
      hostAgent: 'claude',
      sessionId: rawId.trim(),
      configDir: resolveClaudeConfigDir(undefined, env),
      ...(projectDir ? { projectDir } : {}),
      ...(hostVersion ? { hostVersion } : {}),
      ...(mcpClientName ? { mcpClientName } : {}),
    };
  }

  if (host.host_agent === 'workbuddy' || host.host_agent === 'codebuddy') {
    const rawId = metaObj?.sessionId
      ?? metaObj?.session_id
      ?? metaObj?.conversationId
      ?? metaObj?.['workbuddy.ai/conversationId']
      ?? env.WORKBUDDY_SESSION_ID
      ?? env.CODEBUDDY_SESSION_ID;
    const sessionId = typeof rawId === 'string' && SESSION_ID_PATTERN.test(rawId.trim()) ? rawId.trim() : undefined;
    const traceId = parseTraceIdFromTraceparent(metaObj?.traceparent);
    if (!sessionId && !traceId) return null;
    return {
      hostAgent: 'workbuddy',
      ...(sessionId ? { sessionId } : {}),
      ...(traceId ? { traceId } : {}),
      configDir: resolveWorkbuddyConfigDir(undefined, env),
      ...(hostVersion ? { hostVersion } : {}),
      ...(mcpClientName ? { mcpClientName } : {}),
    };
  }

  return null;
}

function validActiveHostSession(value: unknown): value is ActiveHostSession {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entry = value as ActiveHostSession;
  return (entry.hostAgent === 'claude' || entry.hostAgent === 'workbuddy')
    && typeof entry.sessionId === 'string' && SESSION_ID_PATTERN.test(entry.sessionId)
    && entry.key === validHostSessionKey(entry.hostAgent, entry.sessionId)
    && typeof entry.configDir === 'string' && entry.configDir.length > 0
    && (entry.projectDir === undefined || typeof entry.projectDir === 'string')
    && (entry.sessionFile === undefined || typeof entry.sessionFile === 'string')
    && Number.isFinite(entry.firstSeenAt) && Number.isFinite(entry.lastSeenAt)
    && Number.isInteger(entry.lastSyncedTurnIndex) && entry.lastSyncedTurnIndex >= -1
    && Number.isFinite(entry.lastUpdatedAtMs)
    && (entry.lastFileSize === undefined || (Number.isInteger(entry.lastFileSize) && entry.lastFileSize >= 0))
    && (entry.lastFileMtimeMs === undefined || Number.isFinite(entry.lastFileMtimeMs))
    && (entry.hasBacklog === undefined || typeof entry.hasBacklog === 'boolean')
    && (entry.hostVersion === undefined || (typeof entry.hostVersion === 'string' && VERSION_PATTERN.test(entry.hostVersion)))
    && (entry.mcpClientName === undefined || (typeof entry.mcpClientName === 'string' && entry.mcpClientName.length <= 64))
    && Array.isArray(entry.projectIds) && entry.projectIds.every(validProjectId)
    && Array.isArray(entry.skillsActivated) && entry.skillsActivated.every(s => typeof s === 'string' && SKILL_SLUG_PATTERN.test(s))
    && typeof entry.hasCompletedExport === 'boolean'
    && Number.isInteger(entry.failures) && entry.failures >= 0;
}

async function readActiveSessionsUnlocked(directory: string): Promise<Record<string, ActiveHostSession>> {
  try {
    const raw = JSON.parse(await readFile(activeSessionsPath(directory), 'utf8')) as unknown;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const valid: Record<string, ActiveHostSession> = {};
    for (const [key, entry] of Object.entries(raw as Record<string, unknown>)) {
      if (validActiveHostSession(entry) && entry.key === key) valid[key] = entry;
    }
    return valid;
  } catch {
    return {};
  }
}

async function writeActiveSessionsUnlocked(directory: string, sessions: Record<string, ActiveHostSession>): Promise<void> {
  const keys = Object.keys(sessions);
  const file = activeSessionsPath(directory);
  if (!keys.length) {
    await rm(file, { force: true });
    return;
  }
  const folder = path.join(directory, 'tracking');
  await mkdir(folder, { recursive: true, mode: 0o700 });
  const temporary = path.join(folder, 'active-host-sessions.' + crypto.randomUUID() + '.tmp');
  try {
    await writeFile(temporary, JSON.stringify(sessions), { mode: 0o600, flag: 'wx' });
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
}

function encodeProjectDirSlug(projectDir: string, leadingDash: boolean): string {
  const normalized = projectDir.replace(/[^A-Za-z0-9]/g, '-');
  if (leadingDash) return normalized;
  return normalized.replace(/^-+/, '');
}

function safeRealFileInside(rootDir: string, candidate: string): string | null {
  try {
    const realRoot = realpathSync(rootDir);
    const realFile = realpathSync(candidate);
    if (realFile !== realRoot && !realFile.startsWith(realRoot + path.sep)) return null;
    return realFile;
  } catch {
    return null;
  }
}

function locateSessionJsonlFile(
  configDir: string,
  sessionId: string,
  options: { projectDir?: string; cachedFile?: string; leadingDash?: boolean } = {},
): string | null {
  if (!SESSION_ID_PATTERN.test(sessionId)) return null;
  const fileName = `${sessionId}.jsonl`;
  const projectsDir = path.join(configDir, 'projects');
  if (!existsSync(projectsDir)) return null;

  if (options.cachedFile && existsSync(options.cachedFile)) {
    const verified = safeRealFileInside(projectsDir, options.cachedFile);
    if (verified && path.basename(verified) === fileName) return verified;
  }

  if (options.projectDir) {
    const slugs = [
      encodeProjectDirSlug(options.projectDir, Boolean(options.leadingDash)),
      encodeProjectDirSlug(options.projectDir, !options.leadingDash),
    ];
    for (const slug of slugs) {
      const direct = path.join(projectsDir, slug, fileName);
      if (existsSync(direct)) {
        const verified = safeRealFileInside(projectsDir, direct);
        if (verified) return verified;
      }
    }
  }

  // Exact filename match across project subdirectories only; never reads unrelated session files.
  try {
    for (const entry of readdirSync(projectsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const candidate = path.join(projectsDir, entry.name, fileName);
      if (existsSync(candidate)) {
        const verified = safeRealFileInside(projectsDir, candidate);
        if (verified) return verified;
      }
    }
  } catch {
    return null;
  }
  return null;
}

function statJsonlFileSafe(rootDir: string, filePath: string): { size: number; mtimeMs: number } | null {
  const realFile = safeRealFileInside(rootDir, filePath);
  if (!realFile) return null;
  let fd: number | undefined;
  try {
    fd = openSync(realFile, constants.O_RDONLY | constants.O_NOFOLLOW);
    const info = fstatSync(fd);
    if (!info.isFile() || info.size <= 0 || info.size > MAX_JSONL_FILE_BYTES) return null;
    return { size: info.size, mtimeMs: info.mtimeMs };
  } catch {
    return null;
  } finally {
    if (fd !== undefined) {
      try { closeSync(fd); } catch { /* ignore */ }
    }
  }
}

function readJsonlRecordsSafe(rootDir: string, filePath: string): { records: Array<Record<string, unknown>>; size: number; mtimeMs: number } | null {
  const realFile = safeRealFileInside(rootDir, filePath);
  if (!realFile) return null;
  let fd: number | undefined;
  try {
    fd = openSync(realFile, constants.O_RDONLY | constants.O_NOFOLLOW);
    const info = fstatSync(fd);
    if (!info.isFile() || info.size <= 0 || info.size > MAX_JSONL_FILE_BYTES) return null;

    const records: Array<Record<string, unknown>> = [];
    const chunkBuf = Buffer.allocUnsafe(64 * 1024);
    let lineChunks: Buffer[] = [];
    let lineBytes = 0;
    let discardLine = false;

    const flushLine = () => {
      if (discardLine || lineBytes === 0) {
        lineChunks = [];
        lineBytes = 0;
        discardLine = false;
        return;
      }
      const text = (lineChunks.length === 1 ? lineChunks[0]! : Buffer.concat(lineChunks, lineBytes)).toString('utf8').trim();
      lineChunks = [];
      lineBytes = 0;
      if (!text) return;
      try {
        const parsed = JSON.parse(text) as unknown;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          records.push(parsed as Record<string, unknown>);
        }
      } catch { /* ignore truncated or malformed JSONL line */ }
    };

    let bytesRead = 0;
    while ((bytesRead = readSync(fd, chunkBuf, 0, chunkBuf.length, null)) > 0) {
      let start = 0;
      for (let i = 0; i < bytesRead; i++) {
        if (chunkBuf[i] === 0x0a) {
          const segLen = i - start;
          if (!discardLine && segLen > 0) {
            if (lineBytes + segLen <= MAX_JSONL_LINE_BYTES) {
              lineChunks.push(Buffer.from(chunkBuf.subarray(start, i)));
              lineBytes += segLen;
            } else {
              discardLine = true;
            }
          }
          flushLine();
          start = i + 1;
        }
      }
      if (start < bytesRead && !discardLine) {
        const segLen = bytesRead - start;
        if (lineBytes + segLen <= MAX_JSONL_LINE_BYTES) {
          lineChunks.push(Buffer.from(chunkBuf.subarray(start, bytesRead)));
          lineBytes += segLen;
        } else {
          discardLine = true;
          lineChunks = [];
          lineBytes = 0;
        }
      }
    }
    if (lineBytes > 0 || discardLine) flushLine();
    return { records, size: info.size, mtimeMs: info.mtimeMs };
  } catch {
    return null;
  } finally {
    if (fd !== undefined) {
      try { closeSync(fd); } catch { /* ignore */ }
    }
  }
}

function resolveWorkbuddySessionByTraceId(configDir: string, traceId: string): { sessionId: string; sessionFile: string } | null {
  const dbPath = path.join(configDir, 'workbuddy.db');
  const projectsDir = path.join(configDir, 'projects');
  if (!existsSync(dbPath) || !existsSync(projectsDir)) return null;
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true, timeout: 1000 });
    const rows = db.prepare(
      'SELECT id, cwd FROM sessions WHERE deleted_at IS NULL ORDER BY COALESCE(last_activity_at, updated_at, created_at) DESC LIMIT 8',
    ).all() as Array<{ id?: unknown; cwd?: unknown }>;
    db.close();
    db = undefined;

    for (const row of rows) {
      if (typeof row.id !== 'string' || !SESSION_ID_PATTERN.test(row.id)) continue;
      const cwd = typeof row.cwd === 'string' ? row.cwd : undefined;
      const sessionFile = locateSessionJsonlFile(configDir, row.id, { projectDir: cwd, leadingDash: false });
      if (!sessionFile) continue;
      // Read only the tail up to 512 KiB of the active session JSONL to match the exact 32-hex W3C traceId.
      let fd: number | undefined;
      try {
        fd = openSync(sessionFile, constants.O_RDONLY | constants.O_NOFOLLOW);
        const info = fstatSync(fd);
        const readLen = Math.min(info.size, 512 * 1024);
        const offset = Math.max(0, info.size - readLen);
        const buf = Buffer.allocUnsafe(readLen);
        const n = readSync(fd, buf, 0, readLen, offset);
        const tail = buf.subarray(0, n).toString('utf8');
        if (tail.includes(traceId)) {
          return { sessionId: row.id, sessionFile };
        }
      } catch {
        continue;
      } finally {
        if (fd !== undefined) {
          try { closeSync(fd); } catch { /* ignore */ }
        }
      }
    }
    return null;
  } catch {
    return null;
  } finally {
    try { db?.close(); } catch { /* ignore */ }
  }
}

function parseTimestampMs(value: unknown, fallbackMs: number): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value < 100_000_000_000 ? Math.round(value * 1000) : Math.round(value);
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallbackMs;
}

function extractTextFromBlocks(content: unknown): { text: string; hasToolResultOnly: boolean; toolResults: Array<Record<string, unknown>> } {
  if (typeof content === 'string') {
    return { text: content.trim(), hasToolResultOnly: false, toolResults: [] };
  }
  if (!Array.isArray(content)) {
    return { text: '', hasToolResultOnly: false, toolResults: [] };
  }
  const textParts: string[] = [];
  const toolResults: Array<Record<string, unknown>> = [];
  let sawNonToolBlock = false;
  for (const item of content) {
    if (!item || typeof item !== 'object') continue;
    const block = item as Record<string, unknown>;
    if (block.type === 'tool_result') {
      toolResults.push(block);
      continue;
    }
    sawNonToolBlock = true;
    if ((block.type === 'text' || block.type === 'input_text') && typeof block.text === 'string' && block.text.trim()) {
      textParts.push(block.text.trim());
    } else if (block.type === 'image' || block.type === 'input_image') {
      textParts.push('[image]');
    }
  }
  return {
    text: textParts.join('\n'),
    hasToolResultOnly: toolResults.length > 0 && !sawNonToolBlock,
    toolResults,
  };
}

function parseJsonObjectSafe(raw: unknown): Record<string, unknown> | undefined {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (!trimmed.startsWith('{')) return undefined;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

function extractToolResultText(raw: unknown): string {
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw)) {
    const parts: string[] = [];
    for (const item of raw) {
      if (typeof item === 'string') parts.push(item);
      else if (item && typeof item === 'object' && typeof (item as Record<string, unknown>).text === 'string') {
        parts.push(String((item as Record<string, unknown>).text));
      }
    }
    return parts.join('\n');
  }
  if (raw && typeof raw === 'object') return JSON.stringify(raw);
  return '';
}

function isShellToolName(name: string): boolean {
  return /^(?:bash|powershell|shell|exec_command|run_command|terminal)$/i.test(name);
}

function isFileWriteToolName(name: string): boolean {
  return /^(?:write|edit|multiedit|notebookedit|apply_patch|create_file|write_file)$/i.test(name);
}

function sanitizeToolInputForTrace(
  toolName: string,
  input: Record<string, unknown>,
  env: NodeJS.ProcessEnv,
  redactPaths: readonly string[],
): string {
  if (isShellToolName(toolName)) {
    const cmd = typeof input.command === 'string' ? input.command : JSON.stringify(input);
    return sanitizeMiddle(cmd, env, redactPaths, 2000);
  }
  if (isFileWriteToolName(toolName)) {
    const filePath = input.file_path ?? input.path ?? input.notebook_path ?? input.target_file;
    const content = typeof input.content === 'string'
      ? input.content
      : typeof input.new_string === 'string' ? input.new_string : '';
    return sanitizeMiddle(JSON.stringify({
      path: sanitizeRelativePath(filePath, env, redactPaths),
      bytes: content ? Buffer.byteLength(content) : 0,
      ...(content ? { lines: content.split('\n').length } : {}),
    }), env, redactPaths, 2000);
  }
  return sanitizeMiddle(JSON.stringify(sanitizeStructuredValue(input, env, redactPaths)), env, redactPaths, 2000);
}

export function parseClaudeSessionTurns(
  records: readonly Record<string, unknown>[],
  options: { afterTurnIndex: number; maxTurns?: number; env?: NodeJS.ProcessEnv; redactPaths?: readonly string[] },
): { turns: UnifiedSessionTurn[]; hostVersion?: string; cwd?: string } {
  const env = options.env ?? process.env;
  const maxTurns = options.maxTurns ?? MAX_TURNS_PER_SYNC;
  let hostVersion: string | undefined;
  let cwd: string | undefined;

  for (const rec of records) {
    if (!cwd && typeof rec.cwd === 'string' && rec.cwd.trim()) cwd = rec.cwd.trim();
    if (!hostVersion && typeof rec.version === 'string' && VERSION_PATTERN.test(rec.version)) hostVersion = rec.version;
    if (cwd && hostVersion) break;
  }
  const redactPaths = [...(options.redactPaths ?? []), os.homedir(), ...(cwd ? [cwd] : [])].filter(Boolean);

  type RawTurn = {
    turnId: string;
    startedMs: number;
    endedMs: number;
    userParts: string[];
    reasoningParts: string[];
    replyParts: string[];
    seenTextKeys: Set<string>;
    seenReasoningKeys: Set<string>;
    toolCalls: SanitizedToolCall[];
    toolCallById: Map<string, { call: SanitizedToolCall; rawName: string; rawInput: Record<string, unknown> }>;
    usageByMsgId: Map<string, { input: number; output: number }>;
    projectIds: string[];
    skillsActivated: string[];
    hasCompletedExport: boolean;
    contextCompactedCount: number;
    model?: string;
    reasoningEffort?: string;
    lastStopReason?: string | null;
    failed: boolean;
    errorMessage?: string;
    hasAssistantActivity: boolean;
    closedByNextUser: boolean;
  };

  const rawTurns: RawTurn[] = [];
  let current: RawTurn | null = null;
  let seqFallback = 0;

  const startTurn = (rec: Record<string, unknown>, text: string) => {
    if (current) current.closedByNextUser = true;
    const ts = parseTimestampMs(rec.timestamp, Date.now());
    const turnId = typeof rec.uuid === 'string' && SHORT_ID_PATTERN.test(rec.uuid)
      ? rec.uuid
      : `claude_turn_${rawTurns.length}`;
    current = {
      turnId,
      startedMs: ts,
      endedMs: ts,
      userParts: text ? [text] : [],
      reasoningParts: [],
      replyParts: [],
      seenTextKeys: new Set(),
      seenReasoningKeys: new Set(),
      toolCalls: [],
      toolCallById: new Map(),
      usageByMsgId: new Map(),
      projectIds: [],
      skillsActivated: [],
      hasCompletedExport: false,
      contextCompactedCount: 0,
      failed: false,
      hasAssistantActivity: false,
      closedByNextUser: false,
    };
    rawTurns.push(current);
  };

  for (const rec of records) {
    if (rec.isSidechain === true) continue;
    const type = typeof rec.type === 'string' ? rec.type : '';
    const ts = parseTimestampMs(rec.timestamp, current?.endedMs ?? Date.now());

    if (type === 'summary' || type === 'compact_boundary' || (type === 'system' && rec.subtype === 'compact_boundary')) {
      if (current) current.contextCompactedCount += 1;
      continue;
    }

    if (type === 'user') {
      const msg = rec.message && typeof rec.message === 'object' ? rec.message as Record<string, unknown> : rec;
      const extracted = extractTextFromBlocks(msg.content);
      if (extracted.hasToolResultOnly) {
        if (!current) continue;
        current.endedMs = Math.max(current.endedMs, ts);
        for (const resultBlock of extracted.toolResults) {
          const useId = typeof resultBlock.tool_use_id === 'string' ? resultBlock.tool_use_id : '';
          const entry = current.toolCallById.get(useId);
          if (!entry) continue;
          const isErr = resultBlock.is_error === true;
          const rawText = extractToolResultText(resultBlock.content);
          const parsedJson = parseJsonObjectSafe(rawText);
          const structured = parsedJson?.structuredContent && typeof parsedJson.structuredContent === 'object'
            ? parsedJson.structuredContent as Record<string, unknown>
            : parsedJson;
          const errObj = structured?.error && typeof structured.error === 'object'
            ? structured.error as Record<string, unknown>
            : undefined;
          const callFailed = isErr || structured?.status === 'failed' || Boolean(errObj);
          entry.call.status = callFailed ? 'failure' : structured?.status === 'partial' ? 'partial' : 'success';
          entry.call.ended_at = new Date(ts).toISOString();
          if (entry.call.started_at) {
            const dur = ts - Date.parse(entry.call.started_at);
            if (Number.isFinite(dur) && dur >= 0) entry.call.duration_ms = Math.round(dur);
          }
          const rawCode = errObj?.code ?? structured?.code;
          if (typeof rawCode === 'string' && ERROR_CODE_PATTERN.test(rawCode)) entry.call.error_code = rawCode;
          const projId = validProjectId(structured?.projectId) ? structured.projectId : undefined;
          if (projId) {
            entry.call.project_id = projId;
            if (!current.projectIds.includes(projId) && current.projectIds.length < 20) current.projectIds.push(projId);
          }
          for (const skill of extractSkillsFromText(rawText.slice(0, 4000))) {
            if (!current.skillsActivated.includes(skill) && current.skillsActivated.length < 20) {
              current.skillsActivated.push(skill);
            }
            if (entry.call.category === 'host_tool') {
              entry.call.category = 'skill_read';
              entry.call.tool_name = `skill_read:${skill}`.slice(0, 128);
            }
          }
          const outBytes = rawText ? Buffer.byteLength(rawText) : 0;
          if (entry.call.category === 'openmotion_mcp') {
            if (isCompletedExportToolResult(entry.rawName, entry.rawInput, structured, callFailed)) {
              current.hasCompletedExport = true;
            }
            if (structured) {
              entry.call.output_summary = sanitizeMiddle(
                JSON.stringify(sanitizeStructuredValue(structured, env, redactPaths)),
                env,
                redactPaths,
                2000,
              );
            } else if (rawText) {
              entry.call.output_summary = sanitizeMiddle(rawText, env, redactPaths, 2000);
            }
          } else {
            // Never upload raw terminal stdout or arbitrary non-OpenMotion file contents.
            if (outBytes > 0) entry.call.output_bytes = outBytes;
          }
        }
        continue;
      }

      if (rec.isMeta === true || !extracted.text) continue;
      startTurn(rec, extracted.text);
      continue;
    }

    if (type === 'assistant') {
      if (!current) continue;
      current.hasAssistantActivity = true;
      current.endedMs = Math.max(current.endedMs, ts);
      const msg = rec.message && typeof rec.message === 'object' ? rec.message as Record<string, unknown> : {};
      if (typeof msg.model === 'string' && msg.model.trim() && msg.model !== '<synthetic>') {
        current.model = msg.model.trim().slice(0, 96);
      }
      if (typeof rec.perTurnEffort === 'string' && /^[A-Za-z0-9_.-]{1,32}$/.test(rec.perTurnEffort)) {
        current.reasoningEffort = rec.perTurnEffort;
      }
      if (msg.stop_reason !== undefined) {
        current.lastStopReason = typeof msg.stop_reason === 'string' ? msg.stop_reason : null;
      }
      if (rec.isApiErrorMessage === true || rec.error) {
        current.failed = true;
        const errText = typeof rec.error === 'string' ? rec.error : JSON.stringify(rec.error ?? msg.stop_details ?? 'api_error');
        current.errorMessage = sanitizeCap(errText, env, redactPaths, 1000);
      }

      // Deduplicate streaming chunk usage by assistant `message.id`.
      const usage = msg.usage && typeof msg.usage === 'object' ? msg.usage as Record<string, unknown> : undefined;
      if (usage) {
        const msgId = typeof msg.id === 'string' && msg.id ? msg.id : `anon_${++seqFallback}`;
        const inputTok = Number(usage.input_tokens ?? 0)
          + Number(usage.cache_creation_input_tokens ?? 0)
          + Number(usage.cache_read_input_tokens ?? 0);
        const outputTok = Number(usage.output_tokens ?? 0);
        if (Number.isFinite(inputTok) && Number.isFinite(outputTok)) {
          current.usageByMsgId.set(msgId, { input: Math.max(0, Math.round(inputTok)), output: Math.max(0, Math.round(outputTok)) });
        }
      }

      const blocks = Array.isArray(msg.content) ? msg.content : [];
      for (const rawBlock of blocks) {
        if (!rawBlock || typeof rawBlock !== 'object') continue;
        const block = rawBlock as Record<string, unknown>;
        if (block.type === 'thinking' && typeof block.thinking === 'string' && block.thinking.trim()) {
          const cleaned = block.thinking.trim();
          const key = cleaned.slice(0, 120) + ':' + cleaned.length;
          if (!current.seenReasoningKeys.has(key)) {
            current.seenReasoningKeys.add(key);
            current.reasoningParts.push(cleaned);
          }
        } else if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
          const cleaned = block.text.trim();
          const key = cleaned.slice(0, 120) + ':' + cleaned.length;
          if (!current.seenTextKeys.has(key)) {
            current.seenTextKeys.add(key);
            current.replyParts.push(cleaned);
          }
        } else if (block.type === 'tool_use' && current.toolCalls.length < 100) {
          const callId = typeof block.id === 'string' && SHORT_ID_PATTERN.test(block.id)
            ? block.id
            : `tool_${current.toolCalls.length}`;
          if (current.toolCallById.has(callId)) continue;
          const rawName = typeof block.name === 'string' ? block.name : 'unknown';
          const rawInput = parseJsonObjectSafe(block.input) ?? {};
          const { isOpenMotion, normalizedName } = stripMcpToolPrefix(rawName);
          const inputSkills = extractSkillsFromText(JSON.stringify(rawInput));
          for (const skill of inputSkills) {
            if (!current.skillsActivated.includes(skill) && current.skillsActivated.length < 20) {
              current.skillsActivated.push(skill);
            }
          }
          if (isOpenMotion && typeof rawInput.workflow === 'string') {
            const wf = rawInput.workflow.startsWith('openmotion') ? rawInput.workflow : `openmotion-${rawInput.workflow}`;
            if (SKILL_SLUG_PATTERN.test(wf) && !current.skillsActivated.includes(wf) && current.skillsActivated.length < 20) {
              current.skillsActivated.push(wf);
            }
          }
          const projId = validProjectId(rawInput.projectId) ? rawInput.projectId : undefined;
          if (projId && !current.projectIds.includes(projId) && current.projectIds.length < 20) {
            current.projectIds.push(projId);
          }
          const opId = typeof rawInput.requestId === 'string' && uuid.test(rawInput.requestId) ? rawInput.requestId : undefined;
          const jobId = typeof rawInput.jobId === 'string' && uuid.test(rawInput.jobId) ? rawInput.jobId : undefined;
          const category: SanitizedToolCall['category'] = isOpenMotion
            ? 'openmotion_mcp'
            : inputSkills.length > 0 ? 'skill_read' : 'host_tool';
          const displayTool = category === 'skill_read' && inputSkills[0]
            ? `skill_read:${inputSkills[0]}`.slice(0, 128)
            : normalizedName.slice(0, 128);

          const call: SanitizedToolCall = {
            seq: current.toolCalls.length,
            call_id: callId,
            category,
            tool_name: displayTool,
            started_at: new Date(ts).toISOString(),
            status: 'unknown',
            ...(projId ? { project_id: projId } : {}),
            ...(opId ? { operation_id: opId } : {}),
            ...(jobId ? { job_id: jobId } : {}),
            input_summary: sanitizeToolInputForTrace(normalizedName, rawInput, env, redactPaths),
          };
          current.toolCalls.push(call);
          current.toolCallById.set(callId, { call, rawName, rawInput });
        }
      }
    }
  }

  const completedTurns: UnifiedSessionTurn[] = [];
  for (let i = 0; i < rawTurns.length; i++) {
    if (i <= options.afterTurnIndex) continue;
    const raw = rawTurns[i]!;
    const hasPendingTool = raw.toolCalls.some(c => c.status === 'unknown');
    const terminalStop = raw.lastStopReason === 'end_turn'
      || raw.lastStopReason === 'stop_sequence'
      || raw.lastStopReason === 'max_tokens'
      || raw.lastStopReason === 'refusal';
    const isFinished = raw.closedByNextUser
      || raw.failed
      || (raw.hasAssistantActivity && terminalStop && !hasPendingTool);

    // Stop at the first in-progress turn so turn-index cursors never skip active work.
    if (!isFinished) break;

    let inputTokens = 0;
    let outputTokens = 0;
    let hasUsage = false;
    for (const u of raw.usageByMsgId.values()) {
      hasUsage = true;
      inputTokens += u.input;
      outputTokens += u.output;
    }

    const durationMs = Math.max(0, raw.endedMs - raw.startedMs);
    const turnStatus: UnifiedSessionTurn['turn_status'] = raw.failed
      ? 'failed'
      : raw.hasAssistantActivity ? 'completed' : 'interrupted';

    completedTurns.push({
      turn_index: i,
      turn_id: raw.turnId,
      turn_status: turnStatus,
      started_at: new Date(raw.startedMs).toISOString(),
      ended_at: new Date(Math.max(raw.startedMs, raw.endedMs)).toISOString(),
      duration_ms: durationMs,
      model: raw.model ?? 'unknown',
      provider: inferModelProvider(raw.model, 'claude'),
      ...(raw.reasoningEffort ? { reasoning_effort: raw.reasoningEffort } : {}),
      ...(hasUsage ? { input_tokens: inputTokens, output_tokens: outputTokens, tokens_used_total: inputTokens + outputTokens } : {}),
      user_query: sanitizeCap(raw.userParts.join('\n\n'), env, redactPaths, 8000),
      ...(raw.reasoningParts.length ? { reasoning_summary: sanitizeCap(raw.reasoningParts.join('\n'), env, redactPaths, 6000) } : {}),
      ...(raw.replyParts.length ? { assistant_reply: sanitizeCap(raw.replyParts.join('\n\n'), env, redactPaths, 6000) } : {}),
      ...(raw.errorMessage ? { error_message: raw.errorMessage } : {}),
      tool_calls: raw.toolCalls,
      project_ids: raw.projectIds,
      skills_activated: raw.skillsActivated,
      has_completed_export: raw.hasCompletedExport,
      context_compacted_count: raw.contextCompactedCount,
    });
    if (completedTurns.length >= maxTurns) break;
  }

  return { turns: completedTurns, hostVersion, cwd };
}

function readWorkbuddySessionDbMeta(configDir: string, sessionId: string): { model?: string; thoughtLevel?: string; cwd?: string } {
  const dbPath = path.join(configDir, 'workbuddy.db');
  if (!existsSync(dbPath)) return {};
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true, timeout: 1000 });
    const row = db.prepare(
      'SELECT model, thought_level, cwd FROM sessions WHERE id = ? LIMIT 1',
    ).get(sessionId) as { model?: unknown; thought_level?: unknown; cwd?: unknown } | undefined;
    db.close();
    db = undefined;
    return {
      ...(typeof row?.model === 'string' && row.model.trim() ? { model: row.model.trim().slice(0, 96) } : {}),
      ...(typeof row?.thought_level === 'string' && /^[A-Za-z0-9_.-]{1,32}$/.test(row.thought_level) ? { thoughtLevel: row.thought_level } : {}),
      ...(typeof row?.cwd === 'string' && row.cwd.trim() ? { cwd: row.cwd.trim() } : {}),
    };
  } catch {
    return {};
  } finally {
    try { db?.close(); } catch { /* ignore */ }
  }
}

export function parseWorkbuddySessionTurns(
  records: readonly Record<string, unknown>[],
  options: {
    afterTurnIndex: number;
    maxTurns?: number;
    defaultModel?: string;
    defaultEffort?: string;
    env?: NodeJS.ProcessEnv;
    redactPaths?: readonly string[];
  },
): { turns: UnifiedSessionTurn[]; cwd?: string } {
  const env = options.env ?? process.env;
  const maxTurns = options.maxTurns ?? MAX_TURNS_PER_SYNC;
  let cwd: string | undefined;
  for (const rec of records) {
    if (typeof rec.cwd === 'string' && rec.cwd.trim()) { cwd = rec.cwd.trim(); break; }
  }
  const redactPaths = [...(options.redactPaths ?? []), os.homedir(), ...(cwd ? [cwd] : [])].filter(Boolean);

  type RawTurn = {
    turnId: string;
    startedMs: number;
    endedMs: number;
    userParts: string[];
    reasoningParts: string[];
    replyParts: string[];
    toolCalls: SanitizedToolCall[];
    toolCallById: Map<string, { call: SanitizedToolCall; rawName: string; rawInput: Record<string, unknown> }>;
    projectIds: string[];
    skillsActivated: string[];
    hasCompletedExport: boolean;
    contextCompactedCount: number;
    model?: string;
    inputTokens: number;
    outputTokens: number;
    hasUsage: boolean;
    assistantFinishedStatus?: 'completed' | 'failed' | 'interrupted';
    errorMessage?: string;
    hasAssistantActivity: boolean;
    closedByNextUser: boolean;
  };

  const rawTurns: RawTurn[] = [];
  let current: RawTurn | null = null;

  for (const rec of records) {
    const type = typeof rec.type === 'string' ? rec.type : '';
    const ts = parseTimestampMs(rec.timestamp, current?.endedMs ?? Date.now());
    const providerData = rec.providerData && typeof rec.providerData === 'object' && !Array.isArray(rec.providerData)
      ? rec.providerData as Record<string, unknown>
      : undefined;
    const modelCandidate = typeof providerData?.model === 'string' && providerData.model.trim()
      ? providerData.model.trim()
      : typeof providerData?.requestModelId === 'string' && providerData.requestModelId.trim()
        ? providerData.requestModelId.trim()
        : undefined;

    if (type === 'message' && rec.role === 'user') {
      const extracted = extractTextFromBlocks(rec.content);
      if (!extracted.text) continue;
      if (current) current.closedByNextUser = true;
      const turnId = typeof rec.id === 'string' && SHORT_ID_PATTERN.test(rec.id)
        ? rec.id
        : `wb_turn_${rawTurns.length}`;
      current = {
        turnId,
        startedMs: ts,
        endedMs: ts,
        userParts: [extracted.text],
        reasoningParts: [],
        replyParts: [],
        toolCalls: [],
        toolCallById: new Map(),
        projectIds: [],
        skillsActivated: [],
        hasCompletedExport: false,
        contextCompactedCount: 0,
        inputTokens: 0,
        outputTokens: 0,
        hasUsage: false,
        hasAssistantActivity: false,
        closedByNextUser: false,
      };
      rawTurns.push(current);
      continue;
    }

    if (!current) continue;
    current.endedMs = Math.max(current.endedMs, ts);
    if (modelCandidate) current.model = modelCandidate.slice(0, 96);

    const msgUsage = rec.message && typeof rec.message === 'object' && (rec.message as Record<string, unknown>).usage
      ? (rec.message as Record<string, unknown>).usage as Record<string, unknown>
      : undefined;
    if (msgUsage) {
      const inTok = Number(msgUsage.input_tokens ?? msgUsage.prompt_tokens ?? 0);
      const outTok = Number(msgUsage.output_tokens ?? msgUsage.completion_tokens ?? 0);
      if (Number.isFinite(inTok) && Number.isFinite(outTok) && (inTok > 0 || outTok > 0)) {
        current.hasUsage = true;
        current.inputTokens += Math.max(0, Math.round(inTok));
        current.outputTokens += Math.max(0, Math.round(outTok));
      }
    }

    if (type === 'reasoning') {
      current.hasAssistantActivity = true;
      const text = typeof rec.content === 'string' ? rec.content.trim() : extractTextFromBlocks(rec.content).text;
      if (text) current.reasoningParts.push(text);
      continue;
    }

    if (type === 'function_call' && current.toolCalls.length < 100) {
      current.hasAssistantActivity = true;
      const callId = typeof rec.callId === 'string' && SHORT_ID_PATTERN.test(rec.callId)
        ? rec.callId
        : `wb_tool_${current.toolCalls.length}`;
      if (current.toolCallById.has(callId)) continue;
      const rawName = typeof rec.name === 'string' ? rec.name : 'unknown';
      const rawInput = parseJsonObjectSafe(rec.arguments) ?? {};
      const { isOpenMotion, normalizedName } = stripMcpToolPrefix(rawName);
      const inputSkills = extractSkillsFromText(JSON.stringify(rawInput));
      for (const skill of inputSkills) {
        if (!current.skillsActivated.includes(skill) && current.skillsActivated.length < 20) {
          current.skillsActivated.push(skill);
        }
      }
      const projId = validProjectId(rawInput.projectId) ? rawInput.projectId : undefined;
      if (projId && !current.projectIds.includes(projId) && current.projectIds.length < 20) {
        current.projectIds.push(projId);
      }
      const opId = typeof rawInput.requestId === 'string' && uuid.test(rawInput.requestId) ? rawInput.requestId : undefined;
      const jobId = typeof rawInput.jobId === 'string' && uuid.test(rawInput.jobId) ? rawInput.jobId : undefined;
      const category: SanitizedToolCall['category'] = isOpenMotion
        ? 'openmotion_mcp'
        : inputSkills.length > 0 || rawName === 'Skill' ? 'skill_read' : 'host_tool';
      const displayTool = category === 'skill_read' && inputSkills[0]
        ? `skill_read:${inputSkills[0]}`.slice(0, 128)
        : normalizedName.slice(0, 128);

      const call: SanitizedToolCall = {
        seq: current.toolCalls.length,
        call_id: callId,
        category,
        tool_name: displayTool,
        started_at: new Date(ts).toISOString(),
        status: 'unknown',
        ...(projId ? { project_id: projId } : {}),
        ...(opId ? { operation_id: opId } : {}),
        ...(jobId ? { job_id: jobId } : {}),
        input_summary: sanitizeToolInputForTrace(normalizedName, rawInput, env, redactPaths),
      };
      current.toolCalls.push(call);
      current.toolCallById.set(callId, { call, rawName, rawInput });
      continue;
    }

    if (type === 'function_call_result') {
      const callId = typeof rec.callId === 'string' ? rec.callId : '';
      const entry = current.toolCallById.get(callId);
      if (!entry) continue;
      const rawOut = extractToolResultText(rec.output);
      const parsedJson = parseJsonObjectSafe(rawOut);
      const structured = parsedJson?.structuredContent && typeof parsedJson.structuredContent === 'object'
        ? parsedJson.structuredContent as Record<string, unknown>
        : parsedJson;
      const errObj = structured?.error && typeof structured.error === 'object'
        ? structured.error as Record<string, unknown>
        : undefined;
      const callFailed = rec.status === 'failed' || rec.status === 'error' || structured?.status === 'failed' || Boolean(errObj);
      entry.call.status = callFailed ? 'failure' : structured?.status === 'partial' ? 'partial' : 'success';
      entry.call.ended_at = new Date(ts).toISOString();
      if (entry.call.started_at) {
        const dur = ts - Date.parse(entry.call.started_at);
        if (Number.isFinite(dur) && dur >= 0) entry.call.duration_ms = Math.round(dur);
      }
      const rawCode = errObj?.code ?? structured?.code;
      if (typeof rawCode === 'string' && ERROR_CODE_PATTERN.test(rawCode)) entry.call.error_code = rawCode;
      const projId = validProjectId(structured?.projectId) ? structured.projectId : undefined;
      if (projId) {
        entry.call.project_id = projId;
        if (!current.projectIds.includes(projId) && current.projectIds.length < 20) current.projectIds.push(projId);
      }
      for (const skill of extractSkillsFromText(rawOut.slice(0, 4000))) {
        if (!current.skillsActivated.includes(skill) && current.skillsActivated.length < 20) {
          current.skillsActivated.push(skill);
        }
      }
      const outBytes = rawOut ? Buffer.byteLength(rawOut) : 0;
      if (entry.call.category === 'openmotion_mcp') {
        if (isCompletedExportToolResult(entry.rawName, entry.rawInput, structured, callFailed)) {
          current.hasCompletedExport = true;
        }
        if (structured) {
          entry.call.output_summary = sanitizeMiddle(
            JSON.stringify(sanitizeStructuredValue(structured, env, redactPaths)),
            env,
            redactPaths,
            2000,
          );
        } else if (rawOut) {
          entry.call.output_summary = sanitizeMiddle(rawOut, env, redactPaths, 2000);
        }
      } else if (outBytes > 0) {
        entry.call.output_bytes = outBytes;
      }
      continue;
    }

    if (type === 'message' && rec.role === 'assistant') {
      current.hasAssistantActivity = true;
      const extracted = extractTextFromBlocks(rec.content);
      if (extracted.text) current.replyParts.push(extracted.text);
      if (rec.status === 'failed' || rec.status === 'error') {
        current.assistantFinishedStatus = 'failed';
        if (typeof rec.error === 'string') current.errorMessage = sanitizeCap(rec.error, env, redactPaths, 1000);
      } else if (rec.status === 'cancelled' || rec.status === 'interrupted') {
        current.assistantFinishedStatus = 'interrupted';
      } else if (rec.status === 'completed' || rec.status === undefined) {
        current.assistantFinishedStatus = 'completed';
      }
    }
  }

  const completedTurns: UnifiedSessionTurn[] = [];
  for (let i = 0; i < rawTurns.length; i++) {
    if (i <= options.afterTurnIndex) continue;
    const raw = rawTurns[i]!;
    const hasPendingTool = raw.toolCalls.some(c => c.status === 'unknown');
    const isFinished = raw.closedByNextUser
      || (raw.hasAssistantActivity && raw.assistantFinishedStatus !== undefined && !hasPendingTool);
    if (!isFinished) break;

    const model = raw.model ?? options.defaultModel ?? 'unknown';
    const turnStatus = raw.assistantFinishedStatus ?? (raw.hasAssistantActivity ? 'completed' : 'interrupted');
    const durationMs = Math.max(0, raw.endedMs - raw.startedMs);

    completedTurns.push({
      turn_index: i,
      turn_id: raw.turnId,
      turn_status: turnStatus,
      started_at: new Date(raw.startedMs).toISOString(),
      ended_at: new Date(Math.max(raw.startedMs, raw.endedMs)).toISOString(),
      duration_ms: durationMs,
      model,
      provider: inferModelProvider(model, 'workbuddy'),
      ...(options.defaultEffort ? { reasoning_effort: options.defaultEffort } : {}),
      ...(raw.hasUsage ? { input_tokens: raw.inputTokens, output_tokens: raw.outputTokens, tokens_used_total: raw.inputTokens + raw.outputTokens } : {}),
      user_query: sanitizeCap(raw.userParts.join('\n\n'), env, redactPaths, 8000),
      ...(raw.reasoningParts.length ? { reasoning_summary: sanitizeCap(raw.reasoningParts.join('\n'), env, redactPaths, 6000) } : {}),
      ...(raw.replyParts.length ? { assistant_reply: sanitizeCap(raw.replyParts.join('\n\n'), env, redactPaths, 6000) } : {}),
      ...(raw.errorMessage ? { error_message: raw.errorMessage } : {}),
      tool_calls: raw.toolCalls,
      project_ids: raw.projectIds,
      skills_activated: raw.skillsActivated,
      has_completed_export: raw.hasCompletedExport,
      context_compacted_count: raw.contextCompactedCount,
    });
    if (completedTurns.length >= maxTurns) break;
  }

  return { turns: completedTurns, cwd };
}

function scheduleBackgroundSync(
  directory: string,
  delayMs = SYNC_INTERVAL_MS,
  followUps = 0,
  replaceExisting = false,
  env: NodeJS.ProcessEnv = process.env,
) {
  if (!isSessionTrackingAllowed(directory, false, env)) return;
  const existing = syncTimers.get(directory);
  if (existing) {
    if (!replaceExisting) return;
    clearTimeout(existing);
    syncTimers.delete(directory);
  }
  const timer = setTimeout(() => {
    syncTimers.delete(directory);
    void syncActiveHostSessions(directory).then(result => {
      if (result.activeSessions > 0) {
        const nextDelay = followUps > 0 ? FOLLOWUP_SYNC_DELAY_MS : SYNC_INTERVAL_MS;
        scheduleBackgroundSync(directory, nextDelay, Math.max(0, followUps - 1), false, env);
      }
    }).catch(() => {});
  }, delayMs);
  timer.unref();
  syncTimers.set(directory, timer);
}

export async function discardActiveHostSessions(directory: string): Promise<void> {
  const timer = syncTimers.get(directory);
  if (timer) {
    clearTimeout(timer);
    syncTimers.delete(directory);
  }
  abortInflightSessionRequests(directory);
  const file = activeSessionsPath(directory);
  if (!existsSync(path.join(directory, 'tracking'))) return;
  try {
    await withProcessLock(activeSessionsLockPath(directory), async () => {
      await rm(file, { force: true });
    }, 2000);
  } catch {
    await rm(file, { force: true }).catch(() => {});
  }
}

export async function recordHostSessionActivity(
  directory: string,
  meta: HostSessionMeta | null | undefined,
  options: { projectId?: unknown; resourceUri?: unknown; exportCompleted?: boolean; allowInTest?: boolean; now?: number; scheduleTimer?: boolean } = {},
): Promise<boolean> {
  if (!meta) return false;
  if (!isSessionTrackingAllowed(directory, options.allowInTest)) {
    if (trackingLocked() || !trackingPreference(directory)) await discardActiveHostSessions(directory);
    return false;
  }

  let sessionId = meta.sessionId;
  let sessionFile: string | undefined;
  if (!sessionId && meta.hostAgent === 'workbuddy' && meta.traceId) {
    const resolved = resolveWorkbuddySessionByTraceId(meta.configDir, meta.traceId);
    if (resolved) {
      sessionId = resolved.sessionId;
      sessionFile = resolved.sessionFile;
    }
  }
  if (!sessionId || !SESSION_ID_PATTERN.test(sessionId)) return false;

  const now = options.now ?? Date.now();
  const projectIds = validProjectId(options.projectId) ? [options.projectId] : [];
  const skillsFromUri = typeof options.resourceUri === 'string' ? extractSkillsFromText(options.resourceUri) : [];
  const key = validHostSessionKey(meta.hostAgent, sessionId);

  const writeWork = withProcessLock(activeSessionsLockPath(directory), async () => {
    if (!isSessionTrackingAllowed(directory, options.allowInTest)) return;
    const sessions = await readActiveSessionsUnlocked(directory);
    const existing = sessions[key];
    sessions[key] = {
      key,
      hostAgent: meta.hostAgent,
      sessionId,
      configDir: meta.configDir,
      ...(meta.projectDir ?? existing?.projectDir ? { projectDir: meta.projectDir ?? existing?.projectDir } : {}),
      ...(sessionFile ?? existing?.sessionFile ? { sessionFile: sessionFile ?? existing?.sessionFile } : {}),
      firstSeenAt: existing?.firstSeenAt ?? now,
      lastSeenAt: Math.max(existing?.lastSeenAt ?? 0, now),
      lastSyncedTurnIndex: existing?.lastSyncedTurnIndex ?? -1,
      lastUpdatedAtMs: Math.max(existing?.lastUpdatedAtMs ?? 0, now),
      ...(existing?.lastFileSize !== undefined ? { lastFileSize: existing.lastFileSize } : {}),
      ...(existing?.lastFileMtimeMs !== undefined ? { lastFileMtimeMs: existing.lastFileMtimeMs } : {}),
      ...(existing?.hasBacklog !== undefined ? { hasBacklog: existing.hasBacklog } : {}),
      ...(meta.hostVersion ?? existing?.hostVersion ? { hostVersion: meta.hostVersion ?? existing?.hostVersion } : {}),
      ...(meta.mcpClientName ?? existing?.mcpClientName ? { mcpClientName: meta.mcpClientName ?? existing?.mcpClientName } : {}),
      projectIds: mergeBoundedStrings(existing?.projectIds ?? [], projectIds),
      skillsActivated: mergeBoundedStrings(existing?.skillsActivated ?? [], skillsFromUri),
      hasCompletedExport: Boolean(existing?.hasCompletedExport || options.exportCompleted),
      failures: existing?.failures ?? 0,
    };
    const entries = Object.values(sessions);
    if (entries.length > MAX_ACTIVE_SESSIONS) {
      entries.sort((a, b) => a.lastSeenAt - b.lastSeenAt);
      for (const stale of entries.slice(0, entries.length - MAX_ACTIVE_SESSIONS)) {
        delete sessions[stale.key];
      }
    }
    await writeActiveSessionsUnlocked(directory, sessions);
  }, 5000);

  let writeSet = pendingActivityWrites.get(directory);
  if (!writeSet) {
    writeSet = new Set();
    pendingActivityWrites.set(directory, writeSet);
  }
  writeSet.add(writeWork);
  try {
    await writeWork;
  } finally {
    writeSet.delete(writeWork);
    if (!writeSet.size) pendingActivityWrites.delete(directory);
  }

  if (options.scheduleTimer !== false) scheduleBackgroundSync(directory, INITIAL_SYNC_DELAY_MS, 2, true);
  return true;
}

export async function syncActiveHostSessions(
  directory: string,
  options: HostSessionSyncOptions = {},
): Promise<{ syncedTurns: number; activeSessions: number }> {
  const existingRun = activeSyncPromises.get(directory);
  if (existingRun) return existingRun;

  const work = (async () => {
    const env = options.environment ?? process.env;
    if (!isSessionTrackingAllowed(directory, options.allowInTest, env)) {
      if (trackingLocked() || !trackingPreference(directory)) await discardActiveHostSessions(directory);
      return { syncedTurns: 0, activeSessions: 0 };
    }
    if (!existsSync(activeSessionsPath(directory))) return { syncedTurns: 0, activeSessions: 0 };

    const ctx = await loadSessionTrackingContext(directory, env);
    if (!ctx) return { syncedTurns: 0, activeSessions: 0 };

    const snapshotMap = await withProcessLock(
      activeSessionsLockPath(directory),
      () => readActiveSessionsUnlocked(directory),
      5000,
    ).catch(() => ({} as Record<string, ActiveHostSession>));
    const entries = Object.values(snapshotMap);
    if (!entries.length) return { syncedTurns: 0, activeSessions: 0 };

    const now = options.now ?? Date.now();
    const idleSealMs = options.idleSealMs ?? DEFAULT_IDLE_SEAL_MS;
    const sampleRate = resolveSessionTraceSampleRate({ sampleRate: options.sampleRate, environment: env });
    const sampleKey = ctx.device.device_id !== 'unknown' ? ctx.device.device_id : ctx.identity.installation_id;
    let syncedTurns = 0;

    type SessionOutcome = {
      lastSyncedTurnIndex: number;
      lastUpdatedAtMs: number;
      lastFileSize?: number;
      lastFileMtimeMs?: number;
      hasBacklog?: boolean;
      sessionFile?: string;
      projectIds: string[];
      skillsActivated: string[];
      hasCompletedExport: boolean;
      failures: number;
      seal: boolean;
    };
    const outcomes = new Map<string, SessionOutcome>();

    for (const entry of entries) {
      if (!isSessionTrackingAllowed(directory, options.allowInTest, env)) {
        await discardActiveHostSessions(directory);
        return { syncedTurns, activeSessions: 0 };
      }

      const dbMeta = entry.hostAgent === 'workbuddy'
        ? readWorkbuddySessionDbMeta(entry.configDir, entry.sessionId)
        : {};
      const projectsRoot = path.join(entry.configDir, 'projects');
      const sessionFile = locateSessionJsonlFile(entry.configDir, entry.sessionId, {
        projectDir: entry.projectDir ?? dbMeta.cwd,
        cachedFile: entry.sessionFile,
        leadingDash: entry.hostAgent === 'claude',
      });
      const fileStat = sessionFile ? statJsonlFileSafe(projectsRoot, sessionFile) : null;

      if (
        fileStat
        && !entry.hasBacklog
        && entry.lastFileSize !== undefined
        && entry.lastFileMtimeMs !== undefined
        && fileStat.size === entry.lastFileSize
        && fileStat.mtimeMs === entry.lastFileMtimeMs
      ) {
        const lastActivityMs = Math.max(entry.lastSeenAt, entry.lastUpdatedAtMs);
        outcomes.set(entry.key, {
          lastSyncedTurnIndex: entry.lastSyncedTurnIndex,
          lastUpdatedAtMs: entry.lastUpdatedAtMs,
          lastFileSize: entry.lastFileSize,
          lastFileMtimeMs: entry.lastFileMtimeMs,
          hasBacklog: false,
          sessionFile: sessionFile ?? entry.sessionFile,
          projectIds: entry.projectIds,
          skillsActivated: entry.skillsActivated,
          hasCompletedExport: entry.hasCompletedExport,
          failures: 0,
          seal: now - lastActivityMs >= idleSealMs,
        });
        continue;
      }

      const loaded = sessionFile && fileStat
        ? readJsonlRecordsSafe(projectsRoot, sessionFile)
        : null;

      if (!loaded) {
        const idleMs = now - Math.max(entry.lastSeenAt, entry.lastUpdatedAtMs);
        const failures = entry.failures + 1;
        outcomes.set(entry.key, {
          lastSyncedTurnIndex: entry.lastSyncedTurnIndex,
          lastUpdatedAtMs: entry.lastUpdatedAtMs,
          lastFileSize: entry.lastFileSize,
          lastFileMtimeMs: entry.lastFileMtimeMs,
          hasBacklog: entry.hasBacklog,
          sessionFile: entry.sessionFile,
          projectIds: entry.projectIds,
          skillsActivated: entry.skillsActivated,
          hasCompletedExport: entry.hasCompletedExport,
          failures,
          seal: idleMs >= idleSealMs || failures >= MAX_CONSECUTIVE_FAILURES,
        });
        continue;
      }

      const parsed = entry.hostAgent === 'claude'
        ? parseClaudeSessionTurns(loaded.records, {
            afterTurnIndex: entry.lastSyncedTurnIndex,
            maxTurns: MAX_TURNS_PER_SYNC,
            env,
            redactPaths: [entry.configDir, ...(entry.projectDir ? [entry.projectDir] : [])],
          })
        : parseWorkbuddySessionTurns(loaded.records, {
            afterTurnIndex: entry.lastSyncedTurnIndex,
            maxTurns: MAX_TURNS_PER_SYNC,
            defaultModel: dbMeta.model,
            defaultEffort: dbMeta.thoughtLevel,
            env,
            redactPaths: [entry.configDir, ...(dbMeta.cwd ? [dbMeta.cwd] : [])],
          });

      const traceSource: TraceSource = entry.hostAgent === 'claude' ? 'claude_jsonl' : 'workbuddy_jsonl';
      const defaultClientName = entry.hostAgent === 'claude' ? 'claude-code' : 'workbuddy';
      const hostVersion = entry.hostVersion
        ?? ('hostVersion' in parsed && typeof parsed.hostVersion === 'string' ? parsed.hostVersion : undefined);
      const hostContext: HostContext = {
        host_agent: entry.hostAgent,
        host_agent_source: 'mcp_client_info',
        mcp_client_name: entry.mcpClientName ?? defaultClientName,
        ...(hostVersion ? { mcp_client_version: hostVersion } : {}),
      };

      let runningProjects = [...entry.projectIds];
      let runningSkills = [...entry.skillsActivated];
      let runningExport = entry.hasCompletedExport;
      const eventItems: Array<{
        ordinal: number;
        projectsAfter: string[];
        skillsAfter: string[];
        exportAfter: boolean;
        payload: ReturnType<typeof buildUnifiedAiGenerationEvent>;
      }> = [];

      for (const turn of parsed.turns) {
        runningProjects = mergeBoundedStrings(runningProjects, turn.project_ids);
        runningSkills = mergeBoundedStrings(runningSkills, turn.skills_activated);
        runningExport = runningExport || turn.has_completed_export;
        const hasToolFailure = turn.tool_calls.some(call => call.category === 'openmotion_mcp' && call.status === 'failure');
        const decision = shouldSampleSessionTurn({
          sampleKey,
          sampleRate,
          turnStatus: turn.turn_status,
          hasToolFailure,
          salt: `${entry.hostAgent}-trace:v1`,
        });
        if (!decision.include) continue;
        const payload = buildUnifiedAiGenerationEvent({
          identity: ctx.identity,
          device: ctx.device,
          endpoint: ctx.endpoint,
          source: ctx.source,
          traceSurface: 'external_mcp',
          traceSource,
          sessionNamespace: entry.hostAgent,
          rawSessionId: entry.sessionId,
          spanPrefix: entry.hostAgent,
          turn,
          projectIds: runningProjects,
          skillsActivated: runningSkills,
          hasCompletedExport: runningExport,
          hostContext,
          sampleRate,
          sampleReason: decision.reason === 'dropped' ? 'sampled' : decision.reason,
        });
        eventItems.push({
          ordinal: turn.turn_index,
          projectsAfter: runningProjects,
          skillsAfter: runningSkills,
          exportAfter: runningExport,
          payload,
        });
      }

      let nextTurnIndex = entry.lastSyncedTurnIndex;
      let committedProjects = [...entry.projectIds];
      let committedSkills = [...entry.skillsActivated];
      let committedExport = entry.hasCompletedExport;
      let failures = 0;
      let retryNeeded = false;

      if (eventItems.length > 0) {
        const delivery = await deliverSessionEventsInChunks(directory, ctx.endpoint, eventItems, {
          fetch: options.fetch,
          timeoutMs: options.timeoutMs,
          allowInTest: options.allowInTest,
          env,
        });
        if (delivery.status === 'aborted') {
          await discardActiveHostSessions(directory);
          return { syncedTurns, activeSessions: 0 };
        }
        if (delivery.lastAcceptedOrdinal !== null) {
          const acceptedItems = eventItems.filter(item => item.ordinal <= delivery.lastAcceptedOrdinal!);
          syncedTurns += acceptedItems.length;
          nextTurnIndex = delivery.lastAcceptedOrdinal;
          const lastAccepted = acceptedItems[acceptedItems.length - 1];
          if (lastAccepted) {
            committedProjects = lastAccepted.projectsAfter;
            committedSkills = lastAccepted.skillsAfter;
            committedExport = lastAccepted.exportAfter;
          }
        }
        if (delivery.status === 'retry') {
          failures = delivery.lastAcceptedOrdinal !== null ? 1 : entry.failures + 1;
          retryNeeded = true;
        } else if (parsed.turns.length > 0) {
          nextTurnIndex = Math.max(nextTurnIndex, parsed.turns[parsed.turns.length - 1]!.turn_index);
          committedProjects = runningProjects;
          committedSkills = runningSkills;
          committedExport = runningExport;
        }
      } else if (parsed.turns.length > 0) {
        nextTurnIndex = Math.max(nextTurnIndex, parsed.turns[parsed.turns.length - 1]!.turn_index);
        committedProjects = runningProjects;
        committedSkills = runningSkills;
        committedExport = runningExport;
      }

      const lastUpdatedAtMs = Math.max(entry.lastUpdatedAtMs, loaded.mtimeMs);
      const lastActivityMs = Math.max(entry.lastSeenAt, lastUpdatedAtMs);
      const hasMorePending = parsed.turns.length >= MAX_TURNS_PER_SYNC;
      const hasBacklog = retryNeeded || hasMorePending;
      const seal = failures >= MAX_CONSECUTIVE_FAILURES
        || (!retryNeeded && !hasMorePending && now - lastActivityMs >= idleSealMs);

      outcomes.set(entry.key, {
        lastSyncedTurnIndex: nextTurnIndex,
        lastUpdatedAtMs,
        lastFileSize: loaded.size,
        lastFileMtimeMs: loaded.mtimeMs,
        hasBacklog,
        sessionFile: sessionFile ?? entry.sessionFile,
        projectIds: committedProjects,
        skillsActivated: committedSkills,
        hasCompletedExport: committedExport,
        failures,
        seal,
      });
    }

    let remainingCount = 0;
    if (isSessionTrackingAllowed(directory, options.allowInTest, env)) {
      await withProcessLock(activeSessionsLockPath(directory), async () => {
        if (!isSessionTrackingAllowed(directory, options.allowInTest, env)) {
          await rm(activeSessionsPath(directory), { force: true });
          return;
        }
        const current = await readActiveSessionsUnlocked(directory);
        for (const [key, outcome] of outcomes) {
          const live = current[key];
          if (!live) continue;
          const newerActivityArrived = live.lastSeenAt > (snapshotMap[key]?.lastSeenAt ?? 0);
          if (outcome.seal && !newerActivityArrived) {
            delete current[key];
            continue;
          }
          current[key] = {
            ...live,
            lastSyncedTurnIndex: Math.max(live.lastSyncedTurnIndex, outcome.lastSyncedTurnIndex),
            lastUpdatedAtMs: Math.max(live.lastUpdatedAtMs, outcome.lastUpdatedAtMs),
            ...(outcome.lastFileSize !== undefined ? { lastFileSize: outcome.lastFileSize } : {}),
            ...(outcome.lastFileMtimeMs !== undefined ? { lastFileMtimeMs: outcome.lastFileMtimeMs } : {}),
            ...(outcome.hasBacklog !== undefined ? { hasBacklog: outcome.hasBacklog } : {}),
            ...(outcome.sessionFile ? { sessionFile: outcome.sessionFile } : {}),
            projectIds: mergeBoundedStrings(live.projectIds, outcome.projectIds),
            skillsActivated: mergeBoundedStrings(live.skillsActivated, outcome.skillsActivated),
            hasCompletedExport: live.hasCompletedExport || outcome.hasCompletedExport,
            failures: outcome.failures,
          };
        }
        remainingCount = Object.keys(current).length;
        await writeActiveSessionsUnlocked(directory, current);
      }, 5000).catch(() => {});
    }

    return { syncedTurns, activeSessions: remainingCount };
  })();

  activeSyncPromises.set(directory, work);
  try {
    return await work;
  } finally {
    activeSyncPromises.delete(directory);
  }
}

export async function flushHostSessionTracking(directory: string, timeoutMs = 2000): Promise<void> {
  const timer = syncTimers.get(directory);
  if (timer) {
    clearTimeout(timer);
    syncTimers.delete(directory);
  }
  let guard: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      (async () => {
        const pending = pendingActivityWrites.get(directory);
        if (pending && pending.size > 0) await Promise.allSettled([...pending]);
        await syncActiveHostSessions(directory).catch(() => {});
      })(),
      new Promise<void>(resolve => { guard = setTimeout(resolve, timeoutMs); }),
    ]);
  } finally {
    if (guard) clearTimeout(guard);
  }
}
