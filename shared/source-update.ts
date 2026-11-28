import { workbuddyConfigDirectory } from '../scripts/workbuddy-config.mjs';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, lstat, mkdir, mkdtemp, readdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { editorRequest, readEditor, sharedEditorEnabled } from '../editor-runtime.ts';
import { SOURCE_BUILD_INPUTS, SOURCE_BUILD_OUTPUTS } from '../scripts/source-build-state.mjs';
import { ProcessLockTimeoutError, withProcessLock } from './process-lock.ts';
import { packagedSkills } from './workflow.ts';

const execFileAsync = promisify(execFile);

export const DEFAULT_UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const ERROR_RETRY_BACKOFF_MS = 60 * 60 * 1000;
export const DEFAULT_UPDATE_REMOTE = 'origin';
export const DEFAULT_UPDATE_BRANCH = 'main';
export const UPDATE_STATE_FILENAME = '.update-check.json';
export const UPDATE_LOCK_FILENAME = '.source-update.lock';

const GIT_NO_LFS_ARGS = [
  '-c', 'filter.lfs.process=',
  '-c', 'filter.lfs.smudge=',
  '-c', 'filter.lfs.required=false',
] as const;

const NPM_FALLBACK_REGISTRIES = [
  'https://registry.npmjs.org',
  'https://registry.npmmirror.com',
] as const;

/** Installer-created untracked paths that should not block a clean source update. */
const IGNORED_UNTRACKED_PATHS = new Set([
  '.agents/plugins/marketplace.json',
]);

const MCP_SCHEMA_FILES = new Set([
  'shared/mcp-profiles.json',
  'shared/mcp-registry.ts',
  'shared/phase1-tools.ts',
  'shared/game-tools.ts',
  'shared/design-tools.ts',
  'shared/asset-tools.ts',
  'shared/capability-tools.ts',
  'shared/project-archive.ts',
  'shared/project-management.ts',
]);

function isStudioBuildInputPath(normalizedPath: string): boolean {
  return SOURCE_BUILD_INPUTS.some(
    entry => normalizedPath === entry || normalizedPath.startsWith(`${entry}/`),
  );
}

const SYNCABLE_SKILLS = [
  'opengame',
  'openmotion',
  ...packagedSkills,
] as const;

export type ExecCommandOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeout?: number;
  maxBuffer?: number;
};

export type ExecCommandResult = {
  stdout: string;
  stderr: string;
};

export type ExecRunner = (
  file: string,
  args: readonly string[],
  options?: ExecCommandOptions,
) => Promise<ExecCommandResult>;

export type SourceUpdateState = {
  schemaVersion: 1;
  lastCheckedAt?: number;
  lastAttemptAt?: number;
  lastUpdatedAt?: number;
  lastStatus?: string;
  currentCommit?: string;
  remoteCommit?: string;
  branch?: string;
  lastError?: string;
};

export type SourceEligibilityResult = {
  eligible: boolean;
  status?: 'disabled' | 'unsupported' | 'non_target_branch';
  reason?: string;
  branch?: string;
};

export type SourceUpdateCheckResult = {
  status:
    | 'disabled'
    | 'unsupported'
    | 'non_target_branch'
    | 'skipped_ttl'
    | 'up_to_date'
    | 'update_available'
    | 'check_failed';
  checked: boolean;
  updateAvailable: boolean;
  reason?: string;
  branch?: string;
  currentCommit?: string;
  remoteCommit?: string;
  lastCheckedAt?: number;
  error?: string;
};

export type ChangedFileClassification = {
  skillChanged: boolean;
  gameSkillChanged: boolean;
  changedSkills: string[];
  mcpSchemaChanged: boolean;
  studioInputChanged: boolean;
  lockfileChanged: boolean;
};

export type SourceUpdateApplyResult = {
  status:
    | 'disabled'
    | 'unsupported'
    | 'non_target_branch'
    | 'dirty_worktree'
    | 'non_fast_forward'
    | 'up_to_date'
    | 'updated'
    | 'failed_rolled_back'
    | 'failed';
  updated: boolean;
  reason?: string;
  branch?: string;
  previousCommit?: string;
  currentCommit?: string;
  changedFilesCount?: number;
  skillChanged?: boolean;
  gameSkillChanged?: boolean;
  changedSkills?: string[];
  mcpSchemaChanged?: boolean;
  depsInstalled?: boolean;
  studioRebuilt?: boolean;
  syncedSkills?: string[];
  restarted?: boolean;
  restartDeferred?: boolean;
  rolledBack?: boolean;
  dirtyFiles?: string[];
  error?: string;
};

export type RuntimeUpdateNotice = {
  status: 'updated';
  previousCommit: string;
  currentCommit: string;
  skillChanged: boolean;
  gameSkillChanged: boolean;
  changedSkills: string[];
  mcpSchemaChanged: boolean;
  depsInstalled: boolean;
  studioRebuilt: boolean;
  restarted: boolean;
  restartDeferred: boolean;
};

export type SourceUpdateOptions = {
  repoRoot?: string;
  dataDirectory: string;
  force?: boolean;
  automatic?: boolean;
  remote?: string;
  branch?: string;
  intervalMs?: number;
  now?: () => number;
  env?: NodeJS.ProcessEnv;
  homeDirectory?: string;
  restartBackend?: boolean;
  exec?: ExecRunner;
  shutdownBackend?: (dataDirectory: string) => Promise<{ restarted: boolean; deferred: boolean }>;
};

const defaultRepoRoot = fileURLToPath(new URL('../', import.meta.url));

async function defaultExec(
  file: string,
  args: readonly string[],
  options: ExecCommandOptions = {},
): Promise<ExecCommandResult> {
  const result = await execFileAsync(file, [...args], {
    cwd: options.cwd,
    env: options.env,
    timeout: options.timeout ?? 60_000,
    maxBuffer: options.maxBuffer ?? 16 * 1024 * 1024,
    windowsHide: true,
  });
  return {
    stdout: String(result.stdout ?? ''),
    stderr: String(result.stderr ?? ''),
  };
}

