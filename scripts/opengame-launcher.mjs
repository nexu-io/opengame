#!/usr/bin/env node
import assert from 'node:assert/strict';
import { cp, lstat, mkdir, mkdtemp, readFile, rename, rm } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { canonical, nativeComponents, obtainAsset, readJSON, relativePath, runFile, writeAtomic, writeJSON } from './runtime-assets.mjs';
import { ensureNativeRuntime, nativeConfiguration, startNativePreparation } from './npm-runtime.mjs';
import { checkSkillOwner, copyHostSkills, defaultOpenGameHome, hostPlan, hosts, managedBy, skillTargets } from './opengame-hosts.mjs';
import { callInstalledOpenGameTool, checkOpenGameTransport, redact } from './opengame-check-mcp.mjs';
import {
  applyStagedUpdate,
  checkNpmUpdate,
  installApplicationArchive,
  readInstallState,
  rollbackInstallation,
  runManagedMcp,
  stageNpmUpdate,
  withInstallLock,
  writeInstallState,
} from './opengame-updater.mjs';
import { exportDiagnostics, recordDiagnostic } from './diagnostics.mjs';

export { managedBy };

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const bundledManifest = fileURLToPath(new URL('../payload/release-npm.json', import.meta.url));
const launcherRuntimeFiles = ['runtime-assets.mjs', 'opengame-hosts.mjs', 'opengame-check-mcp.mjs', 'opengame-updater.mjs'];
const contains = (parent, child) => {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel));
};

const usage = `Usage:
  opengame setup --host <${hosts.join('|')}|AGENT> [options]
  opengame mcp [--home DIR] [--data-dir DIR] [--manifest FILE]
  opengame update [--home DIR] [--check] [--force]
  opengame rollback [--home DIR]
  opengame prepare [--home DIR] [--with-trailer]
  opengame diagnose --host <${hosts.join('|')}|AGENT> [--home DIR] [host options]
  opengame tools --host HOST [--home DIR]
  opengame call TOOL --args-file FILE.json --host HOST [--home DIR]
  opengame diagnostics [--home DIR] [--data-dir DIR] [--output FILE.zip]
  opengame --version

Setup options:
  --host HOST        Registration adapters: ${hosts.join(', ')} (default: codex)
                     Any other lowercase Agent name (for example opencode) installs the same
                     application and Skills and returns agentRegistration for its MCP config
  --home DIR         Managed OpenGame installation home (default: ~/.local/share/opengame)
  --data-dir DIR     Game projects and data outside application/cache directories
  --skills-dir DIR   Skills root override for Codex, Claude Code, WorkBuddy or another Agent
  --codex FILE       Codex executable or JavaScript CLI entry
  --claude FILE      Claude Code executable
  --dsh FILE         DeepSeek Harness executable
  --profile NAME     DeepSeek Harness profile (default: web)
  --utm-source NAME  Optional installation source attribution
  --manifest FILE    Explicit release manifest for controlled local installations
  --no-auto-update   Disable background npm update checks for this installation
  --skip-studio      Skip starting Game Studio preview during setup
  -h, --help         Show this help without installing or changing configuration
  --version          Show this package's version`;

const agentRegistrationInstructions = 'No registration adapter exists for this host, so its configuration was not changed. Add a local stdio MCP server named "opengame" with exactly transport.command and transport.args (no shell, no extra environment; the launcher sets the workspace and native tools) using this host\'s documented MCP configuration, and make sure the host reads Skills from skillsDirectory. Preserve unrelated settings, then refresh MCP and verify with opengame_get({ id: "tidebreaker" }). Until native tools load, use directAccess in this same chat.';

export async function localManifest(filename) {
  const file = path.resolve(filename);
  const manifest = await readJSON(file);
  assert(manifest?.schemaVersion === 1 && /^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(manifest.version), 'Invalid OpenGame release manifest');
  assert.equal(manifest.mcp?.profile, 'game', 'Manifest does not target the OpenGame game MCP profile');
  assert(/^[a-f0-9]{64}$/.test(manifest.application?.sha256), 'Application requires a pinned SHA256');
  assert(manifest.runtime?.targets && !Array.isArray(manifest.runtime.targets) && Object.keys(manifest.runtime.targets).length, 'Missing native runtime manifest');
  const resolveAsset = asset => {
    assert(asset && /^[a-f0-9]{64}$/.test(asset.sha256), 'Asset requires a pinned SHA256');
    const url = new URL(asset.url, pathToFileURL(file));
    assert(['https:', 'file:'].includes(url.protocol), 'Assets require HTTPS or explicit local files');
    assert(!url.username && !url.password, 'Do not put credentials in asset URLs');
    return { ...asset, url: url.href };
  };
  manifest.application = resolveAsset(manifest.application);
  for (const target of Object.values(manifest.runtime.targets)) {
    for (const component of nativeComponents(target)) {
      target[component] = resolveAsset(target[component]);
      relativePath('/', component === 'media' ? target.media.directory : target[component].executable);
    }
  }
  return manifest;
}

