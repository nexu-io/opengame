import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { createServer } from 'node:http';
import { handler, startServer } from '../server.ts';
import { pluginRoot } from '../hyperframes.ts';
import { mcpHttpFor } from '../gateway/mcp-http.ts';
import { gameProjectsFor } from '../game-projects.ts';
import { MCP_HTTP_PATH, MCP_STATUS_API, MCP_TOKENS_API } from '../shared/mcp-http.ts';
import { fixture } from './fixtures.ts';
import { superAgentConversations } from '../gateway/super-agent.ts';
import { CLIENT_CAPABILITIES_META_KEY, CLIENT_INFO_META_KEY, PROTOCOL_VERSION_META_KEY } from '@modelcontextprotocol/server';

test('present_asset enforces MCP write scope and reuses the HTTP deliverable with Studio offline', () => fixture(async store => {
  const context = { runtimeRoot: pluginRoot };
  const server = createServer((req, res) => { void handler(req, res, store, context); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const gateway = mcpHttpFor(store);
  try {
    const chats = superAgentConversations(store);
    const chat = await chats.create();
    const workspace = path.join(store.directory, 'super-agent', 'work', chat.id);
    await mkdir(workspace, { recursive: true });
    await writeFile(path.join(workspace, 'hero.obj'), 'v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n');
    const presentation = { name: 'openmotion_asset_manage', arguments: { action: 'present_asset', conversationId: chat.id, path: 'hero.obj' } };
    const presentWithScope = async (scope: 'read' | 'write', extra: Record<string, unknown> = {}) => {
      const { token } = await gateway.tokenStore.create(scope, scope, `${origin}/mcp`);
      return (await fetch(`${origin}/mcp`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ jsonrpc: '2.0', id: 41, method: 'tools/call', params: { ...presentation, arguments: { ...presentation.arguments, ...extra } } }),
      })).json();
    };
    assert.equal((await presentWithScope('read')).error.code, -32003);
    assert.equal((await chats.get(chat.id)).messages.length, 0);
    const invalid = (await presentWithScope('write', { animation: 'Idle' })).result;
    assert.equal(invalid.isError, true);
    assert.deepEqual(invalid.structuredContent.error.availableAnimations, []);
    const presented = (await presentWithScope('write')).result.structuredContent;
    assert.equal(presented.conversationId, chat.id);
    const replay = await fetch(`${origin}/motion-api/phase1/call`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(presentation),
    });
    assert.equal(replay.status, 200);
    assert.equal((await replay.json()).artifact.id, presented.artifact.id);
    assert.equal((await chats.get(chat.id)).messages.length, 1);
  } finally {
    await gateway.close();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}, false));

