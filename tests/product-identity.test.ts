import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import {
  attributedEntryId,
  attributedEntryIdFor,
  currentProductId,
  parseGitConfigRemoteUrls,
  PRODUCT_ID,
  PRODUCT_UTM_SOURCE,
  productIdFromRepositoryRef,
  resolveNodeProductId,
} from '../shared/product-identity.ts';
import { clearEditorStaticCache, injectRuntimeProduct, serveEditorFile } from '../editor-server.ts';

const uuid = '7d1c6f4e-6a1f-4c55-9a43-0c7a4a0a8f11';

test('the resolved runtime product decides the payment entry ID and UTM source', () => {
  const resolved = resolveNodeProductId();
  assert.ok(PRODUCT_ID === 'openmotion' || PRODUCT_ID === 'opengame');
  assert.equal(PRODUCT_ID, resolved);
  assert.equal(PRODUCT_UTM_SOURCE, PRODUCT_ID);
  assert.equal(attributedEntryId(uuid), attributedEntryIdFor(PRODUCT_ID, uuid));
});

for (const [product, expected] of [
  ['openmotion', uuid],
  ['opengame', `opengame-${uuid}`],
] as const) {
  test(`${product} formats the payment entry ID without changing the original UUID`, () => {
    assert.equal(attributedEntryIdFor(product, uuid), expected);
  });
}

test('productIdFromRepositoryRef classifies HTTPS, SSH, slug, and AGI-prefixed repository references', () => {
  assert.equal(productIdFromRepositoryRef('nexu-io/opengame'), 'opengame');
  assert.equal(productIdFromRepositoryRef('https://github.com/nexu-io/opengame.git'), 'opengame');
  assert.equal(productIdFromRepositoryRef('git@github.com:nexu-io/AGI-OpenGame.git'), 'opengame');
  assert.equal(productIdFromRepositoryRef('nexu-io/openmotion'), 'openmotion');
  assert.equal(productIdFromRepositoryRef('https://github.com/nexu-io/openmotion.git'), 'openmotion');
  assert.equal(productIdFromRepositoryRef('git@github.com:nexu-io/AGI-OpenMotion/'), 'openmotion');
  assert.equal(productIdFromRepositoryRef('https://github.com/someone/unrelated-repo.git'), undefined);
  assert.equal(productIdFromRepositoryRef(''), undefined);
});

