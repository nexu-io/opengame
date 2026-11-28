export type PreviewKind = 'image' | 'audio' | 'video' | 'atlas' | 'tilemap' | 'model' | 'glb';

export function detectGameAssetPreview(path: string, content?: string): PreviewKind | null {
  const extension = /\.([^./\\]+)$/.exec(path)?.[1].toLowerCase();
  if (extension === 'tmj') return 'tilemap';
  if (extension === 'json') {
    if (/(?:^|[./_-])(?:atlas|spritesheet)\.json$/i.test(path)) return 'atlas';
    if (!content || content.length > 4194304 || !/"(?:layers|frames)"\s*:/.test(content)) return null;
    try {
      const json = JSON.parse(content);
      if (json?.type === 'map' && Array.isArray(json.layers) && Array.isArray(json.tilesets)) return 'tilemap';
      if (json?.frames && typeof json.frames === 'object' && typeof json.meta?.image === 'string') return 'atlas';
    } catch { return null; }
    return null;
  }
  if (extension === 'glb') return 'glb';
  if (/^(gltf|obj|stl|fbx|ply|bvh)$/.test(extension ?? '')) return 'model';
  if (/^(png|jpe?g|webp|gif|bmp|avif)$/.test(extension ?? '')) return 'image';
  if (/^(wav|mp3|ogg|oga|opus|m4a|aac|flac)$/.test(extension ?? '')) return 'audio';
  if (/^(mp4|m4v|mov|webm|ogv)$/.test(extension ?? '')) return 'video';
  return null;
}
