// The standalone distribution gives this viewer its own Three.js loading manager.
import { ModelViewerElement } from '@google/model-viewer/dist/model-viewer.js';
import dracoJs from 'three/examples/jsm/libs/draco/gltf/draco_decoder.js?url';
import dracoWrapper from 'three/examples/jsm/libs/draco/gltf/draco_wasm_wrapper.js?url';
import dracoWasm from 'three/examples/jsm/libs/draco/gltf/draco_decoder.wasm?url';
import basisJs from 'three/examples/jsm/libs/basis/basis_transcoder.js?url';
import basisWasm from 'three/examples/jsm/libs/basis/basis_transcoder.wasm?url';
import meshoptReady from './modelPreviewMeshopt.js?url&no-inline';

const prefix = '/model-preview-decoders/';
const decoders = new Map([
  ['draco_decoder.js', dracoJs], ['draco_wasm_wrapper.js', dracoWrapper], ['draco_decoder.wasm', dracoWasm],
  ['basis_transcoder.js', basisJs], ['basis_transcoder.wasm', basisWasm],
]);

export function createModelViewer(meshopt: boolean) {
  const element = document.createElement('model-viewer');
  // Construction resets decoder locations in model-viewer 4.4. Configure them before setting src.
  ModelViewerElement.dracoDecoderLocation = prefix;
  ModelViewerElement.ktx2TranscoderLocation = prefix;
  if (meshopt) ModelViewerElement.meshoptDecoderLocation = meshoptReady;
  ModelViewerElement.modelCacheSize = 0;
  ModelViewerElement.mapURLs(url => {
    if (url.startsWith(prefix)) {
      const decoder = decoders.get(url.slice(prefix.length));
      if (decoder) return decoder;
    }
    if (url.startsWith(`blob:${location.origin}/`) || /^data:(?:application\/(?:octet-stream|gltf-buffer)|image\/(?:jpeg|png|webp|avif|ktx2));base64,/i.test(url)) return url;
    throw new Error('External model resource');
  });
  return element;
}