async function installLauncherSupport(home) {
  const targetDir = path.join(home, 'launcher');
  const stage = await mkdtemp(path.join(home, '.launcher-'));
  const backup = stage + '-previous';
  let movedOld = false, movedNew = false;
  try {
    for (const file of launcherRuntimeFiles) {
      await cp(path.join(scriptDir, file), path.join(stage, file));
    }
    await cp(path.join(scriptDir, 'game-workflow-adapt.mjs'), path.join(stage, 'game-workflow-adapt.mjs')).catch(error => {
      if (error.code !== 'ENOENT') throw error;
      return cp(path.join(scriptDir, '../shared/game-workflow-adapt.mjs'), path.join(stage, 'game-workflow-adapt.mjs'));
    });
    const existed = await lstat(targetDir).then(() => true, error => {
      if (error.code === 'ENOENT') return false;
      throw error;
    });
    if (existed) { await rename(targetDir, backup); movedOld = true; }
    await rename(stage, targetDir); movedNew = true;
    await rm(backup, { recursive: true, force: true }).catch(() => {});
  } catch (error) {
    if (movedNew) await rm(targetDir, { recursive: true, force: true }).catch(() => {});
    if (movedOld) await rename(backup, targetDir).catch(() => {});
    throw error;
  } finally {
    await rm(stage, { recursive: true, force: true }).catch(() => {});
  }
  const launcher = path.join(home, 'run-mcp.mjs');
  await writeAtomic(launcher, [
    "import path from 'node:path';",
    "import { fileURLToPath } from 'node:url';",
    "import { runManagedMcp } from './launcher/opengame-updater.mjs';",
    'const home = path.dirname(fileURLToPath(import.meta.url));',
    'const code = await runManagedMcp({ home });',
    'process.exit(code);',
    '',
  ].join('\n'));
  return launcher;
}

async function resolveBundledPackageMeta() {
  const pkg = await readJSON(new URL('../package.json', import.meta.url)).catch(() => null);
  return {
    packageName: pkg?.name && pkg.name !== 'openmotion' ? pkg.name : 'opengame',
    version: pkg?.version || null,
  };
}

export function directAccess(home, host, appRoot, options = {}) {
  const flags = ['--home', home, '--host', host];
  for (const key of ['codex', 'claude', 'dsh', 'profile']) if (options[key]) flags.push('--' + key, options[key]);
  const cli = path.join(appRoot, 'scripts/opengame-launcher.mjs');
  return {
    command: process.execPath,
    toolsArgs: [cli, 'tools', ...flags],
    ...(host === 'codex' && process.env.CODEX_HOME ? { environment: { CODEX_HOME: process.env.CODEX_HOME } } : {}),
    callArgs: [cli, 'call', 'TOOL', '--args-file', 'FILE.json', ...flags],
    instructions: 'Use working native OpenGame MCP tools first. Otherwise execute toolsArgs with command in this same chat, read the returned inputSchema, then execute callArgs after replacing TOOL and FILE.json with a local JSON object file.',
  };
}

async function prepareGameStudioPreview(appRoot, dataDirectory) {
  try {
    const output = await runFile(process.execPath, ['--experimental-strip-types', path.join(appRoot, 'scripts/open-game-studio.ts')], {
      cwd: appRoot,
      env: { ...process.env, MOTION_DATA_DIR: dataDirectory, OPENMOTION_TELEMETRY: '0' },
      timeout: 30_000,
    });
    return JSON.parse(output.trim());
  } catch (error) {
    return { status: 'unavailable', reason: error instanceof Error ? error.message : String(error) };
  }
}

