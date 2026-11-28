import { companionPath, readPreviewBytes, type GameAssetPreviewProps } from './formats';

const jsonLimit = 4 * 1024 ** 2;
const pixelLimit = 16 * 1024 ** 2;
export const mapFormatHint = 'Export a finite orthogonal map with JSON tile arrays and static PNG tilesets.';
export const mapFileHint = 'Check the workspace file or its relative path: {path}';

export class TiledFileError extends Error {}

function requireFormat(condition: unknown): asserts condition {
  if (!condition) throw new Error(mapFormatHint);
}

function record(value: unknown): Record<string, unknown> {
  requireFormat(value && typeof value === 'object' && !Array.isArray(value));
  return value as Record<string, unknown>;
}

function integer(value: unknown, min = 1, max = 0x0fffffff): number {
  requireFormat(typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max);
  return value;
}

type Atlas = { first: number; count: number; columns: number; margin: number; spacing: number; image: ImageBitmap };

export async function renderTiledMap({ path, url, resolveFileUrl }: GameAssetPreviewProps, signal: AbortSignal) {
  const atlases: Atlas[] = [];
  async function read(file: string, maxBytes: number, source = resolveFileUrl?.(file)) {
    try {
      if (!source) throw new Error();
      return await readPreviewBytes(source, signal, maxBytes);
    } catch { throw new TiledFileError(file); }
  }
  const map = record(JSON.parse(await (await read(path, jsonLimit, url)).text()));
  requireFormat(map.type === 'map' && map.orientation === 'orthogonal' && !map.infinite);
  const width = integer(map.width), height = integer(map.height);
  const tw = integer(map.tilewidth), th = integer(map.tileheight);
  const canvas = document.createElement('canvas');
  requireFormat(width * tw <= 8192 && height * th <= 8192 && width * height * tw * th <= pixelLimit);
  canvas.width = width * tw;
  canvas.height = height * th;
  const ctx = canvas.getContext('2d');
  requireFormat(ctx && Array.isArray(map.layers) && map.layers.length <= 128 && Array.isArray(map.tilesets) && map.tilesets.length <= 16);
  ctx.imageSmoothingEnabled = false;
  if (map.backgroundcolor !== undefined) {
    const color = String(map.backgroundcolor);
    requireFormat(/^#(?:[a-f\d]{6}|[a-f\d]{8})$/i.test(color));
    ctx.fillStyle = color.length === 9 ? `#${color.slice(3)}${color.slice(1, 3)}` : color;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  let pixels = 0;
  try {
    for (const entry of map.tilesets) {
      let set = record(entry), owner = path;
      const first = integer(set.firstgid);
      if (set.source !== undefined) {
        requireFormat(typeof set.source === 'string' && /\.tsj$/i.test(set.source));
        owner = companionPath(path, set.source);
        set = record(JSON.parse(await (await read(owner, jsonLimit)).text()));
      }
      requireFormat(typeof set.image === 'string' && /\.png$/i.test(set.image) && set.tilewidth === tw && set.tileheight === th && !set.transparentcolor);
      const offset = record(set.tileoffset ?? {});
      requireFormat(!offset.x && !offset.y && (!set.tiles || (Array.isArray(set.tiles) && set.tiles.every(tile => !record(tile).animation && !record(tile).image))));
      const columns = integer(set.columns), count = integer(set.tilecount);
      const margin = integer(set.margin ?? 0, 0), spacing = integer(set.spacing ?? 0, 0);
      const imagePath = companionPath(owner, set.image);
      const blob = await read(imagePath, 16 * 1024 ** 2);
      const header = new DataView(await blob.slice(0, 24).arrayBuffer());
      requireFormat(header.byteLength === 24 && header.getUint32(0) === 0x89504e47 && header.getUint32(4) === 0x0d0a1a0a && header.getUint32(12) === 0x49484452);
      const imageWidth = header.getUint32(16), imageHeight = header.getUint32(20);
      pixels += imageWidth * imageHeight;
      requireFormat(pixels <= pixelLimit && imageWidth >= margin + columns * (tw + spacing) - spacing && imageHeight >= margin + Math.ceil(count / columns) * (th + spacing) - spacing);
      atlases.push({ first, count, columns, margin, spacing, image: await createImageBitmap(blob) });
      signal.throwIfAborted();
    }
    atlases.sort((a, b) => b.first - a.first);
    let cells = 0;
    for (const raw of map.layers) {
      const layer = record(raw);
      if (layer.visible === false || layer.opacity === 0) continue;
      requireFormat(layer.type === 'tilelayer' && Array.isArray(layer.data) && !layer.compression && (!layer.encoding || layer.encoding === 'csv') && !layer.chunks && !layer.tintcolor);
      requireFormat((layer.mode ?? 'normal') === 'normal' && (layer.blendmode ?? 'normal') === 'normal');
      const cols = integer(layer.width), rows = integer(layer.height);
      cells += cols * rows;
      requireFormat(layer.data.length === cols * rows && cells <= 512 * 1024);
      const opacity = layer.opacity ?? 1;
      requireFormat(typeof opacity === 'number' && opacity >= 0 && opacity <= 1);
      ctx.globalAlpha = opacity;
      const dx = Number(layer.x ?? 0) * tw + Number(layer.offsetx ?? 0);
      const dy = Number(layer.y ?? 0) * th + Number(layer.offsety ?? 0);
      requireFormat(Number.isFinite(dx) && Number.isFinite(dy));
      for (const [index, rawId] of layer.data.entries()) {
        const gid = integer(rawId, 0, 0xffffffff);
        const id = gid & 0x0fffffff;
        if (!id) continue;
        const atlas = atlases.find(set => id >= set.first);
        requireFormat(atlas && id - atlas.first < atlas.count);
        const tile = id - atlas.first;
        const sx = atlas.margin + (tile % atlas.columns) * (tw + atlas.spacing);
        const sy = atlas.margin + Math.floor(tile / atlas.columns) * (th + atlas.spacing);
        const h = gid & 0x80000000 ? -1 : 1, v = gid & 0x40000000 ? -1 : 1;
        const diagonal = Boolean(gid & 0x20000000);
        requireFormat(!diagonal || tw === th);
        const x = dx + (index % cols) * tw + (h < 0 ? tw : 0);
        const y = dy + Math.floor(index / cols) * th + (v < 0 ? th : 0);
        if (diagonal) ctx.setTransform(0, v, h, 0, x, y);
        else ctx.setTransform(h, 0, 0, v, x, y);
        ctx.drawImage(atlas.image, sx, sy, tw, th, 0, 0, tw, th);
      }
    }
    return canvas;
  } finally { for (const atlas of atlases) atlas.image.close(); }
}
