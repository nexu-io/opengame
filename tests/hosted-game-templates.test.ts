import assert from 'node:assert/strict';
import { execFile, execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { GameProjects } from '../game-projects.ts';
import { buildGameTemplateBundles } from '../scripts/game-template-publication.ts';
import { HostedGameTemplates, defaultLfsBatchUrl, gameBundleUrl, lfsBatchUrlFromRemote } from '../shared/hosted-game-templates.ts';

const execGit = promisify(execFile);

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

test('lfsBatchUrlFromRemote maps HTTPS, SSH, and loopback remotes and rejects file or plain remote HTTP', () => {
  assert.equal(lfsBatchUrlFromRemote('https://github.com/nexu-io/opengame.git'), defaultLfsBatchUrl);
  assert.equal(lfsBatchUrlFromRemote('https://github.com/nexu-io/opengame/'), defaultLfsBatchUrl);
  assert.equal(lfsBatchUrlFromRemote('https://x-access-token:secret@github.com/nexu-io/opengame.git'), defaultLfsBatchUrl);
  assert.equal(lfsBatchUrlFromRemote('git@github.com:nexu-io/opengame.git'), defaultLfsBatchUrl);
  assert.equal(lfsBatchUrlFromRemote('git@github.com:nexu-io/opengame'), defaultLfsBatchUrl);
  assert.equal(lfsBatchUrlFromRemote('ssh://git@github.com:22/nexu-io/opengame.git'), defaultLfsBatchUrl);
  assert.equal(lfsBatchUrlFromRemote('http://127.0.0.1:8080/nexu-io/opengame.git'), 'http://127.0.0.1:8080/nexu-io/opengame.git/info/lfs/objects/batch');
  assert.equal(lfsBatchUrlFromRemote('file:///tmp/opengame/.git'), null);
  assert.equal(lfsBatchUrlFromRemote('/tmp/opengame/.git'), null);
  assert.equal(lfsBatchUrlFromRemote('http://example.com/nexu-io/opengame.git'), null);
});

test('source checkout without git-lfs hydrates via HTTP LFS batch into cache, keeps git status clean, and reuses objects offline', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'opengame-lfs-http-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const checkout = path.join(root, 'checkout');
  const templates = path.join(checkout, 'templates/games');
  const cache = path.join(root, 'cache');
  const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'commit.gpgSign=false', '-c', 'user.name=Test', '-c', 'user.email=test@example.org', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

  const objects = new Map<string, Buffer>();
  const pointerFor = (text: string) => {
    const bytes = Buffer.from(text);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    objects.set(sha256, bytes);
    return `version https://git-lfs.github.com/spec/v1\noid sha256:${sha256}\nsize ${bytes.length}\n`;
  };

  let corruptNext = true;
  const batchCalls: string[][] = [];
  const objectCalls: string[] = [];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (req.method === 'POST' && url.pathname === '/nexu-io/opengame.git/info/lfs/objects/batch') {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { objects: { oid: string; size: number }[] };
      batchCalls.push(body.objects.map(item => item.oid));
      const address = server.address();
      assert(address && typeof address === 'object');
      res.writeHead(200, { 'Content-Type': 'application/vnd.git-lfs+json' });
      res.end(JSON.stringify({
        transfer: 'basic',
        objects: body.objects.map(item => ({
          oid: item.oid,
          size: item.size,
          actions: {
            download: {
              href: `http://127.0.0.1:${address.port}/objects/${item.oid}`,
            },
          },
        })),
      }));
      return;
    }
    const match = /^\/objects\/([a-f0-9]{64})$/.exec(url.pathname);
    if (req.method === 'GET' && match) {
      objectCalls.push(match[1]);
      const data = objects.get(match[1]);
      if (!data) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      res.end(corruptNext ? Buffer.alloc(data.length) : data);
      return;
    }
    res.writeHead(404);
    res.end();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const address = server.address();
  assert(address && typeof address === 'object');

  git(root, 'init', checkout);
  git(checkout, 'remote', 'add', 'origin', `http://127.0.0.1:${address.port}/nexu-io/opengame.git`);
  await mkdir(templates, { recursive: true });
  await writeFile(path.join(templates, '.gitattributes'), '*.bin filter=lfs diff=lfs merge=lfs -text\n');
  for (const id of ['selected', 'other']) {
    const dir = path.join(templates, id);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'game.json'), JSON.stringify({ id, title: id, description: 'Demo game', genre: 'casual', multiplayer: false, status: 'published', cover: 'cover.webp' }));
    await writeFile(path.join(dir, 'cover.webp'), 'poster');
    await writeFile(path.join(dir, 'index.html'), `<p>${id}</p>`);
    await writeFile(path.join(dir, 'asset.bin'), pointerFor(`${id} bytes`));
  }
  git(checkout, '-c', 'filter.lfs.process=', '-c', 'filter.lfs.clean=cat', '-c', 'filter.lfs.required=false', 'add', '.');
  git(checkout, 'commit', '-qm', 'Add pointer templates');

  const noGitLfs = async (file: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv }) => {
    if (args[0] === 'lfs') throw new Error("git: 'lfs' is not a git command.");
    return execGit(file, args, options);
  };

  const hosted = new HostedGameTemplates(path.join(templates, '../game-downloads.json'), cache, { runGit: noGitLfs });
  const selectedDir = path.join(templates, 'selected');

  await assert.rejects(hosted.directory('selected', selectedDir), /Could not fetch selected via Git LFS or HTTPS fallback/);
  assert.deepEqual(await readdir(path.join(cache, 'lfs-objects')), []);

  corruptNext = false;
  const hydrated = await hosted.directory('selected', selectedDir);
  assert.notEqual(hydrated, selectedDir);
  assert.equal(await readFile(path.join(hydrated, 'asset.bin'), 'utf8'), 'selected bytes');
  assert.equal(await readFile(path.join(hydrated, 'index.html'), 'utf8'), '<p>selected</p>');
  assert.equal(hosted.cachedDirectory(selectedDir), hydrated);
  assert.equal(batchCalls.length, 2);
  assert.equal(batchCalls[1].length, 1);
  // Working tree must remain untouched and clean when git-lfs is absent.
  assert.match(await readFile(path.join(selectedDir, 'asset.bin'), 'utf8'), /^version https:\/\/git-lfs/);
  assert.equal(git(checkout, 'status', '--porcelain'), '');

  // Shut down HTTP server and prove offline cache reuse + zero-network rebuild when index.html changes.
  await new Promise<void>(resolve => server.close(() => resolve()));
  const restarted = new HostedGameTemplates(path.join(templates, '../game-downloads.json'), cache, { runGit: noGitLfs });
  const offlineDir = await restarted.directory('selected', selectedDir);
  assert.equal(offlineDir, hydrated);
  assert.equal(await readFile(path.join(offlineDir, 'asset.bin'), 'utf8'), 'selected bytes');

  await writeFile(path.join(selectedDir, 'index.html'), '<p>selected v2</p>');
  const updatedDir = await restarted.directory('selected', selectedDir);
  assert.notEqual(updatedDir, hydrated);
  assert.equal(await readFile(path.join(updatedDir, 'index.html'), 'utf8'), '<p>selected v2</p>');
  assert.equal(await readFile(path.join(updatedDir, 'asset.bin'), 'utf8'), 'selected bytes');
});

