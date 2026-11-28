import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createSkeletonView, fitSkeleton, skeletonMotionBounds } from './skeletonStage';

function makeRig() {
  const root = new THREE.Group(), hips = new THREE.Bone(), arm = new THREE.Bone(), end = new THREE.Bone();
  hips.name = 'Hips';
  arm.name = 'Arm';
  arm.position.set(0, 20, 0);
  end.position.set(15, 0, 0);
  root.add(hips); hips.add(arm); arm.add(end);
  return { root, view: createSkeletonView(root), mixer: new THREE.AnimationMixer(root) };
}

describe('skeleton motion framing', () => {
  it('frames displaced clips, rotated end sites and changing aspect ratios, restoring the selected first pose', () => {
    const { root, view, mixer } = makeRig();
    const camera = new THREE.PerspectiveCamera(40);
    const controls = { target: new THREE.Vector3(), update() { camera.lookAt(this.target); camera.updateMatrixWorld(); } };
    for (const height of [38, 420]) {
      mixer.stopAllAction();
      const position = new THREE.VectorKeyframeTrack('Hips.position', [0, 1, 2], [0, height, 0, 50, height + 6, 0, 0, height, 0]);
      const rotation = new THREE.QuaternionKeyframeTrack('Arm.quaternion', [0, 1, 2], [0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 1]);
      const action = mixer.clipAction(new THREE.AnimationClip('move', 2, [position, rotation])).play();
      mixer.update(0);
      const bounds = skeletonMotionBounds(root, view, mixer, action, true);
      expect(action.time).toBe(0);
      expect(view.bones[0].position.y).toBe(height);
      expect(bounds.min.y).toBeGreaterThan(height - 5);
      for (const aspect of [1.4, 0.5, 2.8]) {
        camera.aspect = aspect;
        fitSkeleton(camera, controls, bounds);
        for (let frame = 0; frame <= 60; frame++) {
          action.time = frame / 30;
          mixer.update(0);
          view.update();
          for (const bone of view.bones) {
            const point = new THREE.Vector3().setFromMatrixPosition(bone.matrixWorld).project(camera);
            expect(Math.max(Math.abs(point.x), Math.abs(point.y))).toBeLessThan(1);
          }
        }
      }
    }
  });

  it('includes a single-frame root excursion and the terminal chain reach beyond the pose sampling budget', () => {
    const { root, view, mixer } = makeRig();
    const times = Array.from({ length: 2048 }, (_, i) => i / 30);
    const values = times.flatMap((_, i) => [i === 1777 ? 1000 : 0, 38, 0]);
    const track = new THREE.VectorKeyframeTrack('Hips.position', times, values);
    const action = mixer.clipAction(new THREE.AnimationClip('travel', -1, [track])).play();
    mixer.update(0);
    const bounds = skeletonMotionBounds(root, view, mixer, action, true);
    expect(bounds.max.x).toBeGreaterThanOrEqual(1035);
    expect(action.time).toBe(0);
  });
});
