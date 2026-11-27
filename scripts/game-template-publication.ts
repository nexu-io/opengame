import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, mkdir, mkdtemp, lstat, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { isMain } from '../shared/entry.ts';
import { isListedGameTemplate } from '../shared/game-contract.ts';
import { gameBundlePrefix, gameBundleUrl, maxGameBundleBytes, type GameBundle, type GameDownloadIndex } from '../shared/hosted-game-templates.ts';
import { readProjectZip } from '../shared/project-zip.ts';
import { boundedMediaBody, downloadVerifiedBytes, mediaDigest } from '../shared/repository-media.ts';
import { writeAtomic, writeJSON } from './runtime-assets.mjs';
import { zip } from './zip.mjs';

export const offlineGame = 'tidebreaker';
const run = promisify(execFile);
const lfsHeader = 'version https://git-lfs.github.com/spec/v1';

export type BuildGameTemplateBundlesOptions = {
  indexPath?: string;
  verifyHosted?: (lock: GameBundle, id: string) => Promise<void>;
};

export async function readGameDownloadIndex(indexPath: string): Promise<Record<string, GameBundle>> {
  let text: string;
  try { text = await readFile(indexPath, 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return Object.create(null); throw error; }
  const parsed = JSON.parse(text) as GameDownloadIndex;
  assert(parsed.schemaVersion === 1 && parsed.games && typeof parsed.games === 'object' && !Array.isArray(parsed.games), `Invalid game download index: ${indexPath}`);
  const games: Record<string, GameBundle> = Object.create(null);
  for (const [id, lock] of Object.entries(parsed.games)) {
    assert(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,100}$/.test(id), `Invalid hosted game id: ${id}`);
    assert(id !== offlineGame, `Offline starter game must stay in-repo and out of game-downloads.json: ${id}`);
    assert(lock && typeof lock === 'object' && typeof lock.sha256 === 'string' && /^[a-f0-9]{64}$/.test(lock.sha256), `Invalid sha256 for hosted game: ${id}`);
    assert(Number.isSafeInteger(lock.bytes) && lock.bytes > 0 && lock.bytes <= maxGameBundleBytes, `Invalid byte length for hosted game: ${id}`);
    games[id] = { sha256: lock.sha256, bytes: lock.bytes };
  }
  return games;
}

async function fileExists(target: string): Promise<boolean> {
  return access(target).then(() => true, error => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  });
}

async function assertCardOnlyTemplate(root: string, id: string) {
  const dir = path.join(root, id);
  const cardData = await readFile(path.join(dir, 'game.json'));
  assert(!cardData.subarray(0, 45).toString().startsWith(lfsHeader), `Missing LFS bytes: ${id}/game.json`);
  const card = JSON.parse(cardData.toString('utf8'));
  assert(card?.id === id, `Invalid template card: ${id}`);
  if (card.cover && !/^(?:[a-z]+:|\/)/i.test(card.cover)) {
    const coverPath = path.join(dir, card.cover);
    const coverStat = await lstat(coverPath);
    assert(coverStat.isFile(), `Missing cover for ${id}`);
    const coverData = await readFile(coverPath);
    assert(!coverData.subarray(0, 45).toString().startsWith(lfsHeader), `Cover must not be an LFS pointer: ${id}/${card.cover}`);
  }
}