test('Streamable HTTP /mcp supports initialize, tools/list, tools/call, scoped tokens, SSE GET, and DELETE termination', () =>
  fixture(async store => {
    const running = await startServer(store, 0, { editor: false });
    const port = (running.server.address() as { port: number }).port;
    const origin = `http://127.0.0.1:${port}`;
    const mcpUrl = `${origin}${MCP_HTTP_PATH}`;

    try {
      // Issue read-only and read-write scoped tokens
      const readRes = await fetch(`${origin}${MCP_TOKENS_API}`, {
        method: 'POST',
        headers: { Origin: origin, 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: 'ReadOnly CI', scope: 'read' }),
      });
      assert.equal(readRes.status, 201);
      const readTokenBundle = (await readRes.json()) as any;
      assert.match(readTokenBundle.token, /^om_mcp_/);
      assert.equal(readTokenBundle.summary.scope, 'read');

      const writeRes = await fetch(`${origin}${MCP_TOKENS_API}`, {
        method: 'POST',
        headers: { Origin: origin, 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: 'Cloud Agent', scope: 'write' }),
      });
      assert.equal(writeRes.status, 201);
      const writeTokenBundle = (await writeRes.json()) as any;
      assert.ok(writeTokenBundle.configs.streamableHttpJson.includes('/mcp'));

      // Raw tokens are never stored plaintext on disk
      const storedRaw = await readFile(path.join(store.directory, 'agents/mcp-tokens.json'), 'utf8');
      assert.equal(storedRaw.includes(readTokenBundle.token), false);
      assert.equal(storedRaw.includes(writeTokenBundle.token), false);

      // Initialize Streamable HTTP MCP session
      const initRes = await fetch(mcpUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          Authorization: `Bearer ${readTokenBundle.token}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-11-25',
            capabilities: {},
            clientInfo: { name: 'http-test', version: '1.0.0' },
          },
        }),
      });
      assert.equal(initRes.status, 200);
      const sessionId = initRes.headers.get('mcp-session-id');
      assert.ok(sessionId);
      const initPayload = (await initRes.json()) as any;
      assert.equal(initPayload.result.serverInfo.name, 'openmotion');

      // List tools on session
      const listRes = await fetch(mcpUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Mcp-Session-Id': sessionId,
          Authorization: `Bearer ${readTokenBundle.token}`,
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
      });
      assert.equal(listRes.status, 200);
      const listPayload = (await listRes.json()) as any;
      assert.ok(listPayload.result.tools.some((tool: any) => tool.name === 'openmotion_assets_use'));

      // Read-only token allows read tool and rejects write tool with -32003
      const readCallRes = await fetch(mcpUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Mcp-Session-Id': sessionId,
          Authorization: `Bearer ${readTokenBundle.token}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/call',
          params: { name: 'openmotion_get_project', arguments: {} },
        }),
      });
      assert.equal(readCallRes.status, 200);
      const readCallPayload = (await readCallRes.json()) as any;
      assert.ok(readCallPayload.result.structuredContent);

      const forbiddenWriteRes = await fetch(mcpUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Mcp-Session-Id': sessionId,
          Authorization: `Bearer ${readTokenBundle.token}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 4,
          method: 'tools/call',
          params: {
            name: 'openmotion_create_project',
            arguments: {
              requestId: 'req-mcp-http-forbidden-1',
              projectType: 'natural_language',
              title: 'Blocked Write',
              requirements: 'Blocked write test.',
              namingLanguage: 'en',
            },
          },
        }),
      });
      assert.equal(forbiddenWriteRes.status, 200);
      const forbiddenPayload = (await forbiddenWriteRes.json()) as any;
      assert.equal(forbiddenPayload.error.code, -32003);

      // Write token succeeds for project creation
      const allowedWriteRes = await fetch(mcpUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Mcp-Session-Id': sessionId,
          Authorization: `Bearer ${writeTokenBundle.token}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 5,
          method: 'tools/call',
          params: {
            name: 'openmotion_create_project',
            arguments: {
              requestId: 'req-mcp-http-create-1',
              projectType: 'natural_language',
              title: 'MCP HTTP Project',
              requirements: 'Short kinetic logo reveal.',
              namingLanguage: 'en',
            },
          },
        }),
      });
      assert.equal(allowedWriteRes.status, 200);
      const allowedPayload = (await allowedWriteRes.json()) as any;
      assert.equal(allowedPayload.result.isError ?? false, false);

      // SSE GET stream emits ready event with session ID
      const abort = new AbortController();
      const sseRes = await fetch(mcpUrl, {
        method: 'GET',
        headers: {
          Accept: 'text/event-stream',
          'Mcp-Session-Id': sessionId,
          Authorization: `Bearer ${writeTokenBundle.token}`,
        },
        signal: abort.signal,
      });
      assert.equal(sseRes.status, 200);
      assert.match(String(sseRes.headers.get('content-type')), /text\/event-stream/);
      const reader = sseRes.body!.getReader();
      const firstChunk = new TextDecoder().decode((await reader.read()).value);
      assert.match(firstChunk, /event: ready/);
      abort.abort();

      // Status endpoint reports active session & tokens
      const statusRes = await fetch(`${origin}${MCP_STATUS_API}`);
      assert.equal(statusRes.status, 200);
      const status = (await statusRes.json()) as any;
      assert.equal(status.activeSessions, 1);

      // Untrusted Origin is rejected with 403
      const badOriginRes = await fetch(mcpUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://evil.example.invalid',
          Authorization: `Bearer ${writeTokenBundle.token}`,
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 6, method: 'ping' }),
      });
      assert.equal(badOriginRes.status, 403);

      // DELETE terminates session cleanly
      const delRes = await fetch(mcpUrl, {
        method: 'DELETE',
        headers: { 'Mcp-Session-Id': sessionId, Authorization: `Bearer ${writeTokenBundle.token}` },
      });
      assert.equal(delRes.status, 204);

      const postDeleteRes = await fetch(mcpUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Mcp-Session-Id': sessionId,
          Authorization: `Bearer ${writeTokenBundle.token}`,
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'tools/list' }),
      });
      assert.equal(postDeleteRes.status, 404);

      // Auth-required cloud enforcement blocks anonymous requests and revoked tokens
      process.env.MOTION_MCP_REQUIRE_AUTH = '1';
      try {
        const unauthRes = await fetch(mcpUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 8, method: 'tools/list' }),
        });
        assert.equal(unauthRes.status, 401);

        const revokeRes = await fetch(`${origin}${MCP_TOKENS_API}/${readTokenBundle.summary.id}`, {
          method: 'DELETE',
          headers: { Origin: origin },
        });
        assert.equal(revokeRes.status, 200);

        const revokedCall = await fetch(mcpUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${readTokenBundle.token}`,
          },
          body: JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'tools/list' }),
        });
        assert.equal(revokedCall.status, 401);
      } finally {
        delete process.env.MOTION_MCP_REQUIRE_AUTH;
      }
    } finally {
      await running.close();
    }
  }));


test('strict MCP 2026-07-28 HTTP clients discover, read and call without a session', () => fixture(async store => {
  const running = await startServer(store, 0, { editor: false });
  const origin = `http://127.0.0.1:${(running.server.address() as { port: number }).port}`;
  const url = origin + MCP_HTTP_PATH;
  const version = '2026-07-28';
  const capabilities = { extensions: { 'io.modelcontextprotocol/ui': { mimeTypes: ['text/html;profile=mcp-app'] } } };
  const tokenResponse = await fetch(origin + MCP_TOKENS_API, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ label: 'Modern read scope', scope: 'read' }),
  });
  assert.equal(tokenResponse.status, 201);
  const { token } = await tokenResponse.json();

  let id = 0;
  function request(method: string, params: Record<string, unknown> = {}, clientCapabilities = {}) {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${token}`,
      'Mcp-Protocol-Version': version,
      'Mcp-Method': method,
    };
    if (typeof params.name === 'string') headers['Mcp-Name'] = params.name;
    if (typeof params.uri === 'string') headers['Mcp-Name'] = params.uri;
    return fetch(url, {
      method: 'POST', headers,
      body: JSON.stringify({
        jsonrpc: '2.0', id: ++id, method,
        params: { ...params, _meta: {
          [PROTOCOL_VERSION_META_KEY]: version,
          [CLIENT_INFO_META_KEY]: { name: 'OpenGame integration test', version: '1.0.0' },
          [CLIENT_CAPABILITIES_META_KEY]: clientCapabilities,
        } },
      }),
    });
  }

  try {
    const discovery = await request('server/discover');
    assert.equal(discovery.status, 200);
    assert.equal(discovery.headers.get('mcp-session-id'), null);
    assert.ok((await discovery.json()).result.supportedVersions.includes(version));
    const listed = (await (await request('tools/list', {}, capabilities)).json()).result.tools;
    assert.ok(listed.some((tool: { name: string }) => tool.name === 'openmotion_show_template_recommendations'));
    const plain = (await (await request('tools/list')).json()).result.tools;
    assert.ok(plain.some((tool: { name: string }) => tool.name === 'openmotion_game_get'));
    assert.ok(!plain.some((tool: { name: string }) => tool.name === 'openmotion_show_template_recommendations'));
    const workflow = await request('resources/read', { uri: 'openmotion://workflow/game/start' });
    assert.ok((await workflow.json()).result.contents[0].text.includes('openmotion_game'));
    const { game } = await gameProjectsFor(store.directory).create({
      prompt: 'Preview link integration game', multiplayer: false, genre: 'casual', style: 'minimal', setting: 'modern',
    });
    const response = await request('tools/call', { name: 'openmotion_game_get', arguments: { id: game.id } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('mcp-session-id'), null);
    const { result } = await response.json();
    assert.equal(result.resultType, 'complete');
    assert.notEqual(result.isError, true, JSON.stringify(result.structuredContent));
    assert.equal(result.structuredContent.playUrl, `${origin}/api/games/${game.id}/play/index.html`);
    assert.equal((await fetch(result.structuredContent.playUrl)).status, 200);
    const denied = await request('tools/call', { name: 'openmotion_game_create', arguments: { prompt: 'Read scope must deny this' } });
    assert.equal((await denied.json()).error.code, -32003);
  } finally {
    await running.close();
  }
}));
