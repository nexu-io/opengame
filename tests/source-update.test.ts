import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
  applySourceUpdate,
  backupBuildOutputs,
  defaultShutdownIdleBackend,
  restoreBuildOutputs,
  shutdownPreviewService,
  checkSourceUpdate,
  classifyChangedFiles,
  compactRuntimeUpdateNotice,
  DEFAULT_UPDATE_CHECK_INTERVAL_MS,
  ERROR_RETRY_BACKOFF_MS,
  maybeAutoUpdateBeforeCreation,
  parseDirtyWorktreeFiles,
  readUpdateState,
  shouldAutoUpdateForToolCall,
  syncInstalledHostSkills,
  type ExecRunner,
} from '../shared/source-update.ts';
import { rpc } from '../mcp.ts';
import { handler } from '../server.ts';
import { WorkspaceStore } from '../workspace.ts';

const execFileAsync = promisify(execFile);
const repoSourceRoot = fileURLToPath(new URL('../', import.meta.url));
const buildStateScript = path.join(repoSourceRoot, 'scripts/source-build-state.mjs');

async function runGit(cwd: string, args: string[]) {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Test Bot',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'Test Bot',
      GIT_COMMITTER_EMAIL: 'test@example.com',
      GIT_TERMINAL_PROMPT: '0',
    },
  });
  return stdout.trim();
}

async function createGitFixtures(t: any) {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'om-source-update-')));
  t.after(() => rm(root, { recursive: true, force: true }));

  const remoteBare = path.join(root, 'remote.git');
  const upstreamWork = path.join(root, 'upstream');
  const checkout = path.join(root, 'checkout');
  const dataDir = path.join(root, 'data');
  const fakeHome = path.join(root, 'home');
  await mkdir(remoteBare, { recursive: true });
  await mkdir(upstreamWork, { recursive: true });
  await mkdir(dataDir, { recursive: true });
  await mkdir(fakeHome, { recursive: true });

  await runGit(remoteBare, ['init', '--bare', '--initial-branch=main']);
  await runGit(upstreamWork, ['init', '--initial-branch=main']);
  await runGit(upstreamWork, ['remote', 'add', 'origin', remoteBare]);

  // Seed a minimal checkout that mirrors OpenGame's source-build-state layout.
  await mkdir(path.join(upstreamWork, 'scripts'), { recursive: true });
  await mkdir(path.join(upstreamWork, 'studio/src'), { recursive: true });
  await mkdir(path.join(upstreamWork, 'skills/openmotion-game'), { recursive: true });
  await mkdir(path.join(upstreamWork, 'shared'), { recursive: true });
  await copyFile(buildStateScript, path.join(upstreamWork, 'scripts/source-build-state.mjs'));
  await writeFile(path.join(upstreamWork, 'package.json'), JSON.stringify({ name: 'openmotion', version: '0.0.1' }, null, 2));
  const initialLock = JSON.stringify({
    lockfileVersion: 3,
    packages: {
      '': {},
      'node_modules/demo': { version: '1.0.0', integrity: 'sha512-v1' },
    },
  });
  await writeFile(path.join(upstreamWork, 'package-lock.json'), initialLock);
  await writeFile(path.join(upstreamWork, 'studio/src/app.ts'), 'export const v = 1;\n');
  await writeFile(path.join(upstreamWork, 'game-projects.ts'), 'export const gameVersion = 1;\n');
  await writeFile(path.join(upstreamWork, 'skills/openmotion-game/SKILL.md'), '---\nname: openmotion-game\ndescription: v1\n---\n# v1\n');
  await writeFile(path.join(upstreamWork, 'shared/game-tools.ts'), 'export const tools = 1;\n');
  await writeFile(path.join(upstreamWork, '.gitignore'), 'node_modules/\n.artifacts/\nstudio/build/\nweb/inline-video.html\n');

  await runGit(upstreamWork, ['add', '.']);
  await runGit(upstreamWork, ['commit', '-m', 'Initial main commit']);
  await runGit(upstreamWork, ['push', '-u', 'origin', 'main']);

  // Clone exactly as docs/opengame-setup.md instructs: shallow single-branch main.
  await runGit(root, [
    '-c', 'filter.lfs.process=',
    '-c', 'filter.lfs.smudge=',
    '-c', 'filter.lfs.required=false',
    'clone', '--depth', '1', '--single-branch', '--branch', 'main',
    remoteBare, checkout,
  ]);

  // Simulate an already-installed source checkout (node_modules + studio/build).
  await mkdir(path.join(checkout, 'node_modules/demo'), { recursive: true });
  await writeFile(path.join(checkout, 'node_modules/.package-lock.json'), initialLock);
  await mkdir(path.join(checkout, 'studio/build'), { recursive: true });
  await writeFile(path.join(checkout, 'studio/build/index.html'), '<html>v1</html>');

  const commitUpstream = async (changes: Record<string, string>, message: string) => {
    for (const [rel, content] of Object.entries(changes)) {
      const target = path.join(upstreamWork, rel);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, content);
    }
    await runGit(upstreamWork, ['add', '.']);
    await runGit(upstreamWork, ['commit', '-m', message]);
    await runGit(upstreamWork, ['push', 'origin', 'main']);
    return runGit(upstreamWork, ['rev-parse', 'HEAD']);
  };

  return { root, remoteBare, upstreamWork, checkout, dataDir, fakeHome, commitUpstream };
}

function createTrackingExec(options: {
  failOnNpmRun?: boolean;
  failOnLsRemote?: boolean;
  configuredRegistry?: string;
} = {}) {
  const npmCalls: string[][] = [];
  const npmRegistries: Array<string | undefined> = [];
  const gitCalls: string[][] = [];
  const exec: ExecRunner = async (file, args, opts) => {
    const isGit = file === 'git';
    const isNpm = !isGit;
    if (isGit) {
      gitCalls.push([...args]);
      if (options.failOnLsRemote && args.includes('ls-remote')) {
        throw new Error('fatal: unable to access remote: network unreachable');
      }
      const res = await execFileAsync(file, [...args], { cwd: opts?.cwd, env: opts?.env, timeout: opts?.timeout });
      return { stdout: String(res.stdout ?? ''), stderr: String(res.stderr ?? '') };
    }
    if (isNpm) {
      const normalized = args[0]?.endsWith('.js') ? args.slice(1) : [...args];
      if (normalized[0] === 'config' && normalized[1] === 'get' && normalized[2] === 'registry') {
        return { stdout: (options.configuredRegistry ?? 'https://registry.npmjs.org/') + '\n', stderr: '' };
      }
      npmCalls.push(normalized);
      npmRegistries.push(opts?.env?.npm_config_registry);
      if (normalized[0] === 'ci') {
        await mkdir(path.join(opts!.cwd!, 'node_modules'), { recursive: true });
        const lock = await readFile(path.join(opts!.cwd!, 'package-lock.json'), 'utf8');
        await writeFile(path.join(opts!.cwd!, 'node_modules/.package-lock.json'), lock);
        return { stdout: 'npm ci ok', stderr: '' };
      }
      if (normalized[0] === 'run' && normalized[1] === 'build:studio') {
        // Mirror Vite emptyOutDir: true deleting previous outputs before failing.
        await rm(path.join(opts!.cwd!, 'studio/build'), { recursive: true, force: true });
        if (options.failOnNpmRun) throw new Error('Vite build exploded');
        await mkdir(path.join(opts!.cwd!, 'studio/build'), { recursive: true });
        await writeFile(path.join(opts!.cwd!, 'studio/build/index.html'), '<html>rebuilt</html>');
        return { stdout: 'build ok', stderr: '' };
      }
    }
    throw new Error(`Unexpected command: ${file} ${args.join(' ')}`);
  };
  return { exec, npmCalls, npmRegistries, gitCalls };
}

