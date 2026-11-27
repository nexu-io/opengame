import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chmod, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { designProjectsFor } from '../design-projects.ts';
import { GameProjects } from '../game-projects.ts';
import { OpenDesignAccount } from '../gateway/account.ts';
import { resetBalanceLowRecords } from '../gateway/media-use.ts';
import { gatewayFor } from '../gateway/service.ts';
import { pluginRoot } from '../hyperframes.ts';
import { rpc } from '../mcp.ts';
import {
  buildPlacementId,
  cleanBillingUrl,
  decodeMonetizationShortlink,
  encodeMonetizationShortlink,
  PRODUCT_ID,
} from '../shared/product-identity.ts';
import { saveTrackingPreference } from '../shared/tracking.ts';
import { createTracker, deviceContext, type PendingEvent, validProperties } from '../tracking/core.ts';
import { omEvents } from '../tracking/events.ts';
import { previewTrackingContext } from '../tracking/host.ts';
import { createPosthogSender, posthogCommonProperties } from '../tracking/node.ts';
import { fixture } from './fixtures.ts';
import { transport } from './http.ts';

const accountFixtureBinary = path.resolve(import.meta.dirname, 'fixtures/account-cli.mjs');

function coreTracker(send: (batch: PendingEvent[]) => Promise<'accepted'>) {
  return createTracker({ registry: omEvents, entrypoint: 'mcp', enabled: true, flushIntervalMs: 0, send });
}

async function withTelemetryEnvUnlocked<T>(fn: () => Promise<T>): Promise<T> {
  const prevTelemetry = process.env.OPENMOTION_TELEMETRY;
  const prevDnt = process.env.DO_NOT_TRACK;
  delete process.env.OPENMOTION_TELEMETRY;
  delete process.env.DO_NOT_TRACK;
  try {
    return await fn();
  } finally {
    if (prevTelemetry === undefined) delete process.env.OPENMOTION_TELEMETRY;
    else process.env.OPENMOTION_TELEMETRY = prevTelemetry;
    if (prevDnt === undefined) delete process.env.DO_NOT_TRACK;
    else process.env.DO_NOT_TRACK = prevDnt;
  }
}

test('buildPlacementId sanitizes segments, collapses underscores, enforces length caps, and applies defaults', () => {
  assert.equal(buildPlacementId(), 'unknown__unknown__unknown__all');
  assert.equal(buildPlacementId('', null, undefined, ''), 'unknown__unknown__unknown__all');
  assert.equal(
    buildPlacementId('MCP_HTTP', 'Claude Code!!', '  Design--Studio  ', 'VIDEO'),
    'mcp_http__claude_code__design--studio__video',
  );
  assert.equal(buildPlacementId('a___b', '---cursor---', 'game///v2', 'Audio'), 'a_b__cursor__game_v2__audio');
  const longSeg = 'a'.repeat(50);
  const capped = buildPlacementId(longSeg, longSeg, longSeg, longSeg);
  assert.ok(capped.length <= 128);
  const parts = capped.split('__');
  assert.equal(parts.length, 4);
  for (const part of parts) assert.ok(part.length <= 31, part);
});

