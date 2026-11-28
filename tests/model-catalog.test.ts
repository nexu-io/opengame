import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { handler } from '../server.ts';
import { mcpHttpFor } from '../gateway/mcp-http.ts';
import { catalogDimension, searchModels } from '../gateway/model-catalog.ts';
import { superAgentConversations } from '../gateway/super-agent.ts';
import { pluginRoot } from '../hyperframes.ts';
import { fixture } from './fixtures.ts';
import { assetManageTool } from '../shared/capability-tools.ts';
import { validateInput } from '../shared/phase1-tools.ts';

test('catalog and presentation actions accept request context while keeping sources exclusive', () => {
  const conversationId = '00000000-0000-4000-8000-000000000001';
  const context = { conversationId, requestId: 'preview-request' };
  const validate = (input: Record<string, unknown>) => validateInput(assetManageTool.inputSchema, input);
  for (const action of [
    { action: 'present_asset', path: 'art/hero.glb' },
    { action: 'present_asset', assetId: conversationId, versionId: conversationId },
    { action: 'browse_models' }, { action: 'search_models', query: 'hero' },
    { action: 'acquire_model', id: 'polyhaven:chair' },
  ]) validate({ ...context, ...action });
  assert.throws(() => validate({ ...context, action: 'present_asset', path: 'hero.glb', assetId: conversationId }));
  assert.throws(() => validate({ ...context, action: 'browse_models', undocumented: true }));
});

