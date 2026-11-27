import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { appendFile, link, mkdir, mkdtemp, open, readFile, readdir, rename, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { uptime } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { extractArchive, processAlive, readJSON, runFile, sha256, withCacheLock, writeJSON } from './runtime-assets.mjs';
import { checkOpenGameTransport } from './opengame-check-mcp.mjs';
import { managedBy, syncInstalledHostSkills } from './opengame-hosts.mjs';

export const DEFAULT_NPM_REGISTRIES = ['https://registry.npmjs.org', 'https://registry.npmmirror.com'];
export const DEFAULT_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
export const DEFAULT_HEALTHY_AFTER_MS = 15_000;
export const DEFAULT_MAX_CRASHES = 2;
export const DEFAULT_INSTALL_LOCK_TIMEOUT_MS = 5_000;
export const DEFAULT_INSTALL_LOCK_STALE_MS = 15 * 60_000;
const CORRUPT_LOCK_GRACE_MS = 2_000;
const REBOOT_CLOCK_SKEW_MS = 60_000;

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function parseNonNegativeMs(explicit, envValue, fallback, { min = 0 } = {}) {
  if (typeof explicit === 'number' && Number.isFinite(explicit) && explicit >= min) return explicit;
  if (typeof envValue === 'string' && envValue.trim() !== '') {
    const parsed = Number(envValue);
    if (Number.isFinite(parsed) && parsed >= min) return parsed;
  }
  return fallback;
}

function parseLockOwner(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^\d+$/.test(trimmed)) {
    const pid = Number(trimmed);
    return Number.isSafeInteger(pid) && pid > 0 ? { pid, token: null, createdAt: null } : null;
  }
  try {
    const parsed = JSON.parse(trimmed);
    const pid = typeof parsed === 'number' ? parsed : parsed?.pid;
    if (!Number.isSafeInteger(pid) || pid <= 0) return null;
    const token = typeof parsed?.token === 'string' && parsed.token.trim() ? parsed.token : null;
    const createdAt = typeof parsed?.createdAt === 'number' && Number.isFinite(parsed.createdAt) ? parsed.createdAt : null;
    return { pid, token, createdAt };
  } catch {
    return null;
  }
}

function isLockStale(owner, lockStat, now, maxAgeMs) {
  if (!owner) {
    return now - lockStat.mtimeMs >= Math.min(maxAgeMs, CORRUPT_LOCK_GRACE_MS);
  }
  if (!processAlive(owner.pid)) return true;
  const lockOriginAt = owner.createdAt !== null ? Math.min(owner.createdAt, lockStat.mtimeMs) : lockStat.mtimeMs;
  const systemUptimeMs = uptime() * 1000;
  if (Number.isFinite(systemUptimeMs) && systemUptimeMs > 0) {
    const bootTimeMs = now - systemUptimeMs;
    if (lockOriginAt < bootTimeMs - REBOOT_CLOCK_SKEW_MS) return true;
  }
  return now - lockStat.mtimeMs >= maxAgeMs;
}

/**
 * Acquire `install.lock` with heartbeat refresh, stale-lock reclamation, and a bounded retry wait.
 * While `work()` executes, the lock file's mtime is heartbeated periodically so legitimate long-running
 * operations (such as slow downloads or `npm ci`) are never reclaimed while active.
 * Reclaims locks when:
 * - the recorded owning PID has exited,
 * - the lock predates the current OS boot (PID reuse after reboot),
 * - the lock heartbeat (mtime) has been inactive for `staleMs` (default 15 minutes), or
 * - the lock file is empty/truncated/corrupt past a brief grace window.
 */