test('9-segment monetization shortlink codec matches RFC 4648 Base64URL byte-for-byte with zero query string', () => {
  const entryId = '7d1c6f4e-6a1f-4c55-9a43-0c7a4a0a8f11';
  const expectedUuidB64Url = Buffer.from(entryId.replace(/-/g, ''), 'hex').toString('base64url');
  assert.equal(expectedUuidB64Url.length, 22);

  for (const [target, expectedDest] of [
    ['d', 'https://open-design.ai/cloud/dashboard?billing=plan'],
    ['r', 'https://open-design.ai/cloud/dashboard?billing=recharge'],
    ['p', 'https://open-design.ai/pricing/'],
  ] as const) {
    assert.equal(cleanBillingUrl(target), expectedDest);
    const url = encodeMonetizationShortlink({
      target,
      entryId,
      product: 'opengame',
      channel: 'mcp_http',
      host: 'claude_code',
      touchpoint: 'agent_media_balance_low',
      studioId: 'motion',
      modality: 'video',
    });
    const parsed = new URL(url);
    assert.equal(parsed.origin, 'https://open-design.ai');
    assert.equal(parsed.search, '');
    assert.equal(parsed.hash, '');
    assert.ok(parsed.pathname.startsWith('/t/'));

    const token = parsed.pathname.slice(3);
    const expectedPlaintext = `v1|${target}|${expectedUuidB64Url}|opengame|mcp_http|claude_code|agent_media_balance_low|motion|video`;
    assert.equal(token, Buffer.from(expectedPlaintext, 'utf8').toString('base64url'));
    assert.equal(token.includes('='), false);
    assert.equal(token.includes('+'), false);
    assert.equal(token.includes('/'), false);

    assert.deepEqual(decodeMonetizationShortlink(url), {
      version: 'v1',
      target,
      entryId,
      product: 'opengame',
      channel: 'mcp_http',
      host: 'claude_code',
      touchpoint: 'agent_media_balance_low',
      studioId: 'motion',
      modality: 'video',
      placementId: 'mcp_http__claude_code__motion__video',
      destinationUrl: expectedDest,
    });
    assert.deepEqual(decodeMonetizationShortlink(token), decodeMonetizationShortlink(url));
  }

  // Reject malformed URLs, query strings, wrong version, wrong segment counts, bad target/product/UUID.
  assert.equal(decodeMonetizationShortlink(''), null);
  assert.equal(decodeMonetizationShortlink('https://evil.example/t/abc'), null);
  assert.equal(decodeMonetizationShortlink(`${encodeMonetizationShortlink({ target: 'd', entryId })}?utm_source=x`), null);
  assert.equal(decodeMonetizationShortlink(Buffer.from(`v2|d|${expectedUuidB64Url}|opengame|mcp_stdio|codex|t|motion|all`).toString('base64url')), null);
  assert.equal(decodeMonetizationShortlink(Buffer.from(`v1|x|${expectedUuidB64Url}|opengame|mcp_stdio|codex|t|motion|all`).toString('base64url')), null);
  assert.equal(decodeMonetizationShortlink(Buffer.from(`v1|d|${expectedUuidB64Url}|unknownprod|mcp_stdio|codex|t|motion|all`).toString('base64url')), null);
  assert.equal(decodeMonetizationShortlink(Buffer.from('v1|d|short|opengame|mcp_stdio|codex|t|motion|all').toString('base64url')), null);
  assert.equal(decodeMonetizationShortlink(Buffer.from('v1|d|only|four').toString('base64url')), null);
});

