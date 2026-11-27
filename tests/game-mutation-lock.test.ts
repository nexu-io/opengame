import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { GameProjects } from '../game-projects.ts';

const execute = promisify(execFile);

test('game mutations preserve viewer updates across service instances', async t => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'opengame-mutation-'));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const services = Array.from({ length: 12 }, () => new GameProjects(workspace, path.join(workspace, 'templates'), path.join(workspace, 'kits')));
  const { game } = await services[0].create({ prompt: 'Counter test', multiplayer: false });
  await Promise.all(services.map(service => service.interact(game.id, 'play')));
  assert.equal((await services[0].get(game.id)).plays, services.length);

  await assert.rejects(services[0].interact(game.id, 'reaction', 2), /reaction/);
  await services[1].interact(game.id, 'favorite', true);
  assert.equal((await services[0].get(game.id)).favorite, true);
  assert.deepEqual((await readdir(services[0].root)).filter(name => name.includes('lock')), []);
});

test('game mutations preserve viewer updates across processes', async t => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'opengame-mutation-process-'));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const service = new GameProjects(workspace, path.join(workspace, 'templates'), path.join(workspace, 'kits'));
  const { game } = await service.create({ prompt: 'Process counter test', multiplayer: false });
  const source = `import { GameProjects } from ${JSON.stringify(new URL('../game-projects.ts', import.meta.url).href)};
    const service = new GameProjects(process.argv[1]);
    await Promise.all(Array.from({ length: 12 }, () => service.interact(process.argv[2], 'play')));`;
  await Promise.all(Array.from({ length: 3 }, () => execute(process.execPath, [
    '--experimental-strip-types', '--input-type=module', '-e', source, workspace, game.id,
  ])));
  assert.equal((await service.get(game.id)).plays, 36);
});
