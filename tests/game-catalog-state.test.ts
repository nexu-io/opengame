import assert from 'node:assert/strict';
import fs, { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { GameProjects } from '../game-projects.ts';

async function fixture(t: TestContext, count: number) {
  const workspace = await mkdtemp(path.join(tmpdir(), 'game-catalog-state-'));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const service = new GameProjects(workspace, path.join(workspace, 'templates'), path.join(workspace, 'kits'));
  const ids: string[] = [];
  for (let index = 0; index < count; index++) {
    const { game } = await service.create({ prompt: `Catalog game ${index}`, multiplayer: false, genre: null, style: null, setting: null });
    ids.push(game.id);
  }
  return { service, ids, stateFile: path.join(service.root, '.state.json') };
}

function observeStateReads(t: TestContext, stateFile: string, onRead?: (count: number) => Promise<void>) {
  let count = 0;
  const readFile = fs.readFile, open = fs.open;
  const observe = async (file: unknown) => {
    if (String(file) === stateFile) { count++; await onRead?.(count); }
  };
  t.mock.method(fs, 'readFile', async (...args: Parameters<typeof fs.readFile>) => {
    const result = await readFile(...args);
    await observe(args[0]);
    return result;
  });
  // Descriptor-based readers use this path; count the open rather than internal chunks.
  t.mock.method(fs, 'open', async (...args: Parameters<typeof fs.open>) => {
    const result = await open(...args);
    await observe(args[0]);
    return result;
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  return () => count;
}

test('a catalog reads shared viewer state once for all of its games', async t => {
  const { service, ids, stateFile } = await fixture(t, 24);
  await writeFile(stateFile, JSON.stringify(Object.fromEntries(ids.map((id, index) => [id, { plays: index, reaction: 1, favorite: true }]))));
  const reads = observeStateReads(t, stateFile);
  const catalog = await service.catalog();
  assert.equal(catalog.games.length, ids.length);
  for (const game of catalog.games) {
    assert.equal(game.plays, ids.indexOf(game.id));
    assert.equal(game.likes, 1);
    assert.equal(game.favorite, true);
  }
  assert.equal(reads(), 1, 'viewer-state I/O should not scale with the number of cards');
});

test('catalog cards share one viewer snapshot while later reads observe new interactions', async t => {
  const { service, ids, stateFile } = await fixture(t, 6);
  const values = (offset: number) => JSON.stringify(Object.fromEntries(ids.map((id, index) => [id, { plays: offset + index, reaction: 0, favorite: false }])));
  await writeFile(stateFile, values(10));
  const reads = observeStateReads(t, stateFile, async count => {
    if (count !== 1) return;
    await writeFile(stateFile + '.next', values(100));
    await rename(stateFile + '.next', stateFile);
  });
  const first = await service.catalog();
  for (const game of first.games) assert.equal(game.plays, 10 + ids.indexOf(game.id));
  assert.equal((await service.get(ids[0])).plays, 100);
  const next = await service.catalog();
  for (const game of next.games) assert.equal(game.plays, 100 + ids.indexOf(game.id));
  assert.equal(reads(), 3, 'separate get/catalog requests must obtain fresh viewer state');
});

test('a failed viewer snapshot remains isolated to one catalog request', async t => {
  const { service, ids, stateFile } = await fixture(t, 3);
  await writeFile(stateFile, '{ invalid json');
  const reads = observeStateReads(t, stateFile);
  const broken = await service.catalog();
  assert.deepEqual(broken.games, []);
  assert.deepEqual(broken.issues?.map(issue => issue.id).sort(), [...ids].sort());
  assert.equal(reads(), 1);
  await writeFile(stateFile, '{}');
  assert.equal((await service.catalog()).games.length, ids.length);
  assert.equal(reads(), 2);
});

test('empty catalogs and invalid game metadata do not force a viewer-state read', async t => {
  const { service, stateFile } = await fixture(t, 0);
  const reads = observeStateReads(t, stateFile);
  assert.deepEqual(await service.catalog(), { games: [] });
  await mkdir(path.join(service.root, 'broken'), { recursive: true });
  await writeFile(path.join(service.root, 'broken', 'game.json'), '{ invalid metadata');
  const catalog = await service.catalog();
  assert.deepEqual(catalog.games, []);
  assert.deepEqual(catalog.issues?.map(issue => issue.id), ['broken']);
  assert.equal(reads(), 0);
});
