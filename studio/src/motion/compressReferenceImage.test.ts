// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OPEN_DESIGN_MAX_REFERENCE_BYTES, prepareReferenceImage, ReferenceImageError } from './compressReferenceImage';

function makeFile(bytes: number, name: string, type: string): File {
  const file = new File(['x'], name, { type });
  Object.defineProperty(file, 'size', { value: bytes, configurable: true });
  return file;
}

describe('prepareReferenceImage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('passes through supported PNG/JPEG/WebP files up to 30 MiB (including 2K generated PNGs) untouched', async () => {
    const file = makeFile(5 * 1024 * 1024, 'gpt-image-2-2k.png', 'image/png');
    const result = await prepareReferenceImage(file);
    expect(result.compressed).toBe(false);
    expect(result.file).toBe(file);
  });

  it('compresses >30 MiB reference images below 30 MiB and rewrites the extension to match the encoded MIME', async () => {
    const close = vi.fn();
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 4800, height: 3200, close })));
    const drawImage = vi.fn();
    const clearRect = vi.fn();
    const toBlob = vi.fn((cb: BlobCallback, mimeType?: string, quality?: number) => {
      const size = quality && quality <= 0.76 ? 850_000 : OPEN_DESIGN_MAX_REFERENCE_BYTES + 200_000;
      const blob = new Blob(['x'], { type: mimeType ?? 'image/webp' });
      Object.defineProperty(blob, 'size', { value: size, configurable: true });
      cb(blob);
    });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ clearRect, drawImage } as never);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(toBlob as never);

    const oversized = makeFile(OPEN_DESIGN_MAX_REFERENCE_BYTES + 500_000, 'raw-scan.png', 'image/png');
    const result = await prepareReferenceImage(oversized);

    expect(result.compressed).toBe(true);
    expect(result.file.size).toBeLessThanOrEqual(OPEN_DESIGN_MAX_REFERENCE_BYTES);
    expect(result.file.type).toBe('image/webp');
    expect(result.file.name).toBe('raw-scan.webp');
    expect(drawImage).toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('never falls through to JPEG for potentially transparent PNG/WebP inputs', async () => {
    const close = vi.fn();
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 3200, height: 2400, close })));
    const attemptedMimes: string[] = [];
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      clearRect: vi.fn(),
      drawImage: vi.fn(),
    } as never);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(((cb: BlobCallback, mimeType?: string) => {
      attemptedMimes.push(mimeType ?? '');
      // Force WebP & PNG above budget to verify JPEG is never tried for a PNG input.
      const blob = new Blob(['x'], { type: mimeType ?? 'image/png' });
      Object.defineProperty(blob, 'size', { value: OPEN_DESIGN_MAX_REFERENCE_BYTES + 10_000, configurable: true });
      cb(blob);
    }) as never);

    const oversizedPng = makeFile(OPEN_DESIGN_MAX_REFERENCE_BYTES + 1024, 'cutout.png', 'image/png');
    await expect(prepareReferenceImage(oversizedPng)).rejects.toMatchObject({
      code: 'too-large',
      message: 'The reference image is larger than the 30 MiB OpenDesign limit.',
    });
    expect(attemptedMimes).not.toContain('image/jpeg');
  });

  it('throws ReferenceImageError when an oversized image cannot be decoded or reduced under 30 MiB', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => { throw new Error('decode failed'); }));
    vi.stubGlobal('Image', undefined);

    const huge = makeFile(OPEN_DESIGN_MAX_REFERENCE_BYTES + 1024, 'huge.png', 'image/png');
    await expect(prepareReferenceImage(huge)).rejects.toBeInstanceOf(ReferenceImageError);
    await expect(prepareReferenceImage(huge)).rejects.toMatchObject({
      code: 'too-large',
      message: 'The reference image is larger than the 30 MiB OpenDesign limit.',
    });
  });

  it('converts unsupported image formats like BMP into WebP when decodable', async () => {
    const close = vi.fn();
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 640, height: 480, close })));
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      clearRect: vi.fn(),
      drawImage: vi.fn(),
    } as never);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(((cb: BlobCallback, mimeType?: string) => {
      cb(new Blob([new Uint8Array(12_000)], { type: mimeType ?? 'image/webp' }));
    }) as never);

    const bmp = makeFile(80_000, 'sketch.bmp', 'image/bmp');
    const result = await prepareReferenceImage(bmp);

    expect(result.compressed).toBe(true);
    expect(result.file.type).toBe('image/webp');
    expect(result.file.name).toBe('sketch.webp');
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('throws ReferenceImageError(unsupported) for unsupported formats that cannot be decoded', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => { throw new Error('HEIC unsupported'); }));
    vi.stubGlobal('Image', undefined);

    const heic = makeFile(300_000, 'iphone.heic', 'image/heic');
    await expect(prepareReferenceImage(heic)).rejects.toBeInstanceOf(ReferenceImageError);
    await expect(prepareReferenceImage(heic)).rejects.toMatchObject({
      code: 'unsupported',
      message: 'OpenDesign does not accept this reference image format.',
    });
  });
});
