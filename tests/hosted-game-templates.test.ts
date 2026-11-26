import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { GameProjects } from '../game-projects.ts';
import { buildGameTemplateBundles } from '../scripts/game-template-publication.ts';
import { gameBundleUrl } from '../shared/hosted-game-templates.ts';

test('shallow source checkout fetches only the selected LFS game and reuses it offline', {
  skip: spawnSync('git', ['lfs', 'version']).status !== 0 && 'requires Git LFS',
}, async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'opengame-lfs-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'origin'), checkout = path.join(root, 'shallow');
  const templates = path.join(checkout, 'templates/games');
  const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'commit.gpgSign=false', '-c', 'user.name=Test', '-c', 'user.email=test@example.org', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  git(root, 'init', source);
  git(source, 'lfs', 'install', '--local');
  const games = path.join(source, 'templates/games');
  await mkdir(games, { recursive: true });
  await writeFile(path.join(source, '.lfsconfig'), '[lfs]\n fetchexclude = *\n');
  await writeFile(path.join(games, '.gitattributes'), '*.bin filter=lfs diff=lfs merge=lfs -text\n');
  for (const id of ['selected', 'other']) {
    const dir = path.join(games, id);
    await mkdir(dir);
    await writeFile(path.join(dir, 'game.json'), JSON.stringify({ id, title: id, description: 'Demo game', genre: 'casual', multiplayer: false, status: 'published', cover: 'cover.webp' }));
    await writeFile(path.join(dir, 'cover.webp'), 'poster');
    await writeFile(path.join(dir, 'index.html'), '<p>Game</p>');
    await writeFile(path.join(dir, 'asset.bin'), `${id} bytes`);
  }
  git(source, 'add', '.');
  git(source, 'commit', '-qm', 'Game templates');
  git(root, '-c', 'filter.lfs.process=', '-c', 'filter.lfs.smudge=', '-c', 'filter.lfs.required=false', 'clone', '--depth', '1', pathToFileURL(path.join(source, '.git')).href, checkout);
  git(checkout, 'lfs', 'install', '--local', '--skip-smudge');
  const asset = (id: string) => readFile(path.join(templates, id, 'asset.bin'), 'utf8');
  const pointer = /^version https:\/\/git-lfs/;
  await rename(source, source + '-offline');
  const workspace = path.join(root, 'workspace');
  const studio = new GameProjects(workspace, templates);
  assert.equal((await studio.catalog()).games.length, 2);
  assert.equal((await studio.staticFile('selected', 'cover.webp')).data.toString(), 'poster');
  assert.match(await asset('selected'), pointer);
  await assert.rejects(studio.staticFile('selected', 'index.html'), /Could not fetch selected/);
  await rename(source + '-offline', source);
  const page = await studio.staticFile('selected', 'index.html');
  assert.equal(page.data.toString(), '<p>Game</p>');
  assert.equal(await asset('selected'), 'selected bytes');
  const draft = await studio.remix('selected');
  assert.equal((await studio.staticFile(draft.game.id, 'asset.bin')).data.toString(), 'selected bytes');
  assert.match(await asset('other'), pointer);
  await rename(source, source + '-offline');
  assert.equal((await new GameProjects(workspace, templates).staticFile('selected', 'asset.bin')).data.toString(), 'selected bytes');
});

test('catalog and cover work offline; play and Remix share a verified, retryable persistent download', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'opengame-download-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'source'), installed = path.join(root, 'app/templates/games'), workspace = path.join(root, 'workspace');
  const sourceGame = path.join(source, 'demo'), cardDir = path.join(installed, 'demo');
  await mkdir(sourceGame, { recursive: true }); await mkdir(cardDir, { recursive: true });
  const meta = { id: 'demo', title: 'Demo', description: 'demo', genre: 'casual', multiplayer: false, status: 'published', cover: 'cover.webp' };
  for (const dir of [sourceGame, cardDir]) {
    await writeFile(path.join(dir, 'game.json'), JSON.stringify(meta));
    await writeFile(path.join(dir, 'cover.webp'), 'poster');
  }
  await writeFile(path.join(sourceGame, 'index.html'), '<script src="client.js"></script>');
  await writeFile(path.join(sourceGame, 'client.js'), 'document.title="Playable";');
  let zip!: Buffer;
  const games = await buildGameTemplateBundles(source, async (_lock, bytes) => { zip = bytes; });
  assert.deepEqual(await buildGameTemplateBundles(source), games);
  await writeFile(path.join(installed, '../game-downloads.json'), JSON.stringify({ schemaVersion: 1, games }));
  let fail = true;
  const request = t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(url, gameBundleUrl(games.demo.sha256)); assert.equal(init.redirect, 'error');
    return new Response(new Uint8Array(fail ? Buffer.alloc(zip.length) : zip));
  });
  const service = new GameProjects(workspace, installed);
  assert.equal((await service.catalog()).games[0].id, 'demo');
  assert.equal((await service.staticFile('demo', 'cover.webp')).data.toString(), 'poster');
  assert.equal(request.mock.callCount(), 0);
  await assert.rejects(service.staticFile('demo', 'index.html'), /Could not download game template demo/);
  assert.deepEqual(await readdir(path.join(workspace, 'game-template-cache')), []);
  fail = false;
  await Promise.all([service.staticFile('demo', 'client.js'), service.staticFile('demo', 'index.html')]);
  assert.equal(request.mock.callCount(), 2);
  fail = true;
  const restarted = new GameProjects(workspace, installed);
  const result = await restarted.remix('demo');
  assert.equal(result.game.source, 'mine');
  assert.equal((await restarted.staticFile(result.game.id, 'client.js')).data.toString(), await readFile(path.join(sourceGame, 'client.js'), 'utf8'));
  assert.equal(request.mock.callCount(), 2);
});