test('classifyChangedFiles accurately flags skill, MCP schema, Studio build, and lockfile changes', () => {
  assert.deepEqual(classifyChangedFiles(['game-projects.ts', 'templates/games/new/index.html']), {
    skillChanged: false,
    gameSkillChanged: false,
    changedSkills: [],
    mcpSchemaChanged: false,
    studioInputChanged: false,
    lockfileChanged: false,
  });
  assert.deepEqual(classifyChangedFiles(['skills/openmotion-game/SKILL.md', 'skills/openmotion-media/references/setup.md']), {
    skillChanged: true,
    gameSkillChanged: true,
    changedSkills: ['openmotion-game', 'openmotion-media'],
    mcpSchemaChanged: false,
    studioInputChanged: false,
    lockfileChanged: false,
  });
  assert.deepEqual(classifyChangedFiles(['shared/game-tools.ts', 'package-lock.json']), {
    skillChanged: false,
    gameSkillChanged: false,
    changedSkills: [],
    mcpSchemaChanged: true,
    studioInputChanged: true,
    lockfileChanged: true,
  });
});

test('shouldAutoUpdateForToolCall matches all creation/generation entries across Game, Motion, Design, and Media while skipping reads and dryRun', () => {
  // Creation and generation entries -> true
  assert.equal(shouldAutoUpdateForToolCall('openmotion_game_create', { prompt: 'runner' }), true);
  assert.equal(shouldAutoUpdateForToolCall('openmotion_create_project', { requestId: 'r1', projectType: 'natural_language', title: 'Intro', requirements: 'make video' }), true);
  assert.equal(shouldAutoUpdateForToolCall('openmotion_design_project', { action: 'create', scenario: 'deck' }), true);
  assert.equal(shouldAutoUpdateForToolCall('openmotion_capability_run', { capabilityId: 'music', prompt: 'lofi loop' }), true);
  assert.equal(shouldAutoUpdateForToolCall('openmotion_assets_use', { action: 'generate', modality: 'image' }), true);
  assert.equal(shouldAutoUpdateForToolCall('openmotion_assets', { action: 'generate', modality: 'audio' }), true);
  assert.equal(shouldAutoUpdateForToolCall('openmotion_media_use', { action: 'generate', modality: 'video' }), true);

  // Non-creation actions, reads, polling, edits, and dryRun -> false
  assert.equal(shouldAutoUpdateForToolCall('openmotion_capability_run', { capabilityId: 'music', dryRun: true }), false);
  assert.equal(shouldAutoUpdateForToolCall('openmotion_design_project', { action: 'get', projectId: '0'.repeat(8) }), false);
  assert.equal(shouldAutoUpdateForToolCall('openmotion_design_project', { action: 'open', projectId: '0'.repeat(8) }), false);
  assert.equal(shouldAutoUpdateForToolCall('openmotion_assets_use', { action: 'list' }), false);
  assert.equal(shouldAutoUpdateForToolCall('openmotion_assets_use', { action: 'status' }), false);
  assert.equal(shouldAutoUpdateForToolCall('openmotion_media_use', { action: 'inspect' }), false);
  assert.equal(shouldAutoUpdateForToolCall('openmotion_media_use', { action: 'models' }), false);
  assert.equal(shouldAutoUpdateForToolCall('openmotion_game_get', { id: 'g1' }), false);
  assert.equal(shouldAutoUpdateForToolCall('openmotion_get_project', {}), false);
  assert.equal(shouldAutoUpdateForToolCall('openmotion_edit_project', {}), false);
  assert.equal(shouldAutoUpdateForToolCall('openmotion_capability_discover', { action: 'list' }), false);
});

test('parseDirtyWorktreeFiles ignores Codex installer marketplace.json but catches real dirty files', () => {
  const onlyMarketplace = '?? .agents/plugins/marketplace.json\0';
  assert.deepEqual(parseDirtyWorktreeFiles(onlyMarketplace), []);

  const withRealEdits = '?? .agents/plugins/marketplace.json\0 M game-projects.ts\0?? scratch.txt\0';
  assert.deepEqual(parseDirtyWorktreeFiles(withRealEdits), ['game-projects.ts', 'scratch.txt']);
});

test('24-hour TTL skips repeated checks with zero git remote probes until interval expires', async t => {
  const { checkout, dataDir } = await createGitFixtures(t);
  const tracker = createTrackingExec();
  let clock = 1_764_000_000_000;
  const env = { ...process.env, OPENMOTION_AUTO_UPDATE: '1' };

  const first = await checkSourceUpdate({
    repoRoot: checkout,
    dataDirectory: dataDir,
    automatic: true,
    now: () => clock,
    env,
    exec: tracker.exec,
  });
  assert.equal(first.status, 'up_to_date');
  assert.equal(first.checked, true);
  assert.equal(tracker.gitCalls.filter(args => args.includes('ls-remote')).length, 1);

  // Within 24h: zero ls-remote calls.
  clock += DEFAULT_UPDATE_CHECK_INTERVAL_MS - 1_000;
  const second = await checkSourceUpdate({
    repoRoot: checkout,
    dataDirectory: dataDir,
    automatic: true,
    now: () => clock,
    env,
    exec: tracker.exec,
  });
  assert.equal(second.status, 'skipped_ttl');
  assert.equal(second.checked, false);
  assert.equal(tracker.gitCalls.filter(args => args.includes('ls-remote')).length, 1);

  // After 24h: probes origin/main again.
  clock += 2_000;
  const third = await checkSourceUpdate({
    repoRoot: checkout,
    dataDirectory: dataDir,
    automatic: true,
    now: () => clock,
    env,
    exec: tracker.exec,
  });
  assert.equal(third.status, 'up_to_date');
  assert.equal(third.checked, true);
  assert.equal(tracker.gitCalls.filter(args => args.includes('ls-remote')).length, 2);
});

test('automatic update respects opt-out env, non-git installs, npm installs, and feature branches', async t => {
  const { root, checkout, dataDir } = await createGitFixtures(t);
  const tracker = createTrackingExec();

  // Disabled via env
  const disabled = await checkSourceUpdate({
    repoRoot: checkout,
    dataDirectory: dataDir,
    automatic: true,
    env: { ...process.env, OPENMOTION_AUTO_UPDATE: '0' },
    exec: tracker.exec,
  });
  assert.equal(disabled.status, 'disabled');
  assert.equal(tracker.gitCalls.length, 0);

  // Non-git directory
  const nonGit = path.join(root, 'plain');
  await mkdir(nonGit, { recursive: true });
  const unsupported = await checkSourceUpdate({
    repoRoot: nonGit,
    dataDirectory: dataDir,
    automatic: true,
    env: { ...process.env, OPENMOTION_AUTO_UPDATE: '1' },
    exec: tracker.exec,
  });
  assert.equal(unsupported.status, 'unsupported');
  assert.equal(unsupported.reason, 'not_git_checkout');

  // npm-managed installation
  await writeFile(path.join(nonGit, '.npm-install.json'), '{}');
  const npmInst = await checkSourceUpdate({
    repoRoot: nonGit,
    dataDirectory: dataDir,
    automatic: true,
    env: { ...process.env, OPENMOTION_AUTO_UPDATE: '1' },
    exec: tracker.exec,
  });
  assert.equal(npmInst.status, 'unsupported');
  assert.equal(npmInst.reason, 'npm_managed_installation');

  // Feature branch protection
  await runGit(checkout, ['checkout', '-b', 'feat/custom-work']);
  const featureBranch = await checkSourceUpdate({
    repoRoot: checkout,
    dataDirectory: dataDir,
    automatic: true,
    env: { ...process.env, OPENMOTION_AUTO_UPDATE: '1' },
    exec: tracker.exec,
  });
  assert.equal(featureBranch.status, 'non_target_branch');
  assert.equal(featureBranch.branch, 'feat/custom-work');
});

