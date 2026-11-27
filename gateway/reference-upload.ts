import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execute } from '../hyperframes.ts';
import { verificationBinaries } from '../scripts/verify-export.ts';
import {
  OPEN_DESIGN_JOB_UPLOAD_BUDGET_BYTES,
  OPEN_DESIGN_LEGACY_UPLOAD_LIMIT_BYTES,
  OPEN_DESIGN_LEGACY_UPLOAD_TARGET_BYTES,
  OPEN_DESIGN_MAX_SOURCE_REFERENCE_BYTES,
  OPEN_DESIGN_UPLOAD_SOFT_BUDGET_BYTES,
} from '../shared/asset-limits.ts';
import { pngMayHaveTransparency } from './glb-optimize.ts';
import { ProviderError, withErrorMeta } from './network.ts';

export type SupportedReferenceMime = 'image/png' | 'image/jpeg' | 'image/webp';

export const OPEN_DESIGN_SOURCE_LIMIT_MESSAGE = 'The reference image is larger than the 30 MiB OpenDesign limit.';
export const OPEN_DESIGN_UPLOAD_LIMIT_REJECTED_MESSAGE = 'OpenDesign rejected this reference image because it exceeds the upload size limit.';
export const OPEN_DESIGN_REFERENCE_ENCODER_UNAVAILABLE_MESSAGE = 'Could not prepare the reference image for upload because no compatible local image encoder is available.';
export const OPEN_DESIGN_REFERENCE_ALPHA_LIMIT_MESSAGE = 'The reference image with transparency could not be reduced within the OpenDesign upload limit without losing transparency.';
export const OPEN_DESIGN_REFERENCE_COMPRESS_LIMIT_MESSAGE = 'The reference image could not be reduced within the OpenDesign upload limit.';

export type ReferencePreparationErrorCode =
  | 'REFERENCE_TOO_LARGE'
  | 'REFERENCE_INVALID_FORMAT'
  | 'REFERENCE_ENCODER_UNAVAILABLE';

export class ReferencePreparationError extends Error {
  readonly code: ReferencePreparationErrorCode;
  readonly errorSource: 'local';

  constructor(code: ReferencePreparationErrorCode, message: string) {
    super(message);
    this.name = 'ReferencePreparationError';
    this.code = code;
    this.errorSource = 'local';
  }
}

export type ReferenceEncoderCapabilities = {
  cwebpBin?: string;
  ffmpegBin?: string;
  cwebp: boolean;
  ffmpegLibwebp: boolean;
  ffmpegPng: boolean;
  ffmpegJpeg: boolean;
  sipsPng: boolean;
  sipsJpeg: boolean;
};

export type PreparedCloudReference = {
  bytes: Buffer;
  mimeType: SupportedReferenceMime;
  filename: string;
  compressed: boolean;
};

const EXT_BY_MIME: Record<SupportedReferenceMime, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
};

const COMPRESSION_MAX_EDGES = [4096, 2048, 1600, 1280, 1024, 768];
const WEBP_QUALITIES = [86, 78, 68, 56];
const FFMPEG_JPEG_QSCALES = [3, 5, 8, 12];
const SIPS_JPEG_QUALITIES = [86, 76, 66, 54];

// Valid 2x2 RGBA PNG (with non-trivial alpha) used for runtime encoder smoke probes.
const PROBE_RGBA_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAF0lEQVR4nGP4z8DQwPAfCBkY/gMBgwMAQBkHun2RCYwAAAAASUVORK5CYII=',
  'base64',
);

const encoderProbeCache = new Map<string, Promise<ReferenceEncoderCapabilities>>();
let encoderOverrideForTests: ReferenceEncoderCapabilities | undefined;

const learnedUploadLimits = new Map<string, number>();

export function clearReferenceEncoderCache() {
  encoderProbeCache.clear();
  encoderOverrideForTests = undefined;
}

export function setReferenceEncoderCapabilitiesForTests(capabilities?: ReferenceEncoderCapabilities) {
  encoderOverrideForTests = capabilities;
}

export function clearLearnedOpenDesignUploadLimits() {
  learnedUploadLimits.clear();
}

export function normalizeUploadLimitOrigin(urlOrOrigin: string): string {
  try {
    return new URL(urlOrOrigin).origin;
  } catch {
    return urlOrOrigin.replace(/\/+$/, '');
  }
}

