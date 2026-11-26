import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import {
  discardActiveHostSessions,
  extractHostSessionMeta,
  parseClaudeSessionTurns,
  recordHostSessionActivity,
  syncActiveHostSessions,
} from '../shared/host-session-tracking.ts';
import { recordSuperAgentTurnTrace } from '../shared/super-agent-session-tracking.ts';
import { saveTrackingPreference } from '../shared/tracking.ts';
import { identifyHost, normalizeEngineToHostAgent } from '../tracking/host.ts';
import { uuid } from '../tracking/core.ts';

async function tempDir(t: test.TestContext, prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

function withTrackingTestEnv(t: test.TestContext, overrides: Record<string, string | undefined>) {
  const keys = [
    'CLAUDE_CONFIG_DIR',
    'CLAUDE_CODE_SESSION_ID',
    'CLAUDE_PROJECT_DIR',
    'WORKBUDDY_CONFIG_DIR',
    'WORKBUDDY_SESSION_ID',
    'OPENMOTION_TELEMETRY',
    'DO_NOT_TRACK',
    'OPENMOTION_TRACKING_ENV',
    'OPENMOTION_TRACKING_TEST_RUN_ID',
    'OPENMOTION_POSTHOG_HOST',
    'OPENMOTION_POSTHOG_KEY',
    'OPENMOTION_GEOIP',
    'OPENMOTION_LLM_TRACE_SAMPLE_RATE',
    'SECRET_PROVIDER_TOKEN',
  ];
  const saved = new Map<string, string | undefined>();
  for (const key of keys) saved.set(key, process.env[key]);
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  t.after(() => {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

test('identifyHost attributes WorkBuddy placeholder openmotion client and env markers without guessing', () => {
  assert.deepEqual(
    identifyHost({ name: 'openmotion', version: '1.0.0' }, { OPENMOTION_HOST_AGENT: 'workbuddy' }),
    { host_agent: 'workbuddy', host_agent_source: 'launch_environment', mcp_client_name: 'openmotion', mcp_client_version: '1.0.0' },
  );
  assert.deepEqual(
    identifyHost({ name: 'openmotion', version: '1.0.0' }, { CODEBUDDY_SANDBOX_BROKER_IPC_ADDRESS: '/tmp/wb.sock' }),
    { host_agent: 'workbuddy', host_agent_source: 'launch_environment', mcp_client_name: 'openmotion', mcp_client_version: '1.0.0' },
  );
  assert.deepEqual(
    identifyHost({ name: 'openmotion', version: '1.0.0' }, {}),
    { host_agent: 'other', host_agent_source: 'mcp_client_info', mcp_client_name: 'openmotion', mcp_client_version: '1.0.0' },
  );
  assert.equal(identifyHost({ name: 'wb', version: '1' }).host_agent, 'workbuddy');
  assert.equal(identifyHost({ name: 'wb-cli', version: '1' }).host_agent, 'workbuddy');
  assert.equal(identifyHost({ name: 'workbuddy-flow', version: '1.0' }).host_agent, 'workbuddy');
  assert.equal(identifyHost({ name: 'workbuddy-export', version: '1.0' }).host_agent, 'workbuddy');
  assert.equal(identifyHost({ name: 'hermes-script', version: '1' }).host_agent, 'hermes');
  assert.equal(identifyHost({ name: 'openmotion-cli', version: '1' }, { CLAUDE_CODE_SESSION_ID: 'abc12345' }).host_agent, 'claude');
  assert.equal(identifyHost({ name: 'openmotion-cli', version: '1' }, { CURSOR_TRACE_ID: 'trace-1' }).host_agent, 'cursor');
  assert.equal(normalizeEngineToHostAgent('deepseek-harness'), 'deepseek');
  assert.equal(normalizeEngineToHostAgent('cursor-agent'), 'cursor');
  assert.equal(normalizeEngineToHostAgent('trae-cli'), 'trae');
  assert.equal(normalizeEngineToHostAgent('codex'), 'codex');
  assert.equal(normalizeEngineToHostAgent('claude'), 'claude');
});

test('Claude Code session tracking activates via CLAUDE_CODE_SESSION_ID, aggregates per user turn, deduplicates streaming usage, and isolates unrelated sessions', async t => {
  const root = await tempDir(t, 'om-claude-session-');
  const dataDir = path.join(root, 'motion-data');
  const claudeDir = path.join(root, 'claude-home');
  const projectDir = path.join(root, 'secret-project');
  const encodedSlug = projectDir.replace(/[^A-Za-z0-9]/g, '-');
  const projectSessionsDir = path.join(claudeDir, 'projects', encodedSlug);
  await mkdir(dataDir, { recursive: true });
  await mkdir(projectSessionsDir, { recursive: true });

  const testRunId = crypto.randomUUID();
  const activeSessionId = '96c8a8ea-9f93-4397-ad67-63175c5252ef';
  const unrelatedSessionId = '11111111-2222-4333-8444-555555555555';
  const projectId = crypto.randomUUID();

  withTrackingTestEnv(t, {
    CLAUDE_CONFIG_DIR: claudeDir,
    CLAUDE_CODE_SESSION_ID: activeSessionId,
    CLAUDE_PROJECT_DIR: projectDir,
    OPENMOTION_TELEMETRY: undefined,
    DO_NOT_TRACK: undefined,
    OPENMOTION_TRACKING_ENV: 'test',
    OPENMOTION_TRACKING_TEST_RUN_ID: testRunId,
    OPENMOTION_POSTHOG_HOST: 'http://127.0.0.1:59998',
    OPENMOTION_POSTHOG_KEY: 'phc_test_claude_session_12345',
    OPENMOTION_GEOIP: '0',
    SECRET_PROVIDER_TOKEN: 'sk-live-secret-claude-9999',
  });

  // Unrelated session that never called OpenMotion must never be read or uploaded.
  await writeFile(
    path.join(projectSessionsDir, `${unrelatedSessionId}.jsonl`),
    JSON.stringify({
      type: 'user',
      uuid: 'u-unrelated-1',
      sessionId: unrelatedSessionId,
      cwd: projectDir,
      version: '2.1.326',
      timestamp: '2026-11-26T10:00:00.000Z',
      message: { role: 'user', content: 'Private HR salary sheet do not upload' },
    }) + '\n'
    + JSON.stringify({
      type: 'assistant',
      uuid: 'a-unrelated-1',
      sessionId: unrelatedSessionId,
      timestamp: '2026-11-26T10:00:05.000Z',
      message: { id: 'msg_unrel', role: 'assistant', model: 'claude-sonnet-4-6', stop_reason: 'end_turn', content: [{ type: 'text', text: 'Done' }] },
    }) + '\n',
  );

  const sessionFile = path.join(projectSessionsDir, `${activeSessionId}.jsonl`);
  const turn1Lines = [
    {
      type: 'user',
      uuid: 'turn-u-1',
      sessionId: activeSessionId,
      cwd: projectDir,
      version: '2.1.326',
      timestamp: '2026-11-26T10:01:00.000Z',
      message: { role: 'user', content: `Make a launch video using key sk-live-secret-claude-9999 from ${projectDir}` },
    },
    // Streaming chunk 1 (thinking + tool_use, same message.id as chunk 2 to test usage dedup)
    {
      type: 'assistant',
      uuid: 'turn-a-1a',
      sessionId: activeSessionId,
      perTurnEffort: 'high',
      timestamp: '2026-11-26T10:01:02.000Z',
      message: {
        id: 'msg_01',
        role: 'assistant',
        model: 'claude-opus-4-6',
        stop_reason: null,
        usage: { input_tokens: 1200, cache_read_input_tokens: 300, output_tokens: 150 },
        content: [
          { type: 'thinking', thinking: 'Inspect project and edit scene' },
        ],
      },
    },
    {
      type: 'assistant',
      uuid: 'turn-a-1b',
      sessionId: activeSessionId,
      perTurnEffort: 'high',
      timestamp: '2026-11-26T10:01:04.000Z',
      message: {
        id: 'msg_01',
        role: 'assistant',
        model: 'claude-opus-4-6',
        stop_reason: 'tool_use',
        usage: { input_tokens: 1200, cache_read_input_tokens: 300, output_tokens: 220 },
        content: [
          { type: 'tool_use', id: 'toolu_om_1', name: 'mcp__openmotion__openmotion_edit_project', input: { projectId, files: [{ path: 'index.html', content: '<div>SECRET_HTML_SOURCE</div>' }] } },
          { type: 'tool_use', id: 'toolu_bash_1', name: 'Bash', input: { command: 'cat ~/.claude/skills/openmotion-video/SKILL.md' } },
        ],
      },
    },
    // Pure tool_result user record must NOT split into a second turn
    {
      type: 'user',
      uuid: 'turn-tr-1',
      sessionId: activeSessionId,
      timestamp: '2026-11-26T10:01:06.000Z',
      message: {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'toolu_om_1', content: JSON.stringify({ structuredContent: { projectId, status: 'applied' } }) },
          { type: 'tool_result', tool_use_id: 'toolu_bash_1', content: 'PRIVATE_SHELL_STDOUT_SHOULD_NOT_UPLOAD # openmotion-video' },
        ],
      },
    },
    {
      type: 'assistant',
      uuid: 'turn-a-2',
      sessionId: activeSessionId,
      perTurnEffort: 'high',
      timestamp: '2026-11-26T10:01:10.000Z',
      message: {
        id: 'msg_02',
        role: 'assistant',
        model: 'claude-opus-4-6',
        stop_reason: 'end_turn',
        usage: { input_tokens: 500, output_tokens: 80 },
        content: [{ type: 'text', text: 'Updated your video scene and verified timeline.' }],
      },
    },
    // Turn 2 is still in-progress (stop_reason = tool_use without tool_result) -> must NOT emit yet
    {
      type: 'user',
      uuid: 'turn-u-2',
      sessionId: activeSessionId,
      timestamp: '2026-11-26T10:02:00.000Z',
      message: { role: 'user', content: 'Now export MP4' },
    },
    {
      type: 'assistant',
      uuid: 'turn-a-3',
      sessionId: activeSessionId,
      timestamp: '2026-11-26T10:02:03.000Z',
      message: {
        id: 'msg_03',
        role: 'assistant',
        model: 'claude-opus-4-6',
        stop_reason: 'tool_use',
        usage: { input_tokens: 600, output_tokens: 60 },
        content: [{ type: 'tool_use', id: 'toolu_export_1', name: 'mcp__openmotion__openmotion_export_request', input: { projectId } }],
      },
    },
  ];
  await writeFile(sessionFile, turn1Lines.map(l => JSON.stringify(l)).join('\n') + '\n');

  const claudeHost = { host_agent: 'claude', host_agent_source: 'mcp_client_info', mcp_client_name: 'claude-code', mcp_client_version: '2.1.326' } as const;
  const meta = extractHostSessionMeta({ name: 'openmotion_edit_project', arguments: { projectId } }, claudeHost, process.env);
  assert.ok(meta);
  assert.equal(meta.hostAgent, 'claude');
  assert.equal(meta.sessionId, activeSessionId);

  const recorded = await recordHostSessionActivity(dataDir, meta, { projectId, allowInTest: true, scheduleTimer: false });
  assert.equal(recorded, true);

  const sentBatches: any[] = [];
  const fakeFetch: typeof fetch = async (_url, init) => {
    sentBatches.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ status: 1 }), { status: 200 });
  };

  const firstSync = await syncActiveHostSessions(dataDir, { allowInTest: true, fetch: fakeFetch });
  assert.equal(firstSync.syncedTurns, 1);
  assert.equal(firstSync.activeSessions, 1);

  const events1 = sentBatches.flatMap(b => b.batch);
  assert.equal(events1.length, 1);
  const ev = events1[0];
  assert.equal(ev.event, '$ai_generation');
  assert(uuid.test(ev.uuid));
  assert.equal(ev.properties.trace_surface, 'external_mcp');
  assert.equal(ev.properties.trace_source, 'claude_jsonl');
  assert.equal(ev.properties.host_agent, 'claude');
  assert.equal(ev.properties.mcp_client_name, 'claude-code');
  assert.equal(ev.properties.mcp_client_version, '2.1.326');
  assert.match(ev.properties.$ai_session_id, /^claude:[a-f0-9]{32}$/);
  assert.equal(ev.properties.$ai_model, 'claude-opus-4-6');
  assert.equal(ev.properties.$ai_provider, 'anthropic');
  assert.equal(ev.properties.reasoning_effort, 'high');
  // Deduplicated usage: msg_01 (1200+300=1500 in, 220 out) + msg_02 (500 in, 80 out) = 2000 in, 300 out
  assert.equal(ev.properties.$ai_input_tokens, 2000);
  assert.equal(ev.properties.$ai_output_tokens, 300);
  assert.equal(ev.properties.mcp_call_count, 1);
  assert.equal(ev.properties.mcp_failure_count, 0);
  assert.equal(ev.properties.skill_read_count, 1);
  assert.deepEqual(ev.properties.skills_activated, ['openmotion-video']);
  assert.deepEqual(ev.properties.project_ids, [projectId]);

  const serialized = JSON.stringify(ev);
  assert.equal(serialized.includes(activeSessionId), false, 'raw sessionId must never be sent');
  assert.equal(serialized.includes('sk-live-secret-claude-9999'), false, 'secrets must be redacted');
  assert.equal(serialized.includes('SECRET_HTML_SOURCE'), false, 'file contents must be stripped');
  assert.equal(serialized.includes('PRIVATE_SHELL_STDOUT_SHOULD_NOT_UPLOAD'), false, 'shell stdout must never be uploaded');
  assert.equal(serialized.includes('Private HR salary sheet'), false, 'unrelated session must never be read');

  // Now complete Turn 2 and verify incremental sync only sends Turn 2.
  const turn2Completion = [
    {
      type: 'user',
      uuid: 'turn-tr-2',
      sessionId: activeSessionId,
      timestamp: '2026-11-26T10:02:15.000Z',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'toolu_export_1', content: JSON.stringify({ structuredContent: { job: { state: 'completed' } } }) }],
      },
    },
    {
      type: 'assistant',
      uuid: 'turn-a-4',
      sessionId: activeSessionId,
      timestamp: '2026-11-26T10:02:20.000Z',
      message: {
        id: 'msg_04',
        role: 'assistant',
        model: 'claude-opus-4-6',
        stop_reason: 'end_turn',
        usage: { input_tokens: 400, output_tokens: 50 },
        content: [{ type: 'text', text: 'Export completed!' }],
      },
    },
  ];
  await writeFile(sessionFile, [...turn1Lines, ...turn2Completion].map(l => JSON.stringify(l)).join('\n') + '\n');

  const secondSync = await syncActiveHostSessions(dataDir, { allowInTest: true, fetch: fakeFetch });
  assert.equal(secondSync.syncedTurns, 1);
  const ev2 = sentBatches[1].batch[0];
  assert.equal(ev2.properties.turn_index, 1);
  assert.equal(ev2.properties.has_completed_export, true);
  assert.equal(ev2.properties.$ai_session_id, ev.properties.$ai_session_id);
  assert.notEqual(ev2.uuid, ev.uuid);

  // Turning privacy off immediately purges active-host-sessions.json and stops all reporting.
  await saveTrackingPreference(dataDir, false);
  assert.equal(existsSync(path.join(dataDir, 'tracking/active-host-sessions.json')), false);
  let fetchCallsAfterOptOut = 0;
  const optOutSync = await syncActiveHostSessions(dataDir, {
    allowInTest: true,
    fetch: async () => { fetchCallsAfterOptOut += 1; return new Response('{"status":1}', { status: 200 }); },
  });
  assert.equal(optOutSync.syncedTurns, 0);
  assert.equal(fetchCallsAfterOptOut, 0);
});

