import { spawn } from 'node:child_process';
import { open, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { execute, pluginRoot } from '../hyperframes.ts';
import { verificationBinaries } from '../scripts/verify-export.ts';
import { requireNativeRuntime } from '../scripts/npm-runtime.mjs';
import { inspectGlb } from '../scripts/game-glb-inspect.mjs';
import { MAX_ASSET_BYTES } from '../shared/asset-limits.ts';
import type { AssetModality } from '../shared/asset-library.ts';

const WAVEFORM_BARS = 128;
const MAX_PCM_BYTES = 8 * 1024 * 1024;

/** Extract a normalized 128-bar audio amplitude envelope (6..96) from decoded mono PCM. */
async function extractAudioWaveform(ffmpeg: string, file: string, streamIndex: number, duration?: number, barCount = WAVEFORM_BARS): Promise<number[] | undefined> {
  try {
    const sampleRate = 4000;
    const expectedSamples = Math.round((duration ?? 0) * sampleRate);
    // Known-duration assets can be reduced directly into timeline bins. Keeping
    // only a PCM prefix would stretch the first 17 minutes over a longer asset.
    // Unknown-duration streams retain the bounded decoding fallback below.
    const bins = Number.isSafeInteger(expectedSamples) && expectedSamples >= barCount
      ? Array.from({ length: barCount }, () => ({ sumSq: 0, peak: 0, count: 0 }))
      : undefined;
    const chunks: Buffer[] = [];
    let total = 0, sampleCount = 0, binIndex = 0;
    let trailingByte: number | undefined;
    await new Promise<void>((resolve, reject) => {
      const child = spawn(ffmpeg, [
        '-v', 'error', '-i', file, '-map', '0:' + streamIndex,
        '-ac', '1', '-ar', String(sampleRate), '-f', 's16le', '-',
      ], { cwd: path.dirname(file), stdio: ['ignore', 'pipe', 'ignore'] });
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) { settled = true; child.kill('SIGKILL'); reject(new Error('waveform timeout')); }
      }, 15_000);
      child.stdout.on('data', (chunk: Buffer) => {
        if (settled) return;
        if (!bins) {
          if (total >= MAX_PCM_BYTES) return;
          const remaining = MAX_PCM_BYTES - total;
          chunks.push(chunk.length > remaining ? chunk.subarray(0, remaining) : chunk);
          total += Math.min(chunk.length, remaining);
          return;
        }
        // Pipe chunks need not end on a 16-bit sample boundary.
        if (trailingByte !== undefined) {
          chunk = Buffer.concat([Buffer.from([trailingByte]), chunk]);
          trailingByte = undefined;
        }
        const length = chunk.length - (chunk.length % 2);
        if (length < chunk.length) trailingByte = chunk[length];
        for (let offset = 0; offset < length; offset += 2) {
          while (binIndex < barCount - 1 && sampleCount >= Math.floor(((binIndex + 1) * expectedSamples) / barCount)) binIndex++;
          const sample = Math.abs(chunk.readInt16LE(offset)) / 32768;
          const bin = bins[binIndex];
          bin.sumSq += sample * sample;
          bin.peak = Math.max(bin.peak, sample);
          bin.count++;
          sampleCount++;
        }
      });
      child.once('error', error => { clearTimeout(timer); if (!settled) { settled = true; reject(error); } });
      child.once('close', code => {
        clearTimeout(timer);
        if (settled) return;
        settled = true;
        if (code !== 0 || (bins ? sampleCount < 2 : total < 4)) reject(new Error('waveform empty'));
        else resolve();
      });
    });
    const pcm = bins ? undefined : Buffer.concat(chunks, total);
    const raw: number[] = [];
    if (bins) {
      for (const bin of bins) raw.push((bin.count ? Math.sqrt(bin.sumSq / bin.count) : 0) * 0.7 + bin.peak * 0.3);
    } else {
      const count = Math.floor(pcm!.length / 2);
      for (let i = 0; i < barCount; i++) {
        const start = Math.floor((i * count) / barCount);
        const end = Math.max(start + 1, Math.floor(((i + 1) * count) / barCount));
        let sumSq = 0, peak = 0;
        for (let j = start; j < end && j < count; j++) {
          const sample = Math.abs(pcm!.readInt16LE(j * 2)) / 32768;
          sumSq += sample * sample;
          if (sample > peak) peak = sample;
        }
        raw.push(Math.sqrt(sumSq / Math.max(1, end - start)) * 0.7 + peak * 0.3);
      }
    }
    const maxVal = Math.max(...raw, 0.001);
    const normalized = raw.map(v => {
      const ratio = v / maxVal;
      return ratio < 0.045 ? 0 : Math.pow((ratio - 0.045) / 0.955, 0.88);
    });
    // Light 3-tap smoothing gives speech envelopes organic continuity without losing transients.
    return normalized.map((v, i) => {
      const prev = i > 0 ? normalized[i - 1] : v;
      const next = i < normalized.length - 1 ? normalized[i + 1] : v;
      const smooth = prev * 0.16 + v * 0.68 + next * 0.16;
      return Math.max(6, Math.min(96, Math.round(6 + smooth * 90)));
    });
  } catch {
    return undefined;
  }
}

