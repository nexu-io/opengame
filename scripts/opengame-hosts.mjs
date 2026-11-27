import assert from 'node:assert/strict';
import { access, cp, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { canonical, readJSON, runFile, withLock, writeJSON } from './runtime-assets.mjs';
const { adaptGameWorkflowMarkdown } = await import('./game-workflow-adapt.mjs').catch(() => import('../shared/game-workflow-adapt.mjs'));

// Dedicated registration adapters; any other valid lowercase --host installs the same
// application, launcher and Skills, returning agentRegistration for that Agent to add.
export const hosts = ['codex', 'claude', 'deepseek', 'workbuddy'];
export const genericHostPattern = /^[a-z][a-z0-9-]{0,31}$/;
const prototypeHostNames = new Set(Object.getOwnPropertyNames(Object.prototype));
export const isGenericHostName = host => genericHostPattern.test(host) && !prototypeHostNames.has(host);

export const managedBy = '@opengame/installer';
export const serverName = 'opengame';
const genericSkillOwner = 'agents';
const bundleName = 'dsh-plugin-opengame-local';
const flatSkillOwnerFile = 'opengame-install.json';
const equalTransport = (actual, expected) => actual?.command === expected.command && JSON.stringify(actual.args) === JSON.stringify(expected.args);

// Map packaged skills into isolated OpenGame flat skill names so OpenGame and OpenMotion
// can coexist side-by-side in the same host Skills root without directory collisions.
const flatSkillMap = [
  { source: 'openmotion-game', target: 'opengame-game' },
  { source: 'openmotion-media', target: 'opengame-media' },
];

export function defaultOpenGameHome(environment = 'prod') {
  const base = process.platform === 'win32' ? process.env.LOCALAPPDATA || os.homedir() : path.join(os.homedir(), '.local/share');
  return path.join(base, environment === 'dev' ? 'opengame-dev' : 'opengame');
}

export async function resolveHostCommand(command, platform = process.platform) {
  if (/\.[cm]?js$/i.test(command)) return { command: process.execPath, args: [command] };
  if (platform !== 'win32') return { command, args: [] };
  const directories = /[/\\]/.test(command) ? [''] : (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const suffixes = path.extname(command) ? [''] : ['.exe', '.com', '.cmd', '.ps1'];
  for (const directory of directories) for (const suffix of suffixes) {
    const file = path.resolve(directory.replace(/^"|"$/g, ''), command + suffix);
    try { await access(file); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    if (!/\.(cmd|ps1)$/i.test(file)) return { command: file, args: [] };
    const shim = await readFile(file, 'utf8');
    const target = [...shim.matchAll(/["'](?:%dp0%|\$basedir)[\\/]([^"'\r\n]+\.(?:[cm]?js|exe))["']/gi)].at(-1)?.[1];
    assert(target, 'HOST_CLI_UNSUPPORTED_SHIM: Use the host .exe or JavaScript CLI entry instead of ' + file);
    const entry = path.resolve(path.dirname(file), target.replaceAll('\\', '/'));
    await access(entry);
    return /\.[cm]?js$/i.test(entry) ? { command: process.execPath, args: [entry] } : { command: entry, args: [] };
  }
  throw new Error('HOST_CLI_NOT_FOUND: ' + command + '. Install the host CLI or pass its executable/JavaScript entry path.');
}

async function runHostCli(command, args, options) {
  const resolved = await resolveHostCommand(command);
  return runFile(resolved.command, [...resolved.args, ...args], options);
}

export async function hostPlan(options, home, launcher, previous, isSetup = false) {
  const host = options.host || 'codex';
  assert(hosts.includes(host) || isGenericHostName(host), 'Use --host ' + hosts.join('|') + ' or the current Agent name in lowercase letters, digits and hyphens (for example opencode)');
  const transport = { type: 'stdio', command: process.execPath, args: [launcher] };
  const saved = Object.hasOwn(previous?.hosts ?? {}, host) ? previous.hosts[host] : null;
  if (!hosts.includes(host)) {
    const skillsDirectory = await canonical(options.skillsDirectory || saved?.skillsDirectory || path.join(os.homedir(), '.agents/skills'));
    const metadata = { skillsDirectory, layout: 'flat', registration: 'agent' };
    return {
      host, skillOwner: genericSkillOwner, ...metadata, metadata, connection: { transport },
      register: async () => {},
      agentRegistration: { serverName, transport, skillsDirectory },
    };
  }
  const defaultSkills = host === 'claude' ? path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'skills')
    : host === 'workbuddy' ? path.join(process.env.WORKBUDDY_CONFIG_DIR || path.join(os.homedir(), '.workbuddy'), 'skills')
      : path.join(os.homedir(), '.agents/skills');
  const skillsDirectory = await canonical(options.skillsDirectory || saved?.skillsDirectory || defaultSkills);
  const metadata = { skillsDirectory, layout: host === 'codex' ? 'bundle' : 'flat' };
  if (host === 'codex') {
    const codex = options.codex || 'codex';
    const cli = args => runHostCli(codex, args);
    let current;
    try { current = JSON.parse(await cli(['mcp', 'get', serverName, '--json'])); }
    catch (error) { if (!new RegExp(`No MCP server named ['"]${serverName}['"] found`).test(error.message)) throw error; }
    assert(!current || (saved && equalTransport(current.transport, transport)), `Existing ${serverName} MCP configuration is not owned by this installation`);
    return {
      host, ...metadata, metadata, connection: current,
      register: async () => { if (!current) await cli(['mcp', 'add', serverName, '--', process.execPath, launcher]); },
    };
  }
  if (host === 'claude') {
    const claude = options.claude || 'claude';
    if (isSetup) await resolveHostCommand(claude);
    const configFile = await canonical(process.env.CLAUDE_CONFIG_DIR ? path.join(process.env.CLAUDE_CONFIG_DIR, '.claude.json') : path.join(os.homedir(), '.claude.json'));
    const settings = await readJSON(configFile);
    assert(settings === null || (typeof settings === 'object' && !Array.isArray(settings)), 'Invalid Claude configuration');
    assert(settings?.mcpServers === undefined || (settings.mcpServers && typeof settings.mcpServers === 'object' && !Array.isArray(settings.mcpServers)), 'Invalid Claude mcpServers');
    const current = settings?.mcpServers?.[serverName];
    assert(!current || (saved?.configFile === configFile && equalTransport(current, transport)), `Existing Claude ${serverName} MCP is not owned by this installation`);
    metadata.configFile = configFile;
    return {
      host, ...metadata, metadata, connection: current && { transport: current },
      register: async () => {
        if (!current) await runHostCli(claude, ['mcp', 'add-json', '-s', 'user', serverName, JSON.stringify(transport)]);
      },
    };
  }
  if (host === 'workbuddy') {
    const configFile = path.join(await canonical(process.env.WORKBUDDY_CONFIG_DIR || path.join(os.homedir(), '.workbuddy')), 'mcp.json');
    // WorkBuddy desktop sends the MCP server key (`opengame`) as `clientInfo.name`; set an explicit
    // launch-environment tag so native WorkBuddy MCP traffic attributes cleanly to `workbuddy`.
    const workbuddyTransport = { ...transport, env: { OPENMOTION_HOST_AGENT: 'workbuddy' } };
    const check = config => {
      assert(config === null || (typeof config === 'object' && !Array.isArray(config)), 'Invalid WorkBuddy configuration');
      assert(config?.mcpServers === undefined || (config.mcpServers && typeof config.mcpServers === 'object' && !Array.isArray(config.mcpServers)), 'Invalid WorkBuddy mcpServers');
      const current = config?.mcpServers?.[serverName];
      assert(!current || (saved?.configFile === configFile && equalTransport(current, transport)), `Existing WorkBuddy ${serverName} MCP is not owned by this installation`);
    };
    const configured = await readJSON(configFile);
    check(configured);
    metadata.configFile = configFile;
    return {
      host, ...metadata, metadata, connection: configured?.mcpServers?.[serverName] && { transport: configured.mcpServers[serverName] },
      register: async () => {
        await withLock(configFile + '.opengame.lock', async () => {
          const config = await readJSON(configFile) || {};
          check(config);
          await writeJSON(configFile, { ...config, mcpServers: { ...config.mcpServers, [serverName]: workbuddyTransport } });
        });
      },
    };
  }
  // DeepSeek Harness uses a stable bundle path so auto-update and rollback swap skills
  // in place without editing the DSH profile package.json again.
  const profile = options.profile || saved?.profile || 'web';
  assert(/^[a-zA-Z0-9_-]+$/.test(profile), 'Use a simple DeepSeek Harness profile name');
  const dshHome = await canonical(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'));
  const configFile = path.join(dshHome, 'profiles', profile, 'package.json');
  const current = await readJSON(configFile);
  assert(current === null || (typeof current === 'object' && !Array.isArray(current)), 'Invalid Harness package configuration');
  assert(current?.dependencies === undefined || (current.dependencies && typeof current.dependencies === 'object' && !Array.isArray(current.dependencies)), 'Invalid Harness dependencies');
  const bundleDirectory = path.join(home, 'hosts', 'deepseek');
  const dependency = current?.dependencies?.[bundleName];
  const dependencyPath = dependency && /^(file|link):/.test(dependency)
    ? await canonical(path.resolve(path.dirname(configFile), dependency.replace(/^(file|link):/, '')))
    : null;
  assert(!dependency || dependencyPath === bundleDirectory, 'Existing Harness OpenGame bundle is not owned by this installation');
  assert(!saved || saved.configFile === configFile, 'This Harness install already targets another profile; use a separate installation for that profile');
  let dsh = options.dsh || 'dsh';
  if (!options.dsh && process.platform === 'darwin') {
    const desktop = '/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh';
    try { await access(desktop); dsh = desktop; } catch {}
  }
  if (isSetup) await resolveHostCommand(dsh);
  metadata.configFile = configFile;
  metadata.profile = profile;
  metadata.bundleDirectory = bundleDirectory;
  metadata.skillsDirectory = path.join(bundleDirectory, 'skills');
  metadata.layout = 'deepseek';
  return {
    host, skillsDirectory: metadata.skillsDirectory, layout: 'deepseek', metadata,
    readConnection: async () => {
      if (!dependency) return null;
      const patch = await readJSON(path.join(bundleDirectory, 'cordis.patch.yml'));
      assert(patch === null || Array.isArray(patch), 'Invalid managed Harness MCP bundle. Run opengame setup for the same host, home and profile to repair it.');
      const configured = patch?.flatMap(item => item.insert || []).find(item => item.id === 'mcp-opengame')?.config;
      return configured && { transport: { ...configured, type: configured.transport } };
    },
    register: async () => {
      if (!dependency) {
        await runHostCli(dsh, ['plugin', '--profile', profile, 'add', bundleDirectory, '--ignore-scripts'], { env: { ...process.env, DSH_HOME: dshHome } });
      }
    },
    writeBundle: async (stage, _appRoot, version) => {
      await writeJSON(path.join(stage, 'package.json'), {
        name: bundleName, version, private: true, type: 'module',
        files: ['cordis.patch.yml'], dsh: { bundle: { patch: './cordis.patch.yml' } },
      });
      const entries = [
        {
          id: 'mcp-opengame', name: '@deepseek-ai/dsh-mcp-client',
          config: { serverName, transport: 'stdio', command: transport.command, args: transport.args, cwd: home, failOnStartupError: true, toolCallTimeoutMs: 180000 },
        },
        {
          id: 'opengame-skills', name: '@deepseek-ai/dsh-skill-filesystem',
          config: { providerName: serverName, includeDefaultRoots: false, customSkillDirs: [path.join(bundleDirectory, 'skills')] },
        },
      ];
      await writeJSON(path.join(stage, 'cordis.patch.yml'), [{ insert: entries }]);
    },
  };
}

export async function skillTargets(plan, appRoot) {
  if (plan.layout === 'bundle') return [path.join(plan.skillsDirectory, 'opengame-workflows')];
  if (plan.layout === 'deepseek') return [plan.metadata.bundleDirectory];
  const present = new Set(
    (await readdir(path.join(appRoot, 'skills'), { withFileTypes: true }))
      .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
      .map(entry => entry.name),
  );
  return flatSkillMap
    .filter(item => present.has(item.source))
    .map(item => path.join(plan.skillsDirectory, item.target));
}

export async function checkSkillOwner(target, home, host, layout) {
  const scope = await readJSON(path.join(target, layout === 'flat' ? flatSkillOwnerFile : 'scope.json'));
  const existing = await readdir(target).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
  assert(!existing || (scope?.managedBy === managedBy && scope.installHome === home && (!scope.host || scope.host === host)),
    'Existing OpenGame Skills are not owned by this installation: ' + target);
  return existing !== null;
}

async function rewriteGameSkillMarkdown(directory, originalDirectory, appRoot, renameFrontmatter) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    const originalFile = path.join(originalDirectory, entry.name);
    if (entry.isDirectory()) {
      await rewriteGameSkillMarkdown(filename, originalFile, appRoot, null);
    } else if (entry.name.endsWith('.md')) {
      let content = await readFile(filename, 'utf8');
      let updated = adaptGameWorkflowMarkdown(originalFile, content);
      if (renameFrontmatter && entry.name === 'SKILL.md') {
        updated = updated.replace(/^name: .+$/m, 'name: ' + renameFrontmatter);
      }
      updated = updated.replace(/\]\((\.\.[^)#]+)(#[^)]*)?\)/g, (match, relative, hash = '') => {
        const resolved = path.resolve(path.dirname(originalFile), relative);
        return resolved.startsWith(path.join(appRoot, 'docs') + path.sep) ? '](<' + resolved + hash + '>)' : match;
      });
      if (updated !== content) await writeFile(filename, updated);
    }
  }
}

export async function copyHostSkills(stage, target, appRoot, plan, home, version, dataDirectory) {
  const scope = {
    managedBy, installHome: home, runtimeRoot: appRoot, version, dataDirectory,
    host: plan.skillOwner || plan.host,
    ...(plan.host === 'deepseek' ? { configFile: plan.metadata.configFile } : {}),
  };
  if (plan.layout !== 'flat') {
    const skillsDestination = path.join(stage, 'skills');
    await mkdir(skillsDestination, { recursive: true });
    for (const item of flatSkillMap) {
      const source = path.join(appRoot, 'skills', item.source);
      const exists = await readdir(source).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; });
      if (!exists) continue;
      const dest = path.join(skillsDestination, item.target);
      await cp(source, dest, { recursive: true });
      await rewriteGameSkillMarkdown(dest, source, appRoot, item.target);
    }
    await writeJSON(path.join(stage, 'scope.json'), scope);
    if (plan.writeBundle) await plan.writeBundle(stage, appRoot, version);
    return;
  }
  const targetName = path.basename(target);
  const mapped = flatSkillMap.find(item => item.target === targetName);
  const source = path.join(appRoot, 'skills', mapped ? mapped.source : targetName);
  await cp(source, stage, { recursive: true });
  await writeJSON(path.join(stage, flatSkillOwnerFile), scope);
  await rewriteGameSkillMarkdown(stage, source, appRoot, mapped?.target ?? null);
}