test('posthogCommonProperties stamps resolved product and source_product, and preserves event channel', async () => {
  const installationId = randomUUID();
  const baseInput = {
    endpoint: { env: 'test' as const },
    identity: { installation_id: installationId, created_at: new Date().toISOString() },
    device: deviceContext(),
    appVersion: '1.0.0',
    source: 'direct',
    eventId: randomUUID(),
    occurredAt: new Date().toISOString(),
    entrypoint: 'mcp' as const,
    deviceTimezone: 'UTC',
    utcOffsetMinutes: 0,
  };
  const common = posthogCommonProperties(baseInput);
  assert.equal(common.product, PRODUCT_ID);
  assert.equal(common.source_product, PRODUCT_ID);
  assert.ok(common.product === 'openmotion' || common.product === 'opengame');
  assert.equal(common.channel, 'standalone');

  const priorProductEnv = process.env.OPENMOTION_PRODUCT;
  try {
    for (const override of ['openmotion', 'opengame'] as const) {
      process.env.OPENMOTION_PRODUCT = override;
      const overridden = posthogCommonProperties(baseInput);
      assert.equal(overridden.product, override);
      assert.equal(overridden.source_product, override);
    }
  } finally {
    if (priorProductEnv === undefined) delete process.env.OPENMOTION_PRODUCT;
    else process.env.OPENMOTION_PRODUCT = priorProductEnv;
  }

  const batches: any[] = [];
  const tracking = createTracker({
    registry: omEvents,
    entrypoint: 'mcp',
    enabled: true,
    flushIntervalMs: 0,
    send: createPosthogSender({
      identity: { installation_id: installationId, created_at: new Date().toISOString() },
      appVersion: '1.0.0',
      env: 'test',
      host: 'https://collector.example',
      token: 'phc_test',
      fetch: async (_url, init) => {
        batches.push(JSON.parse(String(init?.body)));
        return Response.json({ status: 1 });
      },
    }),
  });
  try {
    tracking.track('upgrade_link_result', {
      entry_from: 'agent_media_balance_low',
      outcome: 'success',
      entry_id: randomUUID(),
      channel: 'mcp_http',
      studio_id: 'motion',
      modality: 'video',
    });
    tracking.track('provider_setup_opened', {
      entry_from: 'agent_game_publish_signed_out',
      presentation: 'foreground',
      embedded: true,
      studio_id: 'game',
    });
    assert.equal(await tracking.flush(), 'accepted');
    assert.equal(batches.length, 1);
    const [upgradeEvent, setupEvent] = batches[0].batch;
    assert.equal(upgradeEvent.event, 'upgrade_link_result');
    assert.equal(upgradeEvent.properties.product, PRODUCT_ID);
    assert.equal(upgradeEvent.properties.source_product, PRODUCT_ID);
    assert.equal(upgradeEvent.properties.channel, 'mcp_http');
    assert.equal(upgradeEvent.properties.studio_id, 'motion');
    assert.equal(upgradeEvent.properties.modality, 'video');

    assert.equal(setupEvent.event, 'provider_setup_opened');
    assert.equal(setupEvent.properties.product, PRODUCT_ID);
    assert.equal(setupEvent.properties.source_product, PRODUCT_ID);
    assert.equal(setupEvent.properties.channel, 'standalone');
    assert.equal(setupEvent.properties.studio_id, 'game');
  } finally {
    tracking.close();
  }
});