export async function withInstallLock(filename, work, { timeoutMs, staleMs } = {}) {
  const waitMs = parseNonNegativeMs(timeoutMs, process.env.OPENGAME_INSTALL_LOCK_TIMEOUT_MS, DEFAULT_INSTALL_LOCK_TIMEOUT_MS);
  const maxAgeMs = parseNonNegativeMs(staleMs, process.env.OPENGAME_INSTALL_LOCK_STALE_MS, DEFAULT_INSTALL_LOCK_STALE_MS, { min: 1 });
  await mkdir(path.dirname(filename), { recursive: true });
  const token = randomUUID();
  const candidate = filename + '.' + token;
  await writeFile(candidate, JSON.stringify({ pid: process.pid, token, createdAt: Date.now() }), { mode: 0o600 });
  const deadline = Date.now() + waitMs;
  try {
    for (;;) {
      try {
        await link(candidate, filename);
        await rm(candidate, { force: true }).catch(() => {});
        break;
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
      }
      const [raw, lockStat] = await Promise.all([
        readFile(filename, 'utf8').catch(error => (error.code === 'ENOENT' ? null : Promise.reject(error))),
        stat(filename).catch(error => (error.code === 'ENOENT' ? null : Promise.reject(error))),
      ]);
      if (raw === null || lockStat === null) continue;
      const owner = parseLockOwner(raw);
      if (isLockStale(owner, lockStat, Date.now(), maxAgeMs)) {
        await withCacheLock(filename + '.reclaim', async () => {
          const [currentRaw, currentStat] = await Promise.all([
            readFile(filename, 'utf8').catch(error => (error.code === 'ENOENT' ? null : Promise.reject(error))),
            stat(filename).catch(error => (error.code === 'ENOENT' ? null : Promise.reject(error))),
          ]);
          if (currentRaw === raw && currentStat && currentStat.ino === lockStat.ino && currentStat.mtimeMs === lockStat.mtimeMs) {
            await rm(filename, { force: true });
          }
        });
        continue;
      }
      if (Date.now() >= deadline) {
        const ownerDesc = owner?.pid ? `pid ${owner.pid}` : 'unknown owner';
        const staleLabel = maxAgeMs >= 60_000 ? `${Math.round(maxAgeMs / 60_000)}m` : `${Math.max(1, Math.round(maxAgeMs / 1000))}s`;
        throw Object.assign(
          new Error(
            `Another OpenGame operation is using ${filename} (${ownerDesc}). `
            + `Retry after it finishes; stale locks are reclaimed automatically after the owning process exits or after ${staleLabel} of inactivity, `
            + `or confirm no OpenGame setup/update is running and remove ${filename} manually.`,
          ),
          { code: 'INSTALL_LOCK_BUSY', lockFile: filename, ownerPid: owner?.pid ?? null },
        );
      }
      await pause(50);
    }
    const heartbeatIntervalMs = Math.max(20, Math.min(60_000, Math.floor(maxAgeMs / 3)));
    let released = false;
    let heartbeatPromise = null;
    let heartbeatTimer = null;
    const refreshHeartbeat = () => {
      if (released || heartbeatPromise) return;
      heartbeatPromise = (async () => {
        try {
          const currentRaw = await readFile(filename, 'utf8').catch(() => null);
          if (released || parseLockOwner(currentRaw)?.token !== token) {
            if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
            return;
          }
          const now = new Date();
          await utimes(filename, now, now);
        } catch {
          // Ignore transient heartbeat I/O errors; release verifies token ownership.
        } finally {
          heartbeatPromise = null;
        }
      })();
    };
    heartbeatTimer = setInterval(refreshHeartbeat, heartbeatIntervalMs);
    heartbeatTimer.unref?.();
    try {
      return await work();
    } finally {
      released = true;
      if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
      if (heartbeatPromise) await heartbeatPromise;
      const currentRaw = await readFile(filename, 'utf8').catch(() => null);
      if (parseLockOwner(currentRaw)?.token === token) {
        await rm(filename, { force: true });
      }
    }
  } finally {
    await rm(candidate, { force: true });
  }
}

function isAllowedRegistryUrl(raw) {
  try {
    const url = new URL(raw);
    if (url.username || url.password) return false;
    if (url.protocol === 'https:') return true;
    return url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  } catch {
    return false;
  }
}

export function parseRegistries(registries) {
  const raw = Array.isArray(registries) && registries.length
    ? registries
    : (process.env.OPENGAME_NPM_REGISTRIES ? process.env.OPENGAME_NPM_REGISTRIES.split(',') : DEFAULT_NPM_REGISTRIES);
  const cleaned = raw.map(entry => String(entry).trim().replace(/\/+$/, '')).filter(Boolean);
  assert(cleaned.length > 0, 'At least one npm registry URL is required');
  for (const url of cleaned) assert(isAllowedRegistryUrl(url), 'Invalid npm registry URL: ' + url);
  return cleaned;
}

export function compareSemver(left, right) {
  const parse = value => {
    const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(String(value || ''));
    assert(match, 'Invalid semver: ' + value);
    return {
      core: [BigInt(match[1]), BigInt(match[2]), BigInt(match[3])],
      pre: match[4] ? match[4].split('.').map(id => (/^\d+$/.test(id) ? BigInt(id) : id)) : null,
    };
  };
  const a = parse(left), b = parse(right);
  for (let i = 0; i < 3; i++) {
    if (a.core[i] !== b.core[i]) return a.core[i] > b.core[i] ? 1 : -1;
  }
  if (!a.pre && !b.pre) return 0;
  if (!a.pre) return 1;
  if (!b.pre) return -1;
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
    if (a.pre[i] === undefined) return -1;
    if (b.pre[i] === undefined) return 1;
    const x = a.pre[i], y = b.pre[i];
    if (x === y) continue;
    if (typeof x === 'bigint' && typeof y === 'bigint') return x > y ? 1 : -1;
    if (typeof x === 'bigint') return -1;
    if (typeof y === 'bigint') return 1;
    return x > y ? 1 : -1;
  }
  return 0;
}

async function digestFile(filename, algorithm, encoding) {
  const hash = createHash(algorithm);
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  return hash.digest(encoding);
}