export async function setup(options = {}) {
  const manifest = await localManifest(options.manifest || bundledManifest);
  const pkgMeta = await resolveBundledPackageMeta();
  if (!options.manifest && pkgMeta.version) {
    assert.equal(manifest.version, pkgMeta.version, 'Bundled OpenGame application must match the npm package version');
  }
  const packageName = options.packageName || manifest.packageName || pkgMeta.packageName || 'opengame';
  const templateEnvironment = manifest.templateEnvironment ?? 'prod';
  assert(['dev', 'prod'].includes(templateEnvironment), 'Invalid template environment');
  const channel = manifest.version.includes('-test.') || templateEnvironment === 'dev' ? 'test' : 'stable';
  let { home = defaultOpenGameHome(templateEnvironment), dataDirectory } = options;
  home = await canonical(home);
  dataDirectory = await canonical(dataDirectory || path.join(home, 'data'));
  assert(!contains(dataDirectory, home) && !['apps', 'cache', 'hosts', 'launcher'].some(name => contains(path.join(home, name), dataDirectory)),
    'Keep user game data and application/cache directories separate');
  await mkdir(home, { recursive: true });

  return withInstallLock(path.join(home, 'install.lock'), async () => {
    const previous = await readInstallState(home);
    assert(previous === null || previous.managedBy === managedBy, 'Installation directory belongs to another application');
    assert(!previous || previous.dataDirectory === dataDirectory, 'This OpenGame installation already uses another data directory; choose a separate --home');
    assert(!previous || (previous.templateEnvironment ?? 'prod') === templateEnvironment, 'This OpenGame installation uses another channel/environment; choose a separate --home');

    const launcher = path.join(home, 'run-mcp.mjs');
    if (!previous) {
      await readFile(launcher).then(() => { throw new Error('Refusing to replace an unowned MCP launcher'); }, error => { if (error.code !== 'ENOENT') throw error; });
    }
    const plan = await hostPlan(options, home, launcher, previous, true);
    assert(!plan.metadata.configFile || !contains(dataDirectory, plan.metadata.configFile), 'Keep host configuration outside user data');
    assert(!plan.metadata.configFile || !['apps', 'cache', 'hosts', 'launcher'].some(name => contains(path.join(home, name), plan.metadata.configFile)), 'Keep host configuration outside managed application/cache/host directories');
    if (plan.layout !== 'deepseek') {
      assert(!contains(dataDirectory, plan.skillsDirectory) && !contains(plan.skillsDirectory, dataDirectory)
        && !contains(plan.skillsDirectory, home) && !contains(home, plan.skillsDirectory),
      'Keep user data, installed Skills and application/cache directories separate');
    }
    if (plan.layout === 'bundle') await checkSkillOwner(path.join(plan.skillsDirectory, 'opengame-workflows'), home, plan.skillOwner || plan.host, plan.layout);

    const archive = path.join(home, 'cache/downloads', manifest.application.sha256 + (manifest.application.url.endsWith('.tar.xz') ? '.tar.xz' : '.tar.gz'));
    console.error('OpenGame: preparing application ' + manifest.version);
    await obtainAsset(manifest.application, archive, true);
    const appRoot = await installApplicationArchive({
      home,
      archivePath: archive,
      manifest,
      installDeps: options.installDeps,
      registries: options.registries,
    });

    const attribution = await import(pathToFileURL(path.join(appRoot, 'shared/install-attribution.ts')).href).catch(() => null);
    if (attribution?.recordInstallationStart) {
      await attribution.recordInstallationStart(dataDirectory, plan.host, options.utmSource).catch(() => {});
    }

    const targets = await skillTargets(plan, appRoot);
    const directories = [];
    for (const target of targets) {
      directories.push({ target, existed: await checkSkillOwner(target, home, plan.skillOwner || plan.host, plan.layout), movedOld: false, movedNew: false });
    }

    let wroteState = false, wroteLauncher = false, state;
    try {
      for (const item of directories) {
        await mkdir(path.dirname(item.target), { recursive: true });
        item.stage = await mkdtemp(path.join(path.dirname(item.target), '.opengame-'));
        item.backup = item.stage + '-previous';
        await copyHostSkills(item.stage, item.target, appRoot, plan, home, manifest.version, dataDirectory);
      }
      for (const item of directories) {
        if (item.existed) { await rename(item.target, item.backup); item.movedOld = true; }
        await rename(item.stage, item.target); item.movedNew = true;
      }
      await installLauncherSupport(home);
      wroteLauncher = true;

      const previousSlot = previous?.current && previous.current.appRoot !== appRoot
        ? { ...previous.current, healthy: true, crashCount: 0 }
        : (previous?.previous || null);
      const registeredHosts = previous?.hosts || {};
      state = await writeInstallState(home, {
        managedBy,
        packageName,
        channel,
        templateEnvironment,
        autoUpdate: options.autoUpdate !== undefined ? Boolean(options.autoUpdate) : (previous?.autoUpdate ?? true),
        dataDirectory,
        launcher,
        hosts: { ...registeredHosts, [plan.host]: plan.metadata },
        current: {
          version: manifest.version,
          sha256: manifest.application.sha256,
          appRoot,
          activatedAt: new Date().toISOString(),
          healthy: true,
          crashCount: 0,
        },
        previous: previousSlot,
        staged: null,
        badVersions: previous?.badVersions || [],
        lastUpdateCheckAt: previous?.lastUpdateCheckAt || null,
      });
      wroteState = true;

      await plan.register();
      for (const item of directories) await rm(item.backup, { recursive: true, force: true }).catch(() => {});
      if (!options.skipBackgroundPrepare) {
        // Prepare headless Chrome only; FFmpeg stays deferred until opengame_trailer or `prepare --with-trailer`.
        await startNativePreparation(appRoot, false, ['browser']).catch(error => {
          console.error('OpenGame: background browser preparation could not start; retry with opengame prepare. ' + error.message);
        });
      }
      const gameStudio = options.skipStudio ? { status: 'skipped' } : await prepareGameStudioPreview(appRoot, dataDirectory);
      if (attribution?.recordInstallation) {
        await attribution.recordInstallation(dataDirectory, plan.host, options.utmSource).catch(() => {});
      }
      return {
        ...state,
        host: plan.host,
        hostInstallation: plan.metadata,
        gameStudio,
        nativeDependencies: 'browser-background-preparation; ffmpeg deferred until trailer export or opengame prepare --with-trailer',
        directAccess: directAccess(home, plan.host, appRoot, options),
        ...(plan.agentRegistration ? { agentRegistration: { ...plan.agentRegistration, instructions: agentRegistrationInstructions } } : {}),
      };
    } catch (error) {
      if (wroteLauncher && !previous) await rm(launcher, { force: true }).catch(() => {});
      if (wroteState) {
        if (previous) await writeInstallState(home, previous).catch(() => {});
        else await rm(path.join(home, 'install.json'), { force: true }).catch(() => {});
      }
      for (const item of [...directories].reverse()) {
        if (item.movedNew) await rm(item.target, { recursive: true, force: true }).catch(() => {});
        if (item.movedOld) await rename(item.backup, item.target).catch(() => {});
      }
      throw error;
    } finally {
      for (const item of directories) if (item.stage) await rm(item.stage, { recursive: true, force: true }).catch(() => {});
    }
  });
}