/**
 * Atomically refresh installed Skills across all registered hosts during auto-update
 * or rollback without touching external host MCP configuration files.
 */
export async function syncInstalledHostSkills(state, appRoot, version) {
  const synced = [];
  const home = state.home || path.dirname(state.launcher);
  for (const [host, meta] of Object.entries(state.hosts || {})) {
    const layout = meta.layout || (host === 'codex' ? 'bundle' : host === 'deepseek' ? 'deepseek' : 'flat');
    const skillOwner = hosts.includes(host) ? host : genericSkillOwner;
    if (layout === 'deepseek' && meta.bundleDirectory) {
      const target = path.join(meta.bundleDirectory, 'skills');
      const scope = await readJSON(path.join(meta.bundleDirectory, 'scope.json'));
      if (scope?.managedBy !== managedBy || scope.installHome !== home) continue;
      const stage = await mkdtemp(path.join(meta.bundleDirectory, '.skills-'));
      const backup = stage + '-previous';
      let movedOld = false, movedNew = false;
      try {
        for (const item of flatSkillMap) {
          const source = path.join(appRoot, 'skills', item.source);
          const exists = await readdir(source).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; });
          if (!exists) continue;
          const dest = path.join(stage, item.target);
          await cp(source, dest, { recursive: true });
          await rewriteGameSkillMarkdown(dest, source, appRoot, item.target);
        }
        const existed = await readdir(target).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; });
        if (existed) { await rename(target, backup); movedOld = true; }
        await rename(stage, target); movedNew = true;
        await writeJSON(path.join(meta.bundleDirectory, 'scope.json'), { ...scope, runtimeRoot: appRoot, version });
        await rm(backup, { recursive: true, force: true }).catch(() => {});
        synced.push({ host, target });
      } catch (error) {
        if (movedNew) await rm(target, { recursive: true, force: true }).catch(() => {});
        if (movedOld) await rename(backup, target).catch(() => {});
        throw error;
      } finally {
        await rm(stage, { recursive: true, force: true }).catch(() => {});
      }
      continue;
    }
    if (!meta.skillsDirectory) continue;
    const plan = { host, skillOwner, layout, skillsDirectory: meta.skillsDirectory, metadata: meta };
    const targets = await skillTargets(plan, appRoot);
    const items = [];
    for (const target of targets) {
      const existed = await checkSkillOwner(target, home, skillOwner, layout);
      items.push({ target, existed, movedOld: false, movedNew: false });
    }
    try {
      for (const item of items) {
        await mkdir(path.dirname(item.target), { recursive: true });
        item.stage = await mkdtemp(path.join(path.dirname(item.target), '.opengame-'));
        item.backup = item.stage + '-previous';
        await copyHostSkills(item.stage, item.target, appRoot, plan, home, version, state.dataDirectory);
      }
      for (const item of items) {
        if (item.existed) { await rename(item.target, item.backup); item.movedOld = true; }
        await rename(item.stage, item.target); item.movedNew = true;
      }
      for (const item of items) await rm(item.backup, { recursive: true, force: true }).catch(() => {});
      synced.push({ host, targets });
    } catch (error) {
      for (const item of [...items].reverse()) {
        if (item.movedNew) await rm(item.target, { recursive: true, force: true }).catch(() => {});
        if (item.movedOld) await rename(item.backup, item.target).catch(() => {});
      }
      throw error;
    } finally {
      for (const item of items) if (item.stage) await rm(item.stage, { recursive: true, force: true }).catch(() => {});
    }
  }
  return synced;
}