export async function verifyIntegrity(filename, integrity, shasum) {
  if (typeof integrity === 'string' && integrity.trim()) {
    const tokens = integrity.trim().split(/\s+/);
    let checked = false;
    for (const token of tokens) {
      const match = /^(sha512|sha384|sha256)-([A-Za-z0-9+/=]+)$/.exec(token);
      if (!match) continue;
      checked = true;
      const actual = await digestFile(filename, match[1], 'base64');
      if (actual === match[2]) return { algorithm: match[1], digest: actual };
    }
    if (checked) throw Object.assign(new Error('INTEGRITY_MISMATCH: downloaded npm tarball failed SRI verification'), { code: 'INTEGRITY_MISMATCH' });
    if (/^[a-f0-9]{64}$/.test(integrity.trim())) {
      const actual = await sha256(filename);
      if (actual !== integrity.trim()) throw Object.assign(new Error('INTEGRITY_MISMATCH: downloaded tarball SHA256 mismatch'), { code: 'INTEGRITY_MISMATCH' });
      return { algorithm: 'sha256', digest: actual };
    }
  }
  if (typeof shasum === 'string' && /^[a-f0-9]{40}$/i.test(shasum)) {
    const actual = await digestFile(filename, 'sha1', 'hex');
    if (actual.toLowerCase() !== shasum.toLowerCase()) {
      throw Object.assign(new Error('INTEGRITY_MISMATCH: downloaded npm tarball shasum mismatch'), { code: 'INTEGRITY_MISMATCH' });
    }
    return { algorithm: 'sha1', digest: actual };
  }
  throw Object.assign(new Error('INTEGRITY_MISSING: registry response omitted dist.integrity and dist.shasum'), { code: 'INTEGRITY_MISSING' });
}