/** Check local saving prerequisites before a generation can incur model usage. */
export async function requireLibraryMediaRuntime() {
  await requireNativeRuntime(pluginRoot, 'media');
  const binaries = verificationBinaries();
  for (const [name, binary] of Object.entries(binaries)) {
    try {
      const result = await execute(binary, ['-version'], pluginRoot, 5000);
      if (result.code) throw new Error('Media tool failed to start');
    } catch {
      throw new Error(`ASSET_MEDIA_RUNTIME_NOT_READY: ${name} is unavailable. Prepare this installation's media components, or configure HYPERFRAMES_FFMPEG_PATH and HYPERFRAMES_FFPROBE_PATH for a source checkout, then restart the service. No model request was made by this check.`);
    }
  }
  return binaries;
}

async function isGlbHeader(file: string, size: number): Promise<boolean> {
  if (size < 20) return false;
  const handle = await open(file, 'r');
  try {
    const header = Buffer.alloc(12);
    const { bytesRead } = await handle.read(header, 0, 12, 0);
    return bytesRead === 12
      && header.toString('ascii', 0, 4) === 'glTF'
      && header.readUInt32LE(4) === 2
      && header.readUInt32LE(8) === size;
  } finally {
    await handle.close();
  }
}

/** Inspect and decode local media before accepting it into the reusable library. */
export async function probeLibraryMedia(file: string): Promise<{
  modality: AssetModality;
  mimeType: string;
  extension: string;
  bytes: number;
  width?: number;
  height?: number;
  duration?: number;
  waveform?: number[];
  result?: Record<string, unknown>;
}> {
  const info = await stat(file);
  if (!info.isFile() || !info.size || info.size > MAX_ASSET_BYTES) throw new Error('Asset must be a file of at most 500 MB');
  if (await isGlbHeader(file, info.size)) {
    const glbBytes = await readFile(file);
    let glb: Record<string, unknown>;
    try {
      glb = inspectGlb(glbBytes) as Record<string, unknown>;
    } catch (error) {
      throw new Error(`Invalid GLB 2 model: ${(error as Error).message}`);
    }
    return {
      modality: '3d',
      mimeType: 'model/gltf-binary',
      extension: 'glb',
      bytes: info.size,
      result: { glb },
    };
  }
  await requireNativeRuntime(pluginRoot, 'media');
  const binaries = verificationBinaries();
  const result = await execute(binaries.ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], path.dirname(file), 60_000);
  if (result.code) throw new Error('This file is not readable image, video, audio or GLB 3D media');
  const media = JSON.parse(result.stdout);
  const stream = media.streams?.find((s: any) => s.codec_type === 'video' && !s.disposition?.attached_pic) ?? media.streams?.find((s: any) => s.codec_type === 'audio');
  if (!stream) throw new Error('Unsupported media type');
  const images: Record<string, [string, string]> = { png: ['image/png', 'png'], mjpeg: ['image/jpeg', 'jpg'], webp: ['image/webp', 'webp'], gif: ['image/gif', 'gif'], av1: ['image/avif', 'avif'] };
  const format = String(media.format?.format_name ?? '');
  // ffprobe reads AVIF through the ISO base media demuxer, so only the brand tells it from MP4.
  const avif = format.includes('mov') && /^avi[fs]$/.test(String(media.format?.tags?.major_brand ?? '').trim());
  const image = avif || /image2|_pipe|^gif$/.test(format) ? images[stream.codec_name] : undefined;
  const kind = image ?? (stream.codec_type === 'video' && format.includes('mov') ? ['video/mp4', 'mp4']
    : stream.codec_type === 'video' && /webm|matroska/.test(format) ? ['video/webm', 'webm']
    : stream.codec_type === 'audio' ? ({ wav: ['audio/wav', 'wav'], mp3: ['audio/mpeg', 'mp3'], ogg: ['audio/ogg', 'ogg'], flac: ['audio/flac', 'flac'], aac: ['audio/aac', 'aac'] } as Record<string, string[]>)[format]
      ?? (format.includes('mov') ? ['audio/mp4', 'm4a'] : /webm|matroska/.test(format) ? ['audio/webm', 'webm'] : undefined) : undefined);
  if (!kind || stream.codec_type === 'video' && !(stream.width > 0 && stream.height > 0)) throw new Error('Unsupported media type');
  const decoded = await execute(binaries.ffmpeg, ['-v', 'error', '-xerror', '-err_detect', 'explode', '-i', file, '-map', `0:${stream.index}`, stream.codec_type === 'video' ? '-frames:v' : '-frames:a', '1', '-f', 'null', '-'], path.dirname(file), 60_000);
  if (decoded.code) throw new Error('The media file could not be decoded');
  const waveform = stream.codec_type === 'audio' ? await extractAudioWaveform(binaries.ffmpeg, file, stream.index, Number(media.format?.duration)) : undefined;
  // Phone footage is stored sideways with a display matrix; players and ffmpeg turn it, so report the size it plays at.
  const turned = Math.abs(Number(stream.side_data_list?.find((data: any) => data.rotation !== undefined)?.rotation ?? 0)) % 180 === 90;
  return { modality: kind[0].split('/')[0] as AssetModality, mimeType: kind[0], extension: kind[1], bytes: info.size,
    ...(stream.width ? { width: turned ? stream.height : stream.width, height: turned ? stream.width : stream.height } : {}),
    ...(!image && Number(media.format?.duration) > 0 ? { duration: Number(media.format.duration) } : {}),
    ...(waveform ? { waveform } : {}) };
}
