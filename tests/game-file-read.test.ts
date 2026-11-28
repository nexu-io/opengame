import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { GameProjects } from '../game-projects.ts';

const runFile = promisify(execFile);

test('game reads retain UTF-8, binary data and text limits while rejecting directories', async t => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'game-file-read-'));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const service = new GameProjects(workspace, path.join(workspace, 'templates'), path.join(workspace, 'kits'));
  const { game } = await service.create({ prompt: 'Read files', multiplayer: false });
  const root = path.join(service.root, game.id);
  await writeFile(path.join(root, 'notes.txt'), 'Game notes: 日本語');
  await writeFile(path.join(root, 'asset.bin'), Buffer.from([0, 255, 1, 128]));
  assert.equal((await service.read(game.id, 'notes.txt')).content, 'Game notes: 日本語');
  assert.deepEqual((await service.staticFile(game.id, 'asset.bin')).data, Buffer.from([0, 255, 1, 128]));
  await mkdir(path.join(root, 'folder.txt'));
  await assert.rejects(service.read(game.id, 'folder.txt'), /regular game file/);
  await assert.rejects(service.staticFile(game.id, 'folder.txt'), /regular game file/);
  await truncate(path.join(root, 'notes.txt'), 8 * 1024 * 1024 + 1);
  await assert.rejects(service.read(game.id, 'notes.txt'), /8 MiB/);
});

for (const operation of ['source', 'asset', 'metadata', 'viewer'] as const) {
  test(`${operation} reads reject a FIFO without waiting for a writer`, { skip: process.platform === 'win32', timeout: 10000 }, async t => {
    const workspace = await mkdtemp(path.join(tmpdir(), 'game-fifo-read-'));
    t.after(() => rm(workspace, { recursive: true, force: true }));
    const service = new GameProjects(workspace, path.join(workspace, 'templates'), path.join(workspace, 'kits'));
    const { game } = await service.create({ prompt: 'Special file', multiplayer: false });
    const target = operation === 'viewer' ? path.join(service.root, '.state.json')
      : path.join(service.root, game.id, operation === 'metadata' ? 'game.json' : 'pipe.txt');
    await rm(target, { force: true });
    try { await runFile('mkfifo', [target]); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') { t.skip('mkfifo is unavailable'); return; }
      throw error;
    }
    // Isolate a potentially blocking file read so a regression cannot hang the test worker.
    const script = `
      import assert from 'node:assert/strict';
      import path from 'node:path';
      import { GameProjects } from ${JSON.stringify(new URL('../game-projects.ts', import.meta.url).href)};
      const [workspace, id, operation] = process.argv.slice(1);
      const service = new GameProjects(workspace, path.join(workspace, 'templates'), path.join(workspace, 'kits'));
      await assert.rejects(
        operation === 'source' ? service.read(id, 'pipe.txt')
        : operation === 'asset' ? service.staticFile(id, 'pipe.txt') : service.get(id),
        /regular game file/,
      );
      if (operation === 'metadata') {
        const { game } = await service.create({ prompt: 'Still available', multiplayer: false });
        const catalog = await service.catalog();
        assert.deepEqual(catalog.games.map(item => item.id), [game.id]);
        assert.deepEqual(catalog.issues.map(item => item.id), [id]);
      }
    `;
    await runFile(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', script, workspace, game.id, operation],
      { timeout: 3000, killSignal: 'SIGKILL' });
  });
}
