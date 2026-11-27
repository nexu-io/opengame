import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { fixture } from './fixtures.ts';
import { WorkspaceStore } from '../workspace.ts';
import { createTracker, type PendingEvent, validField, validProperties } from '../tracking/core.ts';
import { gatewayFor } from '../gateway/service.ts';
import { capabilityRun, jobManage, registerCapabilityScriptExecutor, unregisterCapabilityScriptExecutor } from '../gateway/capability-center.ts';
import { clearOpenDesign3dDiscoveryCache } from '../gateway/opendesign-3d.ts';
import { assetOperation } from '../gateway/asset-operations.ts';
import { assetHash, AssetLibrary } from '../gateway/asset-library.ts';
import { handler as serverHandler } from '../server.ts';
import { omEvents, studioEvents } from '../tracking/events.ts';
import { resumableDownload } from '../gateway/resumable-download.ts';
import {
  approvedCapabilityIds,
  extractHttpStatus,
  extractUpstreamErrorCode,
  mediaGenerationError,
  mediaGenerationErrorCategory,
  resolveRemoteTaskUpstreamCode,
  safeCapabilityId,
  superAgentError,
  toolInputFields,
  toolResultFields,
} from '../tracking/tool-fields.ts';
import { defaultCapabilities } from '../shared/capability-registry.ts';
import { ProviderError, withErrorMeta } from '../gateway/network.ts';
import type { HostContext } from '../tracking/host.ts';
import { ModelGateway } from '../gateway/service.ts';
import { Phase1Service } from '../phase1.ts';
import { pluginRoot } from '../hyperframes.ts';
import { ScenarioRuns } from '../gateway/scenario-runs.ts';
import { SuperAgentConversations } from '../gateway/super-agent.ts';
import { resolveCodexTraceSampleRate, shouldSampleCodexTurn } from '../shared/codex-session-tracking.ts';

function fakeTracker() {
  const events: any[] = [];
  const tracking = createTracker({
    registry: omEvents,
    entrypoint: 'mcp',
    enabled: true,
    flushIntervalMs: 0,
    send: async batch => {
      events.push(...batch);
      return 'accepted';
    },
  });
  return { tracking, events };
}

const codexHost: HostContext = {
  host_agent: 'codex',
  host_agent_source: 'mcp_client_info',
  mcp_client_name: 'codex-mcp-client',
  mcp_client_version: '1.2.3',
};

const png1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X2dIAAAAASUVORK5CYII=',
  'base64',
);

test('P0-A: media generation worker events carry provider/model/capability/duration/error_code/host_context and redact custom models', () => fixture(async store => {
  const { tracking, events } = fakeTracker();
  const gateway = new ModelGateway(store, {
    tracking,
    detect: async () => [{ id: 'codex', label: 'Codex', installed: true, authenticated: true, imageGeneration: true, available: true, reason: 'ok' }],
    codex: async () => png1x1,
    pollMs: 10,
  });

  // 1) Local agent (codex) success with capabilityId and host_context
  const job = await gateway.submit({
    modality: 'image',
    prompt: 'A minimalist studio poster',
    model: 'codex:image-generation',
    capabilityId: 'relight',
    library: { title: 'Test poster' },
  }, codexHost);
  await gateway.tick();
  await Promise.all([...gateway.active.values()].map(task => task.done));
  await tracking.flush();

  const reqEv = events.find(e => e.event === 'media_generation_requested');
  const subEv = events.find(e => e.event === 'media_generation_submitted' && e.properties.job_id === job.id);
  const resEv = events.find(e => e.event === 'media_generation_result' && e.properties.job_id === job.id);

  assert.ok(reqEv, 'expected media_generation_requested');
  assert.equal(reqEv.properties.capability_id, 'relight');
  assert.equal(reqEv.host_context?.host_agent, 'codex');

  assert.ok(subEv, 'expected media_generation_submitted');
  assert.equal(subEv.properties.provider_kind, 'agent');
  assert.equal(subEv.properties.model_provider, 'codex');
  assert.equal(subEv.properties.model_id, 'image-generation');
  assert.equal(subEv.properties.capability_id, 'relight');
  assert.equal(subEv.properties.reference_count, 0);
  assert.equal(subEv.host_context?.host_agent, 'codex');

  assert.ok(resEv, 'expected media_generation_result');
  assert.equal(resEv.properties.job_state, 'completed');
  assert.equal(resEv.properties.provider_kind, 'agent');
  assert.equal(resEv.properties.model_provider, 'codex');
  assert.equal(resEv.properties.model_id, 'image-generation');
  assert.equal(resEv.properties.attempt_kind, 'initial');
  assert.equal(typeof resEv.properties.duration_ms, 'number');
  assert.equal(typeof resEv.properties.queue_wait_ms, 'number');
  assert.equal(resEv.properties.error_code, undefined);
  assert.equal(resEv.host_context?.host_agent, 'codex');

  // 2) Builtin vendor-path model_id validation and gateway retention
  assert.equal(validField('model_id', 'fal-ai/flux/schnell'), true);
  assert.equal(validField('model_id', 'fal-ai/wan/v2.2-a14b/text-to-video'), true);
  assert.equal(validField('model_id', '../invalid'), false);
  assert.equal(validField('model_id', '/etc/passwd'), false);
  assert.equal(validField('model_id', 'https://example.com/model'), false);
  assert.equal(validField('model_id', 'a/b/c/d/e/f'), false);

  const falGateway = new ModelGateway(store, {
    tracking,
    fetcher: async (url, init = {}) => {
      if (init.method === 'POST') return Response.json({ request_id: 'fal-1', status_url: 'https://queue.fal.run/s', response_url: 'https://queue.fal.run/r' });
      if (String(url).endsWith('/s')) return Response.json({ status: 'COMPLETED' });
      return Response.json({ outputs: ['https://cdn.example/out.png'] });
    },
    download: async () => png1x1,
    pollMs: 10,
  });
  await falGateway.configureProvider('fal', { apiKey: 'test-key' });
  const falJob = await falGateway.submit({
    modality: 'image',
    prompt: 'Builtin vendor path model',
    model: 'fal:fal-ai/flux/schnell',
    library: { title: 'Fal poster' },
  }, codexHost);
  await falGateway.tick();
  await Promise.all([...falGateway.active.values()].map(task => task.done));
  await tracking.flush();
  const falSub = events.find(e => e.event === 'media_generation_submitted' && e.properties.job_id === falJob.id);
  const falRes = events.find(e => e.event === 'media_generation_result' && e.properties.job_id === falJob.id);
  assert.equal(falSub?.properties.provider_kind, 'builtin');
  assert.equal(falSub?.properties.model_provider, 'fal');
  assert.equal(falSub?.properties.model_id, 'fal-ai/flux/schnell');
  assert.equal(falRes?.properties.provider_kind, 'builtin');
  assert.equal(falRes?.properties.model_provider, 'fal');
  assert.equal(falRes?.properties.model_id, 'fal-ai/flux/schnell');
  await falGateway.close();

  // 3) Failure path maps closed error_code without raw message leakage
  assert.equal(mediaGenerationError(Object.assign(new Error('secret key sk-123 failed'), { status: 401 })), 'AUTH_REJECTED');
  assert.equal(mediaGenerationError(Object.assign(new Error('quota'), { status: 402 })), 'BALANCE_LOW');
  assert.equal(mediaGenerationError(new Error('Generation timed out')), 'TIMEOUT');
  assert.equal(mediaGenerationError(new Error('anything'), 'interrupted'), 'WORKER_INTERRUPTED');
  assert.equal(mediaGenerationError(new Error('anything'), 'cancelled'), 'CANCELLED');

  // 3) Custom compatible provider omits model_provider and model_id
  const customProviderId = await gateway.connections.configure(null, {
    label: 'Private Endpoint',
    baseUrl: 'https://private.example.com/v1',
    apiKey: 'secret-token',
    protocol: 'openai',
    enabled: true,
  });
  await gateway.connections.saveModel(customProviderId, {
    modelId: 'internal/secret-model-v9',
    label: 'Secret Model',
    kind: 'image',
    enabled: true,
  });
  const failingGateway = new ModelGateway(store, {
    tracking,
    fetcher: async () => new Response('unauthorized', { status: 401 }),
    pollMs: 10,
  });
  const customJob = await failingGateway.submit({
    modality: 'image',
    prompt: 'Private render',
    model: `${customProviderId}:internal/secret-model-v9`,
    library: { title: 'Private' },
  });
  await failingGateway.tick();
  await Promise.all([...failingGateway.active.values()].map(task => task.done));
  await tracking.flush();

  const customSub = events.find(e => e.event === 'media_generation_submitted' && e.properties.job_id === customJob.id);
  const customRes = events.find(e => e.event === 'media_generation_result' && e.properties.job_id === customJob.id);
  assert.equal(customSub.properties.provider_kind, 'custom');
  assert.equal(customSub.properties.model_provider, undefined);
  assert.equal(customSub.properties.model_id, undefined);
  assert.equal(customRes.properties.provider_kind, 'custom');
  assert.equal(customRes.properties.model_provider, undefined);
  assert.equal(customRes.properties.model_id, undefined);
  assert.equal(customRes.properties.job_state, 'failed');
  assert.equal(customRes.properties.error_code, 'AUTH_REJECTED');

  await gateway.close();
  await failingGateway.close();
  tracking.close();
}, false));

test('P0-B: Capability Center toolInputFields and toolResultFields extract capability_id, executor_kind, dry_run and fallback_raw_model safely', () => {
  assert.equal(safeCapabilityId('remove-background'), 'remove-background');
  assert.equal(safeCapabilityId('custom/unsafe path!'), 'other');
  assert.equal(safeCapabilityId('secret-user-token-slug'), 'other');
  assert.equal(safeCapabilityId(''), undefined);

  assert.deepEqual(
    toolInputFields('openmotion_capability_run', { capabilityId: 'relight', dryRun: true }),
    { action: 'run', capability_id: 'relight', dry_run: true },
  );
  assert.deepEqual(
    toolInputFields('openmotion_capability_run', { model: 'fal:flux-pro', dryRun: false }),
    { action: 'run', dry_run: false, fallback_raw_model: true },
  );
  assert.deepEqual(
    toolResultFields('openmotion_capability_run', { capabilityId: 'remove-background' }, { capabilityId: 'remove-background', executorKind: 'prompt-preset', dryRun: true }),
    { capability_id: 'remove-background', executor_kind: 'prompt-preset', dry_run: true, fallback_raw_model: false },
  );
  assert.deepEqual(
    toolResultFields('openmotion_capability_run', { model: 'fal:flux-pro' }, { executorKind: 'model' }),
    { executor_kind: 'model', fallback_raw_model: true },
  );
  assert.equal(
    validProperties(omEvents, 'mcp_tool_finished', {
      tool_name: 'motion_capability_run',
      call_id: crypto.randomUUID(),
      accepted: true,
      action: 'run',
      capability_id: 'remove-background',
      executor_kind: 'prompt-preset',
      dry_run: true,
      fallback_raw_model: false,
      outcome: 'success',
      duration_ms: 120,
    }),
    true,
  );
});

test('P0-C: work_generation_stage and project_create_result carry template_id attribution and host_context', () => fixture(async store => {
  const { tracking, events } = fakeTracker();
  const service = new Phase1Service(store, pluginRoot, {
    origin: () => 'http://127.0.0.1:4173',
    nativeUrl: () => undefined,
    openProject: async () => {},
    mutation: async task => task(),
    cancel: async () => {},
    tracking,
  });

  const created = await service.call('openmotion_create_project', {
    requestId: crypto.randomUUID(),
    projectType: 'template',
    templateId: 'decision-tree',
    title: 'Template Attributed Film',
    requirements: 'Demo',
  }, codexHost);

  const began = await service.call('openmotion_open_preview', {
    action: 'begin',
    projectId: created.projectId,
    requestId: crypto.randomUUID(),
    mode: 'create',
  }, codexHost);

  const film = `<!doctype html><html><head><meta charset="utf-8"><script src="assets/gsap.min.js"></script><style>
body{margin:0}#main{position:relative;width:320px;height:180px;background:#14354a}
#title{color:white;font-size:28px}</style></head><body>
<div id="main" data-composition-id="main" data-start="0" data-duration="2" data-width="320" data-height="180" data-fps="24">
<div id="title" class="clip" data-start="0" data-duration="2" data-track-index="0">Attributed video</div></div><script>const tl=gsap.timeline({paused:true});tl.to('#title',{opacity:0.5,duration:2},0);window.__timelines={main:tl};</script></body></html>`;
  await writeFile(path.join(store.projectDirectoryFor(created.projectId), 'index.html'), film);
  const current = await service.call('openmotion_get_project', { projectId: created.projectId }, codexHost);
  await service.call('openmotion_open_preview', {
    action: 'complete_generation',
    projectId: created.projectId,
    workId: began.inlineWork.id,
    requestId: crypto.randomUUID(),
    expectedRevision: current.revision,
    expectedVersionId: current.currentVersionId,
  }, codexHost);
  await tracking.flush();

  const createEv = events.find(e => e.event === 'project_create_result');
  assert.equal(createEv?.properties.creation_route, 'template');
  assert.equal(createEv?.properties.template_id, 'decision-tree');
  assert.equal(createEv?.host_context?.host_agent, 'codex');

  const stageEvents = events.filter(e => e.event === 'work_generation_stage');
  assert.deepEqual(stageEvents.map(e => e.properties.stage), ['started', 'generated']);
  for (const ev of stageEvents) {
    assert.equal(ev.properties.template_id, 'decision-tree');
    assert.equal(ev.properties.attribution_source, 'project_catalog');
    assert.equal(ev.host_context?.host_agent, 'codex');
  }
  const hostStarted = events.find(e => e.event === 'host_run_started');
  assert.equal(hostStarted?.host_context?.host_agent, 'codex');
  tracking.close();
}, false));

test('P1-D: ScenarioRuns emits terminal scenario_run_result and scenario_step_result once without replay duplication', () => fixture(async store => {
  const { tracking, events } = fakeTracker();
  const runs = new ScenarioRuns(store.directory, store, tracking);

  const createReq = crypto.randomUUID();
  const { run } = await runs.create({ requestId: createReq, scenarioId: 'motion-full-chain' });
  // Idempotent replay must not duplicate scenario_run_result
  await runs.create({ requestId: createReq, scenarioId: 'motion-full-chain' });

  const firstStep = Object.keys(run.steps)[0]!;
  // Rejected mutations that throw after mutating status/archived must NOT emit success milestones
  await assert.rejects(
    runs.updateStep({
      runId: run.id,
      expectedRevision: run.revision,
      requestId: crypto.randomUUID(),
      stepId: firstStep,
      status: 'done',
      bindings: { reference: ['nonexistent-pool-item'] },
    }),
    /POOL_ITEM_NOT_FOUND|not found/i,
  );
  await assert.rejects(
    runs.updateRun({
      runId: run.id,
      expectedRevision: run.revision,
      requestId: crypto.randomUUID(),
      changes: { archived: true, activeStepId: 'nonexistent-step' },
    }),
    /Unknown step|not found/i,
  );

  const stepReq = crypto.randomUUID();
  const updated = await runs.updateStep({
    runId: run.id,
    expectedRevision: run.revision,
    requestId: stepReq,
    stepId: firstStep,
    status: 'done',
  });
  await runs.updateStep({
    runId: run.id,
    expectedRevision: run.revision,
    requestId: stepReq,
    stepId: firstStep,
    status: 'done',
  });

  await runs.updateRun({
    runId: run.id,
    expectedRevision: updated.run.revision,
    requestId: crypto.randomUUID(),
    changes: { archived: true },
  });
  await tracking.flush();

  const runEvents = events.filter(e => e.event === 'scenario_run_result');
  const stepEvents = events.filter(e => e.event === 'scenario_step_result');
  assert.deepEqual(runEvents.map(e => e.properties.action), ['create', 'archive']);
  assert.equal(runEvents[0].properties.scenario_id, 'motion-full-chain');
  assert.equal(runEvents[1].properties.completed_step_count, 1);

  assert.equal(stepEvents.length, 1);
  assert.equal(stepEvents[0].properties.scenario_id, 'motion-full-chain');
  assert.equal(stepEvents[0].properties.step_id, firstStep);
  assert.equal(stepEvents[0].properties.action, 'status_change');
  assert.equal(stepEvents[0].properties.step_status, 'done');
  tracking.close();
}, false));

