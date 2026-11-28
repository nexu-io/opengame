import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadModelPreviewSource, offlineMessage } from './modelPreviewSource';

const origin = 'http://localhost:4173';
const asset = '/motion-api/assets/knight/versions/v1/file';
const load = (src = asset) => loadModelPreviewSource(src, new AbortController().signal);

function glb(json: unknown, extraChunk = false) {
  const jsonBytes = Buffer.from(JSON.stringify(json));
  const length = Math.ceil(jsonBytes.length / 4) * 4;
  const file = Buffer.alloc(20 + length + (extraChunk ? 8 : 0), 32);
  [0x46546c67, 2, file.length, length, 0x4e4f534a].forEach((n, i) => file.writeUInt32LE(n, i * 4));
  jsonBytes.copy(file, 20);
  if (extraChunk) {
    file.writeUInt32LE(0, 20 + length);
    file.writeUInt32LE(0x4e4f534a, 24 + length);
  }
  return file;
}

describe('local model preview sources', () => {
  beforeEach(() => {
    vi.stubGlobal('document', { baseURI: origin });
    vi.stubGlobal('location', new URL(origin));
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => vi.unstubAllGlobals());

  it.each(['https://example.com/model.glb', 'blob:http://localhost:4173/id', '/motion-api/settings', '/motion-api/super-agent/file-content?path=knight.glb'])('rejects %s before fetching', async url => {
    await expect(load(url)).rejects.toThrow('Preview unavailable');
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([{ buffers: [{ uri: '/private.bin' }] }, { images: [{ uri: 'https://example.com/map.webp' }] }, { images: [{ mimeType: 'image/svg+xml', bufferView: 0 }] }])('rejects external and unsupported embedded resources', async json => {
    vi.mocked(fetch).mockResolvedValue(new Response(glb(json)));
    await expect(load()).rejects.toThrow(offlineMessage);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('rejects an additional JSON chunk after the inspected metadata', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(glb({}, true)));
    await expect(load()).rejects.toThrow('Preview unavailable');
  });

  it('keeps embedded WebP and Meshopt local and disables HTTP redirects', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(glb({ extensionsUsed: ['EXT_meshopt_compression', 'EXT_texture_webp'], images: [{ bufferView: 0, mimeType: 'image/webp' }] })));
    const source = await load();
    try {
      expect(source.meshopt).toBe(true);
      expect(source.objectUrl).toMatch(/^blob:/);
      expect(fetch).toHaveBeenCalledWith(new URL(asset, origin), expect.objectContaining({ redirect: 'error' }));
    } finally {
      URL.revokeObjectURL(source.objectUrl);
    }
  });
});
