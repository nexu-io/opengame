import assert from 'node:assert/strict';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { crc32, deflateSync } from 'node:zlib';
import { optimizeGlbTexturesForPublish } from '../gateway/glb-optimize.ts';

// Three float32 positions encoded with meshoptimizer.encodeGltfBuffer using
// ATTRIBUTES, count=3, stride=12, version=0. Also valid for the KHR extension.
const positions = Buffer.from(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]).buffer);
const compressed = Buffer.from('a00000013c000000ffff013c0000007e7d0000010c000000ff010c0000007e000000000000000000000000000000000000000000000000000000000000000000000000', 'hex');
// Lossless 1x1 red WebP generated locally for the controlled encoder.
const webp = Buffer.from('UklGRhwAAABXRUJQVlA4TA8AAAAvAAAAAAcQ/Y/+ByKi/wEA', 'base64');

function pngChunk(type: string, data: Buffer) {
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length); chunk.write(type, 4); data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, 8 + data.length)), 8 + data.length);
  return chunk;
}
function redPng() {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(1); ihdr.writeUInt32BE(1, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', ihdr),
    pngChunk('tEXt', Buffer.from('Comment\0' + 'a'.repeat(40 * 1024))),
    pngChunk('IDAT', deflateSync(Buffer.from([0, 255, 0, 0]))), pngChunk('IEND', Buffer.alloc(0)),
  ]);
}
function pack(doc: any, binary: Buffer) {
  const json = Buffer.from(JSON.stringify(doc)), jsonPad = Buffer.alloc((4 - json.length % 4) % 4, 32);
  const header = Buffer.alloc(12), jsonHeader = Buffer.alloc(8), binHeader = Buffer.alloc(8);
  header.write('glTF'); header.writeUInt32LE(2, 4); header.writeUInt32LE(28 + json.length + jsonPad.length + binary.length, 8);
  jsonHeader.writeUInt32LE(json.length + jsonPad.length); jsonHeader.writeUInt32LE(0x4e4f534a, 4);
  binHeader.writeUInt32LE(binary.length); binHeader.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, jsonHeader, json, jsonPad, binHeader, binary]);
}
function unpack(bytes: Buffer) {
  const jsonLength = bytes.readUInt32LE(12);
  return { doc: JSON.parse(bytes.subarray(20, 20 + jsonLength).toString()), binary: bytes.subarray(28 + jsonLength) };
}
function fixture(extension?: string, shared = false) {
  const image = redPng(), raw = shared ? Buffer.concat([positions, positions]) : positions;
  const padding = Buffer.alloc((4 - image.length % 4) % 4);
  const compressedOffset = raw.length + image.length + padding.length;
  const binary = Buffer.concat([raw, image, padding, compressed, Buffer.alloc((4 - compressed.length % 4) % 4)]);
  const ext = { buffer: 0, byteOffset: compressedOffset, byteLength: compressed.length, byteStride: 12, count: 3, mode: 'ATTRIBUTES' };
  const geometryView = (byteOffset: number) => ({ buffer: 0, byteOffset, byteLength: positions.length, byteStride: 12, ...(extension ? { extensions: { [extension]: { ...ext } } } : {}) });
  const doc: any = {
    asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }],
    accessors: [{ bufferView: 0, componentType: 5126, type: 'VEC3', count: 3, min: [0, 0, 0], max: [1, 1, 0] }],
    buffers: [{ byteLength: binary.length }],
    bufferViews: [geometryView(0), { buffer: 0, byteOffset: raw.length, byteLength: image.length }, ...(shared ? [geometryView(positions.length)] : [])],
    images: [{ bufferView: 1, mimeType: 'image/png' }], textures: [{ source: 0 }],
    materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }],
    ...(extension ? { extensionsUsed: [extension] } : {}),
  };
  return { bytes: pack(doc, binary), doc, binary };
}
async function encoder(t: TestContext) {
  const directory = await mkdtemp(path.join(tmpdir(), 'meshopt-publish-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filename = path.join(directory, 'encoder');
  // The image fixtures are both 1x1 red. Only the binary repacking is under
  // test; use a deterministic successful encoder without native dependencies.
  await writeFile(filename, `#!${process.execPath}\nconst args = process.argv.slice(2); require('node:fs').writeFileSync(args[args.indexOf('-o') + 1], Buffer.from(${JSON.stringify(webp.toString('base64'))}, 'base64'));\n`);
  await chmod(filename, 0o700);
  const previous = process.env.CWEBP_PATH; process.env.CWEBP_PATH = filename;
  t.after(() => { if (previous === undefined) delete process.env.CWEBP_PATH; else process.env.CWEBP_PATH = previous; });
}

for (const extension of ['EXT_meshopt_compression', 'KHR_meshopt_compression']) {
  test(`texture optimization preserves ${extension} data outside ordinary buffer views`, { skip: process.platform === 'win32' }, async t => {
    await encoder(t);
    const original = fixture(extension);
    const result = await optimizeGlbTexturesForPublish(original.bytes);
    assert.equal(result.optimized, true);
    assert.ok(result.data.length < original.bytes.length / 2);
    const { doc, binary } = unpack(result.data);
    const ref = doc.bufferViews[0].extensions[extension];
    assert.deepEqual(binary.subarray(ref.byteOffset, ref.byteOffset + ref.byteLength), compressed);
    assert.deepEqual(binary.subarray(doc.bufferViews[0].byteOffset, doc.bufferViews[0].byteOffset + positions.length), positions);
    assert.deepEqual({ ...ref, byteOffset: 0 }, { ...original.doc.bufferViews[0].extensions[extension], byteOffset: 0 });
  });
}

test('shared meshopt payloads retain one relocated range', { skip: process.platform === 'win32' }, async t => {
  await encoder(t);
  const result = await optimizeGlbTexturesForPublish(fixture('EXT_meshopt_compression', true).bytes);
  assert.equal(result.optimized, true);
  const { doc, binary } = unpack(result.data);
  const first = doc.bufferViews[0].extensions.EXT_meshopt_compression, second = doc.bufferViews[2].extensions.EXT_meshopt_compression;
  assert.equal(first.byteOffset, second.byteOffset);
  assert.deepEqual(binary.subarray(first.byteOffset, first.byteOffset + first.byteLength), compressed);
});

test('a meshopt payload already retained by an ordinary view is reused', { skip: process.platform === 'win32' }, async t => {
  await encoder(t);
  const { doc, binary } = fixture('EXT_meshopt_compression');
  const ref = doc.bufferViews[0].extensions.EXT_meshopt_compression;
  doc.bufferViews.push({ buffer: 0, byteOffset: ref.byteOffset, byteLength: ref.byteLength });
  const result = await optimizeGlbTexturesForPublish(pack(doc, binary));
  assert.equal(result.optimized, true);
  const output = unpack(result.data);
  const relocated = output.doc.bufferViews[0].extensions.EXT_meshopt_compression;
  assert.equal(relocated.byteOffset, output.doc.bufferViews[2].byteOffset);
  assert.deepEqual(output.binary.subarray(relocated.byteOffset, relocated.byteOffset + relocated.byteLength), compressed);
});

test('an omitted meshopt byteOffset retains the payload at offset zero', { skip: process.platform === 'win32' }, async t => {
  await encoder(t);
  const original = fixture('EXT_meshopt_compression');
  const prefix = Buffer.concat([compressed, Buffer.alloc((4 - compressed.length % 4) % 4)]);
  const binary = Buffer.concat([prefix, original.binary]);
  for (const view of original.doc.bufferViews) view.byteOffset += prefix.length;
  delete original.doc.bufferViews[0].extensions.EXT_meshopt_compression.byteOffset;
  original.doc.buffers[0].byteLength = binary.length;
  const result = await optimizeGlbTexturesForPublish(pack(original.doc, binary));
  assert.equal(result.optimized, true);
  const output = unpack(result.data), ref = output.doc.bufferViews[0].extensions.EXT_meshopt_compression;
  assert.deepEqual(output.binary.subarray(ref.byteOffset, ref.byteOffset + ref.byteLength), compressed);
});

test('meshopt references into an external buffer retain their identity', { skip: process.platform === 'win32' }, async t => {
  await encoder(t);
  const { doc, binary } = fixture('KHR_meshopt_compression');
  doc.buffers.push({ byteLength: compressed.length, uri: 'data:application/octet-stream;base64,' + compressed.toString('base64') });
  const ref = doc.bufferViews[0].extensions.KHR_meshopt_compression;
  ref.buffer = 1; ref.byteOffset = 0;
  const result = await optimizeGlbTexturesForPublish(pack(doc, binary));
  assert.equal(result.optimized, true);
  const output = unpack(result.data);
  assert.deepEqual(output.doc.bufferViews[0].extensions.KHR_meshopt_compression, ref);
  assert.deepEqual(output.doc.buffers[1], doc.buffers[1]);
});

test('an invalid meshopt range keeps the original GLB unchanged', { skip: process.platform === 'win32' }, async t => {
  await encoder(t);
  for (const invalid of [{ byteOffset: -1 }, { byteOffset: 0.5 }, { byteOffset: 1e6 }, { byteLength: -1 }, { byteLength: 0.5 }, { byteLength: 1e6 }]) {
    const { doc, binary } = fixture('EXT_meshopt_compression');
    Object.assign(doc.bufferViews[0].extensions.EXT_meshopt_compression, invalid);
    const original = pack(doc, binary), result = await optimizeGlbTexturesForPublish(original);
    assert.equal(result.optimized, false, JSON.stringify(invalid));
    assert.deepEqual(result.data, original);
  }
});

test('ordinary embedded textures still optimize without geometry changes', { skip: process.platform === 'win32' }, async t => {
  await encoder(t);
  const result = await optimizeGlbTexturesForPublish(fixture().bytes);
  assert.equal(result.optimized, true);
  const { doc, binary } = unpack(result.data);
  assert.deepEqual(binary.subarray(doc.bufferViews[0].byteOffset, doc.bufferViews[0].byteOffset + positions.length), positions);
  assert.equal(doc.images[0].mimeType, 'image/webp');
});

for (const relation of ['nested', 'overlapping']) {
  test(`repacking ${relation} meshopt ranges does not allocate an expanded BIN`, { skip: process.platform === 'win32' }, async t => {
    await encoder(t);
    const { doc, binary } = fixture('EXT_meshopt_compression', true);
    const first = doc.bufferViews[0].extensions.EXT_meshopt_compression;
    const second = doc.bufferViews[2].extensions.EXT_meshopt_compression;
    // These untrusted spans are individually in bounds. Duplicating their
    // overlap would inflate the repack before the final savings check rejects it.
    if (relation === 'nested') {
      first.byteOffset = 0; first.byteLength = binary.length;
      second.byteOffset = 4; second.byteLength = binary.length - 8;
    } else {
      const quarter = Math.floor(binary.length / 4);
      first.byteOffset = 0; first.byteLength = binary.length - quarter;
      second.byteOffset = quarter; second.byteLength = binary.length - quarter;
    }
    const original = pack(doc, binary);
    const concat = Buffer.concat, allocations: number[] = [];
    t.mock.method(Buffer, 'concat', (parts: readonly Uint8Array[], length?: number) => {
      if (length !== undefined) allocations.push(length);
      return concat(parts, length);
    });
    const result = await optimizeGlbTexturesForPublish(original);
    assert.equal(result.optimized, false);
    assert.equal(result.data, original);
    assert.ok(allocations.every(length => length <= binary.length), `Repack requested ${Math.max(...allocations)} bytes for a ${binary.length}-byte BIN`);
  });
}

for (const extension of ['EXT_meshopt_compression', 'KHR_meshopt_compression']) {
  test(`an invalid ${extension} buffer index keeps the original GLB unchanged`, { skip: process.platform === 'win32' }, async t => {
    await encoder(t);
    for (const buffer of [undefined, null, '0', '1', -1, 0.5, 1, Number.MAX_SAFE_INTEGER + 1]) {
      const { doc, binary } = fixture(extension);
      doc.bufferViews[0].extensions[extension].buffer = buffer;
      const original = pack(doc, binary);
      const result = await optimizeGlbTexturesForPublish(original);
      assert.equal(result.optimized, false, `buffer=${String(buffer)}`);
      assert.equal(result.data, original);
      assert.equal(result.convertedImages, 0);
      assert.equal(result.savedBytes, 0);
    }
  });
}