test('GameProjects play and remix work from a source snapshot without .git or git-lfs via HTTPS LFS fallback', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'opengame-snapshot-lfs-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const templates = path.join(root, 'snapshot/templates/games');
  const workspace = path.join(root, 'workspace');
  await mkdir(path.join(templates, 'selected'), { recursive: true });
  await writeFile(path.join(templates, '.gitattributes'), '*.bin filter=lfs diff=lfs merge=lfs -text\n');

  const assetBytes = Buffer.from('snapshot asset payload');
  const assetSha = createHash('sha256').update(assetBytes).digest('hex');
  await writeFile(path.join(templates, 'selected/game.json'), JSON.stringify({ id: 'selected', title: 'Selected', description: 'Demo', genre: 'casual', multiplayer: false, status: 'published', cover: 'cover.webp' }));
  await writeFile(path.join(templates, 'selected/cover.webp'), 'poster');
  await writeFile(path.join(templates, 'selected/index.html'), '<p>Playable</p>');
  await writeFile(path.join(templates, 'selected/asset.bin'), `version https://git-lfs.github.com/spec/v1\noid sha256:${assetSha}\nsize ${assetBytes.length}\n`);

  const requests: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    requests.push(url);
    if (url === defaultLfsBatchUrl) {
      return new Response(JSON.stringify({
        transfer: 'basic',
        objects: [{ oid: assetSha, size: assetBytes.length, actions: { download: { href: `https://objects.example.test/${assetSha}` } } }],
      }), { status: 200, headers: { 'Content-Type': 'application/vnd.git-lfs+json' } });
    }
    assert.equal(url, `https://objects.example.test/${assetSha}`);
    return new Response(new Uint8Array(assetBytes), { status: 200 });
  });

  const studio = new GameProjects(workspace, templates);
  assert.equal((await studio.catalog()).games.length, 1);
  assert.equal((await studio.staticFile('selected', 'cover.webp')).data.toString(), 'poster');
  await assert.rejects(studio.staticFile('selected', 'trailer/preview.mp4'), { code: 'ENOENT' });
  assert.equal(requests.length, 0);

  assert.equal((await studio.staticFile('selected', 'index.html')).data.toString(), '<p>Playable</p>');
  assert.equal((await studio.staticFile('selected', 'asset.bin')).data.toString(), 'snapshot asset payload');
  await assert.rejects(studio.staticFile('selected', 'trailer/preview.mp4'), { code: 'ENOENT' });
  assert.equal(requests.length, 2);

  const draft = await studio.remix('selected');
  assert.equal((await studio.staticFile(draft.game.id, 'asset.bin')).data.toString(), 'snapshot asset payload');
  assert.equal(requests.length, 2);
});
