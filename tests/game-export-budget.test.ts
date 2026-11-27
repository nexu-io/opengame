import assert from 'node:assert/strict';
import { mkdtemp, open, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { GameProjects } from '../game-projects.ts';
import { buildPublishBundle, MAX_PUBLISH_BYTES } from '../gateway/web-publish-bundle.ts';

const MiB = 1024 * 1024;

async function directory(t: TestContext) {
  const root = await mkdtemp(path.join(tmpdir(), 'game-export-budget-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function sparseFile(filename: string, bytes: number) {
  const file = await open(filename, 'w');
  try { await file.truncate(bytes); }
  finally { await file.close(); }
}

test('game ZIP exports use their 64 MiB budget while cloud publication retains 50 MiB', async t => {
  const root = await directory(t);
  const service = new GameProjects(root, path.join(root, 'templates'), path.join(root, 'kits'));
  const { game } = await service.create({ prompt: 'Large offline game', multiplayer: false, genre: null, style: null, setting: null });
  const { dir } = await service.locate(game.id);
  const asset = path.join(dir, 'level.bin');
  await sparseFile(asset, 51 * MiB);

  const exported = await service.exportZip(game.id);
  assert.ok(exported.data.length > 51 * MiB, 'the ZIP must contain the full level asset');
  assert.equal(exported.data.readUInt32LE(0), 0x04034b50);
  let found = false;
  for (let offset = 0; exported.data.readUInt32LE(offset) === 0x04034b50;) {
    const bytes = exported.data.readUInt32LE(offset + 18);
    const nameLength = exported.data.readUInt16LE(offset + 26);
    const extraLength = exported.data.readUInt16LE(offset + 28);
    const name = exported.data.subarray(offset + 30, offset + 30 + nameLength).toString();
    if (name === 'level.bin') { found = true; assert.equal(bytes, 51 * MiB); }
    offset += 30 + nameLength + extraLength + bytes;
  }
  assert.equal(found, true);
  await assert.rejects(buildPublishBundle({ dataDirectory: root, kind: 'game', targetId: game.id, sourcePath: dir, entryPath: 'index.html' }), /exceeds 50 MiB limit/);

  await sparseFile(asset, 65 * MiB);
  await assert.rejects(service.exportZip(game.id), /Game export exceeds 64 MiB limit/);
});

test('single HTML sources honor an explicitly larger bundle budget', async t => {
  const root = await directory(t), sourcePath = path.join(root, 'large.html');
  await sparseFile(sourcePath, MAX_PUBLISH_BYTES + 1);
  const input = { dataDirectory: root, kind: 'game' as const, targetId: 'large', sourcePath, entryPath: 'index.html' };
  const bundle = await buildPublishBundle({ ...input, maxBytes: 64 * MiB });
  assert.equal(bundle.totalBytes, MAX_PUBLISH_BYTES + 1);
  assert.equal(bundle.files.length, 1);
  await assert.rejects(buildPublishBundle(input), /exceeds 50 MiB limit/);
});

test('custom smaller bundle budgets still accept exact bounds and reject overflow', async t => {
  const root = await directory(t), sourcePath = path.join(root, 'index.html');
  await writeFile(sourcePath, '<h1>Game</h1>');
  const input = { dataDirectory: root, kind: 'game' as const, targetId: 'small', sourcePath, entryPath: 'index.html', maxBytes: 13 };
  assert.equal((await buildPublishBundle(input)).totalBytes, 13);
  await writeFile(sourcePath, '<h1>Game!</h1>');
  await assert.rejects(buildPublishBundle(input), /exceeds .* MiB limit/);
});