async function bootstrapForDirectMcp(options = {}) {
  const manifest = await localManifest(options.manifest || bundledManifest);
  const pkgMeta = await resolveBundledPackageMeta();
  const packageName = options.packageName || manifest.packageName || pkgMeta.packageName || 'opengame';
  const templateEnvironment = manifest.templateEnvironment ?? 'prod';
  const channel = manifest.version.includes('-test.') || templateEnvironment === 'dev' ? 'test' : 'stable';
  const home = await canonical(options.home || defaultOpenGameHome(templateEnvironment));
  const existing = await readInstallState(home);
  if (existing?.managedBy === managedBy && existing.current?.appRoot) return home;
  const dataDirectory = await canonical(options.dataDirectory || path.join(home, 'data'));
  await mkdir(home, { recursive: true });
  await withInstallLock(path.join(home, 'install.lock'), async () => {
    const again = await readInstallState(home);
    if (again?.managedBy === managedBy && again.current?.appRoot) return;
    const archive = path.join(home, 'cache/downloads', manifest.application.sha256 + (manifest.application.url.endsWith('.tar.xz') ? '.tar.xz' : '.tar.gz'));
    console.error('OpenGame: first-run bootstrap ' + manifest.version);
    await obtainAsset(manifest.application, archive, true);
    const appRoot = await installApplicationArchive({ home, archivePath: archive, manifest, installDeps: options.installDeps });
    const launcher = await installLauncherSupport(home);
    await writeInstallState(home, {
      managedBy,
      packageName,
      channel,
      templateEnvironment,
      autoUpdate: options.autoUpdate !== false,
      dataDirectory,
      launcher,
      hosts: {},
      current: {
        version: manifest.version,
        sha256: manifest.application.sha256,
        appRoot,
        activatedAt: new Date().toISOString(),
        healthy: true,
        crashCount: 0,
      },
      previous: null,
      staged: null,
      badVersions: [],
      lastUpdateCheckAt: null,
    });
  });
  return home;
}