test('model catalog shares scoped search, browsing and verified workspace downloads across HTTP and MCP', t => fixture(async store => {
  const server = createServer((req, res) => { void handler(req, res, store, { runtimeRoot: pluginRoot }); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const chats = superAgentConversations(store);
  const gateway = mcpHttpFor(store);
  const local = globalThis.fetch;
  const id = 'polyhaven:Chair';
  const cdn = 'https://dl.polyhaven.org/file/ph-assets/Models/gltf/1k/Chair/';
  const source = { id, provider: 'polyhaven', title: 'Chair', type: 'model', formats: ['gltf'], price: { free: true }, downloadable: true,
    thumbnailUrl: 'https://cdn.polyhaven.com/asset_img/thumbs/Chair.png', url: 'https://polyhaven.com/a/Chair', license: { name: 'CC0' } };
  let bufferUri = 'Chair.bin';
  let fileUrl = cdn + bufferUri;
  let companionPath = bufferUri;
  let binary = Buffer.alloc(16);
  let size = 16;
  let wrapGlb = false;
  let fetchedBinaries = 0;
  const searchQueries: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: string, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.origin === origin) return local(input, init);
    assert.equal(init?.redirect, 'error');
    if (url.pathname === '/v1/search') {
      const query = url.searchParams.get('q')!;
      searchQueries.push(query);
      assert.equal(url.searchParams.get('type'), 'model');
      if (query === 'vehicle') throw new Error('Provider offline');
      if (query !== 'wooden chair') return Response.json({ results: [
        { ...source, id: `polyhaven:${query}`, title: query, url: `https://polyhaven.com/a/${query}` }, source,
      ] });
      return Response.json({ results: [
        { ...source, provider: 'grab3d', id: 'grab3d:chair', thumbnailUrl: 'https://grab3d.com/m/chair.png', url: 'https://grab3d.com/models/furniture/chair/' },
        { ...source, thumbnailUrl: 'https://unlisted.example/image.png' }, source,
      ] });
    }
    const json = Buffer.from(JSON.stringify({ asset: { version: '2.0' }, meshes: [{ primitives: [{ attributes: { POSITION: 0 }, mode: 0 }] }], accessors: [{ bufferView: 0, componentType: 5126, type: 'VEC3', count: 1 }], bufferViews: [{ buffer: 0, byteLength: 12 }], buffers: [{ byteLength: 16, ...(wrapGlb ? {} : { uri: bufferUri }) }] }));
    const padded = Math.ceil(json.length / 4) * 4;
    const glb = Buffer.alloc(20 + padded + 8 + 16, 32);
    glb.write('glTF'); glb.writeUInt32LE(2, 4); glb.writeUInt32LE(glb.length, 8); glb.writeUInt32LE(padded, 12); glb.write('JSON', 16); json.copy(glb, 20);
    glb.writeUInt32LE(16, 20 + padded); glb.writeUInt32LE(0x004e4942, 24 + padded);
    const filename = wrapGlb ? 'Chair.glb' : 'Chair.gltf';
    const main = wrapGlb ? glb : json;
    if (url.pathname === `/v1/assets/${encodeURIComponent(id)}`) return Response.json({ ...source, license: { name: 'Example catalog license', commercialUse: false } });
    if (url.pathname === `/v1/assets/${encodeURIComponent(id)}/files`) return Response.json({ id, license: { name: 'Example catalog license', commercialUse: false }, files: [{ filename, url: cdn + filename, sizeBytes: main.length,
      includes: wrapGlb ? [] : [{ path: companionPath, url: fileUrl, sizeBytes: size }] }] });
    if (url.href === cdn + filename) return new Response(main);
    assert.equal(url.href, cdn + 'Chair.bin');
    fetchedBinaries++;
    return new Response(binary);
  });
  try {
    const chat = await chats.create();
    const workspace = path.join(store.directory, 'super-agent', 'work', chat.id);
    const call = async (action: string, scope: 'read' | 'write', args: Record<string, unknown>) => {
      const { token } = await gateway.tokenStore.create(scope, scope, `${origin}/mcp`);
      return (await local(`${origin}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'openmotion_asset_manage', arguments: { action, ...args } } }) })).json();
    };
    const post = (action: string, data: object) => local(`${origin}/motion-api/model-catalog/${action}`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    const { models } = await (await local(`${origin}/motion-api/model-catalog/search?q=wooden%20chair`)).json();
    assert.deepEqual(models.map((row: any) => [row.id, row.downloadable]), [[id, true], ['grab3d:chair', false]]);
    assert.equal(models[0].sourceUrl, source.url);
    assert.equal(models[0].license, 'CC0');
    const home = (await (await local(`${origin}/motion-api/model-catalog/search?q=%20`)).json()).models;
    assert.deepEqual(home.map((row: any) => row.title), ['plant', 'building', 'character', 'Chair']);
    assert.deepEqual((await call('search_models', 'read', { query: '' })).result.structuredContent.models, home);
    assert.deepEqual(searchQueries.sort(), ['building', 'character', 'plant', 'vehicle', 'wooden chair']);
    assert.equal((await call('browse_models', 'read', { conversationId: chat.id })).error.code, -32003);
    assert.equal((await call('acquire_model', 'read', { conversationId: chat.id, id })).error.code, -32003);
    const opened = await (await post('open', { conversationId: chat.id })).json();
    const searched = (await call('browse_models', 'write', { conversationId: chat.id, query: 'wooden chair' })).result.structuredContent;
    assert.equal(searched.artifact.id, opened.artifact.id);
    assert.equal(searched.artifact.catalogQuery, 'wooden chair');
    assert.equal(opened.artifact.kind, 'model-catalog');
    const [first, second] = await Promise.all([chats.acquireModel(chat.id, id), chats.acquireModel(chat.id, id)]);
    assert.equal(fetchedBinaries, 1);
    assert.equal(first.artifact.id, second.artifact.id);
    const acquired = (await call('acquire_model', 'write', { id, conversationId: chat.id })).result.structuredContent;
    assert.equal(acquired.artifact.kind, 'workspace-file');
    assert.equal(first.artifact.id, acquired.artifact.id);
    assert.equal((await chats.get(chat.id)).activeArtifactId, acquired.artifact.id);
    const scoped = new URL(acquired.artifact.url, origin);
    assert.equal(scoped.searchParams.get('chatId'), chat.id);
    assert.equal(scoped.searchParams.get('rootKey'), `workspace:${chat.id}`);
    assert.equal((await (await local(scoped)).json()).asset.version, '2.0');
    assert.deepEqual(await readFile(path.join(workspace, path.dirname(acquired.artifact.filePath), 'Chair.bin')), binary);
    const provenance = JSON.parse(await readFile(path.join(workspace, path.dirname(acquired.artifact.filePath), 'provenance.json'), 'utf8'));
    assert.equal(provenance.id, id);
    assert.equal(provenance.sourceUrl, source.url);
    assert.deepEqual(provenance.license, { name: 'Example catalog license', commercialUse: false });
    const before = await readdir(workspace);
    await assert.rejects(chats.acquireModel(chat.id, 'https://example.test/Chair.gltf'), /downloadable catalog model/);
    fileUrl = 'http://127.0.0.1/Chair.bin';
    await assert.rejects(chats.acquireModel(chat.id, id), /Invalid model file manifest/);
    fileUrl = cdn + 'Chair.bin';
    companionPath = '../Chair.bin';
    await assert.rejects(chats.acquireModel(chat.id, id), /Invalid model file manifest/);
    companionPath = 'Chair.bin';
    bufferUri = 'https://example.test/Chair.bin';
    await assert.rejects(chats.acquireModel(chat.id, id), /Unlisted model resource/);
    bufferUri = 'Chair.bin';
    size = 100 * 1024 * 1024;
    await assert.rejects(chats.acquireModel(chat.id, id), /size/);
    size = 16;
    binary = Buffer.alloc(8);
    await assert.rejects(chats.acquireModel(chat.id, id), /Incomplete model download/);
    assert.deepEqual(await readdir(workspace), before);
    binary = Buffer.alloc(16);
    await writeFile(path.join(workspace, path.dirname(acquired.artifact.filePath), 'Chair.bin'), Buffer.alloc(16, 1));
    await assert.rejects(chats.acquireModel(chat.id, id), /files have changed/);
    wrapGlb = true;
    const { artifact } = await (await post('acquire', { conversationId: chat.id, id })).json();
    assert.match(artifact.filePath, /Chair\.glb$/);
    const customPath = path.join(store.directory, 'custom-workspace');
    await mkdir(customPath);
    const custom = await chats.create({ workingDir: customPath });
    const customArtifact = (await chats.acquireModel(custom.id, id)).artifact;
    assert.equal(customArtifact.rootKey, `custom:${customPath}`);
    assert.equal((await readFile(path.join(customPath, customArtifact.filePath!))).toString('ascii', 0, 4), 'glTF');
  } finally {
    await gateway.close();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}, false));

test('2D searches keep free source links, verify single original PNGs and scope caches by dimension', t => fixture(async store => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGP4DwQACfsD/fteaysAAAAASUVORK5CYII=', 'base64');
  const id = 'opengameart:dungeon-tileset';
  const oga = { id, provider: 'opengameart', type: 'sprite', title: 'Dungeon tileset', price: { free: true }, downloadable: true,
    url: 'https://opengameart.org/content/dungeon-tileset', thumbnailUrl: 'https://opengameart.org/sites/default/files/styles/thumbnail/public/dungeon_pre.png' };
  const kenney = { ...oga, id: 'kenney:game-icons', provider: 'kenney', type: 'ui', title: 'Game Icons', author: 'Kenney', downloadable: false,
    url: 'https://kenney.nl/assets/game-icons', thumbnailUrl: 'https://kenney.nl/media/pages/assets/game-icons/preview.png' };
  const itch = { ...kenney, id: 'itchio:artist/icons', provider: 'itchio', url: 'https://artist.itch.io/icons', thumbnailUrl: 'https://img.itch.zone/icon.png' };
  const archive = { ...oga, id: 'opengameart:effect-pack', url: 'https://opengameart.org/content/effect-pack' };
  const file = { filename: 'dungeon_tiles_0.png', group: 'files', format: 'png', sizeBytes: png.length, url: 'https://opengameart.org/sites/default/files/dungeon_tiles_0.png' };
  const license = { name: 'CC-BY-3.0', url: 'https://creativecommons.org/licenses/by/3.0/', attributionRequired: true };
  const detail = { ...oga, author: 'Example artist', license, files: [file] };
  let manifest = detail;
  let image = png;
  let downloads = 0;
  const searches: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    assert.equal(init?.redirect, 'error');
    if (url.href === file.url) { downloads++; return new Response(image); }
    assert.equal(url.origin, 'https://3d.shep.bot');
    if (url.pathname === `/v1/assets/${encodeURIComponent(id)}`) return Response.json(manifest);
    if (url.pathname === `/v1/assets/${encodeURIComponent(archive.id)}`) return Response.json({ ...detail, ...archive, files: [{ ...file, filename: 'pack.zip', format: 'zip' }] });
    assert.equal(url.pathname, '/v1/search');
    const kind = url.searchParams.get('type');
    assert.equal(url.searchParams.get('free'), 'true');
    assert.equal(url.searchParams.get('downloadable'), kind === 'model' ? 'true' : null);
    searches.push(`${url.searchParams.get('q')}/${kind}`);
    return Response.json({ results: kind === 'ui' ? [kenney, kenney, itch, { ...itch, url: 'https://other.itch.io/icons' }, { ...kenney, price: { free: false } }] : kind === 'sprite' ? [archive, oga, { ...oga, id: 'opengameart:paid', url: 'https://opengameart.org/content/paid', price: { free: false } }] : [] });
  });
  assert.equal(catalogDimension(null), '3d');
  assert.equal(catalogDimension(' 2D '), '2d');
  await assert.rejects(searchModels('forest', '4d'), /Choose 2d or 3d/);
  const [first, second, three] = await Promise.all([searchModels('forest', '2d'), searchModels('forest', '2d'), searchModels('forest')]);
  assert.deepEqual(first, second);
  assert.deepEqual(three.models, []);
  assert.deepEqual(first.models.map(row => [row.id, row.downloadable]), [[id, true], [archive.id, false], [kenney.id, false], [itch.id, false]]);
  assert.equal(first.models[0].author, detail.author);
  assert.equal(first.models[0].dimension, '2d');
  assert.equal(first.models[0].license, license.name);
  await searchModels('forest', '2d');
  await searchModels('hero sprite', '2d');
  await searchModels('health UI', '2d');
  await searchModels(null, '2d');
  assert.deepEqual(searches.sort(), ['forest/model', 'forest/sprite', 'forest/ui', 'hero sprite/sprite', 'health UI/ui', 'sprite/sprite', 'tileset/sprite', 'effects/sprite', 'icons/ui'].sort());
  const chats = superAgentConversations(store);
  const chat = await chats.create();
  const artifact = (await chats.acquireModel(chat.id, id)).artifact;
  assert.equal(artifact.kind, 'workspace-file');
  assert.equal(artifact.rootKey, `workspace:${chat.id}`);
  assert.match(artifact.filePath!, /dungeon_tiles_0\.png$/);
  const destination = path.join(store.directory, 'super-agent', 'work', chat.id, artifact.filePath!);
  assert.deepEqual(await readFile(destination), png);
  const provenance = JSON.parse(await readFile(path.join(path.dirname(destination), 'provenance.json'), 'utf8'));
  assert.deepEqual(provenance.license, license);
  assert.equal(provenance.author, detail.author);
  assert.equal(provenance.sourceUrl, oga.url);
  assert.equal(provenance.files[0].url, file.url);
  await assert.rejects(chats.acquireModel(chat.id, archive.id), /original PNG/);
  await assert.rejects(chats.acquireModel(chat.id, kenney.id), /Choose a downloadable/);
  for (const change of [{ id: 'opengameart:other' }, { price: { free: false } }, { type: 'model' }, { files: [file, file] }, { files: [{ ...file, url: oga.thumbnailUrl }] }, { files: [{ ...file, url: 'https://untrusted.example/a.png' }] }, { files: [{ ...file, sizeBytes: 50_000_000 }] }]) {
    manifest = { ...detail, ...change };
    await assert.rejects(chats.acquireModel(chat.id, id), /PNG/);
  }
  assert.equal(downloads, 1);
  manifest = detail;
  image = Buffer.alloc(png.length);
  await assert.rejects(chats.acquireModel(chat.id, id), /texture/);
  image = png.subarray(0, -1);
  await assert.rejects(chats.acquireModel(chat.id, id), /Incomplete PNG/);
}, false));

test('direct GLBs verify provider metadata, enforce transfer limits and record only stable provenance', t => fixture(async store => {
  const json = JSON.stringify({ asset: { version: '2.0' }, meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    accessors: [{ type: 'VEC3', componentType: 5126, bufferView: 0, count: 1 }], bufferViews: [{ buffer: 0, byteLength: 12 }], buffers: [{ byteLength: 12 }] });
  const padded = Math.ceil(Buffer.byteLength(json) / 4) * 4;
  const glb = Buffer.alloc(40 + padded, 32);
  glb.write('glTF'); glb.writeUInt32LE(2, 4); glb.writeUInt32LE(glb.length, 8); glb.writeUInt32LE(padded, 12); glb.write('JSON', 16); glb.write(json, 20);
  glb.writeUInt32LE(12, 20 + padded); glb.writeUInt32LE(0x004e4942, 24 + padded);
  const license = { name: 'CC0', url: 'https://creativecommons.org/publicdomain/zero/1.0/', commercialUse: true, attributionRequired: false };
  const assetKey = 'a'.repeat(32);
  const uuid = '00000000-0000-4000-8000-000000000001';
  const examples = [
    ['polyfork', 'chair', 'https://polyfork.dev/asset/chair', 'https://polyfork.dev/files/chair/hero.png', 'https://polyfork.dev/cdn/chair.glb'],
    ['grab3d', 'chair', 'https://grab3d.com/models/furniture/chair/', 'https://grab3d.com/m/chair/chair.webp', 'https://grab3d.com/dl/chair/chair.glb'],
    ['threedassets', 'chair', 'https://3dassets.dev/assets/chair', 'https://cdn.3dassets.dev/assets/301/v1/thumb.webp', 'https://cdn.3dassets.dev/assets/301/v1/model.glb'],
    ['blenderkit', uuid, `https://www.blendkit.com/asset-gallery-detail/${uuid}/`, `https://public.blenderkit.com/thumbnails/assets/${assetKey}/files/thumb.jpg`, `https://assets.blendkit.com/assets/${assetKey}/files/gltf_${uuid}.glb`],
  ];
  const chats = superAgentConversations(store);
  const chat = await chats.create();
  const workspace = path.join(store.directory, 'super-agent/work', chat.id);
  let fileChanges: Record<string, unknown> = {}, detailChanges: Record<string, unknown> = {}, manifestChanges: Record<string, unknown> = {};
  let oversize = false, corrupt = false, downloads = 0, signature = 0;
  let current = examples[0];
  t.mock.method(globalThis, 'fetch', async (input: string, init?: RequestInit) => {
    const [provider, slug, url, thumbnailUrl, cdn] = current;
    const id = `${provider}:${slug}`;
    const blender = provider === 'blenderkit';
    assert.equal(init?.redirect, 'error');
    const file = { filename: blender ? 'chair_gltf.glb' : `${slug}.glb`, group: blender ? 'gltf' : 'glb', format: 'glb',
      url: blender ? `${cdn}?verify=${++signature}` : cdn, sizeBytes: provider === 'polyfork' ? undefined : glb.length + (provider === 'grab3d' ? 56 : 0), ...fileChanges };
    const detail = { id, nativeId: slug, provider, type: 'model', price: { free: true }, downloadable: true, formats: ['glb'], url, thumbnailUrl, author: 'Artist', license, files: [file], ...detailChanges };
    const api = `https://3d.shep.bot/v1/assets/${encodeURIComponent(id)}`;
    if (input === api) return Response.json(detail);
    if (input === `${api}/files?format=glb`) return Response.json({ id, license, files: [file], ...manifestChanges });
    if (input.startsWith('https://3d.shep.bot/v1/search?')) return Response.json({ results: [{ ...detail, title: 'Chair', price: { free: true } }] });
    assert.equal(input.split('?')[0], cdn);
    downloads++;
    return new Response(corrupt ? Buffer.alloc(glb.length) : glb, { headers: oversize ? { 'Content-Length': String(49 * 1024 * 1024) } : {} });
  });
  for (current of examples) {
    const [provider, slug, sourceUrl, , cdn] = current;
    const id = `${provider}:${slug}`;
    const listing = (await searchModels(`test direct ${provider}`)).models[0];
    assert.equal(listing.downloadable, true);
    const before = downloads;
    const [first, second] = await Promise.all([chats.acquireModel(chat.id, id), chats.acquireModel(chat.id, id)]);
    assert.equal(first.artifact.filePath, second.artifact.filePath);
    assert.equal(downloads, before + 1);
    const target = path.join(workspace, first.artifact.filePath!);
    assert.deepEqual(await readFile(target), glb);
    assert.deepEqual(JSON.parse(await readFile(path.join(path.dirname(target), 'provenance.json'), 'utf8')), {
      id, provider, author: 'Artist', sourceUrl, license, files: [{ path: path.basename(target), url: cdn, sizeBytes: glb.length }],
    });
    assert.equal((await chats.acquireModel(chat.id, id)).artifact.filePath, first.artifact.filePath);
  }
  current = examples[2];
  const id = 'threedassets:chair';
  const folders = await readdir(workspace);
  const before = downloads;
  for (detailChanges of [{ price: { free: false } }, { nativeId: 'other' }, { provider: 'grab3d' }, { url: 'https://3dassets.dev/assets/other' }, { license: {} }]) {
    await assert.rejects(chats.acquireModel(chat.id, id), /GLB/);
  }
  detailChanges = { price: { free: false } };
  assert.equal((await searchModels('test paid detail')).models[0].downloadable, false);
  detailChanges = {};
  for (fileChanges of [{ requiresAuth: true }, { url: 'http://cdn.3dassets.dev/assets/301/v1/model.glb' }, { url: 'https://cdn.3dassets.dev/assets/300/v1/model.glb' }, { sizeBytes: 49 * 1024 * 1024 }, { format: 'zip' }]) {
    await assert.rejects(chats.acquireModel(chat.id, id), /GLB/);
  }
  fileChanges = {};
  manifestChanges = { id: 'threedassets:other' };
  await assert.rejects(chats.acquireModel(chat.id, id), /manifest mismatch/);
  manifestChanges = {};
  assert.equal(downloads, before);
  oversize = true;
  await assert.rejects(chats.acquireModel(chat.id, id), /too large/);
  oversize = false;
  corrupt = true;
  await assert.rejects(chats.acquireModel(chat.id, id), /GLB header/);
  assert.deepEqual(await readdir(workspace), folders);
}, false));