test('P1-D: SuperAgentConversations emits super_agent_approval_result and super_agent_turn_result with safe error mapping', () => fixture(async store => {
  const { tracking, events } = fakeTracker();
  const service = new SuperAgentConversations(store, {
    tracking,
    resolveAgent: async () => null,
  });
  assert.equal(superAgentError(new Error('HTTP 401 unauthorized')), 'AUTH_ERROR');
  assert.equal(superAgentError(new Error('request timed out')), 'TIMEOUT');
  assert.equal(superAgentError(new Error('stopped'), true), 'ABORTED');

  assert.equal(
    validProperties(omEvents, 'super_agent_turn_result', {
      runtime_kind: 'local-direct',
      engine: 'codex',
      model_id: 'gpt-5.3-codex',
      permission_mode: 'on-request',
      intent: 'game',
      outcome: 'completed',
      duration_ms: 4200,
      tool_call_count: 5,
      approval_count: 1,
      artifact_count: 1,
      changed_file_count: 3,
      input_tokens: 12000,
      output_tokens: 2400,
    }),
    true,
  );
  // Vendor-path agent model IDs (e.g. anthropic/claude-sonnet-4.5) must pass the shared modelId rule
  assert.equal(
    validProperties(omEvents, 'super_agent_turn_result', {
      runtime_kind: 'local-direct',
      engine: 'claude',
      model_id: 'anthropic/claude-sonnet-4.5',
      permission_mode: 'auto',
      intent: 'coding',
      outcome: 'completed',
      duration_ms: 1500,
      tool_call_count: 2,
      approval_count: 0,
      artifact_count: 0,
    }),
    true,
  );
  assert.equal(
    validProperties(omEvents, 'super_agent_approval_result', {
      runtime_kind: 'local-bridge',
      approval_kind: 'generation',
      decision: 'approved',
      always_allow: false,
      wait_ms: 1850,
    }),
    true,
  );
  // Private/unregistered fields must be rejected
  assert.equal(
    validProperties(omEvents, 'super_agent_turn_result', {
      runtime_kind: 'local-direct',
      engine: 'codex',
      permission_mode: 'on-request',
      outcome: 'completed',
      duration_ms: 100,
      tool_call_count: 0,
      approval_count: 0,
      artifact_count: 0,
      prompt: 'secret prompt',
    }),
    false,
  );
  await service.close();
  tracking.close();
}, false));

test('P2-E: Codex LLM trace sampling is deterministic per device and always retains failed/error turns', () => {
  assert.equal(resolveCodexTraceSampleRate({ environment: {} }), 1);
  assert.equal(resolveCodexTraceSampleRate({ environment: { OPENMOTION_LLM_TRACE_SAMPLE_RATE: '0.2' } }), 0.2);
  assert.equal(resolveCodexTraceSampleRate({ environment: { OPENMOTION_LLM_TRACE_SAMPLE_RATE: 'invalid' } }), 1);
  assert.equal(resolveCodexTraceSampleRate({ sampleRate: -0.5 }), 0);
  assert.equal(resolveCodexTraceSampleRate({ sampleRate: 2.5 }), 1);

  // Error turns are always forced even at sampleRate=0
  assert.deepEqual(
    shouldSampleCodexTurn({ sampleKey: 'omd_device_1', sampleRate: 0, turnStatus: 'failed', hasToolFailure: false }),
    { include: true, reason: 'error_forced' },
  );
  assert.deepEqual(
    shouldSampleCodexTurn({ sampleKey: 'omd_device_1', sampleRate: 0, turnStatus: 'completed', hasToolFailure: true }),
    { include: true, reason: 'error_forced' },
  );

  // Deterministic distribution at 20% across 1000 devices
  let kept = 0;
  for (let i = 0; i < 1000; i++) {
    const first = shouldSampleCodexTurn({ sampleKey: `omd_dev_${i}`, sampleRate: 0.2, turnStatus: 'completed', hasToolFailure: false });
    const repeat = shouldSampleCodexTurn({ sampleKey: `omd_dev_${i}`, sampleRate: 0.2, turnStatus: 'completed', hasToolFailure: false });
    assert.deepEqual(first, repeat, 'sampling must be deterministic per device');
    if (first.include) kept += 1;
  }
  assert.ok(kept > 150 && kept < 250, `expected ~200 sampled devices at 20%, got ${kept}`);
});

test('Media tracking completeness: conservation funnel, failure_phase, http_status, commercial_gate vs download 403, cancel, resume, custom redaction, and modality gates', () => fixture(async store => {
  // 1) Error classification separates AMR commercial_gate vs BYOK billing, download/storage 403, timeout, upstream 5xx, invalid request, empty output
  const err402 = withErrorMeta(new Error('OpenDesign balance too low'), { status: 402, upstreamCode: 'insufficient_balance' });
  assert.equal(extractHttpStatus(err402), 402);
  assert.equal(extractUpstreamErrorCode(err402), 'insufficient_balance');
  assert.equal(mediaGenerationError(err402, 'submitting'), 'BALANCE_LOW');
  assert.equal(mediaGenerationErrorCategory('BALANCE_LOW', 'submitting', 'amr_opendesign'), 'commercial_gate');
  assert.equal(mediaGenerationErrorCategory('BALANCE_LOW', 'submitting', 'byok_builtin'), 'byok_billing');

  const errPlan = withErrorMeta(new Error('Your plan does not include this model'), { status: 403, upstreamCode: 'tier_model_not_entitled' });
  assert.equal(mediaGenerationError(errPlan, 'submitting'), 'PLAN_NOT_ENTITLED');
  assert.equal(mediaGenerationErrorCategory('PLAN_NOT_ENTITLED', 'submitting', 'amr_account'), 'commercial_gate');
  assert.equal(mediaGenerationErrorCategory('PLAN_NOT_ENTITLED', 'submitting', 'byok_builtin'), 'byok_billing');

  // Unknown upstream codes normalize to closed 'other'; Node errno values are never treated as upstream codes
  assert.equal(extractUpstreamErrorCode(withErrorMeta(new Error('x'), { upstreamCode: 'custom_secret_code_123' })), 'other');
  assert.equal(extractUpstreamErrorCode(Object.assign(new Error('socket reset'), { code: 'ECONNRESET' })), undefined);

  // Storage presigned PUT 403 must classify as UPLOAD_FAILED / network_download, NOT AUTH_REJECTED
  const errStorage403 = withErrorMeta(new Error('OpenDesign Cloud reference upload storage HTTP 403; the job was not submitted'), { status: 403, errorSource: 'storage' });
  assert.equal(mediaGenerationError(errStorage403, 'uploading'), 'UPLOAD_FAILED');
  assert.equal(mediaGenerationErrorCategory('UPLOAD_FAILED', 'uploading', 'amr_opendesign'), 'network_download');

  // Download-phase 403 must classify as DOWNLOAD_FAILED / network_download, NOT auth_credential
  const errDownload403 = withErrorMeta(new Error('Media download HTTP 403'), { status: 403, errorSource: 'download' });
  assert.equal(mediaGenerationError(errDownload403, 'downloading'), 'DOWNLOAD_FAILED');
  assert.equal(mediaGenerationErrorCategory('DOWNLOAD_FAILED', 'downloading', 'amr_opendesign'), 'network_download');

  // Timeouts take precedence over saving/remote_task phases and map to 'timeout' category
  assert.equal(mediaGenerationError(new Error('Atlas generation timeout'), 'remote_task'), 'TIMEOUT');
  assert.equal(mediaGenerationError(new Error('Generation timed out'), 'saving'), 'TIMEOUT');
  assert.equal(mediaGenerationErrorCategory('TIMEOUT', 'remote_task', 'byok_builtin'), 'timeout');

  const err502 = withErrorMeta(new Error('Provider HTTP 502'), { status: 502 });
  assert.equal(mediaGenerationError(err502, 'submitting'), 'UPSTREAM_5XX');
  assert.equal(mediaGenerationErrorCategory('UPSTREAM_5XX', 'submitting', 'amr_opendesign'), 'upstream_error');

  const err400 = withErrorMeta(new Error('Provider HTTP 400'), { status: 400, upstreamCode: 'invalid_request' });
  assert.equal(mediaGenerationError(err400, 'submitting'), 'INVALID_REQUEST');
  assert.equal(mediaGenerationErrorCategory('INVALID_REQUEST', 'submitting', 'amr_opendesign'), 'client_validation');

  assert.equal(mediaGenerationError(new Error('Provider returned no media'), 'decoding'), 'EMPTY_OUTPUT');
  assert.equal(mediaGenerationError(new Error('Provider did not return valid image media'), 'decoding'), 'INVALID_MEDIA');

  // Schema integer, capability allowlist drift, & studio isolation guards
  assert.deepEqual([...approvedCapabilityIds], defaultCapabilities.map(c => c.id));
  assert.equal(validField(omEvents.media_generation_result.fields.http_status, 402), true);
  assert.equal(validField(omEvents.media_generation_result.fields.http_status, 402.5), false);
  assert.equal(Object.hasOwn(studioEvents, 'media_generation_rejected'), false);
  assert.equal(Object.hasOwn(studioEvents, 'media_generation_replayed'), false);
  assert.equal(Object.hasOwn(studioEvents, 'media_generation_retry_started'), false);

  // 2) MCP tool & upgrade gate events admit modality
  assert.deepEqual(
    toolInputFields('openmotion_media_use', { action: 'generate', modality: 'video' }),
    { action: 'generate', modality: 'video' },
  );
  assert.deepEqual(
    toolResultFields('openmotion_job_manage', { action: 'status' }, { job: { modality: 'audio' } }),
    { modality: 'audio' },
  );
  assert.equal(validProperties(omEvents, 'upgrade_link_result', {
    entry_from: 'agent_media_upgrade_free',
    outcome: 'success',
    entry_id: crypto.randomUUID(),
    modality: 'video',
  }), true);

  // 3) End-to-end gateway funnel: requested = submitted + rejected + replayed; HTTP 402, download 403, remote_task, cancel, resume, custom redaction
  const { tracking, events } = fakeTracker();
  let mode: 'http402' | 'download403' | 'remote_fail' | 'flaky_poll_then_resume' | 'ok' = 'http402';
  let pollAttempts = 0;
  const gateway = new ModelGateway(store, {
    tracking,
    detect: async () => [],
    pollMs: 5,
    fetcher: async (url, init = {}) => {
      const target = String(url);
      if (target.endsWith('/images/generations') && init.method === 'POST') {
        if (mode === 'http402') return new Response(JSON.stringify({ error: { code: 'insufficient_balance' } }), { status: 402 });
        return Response.json({ task_id: `cloud_task_${mode}` });
      }
      if (target.includes('/images/tasks/cloud_task_remote_fail')) {
        return Response.json({ status: 'failed', error: { code: 'provider_error', retryable: false } });
      }
      if (target.includes('/images/tasks/cloud_task_download403')) {
        return Response.json({ status: 'succeeded', assets: [{ url: 'https://cdn.example/expired.png' }] });
      }
      if (target.includes('/images/tasks/cloud_task_flaky_poll_then_resume')) {
        pollAttempts++;
        if (pollAttempts <= 5) return new Response('gateway timeout', { status: 504 });
        return Response.json({ status: 'succeeded', assets: [{ url: 'https://cdn.example/recovered.png' }] });
      }
      return Response.json({ status: 'succeeded', assets: [{ url: 'https://cdn.example/ok.png' }] });
    },
    download: async (url) => {
      if (String(url).includes('expired.png')) {
        throw Object.assign(new Error('Media download HTTP 403'), { status: 403 });
      }
      return png1x1;
    },
  });

  // Pre-queue rejections: project not open + account signed out / unavailable model
  await assert.rejects(gateway.submit({
    modality: 'image',
    prompt: 'Missing open project',
  }, codexHost, { entrySurface: 'mcp_media_use' }), /Open a project/i);

  await assert.rejects(gateway.submit({
    modality: 'image',
    prompt: 'No provider configured yet',
    library: { title: 'Signed out' },
  }, codexHost, { entrySurface: 'mcp_media_use' }), /unavailable/i);

  // Configure opendesign key (AMR API Key channel)
  await gateway.configureProvider('opendesign', { apiKey: 'od-secret-key', baseUrl: 'https://amr-api.open-design.ai' });

  // Submit -> HTTP 402 on submitting phase (amr_opendesign)
  mode = 'http402';
  const job402 = await gateway.submit({
    modality: 'image',
    prompt: 'Test 402',
    model: 'opendesign:gpt-image-2',
    idempotencyKey: 'idem-402',
    library: { title: 'Test 402' },
  }, codexHost, { entrySurface: 'studio' });
  // Idempotent replay increments requested + replayed (not submitted, not rejected)
  const replayed = await gateway.submit({
    modality: 'image',
    prompt: 'Test 402',
    model: 'opendesign:gpt-image-2',
    idempotencyKey: 'idem-402',
    library: { title: 'Test 402' },
  }, codexHost, { entrySurface: 'studio' });
  assert.equal(replayed.id, job402.id);

  await gateway.tick();
  await Promise.all([...gateway.active.values()].map(task => task.done));

  // Submit -> download 403, then resume to verify attempt_number=2 & previous_error_code/previous_failure_phase
  let allowDownloadRecovery = false;
  gateway.options.download = async (url) => {
    if (String(url).includes('expired.png') && !allowDownloadRecovery) {
      throw Object.assign(new Error('Media download HTTP 403'), { status: 403 });
    }
    return png1x1;
  };
  mode = 'download403';
  const jobDl403 = await gateway.submit({
    modality: 'image',
    prompt: 'Test download 403',
    model: 'opendesign:gpt-image-2',
    library: { title: 'Test dl403' },
  }, codexHost, { entrySurface: 'mcp_assets_use' });
  await gateway.tick();
  await Promise.all([...gateway.active.values()].map(task => task.done));
  allowDownloadRecovery = true;
  await gateway.resume(jobDl403.id, 'resume-dl403');
  await gateway.tick();
  await Promise.all([...gateway.active.values()].map(task => task.done));

  // Submit -> remote task terminal failure with upstream error code
  mode = 'remote_fail';
  const jobRemoteFail = await gateway.submit({
    modality: 'image',
    prompt: 'Test remote fail',
    model: 'opendesign:gpt-image-2',
    library: { title: 'Test remote fail' },
  }, codexHost, { entrySurface: 'mcp_capability_run' });
  await gateway.tick();
  await Promise.all([...gateway.active.values()].map(task => task.done));

  // Submit -> queued cancel with explicit cancel_source
  mode = 'ok';
  const jobCancelled = await gateway.submit({
    modality: 'image',
    prompt: 'Test cancel',
    model: 'opendesign:gpt-image-2',
    library: { title: 'Test cancel' },
  }, codexHost, { entrySurface: 'studio' });
  await gateway.cancel(jobCancelled.id, { source: 'studio' });

  // Custom compatible provider: keeps http_status and route_channel=byok_custom, redacts model_provider, model_id & upstream_error_code
  const customProviderId = await gateway.connections.configure(null, {
    label: 'Secret Gateway',
    baseUrl: 'https://private-custom.example.com/v1',
    apiKey: 'secret-token-xyz',
    protocol: 'openai',
    enabled: true,
  });
  await gateway.connections.saveModel(customProviderId, {
    modelId: 'internal/private-v2',
    label: 'Private V2',
    kind: 'image',
    enabled: true,
  });
  const customFailGateway = new ModelGateway(store, {
    tracking,
    fetcher: async () => new Response('rate limited', { status: 429 }),
    pollMs: 5,
  });
  const customJob = await customFailGateway.submit({
    modality: 'image',
    prompt: 'Custom 429',
    model: `${customProviderId}:internal/private-v2`,
    library: { title: 'Custom' },
  }, undefined, { entrySurface: 'scenario' });
  await customFailGateway.tick();
  await Promise.all([...customFailGateway.active.values()].map(task => task.done));

  while (tracking.pending() > 0) await tracking.flush();

  const requested = events.filter(e => e.event === 'media_generation_requested');
  const submitted = events.filter(e => e.event === 'media_generation_submitted');
  const rejected = events.filter(e => e.event === 'media_generation_rejected');
  const replayedEvs = events.filter(e => e.event === 'media_generation_replayed');
  assert.equal(requested.length, submitted.length + rejected.length + replayedEvs.length, 'requested must equal submitted + rejected + replayed');

  // Verify rejection events
  assert.equal(rejected.length, 2);
  assert.equal(rejected[0].properties.rejection_reason, 'PROJECT_NOT_OPEN');
  assert.equal(rejected[0].properties.rejection_category, 'project_missing');
  assert.equal(rejected[1].properties.rejection_reason, 'ACCOUNT_SIGNED_OUT');
  assert.equal(rejected[1].properties.rejection_category, 'commercial_gate');
  assert.equal(rejected[1].properties.entry_surface, 'mcp_media_use');

  // Verify replay event
  assert.equal(replayedEvs.length, 1);
  assert.equal(replayedEvs[0].properties.job_id, job402.id);
  assert.equal(replayedEvs[0].properties.existing_job_state, 'queued');

  // Verify 402 result
  const res402 = events.find(e => e.event === 'media_generation_result' && e.properties.job_id === job402.id);
  assert.equal(res402?.properties.route_channel, 'amr_opendesign');
  assert.equal(res402?.properties.entry_surface, 'studio');
  assert.equal(res402?.properties.failure_phase, 'submitting');
  assert.equal(res402?.properties.http_status, 402);
  assert.equal(res402?.properties.error_code, 'BALANCE_LOW');
  assert.equal(res402?.properties.error_category, 'commercial_gate');
  assert.equal(res402?.properties.has_remote_id, false);

  // Verify download 403 result & subsequent resume recovery
  const dlResults = events.filter(e => e.event === 'media_generation_result' && e.properties.job_id === jobDl403.id);
  assert.equal(dlResults.length, 2);
  const resDl403 = dlResults[0];
  assert.equal(resDl403?.properties.failure_phase, 'downloading');
  assert.equal(resDl403?.properties.http_status, 403);
  assert.equal(resDl403?.properties.error_code, 'DOWNLOAD_FAILED');
  assert.equal(resDl403?.properties.error_category, 'network_download');
  assert.equal(resDl403?.properties.has_remote_id, true);
  assert.equal(resDl403?.properties.is_resumable, true);
  const retryStarted = events.find(e => e.event === 'media_generation_retry_started' && e.properties.job_id === jobDl403.id);
  assert.equal(retryStarted?.properties.attempt_kind, 'resume');
  assert.equal(retryStarted?.properties.attempt_number, 2);
  assert.equal(retryStarted?.properties.previous_error_code, 'DOWNLOAD_FAILED');
  assert.equal(retryStarted?.properties.previous_failure_phase, 'downloading');
  const resDlRecovered = dlResults[1];
  assert.equal(resDlRecovered?.properties.job_state, 'completed');
  assert.equal(resDlRecovered?.properties.attempt_kind, 'resume');
  assert.equal(resDlRecovered?.properties.attempt_number, 2);
  assert.equal(resDlRecovered?.properties.attempt_id, retryStarted?.properties.attempt_id);
  assert.equal(resDlRecovered?.properties.previous_error_code, 'DOWNLOAD_FAILED');
  assert.equal(resDlRecovered?.properties.previous_failure_phase, 'downloading');

  // Verify remote terminal failure result
  const resRemote = events.find(e => e.event === 'media_generation_result' && e.properties.job_id === jobRemoteFail.id);
  assert.equal(resRemote?.properties.failure_phase, 'remote_task');
  assert.equal(resRemote?.properties.remote_terminal, true);
  assert.equal(resRemote?.properties.upstream_error_code, 'provider_error');
  assert.equal(resRemote?.properties.error_code, 'REMOTE_FAILED');
  assert.equal(resRemote?.properties.error_category, 'upstream_error');
  assert.equal(resRemote?.properties.is_resumable, false);

  // Verify cancel result
  const resCancel = events.find(e => e.event === 'media_generation_result' && e.properties.job_id === jobCancelled.id);
  assert.equal(resCancel?.properties.failure_phase, 'cancelled');
  assert.equal(resCancel?.properties.phase_before_cancel, 'queued');
  assert.equal(resCancel?.properties.cancel_source, 'studio');
  assert.equal(typeof resCancel?.properties.cancel_wait_ms, 'number');
  assert.equal(resCancel?.properties.error_category, 'user_cancelled');

  // Verify custom provider redaction & 429 classification
  const resCustom = events.find(e => e.event === 'media_generation_result' && e.properties.job_id === customJob.id);
  assert.equal(resCustom?.properties.provider_kind, 'custom');
  assert.equal(resCustom?.properties.route_channel, 'byok_custom');
  assert.equal(resCustom?.properties.model_provider, undefined);
  assert.equal(resCustom?.properties.model_id, undefined);
  assert.equal(resCustom?.properties.upstream_error_code, undefined);
  assert.equal(resCustom?.properties.http_status, 429);
  assert.equal(resCustom?.properties.error_code, 'RATE_LIMITED');
  assert.equal(resCustom?.properties.error_category, 'rate_limit');
  assert.equal(resCustom?.properties.entry_surface, 'scenario');

  // Verify strict privacy and payload size cap (< 4096 bytes)
  const serialized = JSON.stringify(events);
  assert.doesNotMatch(serialized, /od-secret-key|secret-token-xyz|idem-402|private-v2|No provider configured/);
  for (const ev of events) {
    assert.ok(JSON.stringify(ev).length <= 4096, `event ${ev.event} exceeded 4096 byte limit`);
  }

  await gateway.close();
  await customFailGateway.close();
  tracking.close();
}, false));