test('HTTP MCP BALANCE_LOW status deduplicates per job.id while direct WebMCP calls do not consume the slot', t => withTelemetryEnvUnlocked(() => fixture(async store => {
  resetBalanceLowRecords();
  const events: PendingEvent[] = [];
  const tracking = coreTracker(async batch => { events.push(...batch); return 'accepted'; });
  store.tracking = tracking;
  const gateway = gatewayFor(store, tracking);
  const projectId = store.projectCatalog().activeId;
  const failedJob = {
    id: 'job-http-mcp-balance-1',
    state: 'failed' as const,
    phase: 'submitting' as const,
    projectId,
    modality: 'image' as const,
    prompt: 'hero icon',
    model: { id: 'account:flux', provider: 'account', modelId: 'flux', label: 'Flux', modality: 'image' as const, source: 'live' as const },
    errorCode: 'BALANCE_LOW',
    error: 'Your OpenDesign balance is too low for this request. Top up, then try again.',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  t.mock.method(gateway, 'getJob', async () => failedJob);
  const http = transport(store, { tracking, runtimeRoot: pluginRoot });
  const upgradeEvents = () => events.filter(event => event.event === 'upgrade_link_result');
  try {
    // 1. Direct /motion-api/phase1/call (WebMCP): strips _upgradeLinkResult, emits 0 events, does NOT consume MCP dedup.
    const webRes = await http('/motion-api/phase1/call', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'openmotion_media_use', arguments: { action: 'status', projectId, jobId: failedJob.id } }),
    });
    assert.equal(webRes.status, 200);
    const webJson: any = await webRes.json();
    assert.ok(webJson.topup);
    assert.equal(Object.hasOwn(webJson, '_upgradeLinkResult'), false);
    await tracking.flush();
    assert.equal(upgradeEvents().length, 0);

    // 2. First Streamable HTTP /mcp poll records upgrade_link_result once with channel='mcp_http'.
    const poll = (id: string) => http('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id,
        method: 'tools/call',
        params: { name: 'openmotion_media_use', arguments: { action: 'status', projectId, jobId: failedJob.id } },
      }),
    });
    const firstRes = await poll('poll-1');
    assert.equal(firstRes.status, 200);
    const firstJson: any = await firstRes.json();
    const firstStructured = firstJson.result.structuredContent;
    assert.ok(firstStructured.topup);
    assert.equal(Object.hasOwn(firstStructured, '_upgradeLinkResult'), false);
    assert.deepEqual(firstStructured.settingsHandoff, {
      tool: 'openmotion_open_preview',
      arguments: { target: 'providers', entry: 'agent_media_balance_low' },
    });
    await tracking.flush();
    assert.equal(upgradeEvents().length, 1);
    assert.deepEqual(upgradeEvents()[0].properties, {
      entry_from: 'agent_media_balance_low',
      entry_id: firstStructured.topup.entryId,
      outcome: 'success',
      channel: 'mcp_http',
      studio_id: 'motion',
      modality: 'image',
    });

    // 3. Repeated /mcp polls return the same topup link and emit 0 additional upgrade_link_result events.
    const secondRes = await poll('poll-2');
    const secondStructured = (await secondRes.json() as any).result.structuredContent;
    assert.deepEqual(secondStructured.topup, firstStructured.topup);
    await tracking.flush();
    assert.equal(upgradeEvents().length, 1);

    // 4. Opt-out stops /t/ shortlink generation on subsequent status polls.
    await saveTrackingPreference(store.directory, false);
    const thirdRes = await poll('poll-3');
    const thirdStructured = (await thirdRes.json() as any).result.structuredContent;
    assert.equal(thirdStructured.topup.url, cleanBillingUrl('r'));
  } finally {
    await gateway.close();
    tracking.close();
  }
})));

