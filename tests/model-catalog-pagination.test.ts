import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { searchModels } from '../gateway/model-catalog.ts';
import { mcpHttpFor } from '../gateway/mcp-http.ts';
import { handler } from '../server.ts';
import { pluginRoot } from '../hyperframes.ts';
import { fixture } from './fixtures.ts';

function model(slug: string, provider = 'polyhaven') {
  const oga = provider === 'opengameart';
  return { id: `${provider}:${slug}`, provider, title: slug, type: 'model', price: { free: true },
    url: oga ? `https://opengameart.org/content/${slug}` : `https://polyhaven.com/a/${slug}`,
    thumbnailUrl: oga ? 'https://opengameart.org/example.png' : 'https://cdn.polyhaven.com/example.png' };
}

test('HTTP and MCP share replayable cursors covering clipped provider windows and buffered cards', t => fixture(async store => {
  const local = globalThis.fetch;
  const gateway = mcpHttpFor(store);
  const server = createServer((req, res) => { void handler(req, res, store, { runtimeRoot: pluginRoot }); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as {port: number}).port}`;
  const calls: string[] = [];
  let fail = false;
  t.mock.method(globalThis, 'fetch', async (input: string) => {
    const url = new URL(input);
    const providers = url.searchParams.get('providers')!.split(',');
    const offset = Number(url.searchParams.get('offset'));
    const limit = Number(url.searchParams.get('limit'));
    calls.push(`${providers.length}:${offset}`);
    if (fail) throw new Error('Offline');
    const sources = ['polyhaven', 'opengameart'].filter(p => providers.includes(p));
    const rows = sources.map(p => Array.from({ length: p === 'polyhaven' ? 35 : 5 }, (_, i) => model(`item-${i}`, p)).slice(offset, offset + limit));
    return Response.json({ results: rows.flat().slice(0, limit), providers: sources.map((p, i) => ({ provider: p, status: 'ok', count: rows[i].length, total: p === 'polyhaven' ? 35 : 5 })) });
  });
  try {
    const path = `${origin}/motion-api/model-catalog/search?q=clipped`;
    const first = await (await local(path)).json();
    assert.equal(first.models.length, 24);
    assert.ok(first.nextCursor);
    fail = true;
    await assert.rejects(searchModels('clipped', '3d', first.nextCursor), /unavailable/);
    fail = false;
    const { token } = await gateway.tokenStore.create('read', 'read', `${origin}/mcp`);
    const mcp = await (await local(`${origin}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'openmotion_asset_manage', arguments: { action: 'search_models', query: 'clipped', dimension: '3d', cursor: first.nextCursor } } }) })).json();
    const second = mcp.result.structuredContent;
    assert.equal(second.models.length, 16);
    assert.equal(second.nextCursor, null);
    assert.equal(new Set([...first.models, ...second.models].map(x => x.id)).size, 40);
    assert.deepEqual(await (await local(`${path}&cursor=${first.nextCursor}`)).json(), second);
    assert.deepEqual(calls, ['8:0', '1:24', '1:0', '1:24', '1:0']);
    await assert.rejects(searchModels('clipped', '2d', first.nextCursor), /cursor/);
    await assert.rejects(searchModels('other', '3d', first.nextCursor), /cursor/);
  } finally { await gateway.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
}, false));

test('mixed home keeps interleaved overflow, repeated providers and empty windows terminate', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (input: string) => {
    calls++;
    const url = new URL(input);
    const q = url.searchParams.get('q');
    const repeats = q === 'repeats';
    const empty = q === 'empty';
    const results = empty ? [] : Array.from({ length: repeats ? 24 : 8 }, (_, i) => model(`${q}-${i}`));
    return Response.json({ results, providers: [{ provider: 'polyhaven', count: results.length, status: 'ok', ...(empty ? { total: 0 } : repeats ? {} : { total: 8 }) }] });
  });
  const first = await searchModels('');
  const second = await searchModels('', '3d', first.nextCursor);
  assert.equal(calls, 4);
  assert.deepEqual(first.models.slice(0, 4).map(x => x.title), ['plant-0', 'building-0', 'character-0', 'vehicle-0']);
  assert.deepEqual(second.models.slice(0, 4).map(x => x.title), ['plant-6', 'building-6', 'character-6', 'vehicle-6']);
  assert.equal(second.models.length, 8);
  assert.equal(second.nextCursor, null);
  const repeated = await searchModels('repeats');
  assert.deepEqual(await searchModels('repeats', '3d', repeated.nextCursor), { models: [], nextCursor: null });
  assert.deepEqual(await searchModels('empty'), { models: [], nextCursor: null });
});

test('mixed 2D searches deduplicate UI and sprite IDs across topics and buffered pages', async t => {
  const queried: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: string) => {
    const url = new URL(input), type = url.searchParams.get('type')!;
    queried.push(type);
    const results = Array.from({ length: 20 }, (_, i) => {
      const slug = i === 0 ? 'same-pack' : `${type}-${i}`;
      return { provider: 'kenney', id: `kenney:${slug}`, title: slug, price: { free: true }, type,
        url: `https://kenney.nl/assets/${slug}`, thumbnailUrl: 'https://kenney.nl/preview.png' };
    });
    return Response.json({ results, providers: [{ provider: 'kenney', status: 'ok', count: 20, total: 20 }, {provider: 'opengameart', status: 'skipped', count: 0}] });
  });
  const first = await searchModels('spring', '2d');
  const second = await searchModels('spring', '2d', first.nextCursor);
  assert.deepEqual(queried.sort(), ['sprite', 'ui']);
  assert.equal(first.models.length, 24);
  assert.equal(second.models.length, 15);
  assert.equal(second.nextCursor, null);
  assert.equal(new Set([...first.models, ...second.models].map(x => x.id)).size, 39);
});