test('Media tracking review regressions: storage PUT 403, Cloud entitlement 403, BYOK 402, unconfigured BYOK, cross-surface replay, upload/remote timing split, queued-resume cancel, running cancel, dead worker interrupt, resumableDownload status reset', () => fixture(async store => {
  const { tracking, events } = fakeTracker();
  let uploadBehavior: 'ok_slow' | 'put403' = 'put403';
  let submitBehavior: 'ok' | 'plan403' | 'empty403' | 'unknown403' | 'video_content403' | 'hang_poll' = 'ok';
  let resolveHangPoll!: () => void;
  const hangPollReached = new Promise<void>(resolve => { resolveHangPoll = resolve; });

  const gateway = new ModelGateway(store, {
    tracking,
    detect: async () => [],
    pollMs: 10,
    fetcher: async (url, init = {}) => {
      const target = String(url);
      if (target.endsWith('/api/v1/media/models?include_audio=true')) {
        return Response.json({
          models: [
            { model: 'gpt-image-2', kind: 'image', capabilities: { edits: true, max_input_images: 4 } },
            { model: 'seedance-2.0', kind: 'video', capabilities: { max_input_images: 1 } },
          ],
        });
      }
      if (target.endsWith('/uploads') && init.method === 'POST') {
        return Response.json({ asset_id: 'up_1', upload_url: 'https://storage.example/presigned-put' });
      }
      if (target === 'https://storage.example/presigned-put' && init.method === 'PUT') {
        if (uploadBehavior === 'put403') return new Response('forbidden', { status: 403 });
        await delay(35);
        return new Response(null, { status: 200 });
      }
      if (target.endsWith('/uploads/up_1/commit') && init.method === 'POST') {
        return Response.json({ status: 'ready' });
      }
      if (target.endsWith('/images/edits') && init.method === 'POST') {
        return Response.json({ task_id: 'task_edit_ok' });
      }
      if (target.endsWith('/images/generations') && init.method === 'POST') {
        if (submitBehavior === 'plan403') {
          return new Response(JSON.stringify({ error: { code: 'tier_model_not_entitled' } }), { status: 403 });
        }
        if (submitBehavior === 'empty403') {
          return new Response('', { status: 403 });
        }
        if (submitBehavior === 'unknown403') {
          return new Response(JSON.stringify({ error: { code: 'model_region_blocked_xyz' } }), { status: 403 });
        }
        if (submitBehavior === 'hang_poll') {
          return Response.json({ task_id: 'task_hang' });
        }
        return Response.json({ task_id: 'task_img_ok' });
      }
      if (target.endsWith('/videos/tasks') && init.method === 'POST') {
        return Response.json({ task_id: 'task_vid_403' });
      }
      if (target.includes('/videos/tasks/task_vid_403/content')) {
        return new Response('signed url expired', { status: 403 });
      }
      if (target.includes('/videos/tasks/task_vid_403')) {
        return Response.json({ status: 'succeeded' });
      }
      if (target.includes('/images/tasks/task_hang')) {
        resolveHangPoll();
        return Response.json({ status: 'running' });
      }
      return Response.json({ status: 'succeeded', assets: [{ url: 'https://cdn.example/out.png' }] });
    },
    download: async () => png1x1,
  });

  // 1) Explicit unconfigured BYOK model must reject as PROVIDER_NOT_CONFIGURED (NOT ACCOUNT_SIGNED_OUT)
  await assert.rejects(gateway.submit({
    modality: 'image',
    prompt: 'BYOK not configured',
    model: 'fal:fal-ai/flux/schnell',
    library: { title: 'Unconfigured BYOK' },
  }, codexHost, { entrySurface: 'mcp_media_use' }), /unavailable/i);

  // Sync OpenDesign Cloud models so supportsImageReference=true
  await gateway.configureProvider('opendesign', { apiKey: 'od-key-valid', baseUrl: 'https://amr-api.open-design.ai' });
  await gateway.listModels({ provider: 'opendesign', refresh: true });

  // Prepare a library reference image
  const refPath = path.join(store.directory, 'ref.png');
  await writeFile(refPath, png1x1);
  const { AssetLibrary } = await import('../gateway/asset-library.ts');
  const libAsset = await new AssetLibrary(store).importFile(refPath, { requestId: 'ref-1', name: 'Ref' });

  // 2) Presigned storage PUT 403: must keep storage error message, classify UPLOAD_FAILED / network_download, and NOT reject API key
  uploadBehavior = 'put403';
  const put403Job = await gateway.submit({
    modality: 'image',
    prompt: 'Edit with ref',
    model: 'opendesign:gpt-image-2',
    library: { title: 'Put 403', references: [{ assetId: libAsset.id, versionId: libAsset.currentVersionId }] },
  }, undefined, { entrySurface: 'studio' });
  await gateway.tick();
  await Promise.all([...gateway.active.values()].map(t => t.done));
  const put403Done = await gateway.getJob(put403Job.id);
  assert.match(put403Done.error ?? '', /reference upload storage HTTP 403/i);
  assert.equal((await gateway.status()).providers.find(p => p.id === 'opendesign')?.verification, 'unverified');

  // 3) Upload vs Remote timing mutual exclusivity (upload ~35ms, remote ~10ms)
  uploadBehavior = 'ok_slow';
  const timingJob = await gateway.submit({
    modality: 'image',
    prompt: 'Edit timing check',
    model: 'opendesign:gpt-image-2',
    idempotencyKey: 'cross-surface-idem',
    library: { title: 'Timing', references: [{ assetId: libAsset.id, versionId: libAsset.currentVersionId }] },
  }, undefined, { entrySurface: 'studio' });
  // Cross-surface replay from mcp_media_use must attribute replayed event to mcp_media_use (not studio)
  const replayedJob = await gateway.submit({
    modality: 'image',
    prompt: 'Edit timing check',
    model: 'opendesign:gpt-image-2',
    idempotencyKey: 'cross-surface-idem',
    library: { title: 'Timing', references: [{ assetId: libAsset.id, versionId: libAsset.currentVersionId }] },
  }, codexHost, { entrySurface: 'mcp_media_use' });
  assert.equal(replayedJob.id, timingJob.id);
  await gateway.tick();
  await Promise.all([...gateway.active.values()].map(t => t.done));

  // 4) Cloud 403 tier_model_not_entitled, empty 403, and unknown-code 403 must NOT reject API key; unapproved capabilityId must map to 'other'
  submitBehavior = 'plan403';
  const plan403Job = await gateway.submit({
    modality: 'image',
    prompt: 'Entitlement test',
    model: 'opendesign:gpt-image-2',
    capabilityId: 'caller-secret-token-slug',
    library: { title: 'Plan 403' },
  }, undefined, { entrySurface: 'studio' });
  await gateway.tick();
  await Promise.all([...gateway.active.values()].map(t => t.done));
  assert.equal((await gateway.status()).providers.find(p => p.id === 'opendesign')?.verification, 'verified');

  submitBehavior = 'empty403';
  const empty403Job = await gateway.submit({
    modality: 'image',
    prompt: 'Empty 403 test',
    model: 'opendesign:gpt-image-2',
    library: { title: 'Empty 403' },
  }, undefined, { entrySurface: 'studio' });
  await gateway.tick();
  await Promise.all([...gateway.active.values()].map(t => t.done));
  assert.equal((await gateway.status()).providers.find(p => p.id === 'opendesign')?.verification, 'verified');

  submitBehavior = 'unknown403';
  const unknown403Job = await gateway.submit({
    modality: 'image',
    prompt: 'Unknown 403 test',
    model: 'opendesign:gpt-image-2',
    library: { title: 'Unknown 403' },
  }, undefined, { entrySurface: 'studio' });
  await gateway.tick();
  await Promise.all([...gateway.active.values()].map(t => t.done));
  assert.equal((await gateway.status()).providers.find(p => p.id === 'opendesign')?.verification, 'verified');

  // 5) Cloud video /content 403: DOWNLOAD_FAILED / network_download, captures video params, and must NOT reject API key
  submitBehavior = 'video_content403';
  const vidJob = await gateway.submit({
    modality: 'video',
    prompt: 'Video content 403',
    model: 'opendesign:seedance-2.0',
    parameters: { duration: 10, resolution: '1080p', ratio: '16:9', generate_audio: true },
    library: { title: 'Video 403' },
  }, undefined, { entrySurface: 'studio' });
  await gateway.tick();
  await Promise.all([...gateway.active.values()].map(t => t.done));
  assert.equal((await gateway.status()).providers.find(p => p.id === 'opendesign')?.verification, 'verified');

  // 6) Queued resume cancellation: must clear stale startedAt so queue_wait_ms is omitted and cancel_wait_ms uses attemptCreatedAt
  await delay(25);
  await gateway.resume(vidJob.id, 'resume-then-cancel');
  const resumedQueued = await gateway.getJob(vidJob.id);
  assert.equal(resumedQueued.startedAt, undefined);
  await gateway.cancel(vidJob.id, { source: 'mcp' });

  // 7) Running job cancellation captures non-queued phase_before_cancel and live remote_ms
  submitBehavior = 'hang_poll';
  const runCancelJob = await gateway.submit({
    modality: 'image',
    prompt: 'Cancel while running',
    model: 'opendesign:gpt-image-2',
    library: { title: 'Run cancel' },
  }, undefined, { entrySurface: 'studio' });
  await gateway.tick();
  await hangPollReached;
  await gateway.cancel(runCancelJob.id, { source: 'studio' });
  await Promise.all([...gateway.active.values()].map(t => t.done));

  // 8) Dead worker interrupted reconciliation via tick() records last_active_phase and WORKER_INTERRUPTED
  submitBehavior = 'ok';
  const deadJob = await gateway.submit({
    modality: 'image',
    prompt: 'Dead worker test',
    model: 'opendesign:gpt-image-2',
    library: { title: 'Dead worker' },
  }, undefined, { entrySurface: 'studio' });
  const deadPath = path.join(gateway.root, 'jobs', `${deadJob.id}.json`);
  const storedDead = await gateway.getJob(deadJob.id);
  await writeFile(deadPath, JSON.stringify({ ...storedDead, state: 'running', phase: 'generating', startedAt: Date.now() - 50, workerPid: 2147483647 }));
  await gateway.tick();

  // 9) BYOK 402 classifies as byok_billing (NOT commercial_gate)
  const falGateway = new ModelGateway(store, {
    tracking,
    detect: async () => [],
    pollMs: 5,
    fetcher: async () => new Response(JSON.stringify({ error: { code: 'insufficient_balance' } }), { status: 402 }),
  });
  await falGateway.configureProvider('fal', { apiKey: 'fal-key' });
  const byok402Job = await falGateway.submit({
    modality: 'image',
    prompt: 'BYOK 402',
    model: 'fal:fal-ai/flux/schnell',
    library: { title: 'BYOK 402' },
  }, undefined, { entrySurface: 'studio' });
  await falGateway.tick();
  await Promise.all([...falGateway.active.values()].map(t => t.done));

  // 10) resumableDownload failing with 403 then stream error must NOT keep stale 403 status
  let dlAttempt = 0;
  const dlDir = path.join(store.directory, 'dl-status-reset');
  await import('node:fs/promises').then(fs => fs.mkdir(dlDir, { recursive: true }));
  await assert.rejects(
    resumableDownload(
      dlDir,
      async () => ({ assetId: 'a1', size: 128, mime: 'image/png', url: 'https://cdn.example/img.png' }),
      new AbortController().signal,
      async () => {},
      async () => {
        dlAttempt++;
        if (dlAttempt === 1) return new Response('forbidden', { status: 403 });
        throw new Error('socket hang up');
      },
      2,
    ),
    (err: unknown) => {
      assert.equal(extractHttpStatus(err), undefined, 'final stream error must not carry stale 403 from attempt 1');
      return true;
    },
  );

  while (tracking.pending() > 0) await tracking.flush();

  // Assert per-surface conservation for mcp_media_use (1 rejected + 1 replayed = 2 requested)
  const mcpReq = events.filter(e => e.event === 'media_generation_requested' && e.properties.entry_surface === 'mcp_media_use');
  const mcpSub = events.filter(e => e.event === 'media_generation_submitted' && e.properties.entry_surface === 'mcp_media_use');
  const mcpRej = events.filter(e => e.event === 'media_generation_rejected' && e.properties.entry_surface === 'mcp_media_use');
  const mcpRep = events.filter(e => e.event === 'media_generation_replayed' && e.properties.entry_surface === 'mcp_media_use');
  assert.equal(mcpReq.length, mcpSub.length + mcpRej.length + mcpRep.length);
  assert.equal(mcpRej[0]?.properties.rejection_reason, 'PROVIDER_NOT_CONFIGURED');
  assert.equal(mcpRej[0]?.properties.rejection_category, 'provider_unavailable');
  assert.equal(mcpRep[0]?.properties.entry_surface, 'mcp_media_use');
  assert.equal(mcpRep[0]?.host_context?.host_agent, 'codex');

  // Assert storage PUT 403
  const put403Res = events.find(e => e.event === 'media_generation_result' && e.properties.job_id === put403Job.id);
  assert.equal(put403Res?.properties.failure_phase, 'uploading');
  assert.equal(put403Res?.properties.http_status, 403);
  assert.equal(put403Res?.properties.error_code, 'UPLOAD_FAILED');
  assert.equal(put403Res?.properties.error_category, 'network_download');

  // Assert upload_ms and remote_ms are mutually exclusive (upload >= 25ms; upload + remote <= end_to_end + 10ms)
  const timingRes = events.find(e => e.event === 'media_generation_result' && e.properties.job_id === timingJob.id);
  assert.equal(timingRes?.properties.job_state, 'completed');
  assert.ok((timingRes?.properties.upload_ms ?? 0) >= 25, `expected upload_ms >= 25, got ${timingRes?.properties.upload_ms}`);
  assert.ok((timingRes?.properties.remote_ms ?? 0) < (timingRes?.properties.upload_ms ?? 0) + 15 || (timingRes?.properties.upload_ms ?? 0) + (timingRes?.properties.remote_ms ?? 0) <= (timingRes?.properties.end_to_end_ms ?? 0) + 10);

  // Assert Cloud 403 entitlement, empty 403, unknown-code 403, and capability_id privacy mapping
  const plan403Sub = events.find(e => e.event === 'media_generation_submitted' && e.properties.job_id === plan403Job.id);
  const plan403Req = events.find(e => e.event === 'media_generation_requested' && e.properties.request_id === plan403Sub?.properties.request_id);
  assert.equal(plan403Req?.properties.capability_id, 'other');
  assert.equal(plan403Sub?.properties.capability_id, 'other');
  const plan403Res = events.find(e => e.event === 'media_generation_result' && e.properties.job_id === plan403Job.id);
  assert.equal(plan403Res?.properties.http_status, 403);
  assert.equal(plan403Res?.properties.upstream_error_code, 'tier_model_not_entitled');
  assert.equal(plan403Res?.properties.error_code, 'PLAN_NOT_ENTITLED');
  assert.equal(plan403Res?.properties.error_category, 'commercial_gate');
  const empty403Res = events.find(e => e.event === 'media_generation_result' && e.properties.job_id === empty403Job.id);
  assert.equal(empty403Res?.properties.http_status, 403);
  assert.equal(empty403Res?.properties.upstream_error_code, undefined);
  assert.equal(empty403Res?.properties.error_code, 'AUTH_REJECTED');
  assert.equal(empty403Res?.properties.error_category, 'auth_credential');
  const unknown403Res = events.find(e => e.event === 'media_generation_result' && e.properties.job_id === unknown403Job.id);
  assert.equal(unknown403Res?.properties.http_status, 403);
  assert.equal(unknown403Res?.properties.upstream_error_code, 'other');
  assert.equal(unknown403Res?.properties.error_code, 'PROVIDER_ERROR');
  assert.equal(unknown403Res?.properties.error_category, 'upstream_error');
  assert.equal(
    mediaGenerationError(new ProviderError('Your OpenDesign sign-in was rejected.', 403, 'invalid_token')),
    'AUTH_REJECTED',
  );
  assert.equal(
    mediaGenerationError(new ProviderError('Provider HTTP 403: credentials or permissions rejected', 403, 'provider_error')),
    'AUTH_REJECTED',
  );
  assert.equal(
    mediaGenerationError(new ProviderError('HTTP 403 Forbidden: content policy violation', 403, 'content_policy_violation')),
    'CONTENT_BLOCKED',
  );
  assert.equal(mediaGenerationErrorCategory('CONTENT_BLOCKED', 'submitting', 'amr_account'), 'content_policy');
  assert.doesNotMatch(JSON.stringify(events), /caller-secret-token-slug|model_region_blocked_xyz/);

  // Assert video /content 403 + video params + queued-resume cancel
  const vidResults = events.filter(e => e.event === 'media_generation_result' && e.properties.job_id === vidJob.id);
  assert.equal(vidResults.length, 2);
  assert.equal(vidResults[0]?.properties.failure_phase, 'downloading');
  assert.equal(vidResults[0]?.properties.error_code, 'DOWNLOAD_FAILED');
  assert.equal(vidResults[0]?.properties.requested_duration_sec, 10);
  assert.equal(vidResults[0]?.properties.requested_resolution, '1080p');
  assert.equal(vidResults[0]?.properties.requested_aspect_ratio, '16:9');
  assert.equal(vidResults[0]?.properties.requested_audio, true);
  assert.equal(vidResults[1]?.properties.job_state, 'cancelled');
  assert.equal(vidResults[1]?.properties.attempt_kind, 'resume');
  assert.equal(vidResults[1]?.properties.queue_wait_ms, undefined);
  assert.ok((vidResults[1]?.properties.cancel_wait_ms ?? 9999) < (vidResults[1]?.properties.end_to_end_ms ?? 0));

  // Assert running cancel captured non-queued phase and live remote_ms
  const runCancelRes = events.find(e => e.event === 'media_generation_result' && e.properties.job_id === runCancelJob.id);
  assert.equal(runCancelRes?.properties.job_state, 'cancelled');
  assert.notEqual(runCancelRes?.properties.phase_before_cancel, 'queued');
  assert.equal(runCancelRes?.properties.last_active_phase, runCancelRes?.properties.phase_before_cancel);
  assert.equal(typeof runCancelRes?.properties.remote_ms, 'number');

  // Assert dead worker interrupted event
  const deadRes = events.find(e => e.event === 'media_generation_result' && e.properties.job_id === deadJob.id);
  assert.equal(deadRes?.properties.failure_phase, 'interrupted');
  assert.equal(deadRes?.properties.last_active_phase, 'generating');
  assert.equal(deadRes?.properties.error_code, 'WORKER_INTERRUPTED');
  assert.equal(deadRes?.properties.error_category, 'client_interrupted');

  // Assert BYOK 402 -> byok_billing
  const byokRes = events.find(e => e.event === 'media_generation_result' && e.properties.job_id === byok402Job.id);
  assert.equal(byokRes?.properties.route_channel, 'byok_builtin');
  assert.equal(byokRes?.properties.http_status, 402);
  assert.equal(byokRes?.properties.error_code, 'BALANCE_LOW');
  assert.equal(byokRes?.properties.error_category, 'byok_billing');

  await gateway.close();
  await falGateway.close();
  tracking.close();
}, false));


