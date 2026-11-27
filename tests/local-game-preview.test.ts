import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { startLocalGamePreview } from '../gateway/local-game-preview.ts';
import { isLocalGamePreviewUrl } from '../shared/local-game-preview.ts';
import { gameProjectsFor } from '../game-projects.ts';
import { handler } from '../server.ts';
import { WorkspaceStore } from '../workspace.ts';
import { transport } from './http.ts';

test('local game previews expose only the game mapped to the isolated origin', async t => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'isolated-game-preview-'));
  const preview = await startLocalGamePreview(workspace);
  t.after(async () => { preview.close(); await rm(workspace, { recursive: true, force: true }); });
  const url = new URL(preview.url('tidebreaker'));
  assert.equal(isLocalGamePreviewUrl(url.href), true);
  assert.notEqual(new URL(preview.url('stack-the-moon')).origin, url.origin);
  const read = (target: string, method = 'GET', host = url.host) => new Promise<{ status?: number; csp?: string }>((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port: url.port, path: target, method, headers: { Host: host } }, res => {
      res.resume();
      res.on('end', () => resolve({ status: res.statusCode, csp: res.headers['content-security-policy'] }));
    });
    req.on('error', reject).end();
  });
  const entry = await read(url.pathname);
  assert.equal(entry.status, 200);
  assert.match(entry.csp ?? '', /sandbox [^;]*\ballow-same-origin\b/);
  assert.equal((await read(url.pathname.replace(/index\.html$/, 'assets/archipelago.webp'))).status, 200);
  for (const prohibited of ['/mcp', '/api/assets', '/api/games/tidebreaker', '/api/games/stack-the-moon/play/index.html']) {
    assert.equal((await read(prohibited)).status, 404, prohibited);
  }
  assert.equal((await read(url.pathname, 'POST')).status, 404);
  assert.equal((await read(url.pathname, 'GET', `localhost:${url.port}`)).status, 404);
  for (const id of ['school-tycoon-3d', 'arrow-pop-clear', 'shaman-block-pop']) {
    const withdrawn = new URL(preview.url(id, '?gameStartup=1'));
    assert.equal((await read(withdrawn.pathname + withdrawn.search, 'GET', withdrawn.host)).status, 404);
  }
});

test('the game routes advertise isolated previews through the local Studio proxy and redirect only top-level play', async t => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'isolated-game-routes-'));
  const preview = await startLocalGamePreview(workspace);
  t.after(async () => { preview.close(); await rm(workspace, { recursive: true, force: true }); });
  const store = new WorkspaceStore(workspace);
  const context = { localGamePreview: preview.url };
  const send = transport(store, context, (req, res, store, context) => {
    // The local Vite server forwards its own Host to the backend.
    req.headers.host = '127.0.0.1:5173';
    return handler(req, res, store, context);
  });
  const gamePath = '/motion-api/games/tidebreaker';
  const catalog = await (await send('/motion-api/games')).json();
  assert(catalog.games.some((game: { id: string }) => game.id === 'tidebreaker'));
  for (const id of ['school-tycoon-3d', 'arrow-pop-clear', 'shaman-block-pop']) {
    const routes = ['/preview-url', '/play/index.html?gameStartup=1', '/files'];
    assert(!catalog.games.some((game: { id: string }) => game.id === id));
    assert(!catalog.issues?.some((issue: { id: string }) => issue.id === id));
    for (const route of routes) assert.equal((await send(`/motion-api/games/${id}${route}`)).status, 404);
  }
  const capability = await send(gamePath + '/preview-url');
  assert.equal(capability.status, 200);
  assert.deepEqual(await capability.json(), { url: preview.url('tidebreaker') });

  const search = '?rev=abc%2Bdef&mode=demo';
  const entry = gamePath + '/play/index.html' + search;
  const documentHeaders = { 'sec-fetch-dest': 'document' };
  const redirected = await send(entry, { headers: documentHeaders });
  assert.equal(redirected.status, 302);
  assert.equal(redirected.headers.get('location'), preview.url('tidebreaker', search));
  const iframe = await send(entry, { headers: { 'sec-fetch-dest': 'iframe' } });
  assert.equal(iframe.status, 200);
  assert.doesNotMatch(iframe.headers.get('content-security-policy')!, /\ballow-same-origin\b/);

  const projects = gameProjectsFor(workspace);
  const { game } = await projects.create({
    prompt: 'Private game', genre: 'casual', style: 'pixel', setting: null, multiplayer: false,
  });
  const ownedPath = `/api/games/${game.id}`;
  const ownedPreview = await send(ownedPath + '/preview-url');
  assert.equal(ownedPreview.status, 200);
  assert.deepEqual(await ownedPreview.json(), { url: null });
  assert.equal((await send(ownedPath + '/play/index.html', { headers: documentHeaders })).status, 200);

  const template = await projects.get('tidebreaker');
  const getTemplate = t.mock.method(projects, 'get', async () => ({ ...template, multiplayer: true }));
  assert.deepEqual(await (await send(gamePath + '/preview-url')).json(), { url: null });
  getTemplate.mock.mockImplementation(async () => ({
    ...template,
    external: { url: 'https://example.test/game', author: 'Test', postUrl: 'https://example.test/post', model: 'Test', embeddable: true },
  }));
  assert.deepEqual(await (await send(gamePath + '/preview-url')).json(), { url: null });
});
