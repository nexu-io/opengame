import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { HostedGameTemplates, defaultLfsBatchUrl } from '../shared/hosted-game-templates.ts';

for (const cacheState of ['valid', 'same-size corrupt', 'wrong-size', 'symlink', 'directory'] as const) {
  test(`LFS source hydration checks a ${cacheState} cached object`, async t => {
    const root = await mkdtemp(path.join(tmpdir(), 'opengame-cache-integrity-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const templates = path.join(root, 'checkout', 'templates', 'games');
    const installed = path.join(templates, 'demo');
    const cache = path.join(root, 'cache');
    const bytes = Buffer.from('verified game asset');
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const objectFile = path.join(cache, 'lfs-objects', sha256);
    await mkdir(installed, { recursive: true });
    await mkdir(path.dirname(objectFile), { recursive: true });
    await writeFile(path.join(templates, '.gitattributes'), '*.bin filter=lfs diff=lfs merge=lfs -text\n');
    await writeFile(path.join(installed, 'game.json'), JSON.stringify({ id: 'demo' }));
    await writeFile(path.join(installed, 'index.html'), '<p>Demo</p>');
    await writeFile(path.join(installed, 'asset.bin'), `version https://git-lfs.github.com/spec/v1\noid sha256:${sha256}\nsize ${bytes.length}\n`);
    const outside = path.join(root, 'outside.bin');
    if (cacheState === 'symlink') {
      await writeFile(outside, bytes);
      try { await symlink(outside, objectFile); }
      catch (error) {
        if (process.platform === 'win32' && ['EPERM', 'EACCES'].includes((error as NodeJS.ErrnoException).code ?? '')) {
          t.skip('Creating symlinks is unavailable');
          return;
        }
        throw error;
      }
    } else if (cacheState === 'directory') await mkdir(objectFile);
    else await writeFile(objectFile, cacheState === 'valid' ? bytes : Buffer.alloc(cacheState === 'wrong-size' ? bytes.length - 1 : bytes.length));
    const requests: string[] = [];
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input);
      requests.push(url);
      assert.notEqual(cacheState, 'valid', 'a verified cached object must not need network access');
      if (url === defaultLfsBatchUrl) {
        assert.equal(init?.method, 'POST');
        return Response.json({ objects: [{ oid: sha256, size: bytes.length, actions: { download: { href: 'https://example.test/object' } } }] });
      }
      assert.equal(url, 'https://example.test/object');
      return new Response(new Uint8Array(bytes));
    };
    const hosted = new HostedGameTemplates(path.join(templates, '../game-downloads.json'), cache, { fetcher });
    if (cacheState === 'directory') {
      await assert.rejects(hosted.directory('demo', installed), /Could not fetch demo/);
      assert((await lstat(objectFile)).isDirectory());
      return;
    }
    const hydrated = await hosted.directory('demo', installed);
    assert.deepEqual(await readFile(path.join(hydrated, 'asset.bin')), bytes);
    assert.deepEqual(await readFile(objectFile), bytes);
    assert.equal(requests.length, cacheState === 'valid' ? 0 : 2);
    assert((await lstat(objectFile)).isFile());
    if (cacheState === 'symlink') assert.deepEqual(await readFile(outside), bytes);
  });
}
