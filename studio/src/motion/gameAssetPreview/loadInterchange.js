import * as THREE from 'three';
import { companionPath, readPreviewBytes } from './formats';

const megabyte = 1024 ** 2;
const text = bytes => new TextDecoder().decode(bytes);
export const gltfGuidance = 'Use uncompressed glTF with its local buffers and textures.';
export const fbxGuidance = 'Use FBX with embedded PNG or JPEG textures.';

async function loadGltf(bytes, props, signal, manager, urls) {
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const json = JSON.parse(text(bytes));
  const resources = [...json.buffers ?? [], ...json.images ?? []];
  if (resources.length > 256 || json.extensionsUsed?.some(name => /draco|meshopt|basisu/i.test(name))) throw new Error(gltfGuidance);
  if (json.accessors?.some(accessor => !Number.isSafeInteger(accessor.count) || accessor.count < 0 || accessor.count > 4_000_000)) throw new Error(gltfGuidance);
  let budget = 96 * megabyte - bytes.byteLength;
  const resolved = new Map();
  for (const resource of resources) {
    const uri = resource.uri;
    if (uri === undefined) continue;
    if (typeof uri !== 'string') throw new Error(gltfGuidance);
    if (/^data:(?:application\/(?:octet-stream|gltf-buffer)|image\/(?:png|jpeg|webp|avif));base64,[\da-z+/=]*$/i.test(uri)) continue;
    if (!resolved.has(uri)) {
      const url = props.resolveFileUrl?.(companionPath(props.path, uri));
      if (!url) throw new Error(gltfGuidance);
      const blob = await readPreviewBytes(url, signal, Math.min(budget, 48 * megabyte));
      budget -= blob.size;
      const objectUrl = URL.createObjectURL(blob);
      resolved.set(uri, objectUrl);
      urls.add(objectUrl);
    }
    resource.uri = resolved.get(uri);
  }
  // All declared URIs have been validated. GLTFLoader also makes its own blob URLs for embedded buffer views.
  manager.setURLModifier(url => {
    if (url.startsWith('blob:') || /^data:(?:application|image)\//.test(url)) return url;
    throw new Error(gltfGuidance);
  });
  const gltf = await new GLTFLoader(manager).parseAsync(JSON.stringify(json), '');
  gltf.scene.animations = gltf.animations;
  return gltf.scene;
}

async function loadFbx(bytes, manager, urls) {
  const { FBXLoader } = await import('three/addons/loaders/FBXLoader.js');
  // FBX stores literal filenames as strings. Reserve blob: for URLs created by FBXLoader from embedded pixels.
  if (new TextDecoder('latin1').decode(bytes).includes('blob:')) throw new Error(fbxGuidance);
  manager.setURLModifier(url => {
    if (url.startsWith('blob:')) { urls.add(url); return url; }
    if (/^data:image\/(?:png|jpeg|webp|bmp);base64,[a-z\d+/=]+$/i.test(url)) return url;
    throw new Error(fbxGuidance);
  });
  return new FBXLoader(manager).parse(bytes, '');
}

export function disposeModel(root) {
  const released = new Set();
  const release = resource => {
    if (!resource || released.has(resource)) return;
    released.add(resource);
    resource.source?.data?.close?.();
    resource.dispose?.();
  };
  root.traverse(object => {
    if (object.isInstancedMesh) release(object);
    release(object.geometry);
    release(object.skeleton);
    for (const material of [].concat(object.material || [])) {
      for (const value of Object.values(material)) if (value?.isTexture) release(value);
      release(material);
    }
  });
}

export async function loadInterchange(props, signal) {
  const extension = props.path.split('.').pop().toLowerCase();
  const limit = (extension === 'bvh' ? 4 : 48) * megabyte;
  const bytes = await (await readPreviewBytes(props.url, signal, limit)).arrayBuffer();
  const manager = new THREE.LoadingManager();
  manager.setURLModifier(() => { throw new Error('Invalid workspace reference'); });
  const urls = new Set();
  let loading = false, failed = false, complete;
  const pending = new Promise(resolve => { complete = resolve; });
  manager.onStart = () => { loading = true; };
  manager.onError = () => { failed = true; };
  manager.onLoad = () => { loading = false; complete(); };
  let root, note = '';
  try {
    switch (extension) {
      case 'gltf': root = await loadGltf(bytes, props, signal, manager, urls); break;
      case 'fbx': root = await loadFbx(bytes, manager, urls); break;
      case 'obj': {
        const { OBJLoader } = await import('three/addons/loaders/OBJLoader.js');
        root = new OBJLoader(manager).parse(text(bytes));
        if (root.materialLibraries.length) note = 'OBJ geometry only. Export glTF to preview materials.';
        break;
      }
      case 'bvh': {
        const { BVHLoader } = await import('three/addons/loaders/BVHLoader.js');
        const source = text(bytes);
        if (!/^\s*HIERARCHY\b/.test(source) || !/^Frames:\s*\d+\s*$/mi.test(source)) throw new Error('Invalid BVH');
        const result = new BVHLoader(manager).parse(source);
        root = new THREE.Group();
        root.add(result.skeleton.bones[0]);
        root.animations = [result.clip];
        break;
      }
      case 'stl': case 'ply': {
        const geometry = extension === 'stl'
          ? new (await import('three/addons/loaders/STLLoader.js')).STLLoader(manager).parse(bytes)
          : new (await import('three/addons/loaders/PLYLoader.js')).PLYLoader(manager).parse(bytes);
        const vertexColors = !!geometry.getAttribute('color');
        const plyHeader = extension === 'ply' ? text(bytes.slice(0, 65536)).split('end_header')[0] : '';
        if (extension === 'ply' && !/^element face [1-9]\d*\s*$/m.test(plyHeader) && !geometry.index) {
          geometry.computeBoundingSphere();
          root = new THREE.Points(geometry, new THREE.PointsMaterial({ vertexColors, size: geometry.boundingSphere.radius * 0.012 || 0.01 }));
        } else {
          if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
          root = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors, side: THREE.DoubleSide }));
        }
        break;
      }
      default: throw new Error('Preview unavailable');
    }
    if (loading) await pending;
    signal.throwIfAborted();
    if (failed) throw new Error('Preview unavailable');
    let bones = false, geometry = false;
    root.traverse(object => { bones ||= !!object.isBone; geometry ||= !!object.geometry?.attributes.position?.count; });
    if (!bones && !geometry) throw new Error('Preview unavailable');
    return { root, note, skeletonOnly: bones && !geometry, isBvh: extension === 'bvh' };
  } catch (error) {
    if (root) disposeModel(root);
    throw error;
  } finally { for (const url of urls) URL.revokeObjectURL(url); }
}