async function resolveInstalledHome(explicitHome) {
  if (explicitHome) return canonical(explicitHome);
  const environment = (await readJSON(bundledManifest).catch(() => null))?.templateEnvironment ?? 'prod';
  return canonical(defaultOpenGameHome(environment));
}

async function installedConnection(options) {
  const host = options.host || 'codex';
  const home = await resolveInstalledHome(options.home);
  const state = await readInstallState(home);
  assert(state?.managedBy === managedBy, 'Run opengame setup for the selected host and installation home first.');
  assert(Object.hasOwn(state.hosts ?? {}, host), 'This OpenGame installation is not registered for host: ' + host);
  const saved = state.hosts[host];
  try {
    const plan = await hostPlan({ ...options, skillsDirectory: saved?.skillsDirectory, profile: options.profile || saved?.profile }, home, state.launcher, state, false);
    const connection = plan.readConnection ? await plan.readConnection() : plan.connection;
    return { state, connection, home, host };
  } catch (error) {
    error.stage = 'host_configuration';
    throw error;
  }
}

export async function callInstalled(options, name, args = {}) {
  const { state, connection } = await installedConnection(options);
  return callInstalledOpenGameTool(state, connection, name, args);
}

export async function diagnose(options) {
  let stage = 'installation';
  const host = options.host || 'codex';
  try {
    const { state, connection, home } = await installedConnection(options);
    stage = 'mcp_probe';
    const appRoot = state.current.appRoot;
    const expectedTools = (await readJSON(path.join(appRoot, 'shared/mcp-profiles.json'))).game.tools;
    const checked = checkOpenGameTransport(connection, state.current.version, { expectedTools, verifyGameId: 'tidebreaker' });
    return {
      status: 'passed',
      host,
      ...checked,
      dataDirectory: state.dataDirectory,
      healthy: state.current.healthy,
      staged: state.staged?.version || null,
      previous: state.previous?.version || null,
      directAccess: directAccess(home, host, appRoot, options),
    };
  } catch (error) {
    return {
      status: 'failed',
      host,
      stage: error.stage || stage,
      code: error.code || 'MCP_DIAGNOSIS_FAILED',
      message: redact(error.message, process.env),
    };
  }
}

export async function update(options = {}) {
  const home = await resolveInstalledHome(options.home);
  const state = await readInstallState(home);
  assert(state?.managedBy === managedBy, 'Run opengame setup first.');
  const check = await checkNpmUpdate({
    packageName: state.packageName || 'opengame',
    channel: state.channel || (state.templateEnvironment === 'dev' ? 'test' : 'stable'),
    currentVersion: options.force ? undefined : state.current.version,
    badVersions: options.force ? [] : (state.badVersions || []),
    registries: options.registries,
    fetchImpl: options.fetchImpl,
  });
  if (options.check || !check.available) {
    return { status: check.available ? 'update_available' : (check.reason || 'up_to_date'), currentVersion: state.current.version, ...check };
  }
  const staged = await stageNpmUpdate({
    home,
    target: check,
    force: Boolean(options.force),
    fetchImpl: options.fetchImpl,
    registries: options.registries,
    installDeps: options.installDeps,
  });
  if (staged.status !== 'staged' && staged.status !== 'already_staged') {
    return { status: staged.status, currentVersion: state.current.version, check, staged };
  }
  const applied = await applyStagedUpdate({ home, fetchImpl: options.fetchImpl });
  return {
    status: applied.applied ? 'updated' : 'staged_waiting_for_idle',
    currentVersion: applied.applied ? applied.version : state.current.version,
    targetVersion: check.version,
    applied,
  };
}

