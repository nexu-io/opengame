import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execute } from '../hyperframes.ts';
import { verificationBinaries } from '../scripts/verify-export.ts';
import { inspectGlb } from '../scripts/game-glb-inspect.mjs';

const MIN_EMBEDDED_IMAGE_BYTES = 32 * 1024;
const GLB_JSON_CHUNK = 0x4e4f534a;
const GLB_BIN_CHUNK = 0x004e4942;

export function pngMayHaveTransparency(bytes: Buffer): boolean {
  // PNG signature (8) + IHDR length (4) + "IHDR" (4) + width (4) + height (4) + bitDepth (1) + colorType (1)
  if (bytes.length < 26 || bytes[0] !== 137 || bytes[1] !== 80 || bytes[2] !== 78 || bytes[3] !== 71) {
    return true;
  }
  const colorType = bytes[25];
  if (colorType === 4 || colorType === 6 || colorType === 3) return true;
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    if (type === 'tRNS') return true;
    if (type === 'IDAT' || type === 'IEND') return false;
    offset += 12 + length;
  }
  return false;
}

/**
 * Transcodes a raster PNG/JPEG buffer to WebP at its original pixel dimensions.
 * - `losslessPng: true` uses bit-exact lossless WebP for PNGs (used for standalone 2D assets).
 * - `losslessPng: false` uses visually lossless high-quality WebP (used for embedded 3D PBR textures).
 */