test('previewTrackingContext preserves /settings/providers tracking_context and Settings login emits full account_sign_in_result with host_agent', t => fixture(async store => {
  await chmod(accountFixtureBinary, 0o755);
  const origin = 'http://localhost:4173';
  const sampleToken = randomUUID();
  const tagged = previewTrackingContext(
    { previewUrl: `${origin}/settings/providers?provider=account&entry_from=agent_game_publish_signed_out` },
    origin,
    sampleToken,
  );
  const taggedUrl = new URL(tagged.previewUrl);
  assert.equal(taggedUrl.pathname, '/settings/providers');
  assert.equal(taggedUrl.searchParams.get('provider'), 'account');
  assert.equal(taggedUrl.searchParams.get('entry_from'), 'agent_game_publish_signed_out');
  assert.equal(taggedUrl.searchParams.get('tracking_context'), sampleToken);

  const events: PendingEvent[] = [];
  const tracking = coreTracker(async batch => { events.push(...batch); return 'accepted'; });
  store.tracking = tracking;
  const gateway = gatewayFor(store, tracking);
  gateway.account = new OpenDesignAccount(store.directory, { binary: accountFixtureBinary });
  const http = transport(store, { tracking, runtimeRoot: pluginRoot });
  const callPhase1 = async (payload: unknown) => {
    const response = await http('/motion-api/phase1/call', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    assert.equal(response.status, 200);
    return response.json();
  };

  try {
    await rpc({ jsonrpc: '2.0', id: 'init', method: 'initialize', params: { clientInfo: { name: 'codex-mcp-client', version: '1.2.3' } } }, store);
    const openedGame: any = await rpc({
      jsonrpc: '2.0',
      id: 'open-game-providers',
      method: 'tools/call',
      params: { name: 'openmotion_open_preview', arguments: { target: 'providers', entry: 'agent_game_publish_signed_out' } },
    }, store, undefined, undefined, undefined, { callPhase1 });
    const previewUrl = new URL(openedGame.result.structuredContent.previewUrl);
    assert.equal(previewUrl.pathname, '/settings/providers');
    assert.equal(previewUrl.searchParams.get('provider'), 'account');
    assert.equal(previewUrl.searchParams.get('entry_from'), 'agent_game_publish_signed_out');
    const contextToken = previewUrl.searchParams.get('tracking_context');
    assert.ok(contextToken, 'MCP-opened /settings/providers must carry tracking_context');

    await rpc({
      jsonrpc: '2.0',
      id: 'open-design-providers',
      method: 'tools/call',
      params: { name: 'openmotion_open_preview', arguments: { target: 'providers', entry: 'agent_design_deploy_signed_out' } },
    }, store, undefined, undefined, undefined, { callPhase1 });
    await tracking.flush();
    const setupOpened = events.filter(event => event.event === 'provider_setup_opened');
    assert.equal(setupOpened.length, 2);
    assert.deepEqual(setupOpened[0].properties, {
      entry_from: 'agent_game_publish_signed_out',
      presentation: 'foreground',
      embedded: true,
      studio_id: 'game',
    });
    assert.equal(setupOpened[0].host_context?.host_agent, 'codex');
    assert.deepEqual(setupOpened[1].properties, {
      entry_from: 'agent_design_deploy_signed_out',
      presentation: 'foreground',
      embedded: true,
      studio_id: 'design',
    });

    // POST /motion-api/settings/account/login with X-Tracking-Context header emits account_sign_in_result with codex host + full 4D attribution.
    const entryId = randomUUID();
    const loginRes = await http('/motion-api/settings/account/login', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-tracking-context': contextToken,
      },
      body: JSON.stringify({
        hookId: 'studio_generate',
        entryId,
        studioId: 'game',
        modality: 'video',
        entryFrom: 'agent_game_publish_signed_out',
      }),
    });
    assert.equal(loginRes.status, 200);
    await mkdir(gateway.account.home, { recursive: true });
    await writeFile(path.join(gateway.account.home, 'authorize'), 'yes');
    for (let i = 0; i < 40; i++) {
      const summary = await gateway.account.summary();
      if (summary.state === 'signed-in') break;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    assert.equal((await gateway.account.summary()).state, 'signed-in');
    await tracking.flush();
    const signInEvent = events.find(event => event.event === 'account_sign_in_result');
    assert.ok(signInEvent, 'account_sign_in_result must be emitted');
    assert.equal(signInEvent.host_context?.host_agent, 'codex');
    assert.equal(signInEvent.properties.source_product, PRODUCT_ID);
    assert.equal(signInEvent.properties.hook_id, 'studio_generate');
    assert.equal(signInEvent.properties.entry_id, entryId);
    assert.equal(signInEvent.properties.entry_from, 'agent_game_publish_signed_out');
    assert.equal(signInEvent.properties.studio_id, 'game');
    assert.equal(signInEvent.properties.modality, 'video');
    assert.equal(validProperties(omEvents, 'account_sign_in_result', signInEvent.properties), true);
  } finally {
    await rm(path.join(gateway.account.home, 'authorize'), { force: true }).catch(() => {});
    await gateway.close();
    tracking.close();
  }
}));

