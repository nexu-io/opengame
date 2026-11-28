import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { GameProjects } from '../game-projects.ts';

for (const state of ['malformed', 'null', 'directory'] as const) {
  test(`deleting a game preserves its files when viewer state is ${state}`, async t => {
    const workspace = await mkdtemp(path.join(tmpdir(), 'game-delete-preflight-'));
    t.after(() => rm(workspace, { recursive: true, force: true }));
    const service = new GameProjects(workspace, path.join(workspace, 'templates'), path.join(workspace, 'kits'));
    const { game } = await service.create({ prompt: 'Preserve my game', multiplayer: false });
    const root = path.join(service.root, game.id), stateFile = path.join(service.root, '.state.json');
    const source = await readFile(path.join(root, 'index.html'));
    const metadata = await readFile(path.join(root, 'game.json'));
    if (state === 'directory') await mkdir(stateFile);
    else await writeFile(stateFile, state === 'malformed' ? '{ invalid json' : 'null');

    await assert.rejects(service.delete(game.id));
    assert.deepEqual(await readFile(path.join(root, 'index.html')), source);
    assert.deepEqual(await readFile(path.join(root, 'game.json')), metadata);
    await rm(stateFile, { recursive: true, force: true });
    assert.equal((await service.get(game.id)).id, game.id, 'repairing viewer state must make the original game available');
  });
}

for (const savedViewerState of [false, true]) {
  test(`deletion still removes the chosen game with ${savedViewerState ? 'saved' : 'missing'} viewer state`, async t => {
    const workspace = await mkdtemp(path.join(tmpdir(), 'game-delete-preflight-'));
    t.after(() => rm(workspace, { recursive: true, force: true }));
    const service = new GameProjects(workspace, path.join(workspace, 'templates'), path.join(workspace, 'kits'));
    const { game } = await service.create({ prompt: 'Delete this game', multiplayer: false });
    const { game: keep } = await service.create({ prompt: 'Keep this game', multiplayer: false });
    if (savedViewerState) {
      await service.interact(game.id, 'play');
      await service.interact(keep.id, 'favorite', true);
    }
    assert.deepEqual(await service.delete(game.id), { deleted: true, id: game.id });
    await assert.rejects(service.get(game.id), /not found/);
    assert.equal((await service.get(keep.id)).favorite, savedViewerState);
    const state = JSON.parse(await readFile(path.join(service.root, '.state.json'), 'utf8'));
    assert.equal(Object.hasOwn(state, game.id), false);
    if (savedViewerState) assert.equal(state[keep.id].favorite, true);
  });
}