async function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      manifest: { type: 'string' },
      home: { type: 'string' },
      'data-dir': { type: 'string' },
      'skills-dir': { type: 'string' },
      host: { type: 'string' },
      codex: { type: 'string' },
      claude: { type: 'string' },
      dsh: { type: 'string' },
      profile: { type: 'string' },
      'utm-source': { type: 'string' },
      'args-file': { type: 'string' },
      output: { type: 'string' },
      check: { type: 'boolean' },
      force: { type: 'boolean' },
      'with-trailer': { type: 'boolean' },
      'no-auto-update': { type: 'boolean' },
      'skip-studio': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean' },
    },
  });
  if (values.help) { console.log(usage); return; }
  if (values.version) {
    const pkg = await readJSON(new URL('../package.json', import.meta.url));
    console.log(pkg?.version || '0.0.0');
    return;
  }
  const [command] = positionals;
  assert(positionals.length === (command === 'call' ? 2 : 1), usage);
  if (command === 'setup') {
    try {
      const result = await setup({
        manifest: values.manifest,
        home: values.home,
        dataDirectory: values['data-dir'],
        skillsDirectory: values['skills-dir'],
        host: values.host,
        codex: values.codex,
        claude: values.claude,
        dsh: values.dsh,
        profile: values.profile,
        utmSource: values['utm-source'],
        autoUpdate: values['no-auto-update'] ? false : undefined,
        skipStudio: Boolean(values['skip-studio']),
      });
      console.log(JSON.stringify(result, null, 2));
    } catch (error) {
      const home = await resolveInstalledHome(values.home).catch(() => defaultOpenGameHome('prod'));
      await recordDiagnostic(home, { kind: 'installation_failed', message: error.message }).catch(() => {});
      throw error;
    }
  } else if (command === 'mcp') {
    const home = await bootstrapForDirectMcp({
      home: values.home,
      dataDirectory: values['data-dir'],
      manifest: values.manifest,
      autoUpdate: values['no-auto-update'] ? false : undefined,
    });
    const code = await runManagedMcp({ home });
    process.exit(code);
  } else if (command === 'update') {
    console.log(JSON.stringify(await update({ home: values.home, check: Boolean(values.check), force: Boolean(values.force) }), null, 2));
  } else if (command === 'rollback') {
    const home = await resolveInstalledHome(values.home);
    const result = await rollbackInstallation({ home, reason: 'manual', markBad: true });
    console.log(JSON.stringify(result, null, 2));
    if (!result.rolledBack) process.exitCode = 1;
  } else if (command === 'prepare') {
    const home = await resolveInstalledHome(values.home);
    const state = await readInstallState(home);
    assert(state?.managedBy === managedBy, 'Run opengame setup first.');
    const native = await nativeConfiguration(state.current.appRoot);
    if (!native) {
      console.log(`No pinned native downloads for ${process.platform}-${process.arch}; using system Chrome/FFmpeg or HYPERFRAMES_* environment overrides.`);
    } else {
      const components = values['with-trailer'] ? undefined : ['browser'];
      await ensureNativeRuntime(state.current.appRoot, components);
      console.log(values['with-trailer']
        ? 'Pinned headless browser and trailer media components (FFmpeg/ffprobe) are ready.'
        : 'Pinned headless browser is ready (pass --with-trailer to also pre-download FFmpeg/ffprobe).');
    }
  } else if (command === 'diagnose') {
    const result = await diagnose({ home: values.home, host: values.host, codex: values.codex, claude: values.claude, dsh: values.dsh, profile: values.profile });
    console.log(JSON.stringify(result, null, 2));
    if (result.status !== 'passed') process.exitCode = 1;
  } else if (command === 'tools' || command === 'call') {
    assert(command !== 'call' || values['args-file'], 'call requires --args-file FILE.json');
    const result = await callInstalled(
      values,
      command === 'call' ? positionals[1] : undefined,
      command === 'call' ? JSON.parse(await readFile(values['args-file'], 'utf8')) : {},
    );
    console.log(JSON.stringify(result, null, 2));
    if (result.isError) process.exitCode = 1;
  } else if (command === 'diagnostics') {
    const home = await resolveInstalledHome(values.home);
    const state = await readInstallState(home).catch(() => null);
    const dataDirectory = values['data-dir'] || state?.dataDirectory || path.join(home, 'data');
    console.log(JSON.stringify(await exportDiagnostics({
      appRoot: state?.current?.appRoot || fileURLToPath(new URL('../', import.meta.url)),
      installHome: home,
      dataDirectory,
      output: values.output,
    }), null, 2));
  } else {
    throw new Error('Supported commands: setup, mcp, update, rollback, prepare, diagnose, tools, call, diagnostics');
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  main().catch(error => {
    console.error(error.message + '\nRun opengame --help for supported hosts and commands.');
    process.exitCode = 1;
  });
}