async function mapConcurrent<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>) {
  let cursor = 0;
  async function next() {
    while (cursor < items.length) {
      const index = cursor++;
      await worker(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => next()));
}

export type GameTemplatePlan = {
  entries: string[];
  sourceIds: string[];
  hostedIds: string[];
  hosted: Record<string, GameBundle>;
};

export async function planGameTemplates(
  root: string,
  indexPath = path.join(root, '..', 'game-downloads.json'),
): Promise<GameTemplatePlan> {
  const hosted = await readGameDownloadIndex(indexPath);
  const entries = (await readdir(root)).filter(id => !id.startsWith('.')).sort();
  const entrySet = new Set(entries);
  const sourceIds: string[] = [];
  const hostedIds: string[] = [];
  for (const id of Object.keys(hosted)) {
    assert(entrySet.has(id), `Orphan entry in game-downloads.json without templates/games/${id}: ${id}`);
  }
  for (const id of entries) {
    assert(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,100}$/.test(id), `Invalid game template id: ${id}`);
    const dir = path.join(root, id);
    assert((await lstat(dir)).isDirectory(), `Expected directory for game template: ${id}`);
    const hasIndex = await fileExists(path.join(dir, 'index.html'));
    if (id === offlineGame) {
      assert(hasIndex, `Offline starter game must have local index.html: ${id}`);
      assert(!Object.hasOwn(hosted, id), `Offline starter game must not be listed in game-downloads.json: ${id}`);
      sourceIds.push(id);
      continue;
    }
    if (hasIndex) {
      assert(!Object.hasOwn(hosted, id), `In-repo game with index.html must not be shadowed by game-downloads.json: ${id}`);
      sourceIds.push(id);
    } else {
      assert(Object.hasOwn(hosted, id), `Card-only game template is missing from game-downloads.json: ${id}`);
      await assertCardOnlyTemplate(root, id);
      hostedIds.push(id);
    }
  }
  return { entries, sourceIds, hostedIds, hosted };
}

export async function checkGameDownloadIndex(root: string, indexPath = path.join(root, '..', 'game-downloads.json')) {
  return planGameTemplates(root, indexPath);
}

export async function buildGameTemplateBundles(
  root: string,
  publish?: (lock: GameBundle, bytes: Buffer) => Promise<void>,
  options: BuildGameTemplateBundlesOptions = {},
) {
  const indexPath = options.indexPath ?? path.join(root, '..', 'game-downloads.json');
  const { entries, hostedIds, hosted } = await planGameTemplates(root, indexPath);
  const hostedSet = new Set(hostedIds);
  const games: Record<string, GameBundle> = Object.create(null);
  const hostedToVerify: [string, GameBundle][] = [];
  for (const id of entries) {
    if (id === offlineGame) continue;
    if (hostedSet.has(id)) {
      const lock = hosted[id];
      games[id] = lock;
      if (options.verifyHosted) hostedToVerify.push([id, lock]);
      continue;
    }
    const dir = path.join(root, id);
    const fileEntries: { name: string; data: Buffer }[] = [];
    let total = 0;
    async function collect(prefix: string) {
      for (const name of (await readdir(path.join(dir, prefix))).sort()) {
        // Hidden paths and local publish records do not belong in a downloadable game.
        if (name.startsWith('.') || (!prefix && /^(publish|trailer)$/i.test(name))) continue;
        const relative = prefix + name, filename = path.join(dir, relative), stat = await lstat(filename);
        if (stat.isDirectory()) { await collect(relative + '/'); continue; }
        total += stat.size;
        assert(stat.isFile() && total <= maxGameBundleBytes && fileEntries.length < 5000, `Invalid game template source: ${id}/${relative}`);
        const data = await readFile(filename);
        assert(!data.subarray(0, 45).toString().startsWith(lfsHeader), `Missing LFS bytes: ${id}/${relative}`);
        fileEntries.push({ name: relative, data });
      }
    }
    await collect('');
    const archive = zip(fileEntries, { deflate: true });
    assert(archive.length <= maxGameBundleBytes);
    const files = readProjectZip(archive);
    const card = JSON.parse(files.get('game.json')?.toString() ?? 'null');
    assert(card?.id === id && files.has('index.html'), `Invalid template: ${id}`);
    if (card.cover && !/^(?:[a-z]+:|\/)/i.test(card.cover)) assert(files.has(card.cover), `Missing cover for ${id}`);
    const lock = { sha256: mediaDigest(archive), bytes: archive.length };
    games[id] = lock;
    await publish?.(lock, archive);
  }
  if (hostedToVerify.length && options.verifyHosted) {
    await mapConcurrent(hostedToVerify, 8, async ([id, lock]) => {
      await options.verifyHosted!(lock, id);
    });
  }
  return games;
}

