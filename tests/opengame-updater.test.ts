import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir, uptime } from 'node:os';
import path from 'node:path';
import { packageOpenGame } from '../scripts/package-opengame.mjs';
import { setup, diagnose, callInstalled, update } from '../scripts/opengame-launcher.mjs';
import {
  applyStagedUpdate,
  checkNpmUpdate,
  compareSemver,
  readInstallState,
  retireIdleBackend,
  rollbackInstallation,
  stageNpmUpdate,
  withInstallLock,
} from '../scripts/opengame-updater.mjs';
import { runFile, writeJSON } from '../scripts/runtime-assets.mjs';
import { configureNativeEnvironment, nativeConfiguration, nativeRuntimeStatus } from '../scripts/npm-runtime.mjs';
import { startServer } from '../server.ts';
import { WorkspaceStore } from '../workspace.ts';

import { offlineGame } from '../scripts/game-template-publication.ts';

const gameToolSet = new Set<string>(JSON.parse(await readFile(new URL('../shared/mcp-profiles.json', import.meta.url), 'utf8')).game.tools);

async function allocateFreePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = (probe.address() as { port: number }).port;
  await new Promise<void>(resolve => probe.close(() => resolve()));
  return port;
}

async function listMarkdownFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await listMarkdownFiles(full));
    else if (entry.isFile() && entry.name.endsWith('.md')) out.push(full);
  }
  return out;
}