export function getLearnedOpenDesignUploadLimit(urlOrOrigin: string): number | undefined {
  return learnedUploadLimits.get(normalizeUploadLimitOrigin(urlOrOrigin));
}

export function setLearnedOpenDesignUploadLimit(urlOrOrigin: string, maxBytes: number) {
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) return;
  const origin = normalizeUploadLimitOrigin(urlOrOrigin);
  const existing = learnedUploadLimits.get(origin);
  learnedUploadLimits.set(origin, existing !== undefined ? Math.min(existing, maxBytes) : maxBytes);
}

/** Sniff PNG, JPEG, or WebP from actual file magic bytes. */
export function detectReferenceImageMime(bytes: Buffer): SupportedReferenceMime | undefined {
  if (bytes.length >= 8
    && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) {
    return 'image/png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (bytes.length >= 12
    && bytes.toString('ascii', 0, 4) === 'RIFF'
    && bytes.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  return undefined;
}

/** Determine whether a supported reference image may contain transparent pixels. */
export function imageMayHaveTransparency(bytes: Buffer, mimeType: SupportedReferenceMime): boolean {
  if (mimeType === 'image/jpeg') return false;
  if (mimeType === 'image/png') return pngMayHaveTransparency(bytes);
  // WebP container: inspect the first chunk FourCC after "RIFF<size>WEBP".
  if (bytes.length < 21) return true;
  const chunk = bytes.toString('ascii', 12, 16);
  if (chunk === 'VP8 ') return false;
  if (chunk === 'VP8X') return (bytes[20] & 0x10) !== 0;
  if (chunk === 'VP8L') {
    // VP8L bitstream header: byte 20 is 0x2f signature, followed by 32-bit LE word where bit 28 is alpha_is_used.
    if (bytes.length >= 25 && bytes[20] === 0x2f) {
      return (bytes.readUInt32LE(21) & (1 << 28)) !== 0;
    }
    return true;
  }
  return true;
}

/** Fast binary dimension parser for PNG, JPEG, and WebP (returns undefined if unrecognized). */
export function readImageDimensions(bytes: Buffer, mimeType: SupportedReferenceMime): { width: number; height: number } | undefined {
  if (mimeType === 'image/png') {
    if (bytes.length < 24 || bytes.toString('ascii', 12, 16) !== 'IHDR') return undefined;
    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    return width > 0 && height > 0 ? { width, height } : undefined;
  }
  if (mimeType === 'image/webp') {
    if (bytes.length < 30) return undefined;
    const chunk = bytes.toString('ascii', 12, 16);
    if (chunk === 'VP8X' && bytes.length >= 30) {
      const width = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16));
      const height = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16));
      return width > 0 && height > 0 ? { width, height } : undefined;
    }
    if (chunk === 'VP8L' && bytes.length >= 25 && bytes[20] === 0x2f) {
      const bits = bytes.readUInt32LE(21);
      const width = (bits & 0x3fff) + 1;
      const height = ((bits >> 14) & 0x3fff) + 1;
      return width > 0 && height > 0 ? { width, height } : undefined;
    }
    if (chunk === 'VP8 ' && bytes.length >= 30 && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
      const width = bytes.readUInt16LE(26) & 0x3fff;
      const height = bytes.readUInt16LE(28) & 0x3fff;
      return width > 0 && height > 0 ? { width, height } : undefined;
    }
    return undefined;
  }
  if (mimeType === 'image/jpeg') {
    let offset = 2;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset] !== 0xff) { offset++; continue; }
      while (offset < bytes.length && bytes[offset] === 0xff) offset++;
      if (offset >= bytes.length) break;
      const marker = bytes[offset++];
      if (marker === 0xd8 || marker === 0x01) continue;
      if (marker === 0xd9 || marker === 0xda) break;
      if (offset + 2 > bytes.length) break;
      const segmentLength = bytes.readUInt16BE(offset);
      if (segmentLength < 2 || offset + segmentLength > bytes.length) break;
      const isSof = (marker >= 0xc0 && marker <= 0xc3)
        || (marker >= 0xc5 && marker <= 0xc7)
        || (marker >= 0xc9 && marker <= 0xcb)
        || (marker >= 0xcd && marker <= 0xcf);
      if (isSof && segmentLength >= 7) {
        const height = bytes.readUInt16BE(offset + 3);
        const width = bytes.readUInt16BE(offset + 5);
        return width > 0 && height > 0 ? { width, height } : undefined;
      }
      offset += segmentLength;
    }
  }
  return undefined;
}

