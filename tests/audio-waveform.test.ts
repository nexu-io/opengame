import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { probeLibraryMedia } from '../gateway/asset-probe.ts';
import { verificationBinaries } from '../scripts/verify-export.ts';

async function audioFixture(run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'opengame-waveform-'));
  try { await run(directory); }
  finally { await rm(directory, { recursive: true, force: true }); }
}

async function writeWave(directory: string, name: string, seconds: number, audible?: [number, number]) {
  const rate = 4000, samples = seconds * rate;
  const bytes = Buffer.alloc(44 + samples * 2);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 2, 28);
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(samples * 2, 40);
  if (audible) {
    for (let i = audible[0] * rate; i < audible[1] * rate; i++) {
      bytes.writeInt16LE(i % 40 < 20 ? 16384 : -16384, 44 + i * 2);
    }
  }
  const filename = path.join(directory, name);
  await writeFile(filename, bytes);
  return filename;
}

function waveform(media: Awaited<ReturnType<typeof probeLibraryMedia>>) {
  assert.equal(media.modality, 'audio');
  assert.equal(media.waveform?.length, 128);
  assert.ok(media.waveform!.every(value => Number.isInteger(value) && value >= 6 && value <= 96));
  return media.waveform!;
}

test('a long recording retains sound after the former 8 MiB PCM cutoff', () => audioFixture(async directory => {
  const media = await probeLibraryMedia(await writeWave(directory, 'late.wav', 1200, [1100, 1200]));
  assert.equal(media.duration, 1200);
  const bars = waveform(media);
  assert.ok(bars.slice(0, 114).every(value => value === 6));
  assert.ok(bars.slice(120).every(value => value > 90), 'the final 100 seconds must remain audible in the waveform');
}));

test('a long recording keeps an early sound at its full-duration position', () => audioFixture(async directory => {
  const media = await probeLibraryMedia(await writeWave(directory, 'early.wav', 1200, [0, 100]));
  assert.equal(media.duration, 1200);
  const bars = waveform(media);
  assert.ok(bars.slice(0, 9).every(value => value > 90));
  assert.ok(bars.slice(12).every(value => value === 6), 'the sound must not be stretched over a truncated source duration');
}));

test('short audio keeps its silent and audible halves in the same bins', () => audioFixture(async directory => {
  const media = await probeLibraryMedia(await writeWave(directory, 'short.wav', 2, [1, 2]));
  assert.equal(media.duration, 2);
  const bars = waveform(media);
  assert.ok(bars.slice(0, 63).every(value => value === 6));
  assert.ok(bars.slice(65).every(value => value === 96));
}));

test('silent audio remains a bounded flat waveform', () => audioFixture(async directory => {
  const bars = waveform(await probeLibraryMedia(await writeWave(directory, 'silent.wav', 2)));
  assert.deepEqual(bars, Array(128).fill(6));
}));

test('a streamed WebM without container duration retains the bounded fallback', () => audioFixture(async directory => {
  const source = await writeWave(directory, 'stream-source.wav', 2, [0, 2]);
  const result = await promisify(execFile)(verificationBinaries().ffmpeg, [
    '-v', 'error', '-nostdin', '-i', source, '-c:a', 'libopus', '-ar', '48000', '-f', 'webm', 'pipe:1',
  ], { encoding: 'buffer', maxBuffer: 2 * 1024 * 1024, timeout: 30_000 });
  const filename = path.join(directory, 'stream.webm');
  await writeFile(filename, result.stdout);
  const media = await probeLibraryMedia(filename);
  assert.equal(media.duration, undefined);
  assert.ok(waveform(media).some(value => value > 6));
}));
