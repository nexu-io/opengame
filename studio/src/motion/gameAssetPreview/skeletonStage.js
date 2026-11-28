import * as THREE from 'three';

const up = new THREE.Vector3(0, 1, 0);
const defaultView = new THREE.Vector3(0.18, 0.08, 1).normalize();

// Keep glyphs in a separate world-space group so they never affect the animated hierarchy.
export function createSkeletonView(root) {
  const bones = [];
  root.traverse(node => { if (node.isBone) bones.push(node); });
  const links = bones.filter(bone => bone.parent?.isBone);
  root.updateMatrixWorld(true);
  const point = new THREE.Vector3(), parent = new THREE.Vector3();
  const lengths = links.map(bone => point.setFromMatrixPosition(bone.matrixWorld)
    .distanceTo(parent.setFromMatrixPosition(bone.parent.matrixWorld))).filter(length => length > 0).sort((a, b) => a - b);
  const radius = (lengths[Math.floor(lengths.length / 2)] || 1) * 0.12;
  const segments = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.65, 1, 1, 10), new THREE.MeshStandardMaterial({ roughness: 0.8 }), Math.max(1, links.length));
  segments.count = links.length;
  const joints = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 12, 8), new THREE.MeshStandardMaterial({ roughness: 0.65 }), bones.length);
  const group = new THREE.Group();
  group.add(segments, joints);
  for (const mesh of group.children) {
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  }
  const transform = new THREE.Object3D(), direction = new THREE.Vector3();
  function update() {
    root.updateMatrixWorld(true);
    transform.quaternion.identity();
    transform.scale.setScalar(radius * 1.35);
    bones.forEach((bone, i) => {
      transform.position.setFromMatrixPosition(bone.matrixWorld);
      transform.updateMatrix();
      joints.setMatrixAt(i, transform.matrix);
    });
    links.forEach((bone, i) => {
      point.setFromMatrixPosition(bone.matrixWorld);
      parent.setFromMatrixPosition(bone.parent.matrixWorld);
      direction.subVectors(point, parent);
      transform.scale.set(radius, direction.length(), radius);
      transform.position.addVectors(parent, point).multiplyScalar(0.5);
      transform.quaternion.setFromUnitVectors(up, direction.normalize());
      transform.updateMatrix();
      segments.setMatrixAt(i, transform.matrix);
    });
    segments.instanceMatrix.needsUpdate = joints.instanceMatrix.needsUpdate = true;
  }
  return { group, bones, update, radius: radius * 1.35, setTheme(style) {
    segments.material.color.setStyle(style.getPropertyValue('--motion-muted').trim() || style.color);
    joints.material.color.setStyle(style.getPropertyValue('--motion-text').trim() || style.color);
  } };
}

// BVH tracks share the same frame times. For very long clips, bound every translation
// key and the full reach of each chain without evaluating a pose for every key.
function bvhReachBounds(bones, clip) {
  const translations = new Map(clip.tracks.filter(track => track.name.endsWith('.position')).map(track => [track.name.slice(0, -9), track]));
  const bounds = new THREE.Box3(), point = new THREE.Vector3(), reach = new Map();
  let longest = 0;
  for (const bone of bones) {
    const track = translations.get(bone.name);
    let length = bone.position.length();
    if (!bone.parent?.isBone) bounds.expandByPoint(bone.position);
    for (let i = 0; track && i < track.values.length; i += 3) {
      point.fromArray(track.values, i);
      if (bone.parent?.isBone) length = Math.max(length, point.length());
      else bounds.expandByPoint(point);
    }
    const distance = bone.parent?.isBone ? reach.get(bone.parent) + length : 0;
    reach.set(bone, distance);
    longest = Math.max(longest, distance);
  }
  return bounds.expandByScalar(longest);
}

export function skeletonMotionBounds(root, view, mixer, action, isBvh) {
  const bounds = new THREE.Box3(), point = new THREE.Vector3();
  const measure = () => {
    root.updateMatrixWorld(true);
    for (const bone of view.bones) bounds.expandByPoint(point.setFromMatrixPosition(bone.matrixWorld));
  };
  measure();
  if (action) {
    const clip = action.getClip(), times = clip.tracks[0]?.times;
    const budget = Math.max(2, Math.min(1024, Math.floor(100_000 / view.bones.length)));
    if (isBvh && times?.length > budget) bounds.union(bvhReachBounds(view.bones, clip));
    else {
      const samples = isBvh ? times?.length || 1 : Math.min(budget, Math.max(2, Math.ceil(clip.duration * 60) + 1));
      const evaluate = time => { action.time = time; mixer.update(0); measure(); };
      for (let i = 0; i < samples; i++) {
        if (isBvh && i && samples * 2 <= budget) evaluate((times[i - 1] + times[i]) / 2);
        evaluate(isBvh ? times?.[i] || 0 : clip.duration * i / (samples - 1));
      }
      action.time = 0;
      mixer.update(0);
    }
  }
  return bounds.expandByScalar(view.radius);
}

export function fitSkeleton(camera, controls, bounds) {
  const center = bounds.getCenter(new THREE.Vector3());
  const right = new THREE.Vector3().crossVectors(up, defaultView).normalize();
  const vertical = new THREE.Vector3().crossVectors(defaultView, right);
  const tangent = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const corner = new THREE.Vector3();
  let distance = 0;
  for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
    corner.set(x, y, z).sub(center);
    const halfHeight = Math.max(Math.abs(corner.dot(vertical)), Math.abs(corner.dot(right)) / camera.aspect);
    distance = Math.max(distance, corner.dot(defaultView) + 1.15 * halfHeight / tangent);
  }
  camera.position.copy(defaultView).multiplyScalar(distance).add(center);
  controls.target.copy(center);
  camera.near = distance / 10000;
  controls.maxDistance = distance * 80;
  camera.far = controls.maxDistance + distance;
  camera.updateProjectionMatrix();
  controls.update();
}
