import { createHash } from 'node:crypto';
import { lstat, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { WebPublishTargetKind } from '../shared/web-publish.ts';
import { WorkspaceStore } from '../workspace.ts';
import { AssetLibrary } from './asset-library.ts';
import { optimizeGlbTexturesForPublish, transcodeRasterToWebp } from './glb-optimize.ts';

export const MAX_PUBLISH_FILES = 500;
export const MAX_PUBLISH_BYTES = 50 * 1024 * 1024;
const MAX_RAW_COLLECT_BYTES = 200 * 1024 * 1024;
const WEBP_COMPRESS_MIN_BYTES = 256 * 1024;

async function maybeCompressRasterForPublish(
  originalBytes: Buffer,
  ext: string,
  mimeType?: string,
): Promise<{ data: Buffer; ext: string; optimized: boolean }> {
  const isPng = ext === '.png' || mimeType === 'image/png';
  const isJpeg = ext === '.jpg' || ext === '.jpeg' || mimeType === 'image/jpeg';
  if (originalBytes.length < WEBP_COMPRESS_MIN_BYTES || (!isPng && !isJpeg)) {
    return { data: originalBytes, ext, optimized: false };
  }
  const compressed = await transcodeRasterToWebp(originalBytes, originalBytes, isPng ? 'image/png' : 'image/jpeg', {
    losslessPng: isPng,
    quality: 82,
  });
  if (compressed) return { data: compressed, ext: '.webp', optimized: true };
  return { data: originalBytes, ext, optimized: false };
}

const EXCLUDED_NAMES = new Set([
  'node_modules',
  '.git',
  '.file-versions',
  '.live-artifacts',
  '.npmrc',
  '.yarnrc',
  '.yarnrc.yml',
  '.aws',
  '.ssh',
  '.azure',
  '.docker',
  '.gnupg',
  '.kube',
  '.pulumi',
  '.terraform',
  '.git-credentials',
  '.netrc',
  '.pypirc',
]);

const REWRITABLE_TEXT_FILE = /\.(?:html?|css|m?js|cjs|json|svg|webmanifest)$/i;
const DOCUMENT_RELATIVE_URL_FILE = /\.(?:m?js|cjs|json)$/i;
const JS_MODULE_FILE = /\.(?:m?js|cjs)$/i;
const ASSET_MEDIA_REF = /(?:https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?)?\/(?:motion-api|api)\/assets\/([A-Za-z0-9_-]+)\/versions\/([A-Za-z0-9_-]+)\/(?:file|media)(?:\?[^"'`\s)\\]*)?/g;
const GAME_PLAY_REF = /(?:https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?)?\/(?:motion-api|api)\/games\/([^/]+)\/play\/([^"'`\s)\\?#]+(?:\?[^"'`\s)\\#]*)?(?:#[^"'`\s)\\]*)?)/g;
const DESIGN_RAW_REF = /(?:https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?)?\/(?:motion-api|api)\/design\/raw\/([^/]+)\/([^"'`\s)\\?#]+(?:\?[^"'`\s)\\#]*)?(?:#[^"'`\s)\\]*)?)/g;

const MIME_EXTENSIONS: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/svg+xml': '.svg',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'audio/mpeg': '.mp3',
  'audio/mp3': '.mp3',
  'audio/wav': '.wav',
  'audio/ogg': '.ogg',
  'audio/mp4': '.m4a',
  'model/gltf-binary': '.glb',
};

export interface StagedPublishFile {
  file: string;
  data: Buffer;
}

export interface PublishSizeBreakdown {
  originalBytes: number;
  totalBytes: number;
  savedBytes: number;
  optimizedGlbCount: number;
  optimizedRasterCount: number;
  topFiles: Array<{ file: string; bytes: number }>;
  advisories: string[];
}

export interface PublishBundle {
  kind: WebPublishTargetKind;
  targetId: string;
  entryPath: string;
  files: StagedPublishFile[];
  fileCount: number;
  totalBytes: number;
  bundledAssetCount: number;
  contentFingerprint: string;
  sizeBreakdown: PublishSizeBreakdown;
}

function relativePosixPath(fromFilePath: string, targetFilePath: string): string {
  const dir = path.posix.dirname(fromFilePath);
  const rel = path.posix.relative(dir === '.' ? '' : dir, targetFilePath);
  return rel.startsWith('.') ? rel : `./${rel}`;
}

async function collectSourceFiles(
  sourcePath: string,
  entryPath: string,
  kind: WebPublishTargetKind,
): Promise<Array<{ path: string; data: Buffer }>> {
  const resolvedRoot = path.resolve(sourcePath);
  const rootInfo = await lstat(resolvedRoot).catch(() => null);
  if (!rootInfo) {
    throw new Error(`NOT_FOUND: Publish source "${sourcePath}" does not exist`);
  }
  if (rootInfo.isSymbolicLink()) {
    throw new Error(`INVALID_ARGUMENT: Symlinks cannot be published (${sourcePath})`);
  }

  if (rootInfo.isFile()) {
    if (!/\.html?$/i.test(resolvedRoot)) {
      throw new Error('INVALID_ARGUMENT: Single-file web publishing requires an .html or .htm file');
    }
    if (rootInfo.size > MAX_PUBLISH_BYTES) {
      throw new Error(`INVALID_ARGUMENT: Publication exceeds ${MAX_PUBLISH_BYTES / (1024 * 1024)} MiB limit`);
    }
    return [{ path: entryPath, data: await readFile(resolvedRoot) }];
  }

  if (!rootInfo.isDirectory()) {
    throw new Error(`INVALID_ARGUMENT: Publish source must be a directory or HTML file (${sourcePath})`);
  }

  const results: Array<{ path: string; data: Buffer }> = [];
  let totalBytes = 0;

  async function walk(relDir: string): Promise<void> {
    const absDir = relDir ? path.join(resolvedRoot, relDir) : resolvedRoot;
    const entries = (await readdir(absDir, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    for (const entry of entries) {
      if (EXCLUDED_NAMES.has(entry.name) || entry.name.startsWith('.env') || entry.name.startsWith('.')) {
        continue;
      }
      const relPosix = relDir ? `${relDir}/${entry.name}` : entry.name;
      if (kind === 'game' && /^(?:game\.json$|(?:trailer|design|publish|assets\/playtests|assets-raw)(?:\/|$))/i.test(relPosix)) {
        continue;
      }
      const absPath = path.join(resolvedRoot, relPosix);
      const info = await lstat(absPath);
      if (info.isSymbolicLink()) {
        throw new Error(`INVALID_ARGUMENT: Symlinks cannot be published (${relPosix})`);
      }
      if (info.isDirectory()) {
        await walk(relPosix);
        continue;
      }
      if (!info.isFile()) continue;

      if (results.length >= MAX_PUBLISH_FILES) {
        throw new Error(`INVALID_ARGUMENT: Publication exceeds ${MAX_PUBLISH_FILES} files limit`);
      }
      totalBytes += info.size;
      const collectLimit = /\.glb$/i.test(relPosix) ? MAX_RAW_COLLECT_BYTES : MAX_PUBLISH_BYTES;
      if (totalBytes > Math.max(collectLimit, results.some(f => /\.glb$/i.test(f.path)) ? MAX_RAW_COLLECT_BYTES : MAX_PUBLISH_BYTES)) {
        throw new Error(`INVALID_ARGUMENT: Publication exceeds ${MAX_PUBLISH_BYTES / (1024 * 1024)} MiB limit`);
      }
      results.push({ path: relPosix, data: await readFile(absPath) });
    }
  }

  await walk('');
  if (!results.some(item => item.path === entryPath)) {
    throw new Error(`NOT_FOUND: Entry HTML file "${entryPath}" does not exist in source`);
  }
  results.sort((a, b) => a.path.localeCompare(b.path));
  return results;
}

/**
 * Builds an in-memory self-contained bundle for web publishing:
 * - Rewrites `/motion-api/assets/<id>/versions/<vid>/media` URLs into `_shared-assets/...`
 *   using bytes from Workspace `AssetLibrary` without mutating source files on disk.
 * - Rewrites same-project `/motion-api/games/<id>/play/...` and `/motion-api/design/raw/<id>/...`
 *   URLs into relative POSIX paths.
 * - Computes a deterministic SHA-256 content fingerprint over the final bundle tree.
 */
export async function buildPublishBundle(input: {
  dataDirectory: string;
  kind: WebPublishTargetKind;
  targetId: string;
  sourcePath: string;
  entryPath: string;
  virtualEntryHtml?: string;
  maxBytes?: number;
}): Promise<PublishBundle> {
  const rawFiles = input.virtualEntryHtml !== undefined
    ? [{ path: input.entryPath, data: Buffer.from(input.virtualEntryHtml, 'utf8') }]
    : await collectSourceFiles(input.sourcePath, input.entryPath, input.kind);

  let assetLibrary: AssetLibrary | null = null;
  const getAssetLibrary = () => {
    if (!assetLibrary) {
      assetLibrary = new AssetLibrary(new WorkspaceStore(input.dataDirectory));
    }
    return assetLibrary;
  };

  const bundledAssets = new Map<string, StagedPublishFile>();
  const knownPaths = new Set(rawFiles.map(f => f.path));
  let originalBytes = rawFiles.reduce((sum, f) => sum + f.data.length, 0);
  let totalBytes = 0;
  let optimizedGlbCount = 0;
  let optimizedRasterCount = 0;
  const maxBytes = input.maxBytes ?? MAX_PUBLISH_BYTES;

  const resolveBundledAssetPath = async (assetId: string, versionId: string): Promise<string> => {
    const key = `${assetId}/${versionId}`;
    const existing = bundledAssets.get(key);
    if (existing) return existing.file;

    let resolved;
    let rawBytes: Buffer;
    try {
      // Existing references remain readable after Trash, like the local media
      // route. Publishing does not create a new reference or restore the asset.
      resolved = await getAssetLibrary().resolve({ assetId, versionId }, true);
      rawBytes = await readFile(resolved.filename);
    } catch (cause) {
      throw new Error(`ASSET_VERSION_UNAVAILABLE: Cannot bundle pinned asset ${key}`, { cause });
    }
    if (rawBytes.length !== resolved.version.bytes || createHash('sha256').update(rawBytes).digest('hex') !== resolved.version.sha256) {
      throw new Error(`ASSET_CONTENT_CHANGED: Bytes no longer match pinned asset ${key}`);
    }
    originalBytes += rawBytes.length;

    const rawExt = path.extname(resolved.version.filename || '') || MIME_EXTENSIONS[resolved.version.mimeType || ''] || '';
    const safeRawExt = /^\.[A-Za-z0-9]{1,10}$/.test(rawExt) ? rawExt.toLowerCase() : '';
    let bytes: Buffer;
    let safeExt: string;
    if (safeRawExt === '.glb' || resolved.version.mimeType === 'model/gltf-binary') {
      const optimized = await optimizeGlbTexturesForPublish(rawBytes);
      bytes = optimized.data;
      safeExt = '.glb';
      if (optimized.optimized) optimizedGlbCount++;
    } else {
      const optimized = await maybeCompressRasterForPublish(
        rawBytes,
        safeRawExt,
        resolved.version.mimeType,
      );
      bytes = optimized.data;
      safeExt = optimized.ext;
      if (optimized.optimized) optimizedRasterCount++;
    }

    totalBytes += bytes.length;
    if (rawFiles.length + bundledAssets.size >= MAX_PUBLISH_FILES || totalBytes > maxBytes) {
      throw new Error(`INVALID_ARGUMENT: Bundled publication exceeds ${maxBytes / (1024 * 1024)} MiB limit`);
    }

    let targetPath = `_shared-assets/${assetId}-${versionId}${safeExt}`;
    let collisionIndex = 1;
    while (knownPaths.has(targetPath)) {
      targetPath = `_shared-assets/${assetId}-${versionId}-${collisionIndex++}${safeExt}`;
    }
    knownPaths.add(targetPath);
    bundledAssets.set(key, { file: targetPath, data: bytes });
    return targetPath;
  };

  const stagedFiles: StagedPublishFile[] = [];
  for (const file of rawFiles) {
    if (!REWRITABLE_TEXT_FILE.test(file.path)) {
      let data = file.data;
      if (/\.glb$/i.test(file.path)) {
        const optimized = await optimizeGlbTexturesForPublish(file.data);
        data = optimized.data;
        if (optimized.optimized) optimizedGlbCount++;
      }
      totalBytes += data.length;
      if (totalBytes > maxBytes) {
        throw new Error(`INVALID_ARGUMENT: Publication exceeds ${maxBytes / (1024 * 1024)} MiB limit`);
      }
      stagedFiles.push({ file: file.path, data });
      continue;
    }
    let text = file.data.toString('utf8');
    // Runtime URL strings in JS/JSON (fetch, GLTFLoader, TextureLoader, Audio, img.src)
    // resolve against document.baseURI (entryPath), whereas HTML/CSS/SVG/webmanifest resolve against file.path.
    const runtimeBasePath = DOCUMENT_RELATIVE_URL_FILE.test(file.path) ? input.entryPath : file.path;

    const assetMatches = [...text.matchAll(ASSET_MEDIA_REF)];
    if (assetMatches.length > 0) {
      const replacements = new Map<string, string>();
      for (const match of assetMatches) {
        const full = match[0];
        if (replacements.has(full)) continue;
        const bundledPath = await resolveBundledAssetPath(match[1], match[2]);
        replacements.set(full, relativePosixPath(runtimeBasePath, bundledPath));
      }
      if (replacements.size > 0) {
        text = text.replace(ASSET_MEDIA_REF, matched => replacements.get(matched) ?? matched);
      }
    }

    if (input.kind === 'game') {
      text = text.replace(GAME_PLAY_REF, (matched, rawGameId: string, relSuffix: string) => {
        try {
          if (decodeURIComponent(rawGameId) !== input.targetId) return matched;
        } catch {
          return matched;
        }
        const cleanTarget = relSuffix.replace(/[?#].*$/, '');
        const suffix = relSuffix.slice(cleanTarget.length);
        const basePath = JS_MODULE_FILE.test(file.path) && JS_MODULE_FILE.test(cleanTarget)
          ? file.path
          : runtimeBasePath;
        return `${relativePosixPath(basePath, cleanTarget)}${suffix}`;
      });
    } else if (input.kind === 'design') {
      text = text.replace(DESIGN_RAW_REF, (matched, rawDesignId: string, relSuffix: string) => {
        try {
          if (decodeURIComponent(rawDesignId) !== input.targetId) return matched;
        } catch {
          return matched;
        }
        const cleanTarget = relSuffix.replace(/[?#].*$/, '');
        const suffix = relSuffix.slice(cleanTarget.length);
        const basePath = JS_MODULE_FILE.test(file.path) && JS_MODULE_FILE.test(cleanTarget)
          ? file.path
          : runtimeBasePath;
        return `${relativePosixPath(basePath, cleanTarget)}${suffix}`;
      });
    }

    const nextBuf = Buffer.from(text, 'utf8');
    totalBytes += nextBuf.length;
    if (totalBytes > maxBytes) {
      throw new Error(`INVALID_ARGUMENT: Publication exceeds ${maxBytes / (1024 * 1024)} MiB limit`);
    }
    stagedFiles.push({ file: file.path, data: nextBuf });
  }

  for (const bundled of bundledAssets.values()) {
    stagedFiles.push(bundled);
  }
  stagedFiles.sort((a, b) => a.file.localeCompare(b.file));

  const hash = createHash('sha256');
  for (const file of stagedFiles) {
    const digest = createHash('sha256').update(file.data).digest('hex');
    hash.update(`${file.file}:${digest}\n`);
  }

  const topFiles = [...stagedFiles]
    .sort((a, b) => b.data.length - a.data.length)
    .slice(0, 5)
    .map(item => ({ file: item.file, bytes: item.data.length }));
  const advisories: string[] = [];
  if (totalBytes > 15 * 1024 * 1024) {
    advisories.push(`Bundle is ${(totalBytes / (1024 * 1024)).toFixed(2)} MiB; consider downscaling oversized textures or lazy-loading secondary assets for faster cold starts.`);
  }
  const savedBytes = Math.max(0, originalBytes - totalBytes);

  return {
    kind: input.kind,
    targetId: input.targetId,
    entryPath: input.entryPath,
    files: stagedFiles,
    fileCount: stagedFiles.length,
    totalBytes,
    bundledAssetCount: bundledAssets.size,
    contentFingerprint: hash.digest('hex'),
    sizeBreakdown: {
      originalBytes,
      totalBytes,
      savedBytes,
      optimizedGlbCount,
      optimizedRasterCount,
      topFiles,
      advisories,
    },
  };
}

/**
 * Stages files into a fresh temporary directory using exclusive (`wx`) writes
 * and verifies filesystem inode identity to reject path escapes or symlink aliasing.
 */
export async function stagePublishFiles(directory: string, files: readonly StagedPublishFile[]): Promise<void> {
  const directories = new Map<string, string>();
  const checkedPaths = new Set<string>();
  for (const file of files) {
    const target = path.resolve(directory, file.file);
    const relative = path.relative(directory, target);
    if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error('INVALID_ARGUMENT: Staged publish file escapes temporary directory');
    }
    const parts = relative.split(path.sep);
    let parent = directory;
    for (const part of parts.slice(0, -1)) {
      parent = path.join(parent, part);
      if (checkedPaths.has(parent)) continue;
      await mkdir(parent, { recursive: true });
      const identity = await stat(parent);
      const key = `${identity.dev}:${identity.ino}`;
      const previous = directories.get(key);
      if (previous !== undefined && previous !== parent) {
        throw new Error('DEPLOY_FAILED: Filesystem could not preserve distinct publish paths');
      }
      directories.set(key, parent);
      checkedPaths.add(parent);
    }
    await writeFile(target, file.data, { flag: 'wx' });
  }
}
