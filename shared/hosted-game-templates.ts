import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { access, copyFile, link, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { lfsPointer } from './repository-template-catalog.ts';
import { readProjectZip } from './project-zip.ts';
import { boundedMediaBody, downloadVerifiedBytes, mediaDigest, mediaOrigin } from './repository-media.ts';

export const gameBundlePrefix = 'open-game/games/objects/';
export const maxGameBundleBytes = 150 * 1024 * 1024;
export const defaultLfsBatchUrl = 'https://github.com/nexu-io/opengame.git/info/lfs/objects/batch';
export type GameBundle = { sha256: string; bytes: number };
export type GameDownloadIndex = { schemaVersion: 1; games: Record<string, GameBundle> };
type GitRunner = (file: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv }) => Promise<{ stdout: string; stderr: string }>;
export type HostedGameTemplatesOptions = {
  runGit?: GitRunner;
  fetcher?: typeof fetch;
};
type TemplatePointer = { relative: string; sha256: string; bytes: number };
type TemplateRegular = { relative: string; size: number; mtimeMs: number };
type LfsBatchItem = {
  oid: string;
  size: number;
  actions?: { download?: { href: string; header?: Record<string, string> } };
  error?: { code?: number; message?: string };
};

const defaultRunGit: GitRunner = promisify(execFile);
const sourceDownloads = new Map<string, Promise<string>>();
const lfsBatchChunkSize = 100;
const lfsDownloadConcurrency = 8;

function isLoopbackHost(hostname: string) {
  return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]' || hostname === '::1';
}

function normalizeHttpLfsEndpoint(raw: string): string | null {
  let parsed: URL;
  try { parsed = new URL(raw); } catch { return null; }
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLoopbackHost(parsed.hostname))) return null;
  parsed.username = '';
  parsed.password = '';
  parsed.search = '';
  parsed.hash = '';
  const clean = parsed.href.replace(/\/+$/, '');
  return clean.endsWith('/objects/batch') ? clean : `${clean}/objects/batch`;
}

export function lfsBatchUrlFromRemote(remote: string): string | null {
  const trimmed = remote.trim();
  if (!trimmed) return null;
  const scpMatch = /^[^@\s:/]+@([^:\s/]+):(.+)$/.exec(trimmed);
  if (scpMatch) {
    const [, host, repoPath] = scpMatch;
    const cleanPath = repoPath.replace(/^\/+|\/+$/g, '');
    if (!cleanPath) return null;
    const gitPath = cleanPath.endsWith('.git') ? cleanPath : `${cleanPath}.git`;
    return `https://${host}/${gitPath}/info/lfs/objects/batch`;
  }
  let parsed: URL;
  try { parsed = new URL(trimmed); } catch { return null; }
  if (parsed.protocol === 'ssh:') {
    const cleanPath = parsed.pathname.replace(/^\/+|\/+$/g, '');
    if (!parsed.hostname || !cleanPath) return null;
    const gitPath = cleanPath.endsWith('.git') ? cleanPath : `${cleanPath}.git`;
    return `https://${parsed.hostname}/${gitPath}/info/lfs/objects/batch`;
  }
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLoopbackHost(parsed.hostname))) return null;
  parsed.username = '';
  parsed.password = '';
  parsed.search = '';
  parsed.hash = '';
  const cleanPath = parsed.pathname.replace(/\/+$/, '');
  if (!cleanPath) return null;
  parsed.pathname = cleanPath.endsWith('.git') ? `${cleanPath}/info/lfs/objects/batch` : `${cleanPath}.git/info/lfs/objects/batch`;
  return parsed.href;
}