const repoNodeModules = path.resolve('node_modules');
const tinyPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==', 'base64');
async function createGamesFixture(baseDir: string) {
  const gamesDir = path.join(baseDir, 'games-fixture');
  await mkdir(gamesDir, { recursive: true });
  await cp(path.resolve('templates/games', offlineGame), path.join(gamesDir, offlineGame), { recursive: true });
  const lazyDir = path.join(gamesDir, 'sky-dodger');
  await mkdir(path.join(lazyDir, 'assets'), { recursive: true });
  await writeFile(path.join(lazyDir, 'game.json'), JSON.stringify({
    id: 'sky-dodger', title: 'Sky Dodger', description: 'Lazy-downloaded fixture game',
    genre: 'shooter', style: 'pixel', setting: 'space', cover: 'assets/cover.png', status: 'published',
  }, null, 2));
  await writeFile(path.join(lazyDir, 'index.html'), '<!doctype html><title>Sky Dodger</title>');
  await writeFile(path.join(lazyDir, 'assets/cover.png'), tinyPng);
  return gamesDir;
}
const linkDeps = async (directory: string) => {
  await symlink(repoNodeModules, path.join(directory, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
};

async function sriSha512(file: string) {
  const bytes = await readFile(file);
  return 'sha512-' + createHash('sha512').update(bytes).digest('base64');
}

function withEnv(overrides: Record<string, string | undefined>, fn: () => Promise<void>) {
  const saved: Record<string, string | undefined> = {};
  for (const key of Object.keys(overrides)) {
    saved[key] = process.env[key];
    if (overrides[key] === undefined) delete process.env[key];
    else process.env[key] = overrides[key];
  }
  return fn().finally(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

test('compareSemver orders stable and prerelease versions accurately', () => {
  assert.equal(compareSemver('0.1.0', '0.1.0'), 0);
  assert.equal(compareSemver('0.1.1', '0.1.0'), 1);
  assert.equal(compareSemver('0.1.0-test.2.1', '0.1.0-test.1.1'), 1);
  assert.equal(compareSemver('0.1.0', '0.1.0-test.9.1'), 1);
  assert.equal(compareSemver('0.2.0-test.1.1', '0.1.9'), 1);
});

test('OpenGame setup isolates hosts and coexists with OpenMotion, then updates, defers on busy backend, and auto-rolls back crash loops', { timeout: 240_000 }, async t => {
  const dir = await realpath(await mkdtemp(path.join(tmpdir(), 'opengame-e2e-')));
  t.after(() => rm(dir, { recursive: true, force: true }));

  const gamesRoot = await createGamesFixture(dir);
  const v1 = '0.1.0-test.1.1';
  const v2 = '0.1.1-test.2.1';
  const [pkg1, pkg2] = await Promise.all([
    packageOpenGame(path.join(dir, 'dist-v1'), v1, undefined, { gamesRoot }),
    packageOpenGame(path.join(dir, 'dist-v2'), v2, undefined, { gamesRoot }),
  ]);

  const home = path.join(dir, 'opengame-home');
  const dataDir = path.join(dir, 'opengame-data');
  const workbuddyDir = path.join(dir, 'workbuddy');
  const claudeDir = path.join(dir, 'claude');
  const dshHome = path.join(dir, 'dsh');
  const genericSkillsDir = path.join(dir, 'generic-skills');
  t.after(() => retireIdleBackend(dataDir).catch(() => {}));

  // Pre-seed existing OpenMotion config & skills to prove zero collision / coexistence.
  await mkdir(path.join(workbuddyDir, 'skills', 'openmotion-game'), { recursive: true });
  await writeJSON(path.join(workbuddyDir, 'mcp.json'), {
    mcpServers: { openmotion: { type: 'stdio', command: 'node', args: ['/existing/openmotion/run-mcp.mjs'] } },
  });
  await writeJSON(path.join(workbuddyDir, 'skills', 'openmotion-game', 'openmotion-install.json'), {
    managedBy: '@openmotion/installer', installHome: '/existing/openmotion', host: 'workbuddy',
  });
  await writeFile(path.join(workbuddyDir, 'skills', 'openmotion-game', 'SKILL.md'), '---\nname: openmotion-game\n---\nKeep untouched\n');

  // Fake DSH CLI that records plugin dependency into profile package.json.
  const fakeDsh = path.join(dir, 'fake-dsh.mjs');
  await writeFile(fakeDsh, `
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
const args = process.argv.slice(2);
const profile = args[args.indexOf('--profile') + 1];
const bundleDir = args[args.indexOf('add') + 1];
const file = path.join(process.env.DSH_HOME, 'profiles', profile, 'package.json');
await mkdir(path.dirname(file), { recursive: true });
let pkg = {};
try { pkg = JSON.parse(await readFile(file, 'utf8')); } catch {}
const bundlePkg = JSON.parse(await readFile(path.join(bundleDir, 'package.json'), 'utf8'));
pkg.dependencies = { ...(pkg.dependencies || {}), [bundlePkg.name]: 'file:' + bundleDir };
await writeFile(file, JSON.stringify(pkg, null, 2));
`);

  const isolatedPort = await allocateFreePort();
  await withEnv({ WORKBUDDY_CONFIG_DIR: workbuddyDir, CLAUDE_CONFIG_DIR: claudeDir, DSH_HOME: dshHome, PORT: String(isolatedPort) }, async () => {
    // 1. Setup WorkBuddy, DeepSeek Harness, and generic Agent (opencode) against v1.
    const wb = await setup({
      manifest: pkg1.manifest, home, dataDirectory: dataDir, host: 'workbuddy',
      installDeps: linkDeps, skipStudio: true, skipBackgroundPrepare: true,
    });
    assert.equal(wb.version, v1);
    assert.equal(wb.current.healthy, true);

    const wbConfig = JSON.parse(await readFile(path.join(workbuddyDir, 'mcp.json'), 'utf8'));
    assert.deepEqual(wbConfig.mcpServers.openmotion, { type: 'stdio', command: 'node', args: ['/existing/openmotion/run-mcp.mjs'] }, 'OpenMotion MCP entry must remain untouched');
    assert.equal(wbConfig.mcpServers.opengame.command, process.execPath);
    assert.deepEqual(wbConfig.mcpServers.opengame.args, [path.join(home, 'run-mcp.mjs')]);
    assert.deepEqual(wbConfig.mcpServers.opengame.env, { OPENMOTION_HOST_AGENT: 'workbuddy' }, 'WorkBuddy transport must tag OPENMOTION_HOST_AGENT for telemetry attribution');
    assert.equal(await readFile(path.join(workbuddyDir, 'skills', 'openmotion-game', 'SKILL.md'), 'utf8'), '---\nname: openmotion-game\n---\nKeep untouched\n');
    const ogSkill = await readFile(path.join(workbuddyDir, 'skills', 'opengame-game', 'SKILL.md'), 'utf8');
    assert.match(ogSkill, /^name: opengame-game$/m);
    assert.match(ogSkill, /opengame_create/);
    for (const skillDir of ['opengame-game', 'opengame-media']) {
      for (const mdFile of await listMarkdownFiles(path.join(workbuddyDir, 'skills', skillDir))) {
        const text = await readFile(mdFile, 'utf8');
        for (const match of text.matchAll(/\b(?:openmotion|motion|design|opengame)_[a-z_]+\b/g)) {
          assert(gameToolSet.has(match[0]), `Installed ${skillDir}/${path.basename(mdFile)} references unexposed tool ${match[0]}`);
        }
      }
    }

    const dshRes = await setup({
      manifest: pkg1.manifest, home, dataDirectory: dataDir, host: 'deepseek', profile: 'game-test', dsh: fakeDsh,
      installDeps: linkDeps, skipStudio: true, skipBackgroundPrepare: true,
    });
    assert.equal(dshRes.hostInstallation.bundleDirectory, path.join(home, 'hosts', 'deepseek'));
    assert.equal(existsSync(path.join(home, 'hosts', 'deepseek', 'skills', 'opengame-game', 'SKILL.md')), true);

    const generic = await setup({
      manifest: pkg1.manifest, home, dataDirectory: dataDir, host: 'opencode', skillsDirectory: genericSkillsDir,
      installDeps: linkDeps, skipStudio: true, skipBackgroundPrepare: true,
    });
    assert.equal(generic.agentRegistration?.serverName, 'opengame');
    assert.equal(existsSync(path.join(genericSkillsDir, 'opengame-game', 'SKILL.md')), true);

    // 2. Diagnose & directAccess call against live stdio MCP.
    const diag = await diagnose({ home, host: 'workbuddy' });
    assert.equal(diag.status, 'passed', JSON.stringify(diag));
    assert.equal(diag.serverInfo.name, 'opengame');
    assert.equal(diag.version, v1);
    assert.equal(diag.tools.length, 20);

    const listed = await callInstalled({ home, host: 'workbuddy' });
    assert.equal(listed.serverInfo.name, 'opengame');
    assert.equal(listed.tools.length, 20);

    // 3. Start local mock npm registries: primary returns 503, mirror serves valid v2 + corrupted v3.
    const v2Bytes = await readFile(pkg2.installer);
    const v2Integrity = await sriSha512(pkg2.installer);
    const failingPrimary = createServer((_req, res) => { res.writeHead(503); res.end('unavailable'); });
    const mirror = createServer((req, res) => {
      if (req.url === '/opengame/test') {
        const host = req.headers.host;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          name: 'opengame',
          version: v2,
          dist: { tarball: `http://${host}/tarballs/opengame-${v2}.tgz`, integrity: v2Integrity },
        }));
        return;
      }
      if (req.url === `/tarballs/opengame-${v2}.tgz`) {
        res.writeHead(200, { 'Content-Type': 'application/gzip' });
        res.end(v2Bytes);
        return;
      }
      res.writeHead(404); res.end('not found');
    });
    await Promise.all([
      new Promise<void>(resolve => failingPrimary.listen(0, '127.0.0.1', resolve)),
      new Promise<void>(resolve => mirror.listen(0, '127.0.0.1', resolve)),
    ]);
    t.after(() => { failingPrimary.close(); mirror.close(); });
    const primaryUrl = `http://127.0.0.1:${(failingPrimary.address() as any).port}`;
    const mirrorUrl = `http://127.0.0.1:${(mirror.address() as any).port}`;

    // 4. checkNpmUpdate falls back from primary (503) to mirror (200).
    const check = await checkNpmUpdate({
      packageName: 'opengame', channel: 'test', currentVersion: v1,
      registries: [primaryUrl, mirrorUrl],
    });
    assert.equal(check.available, true);
    assert.equal(check.version, v2);
    assert.equal(check.registry, mirrorUrl);

    // 5. Reject tampered integrity without modifying install.json.
    await assert.rejects(
      stageNpmUpdate({ home, target: { ...check, integrity: 'sha512-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==' }, installDeps: linkDeps }),
      /INTEGRITY_MISMATCH/,
    );
    assert.equal((await readInstallState(home)).staged, null);

    // 6. Reject a package that fails live MCP handshake probe & record it in badVersions.
    await assert.rejects(
      stageNpmUpdate({
        home,
        target: check,
        installDeps: linkDeps,
        probeTransport: () => { throw new Error('SYNTHETIC_BROKEN_MCP'); },
      }),
      /UPDATE_PROBE_FAILED/,
    );
    const afterFailedProbe = await readInstallState(home);
    assert.equal(afterFailedProbe.current.version, v1);
    assert.equal(afterFailedProbe.staged, null);
    assert(afterFailedProbe.badVersions.includes(v2));

    // Normal update and stageNpmUpdate without --force honor badVersions.
    const blockedUpdate = await update({ home, registries: [primaryUrl, mirrorUrl], installDeps: linkDeps });
    assert.equal(blockedUpdate.status, 'blocked_bad_version');
    const skippedStage = await stageNpmUpdate({ home, target: check, installDeps: linkDeps });
    assert.equal(skippedStage.status, 'skipped_bad_version');

    // 7. Force-stage retries the blacklisted v2, passes real live MCP handshake probe, clears v2 from badVersions,
    // and preserves a concurrent host registration made by setup() while staging is in flight.
    const concurrentSkillsDir = path.join(dir, 'cursor-skills');
    const staged = await stageNpmUpdate({
      home,
      target: check,
      force: true,
      installDeps: async directory => {
        await linkDeps(directory);
        await setup({
          manifest: pkg1.manifest, home, dataDirectory: dataDir, host: 'cursor', skillsDirectory: concurrentSkillsDir,
          installDeps: linkDeps, skipStudio: true, skipBackgroundPrepare: true,
        });
      },
    });
    assert.equal(staged.status, 'staged');
    assert.equal(staged.staged.version, v2);
    const afterStage = await readInstallState(home);
    assert.equal(afterStage.badVersions.includes(v2), false, 'Successful forced probe must remove version from badVersions');
    assert(Object.hasOwn(afterStage.hosts, 'cursor'), 'Concurrent setup host registration must survive stageNpmUpdate write');

    // 8. Retire any real shared editor started during diagnose, then test standalone busy deferral + idle retire.
    await retireIdleBackend(dataDir);
    let mockBusy = true;
    let retireCalled = false;
    const mockBackend = createServer((req, res) => {
      if (req.url === '/api/runtime/activity' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ service: 'motion-preview', version: v1, pid: process.pid, dataDirectory: dataDir, idle: !mockBusy, active: { exports: mockBusy ? 1 : 0, mediaJobs: 0, gameTrailers: 0, toolCalls: 0 } }));
        return;
      }
      if (req.url === '/api/runtime/retire' && req.method === 'POST') {
        if (mockBusy) { res.writeHead(409, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ retired: false, busy: true })); return; }
        retireCalled = true;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ retired: true, standalone: false }));
        return;
      }
      res.writeHead(404); res.end();
    });
    await new Promise<void>(resolve => mockBackend.listen(0, '127.0.0.1', resolve));
    t.after(() => mockBackend.close());
    await mkdir(dataDir, { recursive: true });
    await writeJSON(path.join(dataDir, 'preview.json'), { port: (mockBackend.address() as any).port, pid: process.pid, version: v1 });

    const deferred = await applyStagedUpdate({ home });
    assert.equal(deferred.applied, false);
    assert.equal(deferred.reason, 'backend_busy');
    assert.equal(retireCalled, false);
    assert.equal((await readInstallState(home)).current.version, v1);

    mockBusy = false;
    const applied = await applyStagedUpdate({ home });
    assert.equal(applied.applied, true);
    assert.equal(applied.version, v2);
    assert.equal(applied.previousVersion, v1);
    assert.equal(retireCalled, true);

    const activeV2 = await readInstallState(home);
    assert.equal(activeV2.current.version, v2);
    assert.equal(activeV2.current.healthy, false);
    assert.equal(activeV2.current.crashCount, 0);
    assert.equal(activeV2.previous.version, v1);
    assert.equal(activeV2.staged, null);
    // Verify Skills synced to v2 across WorkBuddy and DSH stable bundle.
    const wbSkillMeta = JSON.parse(await readFile(path.join(workbuddyDir, 'skills', 'opengame-game', 'opengame-install.json'), 'utf8'));
    assert.equal(wbSkillMeta.version, v2);
    const dshScope = JSON.parse(await readFile(path.join(home, 'hosts', 'deepseek', 'scope.json'), 'utf8'));
    assert.equal(dshScope.version, v2);

    // 9. Clean exit (code 0) on stdin EOF does NOT count as a crash.
    const initLine = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {} } }) + '\n';
    const cleanRun = spawnSync(process.execPath, [path.join(home, 'run-mcp.mjs')], {
      input: initLine,
      encoding: 'utf8',
      timeout: 20_000,
      env: { ...process.env, OPENMOTION_TELEMETRY: '0', OPENGAME_AUTO_UPDATE: '0', OPENGAME_HEALTHY_AFTER_MS: '60000' },
    });
    assert.equal(cleanRun.status, 0, cleanRun.stderr);
    const cleanReply = JSON.parse(cleanRun.stdout.trim());
    assert.equal(cleanReply.result.serverInfo.version, v2);
    assert.equal((await readInstallState(home)).current.crashCount, 0);

    // 10. Simulate crash loop in unverified v2 with an OPEN host stdin pipe (realistic MCP host behavior).
    const v2McpPath = path.join(activeV2.current.appRoot, 'mcp.ts');
    const origV2Mcp = await readFile(v2McpPath, 'utf8');
    await writeFile(v2McpPath, 'console.error("simulated broken update"); process.exit(1);\n');

    // 10a. Sustained live install.lock contention during crash path logs a skip instead of crashing the launcher with an uncaught throw.
    const installLockFile = path.join(home, 'install.lock');
    await writeFile(installLockFile, JSON.stringify({ pid: process.pid, token: 'held-live', createdAt: Date.now() }), { mode: 0o600 });
    try {
      const contendedCrash = await new Promise<{ code: number | null; stderr: string }>((resolve, reject) => {
        const child = spawn(process.execPath, [path.join(home, 'run-mcp.mjs')], {
          stdio: ['pipe', 'pipe', 'pipe'],
          env: { ...process.env, OPENMOTION_TELEMETRY: '0', OPENGAME_AUTO_UPDATE: '0', OPENGAME_MAX_CRASHES: '2', OPENGAME_INSTALL_LOCK_TIMEOUT_MS: '200' },
        });
        let stderr = '';
        child.stderr.on('data', chunk => { stderr += chunk; });
        child.stdin.write(initLine);
        const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('run-mcp.mjs hung under install.lock contention')); }, 10_000);
        child.once('close', code => { clearTimeout(timer); resolve({ code, stderr }); });
      });
      assert.equal(contendedCrash.code, 1, contendedCrash.stderr);
      assert.doesNotMatch(contendedCrash.stderr, /Unhandled|INSTALL_LOCK_BUSY|Another OpenGame operation/);
      const updateLog = await readFile(path.join(home, 'cache', 'update.log'), 'utf8');
      assert.match(updateLog, /crash recovery skipped:.*Another OpenGame operation/);
    } finally {
      await rm(installLockFile, { force: true });
    }

    // 10b. A stale install.lock left by an interrupted setup (dead PID) is reclaimed automatically so crash #1 records normally.
    await writeFile(installLockFile, '2147483647');

    // Crash #1 increments crashCount to 1 and exits promptly even while stdin stays open!
    const crash1 = await new Promise<{ code: number | null; signal: NodeJS.Signals | null; stderr: string }>((resolve, reject) => {
      const child = spawn(process.execPath, [path.join(home, 'run-mcp.mjs')], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, OPENMOTION_TELEMETRY: '0', OPENGAME_AUTO_UPDATE: '0', OPENGAME_MAX_CRASHES: '2' },
      });
      let stderr = '';
      child.stderr.on('data', chunk => { stderr += chunk; });
      child.stdin.write(initLine); // Intentionally keep stdin open!
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error('run-mcp.mjs hung instead of exiting when supervised server crashed with stdin open'));
      }, 10_000);
      child.once('close', (code, signal) => {
        clearTimeout(timer);
        resolve({ code, signal, stderr });
      });
    });
    assert.equal(crash1.code, 1, crash1.stderr);
    const afterCrash1 = await readInstallState(home);
    assert.equal(afterCrash1.current.version, v2);
    assert.equal(afterCrash1.current.crashCount, 1);

    // Crash #2 hits maxCrashes=2 with stdin kept open -> auto-rolls back to v1, records v2 in badVersions, restores Skills,
    // transparently replays buffered `initialize` on v1 over stdout, and exits 0 once host closes stdin!
    const crash2 = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
      const child = spawn(process.execPath, [path.join(home, 'run-mcp.mjs')], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, OPENMOTION_TELEMETRY: '0', OPENGAME_AUTO_UPDATE: '0', OPENGAME_MAX_CRASHES: '2' },
      });
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error(`Timed out waiting for rollback initialize reply: stdout=${stdout} stderr=${stderr}`));
      }, 20_000);
      child.stderr.on('data', chunk => { stderr += chunk; });
      child.stdout.on('data', chunk => {
        stdout += chunk;
        if (stdout.includes('\n')) child.stdin.end();
      });
      child.stdin.write(initLine);
      child.once('close', code => {
        clearTimeout(timer);
        resolve({ code, stdout, stderr });
      });
    });
    assert.equal(crash2.code, 0, crash2.stderr);
    const recoveredReply = JSON.parse(crash2.stdout.trim());
    assert.equal(recoveredReply.result.serverInfo.name, 'opengame');
    assert.equal(recoveredReply.result.serverInfo.version, v1);

    const rolledState = await readInstallState(home);
    assert.equal(rolledState.current.version, v1);
    assert.equal(rolledState.current.healthy, true);
    assert.equal(rolledState.previous, null);
    assert(rolledState.badVersions.includes(v2));
    assert.equal(rolledState.lastRollback.reason, 'crash_loop');
    const restoredSkillMeta = JSON.parse(await readFile(path.join(workbuddyDir, 'skills', 'opengame-game', 'opengame-install.json'), 'utf8'));
    assert.equal(restoredSkillMeta.version, v1);

    // 11. Verify `opengame update --force` recovers the blacklisted v2 end-to-end AND can reinstall the active version.
    await writeFile(v2McpPath, origV2Mcp);
    const forcedRecovery = await update({ home, force: true, registries: [primaryUrl, mirrorUrl], installDeps: linkDeps });
    assert.equal(forcedRecovery.status, 'updated');
    assert.equal(forcedRecovery.currentVersion, v2);
    const recoveredState = await readInstallState(home);
    assert.equal(recoveredState.current.version, v2);
    assert.equal(recoveredState.badVersions.includes(v2), false);
    assert.equal(recoveredState.previous.version, v1);

    // Force-reinstalling the currently active version extracts a fresh copy without returning already_current and preserves previous=v1.
    const forcedReinstall = await update({ home, force: true, registries: [primaryUrl, mirrorUrl], installDeps: linkDeps });
    assert.equal(forcedReinstall.status, 'updated');
    assert.equal(forcedReinstall.currentVersion, v2);
    const reinstalledState = await readInstallState(home);
    assert.equal(reinstalledState.current.version, v2);
    assert.notEqual(reinstalledState.current.appRoot, recoveredState.current.appRoot);
    assert.equal(reinstalledState.previous.version, v1);

    // 12. Verify healthy promotion + pruning of obsolete versions + manual rollback.
    await mkdir(path.join(home, 'apps', '0.0.1-obsolete'), { recursive: true });
    const healthyRun = spawnSync(process.execPath, [path.join(home, 'run-mcp.mjs')], {
      input: initLine,
      encoding: 'utf8',
      timeout: 20_000,
      env: { ...process.env, OPENMOTION_TELEMETRY: '0', OPENGAME_AUTO_UPDATE: '0', OPENGAME_HEALTHY_AFTER_MS: '0' },
    });
    assert.equal(healthyRun.status, 0, healthyRun.stderr);
    const promoted = await readInstallState(home);
    assert.equal(promoted.current.healthy, true);
    assert.equal(existsSync(path.join(home, 'apps', '0.0.1-obsolete')), false, 'Obsolete app versions should be pruned after healthy promotion');
    assert.equal(existsSync(recoveredState.current.appRoot), false, 'Replaced same-version app directory should be pruned after healthy promotion');

    // Verify withInstallLock reclaims a stale dead-PID install.lock AND manual rollback waits cleanly across brief live-lock contention.
    await writeFile(installLockFile, '2147483647');
    let heldReleased = false;
    let markAcquired!: () => void;
    const holderAcquired = new Promise<void>(resolve => { markAcquired = resolve; });
    const holder = withInstallLock(installLockFile, async () => {
      markAcquired();
      await new Promise(resolve => setTimeout(resolve, 150));
      heldReleased = true;
    });
    await holderAcquired;
    const manual = await rollbackInstallation({ home, reason: 'manual', markBad: true });
    await holder;
    assert.equal(heldReleased, true, 'rollbackInstallation should wait for brief live install.lock holder instead of failing fast');
    assert.equal(manual.rolledBack, true);
    assert.equal(manual.from, v2);
    assert.equal(manual.to, v1);
  });
});