test('WorkBuddy session tracking resolves session by W3C traceparent via workbuddy.db and parses native JSONL schema', async t => {
  const root = await tempDir(t, 'om-workbuddy-session-');
  const dataDir = path.join(root, 'motion-data');
  const wbDir = path.join(root, 'workbuddy-home');
  const cwd = path.join(root, 'WorkBuddy-2026-11-27');
  const slugDir = cwd.replace(/[^A-Za-z0-9]/g, '-').replace(/^-+/, '');
  const projDir = path.join(wbDir, 'projects', slugDir);
  await mkdir(dataDir, { recursive: true });
  await mkdir(projDir, { recursive: true });

  const testRunId = crypto.randomUUID();
  const wbSessionId = '6bce7929-7e32-4178-b3ed-6aa199e39d23';
  const traceId = '4e5e6e31d93146c3ab2411add5c62c6b';
  const projectId = crypto.randomUUID();

  withTrackingTestEnv(t, {
    WORKBUDDY_CONFIG_DIR: wbDir,
    OPENMOTION_TELEMETRY: undefined,
    DO_NOT_TRACK: undefined,
    OPENMOTION_TRACKING_ENV: 'test',
    OPENMOTION_TRACKING_TEST_RUN_ID: testRunId,
    OPENMOTION_POSTHOG_HOST: 'http://127.0.0.1:59997',
    OPENMOTION_POSTHOG_KEY: 'phc_test_wb_session_12345',
    OPENMOTION_GEOIP: '0',
  });

  const db = new DatabaseSync(path.join(wbDir, 'workbuddy.db'));
  db.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      cwd TEXT NOT NULL,
      model TEXT,
      thought_level TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_activity_at INTEGER,
      deleted_at INTEGER
    );
  `);
  const nowSec = Math.floor(Date.now() / 1000);
  db.prepare('INSERT INTO sessions VALUES (?, ?, ?, ?, ?, ?, ?, NULL)').run(
    wbSessionId, cwd, 'hy4', 'medium', nowSec - 60, nowSec, nowSec,
  );
  db.close();

  const wbLines = [
    { type: 'session-meta', id: 'm0', sessionId: wbSessionId, timestamp: '2026-11-26T11:00:00.000Z', meta: { 'codebuddy.ai/hostKind': 'workbuddy' } },
    { type: 'message', id: 'wb-u-1', role: 'user', sessionId: wbSessionId, cwd, timestamp: '2026-11-26T11:00:01.000Z', content: 'Build a promo video in OpenMotion', _meta: { traceparent: `00-${traceId}-0000000000000001-01` } },
    { type: 'reasoning', id: 'wb-r-1', sessionId: wbSessionId, cwd, timestamp: '2026-11-26T11:00:02.000Z', content: 'Calling OpenMotion MCP tool', providerData: { model: 'hy4', traceId } },
    {
      type: 'function_call',
      id: 'wb-fc-1',
      callId: 'call_om_1',
      name: 'mcp__openmotion__openmotion_create_project',
      arguments: JSON.stringify({ projectId, prompt: 'promo' }),
      sessionId: wbSessionId,
      cwd,
      timestamp: '2026-11-26T11:00:03.000Z',
      message: { usage: { input_tokens: 900, output_tokens: 120 } },
      providerData: { model: 'hy4', traceId },
      _meta: { traceparent: `00-${traceId}-0000000000000002-01` },
    },
    {
      type: 'function_call_result',
      id: 'wb-fcr-1',
      callId: 'call_om_1',
      name: 'mcp__openmotion__openmotion_create_project',
      output: JSON.stringify({ structuredContent: { projectId, status: 'applied' } }),
      status: 'completed',
      sessionId: wbSessionId,
      cwd,
      timestamp: '2026-11-26T11:00:05.000Z',
    },
    {
      type: 'message',
      id: 'wb-a-1',
      role: 'assistant',
      status: 'completed',
      sessionId: wbSessionId,
      cwd,
      timestamp: '2026-11-26T11:00:08.000Z',
      content: 'Your promo project is ready.',
      providerData: { model: 'hy4', traceId },
    },
  ];
  await writeFile(path.join(projDir, `${wbSessionId}.jsonl`), wbLines.map(l => JSON.stringify(l)).join('\n') + '\n');

  const wbHost = { host_agent: 'workbuddy', host_agent_source: 'launch_environment', mcp_client_name: 'openmotion', mcp_client_version: '1.0.0' } as const;
  const meta = extractHostSessionMeta(
    { _meta: { traceparent: `00-${traceId}-1234567890abcdef-01` } },
    wbHost,
    process.env,
  );
  assert.ok(meta);
  assert.equal(meta.hostAgent, 'workbuddy');
  assert.equal(meta.traceId, traceId);

  assert.equal(await recordHostSessionActivity(dataDir, meta, { projectId, allowInTest: true, scheduleTimer: false }), true);

  const sent: any[] = [];
  const sync = await syncActiveHostSessions(dataDir, {
    allowInTest: true,
    fetch: async (_url, init) => {
      sent.push(...JSON.parse(String(init?.body)).batch);
      return new Response('{"status":1}', { status: 200 });
    },
  });
  assert.equal(sync.syncedTurns, 1);
  assert.equal(sent.length, 1);
  const ev = sent[0];
  assert.equal(ev.properties.trace_surface, 'external_mcp');
  assert.equal(ev.properties.trace_source, 'workbuddy_jsonl');
  assert.equal(ev.properties.host_agent, 'workbuddy');
  assert.match(ev.properties.$ai_session_id, /^workbuddy:[a-f0-9]{32}$/);
  assert.equal(ev.properties.$ai_model, 'hy4');
  assert.equal(ev.properties.$ai_provider, 'tencent');
  assert.equal(ev.properties.reasoning_effort, 'medium');
  assert.equal(ev.properties.$ai_input_tokens, 900);
  assert.equal(ev.properties.$ai_output_tokens, 120);
  assert.equal(ev.properties.mcp_call_count, 1);
  assert.equal(JSON.stringify(ev).includes(wbSessionId), false);

  await discardActiveHostSessions(dataDir);
});

test('Studio Super Agent emits unified $ai_generation traces across engines with redaction, deterministic sampling, and opt-out enforcement', async t => {
  const root = await tempDir(t, 'om-sa-trace-');
  const dataDir = path.join(root, 'motion-data');
  await mkdir(dataDir, { recursive: true });
  const testRunId = crypto.randomUUID();
  const projectId = crypto.randomUUID();

  withTrackingTestEnv(t, {
    OPENMOTION_TELEMETRY: undefined,
    DO_NOT_TRACK: undefined,
    OPENMOTION_TRACKING_ENV: 'test',
    OPENMOTION_TRACKING_TEST_RUN_ID: testRunId,
    OPENMOTION_POSTHOG_HOST: 'http://127.0.0.1:59996',
    OPENMOTION_POSTHOG_KEY: 'phc_test_super_agent_12345',
    OPENMOTION_GEOIP: '0',
    SECRET_PROVIDER_TOKEN: 'sk-sa-secret-778899',
  });

  const sent: any[] = [];
  const fakeFetch: typeof fetch = async (_url, init) => {
    sent.push(...JSON.parse(String(init?.body)).batch);
    return new Response('{"status":1}', { status: 200 });
  };

  const baseChat = {
    id: 'chat-super-agent-001',
    engine: 'deepseek-harness',
    model: 'deepseek-reasoner',
    reasoning: 'high',
    intent: 'game' as const,
    workingDir: path.join(root, 'game-workspace'),
    artifacts: [],
    messages: [
      { id: 'u1', role: 'user' as const, text: 'Build a neon arcade game using token sk-sa-secret-778899', createdAt: 1000 },
    ],
  };

  const turnMessages = [
    { id: 'r1', role: 'reasoning' as const, text: 'Plan arcade loop', createdAt: 1100 },
    {
      id: 't1',
      role: 'tool' as const,
      text: 'openmotion_game_write_files',
      createdAt: 1200,
      toolEvent: {
        callId: 'c1',
        tool: 'openmotion_game_write_files',
        label: 'Write game files',
        status: 'completed' as const,
        category: 'mcp' as const,
        inputPreview: JSON.stringify({ id: 'game-neon-1', files: [{ path: 'index.html', content: '<script>SECRET_GAME_CODE</script>' }] }),
        outputPreview: JSON.stringify({ projectId, status: 'ready' }),
        startedAt: 1200,
        finishedAt: 1500,
        durationMs: 300,
      },
    },
    {
      id: 't2',
      role: 'tool' as const,
      text: 'Bash',
      createdAt: 1600,
      toolEvent: {
        callId: 'c2',
        tool: 'bash',
        label: 'Run check',
        status: 'completed' as const,
        category: 'command' as const,
        command: 'npm test',
        outputPreview: 'PRIVATE_TERMINAL_OUTPUT_MUST_NOT_LEAK',
        startedAt: 1600,
        finishedAt: 1900,
        durationMs: 300,
      },
    },
    { id: 'a1', role: 'assistant' as const, text: 'Your neon arcade game is ready to play!', createdAt: 2000 },
  ];

  const r1 = await recordSuperAgentTurnTrace(dataDir, {
    chat: baseChat,
    turnUserMessageId: 'u1',
    turnMessages,
    runtimeKind: 'local-direct',
    safeEngine: 'deepseek-harness',
    safeIntent: 'game',
    effectiveModel: 'deepseek-reasoner',
    outcome: 'completed',
    startedAt: 1000,
    finishedAt: 2200,
    durationMs: 1200,
    usage: { inputTokens: 1500, outputTokens: 450, totalTokens: 1950 },
    touchedProjectIds: [projectId],
    touchedGameIds: ['game-neon-1'],
  }, { allowInTest: true, fetch: fakeFetch });

  assert.equal(r1.sent, true);
  assert.equal(sent.length, 1);
  const ev = sent[0];
  assert.equal(ev.event, '$ai_generation');
  assert.equal(ev.properties.trace_surface, 'studio_super_agent');
  assert.equal(ev.properties.trace_source, 'super_agent_runtime');
  assert.equal(ev.properties.host_agent, 'deepseek');
  assert.equal(ev.properties.super_agent_engine, 'deepseek-harness');
  assert.equal(ev.properties.super_agent_runtime_kind, 'local-direct');
  assert.equal(ev.properties.super_agent_intent, 'game');
  assert.match(ev.properties.$ai_session_id, /^super-agent:[a-f0-9]{32}$/);
  assert.equal(ev.properties.$ai_model, 'deepseek-reasoner');
  assert.equal(ev.properties.$ai_provider, 'deepseek');
  assert.equal(ev.properties.$ai_input_tokens, 1500);
  assert.equal(ev.properties.$ai_output_tokens, 450);
  assert.equal(ev.properties.mcp_call_count, 1);
  assert.deepEqual(ev.properties.game_ids, ['game-neon-1']);
  assert.deepEqual(ev.properties.project_ids, [projectId]);

  const json = JSON.stringify(ev);
  assert.equal(json.includes('sk-sa-secret-778899'), false);
  assert.equal(json.includes('SECRET_GAME_CODE'), false);
  assert.equal(json.includes('PRIVATE_TERMINAL_OUTPUT_MUST_NOT_LEAK'), false);
  assert.equal(json.includes('chat-super-agent-001'), false);

  // Sample rate 0 drops clean turns, but forces retention on failed turns.
  const dropped = await recordSuperAgentTurnTrace(dataDir, {
    chat: baseChat,
    turnUserMessageId: 'u2',
    turnMessages: [],
    runtimeKind: 'local-direct',
    safeEngine: 'codex',
    safeIntent: 'game',
    outcome: 'completed',
    startedAt: 3000,
    finishedAt: 3500,
    durationMs: 500,
  }, { allowInTest: true, fetch: fakeFetch, sampleRate: 0 });
  assert.equal(dropped.sent, false);
  assert.equal(dropped.reason, 'dropped');

  const forced = await recordSuperAgentTurnTrace(dataDir, {
    chat: { ...baseChat, engine: 'codex' },
    turnUserMessageId: 'u3',
    turnMessages: [],
    runtimeKind: 'local-direct',
    safeEngine: 'codex',
    safeIntent: 'game',
    outcome: 'failed',
    startedAt: 4000,
    finishedAt: 4500,
    durationMs: 500,
    error: 'TOOL_TIMEOUT',
  }, { allowInTest: true, fetch: fakeFetch, sampleRate: 0 });
  assert.equal(forced.sent, true);
  assert.equal(sent.length, 2);
  assert.equal(sent[1].properties.trace_sample_reason, 'error_forced');
  assert.equal(sent[1].properties.host_agent, 'codex');

  // Opt-out blocks delivery with zero network calls.
  await saveTrackingPreference(dataDir, false);
  let callsAfterOptOut = 0;
  const blocked = await recordSuperAgentTurnTrace(dataDir, {
    chat: baseChat,
    turnUserMessageId: 'u4',
    turnMessages: [],
    runtimeKind: 'local-direct',
    safeEngine: 'claude',
    safeIntent: 'game',
    outcome: 'completed',
    startedAt: 5000,
    finishedAt: 5500,
    durationMs: 500,
  }, {
    allowInTest: true,
    fetch: async () => { callsAfterOptOut += 1; return new Response('{"status":1}', { status: 200 }); },
  });
  assert.equal(blocked.sent, false);
  assert.equal(blocked.reason, 'disabled');
  assert.equal(callsAfterOptOut, 0);
});

test('parseClaudeSessionTurns keeps streaming tool_result chunks inside one user turn and skips sidechains', () => {
  const { turns } = parseClaudeSessionTurns([
    { type: 'user', uuid: 'u1', timestamp: '2026-11-26T10:00:00.000Z', message: { role: 'user', content: 'Hello' } },
    { type: 'user', uuid: 'u-side', isSidechain: true, timestamp: '2026-11-26T10:00:01.000Z', message: { role: 'user', content: 'Sidechain prompt' } },
    { type: 'assistant', uuid: 'a1', timestamp: '2026-11-26T10:00:02.000Z', message: { id: 'm1', role: 'assistant', model: 'claude-sonnet-4-6', stop_reason: 'end_turn', content: [{ type: 'text', text: 'Hi!' }] } },
  ], { afterTurnIndex: -1 });
  assert.equal(turns.length, 1);
  assert.equal(turns[0]!.user_query, 'Hello');
  assert.equal(turns[0]!.assistant_reply, 'Hi!');
});