// ==================== UNIFIED MEDIA TELEMETRY (3D / SCRIPT / PRE-GATEWAY / RETRY REJECTED) ====================

const unifiedTinyPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Z0ioAAAAASUVORK5CYII=',
  'base64',
);

function buildMinimalGlb(): Buffer {
  const gltf = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: 'Cube' }],
    meshes: [{
      name: 'CubeMesh',
      primitives: [{ attributes: { POSITION: 0 }, indices: 1 }],
    }],
    buffers: [{ byteLength: 42 }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 36, target: 34962 },
      { buffer: 0, byteOffset: 36, byteLength: 6, target: 34963 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] },
      { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' },
    ],
  };
  let jsonBuf = Buffer.from(JSON.stringify(gltf), 'utf8');
  while (jsonBuf.length % 4 !== 0) jsonBuf = Buffer.concat([jsonBuf, Buffer.from(' ')]);

  const binData = Buffer.alloc(44);
  binData.writeFloatLE(0, 0); binData.writeFloatLE(0, 4); binData.writeFloatLE(0, 8);
  binData.writeFloatLE(1, 12); binData.writeFloatLE(0, 16); binData.writeFloatLE(0, 20);
  binData.writeFloatLE(0, 24); binData.writeFloatLE(1, 28); binData.writeFloatLE(0, 32);
  binData.writeUInt16LE(0, 36); binData.writeUInt16LE(1, 38); binData.writeUInt16LE(2, 40);

  const totalLength = 12 + 8 + jsonBuf.length + 8 + binData.length;
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0); // "glTF"
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(totalLength, 8);

  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonBuf.length, 0);
  jsonHeader.writeUInt32LE(0x4e4f534a, 4); // "JSON"

  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(binData.length, 0);
  binHeader.writeUInt32LE(0x004e4942, 4); // "BIN\0"

  return Buffer.concat([header, jsonHeader, jsonBuf, binHeader, binData]);
}

const minimalGlb = buildMinimalGlb();

async function makeTracking() {
  const sent: PendingEvent[] = [];
  const tracking = createTracker({
    registry: omEvents,
    entrypoint: 'worker',
    enabled: true,
    flushIntervalMs: 0,
    send: async batch => {
      sent.push(...batch);
      return 'accepted';
    },
  });
  return {
    tracking,
    sent,
    flushAll: async () => {
      while (tracking.pending() > 0) await tracking.flush();
    },
  };
}

function assertClosedFunnel(events: PendingEvent[], filter?: (e: PendingEvent) => boolean) {
  const scoped = filter ? events.filter(filter) : events;
  const requested = scoped.filter(e => e.event === 'media_generation_requested');
  const submitted = scoped.filter(e => e.event === 'media_generation_submitted');
  const rejected = scoped.filter(e => e.event === 'media_generation_rejected');
  const replayed = scoped.filter(e => e.event === 'media_generation_replayed');
  assert.equal(
    requested.length,
    submitted.length + rejected.length + replayed.length,
    `Funnel broken: requested=${requested.length}, submitted=${submitted.length}, rejected=${rejected.length}, replayed=${replayed.length}`,
  );
  const reqIds = new Set(requested.map(e => e.properties.request_id));
  for (const ev of [...submitted, ...rejected, ...replayed]) {
    assert.ok(reqIds.has(ev.properties.request_id), `${ev.event} request_id missing from requested`);
  }
}

test('schema: 3d modality, spatial dimensions and media_generation_retry_rejected are registered for worker only', () => {
  assert.equal(validField(omEvents.media_generation_requested.fields.modality, '3d'), true);
  assert.equal(validField(omEvents.media_generation_requested.fields.executor_kind, 'script'), true);
  assert.equal(validField(omEvents.media_generation_requested.fields.spatial_kind, 'asset'), true);
  assert.equal(validField(omEvents.media_generation_result.fields.pipeline_step, 'retarget'), true);
  assert.equal(validField(omEvents.media_generation_result.fields.generation_mode, 'retarget-3d'), true);
  assert.equal(validField(omEvents.media_generation_rejected.fields.rejection_reason, 'STUDIO_NOT_OPEN'), true);
  assert.equal(validField(omEvents.media_generation_rejected.fields.rejection_reason, 'NATIVE_RUNTIME_MISSING'), true);
  assert.equal(validField(omEvents.media_generation_retry_rejected.fields.attempt_kind, 'resume'), true);
  assert.equal(validField(omEvents.media_generation_retry_rejected.fields.attempt_kind, 'retry_save'), true);
  assert.equal(Object.hasOwn(studioEvents, 'media_generation_retry_rejected'), false);
});

