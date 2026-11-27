import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { wechatProjectIgnores } from '../gateway/wechat-project-files.ts';

const execFileAsync = promisify(execFile);

test('the pinned WeChat SDK excludes hidden files without pruning the public package', async t => {
  const projectPath = await mkdtemp(path.join(tmpdir(), 'wechat-package-files-'));
  t.after(() => rm(projectPath, { recursive: true, force: true }));
  const publicFiles = {
    'game.js': 'console.log("public game");',
    'game.json': '{}',
    'assets/visible.txt': 'public fixture',
    'assets.v1/visible.txt': 'public dotted directory',
    'assets/file.with.dots.txt': 'public dotted filename',
  };
  const excludedFiles = {
    '.env': 'SYNTHETIC_TEST_VALUE=not-a-credential',
    '.x': 'hidden file with a one-character name',
    '..secrets/token.txt': 'synthetic hidden directory',
    '.../token.txt': 'synthetic multiple-dot directory',
    '.hidden/config.json': '{"synthetic":true}',
    'assets/.private/token.txt': 'synthetic nested fixture',
    'assets/.nested/.inner/file.txt': 'synthetic deeper fixture',
    'node_modules/example/index.js': '// excluded dependency',
    'assets/node_modules/example/index.js': '// excluded nested dependency',
    'mock-probe.js': '// excluded mock',
    'port-report.json': '{"smokeTest":"passed"}',
  };
  for (const [relative, content] of Object.entries({ ...publicFiles, ...excludedFiles })) {
    const filename = path.join(projectPath, relative);
    await mkdir(path.dirname(filename), { recursive: true });
    await writeFile(filename, content);
  }

  // Use the installed SDK's real package inventory in an isolated process.
  // SDK initialization can retain workers; no compile, preview or upload API
  // is invoked, and even unexpected network access is rejected.
  const script = `
    const assert = require('node:assert/strict');
    const { createRequire } = require('node:module');
    const { statSync, writeSync } = require('node:fs');
    const path = require('node:path');
    const sdkRequire = createRequire(${JSON.stringify(new URL('../package.json', import.meta.url).href)});
    const denyNetwork = () => { throw Error('Unexpected network access in offline package inventory'); };
    for (const name of ['node:http', 'node:https']) {
      const module = require(name);
      module.request = denyNetwork;
      module.get = denyNetwork;
    }
    require('node:net').Socket.prototype.connect = denyNetwork;
    globalThis.fetch = denyNetwork;
    const version = sdkRequire('miniprogram-ci/package.json').version;
    assert.equal(version, sdkRequire('./package.json').dependencies['miniprogram-ci']);
    const ci = sdkRequire('miniprogram-ci');
    const projectPath = ${JSON.stringify(projectPath)};
    const project = new ci.Project({
      appid: 'wx0123456789abcdef', type: 'miniGame', projectPath,
      privateKey: 'synthetic-offline-test-no-signing-key', ignores: ${JSON.stringify(wechatProjectIgnores)},
    });
    const files = project.getFileList('', '').sort();
    const totalBytes = files.reduce((sum, file) => sum + statSync(path.join(projectPath, file)).size, 0);
    writeSync(1, JSON.stringify({ files, totalBytes, version }));
    process.exit(0);
  `;
  const result = await execFileAsync(process.execPath, ['--input-type=commonjs', '--eval', script], { timeout: 20_000 });
  const inventory = JSON.parse(result.stdout);
  assert.deepEqual(inventory.files, Object.keys(publicFiles).sort());
  assert.equal(inventory.totalBytes, Object.values(publicFiles).reduce((sum, content) => sum + Buffer.byteLength(content), 0));
});