test('silent auto-update fast-forwards backend+skill updates without running npm ci or build:studio and syncs host Skills safely', async t => {
  const { checkout, dataDir, fakeHome, commitUpstream } = await createGitFixtures(t);
  const tracker = createTrackingExec();
  const env = { ...process.env, OPENMOTION_AUTO_UPDATE: '1' };

  // Installer-created marketplace.json must NOT block updates.
  await mkdir(path.join(checkout, '.agents/plugins'), { recursive: true });
  await writeFile(path.join(checkout, '.agents/plugins/marketplace.json'), '{"name":"openmotion-local"}');

  // Pre-install host copies: one valid copy, one foreign skill, one npm-managed bundle, one symlink.
  const claudeGameSkill = path.join(fakeHome, '.claude/skills/openmotion-game');
  await mkdir(claudeGameSkill, { recursive: true });
  await writeFile(path.join(claudeGameSkill, 'SKILL.md'), '---\nname: openmotion-game\ndescription: v1\n---\n# v1\n');

  const foreignSkill = path.join(fakeHome, '.agents/skills/openmotion-game');
  await mkdir(foreignSkill, { recursive: true });
  await writeFile(path.join(foreignSkill, 'SKILL.md'), '---\nname: unrelated-custom\n---\nkeep me\n');

  const npmManagedSkill = path.join(fakeHome, '.workbuddy/skills/openmotion-game');
  await mkdir(npmManagedSkill, { recursive: true });
  await writeFile(path.join(npmManagedSkill, 'SKILL.md'), '---\nname: openmotion-game\n---\n# npm\n');
  await writeFile(path.join(npmManagedSkill, 'scope.json'), JSON.stringify({ managedBy: '@openmotion/installer' }));

  const symlinkRoot = path.join(fakeHome, '.cursor/skills');
  await mkdir(symlinkRoot, { recursive: true });
  await symlink(path.join(checkout, 'skills/openmotion-game'), path.join(symlinkRoot, 'openmotion-game'));

  const newCommit = await commitUpstream({
    'game-projects.ts': 'export const gameVersion = 2;\n',
    'skills/openmotion-game/SKILL.md': '---\nname: openmotion-game\ndescription: v2\n---\n# v2\n',
  }, 'Improve game rules and skill');

  let shutdownCalled = 0;
  const result = await maybeAutoUpdateBeforeCreation({
    repoRoot: checkout,
    dataDirectory: dataDir,
    homeDirectory: fakeHome,
    env,
    exec: tracker.exec,
    shutdownBackend: async () => {
      shutdownCalled++;
      return { restarted: true, deferred: false };
    },
  });

  assert.equal(result.status, 'updated');
  if (result.status !== 'updated') throw new Error('expected updated');
  assert.equal(result.currentCommit, newCommit);
  assert.equal(result.skillChanged, true);
  assert.equal(result.gameSkillChanged, true);
  assert.deepEqual(result.changedSkills, ['openmotion-game']);
  assert.equal(result.mcpSchemaChanged, false);
  assert.equal(result.depsInstalled, false);
  assert.equal(result.studioRebuilt, false);
  assert.equal(result.restarted, true);
  assert.equal(shutdownCalled, 1);
  // Zero npm invocations because lockfile and Studio inputs were untouched!
  assert.equal(tracker.npmCalls.length, 0);

  // Verify repo updated, marketplace.json preserved, host skills synced safely.
  assert.match(await readFile(path.join(checkout, 'game-projects.ts'), 'utf8'), /gameVersion = 2/);
  assert.match(await readFile(path.join(checkout, '.agents/plugins/marketplace.json'), 'utf8'), /openmotion-local/);
  assert.match(await readFile(path.join(claudeGameSkill, 'SKILL.md'), 'utf8'), /# v2/);
  assert.match(await readFile(path.join(foreignSkill, 'SKILL.md'), 'utf8'), /keep me/);
  assert.match(await readFile(path.join(npmManagedSkill, 'SKILL.md'), 'utf8'), /# npm/);
  assert.deepEqual(result.syncedSkills, [claudeGameSkill]);

  // Verify subsequent automatic check within 24h skips immediately.
  const second = await maybeAutoUpdateBeforeCreation({
    repoRoot: checkout,
    dataDirectory: dataDir,
    homeDirectory: fakeHome,
    env,
    exec: tracker.exec,
  });
  assert.equal(second.status, 'skipped_ttl');
});

test('dirty working tree blocks update without overwriting local edits', async t => {
  const { checkout, dataDir, commitUpstream } = await createGitFixtures(t);
  const tracker = createTrackingExec();
  const env = { ...process.env, OPENMOTION_AUTO_UPDATE: '1' };

  await commitUpstream({ 'game-projects.ts': 'export const gameVersion = 99;\n' }, 'Upstream update');
  await writeFile(path.join(checkout, 'game-projects.ts'), 'export const gameVersion = 42; // local edit\n');

  const result = await applySourceUpdate({
    repoRoot: checkout,
    dataDirectory: dataDir,
    env,
    exec: tracker.exec,
    restartBackend: false,
  });

  assert.equal(result.status, 'dirty_worktree');
  assert.equal(result.updated, false);
  assert.deepEqual(result.dirtyFiles, ['game-projects.ts']);
  assert.match(await readFile(path.join(checkout, 'game-projects.ts'), 'utf8'), /local edit/);
});

test('incremental rebuild runs build:studio on Studio changes and npm ci + build:studio on lockfile changes', async t => {
  const { checkout, dataDir, commitUpstream } = await createGitFixtures(t);
  const tracker = createTrackingExec();
  const env = { ...process.env, OPENMOTION_AUTO_UPDATE: '1' };

  // 1) Frontend change -> build:studio only (no npm ci)
  await commitUpstream({ 'studio/src/app.ts': 'export const v = 2;\n' }, 'Update Studio UI');
  const first = await applySourceUpdate({
    repoRoot: checkout,
    dataDirectory: dataDir,
    env,
    exec: tracker.exec,
    restartBackend: false,
  });
  assert.equal(first.status, 'updated');
  assert.equal(first.depsInstalled, false);
  assert.equal(first.studioRebuilt, true);
  assert.deepEqual(tracker.npmCalls, [['run', 'build:studio']]);

  // 2) Lockfile + schema change -> npm ci + build:studio + mcpSchemaChanged
  await commitUpstream({
    'package-lock.json': JSON.stringify({ lockfileVersion: 3, packages: { '': {}, 'node_modules/demo': { version: '2.0.0', integrity: 'sha512-v2' } } }),
    'shared/game-tools.ts': 'export const tools = 2;\n',
  }, 'Update deps and game tool schema');
  const second = await applySourceUpdate({
    repoRoot: checkout,
    dataDirectory: dataDir,
    env,
    exec: tracker.exec,
    restartBackend: false,
  });
  assert.equal(second.status, 'updated');
  assert.equal(second.depsInstalled, true);
  assert.equal(second.studioRebuilt, true);
  assert.equal(second.mcpSchemaChanged, true);
  assert.equal(tracker.npmCalls[1][0], 'ci');
  assert.deepEqual(tracker.npmCalls[2], ['run', 'build:studio']);
});

test('build failure rolls back checkout, restores dependencies for previous lockfile, and restores studio/build outputs', async t => {
  const { checkout, dataDir, commitUpstream } = await createGitFixtures(t);
  const beforeCommit = await runGit(checkout, ['rev-parse', 'HEAD']);
  const beforeLock = await readFile(path.join(checkout, 'package-lock.json'), 'utf8');
  await commitUpstream({
    'package-lock.json': JSON.stringify({ lockfileVersion: 3, packages: { '': {}, 'node_modules/demo': { version: '2.0.0', integrity: 'sha512-broken' } } }),
    'studio/src/app.ts': 'export const v = 999; // broken build\n',
  }, 'Broken Studio + deps update');

  const tracker = createTrackingExec({ failOnNpmRun: true });
  const result = await applySourceUpdate({
    repoRoot: checkout,
    dataDirectory: dataDir,
    env: { ...process.env, OPENMOTION_AUTO_UPDATE: '1' },
    exec: tracker.exec,
    restartBackend: false,
  });

  assert.equal(result.status, 'failed_rolled_back');
  assert.equal(result.updated, false);
  assert.equal(result.rolledBack, true);
  assert.equal(result.currentCommit, beforeCommit);
  assert.equal(await runGit(checkout, ['rev-parse', 'HEAD']), beforeCommit);
  assert.match(await readFile(path.join(checkout, 'studio/src/app.ts'), 'utf8'), /export const v = 1;/);
  // Dependencies were reinstalled for the restored lockfile and previous studio/build was restored.
  assert.equal(await readFile(path.join(checkout, 'node_modules/.package-lock.json'), 'utf8'), beforeLock);
  assert.equal(await readFile(path.join(checkout, 'studio/build/index.html'), 'utf8'), '<html>v1</html>');
  assert.equal(tracker.npmCalls.filter(call => call[0] === 'ci').length, 2);
});

test('local commits on main are never overwritten (non_fast_forward guard)', async t => {
  const { checkout, dataDir, commitUpstream } = await createGitFixtures(t);
  const tracker = createTrackingExec();

  // Add a local commit on main and also advance origin/main.
  await writeFile(path.join(checkout, 'local-note.txt'), 'my unpushed work\n');
  await runGit(checkout, ['add', 'local-note.txt']);
  await runGit(checkout, ['commit', '-m', 'Local commit on main']);
  const localCommit = await runGit(checkout, ['rev-parse', 'HEAD']);

  await commitUpstream({ 'game-projects.ts': 'export const gameVersion = 5;\n' }, 'Upstream commit');

  const result = await applySourceUpdate({
    repoRoot: checkout,
    dataDirectory: dataDir,
    env: { ...process.env, OPENMOTION_AUTO_UPDATE: '1' },
    exec: tracker.exec,
    restartBackend: false,
  });

  assert.equal(result.status, 'non_fast_forward');
  assert.equal(result.updated, false);
  assert.equal(await runGit(checkout, ['rev-parse', 'HEAD']), localCommit);
  assert.equal(await readFile(path.join(checkout, 'local-note.txt'), 'utf8'), 'my unpushed work\n');
});

test('complete clones stay complete while file:// shallow clones stay fast-forward verifiable across multiple commits', async t => {
  const { root, remoteBare, checkout, dataDir, commitUpstream } = await createGitFixtures(t);
  const tracker = createTrackingExec();

  // 1) Complete clone remains non-shallow after updating.
  assert.equal(await runGit(checkout, ['rev-parse', '--is-shallow-repository']), 'false');
  await commitUpstream({ 'game-projects.ts': 'export const gameVersion = 2;\n' }, 'Commit 2');
  const fullTarget = await commitUpstream({ 'game-projects.ts': 'export const gameVersion = 3;\n' }, 'Commit 3');
  const fullRes = await applySourceUpdate({
    repoRoot: checkout,
    dataDirectory: dataDir,
    env: { ...process.env, OPENMOTION_AUTO_UPDATE: '1' },
    exec: tracker.exec,
    restartBackend: false,
  });
  assert.equal(fullRes.status, 'updated');
  assert.equal(fullRes.currentCommit, fullTarget);
  assert.equal(await runGit(checkout, ['rev-parse', '--is-shallow-repository']), 'false');

  // 2) Real file:// shallow clone fast-forwards across multiple upstream commits.
  const shallowCheckout = path.join(root, 'shallow-checkout');
  const shallowData = path.join(root, 'shallow-data');
  await mkdir(shallowData, { recursive: true });
  await runGit(root, ['clone', '--depth', '1', '--single-branch', '--branch', 'main', `file://${remoteBare}`, shallowCheckout]);
  assert.equal(await runGit(shallowCheckout, ['rev-parse', '--is-shallow-repository']), 'true');
  await mkdir(path.join(shallowCheckout, 'node_modules/demo'), { recursive: true });
  await writeFile(path.join(shallowCheckout, 'node_modules/.package-lock.json'), await readFile(path.join(shallowCheckout, 'package-lock.json'), 'utf8'));
  await mkdir(path.join(shallowCheckout, 'studio/build'), { recursive: true });
  await writeFile(path.join(shallowCheckout, 'studio/build/index.html'), '<html>v3</html>');

  await commitUpstream({ 'game-projects.ts': 'export const gameVersion = 4;\n' }, 'Commit 4');
  const shallowTarget = await commitUpstream({ 'game-projects.ts': 'export const gameVersion = 5;\n' }, 'Commit 5');
  const shallowRes = await applySourceUpdate({
    repoRoot: shallowCheckout,
    dataDirectory: shallowData,
    env: { ...process.env, OPENMOTION_AUTO_UPDATE: '1' },
    exec: tracker.exec,
    restartBackend: false,
  });
  assert.equal(shallowRes.status, 'updated');
  assert.equal(shallowRes.currentCommit, shallowTarget);
});

test('custom npm registry configured in .npmrc is respected without overriding to npmmirror', async t => {
  const { checkout, dataDir, commitUpstream } = await createGitFixtures(t);
  const tracker = createTrackingExec({ configuredRegistry: 'https://npm.corp.internal/' });
  await commitUpstream({
    'package-lock.json': JSON.stringify({ lockfileVersion: 3, packages: { '': {}, 'node_modules/demo': { version: '2.0.0', integrity: 'sha512-corp' } } }),
  }, 'Update lockfile');

  const env = { ...process.env, OPENMOTION_AUTO_UPDATE: '1' };
  delete env.npm_config_registry;
  const result = await applySourceUpdate({
    repoRoot: checkout,
    dataDirectory: dataDir,
    env,
    exec: tracker.exec,
    restartBackend: false,
  });
  assert.equal(result.status, 'updated');
  assert.equal(result.depsInstalled, true);
  assert.equal(tracker.npmCalls.filter(call => call[0] === 'ci').length, 1);
  // Registry env override must stay undefined so npm uses the configured .npmrc registry.
  assert.equal(tracker.npmRegistries[0], undefined);
});

test('failed apply backs off for 1 hour (ERROR_RETRY_BACKOFF_MS) instead of full 24-hour TTL', async t => {
  const { checkout, dataDir, commitUpstream } = await createGitFixtures(t);
  await commitUpstream({ 'studio/src/app.ts': 'export const v = 999;\n' }, 'Broken Studio');

  let clock = 1_764_000_000_000;
  const env = { ...process.env, OPENMOTION_AUTO_UPDATE: '1' };
  const failing = createTrackingExec({ failOnNpmRun: true });

  const first = await maybeAutoUpdateBeforeCreation({
    repoRoot: checkout,
    dataDirectory: dataDir,
    now: () => clock,
    env,
    exec: failing.exec,
    restartBackend: false,
  });
  assert.equal(first.status, 'failed_rolled_back');

  // Within 1h backoff: skipped.
  clock += ERROR_RETRY_BACKOFF_MS - 1_000;
  const withinBackoff = await maybeAutoUpdateBeforeCreation({
    repoRoot: checkout,
    dataDirectory: dataDir,
    now: () => clock,
    env,
    exec: failing.exec,
    restartBackend: false,
  });
  assert.equal(withinBackoff.status, 'skipped_ttl');

  // After 1h (still well under 24h TTL): retries and succeeds once build works.
  clock += 2_000;
  const fixed = createTrackingExec({ failOnNpmRun: false });
  const retried = await maybeAutoUpdateBeforeCreation({
    repoRoot: checkout,
    dataDirectory: dataDir,
    now: () => clock,
    env,
    exec: fixed.exec,
    restartBackend: false,
  });
  assert.equal(retried.status, 'updated');
});

test('npm run update script allows passing --check without conflicting with default apply mode', async () => {
  const pkg = JSON.parse(await readFile(path.join(repoSourceRoot, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts.update, 'node --experimental-strip-types scripts/update.ts');
  const { stdout } = await execFileAsync(process.execPath, ['--experimental-strip-types', 'scripts/update.ts', '--check'], {
    cwd: repoSourceRoot,
    timeout: 10_000,
  });
  const parsed = JSON.parse(stdout);
  assert.equal(typeof parsed.status, 'string');
});

test('transient network error during check backs off for 1 hour instead of stalling every call', async t => {
  const { checkout, dataDir } = await createGitFixtures(t);
  const tracker = createTrackingExec({ failOnLsRemote: true });
  let clock = 1_764_000_000_000;
  const env = { ...process.env, OPENMOTION_AUTO_UPDATE: '1' };

  const first = await checkSourceUpdate({
    repoRoot: checkout,
    dataDirectory: dataDir,
    automatic: true,
    now: () => clock,
    env,
    exec: tracker.exec,
  });
  assert.equal(first.status, 'check_failed');
  assert.equal(tracker.gitCalls.filter(args => args.includes('ls-remote')).length, 1);

  clock += ERROR_RETRY_BACKOFF_MS - 1_000;
  const second = await checkSourceUpdate({
    repoRoot: checkout,
    dataDirectory: dataDir,
    automatic: true,
    now: () => clock,
    env,
    exec: tracker.exec,
  });
  assert.equal(second.status, 'skipped_ttl');
  assert.equal(tracker.gitCalls.filter(args => args.includes('ls-remote')).length, 1);

  const persisted = await readUpdateState(dataDir);
  assert.equal(persisted?.lastStatus, 'check_failed');
});

test('MCP rpc triggers autoUpdate across all creation/generation tools, skips reads and dryRun, and never blocks creation on error', async t => {
  const dataDir = await realpath(await mkdtemp(path.join(tmpdir(), 'om-mcp-update-')));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const store = new WorkspaceStore(dataDir);

  const updateCalls: Array<{ repoRoot: string; dataDirectory: string; restartBackend: boolean }> = [];
  const callPhase1 = async (payload: any) => ({ id: 'item-123', title: payload.arguments?.prompt || payload.arguments?.title || 'Item', status: 'draft' });

  // 1) Read-only / dryRun calls must NEVER trigger autoUpdate
  for (const params of [
    { name: 'openmotion_game_get', arguments: { id: 'game-123' } },
    { name: 'openmotion_capability_run', arguments: { capabilityId: 'music', prompt: 'test', dryRun: true } },
    { name: 'openmotion_design_project', arguments: { action: 'list' } },
    { name: 'openmotion_assets_use', arguments: { action: 'list' } },
    { name: 'openmotion_media_use', arguments: { action: 'inspect' } },
  ]) {
    await rpc(
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params },
      store,
      undefined,
      undefined,
      undefined,
      {
        callPhase1,
        autoUpdate: async ctx => {
          updateCalls.push(ctx);
          return { status: 'skipped_ttl', checked: false, updateAvailable: false };
        },
      },
    );
  }
  assert.equal(updateCalls.length, 0);

  // 2) openmotion_game_create with actual update -> attaches compact runtimeUpdate
  const updatedOutcome = {
    status: 'updated' as const,
    updated: true,
    previousCommit: '1'.repeat(40),
    currentCommit: '2'.repeat(40),
    skillChanged: true,
    gameSkillChanged: true,
    changedSkills: ['openmotion-game'],
    mcpSchemaChanged: false,
    depsInstalled: false,
    studioRebuilt: false,
    restarted: true,
    restartDeferred: false,
  };
  const updatedResp: any = await rpc(
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'openmotion_game_create', arguments: { prompt: 'A minimal runner' } } },
    store,
    undefined,
    undefined,
    undefined,
    {
      callPhase1,
      autoUpdate: async ctx => {
        updateCalls.push(ctx);
        return updatedOutcome;
      },
    },
  );
  assert.equal(updateCalls.length, 1);
  assert.equal(updatedResp.result.structuredContent.id, 'item-123');
  assert.deepEqual(updatedResp.result.structuredContent.runtimeUpdate, compactRuntimeUpdateNotice(updatedOutcome));

  // 3) Motion video, Design create, and Multimodal image/audio/video generation all invoke autoUpdate hook
  for (const params of [
    { name: 'openmotion_create_project', arguments: { requestId: 'req-video', projectType: 'natural_language', title: 'Promo', requirements: '10s promo' } },
    { name: 'openmotion_design_project', arguments: { action: 'create', requestId: 'req-design', scenario: 'deck', title: 'Pitch Deck' } },
    { name: 'openmotion_capability_run', arguments: { requestId: 'req-audio', capabilityId: 'music', prompt: 'upbeat synth loop' } },
    { name: 'openmotion_assets_use', arguments: { action: 'generate', requestId: 'req-image', model: 'seedream', modality: 'image', prompt: 'hero key art' } },
  ]) {
    const resp: any = await rpc(
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params },
      store,
      undefined,
      undefined,
      undefined,
      {
        callPhase1,
        autoUpdate: async ctx => {
          updateCalls.push(ctx);
          return { status: 'skipped_ttl', checked: false, updateAvailable: false };
        },
      },
    );
    assert.equal(resp.result.isError, undefined, JSON.stringify(resp));
    assert.equal('runtimeUpdate' in resp.result.structuredContent, false);
  }
  assert.equal(updateCalls.length, 5);

  // 4) autoUpdate throwing unexpectedly must NEVER block creation
  const resilientResp: any = await rpc(
    { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'openmotion_game_create', arguments: { prompt: 'Resilient game' } } },
    store,
    undefined,
    undefined,
    undefined,
    {
      callPhase1,
      autoUpdate: async () => { throw new Error('unexpected updater crash'); },
    },
  );
  assert.equal(resilientResp.result.isError, undefined);
  assert.equal(resilientResp.result.structuredContent.id, 'item-123');
});