export async function transcodeRasterToWebp(
  sourcePathOrBuffer: string | Buffer,
  originalBytes: Buffer,
  mimeType: 'image/png' | 'image/jpeg',
  options: { losslessPng?: boolean; quality?: number } = {},
): Promise<Buffer | null> {
  const isPng = mimeType === 'image/png';
  const losslessPng = options.losslessPng ?? true;
  const quality = options.quality ?? (isPng ? 86 : 82);
  const tempDir = await mkdtemp(path.join(tmpdir(), 'openmotion-webp-'));
  const outputPath = path.join(tempDir, 'out.webp');
  try {
    let sourcePath: string;
    if (typeof sourcePathOrBuffer === 'string') {
      sourcePath = sourcePathOrBuffer;
    } else {
      sourcePath = path.join(tempDir, isPng ? 'in.png' : 'in.jpg');
      await writeFile(sourcePath, sourcePathOrBuffer);
    }

    const cwebpBin = process.env.CWEBP_PATH || 'cwebp';
    const cwebpArgs = isPng && losslessPng
      ? ['-quiet', '-lossless', '-exact', '-z', '6', sourcePath, '-o', outputPath]
      : isPng
        ? ['-quiet', '-q', String(quality), '-alpha_q', '100', sourcePath, '-o', outputPath]
        : ['-quiet', '-q', String(quality), sourcePath, '-o', outputPath];
    const cwebpRes = await execute(cwebpBin, cwebpArgs, tempDir, 15_000).catch(() => null);
    let encoded = cwebpRes?.code === 0;

    // FFmpeg's libwebp encoder does not expose `-exact`, so for bit-exact lossless PNGs we only use it on opaque PNGs.
    const canUseFfmpeg = !isPng || !losslessPng || !pngMayHaveTransparency(originalBytes);
    if (!encoded && canUseFfmpeg) {
      const { ffmpeg } = verificationBinaries();
      const ffmpegArgs = isPng && losslessPng
        ? ['-y', '-loglevel', 'error', '-nostdin', '-i', sourcePath, '-pix_fmt', 'bgra', '-c:v', 'libwebp', '-lossless', '1', '-compression_level', '6', outputPath]
        : isPng
          ? ['-y', '-loglevel', 'error', '-nostdin', '-i', sourcePath, '-pix_fmt', 'bgra', '-c:v', 'libwebp', '-quality', String(quality), outputPath]
          : ['-y', '-loglevel', 'error', '-nostdin', '-i', sourcePath, '-c:v', 'libwebp', '-quality', String(quality), outputPath];
      const ffmpegRes = await execute(ffmpeg, ffmpegArgs, tempDir, 15_000).catch(() => null);
      encoded = ffmpegRes?.code === 0;
    }

    if (!encoded) return null;
    const compressed = await readFile(outputPath).catch(() => null);
    if (compressed && compressed.length > 0 && compressed.length < originalBytes.length * 0.95) {
      return compressed;
    }
    return null;
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

export interface GlbOptimizeResult {
  data: Buffer;
  optimized: boolean;
  convertedImages: number;
  savedBytes: number;
}

/**
 * Re-encodes embedded PNG/JPEG textures inside a GLB 2 binary to `EXT_texture_webp`
 * at their original resolution while preserving 100% of mesh geometry, skins, bones and animations.
 * Falls back cleanly to original bytes when no encoder is available or savings are < 5%.
 */
export async function optimizeGlbTexturesForPublish(bytes: Buffer): Promise<GlbOptimizeResult> {
  const unchanged: GlbOptimizeResult = { data: bytes, optimized: false, convertedImages: 0, savedBytes: 0 };
  if (bytes.length < 20 || bytes.toString('ascii', 0, 4) !== 'glTF' || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length) {
    return unchanged;
  }

  let doc: any;
  let binary: Buffer | undefined;
  for (let offset = 12; offset < bytes.length;) {
    if (offset + 8 > bytes.length) return unchanged;
    const length = bytes.readUInt32LE(offset);
    const type = bytes.readUInt32LE(offset + 4);
    if (length % 4 !== 0 || offset + 8 + length > bytes.length) return unchanged;
    const chunk = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === GLB_JSON_CHUNK) {
      try { doc = JSON.parse(chunk.toString('utf8').trim()); } catch { return unchanged; }
    } else if (type === GLB_BIN_CHUNK) {
      binary = chunk;
    }
    offset += 8 + length;
  }
  if (!doc || !binary || !Array.isArray(doc.images) || !doc.images.length || !Array.isArray(doc.bufferViews)) {
    return unchanged;
  }

  // Never touch bufferViews referenced by mesh/skin/animation accessors or non-zero buffers.
  const accessorViews = new Set<number>();
  for (const accessor of doc.accessors ?? []) {
    if (typeof accessor?.bufferView === 'number') accessorViews.add(accessor.bufferView);
    if (typeof accessor?.sparse?.indices?.bufferView === 'number') accessorViews.add(accessor.sparse.indices.bufferView);
    if (typeof accessor?.sparse?.values?.bufferView === 'number') accessorViews.add(accessor.sparse.values.bufferView);
  }

  // Verify bufferViews are disjoint within buffer 0 before compacting BIN.
  const ranges: Array<{ index: number; start: number; end: number }> = [];
  for (let i = 0; i < doc.bufferViews.length; i++) {
    const view = doc.bufferViews[i];
    if (!view || (view.buffer ?? 0) !== 0) return unchanged;
    const start = view.byteOffset ?? 0;
    const end = start + (view.byteLength ?? 0);
    if (start < 0 || end < start || end > binary.length) return unchanged;
    ranges.push({ index: i, start, end });
  }
  ranges.sort((a, b) => a.start - b.start || a.end - b.end);
  for (let i = 1; i < ranges.length; i++) {
    if (ranges[i].start < ranges[i - 1].end) return unchanged;
  }

  // Meshopt payloads reference buffers directly, so they may live outside every
  // ordinary bufferView. Retain these ranges when compacting the embedded BIN.
  const compressedRanges: Array<{ index: number; extension: string; start: number; length: number }> = [];
  const compressedViews = new Set<number>();
  for (let index = 0; index < doc.bufferViews.length; index++) {
    for (const extension of ['EXT_meshopt_compression', 'KHR_meshopt_compression']) {
      const ref = doc.bufferViews[index].extensions?.[extension];
      if (!ref) continue;
      compressedViews.add(index);
      // The extension schema requires a valid buffer index, including buffer 0.
      if (!Array.isArray(doc.buffers) || !Number.isSafeInteger(ref.buffer) || ref.buffer < 0 || ref.buffer >= doc.buffers.length || !doc.buffers[ref.buffer]) return unchanged;
      if (ref.buffer !== 0) continue;
      const start = ref.byteOffset ?? 0;
      const length = ref.byteLength;
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(length) || start < 0 || length <= 0 || start + length > binary.length) return unchanged;
      compressedRanges.push({ index, extension, start, length });
    }
  }

  // Track textures carrying data maps (normal / metallicRoughness / occlusion) so they use higher WebP quality.
  const dataTextureIndices = new Set<number>();
  for (const material of doc.materials ?? []) {
    for (const ref of [material?.normalTexture, material?.occlusionTexture, material?.pbrMetallicRoughness?.metallicRoughnessTexture]) {
      if (typeof ref?.index === 'number') dataTextureIndices.add(ref.index);
    }
  }
  const dataImageIndices = new Set<number>();
  for (const texIndex of dataTextureIndices) {
    const tex = doc.textures?.[texIndex];
    const src = tex?.source ?? tex?.extensions?.EXT_texture_webp?.source;
    if (typeof src === 'number') dataImageIndices.add(src);
  }

  const convertedViewMap = new Map<number, Buffer>();
  const convertedImageIndices = new Set<number>();
  const bvToImages = new Map<number, number[]>();
  for (let i = 0; i < doc.images.length; i++) {
    const image = doc.images[i];
    if (typeof image?.bufferView !== 'number') continue;
    const list = bvToImages.get(image.bufferView) ?? [];
    list.push(i);
    bvToImages.set(image.bufferView, list);
  }

  for (const [bvIndex, imageIndices] of bvToImages.entries()) {
    if (accessorViews.has(bvIndex) || compressedViews.has(bvIndex)) continue;
    const primaryImage = doc.images[imageIndices[0]];
    const mimeType = primaryImage?.mimeType;
    if (mimeType !== 'image/png' && mimeType !== 'image/jpeg') continue;
    if (!imageIndices.every(idx => doc.images[idx]?.mimeType === mimeType)) continue;
    const view = doc.bufferViews[bvIndex];
    const start = view.byteOffset ?? 0;
    const length = view.byteLength ?? 0;
    if (length < MIN_EMBEDDED_IMAGE_BYTES) continue;

    const slice = Buffer.from(binary.subarray(start, start + length));
    const isDataMap = imageIndices.some(idx => dataImageIndices.has(idx));
    const webp = await transcodeRasterToWebp(slice, slice, mimeType, {
      losslessPng: false,
      quality: isDataMap ? 92 : 86,
    });
    if (!webp) continue;
    convertedViewMap.set(bvIndex, webp);
    for (const idx of imageIndices) convertedImageIndices.add(idx);
  }

  if (convertedViewMap.size === 0) return unchanged;

  // Rebuild compacted 4-byte-aligned BIN chunk and update JSON metadata.
  const nextDoc = JSON.parse(JSON.stringify(doc));
  const binParts: Buffer[] = [];
  const relocatedRanges = new Map<string, number>();
  const maxBinBytes = binary.length;
  let binOffset = 0;
  const appendBinary = (data: Buffer): number | undefined => {
    const pad = (4 - (binOffset % 4)) % 4;
    // Overlapping extension ranges must not amplify the final concat allocation.
    if (binOffset + pad + data.length > maxBinBytes) return undefined;
    if (pad > 0) {
      binParts.push(Buffer.alloc(pad));
      binOffset += pad;
    }
    const offset = binOffset;
    binParts.push(data);
    binOffset += data.length;
    return offset;
  };
  for (let bvIndex = 0; bvIndex < nextDoc.bufferViews.length; bvIndex++) {
    const view = nextDoc.bufferViews[bvIndex];
    const start = view.byteOffset ?? 0;
    const length = view.byteLength ?? 0;
    const replacement = convertedViewMap.get(bvIndex);
    const data = replacement ?? binary.subarray(start, start + length);
    const offset = appendBinary(data);
    if (offset === undefined) return unchanged;
    view.byteOffset = offset;
    view.byteLength = data.length;
    if (!replacement) relocatedRanges.set(`${start}:${length}`, view.byteOffset);
  }
  for (const { index, extension, start, length } of compressedRanges) {
    const key = `${start}:${length}`;
    let offset = relocatedRanges.get(key);
    if (offset === undefined) {
      offset = appendBinary(binary.subarray(start, start + length));
      if (offset === undefined) return unchanged;
      relocatedRanges.set(key, offset);
    }
    nextDoc.bufferViews[index].extensions[extension].byteOffset = offset;
  }
  const trailingPad = (4 - (binOffset % 4)) % 4;
  if (trailingPad > 0) {
    binParts.push(Buffer.alloc(trailingPad));
    binOffset += trailingPad;
  }
  const nextBin = Buffer.concat(binParts, binOffset);
  if (Array.isArray(nextDoc.buffers) && nextDoc.buffers[0]) {
    nextDoc.buffers[0].byteLength = nextBin.length;
  }

  for (const imgIdx of convertedImageIndices) {
    nextDoc.images[imgIdx].mimeType = 'image/webp';
  }
  for (const texture of nextDoc.textures ?? []) {
    if (typeof texture?.source === 'number' && convertedImageIndices.has(texture.source)) {
      const sourceIndex = texture.source;
      delete texture.source;
      texture.extensions = { ...(texture.extensions ?? {}), EXT_texture_webp: { source: sourceIndex } };
    }
  }
  const used = new Set<string>(Array.isArray(nextDoc.extensionsUsed) ? nextDoc.extensionsUsed : []);
  used.add('EXT_texture_webp');
  nextDoc.extensionsUsed = [...used];
  const required = new Set<string>(Array.isArray(nextDoc.extensionsRequired) ? nextDoc.extensionsRequired : []);
  required.add('EXT_texture_webp');
  nextDoc.extensionsRequired = [...required];

  const jsonRaw = Buffer.from(JSON.stringify(nextDoc), 'utf8');
  const jsonPad = (4 - (jsonRaw.length % 4)) % 4;
  const jsonChunk = jsonPad > 0 ? Buffer.concat([jsonRaw, Buffer.alloc(jsonPad, 0x20)]) : jsonRaw;

  const totalLength = 12 + 8 + jsonChunk.length + 8 + nextBin.length;
  if (totalLength >= bytes.length * 0.95) return unchanged;

  const header = Buffer.alloc(12);
  header.write('glTF', 0, 'ascii');
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(totalLength, 8);

  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonChunk.length, 0);
  jsonHeader.writeUInt32LE(GLB_JSON_CHUNK, 4);

  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(nextBin.length, 0);
  binHeader.writeUInt32LE(GLB_BIN_CHUNK, 4);

  const output = Buffer.concat([header, jsonHeader, jsonChunk, binHeader, nextBin], totalLength);
  try {
    // Structural round-trip safety check before returning optimized binary.
    inspectGlb(output);
  } catch {
    return unchanged;
  }
  return {
    data: output,
    optimized: true,
    convertedImages: convertedImageIndices.size,
    savedBytes: bytes.length - output.length,
  };
}
