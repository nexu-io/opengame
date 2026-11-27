import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

/** GLB 2 inspector; no engine, network or third-party dependencies. */
export function inspectGlb(bytes) {
  if (bytes.length < 20 || bytes.toString('ascii', 0, 4) !== 'glTF' || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length) throw Error('Invalid GLB 2 header');
  let doc, binary;
  for (let offset = 12; offset < bytes.length;) {
    if (offset + 8 > bytes.length) throw Error('Truncated GLB chunk');
    const length = bytes.readUInt32LE(offset), type = bytes.readUInt32LE(offset + 4);
    if (length % 4 || offset + 8 + length > bytes.length) throw Error('Invalid GLB chunk length');
    const chunk = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === 0x4e4f534a) doc = JSON.parse(chunk.toString('utf8').trim());
    if (type === 0x004e4942) binary = chunk;
    offset += 8 + length;
  }
  if (!doc) throw Error('Missing GLB JSON chunk');
  function times(index) {
    const accessor = doc.accessors[index];
    if (accessor.componentType !== 5126 || accessor.type !== 'SCALAR') throw Error('Unsupported animation time accessor');
    const view = doc.bufferViews?.[accessor.bufferView];
    if (accessor.sparse || !binary || !view || view.buffer !== 0) {
      // Animation input bounds are required by glTF and include sparse changes.
      // They also describe compressed timelines without decoding their storage.
      if ([accessor.min, accessor.max].every(bound => Array.isArray(bound) && bound.length === 1 && Number.isFinite(bound[0]))) {
        const first = Math.fround(accessor.min[0]), last = Math.fround(accessor.max[0]);
        if (Number.isFinite(first) && Number.isFinite(last) && first >= 0 && last >= first) return [first, last];
      }
      if (accessor.sparse || !view) throw Error('Unsupported animation time accessor');
      throw Error('Animation requires an embedded buffer');
    }
    const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0), stride = view.byteStride ?? 4;
    const result = [];
    for (let i = 0; i < accessor.count; i++) {
      const offset = start + i * stride;
      if (offset + 4 > binary.length || offset + 4 > (view.byteOffset ?? 0) + view.byteLength) throw Error('Truncated animation accessor');
      result.push(binary.readFloatLE(offset));
    }
    return result;
  }

  const meshes = (doc.meshes ?? []).map((mesh, i) => ({
    name: mesh.name ?? `mesh-${i}`,
    triangles: (mesh.primitives ?? []).reduce((sum, p) => {
      const accessor = doc.accessors?.[p.indices ?? p.attributes?.POSITION];
      if (!accessor) return sum;
      const n = accessor.count, mode = p.mode ?? 4;
      return sum + (mode === 4 ? Math.floor(n / 3) : mode === 5 || mode === 6 ? Math.max(0, n - 2) : 0);
    }, 0),
  }));

  // Aggregate mesh-space bounds from POSITION accessors so agents can verify scale & grounding (minY ≈ 0).
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const mesh of doc.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) {
      const posIndex = primitive.attributes?.POSITION;
      if (posIndex === undefined) continue;
      const accessor = doc.accessors?.[posIndex];
      if (!accessor || accessor.type !== 'VEC3') continue;
      if (Array.isArray(accessor.min) && accessor.min.length === 3 && Array.isArray(accessor.max) && accessor.max.length === 3
        && accessor.min.every(Number.isFinite) && accessor.max.every(Number.isFinite)) {
        for (let axis = 0; axis < 3; axis++) {
          if (accessor.min[axis] < min[axis]) min[axis] = accessor.min[axis];
          if (accessor.max[axis] > max[axis]) max[axis] = accessor.max[axis];
        }
      } else if (accessor.componentType === 5126 && !accessor.sparse && accessor.bufferView !== undefined && binary) {
        const view = doc.bufferViews?.[accessor.bufferView];
        if (view && (view.buffer ?? 0) === 0) {
          const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
          const stride = view.byteStride ?? 12;
          const end = (view.byteOffset ?? 0) + view.byteLength;
          for (let i = 0; i < accessor.count; i++) {
            const offset = start + i * stride;
            if (offset + 12 > binary.length || offset + 12 > end) break;
            for (let axis = 0; axis < 3; axis++) {
              const v = binary.readFloatLE(offset + axis * 4);
              if (!Number.isFinite(v)) continue;
              if (v < min[axis]) min[axis] = v;
              if (v > max[axis]) max[axis] = v;
            }
          }
        }
      }
    }
  }
  const round = n => +n.toFixed(4);
  const bounds = min.every(Number.isFinite) && max.every(Number.isFinite)
    ? {
        min: min.map(round),
        max: max.map(round),
        size: [round(max[0] - min[0]), round(max[1] - min[1]), round(max[2] - min[2])],
        minY: round(min[1]),
      }
    : null;

  // Inspect embedded raster images and byte share so texture bloat is immediately visible.
  const images = (doc.images ?? []).map((image, index) => {
    let imageBytes = 0;
    if (typeof image.bufferView === 'number') {
      imageBytes = doc.bufferViews?.[image.bufferView]?.byteLength ?? 0;
    } else if (typeof image.uri === 'string' && image.uri.startsWith('data:')) {
      const comma = image.uri.indexOf(',');
      if (comma >= 0) {
        const payload = image.uri.slice(comma + 1);
        imageBytes = image.uri.slice(0, comma).includes(';base64')
          ? Math.floor(payload.length * 0.75)
          : Buffer.byteLength(decodeURIComponent(payload));
      }
    }
    return {
      index,
      ...(image.name ? { name: image.name } : {}),
      mimeType: image.mimeType ?? (typeof image.uri === 'string' && image.uri.startsWith('data:') ? image.uri.slice(5, image.uri.indexOf(';')) : 'unknown'),
      bytes: imageBytes,
    };
  });
  const totalBytes = bytes.length;
  const textureBytes = images.reduce((sum, item) => sum + item.bytes, 0);
  const textureRatio = totalBytes > 0 ? +(textureBytes / totalBytes).toFixed(4) : 0;

  // Material alphaModes (surfaces alphaMode: BLEND sorting pitfalls before integration).
  const alphaModes = { OPAQUE: 0, MASK: 0, BLEND: 0 };
  const blendMaterials = [];
  for (const [index, material] of (doc.materials ?? []).entries()) {
    const mode = material.alphaMode ?? 'OPAQUE';
    if (mode in alphaModes) alphaModes[mode]++;
    if (mode === 'BLEND') blendMaterials.push(material.name ?? `material-${index}`);
  }

  // Root scene node initial transforms (helps catch exported 90°/180° orientation or scale offsets).
  const defaultScene = doc.scenes?.[doc.scene ?? 0];
  const rootNodes = (defaultScene?.nodes ?? []).map(nodeIndex => {
    const node = doc.nodes?.[nodeIndex] ?? {};
    const entry = { index: nodeIndex, name: node.name ?? `node-${nodeIndex}` };
    if (Array.isArray(node.rotation)) entry.rotation = node.rotation.map(round);
    if (Array.isArray(node.scale)) entry.scale = node.scale.map(round);
    if (Array.isArray(node.translation)) entry.translation = node.translation.map(round);
    if (Array.isArray(node.matrix)) entry.hasMatrix = true;
    return entry;
  }).filter(n => n.rotation || n.scale || n.translation || n.hasMatrix);

  const extensionsUsed = Array.isArray(doc.extensionsUsed) ? [...doc.extensionsUsed] : [];
  const uncompressedTextureBytes = images
    .filter(item => item.mimeType === 'image/png' || item.mimeType === 'image/jpeg')
    .reduce((sum, item) => sum + item.bytes, 0);
  const advisories = [];
  if (totalBytes > 5 * 1024 * 1024) {
    advisories.push(`Large GLB (${(totalBytes / (1024 * 1024)).toFixed(2)} MiB); check texture share before shipping.`);
  }
  if (uncompressedTextureBytes > 256 * 1024 && uncompressedTextureBytes / Math.max(1, totalBytes) >= 0.5) {
    advisories.push(`Embedded PNG/JPEG textures account for ${Math.round((uncompressedTextureBytes / totalBytes) * 100)}% of GLB bytes; publish/export will auto-transcode to EXT_texture_webp when an encoder is available.`);
  }
  if (blendMaterials.length > 0) {
    advisories.push(`Contains alphaMode=BLEND materials (${blendMaterials.slice(0, 5).join(', ')}); verify opaque parts are not misflagged as BLEND.`);
  }
  if (extensionsUsed.includes('KHR_draco_mesh_compression')) {
    advisories.push('Uses KHR_draco_mesh_compression; Game Studio sandbox CSP blocks Web Workers (worker-src none), so avoid worker-based Draco decoders.');
  }

  const jointIndices = [...new Set((doc.skins ?? []).flatMap(s => s.joints ?? []))];
  const boneNames = jointIndices
    .map(index => doc.nodes?.[index]?.name)
    .filter(name => typeof name === 'string' && name.trim().length > 0);

  return {
    meshes,
    skins: (doc.skins ?? []).map((skin, i) => ({ name: skin.name ?? `skin-${i}`, bones: skin.joints.length })),
    boneCount: jointIndices.length,
    ...(boneNames.length > 0 ? { boneNames } : {}),
    animations: (doc.animations ?? []).map((clip, i) => {
      let minTime = Infinity, maxTime = -Infinity;
      for (const sampler of clip.samplers) for (const time of times(sampler.input)) { minTime = Math.min(minTime, time); maxTime = Math.max(maxTime, time); }
      return { name: clip.name ?? `clip-${i}`, duration: Number.isFinite(maxTime) ? +(maxTime - minTime).toFixed(6) : 0 };
    }),
    triangleCount: meshes.reduce((sum, m) => sum + m.triangles, 0),
    totalBytes,
    images,
    textureBytes,
    textureRatio,
    bounds,
    materials: { total: (doc.materials ?? []).length, alphaModes, blendMaterials },
    extensionsUsed,
    ...(rootNodes.length > 0 ? { rootTransforms: rootNodes } : {}),
    ...(advisories.length > 0 ? { advisories } : {}),
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (!process.argv[2]) throw Error('Usage: node scripts/game-glb-inspect.mjs character.glb');
    console.log(JSON.stringify(inspectGlb(await readFile(process.argv[2])), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