test('HTTP MCP creation update reports restartDeferred: true when backend restart is skipped', async t => {
  const { upstreamWork, checkout, dataDir, fakeHome } = await createGitFixtures(t);
  await writeFile(path.join(upstreamWork, 'README.md'), '# upstream http mcp update\n');
  await runGit(upstreamWork, ['add', 'README.md']);
  await runGit(upstreamWork, ['commit', '-m', 'http mcp update']);
  await runGit(upstreamWork, ['push', 'origin', 'main']);

  const store = new WorkspaceStore(dataDir);
  let seenRestartBackend: boolean | undefined;
  const resp: any = await rpc(
    { jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'openmotion_game_create', arguments: { prompt: 'HTTP runner' } } },
    store,
    undefined,
    undefined,
    undefined,
    {
      transport: 'http',
      callPhase1: async () => ({ id: 'game-http-1', title: 'HTTP runner', status: 'draft' }),
      autoUpdate: async ctx => {
        seenRestartBackend = ctx.restartBackend;
        return maybeAutoUpdateBeforeCreation({
          repoRoot: checkout,
          dataDirectory: ctx.dataDirectory,
          homeDirectory: fakeHome,
          restartBackend: ctx.restartBackend,
          env: { ...process.env, OPENMOTION_AUTO_UPDATE: '1' },
        });
      },
    },
  );

  assert.equal(seenRestartBackend, false);
  assert.equal(resp.result.structuredContent.id, 'game-http-1');
  assert.equal(resp.result.structuredContent.runtimeUpdate?.status, 'updated');
  assert.equal(resp.result.structuredContent.runtimeUpdate?.restarted, false);
  assert.equal(resp.result.structuredContent.runtimeUpdate?.restartDeferred, true);
});