function normalizeRelativePath(value: string): string {
  return value.replaceAll('\\', '/').replace(/^\.\//, '');
}

function parseAutoUpdateFlag(env: NodeJS.ProcessEnv): 'enabled' | 'disabled' | 'default' {
  const raw = env.OPENMOTION_AUTO_UPDATE?.trim().toLowerCase();
  if (!raw) return 'default';
  if (['0', 'false', 'off', 'no'].includes(raw)) return 'disabled';
  if (['1', 'true', 'on', 'yes'].includes(raw)) return 'enabled';
  return 'default';
}

export function resolveCheckIntervalMs(env: NodeJS.ProcessEnv, override?: number): number {
  if (typeof override === 'number' && Number.isFinite(override) && override >= 0) return override;
  const raw = env.OPENMOTION_UPDATE_CHECK_INTERVAL_MS?.trim();
  if (raw) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return DEFAULT_UPDATE_CHECK_INTERVAL_MS;
}

function isAutomatedTestRuntime(env: NodeJS.ProcessEnv): boolean {
  return (
    env.CI === 'true'
    || env.CI === '1'
    || Boolean(env.NODE_TEST_CONTEXT)
    || process.execArgv.includes('--test')
  );
}

export function classifyChangedFiles(files: readonly string[]): ChangedFileClassification {
  let skillChanged = false;
  let gameSkillChanged = false;
  const changedSkills = new Set<string>();
  let mcpSchemaChanged = false;
  let studioInputChanged = false;
  let lockfileChanged = false;

  for (const raw of files) {
    const file = normalizeRelativePath(raw);
    if (!file) continue;
    const skillMatch = /^skills\/([^/]+)\//.exec(file);
    if (skillMatch) {
      skillChanged = true;
      changedSkills.add(skillMatch[1]);
      if (skillMatch[1] === 'openmotion-game') gameSkillChanged = true;
    }
    if (MCP_SCHEMA_FILES.has(file)) mcpSchemaChanged = true;
    if (file === 'package-lock.json') lockfileChanged = true;
    if (isStudioBuildInputPath(file)) {
      studioInputChanged = true;
    }
  }

  return {
    skillChanged,
    gameSkillChanged,
    changedSkills: [...changedSkills].sort(),
    mcpSchemaChanged,
    studioInputChanged,
    lockfileChanged,
  };
}

/**
 * Returns true when an MCP tool call starts a new creation or generation across
 * any OpenMotion domain (game, video/motion, design, or multimodal media).
 * Read-only queries, edits, polling, and dryRun probes never trigger checks.
 */
export function shouldAutoUpdateForToolCall(toolName: string, args: unknown): boolean {
  const input = args && typeof args === 'object' && !Array.isArray(args)
    ? args as Record<string, unknown>
    : undefined;
  switch (toolName) {
    case 'openmotion_game_create':
    case 'openmotion_create_project':
      return true;
    case 'openmotion_design_project':
      return input?.action === 'create';
    case 'openmotion_capability_run':
      return input?.dryRun !== true;
    case 'openmotion_assets_use':
    case 'openmotion_assets':
    case 'openmotion_media_use':
      return input?.action === 'generate';
    default:
      return false;
  }
}

const ERROR_BACKOFF_STATUSES = new Set(['check_failed', 'failed', 'failed_rolled_back']);

export function isUpdateCheckFresh(
  state: SourceUpdateState | null,
  now: number,
  intervalMs: number,
): boolean {
  if (!state) return false;
  if (
    state.lastStatus
    && ERROR_BACKOFF_STATUSES.has(state.lastStatus)
    && typeof state.lastAttemptAt === 'number'
    && Number.isFinite(state.lastAttemptAt)
  ) {
    return now >= state.lastAttemptAt && now - state.lastAttemptAt < Math.min(intervalMs, ERROR_RETRY_BACKOFF_MS);
  }
  if (
    typeof state.lastCheckedAt === 'number'
    && Number.isFinite(state.lastCheckedAt)
    && now >= state.lastCheckedAt
    && now - state.lastCheckedAt < intervalMs
  ) {
    return true;
  }
  return false;
}

export async function readUpdateState(dataDirectory: string): Promise<SourceUpdateState | null> {
  const file = path.join(dataDirectory, UPDATE_STATE_FILENAME);
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || parsed.schemaVersion !== 1) return null;
    return parsed as SourceUpdateState;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || error instanceof SyntaxError) return null;
    throw error;
  }
}

export async function writeUpdateState(dataDirectory: string, patch: Partial<SourceUpdateState>): Promise<SourceUpdateState> {
  await mkdir(dataDirectory, { recursive: true });
  const existing = (await readUpdateState(dataDirectory).catch(() => null)) ?? { schemaVersion: 1 as const };
  const next: SourceUpdateState = { ...existing, ...patch, schemaVersion: 1 };
  const file = path.join(dataDirectory, UPDATE_STATE_FILENAME);
  const temporary = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(next, null, 2) + '\n', { mode: 0o600 });
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
  return next;
}

function gitEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...env,
    GIT_TERMINAL_PROMPT: '0',
    GIT_LFS_SKIP_SMUDGE: '1',
  };
}

async function runGit(
  exec: ExecRunner,
  repoRoot: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  timeout = 15_000,
): Promise<ExecCommandResult> {
  return exec('git', [...GIT_NO_LFS_ARGS, ...args], {
    cwd: repoRoot,
    env: gitEnv(env),
    timeout,
  });
}

export async function detectSourceCheckoutEligibility(options: {
  repoRoot?: string;
  automatic?: boolean;
  branch?: string;
  env?: NodeJS.ProcessEnv;
  exec?: ExecRunner;
}): Promise<SourceEligibilityResult> {
  const repoRoot = options.repoRoot ?? defaultRepoRoot;
  const env = options.env ?? process.env;
  const exec = options.exec ?? defaultExec;
  const targetBranch = options.branch ?? env.OPENMOTION_UPDATE_BRANCH ?? DEFAULT_UPDATE_BRANCH;
  const flag = parseAutoUpdateFlag(env);

  if (options.automatic) {
    if (flag === 'disabled') return { eligible: false, status: 'disabled', reason: 'disabled_by_env' };
    if (env.OPENMOTION_DEPLOYMENT_MODE?.trim().toLowerCase() === 'cloud') {
      return { eligible: false, status: 'unsupported', reason: 'cloud_deployment' };
    }
    if (flag !== 'enabled' && isAutomatedTestRuntime(env)) {
      return { eligible: false, status: 'disabled', reason: 'test_or_ci_runtime' };
    }
  }

  if (existsSync(path.join(repoRoot, '.npm-install.json'))) {
    return { eligible: false, status: 'unsupported', reason: 'npm_managed_installation' };
  }
  if (!existsSync(path.join(repoRoot, '.git'))) {
    return { eligible: false, status: 'unsupported', reason: 'not_git_checkout' };
  }

  try {
    const branchResult = await runGit(exec, repoRoot, ['symbolic-ref', '--quiet', '--short', 'HEAD'], env, 5_000);
    const currentBranch = branchResult.stdout.trim();
    if (!currentBranch || currentBranch !== targetBranch) {
      return {
        eligible: false,
        status: 'non_target_branch',
        reason: `checked_out_on_${currentBranch || 'detached'}`,
        branch: currentBranch || undefined,
      };
    }
    return { eligible: true, branch: currentBranch };
  } catch {
    return {
      eligible: false,
      status: 'non_target_branch',
      reason: 'detached_or_unreadable_head',
    };
  }
}