function replaceExtension(filename: string, mimeType: SupportedReferenceMime): string {
  const base = path.parse(path.basename(filename || 'reference')).name || 'reference';
  return `${base}${EXT_BY_MIME[mimeType]}`;
}

function resolveFfmpegBin(): string | undefined {
  try {
    return verificationBinaries().ffmpeg;
  } catch {
    return process.env.HYPERFRAMES_FFMPEG_PATH || 'ffmpeg';
  }
}

async function runEncodeSmoke(
  binary: string,
  args: string[],
  cwd: string,
  outPath: string,
  expectedMime: SupportedReferenceMime,
): Promise<boolean> {
  const res = await execute(binary, args, cwd, 8_000).catch(() => null);
  if (!res || res.code !== 0) return false;
  const bytes = await readFile(outPath).catch(() => null);
  return Boolean(bytes && bytes.length > 0 && detectReferenceImageMime(bytes) === expectedMime);
}

/** Verify local image encoders via real 2x2 RGBA encode smoke checks (cached per process and binary set). */
export async function probeReferenceEncoders(): Promise<ReferenceEncoderCapabilities> {
  if (encoderOverrideForTests) return encoderOverrideForTests;
  const cwebpBin = process.env.CWEBP_PATH || 'cwebp';
  const ffmpegBin = resolveFfmpegBin();
  const cacheKey = `${process.platform}|${cwebpBin}|${ffmpegBin ?? ''}`;
  const cached = encoderProbeCache.get(cacheKey);
  if (cached) return cached;

  const task = (async (): Promise<ReferenceEncoderCapabilities> => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'om-ref-probe-'));
    try {
      const samplePath = path.join(tempDir, 'sample.png');
      await writeFile(samplePath, PROBE_RGBA_PNG);

      const cwebpOut = path.join(tempDir, 'cwebp.webp');
      const ffWebpOut = path.join(tempDir, 'ff.webp');
      const ffPngOut = path.join(tempDir, 'ff.png');
      const ffJpgOut = path.join(tempDir, 'ff.jpg');
      const sipsPngOut = path.join(tempDir, 'sips.png');
      const sipsJpgOut = path.join(tempDir, 'sips.jpg');

      const [cwebp, ffmpegLibwebp, ffmpegPng, ffmpegJpeg, sipsPng, sipsJpeg] = await Promise.all([
        runEncodeSmoke(cwebpBin, ['-quiet', '-metadata', 'none', '-q', '80', samplePath, '-o', cwebpOut], tempDir, cwebpOut, 'image/webp'),
        ffmpegBin
          ? runEncodeSmoke(ffmpegBin, ['-y', '-loglevel', 'error', '-nostdin', '-i', samplePath, '-frames:v', '1', '-pix_fmt', 'bgra', '-c:v', 'libwebp', '-quality', '80', ffWebpOut], tempDir, ffWebpOut, 'image/webp')
          : Promise.resolve(false),
        ffmpegBin
          ? runEncodeSmoke(ffmpegBin, ['-y', '-loglevel', 'error', '-nostdin', '-i', samplePath, '-frames:v', '1', '-c:v', 'png', ffPngOut], tempDir, ffPngOut, 'image/png')
          : Promise.resolve(false),
        ffmpegBin
          ? runEncodeSmoke(ffmpegBin, ['-y', '-loglevel', 'error', '-nostdin', '-i', samplePath, '-frames:v', '1', '-c:v', 'mjpeg', '-q:v', '4', ffJpgOut], tempDir, ffJpgOut, 'image/jpeg')
          : Promise.resolve(false),
        process.platform === 'darwin'
          ? runEncodeSmoke('sips', ['-s', 'format', 'png', samplePath, '--out', sipsPngOut], tempDir, sipsPngOut, 'image/png')
          : Promise.resolve(false),
        process.platform === 'darwin'
          ? runEncodeSmoke('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '80', samplePath, '--out', sipsJpgOut], tempDir, sipsJpgOut, 'image/jpeg')
          : Promise.resolve(false),
      ]);

      return {
        ...(cwebp ? { cwebpBin } : {}),
        ...(ffmpegBin && (ffmpegLibwebp || ffmpegPng || ffmpegJpeg) ? { ffmpegBin } : {}),
        cwebp,
        ffmpegLibwebp,
        ffmpegPng,
        ffmpegJpeg,
        sipsPng,
        sipsJpeg,
      };
    } finally {
      await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  })();

  encoderProbeCache.set(cacheKey, task);
  return task;
}