test('HTTP /motion-api/update/status and /motion-api/update/apply reject cross-site requests and report non-git checkout cleanly', async t => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'om-http-update-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dataDir = path.join(root, 'data');
  const fakeAppRoot = path.join(root, 'app');
  await mkdir(dataDir, { recursive: true });
  await mkdir(fakeAppRoot, { recursive: true });
  const store = new WorkspaceStore(dataDir);

  const server = createServer((req, res) => {
    void handler(req, res, store, { nativeRoot: fakeAppRoot });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const port = (server.address() as { port: number }).port;
  const origin = `http://127.0.0.1:${port}`;

  // Cross-site GET rejected
  const crossGet = await fetch(`${origin}/motion-api/update/status`, {
    headers: { 'Sec-Fetch-Site': 'cross-site' },
  });
  assert.equal(crossGet.status, 403);

  // Local GET reports unsupported on non-git app root
  const okGet = await fetch(`${origin}/motion-api/update/status`);
  assert.equal(okGet.status, 200);
  const statusJson = await okGet.json();
  assert.equal(statusJson.status, 'unsupported');
  assert.equal(statusJson.reason, 'not_git_checkout');

  // Cross-site POST rejected
  const crossPost = await fetch(`${origin}/motion-api/update/apply`, {
    method: 'POST',
    headers: { Origin: origin, 'Sec-Fetch-Site': 'cross-site' },
  });
  assert.equal(crossPost.status, 403);

  // Same-origin POST returns unsupported cleanly without error
  const okPost = await fetch(`${origin}/motion-api/update/apply`, {
    method: 'POST',
    headers: { Origin: origin },
  });
  assert.equal(okPost.status, 200);
  const applyJson = await okPost.json();
  assert.equal(applyJson.status, 'unsupported');
  assert.equal(applyJson.restartRequired, false);
});

test('rollback restores studio/build and leaves no untracked .rollback-* leftovers even when rollback npm ci fails', async t => {
  const { checkout, dataDir, commitUpstream } = await createGitFixtures(t);
  const beforeCommit = await runGit(checkout, ['rev-parse', 'HEAD']);
  await commitUpstream({
    'package-lock.json': JSON.stringify({ lockfileVersion: 3, packages: { '': {}, 'node_modules/demo': { version: '2.0.0', integrity: 'sha512-broken' } } }),
    'studio/src/app.ts': 'export const v = 999;\n',
  }, 'Broken update with failing rollback reinstall');

  let ciAttempts = 0;
  const exec: ExecRunner = async (file, args, opts) => {
    if (file === 'git') {
      const res = await execFileAsync(file, [...args], { cwd: opts?.cwd, env: opts?.env, timeout: opts?.timeout });
      return { stdout: String(res.stdout ?? ''), stderr: String(res.stderr ?? '') };
    }
    const normalized = args[0]?.endsWith('.js') ? args.slice(1) : [...args];
    if (normalized[0] === 'config' && normalized[1] === 'get' && normalized[2] === 'registry') {
      return { stdout: 'https://npm.corp.internal/\n', stderr: '' };
    }
    if (normalized[0] === 'ci') {
      ciAttempts++;
      if (ciAttempts === 1) {
        const lock = await readFile(path.join(opts!.cwd!, 'package-lock.json'), 'utf8');
        await writeFile(path.join(opts!.cwd!, 'node_modules/.package-lock.json'), lock);
        return { stdout: 'ok', stderr: '' };
      }
      throw new Error('registry temporarily unreachable during rollback');
    }
    if (normalized[0] === 'run' && normalized[1] === 'build:studio') {
      await rm(path.join(opts!.cwd!, 'studio/build'), { recursive: true, force: true });
      throw new Error('Vite build failed');
    }
    throw new Error(`Unexpected command: ${file} ${args.join(' ')}`);
  };

  const result = await applySourceUpdate({
    repoRoot: checkout,
    dataDirectory: dataDir,
    env: { ...process.env, OPENMOTION_AUTO_UPDATE: '1' },
    exec,
    restartBackend: false,
  });

  assert.equal(result.status, 'failed_rolled_back');
  assert.equal(result.rolledBack, true);
  assert.equal(result.currentCommit, beforeCommit);
  assert.equal(await runGit(checkout, ['rev-parse', 'HEAD']), beforeCommit);
  // Studio build is restored and worktree stays clean (no leftover .rollback-* untracked dirs).
  assert.equal(await readFile(path.join(checkout, 'studio/build/index.html'), 'utf8'), '<html>v1</html>');
  assert.equal(await runGit(checkout, ['status', '--porcelain=v1', '--untracked-files=all']), '');
  const state = await readUpdateState(dataDir);
  assert.equal(state?.currentCommit, beforeCommit);
  assert.equal(state?.lastStatus, 'failed_rolled_back');
});

test('shallow fetch fallback preserves ancestry proof and non-1 merge-base errors return retryable failed instead of non_fast_forward', async t => {
  const { root, remoteBare, checkout, dataDir, commitUpstream } = await createGitFixtures(t);

  // 1) Shallow clone where --shallow-since is rejected falls back to --unshallow and still succeeds.
  const shallowCheckout = path.join(root, 'shallow-unshallow');
  const shallowData = path.join(root, 'shallow-unshallow-data');
  await mkdir(shallowData, { recursive: true });
  await runGit(root, ['clone', '--depth', '1', '--single-branch', '--branch', 'main', `file://${remoteBare}`, shallowCheckout]);
  await mkdir(path.join(shallowCheckout, 'node_modules/demo'), { recursive: true });
  await writeFile(path.join(shallowCheckout, 'node_modules/.package-lock.json'), await readFile(path.join(shallowCheckout, 'package-lock.json'), 'utf8'));
  await mkdir(path.join(shallowCheckout, 'studio/build'), { recursive: true });
  await writeFile(path.join(shallowCheckout, 'studio/build/index.html'), '<html>v1</html>');

  await commitUpstream({ 'game-projects.ts': 'export const gameVersion = 10;\n' }, 'Commit 10');
  const targetCommit = await commitUpstream({ 'game-projects.ts': 'export const gameVersion = 11;\n' }, 'Commit 11');

  const unshallowTracker: string[][] = [];
  const execRejectSince: ExecRunner = async (file, args, opts) => {
    if (file === 'git') {
      unshallowTracker.push([...args]);
      if (args.some(arg => arg.startsWith('--shallow-since='))) {
        throw new Error('fatal: server does not support shallow-since');
      }
      const res = await execFileAsync(file, [...args], { cwd: opts?.cwd, env: opts?.env, timeout: opts?.timeout });
      return { stdout: String(res.stdout ?? ''), stderr: String(res.stderr ?? '') };
    }
    throw new Error(`Unexpected non-git command: ${file}`);
  };

  const shallowRes = await applySourceUpdate({
    repoRoot: shallowCheckout,
    dataDirectory: shallowData,
    env: { ...process.env, OPENMOTION_AUTO_UPDATE: '1' },
    exec: execRejectSince,
    restartBackend: false,
  });
  assert.equal(shallowRes.status, 'updated');
  assert.equal(shallowRes.currentCommit, targetCommit);
  assert.ok(unshallowTracker.some(args => args.includes('--unshallow')));

  // 2) merge-base --is-ancestor exiting with non-1 error returns retryable failed (no lastCheckedAt).
  const execMergeBaseTimeout: ExecRunner = async (file, args, opts) => {
    if (file === 'git' && args.includes('--is-ancestor')) {
      throw Object.assign(new Error('ETIMEDOUT'), { code: 'ETIMEDOUT' });
    }
    const res = await execFileAsync(file, [...args], { cwd: opts?.cwd, env: opts?.env, timeout: opts?.timeout });
    return { stdout: String(res.stdout ?? ''), stderr: String(res.stderr ?? '') };
  };
  const errRes = await applySourceUpdate({
    repoRoot: checkout,
    dataDirectory: dataDir,
    env: { ...process.env, OPENMOTION_AUTO_UPDATE: '1' },
    exec: execMergeBaseTimeout,
    restartBackend: false,
  });
  assert.equal(errRes.status, 'failed');
  const persisted = await readUpdateState(dataDir);
  assert.equal(persisted?.lastStatus, 'failed');
  assert.equal(persisted?.lastCheckedAt, undefined);
});

test('backupBuildOutputs stores backups under gitignored .artifacts/install and restores partial moves on mid-loop failure', async t => {
  const { checkout } = await createGitFixtures(t);
  await mkdir(path.join(checkout, 'web'), { recursive: true });
  await writeFile(path.join(checkout, 'web/inline-video.html'), '<html>inline</html>');

  let calls = 0;
  await assert.rejects(
    () => backupBuildOutputs(checkout, async (src, dest) => {
      calls++;
      if (calls === 2) throw new Error('EPERM: simulated second rename failure');
      const { rename } = await import('node:fs/promises');
      await rename(src, dest);
    }),
    /simulated second rename failure/,
  );

  // First moved output (studio/build) was restored and git status stays clean.
  assert.equal(await readFile(path.join(checkout, 'studio/build/index.html'), 'utf8'), '<html>v1</html>');
  assert.equal(await readFile(path.join(checkout, 'web/inline-video.html'), 'utf8'), '<html>inline</html>');
  assert.equal(await runGit(checkout, ['status', '--porcelain=v1', '--untracked-files=all']), '');

  // Even an uncleaned backup left in .artifacts/install (e.g. SIGKILL mid-build) stays gitignored.
  const kept = await backupBuildOutputs(checkout);
  assert.ok(kept.rootDir.startsWith(path.join(checkout, '.artifacts/install/')));
  assert.equal(await runGit(checkout, ['status', '--porcelain=v1', '--untracked-files=all']), '');
});

test('restoreBuildOutputs retains backup directory when a restore move fails and removes it when all succeed', async t => {
  const { checkout } = await createGitFixtures(t);
  await mkdir(path.join(checkout, 'web'), { recursive: true });
  await writeFile(path.join(checkout, 'web/inline-video.html'), '<html>inline</html>');

  const backups = await backupBuildOutputs(checkout);
  const { existsSync } = await import('node:fs');
  const { rename } = await import('node:fs/promises');

  // Fail restoring studio/build while allowing web/inline-video.html to restore.
  const partialOk = await restoreBuildOutputs(backups, async (src, dest) => {
    if (dest.endsWith(path.join('studio', 'build'))) {
      throw new Error('EBUSY: simulated locked studio/build');
    }
    await rename(src, dest);
  });

  assert.equal(partialOk, false);
  assert.equal(await readFile(path.join(checkout, 'web/inline-video.html'), 'utf8'), '<html>inline</html>');
  assert.equal(existsSync(backups.rootDir), true);
  assert.equal(await readFile(path.join(backups.rootDir, 'studio/build/index.html'), 'utf8'), '<html>v1</html>');
  assert.equal(await runGit(checkout, ['status', '--porcelain=v1', '--untracked-files=all']), '');

  // Retrying restore once the lock clears restores studio/build and removes rootDir.
  const fullOk = await restoreBuildOutputs(backups);
  assert.equal(fullOk, true);
  assert.equal(await readFile(path.join(checkout, 'studio/build/index.html'), 'utf8'), '<html>v1</html>');
  assert.equal(existsSync(backups.rootDir), false);
});

test('applySourceUpdate aborts without overwriting tracked edits saved during git fetch', async t => {
  const { upstreamWork, checkout, dataDir, fakeHome } = await createGitFixtures(t);

  await writeFile(path.join(upstreamWork, 'README.md'), '# upstream v2\n');
  await runGit(upstreamWork, ['add', 'README.md']);
  await runGit(upstreamWork, ['commit', '-m', 'update readme']);
  await runGit(upstreamWork, ['push', 'origin', 'main']);

  const before = await runGit(checkout, ['rev-parse', 'HEAD']);
  let mutatedDuringFetch = false;

  const result = await applySourceUpdate({
    repoRoot: checkout,
    dataDirectory: dataDir,
    homeDirectory: fakeHome,
    restartBackend: false,
    exec: async (file, args, options) => {
      const { stdout, stderr } = await execFileAsync(file, [...args], {
        cwd: options?.cwd,
        env: options?.env,
      });
      if (file === 'git' && args.includes('fetch') && !mutatedDuringFetch) {
        mutatedDuringFetch = true;
        await writeFile(path.join(checkout, 'README.md'), '# local edit saved mid-fetch\n');
      }
      return { stdout: String(stdout ?? ''), stderr: String(stderr ?? '') };
    },
  });

  assert.equal(mutatedDuringFetch, true);
  assert.equal(result.status, 'dirty_worktree');
  assert.equal(result.updated, false);
  assert.equal(result.currentCommit, before);
  assert.equal(await runGit(checkout, ['rev-parse', 'HEAD']), before);
  assert.equal(await readFile(path.join(checkout, 'README.md'), 'utf8'), '# local edit saved mid-fetch\n');
  assert.ok(result.dirtyFiles?.includes('README.md'));
});

test('non-macOS backend shutdown stops matching idle preview service, defers when busy or unmanaged, and ignores unrelated servers', async t => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'om-preview-shutdown-')));
  t.after(() => rm(root, { recursive: true, force: true }));

  // 1) Idle matching preview service with valid PID -> SIGTERM + waits for shutdown -> restarted: true
  const dataIdle = path.join(root, 'idle');
  await mkdir(dataIdle, { recursive: true });
  const idleServer = createServer((req, res) => {
    if (req.url === '/api/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        service: 'motion-preview',
        protocol: 2,
        dataDirectory: dataIdle,
        activeWork: false,
      }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>(resolve => idleServer.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    idleServer.closeAllConnections();
    idleServer.close();
  });
  const idlePort = (idleServer.address() as { port: number }).port;
  await writeFile(path.join(dataIdle, 'preview.json'), JSON.stringify({ port: idlePort, pid: 424242, version: '0.0.1' }));

  const killed: Array<{ pid: number; signal: NodeJS.Signals }> = [];
  const idleOutcome = await defaultShutdownIdleBackend(dataIdle, {
    useSharedEditor: false,
    previewDeps: {
      killProcess: (pid, signal) => {
        killed.push({ pid, signal });
        idleServer.closeAllConnections();
        idleServer.close();
      },
      waitMs: 1_500,
      pollIntervalMs: 25,
    },
  });
  assert.deepEqual(idleOutcome, { restarted: true, deferred: false });
  assert.deepEqual(killed, [{ pid: 424242, signal: 'SIGTERM' }]);

  // 2) Busy matching preview service (activeWork: true) -> never kills, defers restart
  const dataBusy = path.join(root, 'busy');
  await mkdir(dataBusy, { recursive: true });
  const busyServer = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ service: 'motion-preview', dataDirectory: dataBusy, activeWork: true }));
  });
  await new Promise<void>(resolve => busyServer.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    busyServer.closeAllConnections();
    busyServer.close();
  });
  const busyPort = (busyServer.address() as { port: number }).port;
  await writeFile(path.join(dataBusy, 'preview.json'), JSON.stringify({ port: busyPort, pid: 525252 }));

  const busyKills: number[] = [];
  const busyOutcome = await shutdownPreviewService(dataBusy, {
    killProcess: pid => { busyKills.push(pid); },
    waitMs: 200,
  });
  assert.deepEqual(busyOutcome, { restarted: false, deferred: true });
  assert.deepEqual(busyKills, []);

  // 3) Matching live preview service with no PID recorded -> defers restart without killing
  await writeFile(path.join(dataBusy, 'preview.json'), JSON.stringify({ port: busyPort }));
  const noPidOutcome = await shutdownPreviewService(dataBusy, {
    probeHealth: async () => ({ service: 'motion-preview', dataDirectory: dataBusy, activeWork: false }),
    killProcess: pid => { busyKills.push(pid); },
  });
  assert.deepEqual(noPidOutcome, { restarted: false, deferred: true });
  assert.deepEqual(busyKills, []);

  const fixedNow = 1_800_000_000_000;

  // 3b) Pre-update backend (omits health.activeWork) with active export in jobs/<id>/job.json
  // (future expiresAt + live workerPid) -> defers without killing
  const dataExportJob = path.join(root, 'export-job');
  await mkdir(path.join(dataExportJob, 'jobs', '11111111-1111-1111-1111-111111111111'), { recursive: true });
  await writeFile(path.join(dataExportJob, 'preview.json'), JSON.stringify({ port: busyPort, pid: 626262 }));
  await writeFile(
    path.join(dataExportJob, 'jobs', '11111111-1111-1111-1111-111111111111', 'job.json'),
    JSON.stringify({
      id: '11111111-1111-1111-1111-111111111111',
      state: 'running',
      expiresAt: fixedNow + 60_000,
      workerPid: 77777,
    }),
  );
  const exportJobOutcome = await shutdownPreviewService(dataExportJob, {
    now: () => fixedNow,
    isPidAlive: pid => pid === 77777,
    probeHealth: async () => ({ service: 'motion-preview', dataDirectory: dataExportJob }),
    killProcess: pid => { busyKills.push(pid); },
  });
  assert.deepEqual(exportJobOutcome, { restarted: false, deferred: true });
  assert.deepEqual(busyKills, []);

  // 3c) Pre-update backend with live pending export in export.json mirror only (future expiresAt) -> defers
  const dataExportMirror = path.join(root, 'export-mirror');
  await mkdir(dataExportMirror, { recursive: true });
  await writeFile(path.join(dataExportMirror, 'preview.json'), JSON.stringify({ port: busyPort, pid: 636363 }));
  await writeFile(
    path.join(dataExportMirror, 'export.json'),
    JSON.stringify({ id: '22222222-2222-2222-2222-222222222222', state: 'pending', expiresAt: fixedNow + 60_000 }),
  );
  const exportMirrorOutcome = await shutdownPreviewService(dataExportMirror, {
    now: () => fixedNow,
    probeHealth: async () => ({ service: 'motion-preview', dataDirectory: dataExportMirror }),
    killProcess: pid => { busyKills.push(pid); },
  });
  assert.deepEqual(exportMirrorOutcome, { restarted: false, deferred: true });
  assert.deepEqual(busyKills, []);

  // 3d) Pre-update backend with queued Model Gateway job -> defers without killing
  const dataGatewayJob = path.join(root, 'gateway-job');
  await mkdir(path.join(dataGatewayJob, 'model-gateway', 'jobs'), { recursive: true });
  await writeFile(path.join(dataGatewayJob, 'preview.json'), JSON.stringify({ port: busyPort, pid: 646464 }));
  await writeFile(
    path.join(dataGatewayJob, 'model-gateway', 'jobs', '33333333-3333-3333-3333-333333333333.json'),
    JSON.stringify({ id: '33333333-3333-3333-3333-333333333333', state: 'queued' }),
  );
  const gatewayJobOutcome = await shutdownPreviewService(dataGatewayJob, {
    now: () => fixedNow,
    probeHealth: async () => ({ service: 'motion-preview', dataDirectory: dataGatewayJob }),
    killProcess: pid => { busyKills.push(pid); },
  });
  assert.deepEqual(gatewayJobOutcome, { restarted: false, deferred: true });
  assert.deepEqual(busyKills, []);

  // 3e) Abandoned export records (expired expiresAt or dead workerPid) and dead-worker gateway jobs
  // are ignored so pre-update backends still stop cleanly instead of deferring forever.
  const dataAbandoned = path.join(root, 'abandoned-jobs');
  await mkdir(path.join(dataAbandoned, 'jobs', '44444444-4444-4444-4444-444444444444'), { recursive: true });
  await mkdir(path.join(dataAbandoned, 'jobs', '55555555-5555-5555-5555-555555555555'), { recursive: true });
  await mkdir(path.join(dataAbandoned, 'model-gateway', 'jobs'), { recursive: true });
  await writeFile(path.join(dataAbandoned, 'preview.json'), JSON.stringify({ port: busyPort, pid: 656565 }));
  // Expired export with live workerPid
  await writeFile(
    path.join(dataAbandoned, 'jobs', '44444444-4444-4444-4444-444444444444', 'job.json'),
    JSON.stringify({ id: '44444444-4444-4444-4444-444444444444', state: 'running', expiresAt: fixedNow - 1_000, workerPid: 77777 }),
  );
  // Future expiresAt export whose workerPid died
  await writeFile(
    path.join(dataAbandoned, 'jobs', '55555555-5555-5555-5555-555555555555', 'job.json'),
    JSON.stringify({ id: '55555555-5555-5555-5555-555555555555', state: 'running', expiresAt: fixedNow + 60_000, workerPid: 88888 }),
  );
  // Running gateway job whose workerPid died
  await writeFile(
    path.join(dataAbandoned, 'model-gateway', 'jobs', '66666666-6666-6666-6666-666666666666.json'),
    JSON.stringify({ id: '66666666-6666-6666-6666-666666666666', state: 'running', workerPid: 99999 }),
  );
  let abandonedBackendAlive = true;
  const abandonedKills: number[] = [];
  const abandonedOutcome = await shutdownPreviewService(dataAbandoned, {
    now: () => fixedNow,
    isPidAlive: pid => pid === 77777,
    probeHealth: async () => (abandonedBackendAlive ? { service: 'motion-preview', dataDirectory: dataAbandoned } : null),
    killProcess: pid => {
      abandonedKills.push(pid);
      abandonedBackendAlive = false;
    },
    waitMs: 500,
    pollIntervalMs: 10,
  });
  assert.deepEqual(abandonedOutcome, { restarted: true, deferred: false });
  assert.deepEqual(abandonedKills, [656565]);

  // 3f) Once export job completes (even if export.json still lags with future expiresAt), backend stops cleanly
  await writeFile(
    path.join(dataExportJob, 'jobs', '11111111-1111-1111-1111-111111111111', 'job.json'),
    JSON.stringify({ id: '11111111-1111-1111-1111-111111111111', state: 'completed', expiresAt: fixedNow + 60_000, workerPid: 77777 }),
  );
  await writeFile(
    path.join(dataExportJob, 'export.json'),
    JSON.stringify({ id: '11111111-1111-1111-1111-111111111111', state: 'running', expiresAt: fixedNow + 60_000, workerPid: 77777 }),
  );
  let exportBackendAlive = true;
  const completedKills: number[] = [];
  const completedOutcome = await shutdownPreviewService(dataExportJob, {
    now: () => fixedNow,
    isPidAlive: pid => pid === 77777,
    probeHealth: async () => (exportBackendAlive ? { service: 'motion-preview', dataDirectory: dataExportJob } : null),
    killProcess: pid => {
      completedKills.push(pid);
      exportBackendAlive = false;
    },
    waitMs: 500,
    pollIntervalMs: 10,
  });
  assert.deepEqual(completedOutcome, { restarted: true, deferred: false });
  assert.deepEqual(completedKills, [626262]);

  // 4) Different workspace or unrelated service on registered port -> ignored without killing
  const otherOutcome = await shutdownPreviewService(dataBusy, {
    probeHealth: async () => ({ service: 'motion-preview', dataDirectory: path.join(root, 'someone-else'), activeWork: false }),
    killProcess: pid => { busyKills.push(pid); },
  });
  assert.deepEqual(otherOutcome, { restarted: false, deferred: false });
  assert.deepEqual(busyKills, []);
});