async function scanTemplateTree(root: string, prefix = '', pointers: TemplatePointer[] = [], regulars: TemplateRegular[] = []) {
  const directory = prefix ? path.join(root, prefix) : root;
  const entries = (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const file = path.join(root, relative);
    if (entry.isDirectory()) {
      await scanTemplateTree(root, relative, pointers, regulars);
    } else if (entry.isFile()) {
      const info = await lstat(file);
      const pointer = info.size >= 125 && info.size <= 1024 ? lfsPointer(await readFile(file)) : null;
      if (pointer) pointers.push({ relative, sha256: pointer.sha256, bytes: pointer.bytes });
      else regulars.push({ relative, size: info.size, mtimeMs: Math.trunc(info.mtimeMs) });
    }
  }
  return { pointers, regulars };
}

async function hasTemplatePointer(directory: string): Promise<boolean> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const file = path.join(directory, entry.name);
    if (entry.isDirectory() && await hasTemplatePointer(file)) return true;
    if (entry.isFile()) {
      const { size } = await lstat(file);
      if (size >= 125 && size <= 1024 && lfsPointer(await readFile(file))) return true;
    }
  }
  return false;
}

function sourceTreeDigest(id: string, pointers: TemplatePointer[], regulars: TemplateRegular[]) {
  const hash = createHash('sha256').update(id).update('\0');
  for (const pointer of pointers) hash.update('p\0').update(pointer.relative).update('\0').update(pointer.sha256).update('\0').update(String(pointer.bytes)).update('\n');
  for (const regular of regulars) hash.update('r\0').update(regular.relative).update('\0').update(String(regular.size)).update('\0').update(String(regular.mtimeMs)).update('\n');
  return hash.digest('hex');
}

async function resolveLfsBatchUrl(root: string, runGit: GitRunner): Promise<string | null> {
  const hasGitDir = await access(path.join(root, '.git')).then(() => true, () => false);
  if (!hasGitDir) return defaultLfsBatchUrl;
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
  try {
    const { stdout } = await runGit('git', ['config', '--get', 'lfs.url'], { cwd: root, env });
    const configured = stdout.trim();
    if (configured) return normalizeHttpLfsEndpoint(configured);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return defaultLfsBatchUrl;
  }
  try {
    const { stdout } = await runGit('git', ['remote', 'get-url', 'origin'], { cwd: root, env });
    return lfsBatchUrlFromRemote(stdout);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return defaultLfsBatchUrl;
    return null;
  }
}

async function isCachedLfsObject(file: string, expectedBytes: number): Promise<boolean> {
  const info = await lstat(file).catch(error => { if (error.code !== 'ENOENT') throw error; return undefined; });
  return Boolean(info?.isFile() && info.size === expectedBytes);
}

async function linkOrCopy(source: string, destination: string) {
  try {
    await link(source, destination);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? '';
    if (!['EXDEV', 'EPERM', 'ENOSYS', 'EMLINK', 'EACCES'].includes(code)) throw error;
    await copyFile(source, destination);
  }
}

async function downloadLfsObject(
  object: { oid: string; size: number },
  href: string,
  headers: Record<string, string> | undefined,
  allowLoopbackHttp: boolean,
  fetcher: typeof fetch,
): Promise<Buffer> {
  const parsed = new URL(href);
  assert(
    parsed.protocol === 'https:' || (allowLoopbackHttp && parsed.protocol === 'http:' && isLoopbackHost(parsed.hostname)),
    `Rejected insecure Git LFS download URL: ${parsed.protocol}//${parsed.host}`,
  );
  const requestHeaders: Record<string, string> = {};
  if (headers) {
    for (const [key, value] of Object.entries(headers)) {
      if (typeof value === 'string') requestHeaders[key] = value;
    }
  }
  return downloadVerifiedBytes(href, {
    bytes: object.size,
    sha256: object.oid,
    headers: Object.keys(requestHeaders).length ? requestHeaders : undefined,
    fetcher,
    redirect: 'follow',
    credentials: 'omit',
  });
}

