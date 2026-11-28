import type { PreviewKind } from '../../../../shared/game-asset-preview';
export { detectGameAssetPreview, type PreviewKind } from '../../../../shared/game-asset-preview';

export type GameAssetPreviewProps = {
  path: string;
  url: string;
  resolveFileUrl?: (workspacePath: string) => string | null | undefined;
  content?: string;
  previewKind?: PreviewKind;
  active?: boolean;
  title?: string;
};

export function companionPath(path: string, reference: string) {
  const decoded = decodeURIComponent(reference);
  if (!decoded || /[%\\:?#\x00-\x1f]/.test(decoded) || decoded.startsWith('/') || decoded.trim() !== decoded) throw new Error('Invalid workspace reference');
  const segments = path.split('/').slice(0, -1);
  for (const segment of decoded.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (!segments.length) throw new Error('Invalid workspace reference');
      segments.pop();
    } else segments.push(segment);
  }
  return segments.join('/');
}

export async function readPreviewBytes(url: string | URL, signal: AbortSignal, limit: number) {
  const response = await fetch(url, { signal, redirect: 'error', mode: 'same-origin' });
  if (!response.ok || !response.body) throw new Error('Could not load file');
  const reader = response.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let length = 0;
  try {
    if (Number(response.headers.get('content-length')) > limit) throw new Error('File too large');
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) throw new Error('File too large');
      chunks.push(new Uint8Array(value));
    }
  } finally { await reader.cancel().catch(() => {}); }
  return new Blob(chunks, { type: response.headers.get('content-type') || '' });
}