test('server exposes loopback-only /api/runtime/activity and /api/runtime/retire for idle retirement', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'opengame-retire-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  let retiredFlag = false;
  const running = await startServer(new WorkspaceStore(dir), 0, {
    editor: false,
    onRetire: () => { retiredFlag = true; },
  });
  t.after(() => running.close());
  const port = (running.server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}`;

  // Reject cross-origin requests.
  const crossOrigin = await fetch(`${base}/api/runtime/activity`, { headers: { Origin: 'https://evil.example' } });
  assert.equal(crossOrigin.status, 403);

  const activityRes = await fetch(`${base}/api/runtime/activity`);
  assert.equal(activityRes.status, 200);
  const activity = await activityRes.json() as any;
  assert.equal(activity.idle, true);
  assert.equal(path.resolve(activity.dataDirectory), path.resolve(dir));
  assert.deepEqual(activity.active, { exports: 0, mediaJobs: 0, gameTrailers: 0, toolCalls: 0 });

  const retireRes = await fetch(`${base}/api/runtime/retire`, { method: 'POST' });
  assert.equal(retireRes.status, 200);
  const retireBody = await retireRes.json() as any;
  assert.equal(retireBody.retired, true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(retiredFlag, true);
});

test('unpinned host platforms (for example Linux CI) fall back to system/env native tools without crashing startup', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'opengame-unpinned-native-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeJSON(path.join(dir, '.npm-install.json'), {
    schemaVersion: 1,
    cacheDirectory: path.join(dir, 'cache/native'),
    runtime: {
      targets: {
        'other-arch': {
          platform: 'sunos',
          arch: 'sparc',
          browser: { url: 'https://example.invalid/browser.zip', sha256: 'a'.repeat(64), executable: 'chrome' },
        },
      },
    },
  });
  await withEnv({
    HYPERFRAMES_BROWSER_PATH: undefined,
    HYPERFRAMES_FFMPEG_PATH: undefined,
    HYPERFRAMES_FFPROBE_PATH: undefined,
    MOTION_BROWSER_PATH: '/usr/bin/custom-chrome',
    FFMPEG_PATH: '/usr/bin/custom-ffmpeg',
    FFPROBE_PATH: '/usr/bin/custom-ffprobe',
  }, async () => {
    assert.equal(await nativeConfiguration(dir), null);
    assert.equal(await configureNativeEnvironment(dir), null);
    assert.equal(process.env.HYPERFRAMES_BROWSER_PATH, '/usr/bin/custom-chrome');
    assert.equal(process.env.HYPERFRAMES_FFMPEG_PATH, '/usr/bin/custom-ffmpeg');
    assert.equal(process.env.HYPERFRAMES_FFPROBE_PATH, '/usr/bin/custom-ffprobe');
    const status = await nativeRuntimeStatus(dir);
    assert.equal(status.managed, false);
    assert.deepEqual(status.components, []);
    assert.equal(status.capabilities.capture, true);
  });
});

test('withInstallLock heartbeats active locks past staleMs while reclaiming inactive, pre-boot, corrupt, and dead-PID locks', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'opengame-lock-stale-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const lockFile = path.join(dir, 'install.lock');
  const oldDate = new Date(Date.now() - 20 * 60_000);

  // 1. A live lock holder heartbeats mtime while running and MUST NOT be reclaimed even when work exceeds staleMs.
  let longHolderDone = false;
  let markLongAcquired!: () => void;
  const longAcquired = new Promise<void>(resolve => { markLongAcquired = resolve; });
  const longHolder = withInstallLock(lockFile, async () => {
    markLongAcquired();
    await new Promise(resolve => setTimeout(resolve, 700));
    longHolderDone = true;
    return 'long-holder-complete';
  }, { staleMs: 300 });
  await longAcquired;
  // Wait beyond staleMs (300ms) so an un-heartbeated lock would have expired.
  await new Promise(resolve => setTimeout(resolve, 450));
  assert.equal(longHolderDone, false);
  await assert.rejects(
    () => withInstallLock(lockFile, async () => 'stolen', { timeoutMs: 120, staleMs: 300 }),
    (error: any) => error.code === 'INSTALL_LOCK_BUSY',
    'Active heartbeated lock must not be reclaimed even after exceeding staleMs',
  );
  // A contender willing to wait acquires the lock only after the active holder finishes.
  const queued = await withInstallLock(lockFile, async () => {
    assert.equal(longHolderDone, true, 'Contender must wait until the live heartbeated holder finishes');
    return 'after-long-holder';
  }, { timeoutMs: 3_000, staleMs: 300 });
  assert.equal(await longHolder, 'long-holder-complete');
  assert.equal(queued, 'after-long-holder');
  assert.equal(existsSync(lockFile), false);

  // 2. Live reused PID in JSON lock whose heartbeat (mtime) expired past staleMs is reclaimed automatically.
  await writeFile(lockFile, JSON.stringify({ pid: process.pid, token: 'reused-pid', createdAt: oldDate.getTime() }));
  await utimes(lockFile, oldDate, oldDate);
  const expiredJson = await withInstallLock(lockFile, async () => {
    const active = JSON.parse(await readFile(lockFile, 'utf8'));
    assert.equal(active.pid, process.pid);
    assert.notEqual(active.token, 'reused-pid');
    assert.equal(typeof active.createdAt, 'number');
    return 'reclaimed-expired-json';
  }, { timeoutMs: 200 });
  assert.equal(expiredJson, 'reclaimed-expired-json');
  assert.equal(existsSync(lockFile), false);

  // 3. Legacy bare-PID lock with live PID whose mtime exceeds staleMs is reclaimed automatically.
  await writeFile(lockFile, String(process.pid));
  await utimes(lockFile, oldDate, oldDate);
  const expiredLegacy = await withInstallLock(lockFile, async () => 'reclaimed-expired-legacy', { timeoutMs: 200 });
  assert.equal(expiredLegacy, 'reclaimed-expired-legacy');

  // 4. Token-less JSON lock with live PID past max inactivity age is reclaimed automatically.
  await writeFile(lockFile, JSON.stringify({ pid: process.pid }));
  await utimes(lockFile, oldDate, oldDate);
  const expiredTokenless = await withInstallLock(lockFile, async () => 'reclaimed-expired-tokenless', { timeoutMs: 200 });
  assert.equal(expiredTokenless, 'reclaimed-expired-tokenless');

  // 5. Pre-boot lock with live PID is reclaimed even when staleMs is larger than system uptime.
  const preBootTs = Date.now() - Math.round(uptime() * 1000) - 120_000;
  await writeFile(lockFile, JSON.stringify({ pid: process.pid, token: 'before-reboot', createdAt: preBootTs }));
  const preBoot = await withInstallLock(lockFile, async () => 'reclaimed-pre-boot', {
    timeoutMs: 200,
    staleMs: 365 * 24 * 60 * 60_000,
  });
  assert.equal(preBoot, 'reclaimed-pre-boot');

  // 6. Empty and truncated/corrupt lock files are reclaimed after the brief grace window.
  const corruptDate = new Date(Date.now() - 5_000);
  await writeFile(lockFile, '');
  await utimes(lockFile, corruptDate, corruptDate);
  assert.equal(await withInstallLock(lockFile, async () => 'reclaimed-empty', { timeoutMs: 200 }), 'reclaimed-empty');

  await writeFile(lockFile, '{"pid":');
  await utimes(lockFile, corruptDate, corruptDate);
  assert.equal(await withInstallLock(lockFile, async () => 'reclaimed-truncated', { timeoutMs: 200 }), 'reclaimed-truncated');

  // 7. Fresh live lock is NEVER stolen and timeout error explains both auto-reclaim and manual removal.
  const liveContent = JSON.stringify({ pid: process.pid, token: 'active-owner', createdAt: Date.now() });
  await writeFile(lockFile, liveContent);
  try {
    await assert.rejects(
      () => withInstallLock(lockFile, async () => 'should-not-run', { timeoutMs: 120 }),
      (error: any) => {
        assert.equal(error.code, 'INSTALL_LOCK_BUSY');
        assert.match(error.message, new RegExp(`pid ${process.pid}`));
        assert.match(error.message, /after 15m of inactivity/);
        assert.match(error.message, /remove .*install\.lock manually/);
        return true;
      },
    );
    assert.equal(await readFile(lockFile, 'utf8'), liveContent, 'Fresh live lock must remain untouched after timeout');
  } finally {
    await rm(lockFile, { force: true });
  }
});
