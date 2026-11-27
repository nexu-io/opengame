import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { WebPublishService, type WebPublishAccountClient } from '../gateway/web-publish.ts';
import { atomicJson } from '../phase1-versions.ts';
import type { WebPublicationRecord } from '../shared/web-publish.ts';

const target = { kind: 'html' as const, id: 'refresh-race', entryPath: 'index.html' };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

function publication(overrides: Partial<WebPublicationRecord> = {}): WebPublicationRecord {
  return {
    schemaVersion: 1,
    targetKind: target.kind,
    targetId: target.id,
    projectId: target.id,
    cloudProjectId: 'cloud-project',
    filePath: target.entryPath,
    entryPath: target.entryPath,
    name: 'Shared game',
    workspaceId: 'workspace',
    ownerMemberId: 'member',
    resourceId: 'resource',
    sourceFileId: 'source',
    sourceKey: 'source-key',
    slug: 'shared-link',
    version: 1,
    versionId: 'version-1',
    status: 'published',
    url: 'https://example.test/artifact/cloud-project/shared-link',
    publishedAt: 1,
    updatedAt: 1,
    fileCount: 1,
    totalBytes: 10,
    sourceRevision: 'revision-1',
    ...overrides,
  };
}

function account(run: WebPublishAccountClient['runWithEnv']): WebPublishAccountClient {
  return { isSignedIn: async () => true, listWorkspaces: async () => [], runWithEnv: run };
}

async function fixture(t: TestContext, record = publication()) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'web-publish-refresh-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'web-publications', 'html--refresh-race.json');
  await mkdir(path.dirname(file), { recursive: true });
  const save = async (next: WebPublicationRecord) => atomicJson(file, {
    schemaVersion: 1,
    reservations: {},
    publications: { [target.entryPath]: next },
  });
  await save(record);
  const read = async (): Promise<WebPublicationRecord> => JSON.parse(await readFile(file, 'utf8')).publications[target.entryPath];
  return { root, save, read };
}

test('a delayed status response cannot reverse a completed unpublish', async t => {
  const data = await fixture(t);
  const requested = deferred<void>();
  const response = deferred<string>();
  const client = account(async args => {
    if (args[1] === 'status') { requested.resolve(); return response.promise; }
    assert.equal(args[1], 'stop');
    return JSON.stringify({ status: 'stopped', slug: args[2] });
  });
  const reading = new WebPublishService(data.root, client).status(target, { refresh: true });
  await requested.promise;
  const stopped = await new WebPublishService(data.root, client).unpublish(target);
  assert.equal(stopped.publication.status, 'stopped');
  assert.equal((await data.read()).status, 'stopped');
  response.resolve(JSON.stringify({ status: 'active' }));
  const refreshed = await reading;
  assert.equal(refreshed.active?.status, 'stopped');
  assert.deepEqual(await data.read(), stopped.publication);
});

for (const [name, changes] of [
  ['a newer version on the same share', { version: 2, versionId: 'version-2', sourceRevision: 'revision-2', updatedAt: 2 }],
  ['a replacement workspace on the same share', { workspaceId: 'another-workspace', ownerMemberId: 'another-member', updatedAt: 2 }],
  ['a replacement share link', { slug: 'replacement', url: 'https://example.test/artifact/cloud-project/replacement', updatedAt: 2 }],
] as const) {
  test(`a delayed status response preserves ${name}`, async t => {
    const data = await fixture(t);
    const requested = deferred<void>();
    const response = deferred<string>();
    const service = new WebPublishService(data.root, account(async () => {
      requested.resolve();
      return response.promise;
    }));
    const reading = service.status(target, { refresh: true });
    await requested.promise;
    const newer = publication(changes);
    await data.save(newer);
    response.resolve(JSON.stringify({ status: 'stopped' }));
    const refreshed = await reading;
    assert.deepEqual(refreshed.active, newer);
    assert.deepEqual(await data.read(), newer);
  });
}

