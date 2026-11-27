import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { probeLibraryMedia } from '../gateway/asset-probe.ts';
import { inspectGlb } from '../scripts/game-glb-inspect.mjs';

// Two translation keys at 0 and 2 seconds. The compressed input was encoded and
// round-trip checked with meshoptimizer (ATTRIBUTES, count=2, stride=4, version=0).
const times = Buffer.from(new Float32Array([0, 2]).buffer);
const translations = Buffer.from(new Float32Array([0, 0, 0, 2, 0, 0]).buffer);
const compressedTimes = Buffer.from('a00000000130000000800000000000000000000000000000000000000000000000000000000000000000', 'hex');

function pack(doc: any, binary: Buffer) {
  const json = Buffer.from(JSON.stringify(doc));
  const jsonPadding = Buffer.alloc((4 - json.length % 4) % 4, 0x20);
  const header = Buffer.alloc(12), jsonHeader = Buffer.alloc(8), binaryHeader = Buffer.alloc(8);
  header.write('glTF'); header.writeUInt32LE(2, 4);
  header.writeUInt32LE(28 + json.length + jsonPadding.length + binary.length, 8);
  jsonHeader.writeUInt32LE(json.length + jsonPadding.length); jsonHeader.writeUInt32LE(0x4e4f534a, 4);
  binaryHeader.writeUInt32LE(binary.length); binaryHeader.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, jsonHeader, json, jsonPadding, binaryHeader, binary]);
}

function fixture(kind: 'dense' | 'sparse' | 'EXT_meshopt_compression' | 'KHR_meshopt_compression') {
  let input: any = { componentType: 5126, count: 2, type: 'SCALAR', min: [0], max: [2] };
  let binary: Buffer, bufferViews: any[], outputView: number;
  if (kind === 'sparse') {
    // The absent base view initializes [0, 0]; the sparse override sets key 1 to 2.
    binary = Buffer.concat([Buffer.from([1, 0, 0, 0]), times.subarray(4), translations]);
    bufferViews = [{ buffer: 0, byteOffset: 0, byteLength: 1 }, { buffer: 0, byteOffset: 4, byteLength: 4 }, { buffer: 0, byteOffset: 8, byteLength: translations.length }];
    input.sparse = { count: 1, indices: { bufferView: 0, componentType: 5121 }, values: { bufferView: 1 } };
    outputView = 2;
  } else if (kind === 'dense') {
    binary = Buffer.concat([times, translations]);
    bufferViews = [{ buffer: 0, byteOffset: 0, byteLength: times.length }, { buffer: 0, byteOffset: times.length, byteLength: translations.length }];
    input.bufferView = 0; outputView = 1;
  } else {
    const padding = Buffer.alloc((4 - compressedTimes.length % 4) % 4);
    binary = Buffer.concat([compressedTimes, padding, translations]);
    bufferViews = [
      { buffer: 1, byteOffset: 0, byteLength: times.length, extensions: {
        [kind]: { buffer: 0, byteOffset: 0, byteLength: compressedTimes.length, byteStride: 4, count: 2, mode: 'ATTRIBUTES' },
      } },
      { buffer: 0, byteOffset: compressedTimes.length + padding.length, byteLength: translations.length },
    ];
    input.bufferView = 0; outputView = 1;
  }
  const doc: any = {
    asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ name: 'AnimatedNode' }],
    buffers: [{ byteLength: binary.length }], bufferViews,
    accessors: [input, { bufferView: outputView, componentType: 5126, count: 2, type: 'VEC3' }],
    animations: [{ name: 'translate', samplers: [{ input: 0, output: 1 }], channels: [{ sampler: 0, target: { node: 0, path: 'translation' } }] }],
  };
  if (kind !== 'dense' && kind !== 'sparse') {
    doc.extensionsUsed = [kind]; doc.extensionsRequired = [kind];
    doc.buffers.push({ byteLength: times.length, extensions: { [kind]: { fallback: true } } });
  }
  return { doc, binary, bytes: pack(doc, binary) };
}

for (const kind of ['sparse', 'EXT_meshopt_compression', 'KHR_meshopt_compression'] as const) {
  test(`animation duration supports ${kind} input storage`, () => {
    assert.deepEqual(inspectGlb(fixture(kind).bytes).animations, [{ name: 'translate', duration: 2 }]);
  });
}

test('the library probe accepts valid sparse and compressed animated GLBs', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'glb-animation-bounds-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const kind of ['sparse', 'EXT_meshopt_compression'] as const) {
    const source = fixture(kind).bytes, filename = path.join(directory, kind + '.glb');
    await writeFile(filename, source);
    const result = await probeLibraryMedia(filename);
    assert.equal(result.modality, '3d');
    assert.equal(result.mimeType, 'model/gltf-binary');
    assert.equal(result.bytes, source.length);
    assert.deepEqual((result.result!.glb as any).animations, [{ name: 'translate', duration: 2 }]);
  }
});

test('ordinary embedded timelines retain their byte-based inspection', () => {
  const { doc, binary } = fixture('dense');
  assert.deepEqual(inspectGlb(pack(doc, binary)).animations, [{ name: 'translate', duration: 2 }]);
  delete doc.accessors[0].min; delete doc.accessors[0].max;
  assert.deepEqual(inspectGlb(pack(doc, binary)).animations, [{ name: 'translate', duration: 2 }]);
});

test('declared bounds do not hide truncated ordinary animation input', () => {
  const { doc, binary } = fixture('dense');
  doc.bufferViews[0].byteLength = 4;
  assert.throws(() => inspectGlb(pack(doc, binary)), /Truncated animation accessor/);
});

test('metadata bounds use the float32 precision of animation inputs', () => {
  const { doc, binary } = fixture('sparse');
  doc.accessors[0].max = [2.0000001];
  assert.deepEqual(inspectGlb(pack(doc, binary)).animations, [{ name: 'translate', duration: 2 }]);
});

test('unreadable timeline storage still requires valid scalar time bounds', () => {
  for (const change of [{ min: undefined }, { min: [] }, { min: ['0'] }, { min: [-1] }, { min: [3] }, { max: [null] }, { max: [2, 3] }, { max: [1e40] }]) {
    const { doc, binary } = fixture('sparse');
    Object.assign(doc.accessors[0], change);
    assert.throws(() => inspectGlb(pack(doc, binary)), /Unsupported animation time accessor/);
  }
  const { doc, binary } = fixture('sparse');
  doc.accessors[0].type = 'VEC3';
  assert.throws(() => inspectGlb(pack(doc, binary)), /Unsupported animation time accessor/);
});
