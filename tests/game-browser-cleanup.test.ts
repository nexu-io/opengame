import assert from 'node:assert/strict';
import fs, { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { pathToFileURL } from 'node:url';
import { GameProjects } from '../game-projects.ts';

async function fixture(t: TestContext) {
  const workspace = await mkdtemp(path.join(tmpdir(), 'game-browser-cleanup-'));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const service = new GameProjects(workspace, path.join(workspace, 'templates'), path.join(workspace, 'kits'));
  const { game } = await service.create({ prompt: 'Browser recovery', multiplayer: false, genre: null, style: null, setting: null });
  service.runtimeRoot = path.join(workspace, 'runtime');
  const packageDirectory = path.join(service.runtimeRoot, 'node_modules/puppeteer-core');
  await mkdir(packageDirectory, { recursive: true });
  await writeFile(path.join(packageDirectory, 'package.json'), JSON.stringify({ name: 'puppeteer-core', type: 'module', main: 'index.js' }));
  const moduleFile = path.join(packageDirectory, 'index.js');
  await writeFile(moduleFile, `
    export const entered = Promise.withResolvers();
    export const release = Promise.withResolvers();
    export default { async launch() {
      entered.resolve();
      await release.promise;
      throw new Error('Controlled browser launch failure');
    } };
  `);
  const stub = await import(pathToFileURL(moduleFile).href);
  const previous = process.env.MOTION_BROWSER_PATH;
  process.env.MOTION_BROWSER_PATH = process.execPath;
  t.after(() => {
    if (previous === undefined) delete process.env.MOTION_BROWSER_PATH;
    else process.env.MOTION_BROWSER_PATH = previous;
  });
  return { service, id: game.id, stub };
}

test('profile cleanup failures do not permanently block later game browser runs', { timeout: 5000 }, async t => {
  const { service, id, stub } = await fixture(t);
  stub.release.resolve();
  const originalRm = fs.rm, profiles = new Set<string>();
  let failCleanup = true;
  t.mock.method(fs, 'rm', async (...args: Parameters<typeof fs.rm>) => {
    const file = String(args[0]);
    if (path.basename(file).startsWith('openmotion-game-chrome-')) {
      profiles.add(file);
      if (failCleanup) {
        failCleanup = false;
        throw Object.assign(new Error('Controlled profile cleanup failure'), { code: 'EBUSY' });
      }
    }
    return originalRm(...args);
  });
  syncBuiltinESMExports();
  t.after(async () => {
    t.mock.restoreAll(); syncBuiltinESMExports();
    for (const profile of profiles) await originalRm(profile, { recursive: true, force: true });
  });

  await assert.rejects(service.playtest(id, { durationMs: 0 }), /Controlled profile cleanup failure/);
  await assert.rejects(service.playtest(id, { durationMs: 0 }), /Controlled browser launch failure/);
  await assert.rejects(service.captureCover(id, { delayMs: 0 }), /Controlled browser launch failure/);
});

test('an unfinished browser run still excludes concurrent runs and releases after failure', { timeout: 5000 }, async t => {
  const { service, id, stub } = await fixture(t);
  const first = service.playtest(id, { durationMs: 0 });
  await stub.entered.promise;
  try {
    await assert.rejects(service.captureCover(id, { delayMs: 0 }), /already active/);
  } finally {
    stub.release.resolve();
    await assert.rejects(first, /Controlled browser launch failure/);
  }
  await assert.rejects(service.playtest(id, { durationMs: 0 }), /Controlled browser launch failure/);
});