export function parseDirtyWorktreeFiles(porcelainZOutput: string): string[] {
  const dirty: string[] = [];
  const tokens = porcelainZOutput.split('\0');
  for (let i = 0; i < tokens.length; i++) {
    const entry = tokens[i];
    if (!entry || entry.length < 4) continue;
    const status = entry.slice(0, 2);
    const file = normalizeRelativePath(entry.slice(3));
    // Renames/copies emit an extra NUL-separated source path.
    if (status[0] === 'R' || status[0] === 'C') i++;
    if (status === '??' && IGNORED_UNTRACKED_PATHS.has(file)) continue;
    dirty.push(file);
  }
  return dirty;
}

function parseRemoteBranchSha(lsRemoteOutput: string, branch: string): string | null {
  const expectedRef = `refs/heads/${branch}`;
  for (const line of lsRemoteOutput.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [sha, ref] = trimmed.split(/\s+/);
    if (ref === expectedRef && sha && /^[a-f0-9]{40}$/i.test(sha)) {
      return sha.toLowerCase();
    }
  }
  return null;
}

export async function checkSourceUpdate(options: SourceUpdateOptions): Promise<SourceUpdateCheckResult> {
  const repoRoot = options.repoRoot ?? defaultRepoRoot;
  const env = options.env ?? process.env;
  const exec = options.exec ?? defaultExec;
  const now = (options.now ?? Date.now)();
  const remote = options.remote ?? env.OPENMOTION_UPDATE_REMOTE ?? DEFAULT_UPDATE_REMOTE;
  const branch = options.branch ?? env.OPENMOTION_UPDATE_BRANCH ?? DEFAULT_UPDATE_BRANCH;
  const intervalMs = resolveCheckIntervalMs(env, options.intervalMs);

  const eligibility = await detectSourceCheckoutEligibility({
    repoRoot,
    automatic: options.automatic,
    branch,
    env,
    exec,
  });
  if (!eligibility.eligible) {
    return {
      status: eligibility.status ?? 'unsupported',
      checked: false,
      updateAvailable: false,
      reason: eligibility.reason,
      branch: eligibility.branch,
    };
  }

  if (!options.force) {
    const cached = await readUpdateState(options.dataDirectory).catch(() => null);
    if (isUpdateCheckFresh(cached, now, intervalMs)) {
      return {
        status: 'skipped_ttl',
        checked: false,
        updateAvailable: false,
        branch,
        currentCommit: cached?.currentCommit,
        remoteCommit: cached?.remoteCommit,
        lastCheckedAt: cached?.lastCheckedAt,
      };
    }
  }

  let currentCommit: string;
  try {
    currentCommit = (await runGit(exec, repoRoot, ['rev-parse', 'HEAD'], env, 5_000)).stdout.trim().toLowerCase();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await writeUpdateState(options.dataDirectory, {
      lastAttemptAt: now,
      lastStatus: 'check_failed',
      branch,
      lastError: message.slice(0, 500),
    }).catch(() => {});
    return { status: 'check_failed', checked: false, updateAvailable: false, branch, error: message };
  }

  try {
    const remoteResult = await runGit(
      exec,
      repoRoot,
      ['ls-remote', '--heads', remote, branch],
      env,
      5_000,
    );
    const remoteCommit = parseRemoteBranchSha(remoteResult.stdout, branch);
    if (!remoteCommit) {
      throw new Error(`Remote branch ${remote}/${branch} not found`);
    }
    const updateAvailable = remoteCommit !== currentCommit;
    const status = updateAvailable ? 'update_available' : 'up_to_date';
    await writeUpdateState(options.dataDirectory, {
      lastCheckedAt: now,
      lastAttemptAt: now,
      lastStatus: status,
      currentCommit,
      remoteCommit,
      branch,
      lastError: undefined,
    }).catch(() => {});
    return {
      status,
      checked: true,
      updateAvailable,
      branch,
      currentCommit,
      remoteCommit,
      lastCheckedAt: now,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await writeUpdateState(options.dataDirectory, {
      lastAttemptAt: now,
      lastStatus: 'check_failed',
      currentCommit,
      branch,
      lastError: message.slice(0, 500),
    }).catch(() => {});
    return {
      status: 'check_failed',
      checked: false,
      updateAvailable: false,
      branch,
      currentCommit,
      error: message,
    };
  }
}

function resolveNpmCommand(env: NodeJS.ProcessEnv): { command: string; prefixArgs: string[] } {
  const execPath = env.npm_execpath;
  if (execPath && /\.[cm]?js$/i.test(execPath) && existsSync(execPath)) {
    return { command: process.execPath, prefixArgs: [execPath] };
  }
  const bundledNpm = path.join(
    path.dirname(process.execPath),
    process.platform === 'win32' ? 'node_modules/npm/bin/npm-cli.js' : '../lib/node_modules/npm/bin/npm-cli.js',
  );
  if (existsSync(bundledNpm)) {
    return { command: process.execPath, prefixArgs: [bundledNpm] };
  }
  return { command: process.platform === 'win32' ? 'npm.cmd' : 'npm', prefixArgs: [] };
}

const DEFAULT_NPM_REGISTRY = 'https://registry.npmjs.org';

function normalizeRegistryUrl(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed || !/^https?:\/\//i.test(trimmed)) return null;
  return trimmed.replace(/\/+$/, '').toLowerCase();
}

async function readConfiguredNpmRegistry(
  exec: ExecRunner,
  repoRoot: string,
  env: NodeJS.ProcessEnv,
): Promise<string | null> {
  const fromEnv = normalizeRegistryUrl(env.npm_config_registry);
  if (fromEnv) return fromEnv;
  const { command, prefixArgs } = resolveNpmCommand(env);
  try {
    const result = await exec(command, [...prefixArgs, 'config', 'get', 'registry'], {
      cwd: repoRoot,
      env,
      timeout: 10_000,
    });
    return normalizeRegistryUrl(result.stdout);
  } catch {
    return null;
  }
}

async function runNpmCiWithFallback(
  exec: ExecRunner,
  repoRoot: string,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  const { command, prefixArgs } = resolveNpmCommand(env);
  const args = [...prefixArgs, 'ci', '--include=dev', '--no-audit', '--no-fund'];
  const configuredRegistry = await readConfiguredNpmRegistry(exec, repoRoot, env);
  if (configuredRegistry && configuredRegistry !== DEFAULT_NPM_REGISTRY) {
    await exec(command, args, { cwd: repoRoot, env, timeout: 180_000 });
    return;
  }
  let lastError: unknown;
  for (const registry of NPM_FALLBACK_REGISTRIES) {
    try {
      await exec(command, args, {
        cwd: repoRoot,
        env: { ...env, npm_config_registry: registry, npm_config_fetch_retries: '0' },
        timeout: 180_000,
      });
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

async function runStudioBuild(
  exec: ExecRunner,
  repoRoot: string,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  const { command, prefixArgs } = resolveNpmCommand(env);
  await exec(command, [...prefixArgs, 'run', 'build:studio'], {
    cwd: repoRoot,
    env,
    timeout: 180_000,
  });
}

async function loadBuildStateModule(repoRoot: string): Promise<{
  dependenciesCurrent: (root: string, options?: { inspectInstalledLock?: boolean }) => Promise<boolean>;
  recordDependencies: (root: string) => Promise<void>;
  sourceBuildCurrent: (root: string) => Promise<boolean>;
  recordSourceBuild: (root: string) => Promise<void>;
} | null> {
  const scriptPath = path.join(repoRoot, 'scripts/source-build-state.mjs');
  if (!existsSync(scriptPath)) return null;
  return import(pathToFileURL(scriptPath).href);
}

async function isInsideDirectory(parent: string, child: string): Promise<boolean> {
  try {
    const [realParent, realChild] = await Promise.all([realpath(parent), realpath(child)]);
    const relative = path.relative(realParent, realChild);
    return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
  } catch {
    return false;
  }
}

export async function syncInstalledHostSkills(
  repoRoot: string,
  options: { homeDirectory?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<string[]> {
  const home = options.homeDirectory ?? os.homedir();
  const env = options.env ?? process.env;
  const candidateRoots = [...new Set([
    path.join(home, '.agents/skills'),
    path.join(env.CLAUDE_CONFIG_DIR || path.join(home, '.claude'), 'skills'),
    path.join(env.CODEX_HOME || path.join(home, '.codex'), 'skills'),
    path.join(workbuddyConfigDirectory(home, env), 'skills'),
    ...(!env.WORKBUDDY_CONFIG_DIR?.trim() ? [path.join(home, '.workbuddy', 'skills')] : []),
    path.join(home, '.cursor/skills'),
  ])];

  const synced: string[] = [];
  for (const skill of SYNCABLE_SKILLS) {
    const sourceDir = path.join(repoRoot, 'skills', skill);
    if (!existsSync(path.join(sourceDir, 'SKILL.md'))) continue;

    for (const rootDir of candidateRoots) {
      const targetDir = path.join(rootDir, skill);
      const info = await lstat(targetDir).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
      if (!info || info.isSymbolicLink() || !info.isDirectory()) continue;
      if (await isInsideDirectory(repoRoot, targetDir)) continue;

      // Never overwrite npm-managed installer bundles.
      const scopeRaw = await readFile(path.join(targetDir, 'scope.json'), 'utf8').catch(() => null);
      if (scopeRaw) {
        try {
          const scope = JSON.parse(scopeRaw);
          if (scope?.managedBy === '@openmotion/installer') continue;
        } catch {
          // Ignore malformed scope metadata and verify SKILL.md ownership below.
        }
      }

      // Only overwrite directories verified to contain this exact OpenMotion skill.
      const existingSkillMd = await readFile(path.join(targetDir, 'SKILL.md'), 'utf8').catch(() => '');
      const namePattern = new RegExp(`^name:\\s*${skill}\\s*$`, 'm');
      if (!namePattern.test(existingSkillMd)) continue;

      const stage = await mkdtemp(path.join(rootDir, `.openmotion-sync-${skill}-`));
      const backup = `${stage}-backup`;
      let movedOld = false;
      let movedNew = false;
      try {
        await cp(sourceDir, stage, { recursive: true });
        await rename(targetDir, backup);
        movedOld = true;
        await rename(stage, targetDir);
        movedNew = true;
        await rm(backup, { recursive: true, force: true }).catch(() => {});
        synced.push(targetDir);
      } catch {
        if (movedNew) await rm(targetDir, { recursive: true, force: true }).catch(() => {});
        if (movedOld) await rename(backup, targetDir).catch(() => {});
      } finally {
        await rm(stage, { recursive: true, force: true }).catch(() => {});
      }
    }
  }
  return synced;
}

type PreviewHealthProbe = {
  service?: string;
  dataDirectory?: string;
  activeWork?: boolean;
};

export type PreviewShutdownDeps = {
  probeHealth?: (port: number) => Promise<PreviewHealthProbe | null>;
  killProcess?: (pid: number, signal: NodeJS.Signals) => void;
  isPidAlive?: (pid: number) => boolean;
  now?: () => number;
  waitMs?: number;
  pollIntervalMs?: number;
};

async function normalizeDirectoryForCompare(dir: string): Promise<string> {
  const resolved = await realpath(dir).catch(() => path.resolve(dir));
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

const ACTIVE_EXPORT_JOB_STATES = new Set(['pending', 'running', 'cancelling']);

function defaultIsPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException)?.code === 'EPERM';
  }
}

function isExportJobActive(job: unknown, nowMs: number, isPidAlive: (pid: number) => boolean): boolean {
  if (!job || typeof job !== 'object') return false;
  const record = job as { state?: unknown; expiresAt?: unknown; workerPid?: unknown };
  if (typeof record.state !== 'string' || !ACTIVE_EXPORT_JOB_STATES.has(record.state)) return false;
  if (typeof record.expiresAt !== 'number' || !Number.isFinite(record.expiresAt) || record.expiresAt <= nowMs) {
    return false;
  }
  if (record.state === 'pending') return true;
  return typeof record.workerPid === 'number' && Number.isInteger(record.workerPid) && isPidAlive(record.workerPid);
}

function isGatewayJobActive(job: unknown, isPidAlive: (pid: number) => boolean): boolean {
  if (!job || typeof job !== 'object') return false;
  const record = job as { state?: unknown; workerPid?: unknown };
  if (record.state === 'queued') return true;
  if (record.state === 'running') {
    return typeof record.workerPid === 'number' && Number.isInteger(record.workerPid) && isPidAlive(record.workerPid);
  }
  return false;
}

async function hasActiveWorkspaceJob(
  dataDirectory: string,
  nowMs: number,
  isPidAlive: (pid: number) => boolean,
): Promise<boolean> {
  const seenExportIds = new Set<string>();

  // 1) Authoritative per-export records (<dataDirectory>/jobs/<id>/job.json)
  try {
    const entries = await readdir(path.join(dataDirectory, 'jobs'), { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        const job = JSON.parse(await readFile(path.join(dataDirectory, 'jobs', entry.name, 'job.json'), 'utf8'));
        const id = typeof job?.id === 'string' ? job.id : entry.name;
        seenExportIds.add(id);
        if (isExportJobActive(job, nowMs, isPidAlive)) {
          return true;
        }
      } catch {
        // Ignore individual missing or unreadable job files.
      }
    }
  } catch {
    // Missing jobs/ directory.
  }

  // 2) Current export mirror (<dataDirectory>/export.json), unless superseded by jobs/<id>/job.json
  try {
    const current = JSON.parse(await readFile(path.join(dataDirectory, 'export.json'), 'utf8'));
    const alreadyChecked = typeof current?.id === 'string' && seenExportIds.has(current.id);
    if (!alreadyChecked && isExportJobActive(current, nowMs, isPidAlive)) {
      return true;
    }
  } catch {
    // Missing or unreadable export.json.
  }

  // 3) Active Model Gateway generation jobs (<dataDirectory>/model-gateway/jobs/<id>.json)
  try {
    const files = await readdir(path.join(dataDirectory, 'model-gateway', 'jobs'));
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      try {
        const job = JSON.parse(await readFile(path.join(dataDirectory, 'model-gateway', 'jobs', file), 'utf8'));
        if (isGatewayJobActive(job, isPidAlive)) {
          return true;
        }
      } catch {
        // Ignore individual unreadable gateway job files.
      }
    }
  } catch {
    // Missing model-gateway/jobs/ directory.
  }

  return false;
}

export async function shutdownPreviewService(
  dataDirectory: string,
  deps: PreviewShutdownDeps = {},
): Promise<{ restarted: boolean; deferred: boolean }> {
  const resolvedDataDir = path.resolve(dataDirectory);
  let registration: { port?: unknown; pid?: unknown };
  try {
    registration = JSON.parse(await readFile(path.join(resolvedDataDir, 'preview.json'), 'utf8'));
  } catch {
    return { restarted: false, deferred: false };
  }
  const port = registration?.port;
  if (typeof port !== 'number' || !Number.isInteger(port) || port < 1024 || port > 65535) {
    return { restarted: false, deferred: false };
  }

  const probeHealth = deps.probeHealth ?? (async (targetPort: number): Promise<PreviewHealthProbe | null> => {
    try {
      const response = await fetch(`http://127.0.0.1:${targetPort}/api/health`, {
        signal: AbortSignal.timeout(1_200),
      });
      if (!response.ok) return null;
      return await response.json() as PreviewHealthProbe;
    } catch {
      return null;
    }
  });

  const expectedDataDir = await normalizeDirectoryForCompare(resolvedDataDir);
  const matchesWorkspace = async (health: PreviewHealthProbe | null): Promise<boolean> => {
    if (!health || health.service !== 'motion-preview' || typeof health.dataDirectory !== 'string') {
      return false;
    }
    return (await normalizeDirectoryForCompare(health.dataDirectory)) === expectedDataDir;
  };

  const health = await probeHealth(port);
  if (!(await matchesWorkspace(health))) {
    return { restarted: false, deferred: false };
  }

  const nowMs = (deps.now ?? Date.now)();
  const isPidAlive = deps.isPidAlive ?? defaultIsPidAlive;
  if (health?.activeWork === true || await hasActiveWorkspaceJob(resolvedDataDir, nowMs, isPidAlive)) {
    return { restarted: false, deferred: true };
  }

  const pid = registration?.pid;
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 1 || pid === process.pid) {
    // Live server belongs to this workspace, but no safe external PID is available to stop.
    return { restarted: false, deferred: true };
  }

  const killProcess = deps.killProcess ?? ((targetPid: number, signal: NodeJS.Signals) => {
    process.kill(targetPid, signal);
  });

  try {
    killProcess(pid, 'SIGTERM');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code !== 'ESRCH') {
      return { restarted: false, deferred: true };
    }
  }

  const deadline = Date.now() + (deps.waitMs ?? 3_000);
  const pollInterval = deps.pollIntervalMs ?? 100;
  while (Date.now() <= deadline) {
    const stillUp = await probeHealth(port);
    if (!(await matchesWorkspace(stillUp))) {
      return { restarted: true, deferred: false };
    }
    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }
  return { restarted: false, deferred: true };
}

export async function defaultShutdownIdleBackend(
  dataDirectory: string,
  options: { useSharedEditor?: boolean; previewDeps?: PreviewShutdownDeps } = {},
): Promise<{ restarted: boolean; deferred: boolean }> {
  const useSharedEditor = options.useSharedEditor ?? sharedEditorEnabled;
  if (!useSharedEditor) {
    return shutdownPreviewService(dataDirectory, options.previewDeps);
  }
  const editor = await readEditor(dataDirectory).catch(() => null);
  if (!editor) return { restarted: false, deferred: false };
  try {
    await editorRequest(editor, '/editor-api/shutdown', {}, 5_000);
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status === 409) return { restarted: false, deferred: true };
    // Daemon may already have exited; verify below.
  }
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const stillRunning = await readEditor(dataDirectory).catch(() => null);
    if (!stillRunning) return { restarted: true, deferred: false };
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  return { restarted: false, deferred: true };
}

