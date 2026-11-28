import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { collectTaskProjectRoots } from '../../gateway/super-agent-workspace.ts';
import { detectGameAssetPreview } from '../../shared/game-asset-preview.ts';
import type { LibraryAsset } from '../../shared/asset-library.ts';
import type { LocalPreviewFile } from '../../shared/platform-host.ts';
import { isSpaRoutePath } from '../../shared/spa-routes.ts';
import { isSuperAgentId, type SuperAgentChat } from '../../shared/super-agent.ts';

const isPreviewFile = (filename: string) => Boolean(detectGameAssetPreview(filename)) || /\.(?:tiff?|ico|mkv|pdf|md|txt|json|csv)$/i.test(filename);
const isBundle = /\.(?:app|bundle|framework|plugin|workflow)$/i;
const unsafeComponent = /^(?:\.{1,2}|(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?)$|[<>:"|?*\x00-\x1f]|[. ]$|\.(?:app|bundle|framework|plugin|workflow)$/i;

export function trustedPreviewPage(page: string, studio: string): boolean {
  try {
    const url = new URL(page);
    return url.origin === new URL(studio).origin && ['http:', 'https:'].includes(url.protocol)
      && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && isSpaRoutePath(url.pathname);
  } catch { return false; }
}

async function regularFile(root: string, relative: string) {
  const segments = relative.replace(/\\/g, '/').split('/');
  if (segments.some(part => !part || unsafeComponent.test(part))) throw new Error('Invalid file path');
  const filename = path.join(root, ...segments);
  if (await realpath(filename) !== filename || !(await lstat(filename)).isFile()) throw new Error('Invalid file path');
  return filename;
}

export async function openScopedPreview(dataDirectory: string, file: LocalPreviewFile, openDocument: (filename: string) => Promise<string>) {
  const data = await realpath(dataDirectory);
  let filename: string | undefined;
  if (file?.kind === 'workspace-file' && isSuperAgentId(file.conversationId) && typeof file.path === 'string') {
    const record = await regularFile(data, `super-agent/chats/${file.conversationId}.json`);
    const chat: SuperAgentChat = JSON.parse(await readFile(record, 'utf8'));
    if (chat.id !== file.conversationId || !isPreviewFile(file.path) || file.path.split(/[\\/]/).includes('..')) throw new Error('Invalid file reference');
    for (const root of collectTaskProjectRoots(data, chat)) {
      if (file.rootKey && root.key !== file.rootKey) continue;
      if (root.kind === 'custom' && (!path.isAbsolute(chat.workingDir ?? '') || /^(?:\\\\|\/\/)/.test(root.dir))) continue;
      try {
        const rootInfo = await lstat(root.dir);
        if (!rootInfo.isDirectory()) continue;
        // User-selected directories can have system path aliases such as macOS /var.
        const canonicalRoot = root.kind === 'custom' ? await realpath(root.dir) : root.dir;
        let relative = file.path.replace(/\\/g, '/').split('/').filter(part => part !== '.').join('/');
        if (path.isAbsolute(file.path)) {
          relative = path.relative(root.dir, file.path);
          if (relative.startsWith(`..${path.sep}`)) relative = path.relative(canonicalRoot, file.path);
        }
        if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) continue;
        filename = await regularFile(canonicalRoot, relative);
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
  } else if (file?.kind === 'library-asset' && isSuperAgentId(file.assetId) && isSuperAgentId(file.versionId)) {
    const record = await regularFile(data, `asset-library/records/${file.assetId}.json`);
    const asset: LibraryAsset = JSON.parse(await readFile(record, 'utf8'));
    const version = asset.versions.find(item => item.id === file.versionId);
    if (asset.id !== file.assetId || !version || /[\\/]/.test(version.filename)) throw new Error('Invalid asset version');
    filename = await regularFile(data, `asset-library/files/${asset.id}/${version.id}/${version.filename}`);
  }
  if (!filename || !isPreviewFile(filename) || filename.split(path.sep).some(part => isBundle.test(part))) throw new Error('Unsupported preview file');
  const info = await lstat(filename);
  if (!info.isFile() || (process.platform !== 'win32' && (info.mode & 0o111))) throw new Error('Unsupported preview file');
  const error = await openDocument(filename);
  if (error) throw new Error('The system application could not open this file');
}
