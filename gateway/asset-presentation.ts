import { open, stat, type FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { assetMediaUrl, type AssetReference } from '../shared/asset-library.ts';
import { detectGameAssetPreview } from '../shared/game-asset-preview.ts';
import type { SuperAgentArtifact, SuperAgentChat } from '../shared/super-agent.ts';
import { ToolInputError } from '../shared/tool-input-error.ts';
import type { WorkspaceStore } from '../workspace.ts';
import { AssetLibrary, assetHash } from './asset-library.ts';
import { openTaskWorkspaceFile, resolveBrowsableRoots, workspaceFileMetadata } from './super-agent-workspace.ts';

export type AssetPresentationSource = (AssetReference | { path: string }) & { animation?: string };

function animationError(reason: string, availableAnimations: string[] = []) {
  return Object.assign(new ToolInputError(`${reason}. Available animations: ${JSON.stringify(availableAnimations)}`, 'animation', 'invalid_enum'), { availableAnimations, applied: false });
}

async function validateAnimation(file: FileHandle, animation: string) {
  const header = Buffer.alloc(20);
  const { bytesRead } = await file.read(header, 0, header.length, 0);
  const jsonLength = header.readUInt32LE(12);
  if (bytesRead !== 20 || header.toString('ascii', 0, 4) !== 'glTF' || header.readUInt32LE(4) !== 2 ||
      header.toString('ascii', 16, 20) !== 'JSON' || header.readUInt32LE(8) !== (await file.stat()).size ||
      jsonLength > header.readUInt32LE(8) - 20 || jsonLength > 32 * 1024 * 1024) throw new Error('Invalid or oversized GLB metadata');
  const json = Buffer.alloc(jsonLength);
  let offset = 0;
  while (offset < jsonLength) {
    const read = await file.read(json, offset, jsonLength - offset, 20 + offset);
    if (!read.bytesRead) throw new Error('Truncated GLB metadata');
    offset += read.bytesRead;
  }
  const clips: { name?: string }[] = JSON.parse(json.toString('utf8')).animations ?? [];
  const names = clips.flatMap(clip => typeof clip.name === 'string' ? [clip.name] : []);
  if (!names.includes(animation)) throw animationError('Unknown animation', names);
}

export async function resolveAssetPresentation(store: WorkspaceStore, chat: SuperAgentChat, source: AssetPresentationSource): Promise<Omit<SuperAgentArtifact, 'createdAt' | 'updatedAt'>> {
  const { animation } = source;
  if ('path' in source) {
    const relative = source.path.trim().replace(/\\/g, '/');
    if (!relative || relative.startsWith('/') || /^[a-z][a-z\d+.-]*:/i.test(relative) || relative.split('/').includes('..')) throw new Error('INVALID_FILE_PATH');
    const roots = await resolveBrowsableRoots(store.directory, chat);
    const file = await openTaskWorkspaceFile(roots, '', relative);
    try {
      const metadata = /\.json$/i.test(file.path) ? await workspaceFileMetadata(file) : undefined;
      const kind = detectGameAssetPreview(file.path, metadata?.content);
      if (!kind) throw new Error('Unsupported workspace asset preview format');
      if (animation !== undefined) {
        if (kind !== 'glb') throw animationError('Animation selection requires a GLB asset');
        await validateAnimation(file.handle, animation);
      }
      const params = new URLSearchParams({ chatId: chat.id, rootKey: file.rootKey, path: file.path, raw: '1' });
      return {
        id: `file-preview:${assetHash([chat.id, file.rootKey, file.path, animation])}`,
        kind: 'workspace-file',
        title: path.basename(file.path),
        filePath: file.path,
        rootKey: file.rootKey,
        sizeBytes: file.sizeBytes,
        mimeType: file.mimeType,
        animation,
        url: `/motion-api/super-agent/file-content?${params}`,
      };
    } finally { await file.handle.close(); }
  }
  const { asset, version, filename } = await new AssetLibrary(store).resolve(source);
  if (!(await stat(filename)).isFile()) throw new Error('ASSET_VERSION_UNAVAILABLE');
  if (animation !== undefined) {
    if (asset.modality !== '3d') throw animationError('Animation selection requires a GLB asset');
    const file = await open(filename);
    try { await validateAnimation(file, animation); } finally { await file.close(); }
  }
  const url = assetMediaUrl(asset.id, version.id);
  return {
    id: animation === undefined ? `asset:${asset.id}:${version.id}` : `asset-clip:${assetHash([asset.id, version.id, animation])}`,
    kind: `asset-${asset.modality}`,
    title: asset.name,
    subtitle: version.model || asset.modality,
    assetId: asset.id,
    versionId: version.id,
    animation,
    mimeType: version.mimeType,
    url,
    downloadUrl: `${url}?download=1`,
  };
}