test('resolveNodeProductId follows strict priority across env, build-info, GITHUB_REPOSITORY, .git, worktrees, and fallback', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'om-product-identity-'));
  try {
    // 1. Standard checkout with .git/config (origin wins; upstream is fallback)
    const repoDir = path.join(tempRoot, 'standard-repo');
    await mkdir(path.join(repoDir, '.git'), { recursive: true });
    await writeFile(path.join(repoDir, '.git', 'config'), [
      '[core]',
      '\trepositoryformatversion = 0',
      '[remote "origin"]',
      '\turl = https://github.com/nexu-io/opengame.git',
      '[remote "upstream"]',
      '\turl = https://github.com/nexu-io/openmotion.git',
    ].join('\n'));
    assert.deepEqual(parseGitConfigRemoteUrls(
      '[remote "origin"]\n  url = git@github.com:nexu-io/opengame.git\n[remote "upstream"]\n  url = https://github.com/nexu-io/openmotion.git\n',
    ), {
      origin: 'git@github.com:nexu-io/opengame.git',
      upstream: 'https://github.com/nexu-io/openmotion.git',
    });
    assert.equal(resolveNodeProductId({ rootDir: repoDir, env: {} }), 'opengame');

    // 2. GITHUB_REPOSITORY beats .git/config when build-info has no product
    assert.equal(
      resolveNodeProductId({ rootDir: repoDir, env: { GITHUB_REPOSITORY: 'nexu-io/openmotion' } }),
      'openmotion',
    );

    // 3. shared/build-info.json product beats GITHUB_REPOSITORY and .git/config
    await mkdir(path.join(repoDir, 'shared'), { recursive: true });
    await writeFile(path.join(repoDir, 'shared', 'build-info.json'), JSON.stringify({ commit: null, product: 'opengame' }));
    assert.equal(
      resolveNodeProductId({ rootDir: repoDir, env: { GITHUB_REPOSITORY: 'nexu-io/openmotion' } }),
      'opengame',
    );

    // 4. OPENMOTION_PRODUCT env beats build-info, GITHUB_REPOSITORY, and .git/config
    assert.equal(
      resolveNodeProductId({
        rootDir: repoDir,
        env: { OPENMOTION_PRODUCT: 'openmotion', GITHUB_REPOSITORY: 'nexu-io/opengame' },
      }),
      'openmotion',
    );

    // 5. Git worktree (.git file -> gitdir -> commondir/config) resolves cleanly
    const bareCommon = path.join(tempRoot, 'worktree-host', '.git');
    const worktreeMeta = path.join(bareCommon, 'worktrees', 'feat-branch');
    const worktreeDir = path.join(tempRoot, 'worktree-checkout');
    await mkdir(worktreeMeta, { recursive: true });
    await mkdir(worktreeDir, { recursive: true });
    await writeFile(path.join(bareCommon, 'config'), '[remote "origin"]\n\turl = git@github.com:nexu-io/opengame.git\n');
    await writeFile(path.join(worktreeMeta, 'commondir'), '../..\n');
    await writeFile(path.join(worktreeDir, '.git'), `gitdir: ${worktreeMeta}\n`);
    assert.equal(resolveNodeProductId({ rootDir: worktreeDir, env: {} }), 'opengame');

    // 6. Upstream fallback when origin is an unrelated fork name
    const forkDir = path.join(tempRoot, 'fork-repo');
    await mkdir(path.join(forkDir, '.git'), { recursive: true });
    await writeFile(path.join(forkDir, '.git', 'config'), [
      '[remote "origin"]',
      '\turl = https://github.com/alice/my-custom-fork.git',
      '[remote "upstream"]',
      '\turl = https://github.com/nexu-io/opengame.git',
    ].join('\n'));
    assert.equal(resolveNodeProductId({ rootDir: forkDir, env: {} }), 'opengame');

    // 7. Empty directory with no signals falls back safely to 'openmotion'
    const emptyDir = path.join(tempRoot, 'empty');
    await mkdir(emptyDir, { recursive: true });
    assert.equal(resolveNodeProductId({ rootDir: emptyDir, env: {} }), 'openmotion');
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('currentProductId honors dynamic OPENMOTION_PRODUCT overrides and injectRuntimeProduct scopes Studio HTML and ETag', async () => {
  const injected = injectRuntimeProduct('<!doctype html><html><head><title>Studio</title></head><body></body></html>', 'opengame');
  assert.ok(injected.includes('<head><script>window.__OM_SOURCE_PRODUCT__="opengame";</script><title>Studio</title>'));

  const previousEnv = process.env.OPENMOTION_PRODUCT;
  try {
    process.env.OPENMOTION_PRODUCT = 'openmotion';
    assert.equal(currentProductId(), 'openmotion');
    assert.equal(attributedEntryId(uuid), uuid);

    process.env.OPENMOTION_PRODUCT = 'opengame';
    assert.equal(currentProductId(), 'opengame');
    assert.equal(attributedEntryId(uuid), `opengame-${uuid}`);

    if (existsSync(path.resolve('studio/build/index.html'))) {
      clearEditorStaticCache();
      const server = http.createServer(async (req, res) => {
        const handled = await serveEditorFile(new URL(req.url ?? '/', 'http://127.0.0.1'), res, req);
        if (!handled) { res.writeHead(404); res.end('Not found'); }
      });
      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
      const address = server.address();
      assert.ok(address && typeof address !== 'string');
      const fetchHtml = (acceptEncoding?: string) => new Promise<{ status: number; etag?: string; html: string }>((resolve, reject) => {
        const req = http.get(
          { host: '127.0.0.1', port: address.port, path: '/', headers: acceptEncoding ? { 'Accept-Encoding': acceptEncoding } : {} },
          res => {
            const chunks: Buffer[] = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => {
              const raw = Buffer.concat(chunks);
              const body = res.headers['content-encoding'] === 'gzip' ? gunzipSync(raw) : raw;
              resolve({ status: res.statusCode ?? 0, etag: String(res.headers.etag ?? ''), html: body.toString('utf8') });
            });
          },
        );
        req.on('error', reject);
      });
      try {
        process.env.OPENMOTION_PRODUCT = 'opengame';
        const gameRes = await fetchHtml('gzip');
        assert.equal(gameRes.status, 200);
        assert.ok(gameRes.html.includes('window.__OM_SOURCE_PRODUCT__="opengame";'));

        process.env.OPENMOTION_PRODUCT = 'openmotion';
        const motionRes = await fetchHtml('gzip');
        assert.equal(motionRes.status, 200);
        assert.ok(motionRes.html.includes('window.__OM_SOURCE_PRODUCT__="openmotion";'));
        assert.notEqual(gameRes.etag, motionRes.etag);
      } finally {
        await new Promise<void>(resolve => server.close(() => resolve()));
      }
    }
  } finally {
    if (previousEnv === undefined) delete process.env.OPENMOTION_PRODUCT;
    else process.env.OPENMOTION_PRODUCT = previousEnv;
  }
});