async function fetchMissingLfsObjects(
  batchUrl: string,
  objectsDir: string,
  pointers: TemplatePointer[],
  fetcher: typeof fetch,
) {
  await mkdir(objectsDir, { recursive: true });
  const unique = new Map<string, number>();
  for (const pointer of pointers) {
    assert(/^[a-f0-9]{64}$/.test(pointer.sha256), 'Invalid Git LFS object hash');
    assert(Number.isSafeInteger(pointer.bytes) && pointer.bytes > 0 && pointer.bytes <= maxGameBundleBytes, 'Invalid Git LFS object length');
    const existing = unique.get(pointer.sha256);
    if (existing !== undefined) assert.equal(existing, pointer.bytes, 'Conflicting Git LFS object size');
    else unique.set(pointer.sha256, pointer.bytes);
  }
  const missing: { oid: string; size: number }[] = [];
  for (const [oid, size] of unique) {
    if (!await isCachedLfsObject(path.join(objectsDir, oid), size)) missing.push({ oid, size });
  }
  if (!missing.length) return;

  const batchOrigin = new URL(batchUrl);
  const allowLoopbackHttp = batchOrigin.protocol === 'http:' && isLoopbackHost(batchOrigin.hostname);
  const downloads: { oid: string; size: number; href: string; header?: Record<string, string> }[] = [];

  for (let offset = 0; offset < missing.length; offset += lfsBatchChunkSize) {
    const chunk = missing.slice(offset, offset + lfsBatchChunkSize);
    const response = await fetcher(batchUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.git-lfs+json',
        'Content-Type': 'application/vnd.git-lfs+json',
      },
      body: JSON.stringify({ operation: 'download', transfers: ['basic'], objects: chunk }),
      redirect: 'follow',
      credentials: 'omit',
      signal: AbortSignal.timeout(30_000),
    });
    assert.equal(response.status, 200, `Git LFS batch request returned HTTP ${response.status}`);
    const payload = await response.json() as { objects?: LfsBatchItem[] };
    assert(Array.isArray(payload?.objects), 'Invalid Git LFS batch response');
    const byOid = new Map(payload.objects.map(item => [item.oid, item]));
    for (const wanted of chunk) {
      const item = byOid.get(wanted.oid);
      assert(item, `Git LFS batch response omitted ${wanted.oid}`);
      if (item.error) throw new Error(`Git LFS object ${wanted.oid} error ${item.error.code ?? ''}: ${item.error.message ?? 'unavailable'}`);
      const download = item.actions?.download;
      assert(download?.href, `Git LFS batch response missing download URL for ${wanted.oid}`);
      downloads.push({ oid: wanted.oid, size: wanted.size, href: download.href, header: download.header });
    }
  }

  let cursor = 0;
  const workerCount = Math.min(lfsDownloadConcurrency, downloads.length);
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= downloads.length) return;
      const item = downloads[index];
      const target = path.join(objectsDir, item.oid);
      if (await isCachedLfsObject(target, item.size)) continue;
      const bytes = await downloadLfsObject(item, item.href, item.header, allowLoopbackHttp, fetcher);
      const temp = path.join(objectsDir, `.tmp-${item.oid}-${process.pid}-${randomBytes(4).toString('hex')}`);
      await writeFile(temp, bytes, { flag: 'wx' });
      try {
        await rename(temp, target);
      } catch (error) {
        if (!['EEXIST', 'EPERM', 'ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code ?? '') || !await isCachedLfsObject(target, item.size)) {
          throw error;
        }
      } finally {
        await rm(temp, { force: true }).catch(() => undefined);
      }
    }
  }));
}