const BUILD_OUTPUT_RELATIVE_PATHS = SOURCE_BUILD_OUTPUTS;

export type BuildOutputBackupSet = {
  rootDir: string;
  entries: Array<{ target: string; backup: string }>;
};

export async function backupBuildOutputs(
  repoRoot: string,
  move: (src: string, dest: string) => Promise<void> = rename,
): Promise<BuildOutputBackupSet> {
  // Store backups under gitignored .artifacts/install so mid-build crashes or
  // cleanup errors never leave untracked files that trigger dirty_worktree.
  const backupBase = path.join(repoRoot, '.artifacts/install');
  await mkdir(backupBase, { recursive: true });
  const rootDir = await mkdtemp(path.join(backupBase, 'update-rollback-'));
  const entries: Array<{ target: string; backup: string }> = [];
  try {
    for (const rel of BUILD_OUTPUT_RELATIVE_PATHS) {
      const target = path.join(repoRoot, rel);
      if (!existsSync(target)) continue;
      const backup = path.join(rootDir, rel);
      await mkdir(path.dirname(backup), { recursive: true });
      await move(target, backup);
      entries.push({ target, backup });
    }
    return { rootDir, entries };
  } catch (error) {
    await restoreBuildOutputs({ rootDir, entries }, move);
    throw error;
  }
}