test('signed-out MCP game web_publish and design deploy preserve OPENDESIGN_SIGN_IN_REQUIRED and settingsHandoff while HTTP keeps 401 AUTH_REQUIRED', t => fixture(async store => {
  const events: PendingEvent[] = [];
  const tracking = coreTracker(async batch => { events.push(...batch); return 'accepted'; });
  store.tracking = tracking;
  const gateway = gatewayFor(store, tracking);
  t.mock.method(gateway.account, 'summary', async () => ({ state: 'signed-out', billingUnavailable: false }));
  const games = new GameProjects(store.directory);
  const createdGame = (await games.create({ prompt: 'Signed Out Arcade', multiplayer: false, genre: 'shooter' })).game;
  const designs = designProjectsFor(store.directory);
  const createdDesign = await designs.create({ scenario: 'prototype', title: 'Signed Out Prototype', requestId: randomUUID() });
  const http = transport(store, { tracking, runtimeRoot: pluginRoot });
  const callPhase1 = async (payload: unknown) => {
    const response = await http('/motion-api/phase1/call', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await response.json();
    if (!response.ok) {
      throw Object.assign(new Error(body.error || 'Tool failed'), {
        code: body.code,
        settingsHandoff: body.settingsHandoff,
        applied: body.applied,
      });
    }
    return body;
  };

  try {
    // 1. Signed-out MCP game web_publish -> OPENDESIGN_SIGN_IN_REQUIRED + agent_game_publish_signed_out
    const gameRes: any = await rpc({
      jsonrpc: '2.0',
      id: 'game-publish-signed-out',
      method: 'tools/call',
      params: {
        name: 'openmotion_assets_use',
        arguments: {
          action: 'web_publish',
          webPublish: { command: 'publish', targetKind: 'game', targetId: createdGame.id },
        },
      },
    }, store, undefined, undefined, undefined, { callPhase1 });
    assert.equal(gameRes.result.isError, true);
    assert.equal(gameRes.result.structuredContent.error.code, 'OPENDESIGN_SIGN_IN_REQUIRED');
    assert.match(gameRes.result.structuredContent.error.message, /^OPENDESIGN_SIGN_IN_REQUIRED:/);
    assert.deepEqual(gameRes.result.structuredContent.error.settingsHandoff, {
      tool: 'openmotion_open_preview',
      arguments: { target: 'providers', entry: 'agent_game_publish_signed_out' },
    });

    // 2. Signed-out MCP design deploy -> OPENDESIGN_SIGN_IN_REQUIRED + agent_design_deploy_signed_out
    const designRes: any = await rpc({
      jsonrpc: '2.0',
      id: 'design-deploy-signed-out',
      method: 'tools/call',
      params: {
        name: 'openmotion_design_project',
        arguments: {
          action: 'deploy',
          projectId: createdDesign.id,
        },
      },
    }, store, undefined, undefined, undefined, { callPhase1 });
    assert.equal(designRes.result.isError, true);
    assert.equal(designRes.result.structuredContent.error.code, 'OPENDESIGN_SIGN_IN_REQUIRED');
    assert.match(designRes.result.structuredContent.error.message, /^OPENDESIGN_SIGN_IN_REQUIRED:/);
    assert.deepEqual(designRes.result.structuredContent.error.settingsHandoff, {
      tool: 'openmotion_open_preview',
      arguments: { target: 'providers', entry: 'agent_design_deploy_signed_out' },
    });

    await tracking.flush();
    const finished = events.filter(event => event.event === 'mcp_tool_finished');
    assert.equal(finished.length, 2);
    assert.equal(finished[0].properties.error_code, 'OPENDESIGN_SIGN_IN_REQUIRED');
    assert.equal(finished[1].properties.error_code, 'OPENDESIGN_SIGN_IN_REQUIRED');

    // 3. Studio HTTP endpoints still return HTTP 401 AUTH_REQUIRED for UI compatibility.
    const httpGameRes = await http(`/motion-api/web-publish/game/${encodeURIComponent(createdGame.id)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(httpGameRes.status, 401);
    assert.equal((await httpGameRes.json() as any).error.code, 'AUTH_REQUIRED');

    const httpDesignRes = await http(`/motion-api/design/projects/${encodeURIComponent(createdDesign.id)}/deploy`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(httpDesignRes.status, 401);
    assert.equal((await httpDesignRes.json() as any).error.code, 'AUTH_REQUIRED');
  } finally {
    await gateway.close();
    tracking.close();
  }
}));