async function materializeLfsSourceCache(
  id: string,
  installed: string,
  cache: string,
  dest: string,
  pointers: TemplatePointer[],
  regulars: TemplateRegular[],
  batchUrl: string,
  fetcher: typeof fetch,
) {
  await mkdir(cache, { recursive: true });
  assert((await lstat(cache)).isDirectory(), 'Invalid game template cache');
  const existing = await lstat(dest).catch(error => { if (error.code !== 'ENOENT') throw error; });
  if (existing) { assert(existing.isDirectory(), 'Invalid cached game template'); return dest; }

  const objectsDir = path.join(cache, 'lfs-objects');
  await fetchMissingLfsObjects(batchUrl, objectsDir, pointers, fetcher);

  const sourceCacheRoot = path.dirname(dest);
  await mkdir(sourceCacheRoot, { recursive: true });
  const temp = await mkdtemp(path.join(sourceCacheRoot, `.download-${id}-`));
  try {
    for (const regular of regulars) {
      const target = path.join(temp, regular.relative);
      await mkdir(path.dirname(target), { recursive: true });
      await copyFile(path.join(installed, regular.relative), target);
    }
    for (const pointer of pointers) {
      const target = path.join(temp, pointer.relative);
      await mkdir(path.dirname(target), { recursive: true });
      await linkOrCopy(path.join(objectsDir, pointer.sha256), target);
    }
    try {
      await rename(temp, dest);
    } catch (error) {
      if (!['ENOTEMPTY', 'EEXIST', 'EPERM'].includes((error as NodeJS.ErrnoException).code ?? '') || !(await lstat(dest)).isDirectory()) throw error;
    }
    return dest;
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

async function hydrateSourceTemplate(
  id: string,
  directory: string,
  cache: string,
  runGit: GitRunner,
  fetcher: typeof fetch,
): Promise<string> {
  const { pointers, regulars } = await scanTemplateTree(directory);
  if (!pointers.length) return directory;
  assert(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,100}$/.test(id) && path.basename(directory) === id, 'Invalid game template ID');

  const digest = sourceTreeDigest(id, pointers, regulars);
  const cachedDir = path.join(cache, 'lfs-source', `${id}-${digest.slice(0, 16)}`);
  const existingCache = await lstat(cachedDir).catch(error => { if (error.code !== 'ENOENT') throw error; return undefined; });
  if (existingCache?.isDirectory()) return cachedDir;

  const include = `--include=templates/games/${id}/**`;
  const root = path.resolve(directory, '../../..');
  let gitLfsError: unknown;
  const hasGitDir = await access(path.join(root, '.git')).then(() => true, () => false);
  if (hasGitDir) {
    try {
      await runGit('git', ['lfs', 'pull', include, '--exclude='], { cwd: root, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
      assert(!await hasTemplatePointer(directory), 'Git LFS left unresolved files');
      return directory;
    } catch (error) {
      gitLfsError = error;
    }
  }

  const batchUrl = await resolveLfsBatchUrl(root, runGit);
  if (batchUrl) {
    try {
      return await materializeLfsSourceCache(id, directory, cache, cachedDir, pointers, regulars, batchUrl, fetcher);
    } catch (httpError) {
      throw new Error(
        `Could not fetch ${id} via Git LFS or HTTPS fallback. Check network access, install Git LFS, or run git lfs pull "${include}" --exclude="" in the OpenGame checkout.`,
        { cause: httpError },
      );
    }
  }

  throw new Error(`Could not fetch ${id}. Install Git LFS and retry, or run git lfs pull "${include}" --exclude="" in the OpenGame checkout.`, { cause: gitLfsError });
}
export function gameBundleUrl(hash: string) {
  assert(/^[a-f0-9]{64}$/.test(hash), 'Invalid game bundle hash');
  return `${mediaOrigin}/${gameBundlePrefix}${hash}.zip`;
}

/** Hosted games pinned in game-downloads.json download immutable verified bundles on demand; local source games use the checkout directly. */
export class HostedGameTemplates {
  private index?: Promise<GameDownloadIndex>;
  private pending = new Map<string, Promise<string>>();
  private sourceResolved = new Map<string, string>();
  private readonly indexPath: string;
  private readonly cache: string;
  private readonly runGit: GitRunner;
  private readonly fetcher?: typeof fetch;
  private sourceCheckout?: Promise<boolean>;
  constructor(indexPath: string, cache: string, options?: HostedGameTemplatesOptions) {
    this.indexPath = indexPath;
    this.cache = cache;
    this.runGit = options?.runGit ?? defaultRunGit;
    this.fetcher = options?.fetcher;
  }

  cachedDirectory(installed: string): string | undefined {
    return this.sourceResolved.get(installed);
  }

  invalidateCachedDirectory(installed: string): void {
    this.sourceResolved.delete(installed);
  }

  private async loadIndex(): Promise<GameDownloadIndex> {
    let text: string;
    try { text = await readFile(this.indexPath, 'utf8'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { schemaVersion: 1, games: {} }; throw error; }
    const index = JSON.parse(text) as GameDownloadIndex;
    assert(index.schemaVersion === 1 && index.games && typeof index.games === 'object' && !Array.isArray(index.games), 'Invalid game template index');
    return index;
  }

  async directory(id: string, installed: string) {
    const { games } = await (this.index ??= this.loadIndex().catch(error => {
      // A transient read or incomplete update must not poison every later retry.
      this.index = undefined;
      throw error;
    }));
    if (!Object.hasOwn(games, id)) {
      this.sourceCheckout ??= access(path.join(path.dirname(installed), '.gitattributes')).then(() => true, error => {
        if (error.code === 'ENOENT') return false;
        throw error;
      });
      if (await this.sourceCheckout) {
        const key = `${this.cache}\0${installed}`;
        let ready = sourceDownloads.get(key);
        if (!ready) {
          ready = hydrateSourceTemplate(id, installed, this.cache, this.runGit, this.fetcher ?? globalThis.fetch).finally(() => sourceDownloads.delete(key));
          sourceDownloads.set(key, ready);
        }
        const resolved = await ready;
        if (resolved !== installed) this.sourceResolved.set(installed, resolved);
        else this.sourceResolved.delete(installed);
        return resolved;
      }
      return installed;
    }
    const bundle = games[id];
    const url = gameBundleUrl(bundle.sha256);
    assert(Number.isSafeInteger(bundle.bytes) && bundle.bytes > 0 && bundle.bytes <= maxGameBundleBytes, 'Invalid game bundle length');
    let ready = this.pending.get(bundle.sha256);
    if (!ready) {
      ready = this.materialize(id, bundle, url).finally(() => this.pending.delete(bundle.sha256));
      this.pending.set(bundle.sha256, ready);
    }
    const resolved = await ready;
    this.sourceResolved.set(installed, resolved);
    return resolved;
  }

  private async materialize(id: string, bundle: GameBundle, url: string) {
    await mkdir(this.cache, { recursive: true });
    assert((await lstat(this.cache)).isDirectory(), 'Invalid game template cache');
    const dest = path.join(this.cache, bundle.sha256);
    const existing = await lstat(dest).catch(error => { if (error.code !== 'ENOENT') throw error; });
    if (existing) { assert(existing.isDirectory(), 'Invalid cached game template'); return dest; }
    const temp = await mkdtemp(path.join(this.cache, '.download-'));
    try {
      const response = await (this.fetcher ?? globalThis.fetch)(url, { redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(120_000) });
      const bytes = await boundedMediaBody(response, bundle.bytes);
      assert(bytes.length === bundle.bytes && mediaDigest(bytes) === bundle.sha256, 'Downloaded game template failed integrity verification');
      const files = readProjectZip(bytes);
      assert(JSON.parse(files.get('game.json')?.toString() ?? 'null')?.id === id && files.has('index.html'), 'Invalid game template contents');
      for (const [name, data] of files) {
        const target = path.join(temp, name);
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, data, { flag: 'wx' });
      }
      try { await rename(temp, dest); } catch (error) {
        if (!['ENOTEMPTY', 'EEXIST', 'EPERM'].includes((error as NodeJS.ErrnoException).code ?? '') || !(await lstat(dest)).isDirectory()) throw error;
      }
      return dest;
    } catch (error) {
      throw new Error(`Could not download game template ${id}. Check the connection and retry.`, { cause: error });
    } finally { await rm(temp, { recursive: true, force: true }); }
  }
}