export async function restoreBuildOutputs(
  backups: BuildOutputBackupSet | null,
  move: (src: string, dest: string) => Promise<void> = rename,
): Promise<boolean> {
  if (!backups) return true;
  let allRestored = true;
  for (const item of [...backups.entries].reverse()) {
    if (!existsSync(item.backup)) continue;
    try {
      await rm(item.target, { recursive: true, force: true });
      await mkdir(path.dirname(item.target), { recursive: true });
      await move(item.backup, item.target);
    } catch {
      allRestored = false;
    }
  }
  if (allRestored) {
    await rm(backups.rootDir, { recursive: true, force: true }).catch(() => {});
  }
  return allRestored;
}

export async function discardBuildBackups(backups: BuildOutputBackupSet | null): Promise<void> {
  if (!backups) return;
  await rm(backups.rootDir, { recursive: true, force: true }).catch(() => {});
}

async function isAncestor(
  exec: ExecRunner,
  repoRoot: string,
  ancestor: string,
  descendant: string,
  env: NodeJS.ProcessEnv,
): Promise<boolean> {
  try {
    await runGit(exec, repoRoot, ['merge-base', '--is-ancestor', ancestor, descendant], env, 5_000);
    return true;
  } catch (error) {
    // git merge-base --is-ancestor exits 1 strictly when not an ancestor;
    // any other exit code, signal, or timeout is a genuine command error.
    const exitCode = (error as { code?: unknown }).code;
    if (exitCode === 1) return false;
    throw error;
  }
}

