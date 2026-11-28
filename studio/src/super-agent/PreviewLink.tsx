import { createContext, useContext, type MouseEvent, type ReactNode } from 'react';
import { Button } from 'open-design-ui/button';
import { assetMediaUrl } from '../../../shared/asset-library';
import { SUPER_AGENT_API, type SuperAgentArtifact } from '../../../shared/super-agent';
import type { LocalPreviewFile } from '../../../shared/platform-host';
import { getDesktopBridge } from '../utils/platformHost';
import { useI18n } from '../i18n/I18n';

export const PreviewLinkContext = createContext<{
  chatId?: string | null;
  workingDir?: string;
  rootKey?: string;
  resolvePath?: (path: string) => string;
  onNotify?: (message: string, tone: 'error') => void;
}>({});

type Target = { href: string; file?: LocalPreviewFile };

function linkedFile(href: string, chatId?: string | null): LocalPreviewFile | undefined {
  if (typeof window === 'undefined') return;
  const url = new URL(href, window.location.origin);
  if (url.origin !== window.location.origin) return;
  const asset = /^\/(?:motion-api|api)\/assets\/([\w-]+)\/versions\/([\w-]+)\/file$/.exec(url.pathname);
  if (asset) return { kind: 'library-asset', assetId: asset[1], versionId: asset[2] };
  if (!chatId || !/^\/(?:motion-api|api)\/super-agent\/file-content$/.test(url.pathname)
    || url.searchParams.get('chatId') !== chatId || url.searchParams.get('raw') !== '1') return;
  const path = url.searchParams.get('path');
  if (path) return { kind: 'workspace-file', conversationId: chatId, path, rootKey: url.searchParams.get('rootKey') ?? undefined };
}

export function PreviewLink({ children, href, filePath, artifact, onOpen, className = 'om-sa-link', title, label, current }: {
  children: ReactNode;
  href?: string;
  filePath?: string;
  artifact?: SuperAgentArtifact;
  onOpen?: () => void;
  className?: string;
  title?: string;
  label?: string;
  current?: boolean;
}) {
  const { chatId, workingDir, rootKey, resolvePath, onNotify } = useContext(PreviewLinkContext);
  const { t } = useI18n();
  let target: Target | undefined;
  const resolved = artifact?.filePath ?? (filePath && (resolvePath ? resolvePath(filePath) : filePath));
  const path = resolved?.replace(/^(?:\.[\\/])+/, '');
  const windowsDrive = path && /^[a-z]:[\\/]/i.test(path);
  const isLocalPath = path && !/^[\\/]{2}|[\x00-\x1f]/.test(path) && (windowsDrive || !/^[a-z][a-z\d+.-]*:/i.test(path));
  if (artifact?.assetId && artifact.versionId) {
    target = { href: assetMediaUrl(artifact.assetId, artifact.versionId), file: { kind: 'library-asset', assetId: artifact.assetId, versionId: artifact.versionId } };
  } else if (isLocalPath && (chatId || workingDir)) {
    const params = new URLSearchParams({ path, raw: '1' });
    if (chatId) params.set('chatId', chatId);
    else if (workingDir) params.set('workingDir', workingDir);
    const key = path.startsWith('/') || windowsDrive ? undefined : artifact?.rootKey || rootKey;
    if (key) params.set('rootKey', key);
    target = { href: `${SUPER_AGENT_API}/file-content?${params}`,
      file: chatId ? { kind: 'workspace-file', conversationId: chatId, path, ...(key ? { rootKey: key } : {}) } : undefined };
  } else if (href) {
    target = { href, file: linkedFile(href, chatId) };
  }
  const props = { className, title, 'aria-label': label, 'aria-current': current || undefined };
  function handleClick(event: MouseEvent<HTMLElement>) {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.ctrlKey || event.metaKey) {
      const bridge = getDesktopBridge();
      if (target?.file && bridge?.openLocalPreviewFile) {
        event.preventDefault();
        void bridge.openLocalPreviewFile(target.file).catch(() => onNotify?.(t('Could not preview resource'), 'error'));
      }
      return;
    }
    if (event.shiftKey || event.altKey || !onOpen) return;
    event.preventDefault();
    onOpen();
  }
  if (!target) return <Button type="button" variant="plain" {...props} onClick={handleClick}>{children}</Button>;
  return <a {...props} href={target.href} target="_blank" rel="noopener noreferrer" onClick={handleClick}>{children}</a>;
}