test('scripts/build-template-guide.mjs is hashed by source-build-state and triggers Studio rebuild classification', async t => {
  const { sourceBuildCurrent, recordSourceBuild, SOURCE_BUILD_INPUTS } = await import('../scripts/source-build-state.mjs');
  assert.ok(SOURCE_BUILD_INPUTS.includes('scripts/build-template-guide.mjs'));
  assert.equal(classifyChangedFiles(['scripts/build-template-guide.mjs']).studioInputChanged, true);

  const root = await mkdtemp(path.join(tmpdir(), 'om-guide-input-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'studio/build'), { recursive: true });
  await mkdir(path.join(root, 'scripts'), { recursive: true });
  await writeFile(path.join(root, 'studio/build/index.html'), '<html>ok</html>');
  await writeFile(path.join(root, 'scripts/build-template-guide.mjs'), 'export const v = 1;');
  await recordSourceBuild(root);
  assert.equal(await sourceBuildCurrent(root), true);

  await writeFile(path.join(root, 'scripts/build-template-guide.mjs'), 'export const v = 2;');
  assert.equal(await sourceBuildCurrent(root), false);
});

test('syncInstalledHostSkills does not create missing host directories', async t => {
  const { checkout, fakeHome } = await createGitFixtures(t);
  const synced = await syncInstalledHostSkills(checkout, { homeDirectory: fakeHome, env: {} });
  assert.deepEqual(synced, []);
});

test('syncInstalledHostSkills refreshes consolidated openmotion-video copies in host directories', async t => {
  const { checkout, fakeHome } = await createGitFixtures(t);
  await mkdir(path.join(checkout, 'skills/openmotion-video/workflows'), { recursive: true });
  await writeFile(path.join(checkout, 'skills/openmotion-video/SKILL.md'), '---\nname: openmotion-video\ndescription: updated\n---\nupdated body\n');
  await writeFile(path.join(checkout, 'skills/openmotion-video/workflows/director.md'), '# director\n');

  const installedDir = path.join(fakeHome, '.codex/skills/openmotion-video');
  await mkdir(installedDir, { recursive: true });
  await writeFile(path.join(installedDir, 'SKILL.md'), '---\nname: openmotion-video\ndescription: stale\n---\nstale body\n');

  const synced = await syncInstalledHostSkills(checkout, { homeDirectory: fakeHome, env: {} });
  assert.ok(synced.some(entry => entry.endsWith('openmotion-video')), synced.join(', '));
  assert.match(await readFile(path.join(installedDir, 'SKILL.md'), 'utf8'), /updated body/);
  assert.match(await readFile(path.join(installedDir, 'workflows/director.md'), 'utf8'), /# director/);
});