export async function applySourceUpdate(options: SourceUpdateOptions): Promise<SourceUpdateApplyResult> {
  const repoRoot = options.repoRoot ?? defaultRepoRoot;
  const env = options.env ?? process.env;
  const exec = options.exec ?? defaultExec;
  const now = (options.now ?? Date.now)();
  const remote = options.remote ?? env.OPENMOTION_UPDATE_REMOTE ?? DEFAULT_UPDATE_REMOTE;
  const branch = options.branch ?? env.OPENMOTION_UPDATE_BRANCH ?? DEFAULT_UPDATE_BRANCH;
  const restartBackend = options.restartBackend !== false;

  const eligibility = await detectSourceCheckoutEligibility({
    repoRoot,
    automatic: options.automatic,
    branch,
    env,
    exec,
  });
  if (!eligibility.eligible) {
    return {
      status: eligibility.status ?? 'unsupported',
      updated: false,
      reason: eligibility.reason,
      branch: eligibility.branch,
    };
  }

  await mkdir(options.dataDirectory, { recursive: true });
  // Workspaces share this checkout's Git state, dependencies and build outputs.
  // Keep their updates serialized even when each has a different data directory.
  const lockPath = path.join(repoRoot, '.artifacts', 'install', UPDATE_LOCK_FILENAME);
  let enteredUpdate = false;

  return withProcessLock<SourceUpdateApplyResult>(lockPath, async () => {
    enteredUpdate = true;
    const readDirtyWorktreeFiles = async () => {
      const statusResult = await runGit(
        exec,
        repoRoot,
        ['status', '--porcelain=v1', '-z', '--untracked-files=all'],
        env,
        10_000,
      );
      return parseDirtyWorktreeFiles(statusResult.stdout);
    };
    const dirtyFiles = await readDirtyWorktreeFiles();
    if (dirtyFiles.length > 0) {
      await writeUpdateState(options.dataDirectory, {
        lastCheckedAt: now,
        lastAttemptAt: now,
        lastStatus: 'dirty_worktree',
        branch,
      }).catch(() => {});
      return {
        status: 'dirty_worktree',
        updated: false,
        branch,
        dirtyFiles,
      };
    }

    const previousCommit = (await runGit(exec, repoRoot, ['rev-parse', 'HEAD'], env, 5_000)).stdout.trim().toLowerCase();
    const trackingRefName = `refs/remotes/${remote}/${branch}`;
    let trackingCommit: string | null = null;
    try {
      trackingCommit = (await runGit(exec, repoRoot, ['rev-parse', '--verify', trackingRefName], env, 5_000)).stdout.trim().toLowerCase();
    } catch {
      trackingCommit = null;
    }

    if (trackingCommit && trackingCommit !== previousCommit) {
      let behindTracking: boolean;
      try {
        behindTracking = await isAncestor(exec, repoRoot, previousCommit, trackingCommit, env);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await writeUpdateState(options.dataDirectory, {
          lastCheckedAt: undefined,
          lastAttemptAt: now,
          lastStatus: 'failed',
          currentCommit: previousCommit,
          branch,
          lastError: message.slice(0, 500),
        }).catch(() => {});
        return {
          status: 'failed',
          updated: false,
          branch,
          previousCommit,
          currentCommit: previousCommit,
          error: message,
        };
      }
      if (!behindTracking) {
        await writeUpdateState(options.dataDirectory, {
          lastCheckedAt: now,
          lastAttemptAt: now,
          lastStatus: 'non_fast_forward',
          currentCommit: previousCommit,
          branch,
          lastError: undefined,
        }).catch(() => {});
        return {
          status: 'non_fast_forward',
          updated: false,
          reason: 'local_commits_ahead',
          branch,
          previousCommit,
          currentCommit: previousCommit,
        };
      }
    }

    let isShallow = false;
    try {
      isShallow = (await runGit(exec, repoRoot, ['rev-parse', '--is-shallow-repository'], env, 5_000)).stdout.trim() === 'true';
    } catch {
      isShallow = false;
    }

    try {
      if (isShallow) {
        let fetchedWithSince = false;
        try {
          const tsRaw = (await runGit(exec, repoRoot, ['show', '-s', '--format=%ct', 'HEAD'], env, 5_000)).stdout.trim();
          const ts = Number(tsRaw);
          if (Number.isFinite(ts) && ts > 60) {
            await runGit(
              exec,
              repoRoot,
              ['fetch', `--shallow-since=@${Math.floor(ts) - 60}`, '--no-tags', remote, branch],
              env,
              60_000,
            );
            fetchedWithSince = true;
          }
        } catch {
          fetchedWithSince = false;
        }
        if (!fetchedWithSince) {
          // Do not fall back to --depth 1, which severs ancestry and causes
          // legitimate fast-forwards to be misclassified as non_fast_forward.
          await runGit(exec, repoRoot, ['fetch', '--unshallow', '--no-tags', remote, branch], env, 60_000);
        }
      } else {
        await runGit(exec, repoRoot, ['fetch', '--no-tags', remote, branch], env, 60_000);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await writeUpdateState(options.dataDirectory, {
        lastCheckedAt: undefined,
        lastAttemptAt: now,
        lastStatus: 'failed',
        currentCommit: previousCommit,
        branch,
        lastError: message.slice(0, 500),
      }).catch(() => {});
      return {
        status: 'failed',
        updated: false,
        branch,
        previousCommit,
        currentCommit: previousCommit,
        error: message,
      };
    }

    const targetCommit = (await runGit(exec, repoRoot, ['rev-parse', 'FETCH_HEAD'], env, 5_000)).stdout.trim().toLowerCase();
    if (targetCommit === previousCommit) {
      await writeUpdateState(options.dataDirectory, {
        lastCheckedAt: now,
        lastAttemptAt: now,
        lastStatus: 'up_to_date',
        currentCommit: previousCommit,
        remoteCommit: targetCommit,
        branch,
        lastError: undefined,
      }).catch(() => {});
      return {
        status: 'up_to_date',
        updated: false,
        branch,
        previousCommit,
        currentCommit: previousCommit,
      };
    }

    let fastForward: boolean;
    try {
      fastForward = await isAncestor(exec, repoRoot, previousCommit, targetCommit, env);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await writeUpdateState(options.dataDirectory, {
        lastCheckedAt: undefined,
        lastAttemptAt: now,
        lastStatus: 'failed',
        currentCommit: previousCommit,
        remoteCommit: targetCommit,
        branch,
        lastError: message.slice(0, 500),
      }).catch(() => {});
      return {
        status: 'failed',
        updated: false,
        branch,
        previousCommit,
        currentCommit: previousCommit,
        error: message,
      };
    }
    if (!fastForward) {
      await writeUpdateState(options.dataDirectory, {
        lastCheckedAt: now,
        lastAttemptAt: now,
        lastStatus: 'non_fast_forward',
        currentCommit: previousCommit,
        remoteCommit: targetCommit,
        branch,
        lastError: undefined,
      }).catch(() => {});
      return {
        status: 'non_fast_forward',
        updated: false,
        reason: 'diverged_from_remote',
        branch,
        previousCommit,
        currentCommit: previousCommit,
      };
    }

    let changedFiles: string[] = [];
    try {
      const diffResult = await runGit(exec, repoRoot, ['diff', '--name-only', previousCommit, targetCommit], env, 10_000);
      changedFiles = diffResult.stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    } catch {
      // If shallow history cannot diff directly, conservatively flag build/skill checks.
      changedFiles = ['package-lock.json', 'studio/index.html', 'skills/openmotion-game/SKILL.md'];
    }
    const classification = classifyChangedFiles(changedFiles);

    // Re-check worktree cleanliness immediately before reset --hard so edits saved
    // while git fetch was in flight are never discarded.
    const dirtyBeforeReset = await readDirtyWorktreeFiles();
    if (dirtyBeforeReset.length > 0) {
      await writeUpdateState(options.dataDirectory, {
        lastCheckedAt: now,
        lastAttemptAt: now,
        lastStatus: 'dirty_worktree',
        currentCommit: previousCommit,
        remoteCommit: targetCommit,
        branch,
        lastError: undefined,
      }).catch(() => {});
      return {
        status: 'dirty_worktree',
        updated: false,
        reason: 'Local modifications detected before applying update',
        branch,
        previousCommit,
        currentCommit: previousCommit,
        dirtyFiles: dirtyBeforeReset,
      };
    }

    await runGit(exec, repoRoot, ['reset', '--hard', targetCommit], env, 30_000);

    let depsInstalled = false;
    let depsAttempted = false;
    let studioRebuilt = false;
    let buildBackups: BuildOutputBackupSet | null = null;
    try {
      const buildState = await loadBuildStateModule(repoRoot);
      const needDeps = buildState
        ? !(await buildState.dependenciesCurrent(repoRoot, { inspectInstalledLock: true }))
        : classification.lockfileChanged;

      if (needDeps) {
        depsAttempted = true;
        await runNpmCiWithFallback(exec, repoRoot, env);
        depsInstalled = true;
        if (buildState) await buildState.recordDependencies(repoRoot).catch(() => {});
      }

      const studioIndexExists = existsSync(path.join(repoRoot, 'studio/build/index.html'));
      const buildReceiptExists = existsSync(path.join(repoRoot, '.artifacts/install/source-build.json'));
      let needStudioBuild = !studioIndexExists;
      if (!needStudioBuild) {
        if (classification.studioInputChanged || buildReceiptExists) {
          needStudioBuild = buildState ? !(await buildState.sourceBuildCurrent(repoRoot)) : classification.studioInputChanged;
        }
      }

      if (needStudioBuild) {
        buildBackups = await backupBuildOutputs(repoRoot);
        await runStudioBuild(exec, repoRoot, env);
        studioRebuilt = true;
        await discardBuildBackups(buildBackups);
        buildBackups = null;
        if (buildState) await buildState.recordSourceBuild(repoRoot).catch(() => {});
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      let gitRolledBack = false;
      try {
        await runGit(exec, repoRoot, ['reset', '--hard', previousCommit], env, 30_000);
        gitRolledBack = true;
      } catch {
        gitRolledBack = false;
      }

      // Always restore backed-up build outputs (or discard backups if git reset failed)
      // regardless of whether dependency reinstall succeeds, so studio/build is recovered
      // whenever possible and any unrestored backup remains preserved under gitignored
      // .artifacts/install for manual recovery.
      const restoredBuildState = gitRolledBack ? await loadBuildStateModule(repoRoot).catch(() => null) : null;
      if (buildBackups) {
        if (gitRolledBack) {
          const outputsRestored = await restoreBuildOutputs(buildBackups);
          if (outputsRestored && restoredBuildState && existsSync(path.join(repoRoot, '.artifacts/install/source-build.json'))) {
            await restoredBuildState.recordSourceBuild(repoRoot).catch(() => {});
          }
        } else {
          await discardBuildBackups(buildBackups);
        }
        buildBackups = null;
      }

      if (gitRolledBack && depsAttempted) {
        try {
          await runNpmCiWithFallback(exec, repoRoot, env);
          if (restoredBuildState) await restoredBuildState.recordDependencies(repoRoot).catch(() => {});
        } catch {
          // Best-effort dependency restore: git HEAD and build outputs are already recovered.
        }
      }

      await writeUpdateState(options.dataDirectory, {
        lastCheckedAt: undefined,
        lastAttemptAt: now,
        lastStatus: gitRolledBack ? 'failed_rolled_back' : 'failed',
        currentCommit: gitRolledBack ? previousCommit : targetCommit,
        remoteCommit: targetCommit,
        branch,
        lastError: message.slice(0, 500),
      }).catch(() => {});
      return {
        status: gitRolledBack ? 'failed_rolled_back' : 'failed',
        updated: false,
        rolledBack: gitRolledBack,
        branch,
        previousCommit,
        currentCommit: gitRolledBack ? previousCommit : targetCommit,
        error: message,
      };
    }

    await runGit(exec, repoRoot, ['update-ref', trackingRefName, targetCommit], env, 5_000).catch(() => {});

    const syncedSkills = await syncInstalledHostSkills(repoRoot, {
      homeDirectory: options.homeDirectory,
      env,
    }).catch(() => [] as string[]);

    let restarted = false;
    let restartDeferred = !restartBackend;
    if (restartBackend) {
      const shutdown = options.shutdownBackend ?? defaultShutdownIdleBackend;
      const outcome = await shutdown(options.dataDirectory).catch(() => ({ restarted: false, deferred: true }));
      restarted = outcome.restarted;
      restartDeferred = outcome.deferred;
    }

    await writeUpdateState(options.dataDirectory, {
      lastCheckedAt: now,
      lastAttemptAt: now,
      lastUpdatedAt: now,
      lastStatus: 'updated',
      currentCommit: targetCommit,
      remoteCommit: targetCommit,
      branch,
      lastError: undefined,
    }).catch(() => {});

    return {
      status: 'updated',
      updated: true,
      branch,
      previousCommit,
      currentCommit: targetCommit,
      changedFilesCount: changedFiles.length,
      skillChanged: classification.skillChanged,
      gameSkillChanged: classification.gameSkillChanged,
      changedSkills: classification.changedSkills,
      mcpSchemaChanged: classification.mcpSchemaChanged,
      depsInstalled,
      studioRebuilt,
      syncedSkills,
      restarted,
      restartDeferred,
    };
  }, 240_000).catch(async (error): Promise<SourceUpdateApplyResult> => {
    if (enteredUpdate || !(error instanceof ProcessLockTimeoutError)) throw error;
    // A cold install/build can outlast the bounded wait. Report contention without
    // touching the active updater's checkout or extending the caller's wait.
    const message = 'Another source update is still running for this checkout; retry after it finishes.';
    await writeUpdateState(options.dataDirectory, {
      lastCheckedAt: undefined,
      lastAttemptAt: now,
      lastStatus: 'failed',
      branch,
      lastError: message,
    }).catch(() => {});
    return { status: 'failed', updated: false, reason: 'update_in_progress', branch, error: message };
  });
}

export async function maybeAutoUpdateBeforeCreation(
  options: SourceUpdateOptions,
): Promise<SourceUpdateCheckResult | SourceUpdateApplyResult> {
  const now = (options.now ?? Date.now)();
  try {
    const check = await checkSourceUpdate({ ...options, automatic: true, now: () => now });
    if (check.status !== 'update_available') return check;
    return await applySourceUpdate({ ...options, automatic: true, now: () => now });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await writeUpdateState(options.dataDirectory, {
      lastCheckedAt: undefined,
      lastAttemptAt: now,
      lastStatus: 'failed',
      lastError: message.slice(0, 500),
    }).catch(() => {});
    return {
      status: 'check_failed',
      checked: false,
      updateAvailable: false,
      error: message,
    };
  }
}

export function compactRuntimeUpdateNotice(
  result: SourceUpdateCheckResult | SourceUpdateApplyResult | null | undefined,
): RuntimeUpdateNotice | undefined {
  if (!result || result.status !== 'updated' || !result.updated) return undefined;
  return {
    status: 'updated',
    previousCommit: result.previousCommit ?? '',
    currentCommit: result.currentCommit ?? '',
    skillChanged: Boolean(result.skillChanged),
    gameSkillChanged: Boolean(result.gameSkillChanged),
    changedSkills: Array.isArray(result.changedSkills) ? result.changedSkills : [],
    mcpSchemaChanged: Boolean(result.mcpSchemaChanged),
    depsInstalled: Boolean(result.depsInstalled),
    studioRebuilt: Boolean(result.studioRebuilt),
    restarted: Boolean(result.restarted),
    restartDeferred: Boolean(result.restartDeferred),
  };
}
