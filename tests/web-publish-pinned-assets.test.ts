import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { AssetLibrary } from '../gateway/asset-library.ts';
import { assetHttp } from '../gateway/asset-http.ts';
import { buildPublishBundle } from '../gateway/web-publish-bundle.ts';
import { WebPublishService, type WebPublishAccountClient } from '../gateway/web-publish.ts';
import type { LibraryAsset } from '../shared/asset-library.ts';
import { WorkspaceStore } from '../workspace.ts';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

async function fixture(t: TestContext, bytes = png) {
  const workspace = await mkdtemp(path.join(tmpdir(), 'publish-pinned-assets-'));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const store = new WorkspaceStore(workspace), library = new AssetLibrary(store);
  const assetId = randomUUID(), versionId = randomUUID(), nextVersionId = randomUUID();
  const asset: LibraryAsset = {
    id: assetId, name: 'Pinned image', modality: 'image', createdAt: 1, updatedAt: 2, currentVersionId: nextVersionId,
    versions: [versionId, nextVersionId].map((id, index) => ({
      id, createdAt: index + 1, source: 'upload', filename: 'media.png', mimeType: 'image/png',
      bytes: bytes.length, sha256: digest(bytes), references: [],
    })),
  };
  const record = path.join(library.root, 'records', `${assetId}.json`);
  const filename = path.join(library.root, 'files', assetId, versionId, 'media.png');
  await mkdir(path.dirname(record), { recursive: true });
  await mkdir(path.dirname(filename), { recursive: true });
  await writeFile(record, JSON.stringify(asset));
  await writeFile(filename, bytes);
  // Deliberately do not create the current version's file: the authored URL
  // pins the older version, which remains complete and available.
  const url = `/motion-api/assets/${assetId}/versions/${versionId}/media`;
  const sourcePath = path.join(workspace, 'game');
  await mkdir(sourcePath);
  const html = `<img src="${url}"><script>const image = "${url}";</script>`;
  await writeFile(path.join(sourcePath, 'index.html'), html);
  const input = { dataDirectory: workspace, kind: 'game' as const, targetId: 'pinned-game', sourcePath, entryPath: 'index.html' };
  return { store, library, assetId, versionId, record, filename, url, input, html };
}

test('publishing keeps an existing pinned asset after it is moved to Trash', async t => {
  const { store, library, assetId, versionId, url, input } = await fixture(t);
  await library.update(assetId, { trashed: true });
  const server = createServer((req, res) => {
    const target = new URL(req.url!, 'http://localhost');
    target.pathname = target.pathname.replace('/motion-api/', '/api/');
    void assetHttp(req, res, target, store).catch(error => { res.writeHead(500).end(String(error)); });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const response = await fetch(`http://127.0.0.1:${address.port}${url}`);
  assert.equal(response.status, 200);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), png);

  const bundle = await buildPublishBundle(input);
  assert.equal(bundle.bundledAssetCount, 1);
  assert.deepEqual(bundle.files.find(file => file.file === `_shared-assets/${assetId}-${versionId}.png`)?.data, png);
  assert.doesNotMatch(bundle.files.find(file => file.file === 'index.html')!.data.toString(), /motion-api\/assets/);
  assert.ok((await library.get(assetId)).trashedAt, 'publishing must not restore the asset');
});

for (const missing of ['record', 'file'] as const) {
  test(`publishing rejects a missing pinned asset ${missing}`, async t => {
    const { record, filename, input } = await fixture(t);
    await rm(missing === 'record' ? record : filename);
    await assert.rejects(buildPublishBundle(input), /ASSET_VERSION_UNAVAILABLE/);
  });
}

for (const changed of ['same-size', 'truncated'] as const) {
  test(`publishing rejects ${changed} changes to pinned asset bytes`, async t => {
    const { filename, input } = await fixture(t);
    await writeFile(filename, changed === 'same-size' ? Buffer.alloc(png.length) : png.subarray(0, 20));
    await assert.rejects(buildPublishBundle(input), /ASSET_CONTENT_CHANGED/);
  });
}

test('intact pinned versions bundle once even after the current version changes', async t => {
  const { input, html, assetId, versionId } = await fixture(t);
  const bundle = await buildPublishBundle(input);
  assert.equal(bundle.bundledAssetCount, 1);
  assert.equal(bundle.fileCount, 2);
  assert.deepEqual(bundle.files.find(file => file.file === `_shared-assets/${assetId}-${versionId}.png`)?.data, png);
  assert.equal(await readFile(path.join(input.sourcePath, 'index.html'), 'utf8'), html);
});

test('invalid pinned bytes stop publication before remote mutations', async t => {
  const { filename, input } = await fixture(t);
  await writeFile(filename, Buffer.alloc(png.length));
  const commands: string[][] = [];
  const account: WebPublishAccountClient = {
    async isSignedIn() { return true; },
    async listWorkspaces() { return [{ workspaceId: 'test-workspace', workspaceName: 'Test', workspaceType: 'personal', workspaceMemberId: 'test-member', role: 'owner', isDefault: true, memberStatus: 'active', lifecycleState: 'active' }]; },
    async runWithEnv(args) { commands.push(args); throw Error('Unexpected remote operation'); },
  };
  const service = new WebPublishService(input.dataDirectory, account);
  await assert.rejects(service.publish({ kind: 'game', id: input.targetId, title: 'Pinned game', entryPath: input.entryPath, sourcePath: input.sourcePath, sourceRevision: '1' }), /ASSET_CONTENT_CHANGED/);
  assert.deepEqual(commands, []);
});

test('raster optimization reads the verified snapshot even if the library file changes', { skip: process.platform === 'win32' }, async t => {
  const original = Buffer.concat([png, Buffer.alloc(300 * 1024)]);
  const { filename, input } = await fixture(t, original);
  const encoder = path.join(input.dataDirectory, 'encoder');
  // A controlled encoder reports the hash of its input. It changes the mutable
  // library path first, so reopening that path instead of the snapshot is visible.
  await writeFile(encoder, `#!${process.execPath}
const { readFileSync, writeFileSync } = require('node:fs');
const { createHash } = require('node:crypto');
const args = process.argv.slice(2), out = args.indexOf('-o');
writeFileSync(${JSON.stringify(filename)}, Buffer.alloc(${original.length}, 1));
const bytes = readFileSync(args[out - 1]);
writeFileSync(args[out + 1], createHash('sha256').update(bytes).digest('hex'));
`);
  await chmod(encoder, 0o700);
  const previous = process.env.CWEBP_PATH;
  process.env.CWEBP_PATH = encoder;
  t.after(() => { if (previous === undefined) delete process.env.CWEBP_PATH; else process.env.CWEBP_PATH = previous; });
  const bundle = await buildPublishBundle(input);
  const optimized = bundle.files.find(file => file.file.startsWith('_shared-assets/'));
  assert.equal(bundle.sizeBreakdown.optimizedRasterCount, 1);
  assert.equal(optimized?.data.toString(), digest(original));
  assert.notEqual(digest(await readFile(filename)), digest(original));
});
