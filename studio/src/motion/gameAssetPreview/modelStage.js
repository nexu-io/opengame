import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { disposeModel, loadInterchange } from './loadInterchange';
import { createSkeletonView, fitSkeleton, skeletonMotionBounds } from './skeletonStage';

export const graphicsHint = 'Enable WebGL 2 in your browser to preview 3D assets.';

export async function createModelStage(host, props, signal) {
  const { root, note, skeletonOnly, isBvh } = await loadInterchange(props, signal);
  let renderer, controls, observer, skeleton, themeObserver;
  const mixer = new THREE.AnimationMixer(root);
  function dispose() {
    renderer?.setAnimationLoop(null);
    observer?.disconnect();
    themeObserver?.disconnect();
    controls?.dispose();
    mixer.stopAllAction();
    mixer.uncacheRoot(root);
    disposeModel(root);
    if (skeleton) disposeModel(skeleton.group);
    renderer?.dispose();
    renderer?.forceContextLoss();
    renderer?.domElement.remove();
  }
  try {
    signal.throwIfAborted();
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); }
    catch { throw new Error(graphicsHint); }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.domElement.className = 'block w-full h-full';
    host.append(renderer.domElement);
    const scene = new THREE.Scene();
    scene.add(root, new THREE.HemisphereLight(0xffffff, 0x85909e, 2.25));
    const light = new THREE.DirectionalLight(0xffffff, 2.5);
    light.position.set(3, 5, 4);
    scene.add(light);
    const camera = new THREE.PerspectiveCamera(40);
    controls = new OrbitControls(camera, renderer.domElement);
    const render = () => renderer.render(scene, camera);
    let bounds, action;
    if (skeletonOnly) {
      skeleton = createSkeletonView(root);
      scene.add(skeleton.group);
      const theme = () => skeleton.setTheme(getComputedStyle(host));
      theme();
      themeObserver = new MutationObserver(() => { theme(); render(); });
      for (let element = host; element; element = element.parentElement) {
        themeObserver.observe(element, { attributes: true, attributeFilter: ['data-theme', 'class'] });
      }
    } else bounds = new THREE.Box3().setFromObject(root);
    function fit() {
      const sphere = bounds.getBoundingSphere(new THREE.Sphere());
      if (bounds.isEmpty() || !Number.isFinite(sphere.radius)) throw new Error('Preview unavailable');
      if (skeleton) { fitSkeleton(camera, controls, bounds); render(); return; }
      const radius = sphere.radius || 1;
      const fov = Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * Math.min(1, camera.aspect));
      const distance = 1.1 * radius / Math.sin(fov);
      camera.position.set(1, 0.65, 1.25).normalize().multiplyScalar(distance).add(sphere.center);
      camera.near = radius / 1000;
      camera.far = distance + radius * 120;
      camera.updateProjectionMatrix();
      controls.target.copy(sphere.center);
      controls.maxDistance = radius * 80;
      controls.update();
      render();
    }
    function resize() {
      const width = Math.max(1, host.clientWidth), height = Math.max(1, host.clientHeight);
      const size = renderer.getSize(new THREE.Vector2());
      if (size.x === width && size.y === height && camera.aspect === width / height) return;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      if (skeleton && bounds) fit();
      else if (bounds) render();
    }
    resize();
    function select(index) {
      mixer.stopAllAction();
      action = mixer.clipAction(root.animations[index]);
      action.reset().play();
      mixer.update(0);
      if (skeleton) {
        bounds = skeletonMotionBounds(root, skeleton, mixer, action, isBvh);
        skeleton.update();
        fit();
      } else render();
    }
    if (root.animations.length) select(0);
    if (skeleton && !action) {
      bounds = skeletonMotionBounds(root, skeleton, mixer, null, isBvh);
      skeleton.update();
    }
    if (!skeleton || !action) fit();
    controls.addEventListener('change', render);
    observer = new ResizeObserver(resize);
    observer.observe(host);
    function play(enabled) {
      let previous;
      renderer.setAnimationLoop(enabled ? now => {
        mixer.update(previous === undefined ? 0 : Math.min((now - previous) / 1000, 0.15));
        previous = now;
        skeleton?.update();
        render();
      } : null);
    }
    function seek(seconds) {
      if (!action) return;
      play(false);
      action.time = Math.min(seconds, Math.max(0, action.getClip().duration - 1e-8));
      mixer.update(0);
      skeleton?.update();
      render();
    }
    return { clips: root.animations.map(clip => ({ name: clip.name, duration: clip.duration })), note, select, play, seek, time: () => action?.time || 0, fit, dispose };
  } catch (error) { dispose(); throw error; }
}