export async function checkNpmUpdate({
  packageName = 'opengame',
  channel = 'stable',
  currentVersion,
  badVersions = [],
  registries,
  fetchImpl = fetch,
  timeoutMs = 10_000,
} = {}) {
  const list = parseRegistries(registries);
  const distTag = channel === 'test' || channel === 'dev' ? 'test' : 'latest';
  const encodedName = packageName.startsWith('@') ? packageName.replace('/', '%2F') : encodeURIComponent(packageName);
  const errors = [];
  for (const registry of list) {
    try {
      const url = packageName.startsWith('@') ? `${registry}/${encodedName}` : `${registry}/${encodedName}/${encodeURIComponent(distTag)}`;
      const response = await fetchImpl(url, {
        headers: { Accept: 'application/json' },
        redirect: 'follow',
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) {
        errors.push(`${registry}: HTTP ${response.status}`);
        continue;
      }
      const data = await response.json();
      let meta = data;
      if (data?.['dist-tags'] && data?.versions) {
        const tagged = data['dist-tags'][distTag];
        if (!tagged || !data.versions[tagged]) {
          return { available: false, reason: 'tag_missing', distTag, registry };
        }
        meta = data.versions[tagged];
      }
      const version = meta?.version;
      const tarballUrl = meta?.dist?.tarball;
      const integrity = meta?.dist?.integrity;
      const shasum = meta?.dist?.shasum;
      if (typeof version !== 'string' || typeof tarballUrl !== 'string' || (!integrity && !shasum)) {
        errors.push(`${registry}: malformed registry metadata`);
        continue;
      }
      assert(isAllowedRegistryUrl(tarballUrl), 'Disallowed tarball URL: ' + tarballUrl);
      if (badVersions.includes(version)) {
        return { available: false, reason: 'blocked_bad_version', version, registry };
      }
      if (currentVersion && compareSemver(version, currentVersion) <= 0) {
        return { available: false, reason: 'up_to_date', version, currentVersion, registry };
      }
      return { available: true, version, tarballUrl, integrity, shasum, distTag, registry };
    } catch (error) {
      errors.push(`${registry}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { available: false, reason: 'registry_unreachable', errors };
}

export async function downloadTarball(tarballUrl, destination, { integrity, shasum, fetchImpl = fetch, timeoutMs = 120_000 } = {}) {
  assert(isAllowedRegistryUrl(tarballUrl), 'Disallowed tarball URL: ' + tarballUrl);
  await mkdir(path.dirname(destination), { recursive: true });
  try {
    await verifyIntegrity(destination, integrity, shasum);
    return destination;
  } catch (error) {
    if (error.code !== 'ENOENT' && error.code !== 'INTEGRITY_MISMATCH') throw error;
  }
  const temporary = destination + '.' + randomUUID() + '.part';
  try {
    const response = await fetchImpl(tarballUrl, { redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok || !response.body) {
      throw new Error(`Tarball download failed: HTTP ${response.status}`);
    }
    await pipeline(Readable.fromWeb(response.body), createWriteStream(temporary));
    await verifyIntegrity(temporary, integrity, shasum);
    await rename(temporary, destination);
    return destination;
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function verifyBundledDependencies(directory, info) {
  if (!info) return;
  assert(info.platform === process.platform && info.arch === process.arch,
    `Prebuilt npm runtime targets ${info.platform}/${info.arch}`);
  assert(/^[a-f0-9]{64}$/.test(info.lockSHA256), 'Prebuilt npm runtime requires lockSHA256');
  assert.deepEqual(await readJSON(path.join(directory, '.bundled-dependencies.json')), info, 'Prebuilt npm runtime identity mismatch');
  assert.equal(await sha256(path.join(directory, 'package-lock.json')), info.lockSHA256, 'Prebuilt npm runtime dependency lock mismatch');
  const pkg = await readJSON(path.join(directory, 'package.json'));
  for (const [name, version] of Object.entries(pkg.dependencies || {})) {
    assert.equal((await readJSON(path.join(directory, 'node_modules', name, 'package.json')))?.version, version,
      'Prebuilt npm runtime is incomplete or stale: ' + name);
  }
}

export async function installProductionDeps(directory, registries) {
  const npm = process.env.npm_execpath || path.join(path.dirname(process.execPath), process.platform === 'win32' ? 'node_modules/npm/bin/npm-cli.js' : '../lib/node_modules/npm/bin/npm-cli.js');
  const list = parseRegistries(registries);
  let lastError;
  for (const registry of list) {
    try {
      await runFile(process.execPath, [npm, 'ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], {
        cwd: directory,
        env: { ...process.env, npm_config_registry: registry, npm_config_fetch_retries: '0' },
      });
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

export async function installApplicationArchive({ home, archivePath, manifest, installDeps, registries, force = false, excludeAppRoot = null }) {
  assert(manifest?.schemaVersion === 1 && typeof manifest.version === 'string', 'Invalid OpenGame release manifest');
  assert.equal(manifest.mcp?.profile, 'game', 'Package manifest is not an OpenGame game profile');
  assert(/^[a-f0-9]{64}$/.test(manifest.application?.sha256), 'Missing pinned application SHA256');
  assert.equal(await sha256(archivePath), manifest.application.sha256, 'Application archive SHA256 mismatch');
  let appRoot = path.join(home, 'apps', `${manifest.version}-${manifest.application.sha256.slice(0, 16)}`);
  if (force && excludeAppRoot && path.resolve(appRoot) === path.resolve(excludeAppRoot)) {
    appRoot = `${appRoot}-${randomUUID().slice(0, 8)}`;
  }
  if (!force) {
    const existing = await readJSON(path.join(appRoot, '.npm-install.json'));
    if (existing && existing.applicationSHA256 === manifest.application.sha256) {
      return appRoot;
    }
  }
  await mkdir(path.join(home, 'apps'), { recursive: true });
  const temporary = await mkdtemp(path.join(home, 'apps', '.stage-'));
  try {
    await extractArchive(archivePath, temporary);
    const pkg = await readJSON(path.join(temporary, 'package.json'));
    assert.equal(pkg?.version, manifest.version, 'Extracted application version mismatch');
    const release = await readJSON(path.join(temporary, 'shared/mcp-release.json'));
    assert.equal(release?.profile, 'game', 'Extracted application must stamp game MCP profile');
    for (const file of ['mcp.ts', 'scripts/npm-runtime.mjs', 'studio/build/index.html', 'skills/openmotion-game/SKILL.md']) {
      await readFile(path.join(temporary, file));
    }
    if (manifest.bundledDependencies) {
      await verifyBundledDependencies(temporary, manifest.bundledDependencies);
    } else if (installDeps) {
      await installDeps(temporary);
    } else {
      await installProductionDeps(temporary, registries);
    }
    await writeJSON(path.join(temporary, '.npm-install.json'), {
      schemaVersion: 1,
      applicationSHA256: manifest.application.sha256,
      installHome: home,
      commit: manifest.commit,
      cacheDirectory: path.join(home, 'cache/native'),
      runtime: manifest.runtime,
      allowLocalAssets: true,
    });
    await rm(appRoot, { recursive: true, force: true });
    await rename(temporary, appRoot);
    return appRoot;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

function normalizeState(state, home) {
  if (!state) return null;
  if (state.current?.appRoot) return { ...state, home: state.home || home };
  return {
    ...state,
    home: state.home || home,
    current: {
      version: state.version,
      sha256: state.applicationSHA256 || '',
      appRoot: state.appRoot,
      activatedAt: state.activatedAt || new Date().toISOString(),
      healthy: true,
      crashCount: 0,
    },
    previous: state.previous || null,
    staged: state.staged || null,
    badVersions: Array.isArray(state.badVersions) ? state.badVersions : [],
  };
}

export async function readInstallState(home) {
  const raw = await readJSON(path.join(home, 'install.json'));
  return normalizeState(raw, home);
}

export async function writeInstallState(home, state) {
  const next = {
    ...state,
    home,
    version: state.current.version,
    appRoot: state.current.appRoot,
  };
  await writeJSON(path.join(home, 'install.json'), next);
  return next;
}

export async function pruneOldApps(home, state) {
  const keep = new Set([state?.current?.appRoot, state?.previous?.appRoot, state?.staged?.appRoot].filter(Boolean).map(p => path.resolve(p)));
  const appsDir = path.join(home, 'apps');
  const entries = await readdir(appsDir, { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
  const removed = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const full = path.resolve(appsDir, entry.name);
    if (keep.has(full)) continue;
    await rm(full, { recursive: true, force: true }).catch(() => {});
    removed.push(entry.name);
  }
  return removed;
}

export async function retireIdleBackend(dataDirectory, { fetchImpl = fetch, timeoutMs = 2000 } = {}) {
  // 1. Check macOS shared editor runtime first.
  const editorRecord = await readJSON(path.join(dataDirectory, '.editor-runtime', 'runtime.json')).catch(() => null);
  if (editorRecord?.endpoint && editorRecord?.token) {
    try {
      const response = await fetchImpl(new URL('/editor-api/shutdown', editorRecord.endpoint), {
        method: 'POST',
        headers: { Authorization: `Bearer ${editorRecord.token}` },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (response.status === 409) {
        const body = await response.json().catch(() => ({}));
        return { retired: false, busy: true, kind: 'shared-editor', active: body.active };
      }
      if (response.ok) {
        for (let i = 0; i < 30; i++) {
          if (!processAlive(editorRecord.pid)) break;
          await pause(100);
        }
        return { retired: true, busy: false, kind: 'shared-editor' };
      }
    } catch {
      // Connection refused / stale record — fall through to standalone check.
    }
  }
  // 2. Check standalone server.ts registered in preview.json.
  const previewRecord = await readJSON(path.join(dataDirectory, 'preview.json')).catch(() => null);
  if (Number.isInteger(previewRecord?.port) && previewRecord.port >= 1024 && previewRecord.port <= 65535) {
    const base = `http://127.0.0.1:${previewRecord.port}`;
    try {
      const activityRes = await fetchImpl(`${base}/api/runtime/activity`, { signal: AbortSignal.timeout(timeoutMs) });
      if (activityRes.ok) {
        const activity = await activityRes.json();
        if (typeof activity.dataDirectory === 'string' && path.resolve(activity.dataDirectory) === path.resolve(dataDirectory)) {
          if (!activity.idle) return { retired: false, busy: true, kind: 'standalone', active: activity.active };
          const retireRes = await fetchImpl(`${base}/api/runtime/retire`, { method: 'POST', signal: AbortSignal.timeout(timeoutMs) });
          if (retireRes.status === 409) {
            const body = await retireRes.json().catch(() => ({}));
            return { retired: false, busy: true, kind: 'standalone', active: body.active };
          }
          if (retireRes.ok) {
            const body = await retireRes.json().catch(() => ({}));
            if (body.standalone !== false && Number.isInteger(body.pid)) {
              for (let i = 0; i < 30; i++) {
                if (!processAlive(body.pid)) break;
                await pause(100);
              }
            }
            return { retired: true, busy: false, kind: 'standalone' };
          }
        }
      }
    } catch {
      // Server not running or unreachable — already stopped.
    }
  }
  return { retired: true, busy: false, kind: 'stopped' };
}

/**
 * Serialize every install.json read-modify-write on the same `install.lock` held by `setup()` and
 * `bootstrapForDirectMcp()` so concurrent setup and background updater writes never clobber hosts
 * or current version state. Always acquire `update.lock` before `install.lock` when both are used.
 */
async function mutateInstallState(home, transform, options) {
  return withInstallLock(path.join(home, 'install.lock'), async () => {
    const latest = await readInstallState(home);
    const outcome = await transform(latest);
    if (!outcome) return { state: latest, result: undefined };
    const written = outcome.next ? await writeInstallState(home, outcome.next) : latest;
    return { state: written, result: outcome.result };
  }, options);
}

async function recordBadVersion(home, version) {
  await mutateInstallState(home, latest => {
    if (!latest) return null;
    const badVersions = [...new Set([...(latest.badVersions || []), version])];
    return { next: { ...latest, badVersions, lastUpdateCheckAt: new Date().toISOString() } };
  });
}

export async function stageNpmUpdate({
  home,
  target,
  force = false,
  fetchImpl = fetch,
  registries,
  installDeps,
  probeTimeoutMs = 20_000,
  probeTransport = checkOpenGameTransport,
} = {}) {
  return withCacheLock(path.join(home, 'update.lock'), async () => {
    const state = await readInstallState(home);
    assert(state?.managedBy === managedBy, 'Installation directory is not managed by OpenGame');
    if (!force && state.current.version === target.version) {
      return { status: 'already_current', version: target.version };
    }
    if (!force && state.staged?.version === target.version) {
      return { status: 'already_staged', staged: state.staged };
    }
    if (!force && (state.badVersions || []).includes(target.version)) {
      return { status: 'skipped_bad_version', version: target.version };
    }
    const safeName = (state.packageName || 'opengame').replace(/[^a-z0-9._-]/gi, '_');
    const tgzPath = path.join(home, 'cache/downloads', `${safeName}-${target.version}.tgz`);
    await downloadTarball(target.tarballUrl, tgzPath, { integrity: target.integrity, shasum: target.shasum, fetchImpl });

    const extractRoot = await mkdtemp(path.join(home, 'cache', '.pkg-'));
    let appRoot;
    try {
      await extractArchive(tgzPath, extractRoot);
      const pkgDir = path.join(extractRoot, 'package');
      const pkg = await readJSON(path.join(pkgDir, 'package.json'));
      const manifest = await readJSON(path.join(pkgDir, 'payload/release-npm.json'));
      assert.equal(pkg?.version, target.version, 'Tarball package.json version mismatch');
      assert.equal(manifest?.version, target.version, 'Embedded release manifest version mismatch');
      assert.equal(manifest?.mcp?.profile, 'game', 'Downloaded npm package is not an OpenGame game profile');
      const archivePath = path.resolve(path.join(pkgDir, 'payload'), manifest.application.url);
      appRoot = await installApplicationArchive({
        home,
        archivePath,
        manifest,
        installDeps,
        registries,
        force,
        excludeAppRoot: state.current?.appRoot,
      });
      const expectedTools = (await readJSON(path.join(appRoot, 'shared/mcp-profiles.json'))).game.tools;
      try {
        probeTransport(
          { transport: { type: 'stdio', command: process.execPath, args: ['--experimental-strip-types', path.join(appRoot, 'mcp.ts')], cwd: appRoot, env: { MOTION_DATA_DIR: state.dataDirectory } } },
          target.version,
          { expectedTools, verifyResourceUri: 'openmotion://workflow/game/start', verifyGameId: null, timeoutMs: probeTimeoutMs },
        );
      } catch (error) {
        await rm(appRoot, { recursive: true, force: true }).catch(() => {});
        await recordBadVersion(home, target.version);
        throw Object.assign(new Error('UPDATE_PROBE_FAILED: ' + (error instanceof Error ? error.message : String(error))), { code: 'UPDATE_PROBE_FAILED', cause: error });
      }
      const staged = {
        version: target.version,
        sha256: manifest.application.sha256,
        appRoot,
        stagedAt: new Date().toISOString(),
      };
      const { result } = await mutateInstallState(home, latest => {
        assert(latest?.managedBy === managedBy, 'Installation directory is not managed by OpenGame');
        if (!force && latest.current.version === target.version) {
          return { result: { status: 'already_current', version: target.version } };
        }
        const badVersions = (latest.badVersions || []).filter(version => version !== target.version);
        return {
          next: { ...latest, staged, badVersions, lastUpdateCheckAt: new Date().toISOString() },
          result: { status: 'staged', staged },
        };
      });
      return result;
    } finally {
      await rm(extractRoot, { recursive: true, force: true });
    }
  });
}

export async function applyStagedUpdate({ home, fetchImpl = fetch } = {}) {
  return withCacheLock(path.join(home, 'update.lock'), async () => {
    const initial = await readInstallState(home);
    assert(initial?.managedBy === managedBy, 'Installation directory is not managed by OpenGame');
    if (!initial.staged?.appRoot) return { applied: false, reason: 'no_staged_update' };
    const expectedStagedRoot = initial.staged.appRoot;
    const stagedMeta = await readJSON(path.join(expectedStagedRoot, '.npm-install.json')).catch(() => null);
    if (!stagedMeta) {
      await mutateInstallState(home, latest => (
        latest?.staged?.appRoot === expectedStagedRoot ? { next: { ...latest, staged: null } } : null
      ));
      return { applied: false, reason: 'staged_missing' };
    }
    const retirement = await retireIdleBackend(initial.dataDirectory, { fetchImpl });
    if (retirement.busy) {
      return { applied: false, reason: 'backend_busy', active: retirement.active };
    }
    const { state: next, result } = await mutateInstallState(home, latest => {
      assert(latest?.managedBy === managedBy, 'Installation directory is not managed by OpenGame');
      if (!latest.staged?.appRoot || latest.staged.appRoot !== expectedStagedRoot) {
        return { result: { applied: false, reason: 'no_staged_update' } };
      }
      const previousVersion = latest.current.version;
      const previous = latest.current.version === latest.staged.version
        ? (latest.previous || null)
        : { ...latest.current, healthy: true, crashCount: 0 };
      const current = {
        version: latest.staged.version,
        sha256: latest.staged.sha256,
        appRoot: latest.staged.appRoot,
        activatedAt: new Date().toISOString(),
        healthy: false,
        crashCount: 0,
      };
      return {
        next: { ...latest, current, previous, staged: null },
        result: { applied: true, version: current.version, previousVersion, retirement },
      };
    });
    if (result.applied) {
      await syncInstalledHostSkills(next, next.current.appRoot, next.current.version).catch(() => {});
    }
    return result;
  });
}

export async function rollbackInstallation({ home, reason = 'manual', markBad = true, fetchImpl = fetch } = {}) {
  return withCacheLock(path.join(home, 'update.lock'), async () => {
    const initial = await readInstallState(home);
    assert(initial?.managedBy === managedBy, 'Installation directory is not managed by OpenGame');
    assert(initial.previous?.appRoot, 'NO_PREVIOUS_VERSION: No previous healthy OpenGame version is available for rollback.');
    const prevMeta = await readJSON(path.join(initial.previous.appRoot, '.npm-install.json')).catch(() => null);
    assert(prevMeta, 'PREVIOUS_VERSION_MISSING: Previous version files are no longer present on disk.');
    const retirement = await retireIdleBackend(initial.dataDirectory, { fetchImpl });
    if (retirement.busy) {
      return { rolledBack: false, reason: 'backend_busy', active: retirement.active };
    }
    const { state: next, result } = await mutateInstallState(home, latest => {
      assert(latest?.managedBy === managedBy, 'Installation directory is not managed by OpenGame');
      assert(latest.previous?.appRoot, 'NO_PREVIOUS_VERSION: No previous healthy OpenGame version is available for rollback.');
      const failedVersion = latest.current.version;
      const badVersions = markBad ? [...new Set([...(latest.badVersions || []), failedVersion])] : (latest.badVersions || []);
      const restored = {
        ...latest.previous,
        activatedAt: new Date().toISOString(),
        healthy: true,
        crashCount: 0,
      };
      return {
        next: {
          ...latest,
          current: restored,
          previous: null,
          staged: null,
          badVersions,
          lastRollback: { from: failedVersion, to: restored.version, reason, at: new Date().toISOString() },
        },
        result: { rolledBack: true, from: failedVersion, to: restored.version, reason },
      };
    });
    await syncInstalledHostSkills(next, next.current.appRoot, next.current.version).catch(() => {});
    return result;
  });
}

export async function runBackgroundUpdateCheck({ home, registries, fetchImpl = fetch, installDeps, probeTimeoutMs } = {}) {
  const state = await readInstallState(home);
  if (!state || state.managedBy !== managedBy) return { status: 'not_installed' };
  if (state.autoUpdate === false) return { status: 'disabled' };
  const check = await checkNpmUpdate({
    packageName: state.packageName || 'opengame',
    channel: state.channel || (state.templateEnvironment === 'dev' ? 'test' : 'stable'),
    currentVersion: state.staged?.version || state.current.version,
    badVersions: state.badVersions || [],
    registries,
    fetchImpl,
  });
  await withCacheLock(path.join(home, 'update.lock'), () => mutateInstallState(home, latest => (
    latest ? { next: { ...latest, lastUpdateCheckAt: new Date().toISOString() } } : null
  )));
  if (!check.available) return { status: check.reason || 'up_to_date', check };
  const staged = await stageNpmUpdate({ home, target: check, fetchImpl, registries, installDeps, probeTimeoutMs });
  return { status: staged.status, check, staged };
}

async function logUpdate(home, message) {
  const file = path.join(home, 'cache', 'update.log');
  await mkdir(path.dirname(file), { recursive: true }).catch(() => {});
  await appendFile(file, `[${new Date().toISOString()}] ${message}\n`).catch(() => {});
}

function shouldCheckForUpdates(state, intervalMs) {
  if (!state || state.autoUpdate === false || process.env.OPENGAME_AUTO_UPDATE === '0') return false;
  if (!state.lastUpdateCheckAt) return true;
  const elapsed = Date.now() - Date.parse(state.lastUpdateCheckAt);
  return !Number.isFinite(elapsed) || elapsed >= intervalMs;
}

async function spawnBackgroundCheck(home) {
  const logDir = path.join(home, 'cache');
  await mkdir(logDir, { recursive: true });
  const log = await open(path.join(logDir, 'update.log'), 'a', 0o600);
  try {
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'background-check', '--home', home], {
      detached: true,
      stdio: ['ignore', log.fd, log.fd],
      env: process.env,
      windowsHide: true,
    });
    child.once('error', () => {});
    child.unref();
  } finally {
    await log.close();
  }
}

async function markCurrentHealthy(home, expectedVersion) {
  await withCacheLock(path.join(home, 'update.lock'), async () => {
    const { state: next, result: promoted } = await mutateInstallState(home, latest => {
      if (!latest || latest.current.version !== expectedVersion || latest.current.healthy) {
        return { result: false };
      }
      return {
        next: { ...latest, current: { ...latest.current, healthy: true, crashCount: 0 } },
        result: true,
      };
    });
    if (promoted && next) await pruneOldApps(home, next);
  });
}

async function recordCrashAndMaybeRollback(home, expectedVersion, maxCrashes) {
  const { result: count } = await withCacheLock(path.join(home, 'update.lock'), () => mutateInstallState(home, latest => {
    if (!latest || latest.current.version !== expectedVersion || latest.current.healthy) {
      return { result: { shouldRollback: false, crashCount: 0 } };
    }
    const nextCount = (latest.current.crashCount || 0) + 1;
    return {
      next: { ...latest, current: { ...latest.current, crashCount: nextCount } },
      result: { shouldRollback: nextCount >= maxCrashes && Boolean(latest.previous?.appRoot), crashCount: nextCount },
    };
  }));
  if (count.shouldRollback) {
    const rolled = await rollbackInstallation({ home, reason: 'crash_loop', markBad: true });
    return { rolledBack: rolled.rolledBack, crashCount: count.crashCount, rollback: rolled };
  }
  return { rolledBack: false, crashCount: count.crashCount || 0 };
}

/**
 * Supervise the installed OpenGame stdio MCP server:
 * 1. Apply any staged update when idle (<50ms on normal startup).
 * 2. Kick off a detached background npm check when lastUpdateCheckAt is stale.
 * 3. Watch unverified activations and roll back to `previous` on crash loops,
 *    transparently replaying buffered stdin when stdout has not yet emitted.
 */
export async function runManagedMcp({
  home,
  healthyAfterMs = Number(process.env.OPENGAME_HEALTHY_AFTER_MS || DEFAULT_HEALTHY_AFTER_MS),
  maxCrashes = Number(process.env.OPENGAME_MAX_CRASHES || DEFAULT_MAX_CRASHES),
  checkIntervalMs = Number(process.env.OPENGAME_UPDATE_CHECK_INTERVAL_MS || DEFAULT_CHECK_INTERVAL_MS),
} = {}) {
  let state = await readInstallState(home);
  assert(state?.managedBy === managedBy, 'OpenGame is not installed in ' + home);
  if (state.staged) {
    await applyStagedUpdate({ home }).catch(error => logUpdate(home, 'applyStagedUpdate skipped: ' + error.message));
    state = await readInstallState(home);
  }
  if (shouldCheckForUpdates(state, checkIntervalMs)) {
    void spawnBackgroundCheck(home).catch(() => {});
  }

  let signalReceived = false;
  let stdoutEmitted = false;
  let stdinEnded = false;
  const bufferedStdin = [];
  let activeChild = null;

  const onStdinData = chunk => {
    if (!stdoutEmitted) bufferedStdin.push(chunk);
    if (activeChild && !activeChild.stdin.destroyed && activeChild.stdin.writable) {
      activeChild.stdin.write(chunk);
    }
  };
  const onStdinEnd = () => {
    stdinEnded = true;
    if (activeChild && !activeChild.stdin.destroyed) activeChild.stdin.end();
  };
  const onSignal = signal => {
    signalReceived = true;
    if (activeChild && activeChild.exitCode === null) activeChild.kill(signal);
  };
  process.stdin.on('data', onStdinData);
  process.stdin.once('end', onStdinEnd);
  process.on('SIGTERM', onSignal);
  process.on('SIGINT', onSignal);

  let promotionPromise = null;
  const launchOnce = async (currentState, replayBuffer) => {
    const appRoot = currentState.current.appRoot;
    const version = currentState.current.version;
    try {
      const runtimeMod = await import(pathToFileURL(path.join(appRoot, 'scripts/npm-runtime.mjs')).href);
      await runtimeMod.configureNativeEnvironment(appRoot);
    } catch (error) {
      if (!currentState.current.healthy) {
        return { code: 1, signal: null, error };
      }
      console.error('OpenGame: native runtime configuration warning: ' + (error instanceof Error ? error.message : String(error)));
    }
    return new Promise(resolve => {
      const child = spawn(process.execPath, ['--experimental-strip-types', path.join(appRoot, 'mcp.ts')], {
        cwd: appRoot,
        env: { ...process.env, MOTION_DATA_DIR: currentState.dataDirectory },
        stdio: ['pipe', 'pipe', 'inherit'],
        windowsHide: true,
      });
      activeChild = child;
      let healthTimer;
      if (!currentState.current.healthy && healthyAfterMs >= 0) {
        healthTimer = setTimeout(() => {
          promotionPromise = markCurrentHealthy(home, version)
            .catch(error => logUpdate(home, 'markCurrentHealthy skipped: ' + (error instanceof Error ? error.message : String(error))));
        }, healthyAfterMs);
        healthTimer.unref();
      }
      child.stdout.on('data', chunk => {
        stdoutEmitted = true;
        bufferedStdin.length = 0;
        process.stdout.write(chunk);
      });
      child.stdin.on('error', () => {});
      if (replayBuffer) {
        for (const chunk of bufferedStdin) child.stdin.write(chunk);
        if (stdinEnded) child.stdin.end();
      }
      child.once('error', error => {
        if (healthTimer) clearTimeout(healthTimer);
        if (activeChild === child) activeChild = null;
        resolve({ code: 1, signal: null, error });
      });
      child.once('close', (code, signal) => {
        if (healthTimer) clearTimeout(healthTimer);
        if (activeChild === child) activeChild = null;
        resolve({ code: code ?? (signal ? 1 : 0), signal });
      });
    });
  };

  try {
    let outcome = await launchOnce(state, true);
    if (!signalReceived && !state.current.healthy && (outcome.code !== 0 || outcome.signal)) {
      const crash = await recordCrashAndMaybeRollback(home, state.current.version, maxCrashes).catch(async error => {
        await logUpdate(home, `Unverified version ${state.current.version} crash recovery skipped: ${error instanceof Error ? error.message : String(error)}`);
        return { rolledBack: false, crashCount: 0, skipped: true };
      });
      if (!crash.skipped) {
        await logUpdate(home, `Unverified version ${state.current.version} crashed (count=${crash.crashCount}, rolledBack=${crash.rolledBack})`);
      }
      if (crash.rolledBack && !stdoutEmitted) {
        console.error(`OpenGame: rolled back broken version ${state.current.version} to ${crash.rollback.to}.`);
        const restored = await readInstallState(home);
        if (restored) outcome = await launchOnce(restored, true);
      }
    }
    if (promotionPromise) await promotionPromise;
    if (stdoutEmitted && process.stdout.writableNeedDrain) {
      await new Promise(resolve => {
        const done = () => {
          process.stdout.off('drain', done);
          process.stdout.off('close', done);
          process.stdout.off('error', done);
          resolve();
        };
        process.stdout.once('drain', done);
        process.stdout.once('close', done);
        process.stdout.once('error', done);
      });
    }
    return outcome.code;
  } finally {
    process.stdin.off('data', onStdinData);
    process.stdin.off('end', onStdinEnd);
    process.stdin.pause();
    process.stdin.unref?.();
    process.off('SIGTERM', onSignal);
    process.off('SIGINT', onSignal);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const command = process.argv[2];
  const homeIdx = process.argv.indexOf('--home');
  const home = homeIdx >= 0 ? process.argv[homeIdx + 1] : undefined;
  if (command === 'background-check' && home) {
    runBackgroundUpdateCheck({ home })
      .then(result => logUpdate(home, 'background-check: ' + JSON.stringify(result)))
      .catch(error => logUpdate(home, 'background-check failed: ' + (error instanceof Error ? error.message : String(error))));
  }
}
