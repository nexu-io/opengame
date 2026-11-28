const offlineMessage = 'Preview requires a GLB with embedded buffers and textures.';

/** Inspect the JSON chunk before the renderer can request external files or CDN decoders. */
export async function loadModelPreviewSource(src: string, signal: AbortSignal) {
  const url = new URL(src, document.baseURI);
  const assetFile = /^\/motion-api\/assets\/[\w.-]+\/versions\/[\w.-]+\/file$/.test(url.pathname);
  const upload = /^\/motion-api\/super-agent\/uploads\/[\w.-]+$/.test(url.pathname);
  const workspaceFile = url.pathname === '/motion-api/super-agent/file-content' && url.searchParams.get('raw') === '1';
  if (url.origin !== location.origin || !['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      !(assetFile || upload || workspaceFile)) throw new Error('Preview unavailable');
  const response = await fetch(url, { signal, redirect: 'error' });
  if (!response.ok) throw new Error('Preview unavailable');
  const file = await response.blob();
  const header = new DataView(await file.slice(0, 20).arrayBuffer());
  if (header.byteLength < 20 || header.getUint32(0, true) !== 0x46546c67 ||
      header.getUint32(4, true) !== 2 || header.getUint32(8, true) !== file.size || header.getUint32(16, true) !== 0x4e4f534a) {
    throw new Error('Preview unavailable');
  }
  const end = 20 + header.getUint32(12, true);
  if (end > file.size) throw new Error('Preview unavailable');
  // Only the inspected JSON and an optional binary chunk may reach the loader.
  if (end < file.size) {
    const binary = new DataView(await file.slice(end, end + 8).arrayBuffer());
    if (binary.byteLength !== 8 || binary.getUint32(4, true) !== 0x004e4942 ||
        end + 8 + binary.getUint32(0, true) !== file.size) throw new Error('Preview unavailable');
  }
  const json = JSON.parse(await file.slice(20, end).text()) as {
    extensionsUsed?: string[];
    buffers?: { uri?: string }[];
    images?: { uri?: string; mimeType?: string }[];
  };
  const linkedBuffer = json.buffers?.some(({ uri }) => uri !== undefined && !/^data:application\/(?:octet-stream|gltf-buffer);base64,/i.test(uri));
  const linkedTexture = json.images?.some(({ uri, mimeType }) =>
    (uri !== undefined && !/^data:image\/(?:jpeg|png|webp|avif|ktx2);base64,/i.test(uri)) ||
    (mimeType !== undefined && !/^image\/(?:jpeg|png|webp|avif|ktx2)$/i.test(mimeType)));
  if (linkedBuffer || linkedTexture) throw new Error(offlineMessage);
  signal.throwIfAborted();
  return { objectUrl: URL.createObjectURL(file), meshopt: json.extensionsUsed?.some(name => name === 'EXT_meshopt_compression' || name === 'KHR_meshopt_compression') ?? false };
}

export { offlineMessage };