test('out-of-order refresh responses preserve the first committed refresh', async t => {
  const data = await fixture(t);
  const requested = [deferred<void>(), deferred<void>()];
  const responses = [deferred<string>(), deferred<string>()];
  let requests = 0;
  const service = new WebPublishService(data.root, account(async () => {
    const index = requests++;
    requested[index].resolve();
    return responses[index].promise;
  }));
  const older = service.status(target, { refresh: true });
  await requested[0].promise;
  const newer = service.status(target, { refresh: true });
  await requested[1].promise;
  responses[1].resolve(JSON.stringify({ status: 'stopped' }));
  await newer;
  const committed = await data.read();
  responses[0].resolve(JSON.stringify({ status: 'active' }));
  const result = await older;
  assert.deepEqual(result.active, committed);
  assert.deepEqual(await data.read(), committed);
});

test('an uncontended refresh still updates and persists remote status', async t => {
  const data = await fixture(t);
  const service = new WebPublishService(data.root, account(async args => {
    assert.deepEqual(args.slice(0, 3), ['share', 'status', 'shared-link']);
    return JSON.stringify({ status: 'stopped' });
  }));
  const refreshed = await service.status(target, { refresh: true });
  const saved = await data.read();
  assert.equal(saved.status, 'stopped');
  assert.ok(saved.updatedAt > 1);
  assert.deepEqual(refreshed.active, saved);
});

test('a failed refresh preserves the saved publication', async t => {
  const original = publication();
  const data = await fixture(t, original);
  const service = new WebPublishService(data.root, account(async () => { throw new Error('transport failed'); }));
  const refreshed = await service.status(target, { refresh: true });
  assert.deepEqual(refreshed.active, original);
  assert.deepEqual(await data.read(), original);
});


for (const kind of ['game', 'design'] as const) {
  test('timestamp-free legacy ' + kind + ' publications refresh and migrate', async t => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'web-publish-legacy-refresh-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const legacyKind = kind + '-project';
    const id = 'legacy-refresh';
    const legacy = path.join(root, 'cloud-shares', legacyKind + '__' + Buffer.from(legacyKind + ':' + id).toString('base64url') + '.json');
    await mkdir(path.dirname(legacy), { recursive: true });
    await atomicJson(legacy, {
      kind: legacyKind, projectId: id, cloudProjectId: 'cloud-project',
      workspaceId: 'workspace', ownerMemberId: 'member',
      sourceFileId: 'source', sourceKey: 'source-key', resourceId: 'resource',
      slug: 'shared-link', versionId: 'version-1', status: 'active',
      url: 'https://example.test/artifact/cloud-project/shared-link',
    });
    let clock = 1_000;
    t.mock.method(Date, 'now', () => ++clock);
    const service = new WebPublishService(root, account(async () => JSON.stringify({ status: 'stopped' })));
    const result = await service.status({ kind, id, entryPath: 'index.html' }, { refresh: true });
    assert.equal(result.active?.status, 'stopped');
    const saved = JSON.parse(await readFile(path.join(root, 'web-publications', kind + '--' + id + '.json'), 'utf8')).publications['index.html'];
    assert.equal(saved.status, 'stopped');
    assert.ok(saved.updatedAt > saved.publishedAt);
    assert.deepEqual(result.active, saved);
  });
}

test('a delayed status response preserves a persisted timestamp-only publication change', async t => {
  const data = await fixture(t);
  const requested = deferred<void>(), response = deferred<string>();
  const service = new WebPublishService(data.root, account(async () => {
    requested.resolve();
    return response.promise;
  }));
  const reading = service.status(target, { refresh: true });
  await requested.promise;
  const newer = publication({ publishedAt: 2, updatedAt: 2 });
  await data.save(newer);
  response.resolve(JSON.stringify({ status: 'stopped' }));
  assert.deepEqual((await reading).active, newer);
  assert.deepEqual(await data.read(), newer);
});
