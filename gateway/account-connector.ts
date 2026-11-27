import { connectorCauseCodes } from '../tracking/tool-fields.ts';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { access, mkdir, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { withProcessLock } from '../shared/process-lock.ts';

const execute = promisify(execFile);
/** The OpenDesign connector version this release speaks to. */
export const connectorVersion = '0.1.10';
export const connectorPackage = '@powerformer/vela-cli';
/** Why a connector could not be prepared: npm was not found, npm could not install it, or the installed copy does not run. */
export type ConnectorProblem = 'npm_missing' | 'install_failed' | 'install_timeout' | 'start_failed';

export const connectorAdvice = {
  permissions: 'OpenDesign could not access the sign-in component. Check folder permissions and device security settings, then select Retry.',
  preparationTimeout: 'Preparing the OpenDesign sign-in component timed out. Check the network and try again.',
  unsupportedPlatform: 'The OpenDesign sign-in component does not support this Node platform and architecture. Install a supported Node runtime, then select Retry.',
  installTimeout: 'The sign-in component installation timed out. Check your connection and select Retry.',
} as const;

export class ConnectorUnavailable extends Error {
  readonly problem: ConnectorProblem;
  /** Local diagnostic only (end of npm's output or the start error); never shown or sent as telemetry. */
  readonly detail: string;
  readonly causeCode?: string;
  readonly advice?: string;
  constructor(problem: ConnectorProblem, detail: unknown) {
    super('OpenDesign connector unavailable: ' + problem);
    this.problem = problem;
    const cause = detail as NodeJS.ErrnoException & { killed?: boolean };
    if (cause?.code === 'EACCES' || cause?.code === 'EPERM') this.advice = connectorAdvice.permissions;
    else if (problem === 'install_timeout') this.advice = connectorAdvice.installTimeout;
    else if (cause?.killed || cause?.code === 'ETIMEDOUT') this.advice = connectorAdvice.preparationTimeout;
    else if (cause?.message?.includes('Vela CLI is not packaged for')) this.advice = connectorAdvice.unsupportedPlatform;
    const output = (detail as { stderr?: unknown })?.stderr;
    const code = (detail as NodeJS.ErrnoException | undefined)?.code;
    const npmCode = typeof output === 'string' ? /^npm (?:error|ERR!) code ([A-Z0-9_]+)$/mi.exec(output)?.[1] : undefined;
    this.causeCode = [code, npmCode].find(value => typeof value === 'string' && connectorCauseCodes.includes(value));
    this.detail = String(typeof output === 'string' && output.trim() ? output : (detail as Error)?.message ?? detail).trim().slice(-600);
  }
}

/** The private installation, outside the application so it survives upgrades and needs nothing on PATH. */
export const connectorRuntime = (dataDirectory: string) => path.join(dataDirectory, 'account', 'runtime');
const installArgs = (root: string) => ['install', '--prefix', root, '--include=optional', '--ignore-scripts', '--no-audit', '--no-fund', '--save-exact', `${connectorPackage}@${connectorVersion}`];
/** What a person can run in a terminal when automatic installation keeps failing. POSIX shells expand `$` and backticks in double quotes. */
export function manualInstallCommand(root: string, platform = process.platform) {
  const quoted = platform === 'win32' ? `"${root}"` : `'${root.replaceAll("'", `'\\''`)}'`;
  return `npm install --prefix ${quoted} --ignore-scripts ${connectorPackage}@${connectorVersion}`;
}

/**
 * npm locations to try, most specific first. `process.execPath` is the resolved binary, so a Homebrew Node reports its
 * Cellar directory, where npm lives under `libexec` rather than next to Node. Hosts may also start the service without
 * the terminal's npm on PATH, so PATH is the last resort rather than the first.
 */
export function npmCliCandidates(execPath: string, platform: string, env: NodeJS.ProcessEnv) {
  const join = platform === 'win32' ? path.win32.join : path.posix.join, dirname = platform === 'win32' ? path.win32.dirname : path.posix.dirname;
  const bin = dirname(execPath), cli = ['node_modules', 'npm', 'bin', 'npm-cli.js'];
  const launched = env.npm_execpath && /(^|[\\/])npm-cli\.js$/.test(env.npm_execpath) ? [env.npm_execpath] : [];
  if (platform === 'win32') return [...launched, join(bin, ...cli)];
  return [...launched, join(bin, '..', 'lib', ...cli), join(bin, '..', 'libexec', 'lib', ...cli)];
}
async function npmOnPath(platform: string, env: NodeJS.ProcessEnv) {
  const separator = platform === 'win32' ? ';' : ':';
  for (const directory of (env.PATH ?? env.Path ?? '').split(separator).filter(Boolean)) {
    // Windows ships `npm.cmd` beside `node_modules\npm`; elsewhere `npm` links to `npm-cli.js`.
    const candidate = platform === 'win32' ? path.join(directory, 'node_modules', 'npm', 'bin', 'npm-cli.js') : await realpath(path.join(directory, 'npm')).catch(() => '');
    if (candidate.endsWith('npm-cli.js') && await access(candidate).then(() => true, () => false)) return candidate;
  }
}
export async function findNpmCli(execPath = process.execPath, platform = process.platform, env = process.env) {
  for (const candidate of npmCliCandidates(execPath, platform, env)) if (await access(candidate).then(() => true, () => false)) return candidate;
  return npmOnPath(platform, env);
}

/** The connector binary installed under `from` (a module or package.json path), checked to be the locked version. */
export async function verifyConnector(from: string) {
  const binary = createRequire(from)(connectorPackage).resolveVelaCliBin({ strict: true }) as string;
  const { stdout } = await execute(binary, ['--version'], { timeout: process.platform === 'win32' ? 20_000 : 5000, windowsHide: true });
  if (stdout.trim() !== connectorVersion) throw Object.assign(new Error('The installed account connector version is not supported'), { code: 'VERSION_MISMATCH' });
  return binary;
}

/** Installs the locked connector into `root` with lifecycle scripts disabled; reuses an installation that already works. */
export async function installConnector(root: string, options: { signal?: AbortSignal; timeoutMs?: number; findNpm?: () => Promise<string | undefined> } = {}): Promise<string> {
  try {
    return await withProcessLock(root + '.install.lock', () => installLocked(root, options), options.timeoutMs ?? 300_000);
  } catch (error) {
    if (error instanceof ConnectorUnavailable) throw error;
    throw new ConnectorUnavailable('install_failed', error);
  }
}
async function installLocked(root: string, options: Parameters<typeof installConnector>[1] = {}): Promise<string> {
  const manifest = path.join(root, 'package.json');
  try { return await verifyConnector(manifest); } catch { /* Install below. */ }
  options.signal?.throwIfAborted();
  const npmCli = await (options.findNpm ?? findNpmCli)();
  if (!npmCli) throw new ConnectorUnavailable('npm_missing', 'npm was not found next to ' + process.execPath + ' or on PATH');
  try {
    await mkdir(root, { recursive: true, mode: 0o700 });
    // npm install can report "up to date" even when an installed vela.exe is missing.
    // A managed lockfile allows npm ci to restore the private runtime from its pinned packages.
    const args = installArgs(root);
    const locked = await readFile(path.join(root, 'package-lock.json'), 'utf8').then(text => JSON.parse(text).packages?.['']?.dependencies?.[connectorPackage] === connectorVersion).catch(() => false);
    const command = locked ? ['ci', '--prefix', root, '--include=optional', '--ignore-scripts', '--no-audit', '--no-fund'] : args;
    await execute(process.execPath, [npmCli, ...command], { timeout: options.timeoutMs ?? 300_000, maxBuffer: 1024 * 1024, signal: options.signal, windowsHide: true });
  } catch (error) {
    const timedOut = (error as { killed?: boolean }).killed && !options.signal?.aborted;
    throw new ConnectorUnavailable(timedOut ? 'install_timeout' : 'install_failed', error);
  }
  try { return await verifyConnector(manifest); } catch (error) { throw new ConnectorUnavailable('start_failed', error); }
}