test('3d-asset multi-step pipeline (base -> rig -> retarget), replay, and failure attribution flow through unified media telemetry', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'om-unified-3d-'));
  clearOpenDesign3dDiscoveryCache();
  try {
    const store = new WorkspaceStore(dir);
    const { tracking, sent, flushAll } = await makeTracking();
    const gateway = gatewayFor(store, tracking);
    gateway.options.pollMs = 5;
    gateway.options.detect = async () => [];

    // Seed a local reference image in the Asset Library for image-to-3d tests
    const refPngPath = path.join(dir, 'hero-ref.png');
    await writeFile(refPngPath, unifiedTinyPng);
    const library = new AssetLibrary(store);
    const refAsset = await library.importFile(refPngPath, { requestId: 'seed-ref-1', name: 'Hero Ref' });
    const refPointer = { assetId: refAsset.id, versionId: refAsset.versions[0].id };

    let scenario: 'rig_retarget_ok' | 'retarget_502' | 'put_403' | 'download_403' | 'invalid_glb' | 'empty_artifacts' | 'balance_402' = 'rig_retarget_ok';
    let taskCounter = 0;

    gateway.options.fetcher = (async (input: string | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = (init?.method ?? 'GET').toUpperCase();

      if (url.includes('/api/v1/media/models')) {
        return new Response(JSON.stringify({
          models: [
            { model: 'tripo-3.0', kind: '3d_generations', label: 'Tripo 3D v3' },
            { model: 'worldlabs-atlas', kind: 'world_generations', label: 'World Labs Atlas v2' },
          ],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }

      if (url.endsWith('/api/v1/media/uploads') && method === 'POST') {
        return new Response(JSON.stringify({
          asset_id: 'upload_3d_1',
          upload_url: 'https://storage.example.test/presigned-3d-ref',
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }

      if (url === 'https://storage.example.test/presigned-3d-ref' && method === 'PUT') {
        if (scenario === 'put_403') {
          return new Response('AccessDenied', { status: 403 });
        }
        return new Response('', { status: 200 });
      }

      if (url.includes('/api/v1/media/uploads/upload_3d_1/commit') && method === 'POST') {
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }

      if (url.endsWith('/api/v1/media/3d/tasks') && method === 'POST') {
        const body = JSON.parse(String(init?.body ?? '{}'));
        if (scenario === 'balance_402') {
          return new Response(JSON.stringify({ error: { code: 'insufficient_balance', message: 'Not enough credits' } }), {
            status: 402,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (scenario === 'retarget_502' && body.operation === 'retarget') {
          return new Response(JSON.stringify({ error: { code: 'service_unavailable', message: 'origin_bad_gateway' } }), {
            status: 502,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        const id = `tripo_task_${++taskCounter}_${body.operation}`;
        return new Response(JSON.stringify({ task_id: id, status: 'queued' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url.includes('/api/v1/media/3d/tasks/tripo_task_') && method === 'GET') {
        if (scenario === 'empty_artifacts') {
          return new Response(JSON.stringify({ status: 'succeeded', artifacts: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({
          status: 'succeeded',
          artifacts: [{ name: 'model', format: 'glb', content_path: '/api/v1/media/3d/content/model.glb' }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }

      if (url.includes('/api/v1/media/3d/content/model.glb')) {
        if (scenario === 'download_403') {
          return new Response('Forbidden', { status: 403 });
        }
        if (scenario === 'invalid_glb') {
          return new Response(Buffer.from('not-a-valid-glb-payload-at-all'), { status: 200 });
        }
        return new Response(minimalGlb, { status: 200, headers: { 'Content-Type': 'model/gltf-binary' } });
      }

      return new Response('Not Found', { status: 404 });
    }) as typeof fetch;

    await gateway.configureProvider('opendesign', { apiKey: 'od_test_3d_key', baseUrl: 'https://api.opendesign.test' });
    const host = { host_agent: 'codex' as const, host_agent_source: 'mcp_client_info' as const };

    // 1) Multi-step 3d-asset (image_to_model -> rig -> retarget) succeeds
    scenario = 'rig_retarget_ok';
    const okRun = await capabilityRun(store, {
      action: 'run',
      capabilityId: '3d-asset',
      requestId: 'req-3d-rig-ok',
      prompt: 'Low poly knight',
      references: [refPointer],
      options: { operation: 'rig_retarget', rigPreset: 'mixamo-idle' },
      parameters: { slim: false },
    }, tracking, 'mcp', host);
    assert.equal(okRun.executorKind, 'script');

    // 2) Replay the exact same 3d-asset requestId
    const replayRun = await capabilityRun(store, {
      action: 'run',
      capabilityId: '3d-asset',
      requestId: 'req-3d-rig-ok',
      prompt: 'Low poly knight',
      references: [refPointer],
      options: { operation: 'rig_retarget', rigPreset: 'mixamo-idle' },
      parameters: { slim: false },
    }, tracking, 'mcp', host);
    assert.equal((replayRun as { replayed?: boolean }).replayed, true);

    // 3) Conflicting requestId -> rejected (not submitted)
    await assert.rejects(() => capabilityRun(store, {
      action: 'run',
      capabilityId: '3d-asset',
      requestId: 'req-3d-rig-ok',
      prompt: 'Different prompt for conflict',
      references: [refPointer],
      options: { operation: 'rig_retarget', rigPreset: 'mixamo-idle' },
    }, tracking, 'mcp', host), /REQUEST_ID_CONFLICT/);

    // 4) Multi-step failure at step 3 (retarget HTTP 502)
    scenario = 'retarget_502';
    await assert.rejects(() => capabilityRun(store, {
      action: 'run',
      capabilityId: '3d-asset',
      requestId: 'req-3d-retarget-502',
      prompt: 'Knight failing retarget',
      options: { operation: 'rig_retarget', rigPreset: 'mixamo-slash' },
    }, tracking, 'mcp', host), /HTTP 502/);

    // 5) Presigned storage PUT 403 -> UPLOAD_FAILED / network_download (NOT AUTH_REJECTED)
    scenario = 'put_403';
    await assert.rejects(() => capabilityRun(store, {
      action: 'run',
      capabilityId: '3d-asset',
      requestId: 'req-3d-put-403',
      prompt: 'Knight upload put 403',
      references: [refPointer],
      options: { operation: 'image_to_model' },
    }, tracking, 'mcp', host), /PUT failed with HTTP 403/);

    // 6) Download 403 -> DOWNLOAD_FAILED / network_download (NOT AUTH_REJECTED)
    scenario = 'download_403';
    await assert.rejects(() => capabilityRun(store, {
      action: 'run',
      capabilityId: '3d-asset',
      requestId: 'req-3d-dl-403',
      prompt: 'Knight download 403',
      options: { operation: 'text_to_model' },
    }, tracking, 'mcp', host), /HTTP 403/);

    // 7) Invalid GLB magic bytes -> failure_phase=decoding, INVALID_MEDIA / media_invalid
    scenario = 'invalid_glb';
    await assert.rejects(() => capabilityRun(store, {
      action: 'run',
      capabilityId: '3d-asset',
      requestId: 'req-3d-bad-glb',
      prompt: 'Knight corrupt glb',
      options: { operation: 'text_to_model' },
    }, tracking, 'mcp', host), /not a valid binary \.glb/);

    // 8) Empty artifacts -> failure_phase=decoding, EMPTY_OUTPUT
    scenario = 'empty_artifacts';
    await assert.rejects(() => capabilityRun(store, {
      action: 'run',
      capabilityId: '3d-asset',
      requestId: 'req-3d-empty-art',
      prompt: 'Knight empty artifacts',
      options: { operation: 'text_to_model' },
    }, tracking, 'mcp', host), /without a downloadable/);

    // 9) Balance 402 -> BALANCE_LOW / commercial_gate
    scenario = 'balance_402';
    await assert.rejects(() => capabilityRun(store, {
      action: 'run',
      capabilityId: '3d-asset',
      requestId: 'req-3d-402',
      prompt: 'Knight 402',
      options: { operation: 'text_to_model' },
    }, tracking, 'mcp', host), /HTTP 402/);

    // 10) Preflight validation error inside script (rig_retarget without animation) -> rejected (not submitted!)
    await assert.rejects(() => capabilityRun(store, {
      action: 'run',
      capabilityId: '3d-asset',
      requestId: 'req-3d-preflight-bad',
      prompt: 'Knight missing animation',
      options: { operation: 'rig_retarget' },
    }, tracking, 'mcp', host), /requires an animation/);

    await flushAll();

    // Closed conservation funnel across ALL 10 calls!
    assertClosedFunnel(sent);
    assertClosedFunnel(sent, e => e.properties.modality === '3d' && e.properties.executor_kind === 'script');

    const submitted = sent.filter(e => e.event === 'media_generation_submitted');
    const results = sent.filter(e => e.event === 'media_generation_result');
    const replayed = sent.filter(e => e.event === 'media_generation_replayed');
    const rejected = sent.filter(e => e.event === 'media_generation_rejected');

    assert.equal(submitted.length, 7);
    assert.equal(results.length, 7);
    assert.equal(replayed.length, 1);
    assert.equal(rejected.length, 2);

    // Check completed multi-step run
    const okRes = results.find(e => e.properties.job_state === 'completed');
    assert.ok(okRes);
    assert.equal(okRes.properties.modality, '3d');
    assert.equal(okRes.properties.executor_kind, 'script');
    assert.equal(okRes.properties.spatial_kind, 'asset');
    assert.equal(okRes.properties.pipeline_step, 'retarget');
    assert.equal(okRes.properties.route_channel, 'amr_opendesign');
    assert.equal(okRes.properties.model_id, 'tripo-3.0');
    assert.equal(okRes.properties.asset_count, 1);
    assert.equal(okRes.properties.has_remote_id, true);
    assert.equal(okRes.host_context?.host_agent, 'codex');
    assert.equal(typeof okRes.properties.upload_ms, 'number');
    assert.equal(typeof okRes.properties.remote_ms, 'number');
    assert.equal(typeof okRes.properties.download_ms, 'number');
    assert.equal(typeof okRes.properties.save_ms, 'number');
    assert.ok((okRes.properties.total_output_bytes as number) > 0);

    // Replay shares the same job_id UUID
    assert.equal(replayed[0].properties.job_id, okRes.properties.job_id);
    assert.equal(replayed[0].properties.existing_job_state, 'completed');

    // Step 3 retarget 502 attribution
    const res502 = results.find(e => e.properties.http_status === 502);
    assert.ok(res502);
    assert.equal(res502.properties.pipeline_step, 'retarget');
    assert.equal(res502.properties.failure_phase, 'submitting');
    assert.equal(res502.properties.error_code, 'UPSTREAM_5XX');
    assert.equal(res502.properties.error_category, 'upstream_error');
    assert.equal(res502.properties.upstream_error_code, 'service_unavailable');

    // Presigned PUT 403 -> UPLOAD_FAILED / network_download with pipeline_step=base & generation_mode=image-to-3d
    const resPut403 = results.find(e => e.properties.failure_phase === 'uploading');
    assert.ok(resPut403);
    assert.equal(resPut403.properties.http_status, 403);
    assert.equal(resPut403.properties.error_code, 'UPLOAD_FAILED');
    assert.equal(resPut403.properties.error_category, 'network_download');
    assert.equal(resPut403.properties.pipeline_step, 'base');
    assert.equal(resPut403.properties.generation_mode, 'image-to-3d');

    // Download 403 -> DOWNLOAD_FAILED / network_download
    const resDl403 = results.find(e => e.properties.failure_phase === 'downloading');
    assert.ok(resDl403);
    assert.equal(resDl403.properties.http_status, 403);
    assert.equal(resDl403.properties.error_code, 'DOWNLOAD_FAILED');
    assert.equal(resDl403.properties.error_category, 'network_download');

    // Invalid GLB -> decoding / INVALID_MEDIA
    const resBadGlb = results.find(e => e.properties.error_code === 'INVALID_MEDIA');
    assert.ok(resBadGlb);
    assert.equal(resBadGlb.properties.failure_phase, 'decoding');
    assert.equal(resBadGlb.properties.error_category, 'media_invalid');

    // Empty artifacts -> decoding / EMPTY_OUTPUT
    const resEmpty = results.find(e => e.properties.error_code === 'EMPTY_OUTPUT');
    assert.ok(resEmpty);
    assert.equal(resEmpty.properties.failure_phase, 'decoding');

    // Balance 402 -> BALANCE_LOW / commercial_gate
    const res402 = results.find(e => e.properties.http_status === 402);
    assert.ok(res402);
    assert.equal(res402.properties.error_code, 'BALANCE_LOW');
    assert.equal(res402.properties.error_category, 'commercial_gate');
    assert.equal(res402.properties.upstream_error_code, 'insufficient_balance');

    // Rejections: IDEMPOTENCY_CONFLICT and OPTIONS_INVALID
    const reasons = rejected.map(e => e.properties.rejection_reason).sort();
    assert.deepEqual(reasons, ['IDEMPOTENCY_CONFLICT', 'OPTIONS_INVALID']);

    await gateway.close();
    tracking.close();
  } finally {
    clearOpenDesign3dDiscoveryCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test('3d-world (World Labs Atlas) success and remote task failure emit unified spatial telemetry', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'om-unified-world-'));
  clearOpenDesign3dDiscoveryCache();
  try {
    const store = new WorkspaceStore(dir);
    const { tracking, sent, flushAll } = await makeTracking();
    const gateway = gatewayFor(store, tracking);
    gateway.options.pollMs = 5;
    gateway.options.detect = async () => [];

    let failWorld = false;
    gateway.options.fetcher = (async (input: string | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = (init?.method ?? 'GET').toUpperCase();
      if (url.includes('/api/v1/media/models')) {
        return new Response(JSON.stringify({
          models: [{ model: 'worldlabs-atlas', kind: 'world_generations', label: 'World Labs Atlas v2' }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.endsWith('/api/v1/media/worlds/tasks') && method === 'POST') {
        return new Response(JSON.stringify({ task_id: failWorld ? 'world_fail_1' : 'world_ok_1', status: 'queued' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/api/v1/media/worlds/tasks/world_ok_1')) {
        return new Response(JSON.stringify({
          status: 'succeeded',
          artifacts: [{ name: 'preview_image', format: 'png', content_path: '/api/v1/media/worlds/content/frame.png' }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes('/api/v1/media/worlds/tasks/world_fail_1')) {
        return new Response(JSON.stringify({
          status: 'failed',
          error: { code: 'safety_blocked', message: 'Blocked by world policy' },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes('/api/v1/media/worlds/content/frame.png')) {
        return new Response(unifiedTinyPng, { status: 200, headers: { 'Content-Type': 'image/png' } });
      }
      return new Response('Not Found', { status: 404 });
    }) as typeof fetch;

    await gateway.configureProvider('opendesign', { apiKey: 'od_test_world_key', baseUrl: 'https://api.opendesign.test' });

    const okWorld = await capabilityRun(store, {
      action: 'run',
      capabilityId: '3d-world',
      requestId: 'req-world-ok',
      prompt: 'Floating archipelago in golden hour',
    }, tracking, 'mcp');
    assert.equal(okWorld.executorKind, 'script');

    failWorld = true;
    await assert.rejects(() => capabilityRun(store, {
      action: 'run',
      capabilityId: '3d-world',
      requestId: 'req-world-fail',
      prompt: 'Blocked world prompt',
    }, tracking, 'mcp'), /failed/);

    await flushAll();
    assertClosedFunnel(sent);

    const results = sent.filter(e => e.event === 'media_generation_result');
    assert.equal(results.length, 2);
    const okEv = results.find(e => e.properties.job_state === 'completed');
    const failEv = results.find(e => e.properties.job_state === 'failed');
    assert.ok(okEv && failEv);
    assert.equal(okEv.properties.spatial_kind, 'world');
    assert.equal(okEv.properties.pipeline_step, 'world');
    assert.equal(okEv.properties.generation_mode, 'text-to-world');
    assert.equal(okEv.properties.entry_surface, 'mcp_capability_run');
    assert.equal(okEv.properties.model_id, 'worldlabs-atlas');

    assert.equal(failEv.properties.spatial_kind, 'world');
    assert.equal(failEv.properties.pipeline_step, 'world');
    assert.equal(failEv.properties.failure_phase, 'remote_task');
    assert.equal(failEv.properties.remote_terminal, true);
    assert.equal(failEv.properties.upstream_error_code, 'safety_blocked');
    assert.equal(failEv.properties.error_code, 'CONTENT_BLOCKED');
    assert.equal(failEv.properties.error_category, 'content_policy');
    await gateway.close();
    tracking.close();
  } finally {
    clearOpenDesign3dDiscoveryCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test('pre-gateway rejections (/api/generations 503, /api/capabilities/run 503, pre-submit capability validation, assetOperation validation) and retry_rejected maintain funnel completeness', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'om-unified-pregate-'));
  try {
    const store = new WorkspaceStore(dir);
    const { tracking, sent, flushAll } = await makeTracking();
    const gateway = gatewayFor(store, tracking);
    gateway.options.detect = async () => [];
    gateway.options.pollMs = 5;

    // 1) Server 503 STUDIO_NOT_OPEN on /api/generations and /api/capabilities/run (and dryRun=true must NOT emit!)
    const server = createServer((req, res) => {
      void serverHandler(req, res, store, {
        tracking,
        studio: { alive: () => false } as any,
      });
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    const baseUrl = `http://127.0.0.1:${port}`;
    try {
      const r1 = await fetch(`${baseUrl}/motion-api/generations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: baseUrl },
        body: JSON.stringify({
          modality: 'video',
          prompt: 'Ocean wave',
          idempotencyKey: 'k-503-gen',
          parameters: { images: ['ref-a.png', 'ref-b.png'] },
        }),
      });
      assert.equal(r1.status, 503);

      const r2 = await fetch(`${baseUrl}/motion-api/capabilities/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: baseUrl },
        body: JSON.stringify({ capabilityId: '3d-asset', requestId: 'k-503-cap', prompt: 'Hero statue' }),
      });
      assert.equal(r2.status, 503);
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }

    // 2) Pre-submit rejection in capabilityRun (no provider configured -> CAPABILITY_UNAVAILABLE)
    await assert.rejects(() => capabilityRun(store, {
      action: 'run',
      capabilityId: 'text-to-image',
      requestId: 'req-cap-no-provider',
      prompt: 'A sunrise',
    }, tracking, 'mcp'), /CAPABILITY_UNAVAILABLE/);

    // 3) dryRun=true failure must NOT emit media_generation_* events
    await assert.rejects(() => capabilityRun(store, {
      action: 'run',
      capabilityId: 'text-to-image',
      dryRun: true,
      prompt: 'Dry run quote',
    }, tracking, 'mcp'), /CAPABILITY_UNAVAILABLE/);

    // 4) assetOperation generate pre-gateway failure (missing model/requestId)
    await assert.rejects(() => assetOperation(store, {
      action: 'generate',
      modality: 'image',
      prompt: 'Missing model',
    }, undefined, tracking, 'mcp'), /Choose a model/);

    // 5) media_generation_retry_rejected on resume() and retrySave()
    gateway.options.fetcher = (async (input: string | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/v1/media/images/generations') || url.includes('/images/generations')) {
        return new Response(JSON.stringify({ error: { code: 'invalid_request', message: 'Bad prompt' } }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ models: [{ id: 'gpt-image-2', media_type: 'image', label: 'GPT Image 2' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;
    await gateway.configureProvider('opendesign', { apiKey: 'od_retry_key', baseUrl: 'https://api.opendesign.test' });
    const job = await gateway.submit({
      modality: 'image',
      prompt: 'Test retry rejection',
      model: 'opendesign:gpt-image-2',
      idempotencyKey: 'req-retry-rej',
      library: {},
    }, undefined, { entrySurface: 'mcp_assets_use' });
    await gateway.tick();
    while (gateway.active.size > 0) await new Promise(r => setTimeout(r, 10));

    // resume on a job with no remoteId -> NOT_RESUMABLE
    await assert.rejects(() => gateway.resume(job.id, 'resume-req-1'), /can be resumed/);
    // retrySave on a failed job with no retained outputs -> SAVE_UNAVAILABLE
    await assert.rejects(() => gateway.retrySave(job.id), /SAVE_NOT_AVAILABLE/);

    await flushAll();
    assertClosedFunnel(sent);

    const rejected = sent.filter(e => e.event === 'media_generation_rejected');
    const studioNotOpen = rejected.filter(e => e.properties.rejection_reason === 'STUDIO_NOT_OPEN');
    assert.equal(studioNotOpen.length, 2);
    const video503Req = sent.find(e => e.event === 'media_generation_requested'
      && e.properties.request_id === studioNotOpen.find(r => r.properties.modality === 'video')?.properties.request_id);
    assert.equal(video503Req?.properties.reference_count, 2);
    assert.equal(video503Req?.properties.is_edit, true);
    assert.ok(studioNotOpen.some(e => e.properties.modality === 'video' && e.properties.executor_kind === 'gateway' && e.properties.entry_surface === 'studio'));
    assert.ok(studioNotOpen.some(e => e.properties.modality === '3d' && e.properties.executor_kind === 'script' && e.properties.spatial_kind === 'asset'));

    assert.ok(rejected.some(e => e.properties.rejection_reason === 'CAPABILITY_UNAVAILABLE' && e.properties.capability_id === 'text-to-image'));
    assert.ok(rejected.some(e => e.properties.rejection_reason === 'INVALID_PARAMETERS' && e.properties.entry_surface === 'mcp_assets_use'));

    const retryRejected = sent.filter(e => e.event === 'media_generation_retry_rejected');
    assert.equal(retryRejected.length, 2);
    assert.ok(retryRejected.some(e => e.properties.attempt_kind === 'resume' && e.properties.rejection_reason === 'NOT_RESUMABLE'));
    assert.ok(retryRejected.some(e => e.properties.attempt_kind === 'retry_save' && e.properties.rejection_reason === 'SAVE_UNAVAILABLE' && e.properties.rejection_category === 'local_storage'));

    await gateway.close();
    tracking.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('custom/future script executor without reportStage still produces closed requested -> submitted -> result funnel', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'om-unified-custom-script-'));
  const customScriptId = 'opendesign-3d';
  try {
    const store = new WorkspaceStore(dir);
    const { tracking, sent, flushAll } = await makeTracking();
    const outFile = path.join(dir, 'custom-out.glb');
    await writeFile(outFile, minimalGlb);

    registerCapabilityScriptExecutor(customScriptId, async () => ({
      sourcePath: outFile,
      name: 'Local Synthetic GLB',
      result: { bytes: minimalGlb.length },
    }));

    const res = await capabilityRun(store, {
      action: 'run',
      capabilityId: '3d-asset',
      requestId: 'req-local-script-1',
      prompt: 'Procedural cube',
    }, tracking, 'mcp');
    assert.equal(res.executorKind, 'script');

    await flushAll();
    assertClosedFunnel(sent);
    assert.equal(sent.filter(e => e.event === 'media_generation_submitted').length, 1);
    const resEv = sent.find(e => e.event === 'media_generation_result');
    assert.ok(resEv);
    assert.equal(resEv.properties.job_state, 'completed');
    assert.equal(resEv.properties.executor_kind, 'script');
    assert.equal(resEv.properties.spatial_kind, 'asset');
    assert.equal(resEv.properties.total_output_bytes, minimalGlb.length);
    tracking.close();
  } finally {
    unregisterCapabilityScriptExecutor(customScriptId);
    await rm(dir, { recursive: true, force: true });
  }
});

test('review regressions: custom spatial model redaction, cleanup failure with concurrent waiter, fast script timing, and entry-level retry_rejected', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'om-unified-regressions-'));
  const customScriptId = 'opendesign-3d';
  try {
    const store = new WorkspaceStore(dir);
    const { tracking, sent, flushAll } = await makeTracking();
    const outFile = path.join(dir, 'reg-out.glb');
    await writeFile(outFile, minimalGlb);

    // 1) Custom script returning private provider/model + throwing SYNCHRONOUSLY in cleanup() while a concurrent waiter awaits the same requestId
    let releaseHandler!: () => void;
    const handlerGate = new Promise<void>(resolve => { releaseHandler = resolve; });
    let handlerStarted!: () => void;
    const startedPromise = new Promise<void>(resolve => { handlerStarted = resolve; });

    registerCapabilityScriptExecutor(customScriptId, async () => {
      handlerStarted();
      await handlerGate;
      await new Promise(r => setTimeout(r, 15));
      return {
        sourcePath: outFile,
        name: 'Cleanup Regression GLB',
        cleanup: (() => {
          throw new Error('simulated synchronous temp cleanup failure');
        }) as unknown as () => Promise<void>,
        result: {
          provider: 'opendesign',
          model: 'private-tenant-secret-3d-v9',
          bytes: minimalGlb.length,
        },
      };
    });

    const p1 = capabilityRun(store, {
      action: 'run',
      capabilityId: '3d-asset',
      requestId: 'req-cleanup-race',
      prompt: 'Cleanup race test',
    }, tracking, 'mcp');
    await startedPromise;
    const p2 = capabilityRun(store, {
      action: 'run',
      capabilityId: '3d-asset',
      requestId: 'req-cleanup-race',
      prompt: 'Cleanup race test',
    }, tracking, 'mcp');
    releaseHandler();
    const [r1, r2] = await Promise.all([p1, p2]);
    assert.equal(r1.executorKind, 'script');
    assert.equal((r2 as { replayed?: boolean }).replayed, true);

    // Tamper with on-disk receipt telemetry and verify replay re-sanitizes it (never leaks private model_id)
    const library = new AssetLibrary(store);
    const cleanupReceiptPath = path.join(library.root, 'requests', `${assetHash('script:req-cleanup-race')}.json`);
    const savedReceipt = JSON.parse(await readFile(cleanupReceiptPath, 'utf8'));
    savedReceipt.telemetry = { providerKind: 'builtin', routeChannel: 'amr_opendesign', modelProvider: 'opendesign', modelId: 'tampered-secret-3d' };
    await writeFile(cleanupReceiptPath, JSON.stringify(savedReceipt));

    const r3 = await capabilityRun(store, {
      action: 'run',
      capabilityId: '3d-asset',
      requestId: 'req-cleanup-race',
      prompt: 'Cleanup race test',
    }, tracking, 'mcp');
    assert.equal((r3 as { replayed?: boolean }).replayed, true);

    // 1b) Cross-process active pending receipt ownership: live foreign PID prevents duplicate execution & preserves foreign receipt
    const foreignProc = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { stdio: 'ignore' });
    try {
      const crossReqId = 'req-cross-proc-live';
      const crossHash = assetHash({
        capabilityId: '3d-asset',
        prompt: 'Cross process test',
        options: { operation: 'auto', quality: 'hero-balanced', rigPreset: 'none' },
        parameters: {},
        assetId: null,
        parentVersionId: null,
        references: [],
      });
      const crossReceiptPath = path.join(library.root, 'requests', `${assetHash(`script:${crossReqId}`)}.json`);
      const foreignJobId = randomUUID();
      await mkdir(path.dirname(crossReceiptPath), { recursive: true });
      await writeFile(crossReceiptPath, JSON.stringify({
        inputHash: crossHash,
        assetId: randomUUID(),
        jobId: foreignJobId,
        workerPid: foreignProc.pid,
        status: 'pending',
      }));
      await assert.rejects(() => capabilityRun(store, {
        action: 'run',
        capabilityId: '3d-asset',
        requestId: crossReqId,
        prompt: 'Cross process test',
      }, tracking, 'mcp'), /REQUEST_IN_PROGRESS/);
      const preserved = JSON.parse(await readFile(crossReceiptPath, 'utf8'));
      assert.equal(preserved.jobId, foreignJobId);
      assert.equal(preserved.workerPid, foreignProc.pid);
    } finally {
      foreignProc.kill('SIGKILL');
    }

    // 2) Private spatial model returned by custom Cloud origin via opendesign-3d must NEVER emit unapproved model_id
    unregisterCapabilityScriptExecutor(customScriptId);
    clearOpenDesign3dDiscoveryCache();
    const gateway = gatewayFor(store, tracking);
    gateway.options.pollMs = 5;
    gateway.options.detect = async () => [];
    gateway.options.fetcher = (async (input: string | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = (init?.method ?? 'GET').toUpperCase();
      if (url.includes('/api/v1/media/models')) {
        return new Response(JSON.stringify({
          models: [{ model: 'private-custom-3d-model', kind: '3d_generations', label: 'Private 3D' }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.endsWith('/api/v1/media/3d/tasks') && method === 'POST') {
        return new Response(JSON.stringify({ task_id: 'priv_task_1', status: 'queued' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes('/api/v1/media/3d/tasks/priv_task_1')) {
        return new Response(JSON.stringify({
          status: 'succeeded',
          artifacts: [{ name: 'model', format: 'glb', content_path: '/api/v1/media/3d/content/priv.glb' }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes('/api/v1/media/3d/content/priv.glb')) {
        return new Response(minimalGlb, { status: 200, headers: { 'Content-Type': 'model/gltf-binary' } });
      }
      if (url.includes('/images/generations')) {
        return new Response(JSON.stringify({ error: { code: 'invalid_request', message: 'fail' } }), { status: 400, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('Not Found', { status: 404 });
    }) as typeof fetch;
    await gateway.configureProvider('opendesign', { apiKey: 'od_priv_key', baseUrl: 'https://private-cloud.example.test' });
    await capabilityRun(store, {
      action: 'run',
      capabilityId: '3d-asset',
      requestId: 'req-priv-3d',
      prompt: 'Private model check',
      parameters: { slim: false },
    }, tracking, 'mcp');

    // 3) Entry-level retry_rejected: invalid resume requestId + missing requestId in assetOperation & jobManage
    const failJob = await gateway.submit({
      modality: 'image',
      prompt: 'Entry retry rejected test',
      model: 'opendesign:gpt-image-2',
      idempotencyKey: 'req-entry-retry',
      library: {},
    }, undefined, { entrySurface: 'mcp_assets_use' });
    await gateway.tick();
    while (gateway.active.size > 0) await new Promise(r => setTimeout(r, 10));

    await assert.rejects(() => gateway.resume(failJob.id, 'bad space id!'), /stable requestId/);
    await assert.rejects(() => assetOperation(store, { action: 'resume', jobId: failJob.id }, undefined, tracking, 'mcp'), /stable requestId/);
    await assert.rejects(() => jobManage(store, { action: 'retry_save', jobId: failJob.id }, tracking), /requestId is required/);

    await flushAll();
    assertClosedFunnel(sent);

    // Cleanup race: EXACTLY ONE media_generation_result for req-cleanup-race (completed, zero duplicate failed!)
    const scriptResults = sent.filter(e => e.event === 'media_generation_result' && e.properties.executor_kind === 'script');
    assert.equal(scriptResults.length, 2); // 1 for req-cleanup-race + 1 for req-priv-3d
    assert.ok(scriptResults.every(e => e.properties.job_state === 'completed'));

    // Fast local script measured actual handler duration (> 0ms, not 0ms with execution time dumped into queue_wait_ms)
    const cleanupRunRes = scriptResults[0];
    assert.ok((cleanupRunRes.properties.duration_ms as number) >= 10, `expected duration_ms >= 10, got ${cleanupRunRes.properties.duration_ms}`);
    assert.equal(cleanupRunRes.properties.model_id, undefined);

    // Private spatial model and tampered receipt model NEVER leaked anywhere in any event
    assert.doesNotMatch(JSON.stringify(sent), /private-tenant-secret-3d-v9|private-custom-3d-model|tampered-secret-3d/);

    // Entry-level retry_rejected fired for all 3 entry validations
    const retryRej = sent.filter(e => e.event === 'media_generation_retry_rejected' && e.properties.job_id === failJob.id);
    assert.equal(retryRej.length, 3);
    assert.ok(retryRej.every(e => e.properties.rejection_reason === 'INVALID_IDEMPOTENCY_KEY'));

    await gateway.close();
    tracking.close();
  } finally {
    unregisterCapabilityScriptExecutor(customScriptId);
    clearOpenDesign3dDiscoveryCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test('Multimodal failure attribution blind spots: AMR upstream codes, CONTENT_BLOCKED, account wrapped causes, Codex empty output, and BYOK async upstream codes', () => fixture(async store => {
  const { AccountRequestError } = await import('../gateway/account.ts');
  const { ConnectorUnavailable } = await import('../gateway/account-connector.ts');
  const { tracking, events } = fakeTracker();

  // 1) AMR production upstream error codes stay in allowlist and map accurately
  assert.equal(extractUpstreamErrorCode(new ProviderError('limit', 429, 'provider_concurrency_exceeded')), 'provider_concurrency_exceeded');
  assert.equal(mediaGenerationError(new ProviderError('limit', 503, 'provider_concurrency_exceeded')), 'RATE_LIMITED');
  assert.equal(mediaGenerationErrorCategory('RATE_LIMITED', 'submitting', 'amr_account'), 'rate_limit');

  assert.equal(extractUpstreamErrorCode(new ProviderError('limit', 503, 'upstream_rate_limited')), 'upstream_rate_limited');
  assert.equal(mediaGenerationError(new ProviderError('limit', 503, 'upstream_rate_limited')), 'RATE_LIMITED');

  // upstream_provider_forbidden (HTTP 403) must map to PROVIDER_UNAVAILABLE, NEVER AUTH_REJECTED
  const upForbidden = new ProviderError('Provider HTTP 403: credentials or permissions rejected', 403, 'upstream_provider_forbidden');
  assert.equal(extractUpstreamErrorCode(upForbidden), 'upstream_provider_forbidden');
  assert.equal(mediaGenerationError(upForbidden), 'PROVIDER_UNAVAILABLE');
  assert.equal(mediaGenerationErrorCategory('PROVIDER_UNAVAILABLE', 'submitting', 'amr_account'), 'provider_unavailable');

  assert.equal(extractUpstreamErrorCode(new ProviderError('failed', 200, 'upstream_request_failed')), 'upstream_request_failed');
  assert.equal(mediaGenerationError(new ProviderError('failed', 200, 'upstream_request_failed')), 'REMOTE_FAILED');
  assert.equal(extractUpstreamErrorCode(new ProviderError('unknown', 500, 'audio_outcome_unknown')), 'audio_outcome_unknown');

  // 2) Content policy / safety blocks map to CONTENT_BLOCKED / content_policy across HTTP 400, 403, and remote_task
  assert.equal(mediaGenerationError(new ProviderError('Bad request', 400, 'content_policy_violation'), 'submitting'), 'CONTENT_BLOCKED');
  assert.equal(mediaGenerationError(withErrorMeta(new Error('Task failed'), { upstreamCode: 'safety_blocked' }), 'remote_task'), 'CONTENT_BLOCKED');
  assert.equal(mediaGenerationError(new Error('Your request was blocked by the safety policy.'), 'generating'), 'CONTENT_BLOCKED');
  assert.equal(mediaGenerationErrorCategory('CONTENT_BLOCKED', 'remote_task', 'amr_account'), 'content_policy');

  // 3) AccountRequestError preserves wrapped subprocess timeout / connector unavailable / network causes & extracts uppercase/hyphenated plain-text codes
  const cliTimeout = new AccountRequestError('', { cause: Object.assign(new Error('Command failed'), { killed: true, signal: 'SIGTERM' }) });
  assert.equal(mediaGenerationError(cliTimeout, 'submitting'), 'TIMEOUT');
  assert.equal(mediaGenerationErrorCategory('TIMEOUT', 'submitting', 'amr_account'), 'timeout');

  const cliMissing = new AccountRequestError('', { cause: new ConnectorUnavailable('install_failed', 'npm missing') });
  assert.equal(mediaGenerationError(cliMissing, 'submitting'), 'PROVIDER_UNAVAILABLE');

  const pollTimeoutWrapped = new Error('OpenDesign accepted this task, but its result could not be read. Check the original task before retrying.', {
    cause: Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }),
  });
  assert.equal(mediaGenerationError(pollTimeoutWrapped, 'polling'), 'TIMEOUT');

  const pollNetWrapped = new Error('OpenDesign accepted this task, but its result could not be read. Check the original task before retrying.', {
    cause: Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNRESET' } }),
  });
  assert.equal(mediaGenerationError(pollNetWrapped, 'polling'), 'NETWORK_ERROR');

  const hyphenErr = new AccountRequestError('API request failed with status 429: provider_concurrency_exceeded');
  assert.equal(hyphenErr.status, 429);
  assert.equal(hyphenErr.upstreamCode, 'provider_concurrency_exceeded');
  const upperMediaErr = new AccountRequestError('media request failed (UPSTREAM_RATE_LIMITED, HTTP 429)');
  assert.equal(upperMediaErr.upstreamCode, 'UPSTREAM_RATE_LIMITED');
  assert.equal(extractUpstreamErrorCode(upperMediaErr), 'upstream_rate_limited');

  // 4) Codex empty output and missing CLI
  assert.equal(mediaGenerationError(new Error('Codex returned no generated image. Check image generation access in the local Codex client.'), 'generating'), 'EMPTY_OUTPUT');
  assert.equal(mediaGenerationError(new Error('Codex CLI is no longer installed'), 'generating'), 'PROVIDER_UNAVAILABLE');

  // 5) End-to-end ModelGateway: BYOK fal/atlas/wavespeed/compatible + OpenDesign Cloud 403 upstream_provider_forbidden + Codex empty output
  const gateway = new ModelGateway(store, {
    tracking,
    detect: async () => [{ id: 'codex', label: 'Codex', installed: true, authenticated: true, imageGeneration: true, available: true, reason: 'ok' }],
    codex: async () => { throw new Error('Codex returned no generated image. Check image generation access in the local Codex client.'); },
    pollMs: 5,
    fetcher: async (url, init = {}) => {
      const target = String(url);
      if (target.includes('queue.fal.run') && init.method === 'POST') {
        return Response.json({ request_id: 'fal-safe-1', status_url: 'https://queue.fal.run/s-safe', response_url: 'https://queue.fal.run/r-safe' });
      }
      if (target.endsWith('/s-safe')) {
        return Response.json({ status: 'COMPLETED', error: { code: 'safety_blocked', message: 'NSFW detected' } });
      }
      if (target.includes('api.atlascloud.ai/api/v1/model/generateImage')) {
        return Response.json({ code: 200, data: { id: 'atlas-1039', status: 'created' } });
      }
      if (target.includes('api.atlascloud.ai/api/v1/model/prediction/atlas-1039')) {
        return Response.json({ code: 200, data: { id: 'atlas-1039', status: 'failed', error_code: 1039, error: 'Content moderation failed' } });
      }
      if (target.includes('api.wavespeed.ai/api/v3/') && init.method === 'POST') {
        const body = typeof init.body === 'string' ? JSON.parse(init.body) as { prompt?: string } : {};
        const code = body.prompt?.includes('1407') ? 1407 : 1402;
        return Response.json({ code: 200, data: { id: `ws-${code}`, status: 'created' } });
      }
      if (target.includes('api.wavespeed.ai/api/v3/predictions/ws-')) {
        const code = Number(target.match(/ws-(\d+)/)?.[1] ?? 0);
        return Response.json({ code: 200, data: { id: `ws-${code}`, status: 'failed', error_code: code, error: 'Task failed' } });
      }
      if (target.includes('speech-compat.example.com/v1/audio/speech')) {
        return new Response(JSON.stringify({ error: { code: 'content_policy_violation' } }), { status: 400, headers: { 'Content-Type': 'application/json' } });
      }
      if (target.endsWith('/api/v1/media/models?include_audio=true')) {
        return Response.json({ models: [{ model: 'gpt-image-2', kind: 'image', capabilities: { edits: true } }] });
      }
      if (target.endsWith('/images/generations')) {
        return new Response(JSON.stringify({ error: { code: 'upstream_provider_forbidden' } }), { status: 403, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('not found', { status: 404 });
    },
  });

  await gateway.configureProvider('fal', { apiKey: 'fal-secret-key' });
  await gateway.configureProvider('atlascloud', { apiKey: 'atlas-secret-key' });
  await gateway.configureProvider('wavespeed', { apiKey: 'ws-secret-key' });
  await gateway.configureProvider('opendesign', { apiKey: 'od-secret-key', baseUrl: 'https://amr-api.open-design.ai' });
  await gateway.listModels({ provider: 'opendesign', refresh: true });
  const compatId = await gateway.connections.configure(null, {
    label: 'Speech Compat',
    baseUrl: 'https://speech-compat.example.com/v1',
    apiKey: 'compat-secret-key',
    protocol: 'openai',
    enabled: true,
  });
  await gateway.connections.saveModel(compatId, { modelId: 'private-tts-v1', label: 'TTS', kind: 'audio', enabled: true });

  const falSafeJob = await gateway.submit({ modality: 'image', prompt: 'Fal safety', model: 'fal:fal-ai/flux/schnell', library: { title: 'Fal safety' } }, codexHost, { entrySurface: 'studio' });
  const atlasSafeJob = await gateway.submit({ modality: 'image', prompt: 'Atlas 1039', model: 'atlascloud:google/nano-banana-2/text-to-image', library: { title: 'Atlas 1039' } }, codexHost, { entrySurface: 'studio' });
  const wsCreditJob = await gateway.submit({ modality: 'image', prompt: 'WS 1407', model: 'wavespeed:wavespeed-ai/z-image/turbo', library: { title: 'WS 1407' } }, codexHost, { entrySurface: 'studio' });
  const wsOtherJob = await gateway.submit({ modality: 'image', prompt: 'WS 1402', model: 'wavespeed:wavespeed-ai/z-image/turbo', library: { title: 'WS 1402' } }, codexHost, { entrySurface: 'studio' });
  const compatSpeechJob = await gateway.submit({ modality: 'audio', prompt: 'Blocked speech', model: `${compatId}:private-tts-v1`, parameters: { voice: 'alloy' }, library: { title: 'Compat speech' } }, codexHost, { entrySurface: 'studio' });
  const odForbiddenJob = await gateway.submit({ modality: 'image', prompt: 'OD upstream 403', model: 'opendesign:gpt-image-2', library: { title: 'OD 403' } }, codexHost, { entrySurface: 'mcp_media_use' });
  const codexEmptyJob = await gateway.submit({ modality: 'image', prompt: 'Codex empty', model: 'codex:image-generation', library: { title: 'Codex empty' } }, codexHost, { entrySurface: 'studio' });

  for (let i = 0; i < 10; i++) {
    await gateway.tick();
    if (!gateway.active.size) break;
    await Promise.all([...gateway.active.values()].map(task => task.done));
  }
  while (tracking.pending() > 0) await tracking.flush();

  const falRes = events.find(e => e.event === 'media_generation_result' && e.properties.job_id === falSafeJob.id);
  assert.equal(falRes?.properties.failure_phase, 'remote_task');
  assert.equal(falRes?.properties.upstream_error_code, 'safety_blocked');
  assert.equal(falRes?.properties.error_code, 'CONTENT_BLOCKED');
  assert.equal(falRes?.properties.error_category, 'content_policy');

  const atlasRes = events.find(e => e.event === 'media_generation_result' && e.properties.job_id === atlasSafeJob.id);
  assert.equal(atlasRes?.properties.failure_phase, 'remote_task');
  assert.equal(atlasRes?.properties.upstream_error_code, 'content_policy_violation');
  assert.equal(atlasRes?.properties.error_code, 'CONTENT_BLOCKED');
  assert.equal(atlasRes?.properties.error_category, 'content_policy');

  const wsCreditRes = events.find(e => e.event === 'media_generation_result' && e.properties.job_id === wsCreditJob.id);
  assert.equal(wsCreditRes?.properties.failure_phase, 'remote_task');
  assert.equal(wsCreditRes?.properties.upstream_error_code, 'insufficient_balance');
  assert.equal(wsCreditRes?.properties.error_code, 'BALANCE_LOW');
  assert.equal(wsCreditRes?.properties.error_category, 'byok_billing');

  const wsOtherRes = events.find(e => e.event === 'media_generation_result' && e.properties.job_id === wsOtherJob.id);
  assert.equal(wsOtherRes?.properties.failure_phase, 'remote_task');
  assert.equal(wsOtherRes?.properties.upstream_error_code, 'other');
  assert.equal(wsOtherRes?.properties.error_code, 'REMOTE_FAILED');

  const compatRes = events.find(e => e.event === 'media_generation_result' && e.properties.job_id === compatSpeechJob.id);
  assert.equal(compatRes?.properties.failure_phase, 'submitting');
  assert.equal(compatRes?.properties.http_status, 400);
  assert.equal(compatRes?.properties.error_code, 'CONTENT_BLOCKED');
  assert.equal(compatRes?.properties.error_category, 'content_policy');
  assert.equal(compatRes?.properties.upstream_error_code, undefined, 'custom provider must omit upstream_error_code');

  const odRes = events.find(e => e.event === 'media_generation_result' && e.properties.job_id === odForbiddenJob.id);
  assert.equal(odRes?.properties.failure_phase, 'submitting');
  assert.equal(odRes?.properties.http_status, 403);
  assert.equal(odRes?.properties.upstream_error_code, 'upstream_provider_forbidden');
  assert.equal(odRes?.properties.error_code, 'PROVIDER_UNAVAILABLE');
  assert.equal(odRes?.properties.error_category, 'provider_unavailable');
  // Upstream 403 must NOT falsely mark the OpenDesign key as rejected
  assert.notEqual((await gateway.status()).providers.find(p => p.id === 'opendesign')?.verification, 'rejected');

  const codexRes = events.find(e => e.event === 'media_generation_result' && e.properties.job_id === codexEmptyJob.id);
  assert.equal(codexRes?.properties.failure_phase, 'generating');
  assert.equal(codexRes?.properties.error_code, 'EMPTY_OUTPUT');
  assert.equal(codexRes?.properties.error_category, 'upstream_error');

  // 6) AMR timeout, capacity/server_busy, execution/persistence codes, safety-text fallback, and 3D string error code shape
  for (const timeoutCode of ['provider_deadline_exceeded', 'media_link_timeout', 'media_operation_timeout', 'upstream_timeout'] as const) {
    const err = new ProviderError('Remote task failed', 504, timeoutCode);
    assert.equal(extractUpstreamErrorCode(err), timeoutCode);
    assert.equal(mediaGenerationError(err, 'remote_task'), 'TIMEOUT');
    assert.equal(mediaGenerationErrorCategory('TIMEOUT', 'remote_task', 'amr_account'), 'timeout');
  }
  for (const busyCode of ['server_busy', 'upstream_capacity_unavailable'] as const) {
    const err = new ProviderError('Service busy', 503, busyCode);
    assert.equal(extractUpstreamErrorCode(err), busyCode);
    assert.equal(mediaGenerationError(err, 'submitting'), 'RATE_LIMITED');
    assert.equal(mediaGenerationErrorCategory('RATE_LIMITED', 'submitting', 'amr_account'), 'rate_limit');
  }
  for (const unavailableCode of ['audio_upstream_unavailable', 'audio_metering_unavailable'] as const) {
    assert.equal(extractUpstreamErrorCode(new ProviderError('Service unavailable', 503, unavailableCode)), unavailableCode);
    assert.equal(mediaGenerationError(new ProviderError('Service unavailable', 503, unavailableCode), 'submitting'), 'PROVIDER_UNAVAILABLE');
  }
  for (const retainedCode of ['execution_interrupted', 'media_persistence_failed', 'image_task_expired', 'video_content_expired', 'video_task_not_found', 'content_expired', 'expired', 'upstream_error'] as const) {
    assert.equal(extractUpstreamErrorCode(new ProviderError('failed', 502, retainedCode)), retainedCode);
  }
  for (const expiredCode of ['expired', 'image_task_expired', 'video_content_expired', 'video_task_not_found', 'content_expired'] as const) {
    assert.equal(mediaGenerationError(new ProviderError('expired', undefined, expiredCode), 'remote_task'), 'TIMEOUT');
  }
  assert.equal(resolveRemoteTaskUpstreamCode('failed', { code: 'provider_error', message: 'Prompt rejected by safety policy' }), 'content_policy_violation');
  assert.equal(resolveRemoteTaskUpstreamCode('expired', undefined, 'expired'), 'expired');
  assert.equal(resolveRemoteTaskUpstreamCode('expired', undefined, 'video_content_expired'), 'video_content_expired');
  // Safety text beats generic HTTP 400 and legacy HTTP 502 provider_error rejection wording,
  // but NEVER a 400 validation message mentioning "safety policy" or a 502/503 safety-service outage
  assert.equal(mediaGenerationError(new ProviderError('Content policy rejected the prompt.', 400), 'submitting'), 'CONTENT_BLOCKED');
  assert.equal(mediaGenerationError(new ProviderError('Blocked by safety system: this content is unavailable', 400), 'submitting'), 'CONTENT_BLOCKED');
  assert.equal(mediaGenerationError(new ProviderError('Content is unavailable because it was blocked by the safety system', 400), 'submitting'), 'CONTENT_BLOCKED');
  assert.equal(mediaGenerationError(new ProviderError('Missing required safety policy configuration', 400), 'submitting'), 'INVALID_REQUEST');
  assert.equal(mediaGenerationError(new ProviderError('Invalid parameter: expected a content policy violation enum value', 400), 'submitting'), 'INVALID_REQUEST');
  assert.equal(mediaGenerationError(new ProviderError('The request was rejected by the safety system.', 502, 'provider_error'), 'remote_task'), 'CONTENT_BLOCKED');
  assert.equal(mediaGenerationError(new ProviderError('The safety system returned a bad gateway response.', 502, 'provider_error'), 'submitting'), 'UPSTREAM_5XX');
  assert.equal(mediaGenerationError(new ProviderError('Content safety system unavailable', 503), 'submitting'), 'UPSTREAM_5XX');
  // Explicit invalid_request still stays INVALID_REQUEST
  assert.equal(mediaGenerationError(new ProviderError('Invalid parameter', 400, 'invalid_request'), 'submitting'), 'INVALID_REQUEST');

  // 7) End-to-end OpenDesign Cloud poll & download fixtures:
  //    (a) terminal `expired` with `error.code: 'timeout'` -> TIMEOUT
  //    (b) terminal `expired` without `error.code` -> upstream_error_code='expired' -> TIMEOUT
  //    (c) legacy pre-#1297 failed image poll (`provider_error` + explicit safety message) -> CONTENT_BLOCKED without leaking provider text
  //    (d) video `/content` 410 `video_content_expired` -> remote_terminal=true, is_resumable=false (never DOWNLOAD_FAILED/resumable)
  const cloudFixturesGateway = new ModelGateway(store, {
    tracking,
    pollMs: 5,
    fetcher: async (url, init = {}) => {
      const target = String(url);
      if (target.endsWith('/api/v1/media/models?include_audio=true')) {
        return Response.json({
          models: [
            { model: 'seedance-2.0', kind: 'video', capabilities: {} },
            { model: 'seedream-5.5', kind: 'image', capabilities: {} },
          ],
        });
      }
      if (target.endsWith('/videos/tasks') && init.method === 'POST') {
        const body = JSON.parse(String(init.body ?? '{}')) as { prompt?: string };
        const id = body.prompt === 'Expire bare' ? 'vid-exp-bare' : body.prompt === 'Content 410' ? 'vid-410' : body.prompt === 'Content 404 structured' ? 'vid-404-struct' : 'vid-exp-1';
        return Response.json({ task_id: id, status: 'queued' }, { status: 202 });
      }
      if (target.endsWith('/images/generations') && init.method === 'POST') {
        return Response.json({ task_id: 'img-legacy-policy', status: 'queued' }, { status: 202 });
      }
      if (target.endsWith('/videos/tasks/vid-exp-1')) {
        return Response.json({ task_id: 'vid-exp-1', status: 'expired', error: { code: 'timeout', message: 'The request timed out. Please retry.' } });
      }
      if (target.endsWith('/videos/tasks/vid-exp-bare')) {
        return Response.json({ task_id: 'vid-exp-bare', status: 'expired' });
      }
      if (target.endsWith('/videos/tasks/vid-410')) {
        return Response.json({ task_id: 'vid-410', status: 'succeeded' });
      }
      if (target.endsWith('/videos/tasks/vid-410/content')) {
        return Response.json({ error: 'video_content_expired' }, { status: 410 });
      }
      if (target.endsWith('/videos/tasks/vid-404-struct')) {
        return Response.json({ task_id: 'vid-404-struct', status: 'succeeded' });
      }
      if (target.endsWith('/videos/tasks/vid-404-struct/content')) {
        return Response.json({ error: 'not_found', code: 'video_task_not_found' }, { status: 404 });
      }
      if (target.endsWith('/images/tasks/img-legacy-policy')) {
        return Response.json({
          task_id: 'img-legacy-policy',
          status: 'failed',
          error: { code: 'provider_error', message: 'Prompt rejected by safety policy on supplier XYZ' },
        });
      }
      return new Response('not found', { status: 404 });
    },
  });
  await cloudFixturesGateway.configureProvider('opendesign', { apiKey: 'od-secret-key', baseUrl: 'https://amr-api.open-design.ai' });
  await cloudFixturesGateway.listModels({ provider: 'opendesign', refresh: true });
  const expiredVidJob = await cloudFixturesGateway.submit({ modality: 'video', prompt: 'Expire me', model: 'opendesign:seedance-2.0', library: { title: 'Expired vid' } }, codexHost, { entrySurface: 'studio' });
  const bareExpiredVidJob = await cloudFixturesGateway.submit({ modality: 'video', prompt: 'Expire bare', model: 'opendesign:seedance-2.0', library: { title: 'Bare expired vid' } }, codexHost, { entrySurface: 'studio' });
  const content410VidJob = await cloudFixturesGateway.submit({ modality: 'video', prompt: 'Content 410', model: 'opendesign:seedance-2.0', library: { title: 'Content 410 vid' } }, codexHost, { entrySurface: 'studio' });
  const content404StructVidJob = await cloudFixturesGateway.submit({ modality: 'video', prompt: 'Content 404 structured', model: 'opendesign:seedance-2.0', library: { title: 'Content 404 struct vid' } }, codexHost, { entrySurface: 'studio' });
  const legacyPolicyImgJob = await cloudFixturesGateway.submit({ modality: 'image', prompt: 'Legacy policy', model: 'opendesign:seedream-5.5', library: { title: 'Legacy policy img' } }, codexHost, { entrySurface: 'studio' });
  for (let i = 0; i < 12; i++) {
    await cloudFixturesGateway.tick();
    if (!cloudFixturesGateway.active.size) break;
    await Promise.all([...cloudFixturesGateway.active.values()].map(task => task.done));
  }
  while (tracking.pending() > 0) await tracking.flush();
  const expiredRes = events.find(e => e.event === 'media_generation_result' && e.properties.job_id === expiredVidJob.id);
  assert.equal(expiredRes?.properties.failure_phase, 'remote_task');
  assert.equal(expiredRes?.properties.remote_task_id, 'vid-exp-1');
  assert.equal(expiredRes?.properties.upstream_error_code, 'timeout');
  assert.equal(expiredRes?.properties.error_code, 'TIMEOUT');
  assert.equal(expiredRes?.properties.error_category, 'timeout');

  const bareExpiredRes = events.find(e => e.event === 'media_generation_result' && e.properties.job_id === bareExpiredVidJob.id);
  assert.equal(bareExpiredRes?.properties.failure_phase, 'remote_task');
  assert.equal(bareExpiredRes?.properties.remote_task_id, 'vid-exp-bare');
  assert.equal(bareExpiredRes?.properties.upstream_error_code, 'expired');
  assert.equal(bareExpiredRes?.properties.error_code, 'TIMEOUT');
  assert.equal(bareExpiredRes?.properties.error_category, 'timeout');

  const content410Res = events.find(e => e.event === 'media_generation_result' && e.properties.job_id === content410VidJob.id);
  assert.equal(content410Res?.properties.remote_terminal, true);
  assert.equal(content410Res?.properties.is_resumable, false);
  assert.equal(content410Res?.properties.failure_phase, 'remote_task');
  assert.equal(content410Res?.properties.remote_task_id, 'vid-410');
  assert.equal(content410Res?.properties.upstream_error_code, 'video_content_expired');
  assert.equal(content410Res?.properties.error_code, 'TIMEOUT');
  assert.equal(content410Res?.properties.error_category, 'timeout');

  const content404StructRes = events.find(e => e.event === 'media_generation_result' && e.properties.job_id === content404StructVidJob.id);
  assert.equal(content404StructRes?.properties.remote_terminal, true);
  assert.equal(content404StructRes?.properties.is_resumable, false);
  assert.equal(content404StructRes?.properties.failure_phase, 'remote_task');
  assert.equal(content404StructRes?.properties.remote_task_id, 'vid-404-struct');
  assert.equal(content404StructRes?.properties.upstream_error_code, 'video_task_not_found');
  assert.equal(content404StructRes?.properties.error_code, 'TIMEOUT');
  assert.equal(content404StructRes?.properties.error_category, 'timeout');

  const legacyPolicyRes = events.find(e => e.event === 'media_generation_result' && e.properties.job_id === legacyPolicyImgJob.id);
  assert.equal(legacyPolicyRes?.properties.failure_phase, 'remote_task');
  assert.equal(legacyPolicyRes?.properties.remote_task_id, 'img-legacy-policy');
  assert.equal(legacyPolicyRes?.properties.upstream_error_code, 'content_policy_violation');
  assert.equal(legacyPolicyRes?.properties.error_code, 'CONTENT_BLOCKED');
  assert.equal(legacyPolicyRes?.properties.error_category, 'content_policy');
  const savedLegacyJob = await cloudFixturesGateway.getJob(legacyPolicyImgJob.id);
  assert.equal(savedLegacyJob?.error?.includes('supplier XYZ'), false);

  // BYOK / custom channels never emit remote_task_id even when a remote ID exists
  const byokRes = events.find(e => e.event === 'media_generation_result' && e.properties.route_channel === 'byok_builtin');
  assert.ok(byokRes, 'expected a byok_builtin result event in fixture');
  assert.equal(byokRes?.properties.remote_task_id, undefined);
  await cloudFixturesGateway.close();

  // Private OpenDesign Cloud origin must NEVER emit remote_task_id; step transitions clear previous step's remoteId
  const privateCloudGateway = new ModelGateway(store, {
    tracking,
    pollMs: 5,
    fetcher: async (url, init = {}) => {
      const target = String(url);
      if (target.endsWith('/api/v1/media/models?include_audio=true')) {
        return Response.json({ models: [{ model: 'seedream-5.5', kind: 'image', capabilities: {} }] });
      }
      if (target.endsWith('/images/generations') && init.method === 'POST') {
        return Response.json({ task_id: 'private-task-secret-1', status: 'queued' }, { status: 202 });
      }
      if (target.endsWith('/images/tasks/private-task-secret-1')) {
        return Response.json({ task_id: 'private-task-secret-1', status: 'failed', error: { code: 'provider_error' } });
      }
      return new Response('not found', { status: 404 });
    },
  });
  await privateCloudGateway.configureProvider('opendesign', { apiKey: 'od-private-key', baseUrl: 'https://private-amr.example.com' });
  await privateCloudGateway.listModels({ provider: 'opendesign', refresh: true });
  const privateImgJob = await privateCloudGateway.submit({ modality: 'image', prompt: 'Private origin', model: 'opendesign:seedream-5.5', library: { title: 'Private img' } }, codexHost, { entrySurface: 'studio' });
  for (let i = 0; i < 6; i++) {
    await privateCloudGateway.tick();
    if (!privateCloudGateway.active.size) break;
    await Promise.all([...privateCloudGateway.active.values()].map(task => task.done));
  }
  while (tracking.pending() > 0) await tracking.flush();
  const privateImgRes = events.find(e => e.event === 'media_generation_result' && e.properties.job_id === privateImgJob.id);
  assert.equal(privateImgRes?.properties.has_remote_id, true);
  assert.equal(privateImgRes?.properties.remote_task_id, undefined);
  await privateCloudGateway.close();

  const { createStageTimingTracker, recordMediaGenerationResult } = await import('../gateway/media-telemetry.ts');
  const stageTracker = createStageTimingTracker('precheck');
  stageTracker.markStage('polling', { pipelineStep: 'base', remoteId: 'tripo-base-1' });
  assert.equal(stageTracker.remoteId, 'tripo-base-1');
  stageTracker.markStage('submitting', { pipelineStep: 'rig' });
  assert.equal(stageTracker.hasRemoteId, true);
  assert.equal(stageTracker.remoteId, undefined);

  // amr_account retains remote_task_id for official AMR origin (even when signed out / CONFIG_CHANGED)
  // while whitespace-padded or non-official origins are safely omitted
  const acctJobId = randomUUID();
  const paddedJobId = randomUUID();
  recordMediaGenerationResult(tracking, {
    modality: 'video',
    executorKind: 'gateway',
    providerKind: 'account',
    routeChannel: 'amr_account',
    modelProvider: 'account',
    modelId: 'seedance-2.5-flash',
    entrySurface: 'studio',
    destination: 'library',
    referenceCount: 0,
    isEdit: false,
    jobId: acctJobId,
    attemptKind: 'initial',
    jobState: 'failed',
    assetCount: 0,
    durationMs: 1200,
    endToEndMs: 1200,
    hasRemoteId: true,
    remoteTaskId: 'mvt_account_signed_out_1',
    providerOrigin: 'https://amr-api.open-design.ai',
    failurePhase: 'polling',
    cause: new Error('Account changed after submit'),
  }, codexHost);
  recordMediaGenerationResult(tracking, {
    modality: 'image',
    executorKind: 'gateway',
    providerKind: 'account',
    routeChannel: 'amr_account',
    modelProvider: 'account',
    modelId: 'seedream-5.5',
    entrySurface: 'studio',
    destination: 'library',
    referenceCount: 0,
    isEdit: false,
    jobId: paddedJobId,
    attemptKind: 'initial',
    jobState: 'failed',
    assetCount: 0,
    durationMs: 500,
    endToEndMs: 500,
    hasRemoteId: true,
    remoteTaskId: ' mit_padded_1 ',
    providerOrigin: 'https://amr-api.open-design.ai',
    failurePhase: 'remote_task',
    cause: new ProviderError('failed', 502, 'provider_error'),
  }, codexHost);
  while (tracking.pending() > 0) await tracking.flush();
  const acctRes = events.find(e => e.event === 'media_generation_result' && e.properties.job_id === acctJobId);
  assert.equal(acctRes?.properties.remote_task_id, 'mvt_account_signed_out_1');
  assert.equal(acctRes?.properties.error_code, 'CONFIG_CHANGED');
  const paddedRes = events.find(e => e.event === 'media_generation_result' && e.properties.job_id === paddedJobId);
  assert.equal(paddedRes?.properties.remote_task_id, undefined);

  await gateway.close();
  tracking.close();
}, false));
