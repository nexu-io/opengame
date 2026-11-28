import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { promisify } from 'node:util';
import { AssetLibrary } from '../gateway/asset-library.ts';
import type { LibraryAsset } from '../shared/asset-library.ts';
import { WorkspaceStore } from '../workspace.ts';

async function fixture(t: TestContext, count: number) {
  const directory = await mkdtemp(path.join(tmpdir(), 'asset-library-list-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const library = new AssetLibrary(new WorkspaceStore(directory));
  const records = path.join(library.root, 'records');
  await mkdir(records, { recursive: true });
  const assets: LibraryAsset[] = [];
  for (let i = 0; i < count; i++) {
    const id = randomUUID(), version = randomUUID();
    const asset: LibraryAsset = {
      id, name: `Asset ${String(i).padStart(4, '0')}`, modality: i % 2 ? 'image' : 'video',
      createdAt: i, updatedAt: i, currentVersionId: version,
      versions: [{ id: version, createdAt: i, source: 'upload', filename: 'media.png',
        bytes: 1, sha256: '0'.repeat(64), mimeType: 'image/png', references: [] }],
      ...(i % 5 === 0 ? { trashedAt: i + 1 } : {}),
    };
    assets.push(asset);
    await writeFile(path.join(records, `${id}.json`), JSON.stringify(asset));
  }
  return { directory, library, records, assets };
}

test('a large asset library lists under a normal constrained descriptor budget', { skip: process.platform !== 'linux' }, async t => {
  const { directory, assets } = await fixture(t, 600);
  // The subprocess owns this limit; the test runner and other tests are unaffected.
  const imports: string[] = [];
  for (let i = 0; i < process.execArgv.length; i++) {
    if (process.execArgv[i] === '--import') imports.push(process.execArgv[i], process.execArgv[++i]);
    else if (process.execArgv[i].startsWith('--import=')) imports.push(process.execArgv[i]);
  }
  const script = `
    import { AssetLibrary } from ${JSON.stringify(new URL('../gateway/asset-library.ts', import.meta.url).href)};
    import { WorkspaceStore } from ${JSON.stringify(new URL('../workspace.ts', import.meta.url).href)};
    const library = new AssetLibrary(new WorkspaceStore(process.argv[1]));
    console.log(JSON.stringify(await library.list({ sort: 'oldest', limit: 100 }, { includeUnfilteredTotal: true })));
  `;
  const { stdout } = await promisify(execFile)('/bin/bash', [
    '-c', 'ulimit -n 128; exec "$@"', 'asset-list-budget', process.execPath,
    '--experimental-strip-types', ...imports, '--input-type=module', '--eval', script, directory,
  ], { timeout: 30_000, maxBuffer: 1024 * 1024 });
  const result = JSON.parse(stdout);
  const visible = assets.filter(asset => !asset.trashedAt);
  assert.equal(result.total, visible.length);
  assert.equal(result.unfilteredTotal, visible.length);
  assert.equal(result.nextOffset, 100);
  assert.deepEqual(result.assets.map((asset: LibraryAsset) => asset.id), visible.slice(0, 100).map(asset => asset.id));
});

test('bounded listing retains filters, sorting, pagination, and trash totals', async t => {
  const { library, assets } = await fixture(t, 140);
  const expected = assets.filter(asset => asset.trashedAt && asset.modality === 'video').reverse();
  const result = await library.list({ trash: true, modality: 'video', sort: 'newest', offset: 3, limit: 4 }, { includeUnfilteredTotal: true });
  assert.deepEqual(result.assets.map(asset => asset.id), expected.slice(3, 7).map(asset => asset.id));
  assert.equal(result.total, expected.length);
  assert.equal(result.unfilteredTotal, assets.filter(asset => asset.trashedAt).length);
  assert.equal(result.nextOffset, 7);
  const named = await library.list({ query: 'Asset 0139', source: 'upload' });
  assert.equal(named.assets[0]?.id, assets[139].id);
});

test('listing still reports corrupt metadata instead of silently hiding records', async t => {
  const { library, records } = await fixture(t, 70);
  await writeFile(path.join(records, `${randomUUID()}.json`), '{');
  await assert.rejects(library.list(), SyntaxError);
});

test('an empty library still has an empty page and no next offset', async t => {
  const { library } = await fixture(t, 0);
  assert.deepEqual(await library.list(), { assets: [], total: 0, nextOffset: null });
});