export type PrepareCloudReferenceInput = {
  bytes: Buffer;
  filename?: string;
  maxBytes: number;
  targetBytes?: number;
  maxEdge?: number;
  maxSourceBytes?: number;
  preserveAlpha?: boolean;
  encoders?: ReferenceEncoderCapabilities;
};

/**
 * Prepare a reference image for OpenDesign upload without mutating the source file.
 * - Returns original bytes untouched when within `maxBytes`.
 * - Compresses into a temp workspace when over `maxBytes`, preserving alpha via WebP/PNG and
 *   only using JPEG for opaque images.
 * - Always sniffs output magic bytes so declared `mimeType` and PUT `Content-Type` match.
 */
export async function prepareCloudReference(input: PrepareCloudReferenceInput): Promise<PreparedCloudReference> {
  const maxSourceBytes = input.maxSourceBytes ?? OPEN_DESIGN_MAX_SOURCE_REFERENCE_BYTES;
  if (input.bytes.length === 0 || input.bytes.length > maxSourceBytes) {
    throw new ReferencePreparationError('REFERENCE_TOO_LARGE', OPEN_DESIGN_SOURCE_LIMIT_MESSAGE);
  }
  const detectedMime = detectReferenceImageMime(input.bytes);
  if (!detectedMime) {
    throw new ReferencePreparationError('REFERENCE_INVALID_FORMAT', 'OpenDesign does not accept this reference image format.');
  }
  const baseFilename = input.filename || `reference${EXT_BY_MIME[detectedMime]}`;
  const alignedFilename = replaceExtension(baseFilename, detectedMime);

  if (input.bytes.length <= input.maxBytes) {
    return {
      bytes: input.bytes,
      mimeType: detectedMime,
      filename: alignedFilename,
      compressed: false,
    };
  }

  const targetBytes = Math.min(input.targetBytes ?? Math.floor(input.maxBytes * 0.95), input.maxBytes);
  const keepAlpha = Boolean(input.preserveAlpha || imageMayHaveTransparency(input.bytes, detectedMime));
  const encoders = input.encoders ?? await probeReferenceEncoders();
  const hasWebpEncoder = Boolean((encoders.cwebp && encoders.cwebpBin) || (encoders.ffmpegLibwebp && encoders.ffmpegBin));
  const hasAlphaEncoder = hasWebpEncoder || Boolean((encoders.ffmpegPng && encoders.ffmpegBin) || encoders.sipsPng);
  const hasOpaqueEncoder = hasWebpEncoder || Boolean((encoders.ffmpegJpeg && encoders.ffmpegBin) || encoders.sipsJpeg);

  if ((keepAlpha && !hasAlphaEncoder) || (!keepAlpha && !hasOpaqueEncoder)) {
    throw new ReferencePreparationError('REFERENCE_ENCODER_UNAVAILABLE', OPEN_DESIGN_REFERENCE_ENCODER_UNAVAILABLE_MESSAGE);
  }

  const dims = readImageDimensions(input.bytes, detectedMime);
  const originalMaxEdge = dims ? Math.max(dims.width, dims.height) : undefined;
  const maxEdgeCap = input.maxEdge ?? 4096;
  const edges = originalMaxEdge
    ? Array.from(new Set(COMPRESSION_MAX_EDGES.map(edge => Math.min(edge, Math.min(originalMaxEdge, maxEdgeCap)))))
    : COMPRESSION_MAX_EDGES.filter(edge => edge <= maxEdgeCap);

  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'om-ref-prep-'));
  try {
    const sourcePath = path.join(tempDir, `input${EXT_BY_MIME[detectedMime]}`);
    await writeFile(sourcePath, input.bytes);
    let cwebpSourcePath = sourcePath;
    let decodedPngForCwebp = false;

    const ensureCwebpSource = async (): Promise<string> => {
      if (detectedMime !== 'image/webp' || decodedPngForCwebp || !encoders.ffmpegBin) return cwebpSourcePath;
      const decodedPath = path.join(tempDir, 'decoded.png');
      const decoded = await execute(
        encoders.ffmpegBin,
        ['-y', '-loglevel', 'error', '-nostdin', '-i', sourcePath, '-frames:v', '1', decodedPath],
        tempDir,
        15_000,
      ).catch(() => null);
      if (decoded?.code === 0) {
        cwebpSourcePath = decodedPath;
        decodedPngForCwebp = true;
      }
      return cwebpSourcePath;
    };

    const resizeDimensionsFor = (edge: number): { w: number; h: number } | undefined => {
      if (!dims || !originalMaxEdge || originalMaxEdge <= edge) return undefined;
      const scale = edge / originalMaxEdge;
      return {
        w: Math.max(1, Math.round(dims.width * scale)),
        h: Math.max(1, Math.round(dims.height * scale)),
      };
    };

    let smallest: PreparedCloudReference | undefined;
    let attempt = 0;

    const consider = async (outPath: string): Promise<PreparedCloudReference | undefined> => {
      const candidate = await readFile(outPath).catch(() => null);
      await rm(outPath, { force: true }).catch(() => {});
      if (!candidate || candidate.length === 0) return undefined;
      const candidateMime = detectReferenceImageMime(candidate);
      if (!candidateMime) return undefined;
      if (keepAlpha && candidateMime === 'image/jpeg') return undefined;
      const prepared: PreparedCloudReference = {
        bytes: candidate,
        mimeType: candidateMime,
        filename: replaceExtension(baseFilename, candidateMime),
        compressed: true,
      };
      if (!smallest || prepared.bytes.length < smallest.bytes.length) smallest = prepared;
      return prepared.bytes.length <= targetBytes ? prepared : undefined;
    };

    for (const edge of edges) {
      const resized = resizeDimensionsFor(edge);
      const scaleFilter = `scale='min(${edge},iw)':'min(${edge},ih)':force_original_aspect_ratio=decrease`;

      // 1. WebP first (supports both alpha and opaque with strong compression).
      if (encoders.cwebp && encoders.cwebpBin) {
        for (const quality of WEBP_QUALITIES) {
          const outPath = path.join(tempDir, `out-${++attempt}.webp`);
          const buildArgs = (src: string) => [
            '-quiet',
            '-metadata', 'none',
            '-q', String(quality),
            ...(keepAlpha ? ['-alpha_q', '100'] : []),
            ...(resized ? ['-resize', String(resized.w), String(resized.h)] : []),
            src,
            '-o', outPath,
          ];
          let res = await execute(encoders.cwebpBin, buildArgs(cwebpSourcePath), tempDir, 20_000).catch(() => null);
          if ((!res || res.code !== 0) && detectedMime === 'image/webp' && !decodedPngForCwebp) {
            const fallbackSrc = await ensureCwebpSource();
            if (fallbackSrc !== cwebpSourcePath || decodedPngForCwebp) {
              res = await execute(encoders.cwebpBin, buildArgs(fallbackSrc), tempDir, 20_000).catch(() => null);
            }
          }
          if (res?.code === 0) {
            const hit = await consider(outPath);
            if (hit) return hit;
          }
        }
      } else if (encoders.ffmpegLibwebp && encoders.ffmpegBin) {
        for (const quality of WEBP_QUALITIES) {
          const outPath = path.join(tempDir, `out-${++attempt}.webp`);
          const args = [
            '-y', '-loglevel', 'error', '-nostdin', '-i', sourcePath,
            '-map_metadata', '-1',
            '-frames:v', '1',
            ...(resized || !dims ? ['-vf', scaleFilter] : []),
            ...(keepAlpha ? ['-pix_fmt', 'bgra'] : []),
            '-c:v', 'libwebp', '-quality', String(quality),
            outPath,
          ];
          const res = await execute(encoders.ffmpegBin, args, tempDir, 20_000).catch(() => null);
          if (res?.code === 0) {
            const hit = await consider(outPath);
            if (hit) return hit;
          }
        }
      }

      // 2. Fallback codec: PNG downscale for alpha inputs, JPEG only for opaque inputs.
      if (keepAlpha) {
        const outPath = path.join(tempDir, `out-${++attempt}.png`);
        if (encoders.ffmpegPng && encoders.ffmpegBin) {
          const args = [
            '-y', '-loglevel', 'error', '-nostdin', '-i', sourcePath,
            '-map_metadata', '-1',
            '-frames:v', '1',
            ...(resized || !dims ? ['-vf', scaleFilter] : []),
            '-c:v', 'png', '-compression_level', '9',
            outPath,
          ];
          const res = await execute(encoders.ffmpegBin, args, tempDir, 20_000).catch(() => null);
          if (res?.code === 0) {
            const hit = await consider(outPath);
            if (hit) return hit;
          }
        } else if (encoders.sipsPng) {
          const args = [
            '-s', 'format', 'png',
            ...(resized ? ['-Z', String(edge)] : []),
            sourcePath,
            '--out', outPath,
          ];
          const res = await execute('sips', args, tempDir, 20_000).catch(() => null);
          if (res?.code === 0) {
            const hit = await consider(outPath);
            if (hit) return hit;
          }
        }
      } else if (encoders.ffmpegJpeg && encoders.ffmpegBin) {
        for (const qscale of FFMPEG_JPEG_QSCALES) {
          const outPath = path.join(tempDir, `out-${++attempt}.jpg`);
          const args = [
            '-y', '-loglevel', 'error', '-nostdin', '-i', sourcePath,
            '-map_metadata', '-1',
            '-frames:v', '1',
            ...(resized || !dims ? ['-vf', scaleFilter] : []),
            '-c:v', 'mjpeg', '-q:v', String(qscale),
            outPath,
          ];
          const res = await execute(encoders.ffmpegBin, args, tempDir, 20_000).catch(() => null);
          if (res?.code === 0) {
            const hit = await consider(outPath);
            if (hit) return hit;
          }
        }
      } else if (encoders.sipsJpeg) {
        for (const quality of SIPS_JPEG_QUALITIES) {
          const outPath = path.join(tempDir, `out-${++attempt}.jpg`);
          const args = [
            '-s', 'format', 'jpeg',
            '-s', 'formatOptions', String(quality),
            ...(resized ? ['-Z', String(edge)] : []),
            sourcePath,
            '--out', outPath,
          ];
          const res = await execute('sips', args, tempDir, 20_000).catch(() => null);
          if (res?.code === 0) {
            const hit = await consider(outPath);
            if (hit) return hit;
          }
        }
      }
    }

    if (smallest && smallest.bytes.length <= input.maxBytes) {
      return smallest;
    }

    throw new ReferencePreparationError(
      'REFERENCE_TOO_LARGE',
      keepAlpha ? OPEN_DESIGN_REFERENCE_ALPHA_LIMIT_MESSAGE : OPEN_DESIGN_REFERENCE_COMPRESS_LIMIT_MESSAGE,
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Compute the per-image upload soft budget for a batch of OpenDesign reference images.
 * Enforces 8 MiB per image, 32 MiB per job total rollout budget, and any known/learned AMR cap.
 */
export function computeOpenDesignPerImageBudget(
  byteSizes: number[],
  options: {
    origin: string;
    knownMaxBytes?: number;
    softPerImageBytes?: number;
    softJobTotalBytes?: number;
  },
): number {
  const softPerImage = options.softPerImageBytes ?? OPEN_DESIGN_UPLOAD_SOFT_BUDGET_BYTES;
  const softJobTotal = options.softJobTotalBytes ?? OPEN_DESIGN_JOB_UPLOAD_BUDGET_BYTES;
  const learnedLimit = getLearnedOpenDesignUploadLimit(options.origin);
  const serverCap = options.knownMaxBytes !== undefined && learnedLimit !== undefined
    ? Math.min(options.knownMaxBytes, learnedLimit)
    : options.knownMaxBytes ?? learnedLimit;
  let budget = serverCap !== undefined ? Math.min(softPerImage, serverCap) : softPerImage;
  const count = Math.max(1, byteSizes.length);
  const projectedTotal = byteSizes.reduce((sum, size) => sum + Math.min(size, budget), 0);
  if (projectedTotal > softJobTotal) {
    budget = Math.min(budget, Math.max(OPEN_DESIGN_LEGACY_UPLOAD_LIMIT_BYTES, Math.floor(softJobTotal / count)));
  }
  return budget;
}

export function isRetryableAssetTooLargeError(error: unknown, sentBytes: number): boolean {
  return error instanceof ProviderError
    && error.errorSource === 'api'
    && error.status === 413
    && error.upstreamCode === 'asset_too_large'
    && sentBytes > OPEN_DESIGN_LEGACY_UPLOAD_LIMIT_BYTES;
}

export type OpenDesignReferenceUploadTransport = {
  uploadAttempt: (prepared: PreparedCloudReference, keySuffix: '' | '-compressed') => Promise<string>;
};

/**
 * Shared probe-then-compress OpenDesign reference uploader used by both 2D media and 3D spatial routes.
 * - Tries original bytes first when within the active budget (auto-upgrades seamlessly when OPEND-5519 ships).
 * - On AMR API HTTP 413 (`asset_too_large`) at either `/uploads` or `/commit` for payloads > 2 MiB,
 *   learns the 2 MiB limit for that origin, compresses the original once to `1_940_000` bytes, and retries
 *   once with distinct `-compressed` create/commit idempotency keys.
 * - Never retries storage PUT errors, non-413 API errors, or already-compressed payloads <= 2 MiB.
 */
export async function uploadOpenDesignReference(input: {
  origin: string;
  bytes: Buffer;
  filename?: string;
  budgetBytes: number;
  knownMaxBytes?: number;
  preserveAlpha?: boolean;
  encoders?: ReferenceEncoderCapabilities;
  transport: OpenDesignReferenceUploadTransport;
}): Promise<{ assetId: string; prepared: PreparedCloudReference; retriedAfter413: boolean }> {
  const learned = getLearnedOpenDesignUploadLimit(input.origin);
  const effectiveBudget = Math.min(
    input.budgetBytes,
    input.knownMaxBytes ?? Infinity,
    learned ?? Infinity,
  );
  const initialTarget = effectiveBudget <= OPEN_DESIGN_LEGACY_UPLOAD_LIMIT_BYTES
    ? OPEN_DESIGN_LEGACY_UPLOAD_TARGET_BYTES
    : Math.floor(effectiveBudget * 0.95);

  const initialPrepared = await prepareCloudReference({
    bytes: input.bytes,
    filename: input.filename,
    maxBytes: effectiveBudget,
    targetBytes: initialTarget,
    preserveAlpha: input.preserveAlpha,
    encoders: input.encoders,
  });

  try {
    const assetId = await input.transport.uploadAttempt(initialPrepared, '');
    return { assetId, prepared: initialPrepared, retriedAfter413: false };
  } catch (error) {
    if (!isRetryableAssetTooLargeError(error, initialPrepared.bytes.length)) {
      if (error instanceof ProviderError && error.errorSource === 'api' && error.status === 413) {
        throw withErrorMeta(
          new ProviderError(
            OPEN_DESIGN_UPLOAD_LIMIT_REJECTED_MESSAGE,
            error.status,
            error.upstreamCode ?? 'asset_too_large',
            'api',
          ),
          { status: error.status, upstreamCode: error.upstreamCode ?? 'asset_too_large', errorSource: 'api' },
        );
      }
      throw error;
    }

    // Learn this origin's 2 MiB legacy cap so remaining references in this job and future jobs compress upfront.
    setLearnedOpenDesignUploadLimit(input.origin, OPEN_DESIGN_LEGACY_UPLOAD_LIMIT_BYTES);

    const compressed = await prepareCloudReference({
      bytes: input.bytes,
      filename: input.filename,
      maxBytes: OPEN_DESIGN_LEGACY_UPLOAD_LIMIT_BYTES,
      targetBytes: OPEN_DESIGN_LEGACY_UPLOAD_TARGET_BYTES,
      preserveAlpha: input.preserveAlpha,
      encoders: input.encoders,
    });

    try {
      const assetId = await input.transport.uploadAttempt(compressed, '-compressed');
      return { assetId, prepared: compressed, retriedAfter413: true };
    } catch (retryError) {
      if (retryError instanceof ProviderError && retryError.errorSource === 'api' && retryError.status === 413) {
        throw withErrorMeta(
          new ProviderError(
            OPEN_DESIGN_UPLOAD_LIMIT_REJECTED_MESSAGE,
            retryError.status,
            retryError.upstreamCode ?? 'asset_too_large',
            'api',
          ),
          { status: retryError.status, upstreamCode: retryError.upstreamCode ?? 'asset_too_large', errorSource: 'api' },
        );
      }
      throw retryError;
    }
  }
}