function verifiedHostedGame(id: string, lock: GameBundle, archive: Buffer) {
  assert(archive.length === lock.bytes && mediaDigest(archive) === lock.sha256, `Game bundle integrity check failed: ${id}`);
  const files = readProjectZip(archive);
  assert(JSON.parse(files.get('game.json')?.toString() ?? 'null')?.id === id && files.has('index.html'), `Invalid game bundle: ${id}`);
  return files;
}

const gameIndexDigest = (games: Record<string, GameBundle>) => mediaDigest(Buffer.from(JSON.stringify(games)));

/** Prepare smaller immutable bundles and a candidate index before changing the live index. */
export async function stageOptimizedGameBundles(
  indexPath: string,
  output: string,
  readArchive: (id: string, lock: GameBundle) => Promise<Buffer> = (_id, lock) =>
    downloadVerifiedBytes(gameBundleUrl(lock.sha256), { ...lock, credentials: 'omit' }),
) {
  const original = await readGameDownloadIndex(indexPath);
  const games = { ...original };
  const objects = path.join(output, 'objects');
  await mkdir(objects, { recursive: true });
  let updated = 0, savedBytes = 0;
  await mapConcurrent(Object.entries(original).filter(([id]) => isListedGameTemplate(id)), 4, async ([id, lock]) => {
    const files = verifiedHostedGame(id, lock, await readArchive(id, lock));
    const packed = zip(Array.from(files, ([name, data]) => ({ name, data })), { deflate: true });
    if (packed.length >= lock.bytes) return;
    assert.deepEqual(readProjectZip(packed), files, `Optimized game bundle changed files: ${id}`);
    const optimized = { sha256: mediaDigest(packed), bytes: packed.length };
    await writeAtomic(path.join(objects, optimized.sha256 + '.zip'), packed);
    games[id] = optimized;
    updated++;
    savedBytes += lock.bytes - packed.length;
  });
  await writeJSON(path.join(output, 'game-downloads.json'), { schemaVersion: 1, games });
  await writeJSON(path.join(output, 'optimization.json'), {
    source: gameIndexDigest(original),
    candidate: gameIndexDigest(games),
  });
  return { updated, savedBytes };
}

async function publishStagedGameBundles(indexPath: string, directory: string) {
  const current = await readGameDownloadIndex(indexPath);
  const staged = await readGameDownloadIndex(path.join(directory, 'game-downloads.json'));
  const plan = JSON.parse(await readFile(path.join(directory, 'optimization.json'), 'utf8'));
  assert.equal(plan.source, gameIndexDigest(current), 'Staged optimization was built for a different game index');
  assert.equal(plan.candidate, gameIndexDigest(staged), 'Staged index changed after compression');
  assert.deepEqual(Object.keys(staged).sort(), Object.keys(current).sort(), 'Staged game index does not match the current catalogue');
  const changes = Object.entries(staged).filter(([id, lock]) => lock.sha256 !== current[id].sha256);
  await mapConcurrent(changes, 4, async ([id, lock]) => {
    assert(isListedGameTemplate(id) && lock.bytes < current[id].bytes, `Invalid staged optimization: ${id}`);
    const archive = await readFile(path.join(directory, 'objects', lock.sha256 + '.zip'));
    verifiedHostedGame(id, lock, archive);
    await publish(lock, archive);
  });
  return changes.length;
}

/** Upload immutable objects only. Each npm package carries its own small download index. */
async function publish(lock: GameBundle, bytes: Buffer) {
  const url = gameBundleUrl(lock.sha256);
  const response = await fetch(url, { method: 'HEAD', redirect: 'error', signal: AbortSignal.timeout(30000) });
  if (response.status === 404) {
    const dir = await mkdtemp(path.join(tmpdir(), 'opengame-upload-'));
    try {
      const file = path.join(dir, 'template.zip'); await writeFile(file, bytes);
      const endpoint = new URL(process.env.MOTION_R2_ENDPOINT ?? ''), bucket = process.env.MOTION_R2_BUCKET ?? '';
      assert(endpoint.protocol === 'https:' && endpoint.hostname.endsWith('.r2.cloudflarestorage.com') && endpoint.href === endpoint.origin + '/');
      assert(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket));
      await run('aws', ['--endpoint-url', endpoint.origin, '--region', 'auto', 's3api', 'put-object', '--bucket', bucket,
        '--key', `${gameBundlePrefix}${lock.sha256}.zip`, '--body', file, '--if-none-match', '*', '--content-type', 'application/zip',
        '--cache-control', 'public, max-age=31536000, immutable']).catch(error => { if (!/PreconditionFailed|\(412\)/.test(error.stderr ?? '')) throw error; });
    } finally { await rm(dir, { recursive: true, force: true }); }
  } else assert.equal(response.status, 200, `Game CDN lookup failed: ${url}`);
  await verifyPublicGame(lock);
}

async function verifyPublicGame(lock: GameBundle) {
  const url = gameBundleUrl(lock.sha256);
  assert(Number.isSafeInteger(lock.bytes) && lock.bytes > 0 && lock.bytes <= maxGameBundleBytes);
  const stored = await boundedMediaBody(await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(120000) }), lock.bytes);
  assert.equal(mediaDigest(stored), lock.sha256, `Public game bundle verification failed: ${url}`);
}

async function verifyPublicGameHead(lock: GameBundle) {
  const url = gameBundleUrl(lock.sha256);
  assert(Number.isSafeInteger(lock.bytes) && lock.bytes > 0 && lock.bytes <= maxGameBundleBytes);
  const response = await fetch(url, { method: 'HEAD', redirect: 'error', signal: AbortSignal.timeout(30000) });
  assert.equal(response.status, 200, `Public game bundle missing: ${url}`);
  const len = response.headers.get('content-length');
  if (len !== null) assert.equal(Number(len), lock.bytes, `Public game bundle byte length mismatch: ${url}`);
}

if (isMain(import.meta.url)) {
  const indexPath = 'templates/game-downloads.json';
  if (process.argv[2] === '--verify-release') {
    const release = JSON.parse(await readFile(process.argv[3], 'utf8'));
    // Releases predating lazy download have no remote game dependencies.
    if (release.gameTemplates) {
      assert(release.gameTemplates.schemaVersion === 1 && release.gameTemplates.games);
      await mapConcurrent(Object.values(release.gameTemplates.games) as GameBundle[], 8, verifyPublicGame);
    }
  } else if (process.argv[2] === '--check-index') {
    const summary = await checkGameDownloadIndex('templates/games');
    console.log(`Checked game template index: ${summary.sourceIds.length} in-repo, ${summary.hostedIds.length} R2-hosted`);
  } else if (process.argv[2] === '--verify-index') {
    const full = process.argv.includes('--full');
    const summary = await checkGameDownloadIndex('templates/games');
    await mapConcurrent(Object.values(summary.hosted), 8, full ? verifyPublicGame : verifyPublicGameHead);
    console.log(`Verified ${summary.hostedIds.length} R2-hosted game bundles (${full ? 'full SHA-256' : 'HEAD + length'})`);
  } else if (process.argv[2] === '--stage-optimized') {
    assert(process.argv[3], 'Pass an output directory to --stage-optimized');
    const result = await stageOptimizedGameBundles(indexPath, process.argv[3]);
    console.log(`Staged ${result.updated} smaller bundles, saving ${result.savedBytes} bytes`);
  } else if (process.argv[2] === '--publish-staged') {
    assert(process.argv[3], 'Pass a staging directory to --publish-staged');
    const count = await publishStagedGameBundles(indexPath, process.argv[3]);
    console.log(`Verified ${count} staged bundles on the CDN. The staged index is ready to adopt.`);
  } else {
    assert(process.argv[2] === '--publish', 'Pass --publish, --check-index, --verify-index, --verify-release <manifest>, --stage-optimized <directory>, or --publish-staged <directory>');
    const locks = await buildGameTemplateBundles('templates/games', publish, { verifyHosted: verifyPublicGame });
    console.log(`Verified ${Object.keys(locks).length} immutable game bundles`);
  }
}
