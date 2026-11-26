import {
  AnimationClip,
  AnimationMixer,
  Box3,
  Euler,
  Group,
  LoopOnce,
  LoopRepeat,
  MathUtils,
  Matrix4,
  Quaternion,
  QuaternionKeyframeTrack,
  Vector3,
  VectorKeyframeTrack,
} from './three.module.min.js';
import { clone as cloneSkinnedScene } from './SkeletonUtils.js';

const UP = new Vector3(0, 1, 0);
const TMP_V1 = new Vector3();
const TMP_V2 = new Vector3();
const TMP_V3 = new Vector3();
const TMP_V4 = new Vector3();
const TMP_V5 = new Vector3();
const TMP_V6 = new Vector3();
const TMP_Q1 = new Quaternion();
const TMP_Q2 = new Quaternion();
const TMP_Q3 = new Quaternion();
const TMP_Q4 = new Quaternion();
const TMP_EULER = new Euler(0, 0, 0, 'YXZ');

const TRANSLUCENT_NAME_RE = /glass|window|water|lens|crystal|visor|aura|flame|fire|glow|fx|vfx|veil|smoke|mist|hair|eyelash/i;

const CANONICAL_BONE_PATTERNS = [
  ['Hips', /^(?:hips?|pelvis|root_?hips?)$/i],
  ['Spine', /^(?:spine|spine0|abdomen|torso)$/i],
  ['Spine1', /^(?:spine1|spine_?01|lowerchest|midspine)$/i],
  ['Spine2', /^(?:spine2|spine_?02|chest|upperchest)$/i],
  ['Neck', /^(?:neck|neck0?1?)$/i],
  ['Head', /^(?:head)$/i],
  ['LeftShoulder', /^(?:left_?shoulder|shoulder_?l|clavicle_?l|l_?clavicle|l_?shoulder)$/i],
  ['LeftArm', /^(?:left_?(?:upper_?)?arm|upper_?arm_?l|arm_?l|l_?upper_?arm|l_?arm)$/i],
  ['LeftForeArm', /^(?:left_?(?:fore_?|lower_?)arm|fore_?arm_?l|lower_?arm_?l|l_?fore_?arm)$/i],
  ['LeftHand', /^(?:left_?hand|hand_?l|wrist_?l|l_?hand)$/i],
  ['RightShoulder', /^(?:right_?shoulder|shoulder_?r|clavicle_?r|r_?clavicle|r_?shoulder)$/i],
  ['RightArm', /^(?:right_?(?:upper_?)?arm|upper_?arm_?r|arm_?r|r_?upper_?arm|r_?arm)$/i],
  ['RightForeArm', /^(?:right_?(?:fore_?|lower_?)arm|fore_?arm_?r|lower_?arm_?r|r_?fore_?arm)$/i],
  ['RightHand', /^(?:right_?hand|hand_?r|wrist_?r|r_?hand)$/i],
  ['LeftUpLeg', /^(?:left_?up(?:per)?_?leg|left_?thigh|up(?:per)?_?leg_?l|thigh_?l|l_?thigh|l_?up(?:per)?_?leg)$/i],
  ['LeftLeg', /^(?:left_?(?:lower_?)?leg|left_?shin|left_?calf|lower_?leg_?l|leg_?l|shin_?l|calf_?l|l_?shin|l_?leg)$/i],
  ['LeftFoot', /^(?:left_?foot|foot_?l|ankle_?l|l_?foot)$/i],
  ['LeftToeBase', /^(?:left_?toes?(?:_?base)?|toes?_?l|l_?toes?)$/i],
  ['RightUpLeg', /^(?:right_?up(?:per)?_?leg|right_?thigh|up(?:per)?_?leg_?r|thigh_?r|r_?thigh|r_?up(?:per)?_?leg)$/i],
  ['RightLeg', /^(?:right_?(?:lower_?)?leg|right_?shin|right_?calf|lower_?leg_?r|leg_?r|shin_?r|calf_?r|r_?shin|r_?leg)$/i],
  ['RightFoot', /^(?:right_?foot|foot_?r|ankle_?r|r_?foot)$/i],
  ['RightToeBase', /^(?:right_?toes?(?:_?base)?|toes?_?r|r_?toes?)$/i],
];

const RETARGET_TOPO_ORDER = [
  'Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head',
  'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand',
  'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand',
  'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToeBase',
  'RightUpLeg', 'RightLeg', 'RightFoot', 'RightToeBase',
];

const RETARGET_LIMB_CHILD = {
  LeftArm: 'LeftForeArm',
  LeftForeArm: 'LeftHand',
  RightArm: 'RightForeArm',
  RightForeArm: 'RightHand',
  LeftUpLeg: 'LeftLeg',
  LeftLeg: 'LeftFoot',
  RightUpLeg: 'RightLeg',
  RightLeg: 'RightFoot',
};

/** Compute shortest signed angular delta from `current` toward `target` in [-PI, PI]. */
export function shortestAngleDelta(current, target) {
  return Math.atan2(Math.sin(target - current), Math.cos(target - current));
}

/** Frame-rate independent exponential damping toward target. */
export function damp(current, target, rate, dt) {
  if (!(dt > 0) || !(rate > 0)) return current;
  return current + (target - current) * (1 - Math.exp(-rate * dt));
}

/**
 * Asymmetric 3-beat combat/action curve (Anticipation -> Strike -> Follow-Through).
 * Drives natural weight and momentum from continuous elapsed `t01` in [0, 1].
 */
export function sampleActionCurve(t01, options = {}) {
  const t = MathUtils.clamp(Number.isFinite(t01) ? t01 : 0, 0, 1);
  const windupEnd = MathUtils.clamp(options.windupEnd ?? 0.28, 0.05, 0.7);
  const strikeEnd = MathUtils.clamp(options.strikeEnd ?? 0.46, windupEnd + 0.05, 0.95);
  if (t <= windupEnd) {
    const u = t / windupEnd;
    const ease = 1 - Math.pow(1 - u, 2.2);
    return { phase: 'anticipation', u, anticipation: ease, strike: 0, followThrough: 0, swing01: -0.22 * ease, lunge: -0.15 * ease };
  }
  if (t <= strikeEnd) {
    const u = (t - windupEnd) / (strikeEnd - windupEnd);
    const whip = u * u * (3 - 2 * u);
    const snap = Math.pow(whip, 0.75);
    return { phase: 'strike', u, anticipation: 1 - snap, strike: snap, followThrough: 0, swing01: -0.22 + 1.22 * snap, lunge: Math.sin(u * Math.PI) };
  }
  const u = (t - strikeEnd) / (1 - strikeEnd);
  const settle = 1 - Math.pow(1 - u, 2.4);
  const overshoot = Math.sin(u * Math.PI) * 0.08 * (1 - u);
  return { phase: 'followThrough', u, anticipation: 0, strike: 1 - settle, followThrough: settle, swing01: 1 + overshoot - settle, lunge: (1 - settle) * 0.25 };
}

function normalizeBoneKey(rawName) {
  const cleaned = String(rawName || '')
    .replace(/^.*mixamorig[:_]?/i, '')
    .replace(/^.*(?:armature|rig|skeleton)[:_|/.]/i, '')
    .replace(/\.[0-9]+$/, '')
    .replace(/\./g, '_')
    .trim();
  for (const [canonical, pattern] of CANONICAL_BONE_PATTERNS) {
    if (pattern.test(cleaned)) return canonical;
  }
  return cleaned;
}

function worldPos(obj, out = new Vector3()) {
  return obj.getWorldPosition(out);
}

function pointBoneToward(bone, child, worldTarget) {
  const origin = worldPos(bone, TMP_V1);
  const currentDir = worldPos(child, TMP_V2).sub(origin);
  const targetDir = TMP_V3.copy(worldTarget).sub(origin);
  if (currentDir.lengthSq() < 1e-8 || targetDir.lengthSq() < 1e-8) return;
  currentDir.normalize();
  targetDir.normalize();
  const deltaWorld = TMP_Q1.setFromUnitVectors(currentDir, targetDir);
  const parentWorld = bone.parent ? bone.parent.getWorldQuaternion(TMP_Q2) : TMP_Q2.identity();
  const deltaLocal = TMP_Q3.copy(parentWorld).invert().multiply(deltaWorld).multiply(parentWorld);
  bone.quaternion.premultiply(deltaLocal).normalize();
  bone.updateWorldMatrix(false, true);
}

function solveTwoBoneIK(root, upper, lower, hand, localTarget, localPole, telemetry) {
  if (!upper || !lower || !hand) return false;
  const A = worldPos(upper, new Vector3());
  const B = worldPos(lower, new Vector3());
  const H = worldPos(hand, new Vector3());
  const G = root.localToWorld(localTarget.clone());
  const toGoal = G.sub(A);
  const l1 = A.distanceTo(B);
  const l2 = B.distanceTo(H);
  if (l1 < 1e-4 || l2 < 1e-4) return false;

  const rawDist = toGoal.length();
  const minReach = Math.abs(l1 - l2) + 0.01;
  const maxReach = (l1 + l2) * 0.96;
  if (rawDist > maxReach && telemetry) telemetry.overExtendedIkCount++;
  const dist = MathUtils.clamp(rawDist, minReach, Math.max(minReach + 0.001, maxReach));
  const dir = rawDist > 1e-5 ? toGoal.multiplyScalar(1 / rawDist) : new Vector3(0, -1, 0);

  const poleWorld = root.localToWorld(localPole.clone()).sub(A);
  poleWorld.addScaledVector(dir, -poleWorld.dot(dir));
  if (poleWorld.lengthSq() < 1e-6) {
    // Fallback axis perpendicular to arm direction so collinear goals never produce NaN.
    poleWorld.set(Math.abs(dir.y) < 0.9 ? 0 : 1, Math.abs(dir.y) < 0.9 ? -1 : 0, -0.5);
    poleWorld.addScaledVector(dir, -poleWorld.dot(dir));
  }
  poleWorld.normalize();

  const along = MathUtils.clamp((l1 * l1 - l2 * l2 + dist * dist) / (2 * dist), -l1, l1);
  const bend = Math.sqrt(Math.max(0, l1 * l1 - along * along));
  const elbowWorld = A.clone().addScaledVector(dir, along).addScaledVector(poleWorld, bend);
  const clampedHandWorld = A.clone().addScaledVector(dir, dist);

  pointBoneToward(upper, lower, elbowWorld);
  pointBoneToward(lower, hand, clampedHandWorld);
  return true;
}

/**
 * Shared humanoid 3D rig controller for Three.js GLB characters (Mixamo, KayKit, or custom rigs).
 * Guarantees:
 * - Safe SkinnedMesh cloning, grounding, +Z orientation, and BLEND-material opaque hardening.
 * - Native AnimationMixer clip playback & cross-fading (including extra retargeted GLB clips).
 * - Fixed-timestep render smoothing & continuous walk-blend (zero 30Hz square-wave leg flicker).
 * - Reach-clamped analytical 2-bone arm IK + persistent Quaternion.slerp with angular-speed caps.
 * - Real bone-socket weapon/prop attachment with automatic hierarchy scale compensation.
 */
export function createHumanoidRig(gltf, options = {}) {
  const height = Number.isFinite(options.height) && options.height > 0 ? options.height : 1.8;
  const autoOrient = options.autoOrient !== false;
  const fixBlendMaterials = options.fixBlendMaterials !== false;

  const sourceScene = gltf?.scene ?? gltf;
  const model = cloneSkinnedScene(sourceScene);
  const root = new Group();
  root.name = options.name || 'HumanoidRigRoot';
  const mount = new Group();
  mount.name = 'HumanoidRigMount';
  root.add(mount);
  mount.add(model);

  const bones = {};
  const bonesByRawName = new Map();
  const allBones = [];
  const restQuats = new Map();
  const curQuats = new Map();
  const lastMixerQuats = new Map();
  let restHipPos = null;

  model.traverse(obj => {
    if (obj.isBone) {
      allBones.push(obj);
      bonesByRawName.set(obj.name, obj);
      const canonical = normalizeBoneKey(obj.name);
      if (canonical && !bones[canonical]) bones[canonical] = obj;
      restQuats.set(obj, obj.quaternion.clone());
      curQuats.set(obj, obj.quaternion.clone());
    }
    if (obj.isMesh || obj.isSkinnedMesh) {
      obj.frustumCulled = false;
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const mat of mats) {
        if (!mat) continue;
        if (fixBlendMaterials && mat.transparent && (mat.opacity === undefined || mat.opacity >= 0.99) && !TRANSLUCENT_NAME_RE.test(mat.name || obj.name || '')) {
          mat.transparent = false;
          mat.depthWrite = true;
        }
        if (options.envMapIntensity !== undefined && 'envMapIntensity' in mat) {
          mat.envMapIntensity = options.envMapIntensity;
        }
      }
    }
  });

  model.updateMatrixWorld(true);
  if (autoOrient && bones.LeftArm && bones.RightArm) {
    const across = worldPos(bones.LeftArm, TMP_V1).sub(worldPos(bones.RightArm, TMP_V2));
    across.y = 0;
    if (across.lengthSq() > 1e-6) {
      const forward = across.cross(UP);
      model.rotation.y -= Math.atan2(forward.x, forward.z);
    }
  }
  model.updateMatrixWorld(true);

  const bounds = new Box3().setFromObject(model);
  const size = bounds.getSize(new Vector3());
  const measuredHeight = size.y > 1e-4 ? size.y : 1;
  const modelScale = height / measuredHeight;
  mount.scale.setScalar(modelScale);
  const baseMountY = -bounds.min.y * modelScale;
  mount.position.set(
    -((bounds.min.x + bounds.max.x) * 0.5) * modelScale,
    baseMountY,
    -((bounds.min.z + bounds.max.z) * 0.5) * modelScale,
  );
  root.updateMatrixWorld(true);

  const measureArm = side => {
    const u = bones[side + 'Arm'];
    const l = bones[side + 'ForeArm'];
    const h = bones[side + 'Hand'];
    if (!u || !l || !h) return { l1: 0, l2: 0, maxReach: 0, shoulderLocal: new Vector3(side === 'Right' ? -0.2 : 0.2, height * 0.8, 0) };
    const A = worldPos(u, new Vector3());
    const B = worldPos(l, new Vector3());
    const H = worldPos(h, new Vector3());
    const l1 = A.distanceTo(B);
    const l2 = B.distanceTo(H);
    return { l1, l2, maxReach: l1 + l2, shoulderLocal: root.worldToLocal(A.clone()) };
  };

  const metrics = {
    height,
    modelScale,
    boneCount: allBones.length,
    rightArm: measureArm('Right'),
    leftArm: measureArm('Left'),
    hipY: bones.Hips ? root.worldToLocal(worldPos(bones.Hips, new Vector3())).y : height * 0.53,
  };
  if (bones.Hips) restHipPos = bones.Hips.position.clone();

  const mixer = new AnimationMixer(model);
  const clips = new Map();
  const actions = new Map();
  let activeAction = null;
  let activeClipName = null;
  let lastLoopingClipName = null;
  let pendingReturn = null;

  function onActionFinished(event) {
    if (event.action !== activeAction || !pendingReturn) return;
    const { clipName, fade } = pendingReturn;
    pendingReturn = null;
    if (clipName) playClip(clipName, { fade, loop: true });
  }
  mixer.addEventListener('finished', onActionFinished);

  function addClips(clipList, aliasMap = {}) {
    if (!Array.isArray(clipList)) return [];
    const added = [];
    for (let i = 0; i < clipList.length; i++) {
      const clip = clipList[i];
      if (!clip || !(clip.duration > 0)) continue;
      const mappedName = aliasMap[clip.name] || aliasMap[i] || clip.name || `clip_${clips.size}`;
      const cloned = clip.clone();
      cloned.name = mappedName;
      for (const track of cloned.tracks || []) {
        const dot = track.name.indexOf('.');
        if (dot <= 0) continue;
        const rawNode = track.name.slice(0, dot);
        const prop = track.name.slice(dot + 1);
        const targetBone = bonesByRawName.get(rawNode) || bones[normalizeBoneKey(rawNode)];
        if (targetBone) {
          // Bind by bone UUID so Mixamo colons (`mixamorig:Spine`) and cross-GLB naming variants resolve cleanly.
          track.name = `${targetBone.uuid}.${prop}`;
        }
      }
      if (clips.has(mappedName)) {
        const oldClip = clips.get(mappedName);
        const oldAction = actions.get(mappedName);
        if (oldAction) {
          oldAction.stop();
          if (activeAction === oldAction) {
            activeAction = null;
            activeClipName = null;
          }
        }
        if (oldClip) mixer.uncacheClip(oldClip);
      }
      clips.set(mappedName, cloned);
      actions.set(mappedName, mixer.clipAction(cloned));
      added.push(mappedName);
    }
    return added;
  }

  addClips(gltf?.animations || []);

  function resolveClipName(query) {
    if (!query) return null;
    if (clips.has(query)) return query;
    const lower = String(query).toLowerCase().replace(/^preset:/, '');
    for (const name of clips.keys()) {
      const norm = name.toLowerCase().replace(/^preset:/, '');
      if (norm === lower) return name;
    }
    for (const name of clips.keys()) {
      if (name.toLowerCase().includes(lower)) return name;
    }
    return null;
  }

  function playClip(query, opts = {}) {
    const resolved = resolveClipName(query);
    if (!resolved) return null;
    const next = actions.get(resolved);
    if (!next) return null;
    const fade = opts.fade ?? 0.16;
    const loop = opts.loop !== false;
    pendingReturn = null;
    next.setLoop(loop ? LoopRepeat : LoopOnce, loop ? Infinity : 1);
    next.clampWhenFinished = Boolean(opts.clampWhenFinished ?? !loop);
    next.timeScale = opts.timeScale ?? 1;
    if (loop) lastLoopingClipName = resolved;
    if (activeAction === next && !opts.forceRestart) return next;
    // Stop any older lingering cross-fade actions so rapid state switches never blend stale clips.
    for (const act of actions.values()) {
      if (act !== activeAction && act !== next) act.stop();
    }
    next.reset().setEffectiveTimeScale(next.timeScale).setEffectiveWeight(1).play();
    if (activeAction && activeAction !== next) {
      if (fade > 0) activeAction.crossFadeTo(next, fade, true);
      else activeAction.stop();
    }
    if (!activeAction || fade <= 0) lastMixerQuats.clear();
    activeAction = next;
    activeClipName = resolved;
    return next;
  }

  /**
   * Play a one-shot clip (e.g. slash, hurt, jump, fall/death).
   * Automatically cross-fades back to `opts.returnTo` (or the last looping clip) when finished,
   * or holds the final clamped frame when `opts.holdEnd` is true (e.g. defeat/fall).
   */
  function playOnce(query, opts = {}) {
    const prevLoop = lastLoopingClipName;
    const action = playClip(query, {
      ...opts,
      loop: false,
      clampWhenFinished: true,
      forceRestart: opts.forceRestart !== false,
    });
    if (!action) return null;
    if (!opts.holdEnd) {
      const returnClip = opts.returnTo ?? prevLoop ?? resolveClipName('idle');
      if (returnClip) pendingReturn = { clipName: returnClip, fade: opts.returnFade ?? 0.16 };
    }
    return action;
  }

  function stopClips(fade = 0.12) {
    pendingReturn = null;
    if (fade <= 0) {
      mixer.stopAllAction();
      activeAction = null;
      activeClipName = null;
      return;
    }
    for (const act of actions.values()) {
      if (act !== activeAction) act.stop();
    }
    if (!activeAction) return;
    activeAction.fadeOut(fade);
    activeAction = null;
    activeClipName = null;
  }

  /**
   * Retarget skeletal clips from another rigged humanoid GLB (Mixamo, KayKit, or Blender rig)
   * onto this skeleton using root-space limb-aligned quaternion delta mapping.
   */
  function retargetClipsFrom(sourceGltf, opts = {}) {
    const sourceClips = sourceGltf?.animations;
    const sourceRootScene = sourceGltf?.scene ?? sourceGltf;
    if (!sourceRootScene || !Array.isArray(sourceClips) || sourceClips.length === 0) return [];

    const fps = MathUtils.clamp(Number(opts.fps) || 30, 12, 60);
    const hipHorizontalScale = Number.isFinite(opts.hipHorizontalScale) ? opts.hipHorizontalScale : 0.35;
    const hipVerticalScale = Number.isFinite(opts.hipVerticalScale) ? opts.hipVerticalScale : 1;
    const filterNames = Array.isArray(opts.names) && opts.names.length > 0
      ? new Set(opts.names.map(n => String(n).toLowerCase()))
      : null;

    // Build normalized +Z-facing source rig in an isolated root.
    const srcModel = cloneSkinnedScene(sourceRootScene);
    const srcRoot = new Group();
    const srcMount = new Group();
    srcRoot.add(srcMount);
    srcMount.add(srcModel);
    const srcBones = {};
    srcModel.traverse(obj => {
      if (obj.isBone) {
        const canonical = normalizeBoneKey(obj.name);
        if (canonical && !srcBones[canonical]) srcBones[canonical] = obj;
      }
    });
    srcModel.updateMatrixWorld(true);
    if (srcBones.LeftArm && srcBones.RightArm) {
      const across = worldPos(srcBones.LeftArm, new Vector3()).sub(worldPos(srcBones.RightArm, new Vector3()));
      across.y = 0;
      if (across.lengthSq() > 1e-6) {
        const fwd = across.cross(UP);
        srcModel.rotation.y -= Math.atan2(fwd.x, fwd.z);
      }
    }
    srcModel.updateMatrixWorld(true);
    const srcBox = new Box3().setFromObject(srcModel);
    const srcSize = srcBox.getSize(new Vector3());
    const srcScale = 1.8 / (srcSize.y > 1e-4 ? srcSize.y : 1);
    srcMount.scale.setScalar(srcScale);
    srcMount.position.set(
      -((srcBox.min.x + srcBox.max.x) * 0.5) * srcScale,
      -srcBox.min.y * srcScale,
      -((srcBox.min.z + srcBox.max.z) * 0.5) * srcScale,
    );
    srcRoot.updateMatrixWorld(true);

    const mappedKeys = RETARGET_TOPO_ORDER.filter(k => srcBones[k] && bones[k]);
    if (mappedKeys.length === 0) return [];

    // Save current target bone transforms so retargeting is side-effect free.
    const savedTargetQuats = new Map();
    for (const bone of allBones) {
      savedTargetQuats.set(bone, bone.quaternion.clone());
      bone.quaternion.copy(restQuats.get(bone));
    }
    const savedTargetHipPos = bones.Hips ? bones.Hips.position.clone() : null;
    if (bones.Hips && restHipPos) bones.Hips.position.copy(restHipPos);
    root.updateMatrixWorld(true);

    const limbDirInRoot = (rigRoot, boneA, boneB) => {
      const pa = rigRoot.worldToLocal(worldPos(boneA, new Vector3()));
      const pb = rigRoot.worldToLocal(worldPos(boneB, new Vector3()));
      const diff = pb.sub(pa);
      return diff.lengthSq() > 1e-8 ? diff.normalize() : null;
    };

    const srcRestWorld = {};
    const srcLimbDir = {};
    for (const k of RETARGET_TOPO_ORDER) {
      if (srcBones[k]) srcRestWorld[k] = srcBones[k].getWorldQuaternion(new Quaternion());
      const childK = RETARGET_LIMB_CHILD[k];
      if (childK && srcBones[k] && srcBones[childK]) {
        srcLimbDir[k] = limbDirInRoot(srcRoot, srcBones[k], srcBones[childK]);
      }
    }

    const srcRestHipPos = srcBones.Hips
      ? srcRoot.worldToLocal(worldPos(srcBones.Hips, new Vector3()))
      : new Vector3(0, 1, 0);
    const tgtRestHipPos = bones.Hips
      ? root.worldToLocal(worldPos(bones.Hips, new Vector3()))
      : new Vector3(0, 1, 0);
    const hipScale = (tgtRestHipPos.y > 1e-4 ? tgtRestHipPos.y : 1) / (srcRestHipPos.y > 1e-4 ? srcRestHipPos.y : 1);

    const tgtRootWorld = root.getWorldQuaternion(new Quaternion());
    const tgtRootWorldInv = tgtRootWorld.clone().invert();
    const tgtAlignedRestRoot = {};
    for (const k of RETARGET_TOPO_ORDER) {
      const tb = bones[k];
      if (!tb) continue;
      const childK = RETARGET_LIMB_CHILD[k];
      if (childK && bones[childK] && srcLimbDir[k]) {
        root.updateMatrixWorld(true);
        const tDir = limbDirInRoot(root, tb, bones[childK]);
        if (tDir) {
          const alignRoot = new Quaternion().setFromUnitVectors(tDir, srcLimbDir[k]);
          const parentW = tb.parent ? tb.parent.getWorldQuaternion(new Quaternion()) : new Quaternion();
          const alignWorld = tgtRootWorld.clone().multiply(alignRoot).multiply(tgtRootWorldInv);
          const localDelta = parentW.clone().invert().multiply(alignWorld).multiply(parentW);
          tb.quaternion.premultiply(localDelta).normalize();
          tb.updateWorldMatrix(false, true);
        }
      }
      tgtAlignedRestRoot[k] = tgtRootWorldInv.clone().multiply(tb.getWorldQuaternion(new Quaternion()));
    }

    for (const bone of allBones) bone.quaternion.copy(restQuats.get(bone));
    root.updateMatrixWorld(true);

    const tgtHipParentWorldInv = bones.Hips?.parent
      ? new Matrix4().copy(bones.Hips.parent.matrixWorld).invert()
      : new Matrix4();
    const srcMixer = new AnimationMixer(srcModel);
    const bakedClips = [];

    for (const rawClip of sourceClips) {
      if (!rawClip || !(rawClip.duration > 0)) continue;
      if (filterNames && !filterNames.has(String(rawClip.name || '').toLowerCase())) continue;

      const frames = Math.max(2, Math.round(rawClip.duration * fps) + 1);
      const stepDt = rawClip.duration / (frames - 1);
      const times = new Float32Array(frames);
      const quatBufs = {};
      for (const k of mappedKeys) quatBufs[k] = new Float32Array(frames * 4);
      const hipPosBuf = bones.Hips && srcBones.Hips ? new Float32Array(frames * 3) : null;

      srcMixer.stopAllAction();
      const srcAct = srcMixer.clipAction(rawClip);
      // Use LoopOnce + clampWhenFinished so sampling at t = rawClip.duration evaluates the true
      // terminal pose instead of wrapping back to t = 0 on Three.js's default LoopRepeat.
      srcAct.setLoop(LoopOnce, 1);
      srcAct.clampWhenFinished = true;
      srcAct.reset().play();

      for (let f = 0; f < frames; f++) {
        times[f] = f === frames - 1 ? rawClip.duration : f * stepDt;
        srcMixer.setTime(times[f]);
        srcRoot.updateMatrixWorld(true);

        for (const bone of allBones) bone.quaternion.copy(restQuats.get(bone));
        if (bones.Hips && restHipPos) bones.Hips.position.copy(restHipPos);
        root.updateMatrixWorld(true);

        if (hipPosBuf) {
          const curSrcHip = srcRoot.worldToLocal(worldPos(srcBones.Hips, new Vector3()));
          const deltaRoot = curSrcHip.sub(srcRestHipPos).multiplyScalar(hipScale);
          const targetRootPos = tgtRestHipPos.clone().add(
            new Vector3(deltaRoot.x * hipHorizontalScale, deltaRoot.y * hipVerticalScale, deltaRoot.z * hipHorizontalScale),
          );
          const localHipPos = root.localToWorld(targetRootPos).applyMatrix4(tgtHipParentWorldInv);
          hipPosBuf[f * 3] = localHipPos.x;
          hipPosBuf[f * 3 + 1] = localHipPos.y;
          hipPosBuf[f * 3 + 2] = localHipPos.z;
        }

        for (const k of mappedKeys) {
          const sb = srcBones[k];
          const tb = bones[k];
          const curSrcW = sb.getWorldQuaternion(new Quaternion());
          const deltaW = curSrcW.multiply(srcRestWorld[k].clone().invert());
          const desiredRootQ = deltaW.multiply(tgtAlignedRestRoot[k]);
          const desiredWorldQ = tgtRootWorld.clone().multiply(desiredRootQ);
          const parentW = tb.parent ? tb.parent.getWorldQuaternion(new Quaternion()) : new Quaternion();
          const localQ = parentW.invert().multiply(desiredWorldQ).normalize();
          if (f > 0) {
            const prev = (f - 1) * 4;
            const dot = localQ.x * quatBufs[k][prev] + localQ.y * quatBufs[k][prev + 1]
              + localQ.z * quatBufs[k][prev + 2] + localQ.w * quatBufs[k][prev + 3];
            if (dot < 0) localQ.set(-localQ.x, -localQ.y, -localQ.z, -localQ.w);
          }
          tb.quaternion.copy(localQ);
          tb.updateWorldMatrix(false, true);
          quatBufs[k][f * 4] = localQ.x;
          quatBufs[k][f * 4 + 1] = localQ.y;
          quatBufs[k][f * 4 + 2] = localQ.z;
          quatBufs[k][f * 4 + 3] = localQ.w;
        }
      }

      const tracks = [];
      for (const k of mappedKeys) {
        tracks.push(new QuaternionKeyframeTrack(`${bones[k].uuid}.quaternion`, times, quatBufs[k]));
      }
      if (hipPosBuf) {
        tracks.push(new VectorKeyframeTrack(`${bones.Hips.uuid}.position`, times, hipPosBuf));
      }
      bakedClips.push(new AnimationClip(rawClip.name, rawClip.duration, tracks));
    }

    srcMixer.stopAllAction();
    srcMixer.uncacheRoot(srcModel);

    // Restore original target pose.
    for (const bone of allBones) bone.quaternion.copy(savedTargetQuats.get(bone));
    if (bones.Hips && savedTargetHipPos) bones.Hips.position.copy(savedTargetHipPos);
    root.updateMatrixWorld(true);

    return addClips(bakedClips, opts.aliasMap || {});
  }

  const sockets = new Map();
  function getBone(keyOrName) {
    return bones[keyOrName] || bonesByRawName.get(keyOrName) || null;
  }

  function attachToBone(boneKey, object3D, attachOptions = {}) {
    const bone = getBone(boneKey);
    if (!bone || !object3D) return null;
    root.updateMatrixWorld(true);
    const socket = new Group();
    socket.name = `Socket_${boneKey}`;
    const boneScale = bone.getWorldScale(new Vector3());
    const invX = Math.abs(boneScale.x) > 1e-4 ? 1 / boneScale.x : 1;
    const invY = Math.abs(boneScale.y) > 1e-4 ? 1 / boneScale.y : 1;
    const invZ = Math.abs(boneScale.z) > 1e-4 ? 1 / boneScale.z : 1;
    if (attachOptions.compensateScale !== false) {
      socket.scale.set(invX, invY, invZ);
    }
    if (Array.isArray(attachOptions.position)) socket.position.fromArray(attachOptions.position);
    else if (attachOptions.position?.isVector3) socket.position.copy(attachOptions.position);
    if (Array.isArray(attachOptions.rotation)) socket.rotation.fromArray(attachOptions.rotation);
    else if (attachOptions.rotation?.isEuler) socket.rotation.copy(attachOptions.rotation);
    if (attachOptions.quaternion?.isQuaternion) socket.quaternion.copy(attachOptions.quaternion);
    socket.add(object3D);
    bone.add(socket);
    sockets.set(boneKey, socket);
    root.updateMatrixWorld(true);
    return socket;
  }

  function getSocketWorldPosition(boneKey, localOffset = null, out = new Vector3()) {
    const target = sockets.get(boneKey) || getBone(boneKey) || root;
    root.updateMatrixWorld(true);
    if (localOffset) {
      if (Array.isArray(localOffset)) out.fromArray(localOffset);
      else out.copy(localOffset);
      return target.localToWorld(out);
    }
    return target.getWorldPosition(out);
  }

  let smoothWalk = 0;
  let smoothCrouch = 0;
  let gaitPhase = 0;
  let initializedTransform = false;
  let initializedPose = false;
  let prevWalkA = 0;
  let prevWalkB = 0;
  let prevYaw = 0;

  const telemetry = {
    frames: 0,
    maxBoneStepRad: 0,
    maxBoneRadPerSec: 0,
    maxYawStepRad: 0,
    maxYawRadPerSec: 0,
    walkZeroFlips: 0,
    overExtendedIkCount: 0,
    clipPlayedFrames: 0,
  };

  function resetTelemetry() {
    telemetry.frames = 0;
    telemetry.maxBoneStepRad = 0;
    telemetry.maxBoneRadPerSec = 0;
    telemetry.maxYawStepRad = 0;
    telemetry.maxYawRadPerSec = 0;
    telemetry.walkZeroFlips = 0;
    telemetry.overExtendedIkCount = 0;
    telemetry.clipPlayedFrames = 0;
  }

  function syncTransform(x, y, z, yaw, dt, opts = {}) {
    const safeDt = Math.min(Math.max(Number.isFinite(dt) ? dt : 0, 0), 0.1);
    const posRate = opts.posRate ?? 18;
    const yawRate = opts.yawRate ?? 14;
    const speedRate = opts.speedRate ?? 12;
    const maxSpeed = opts.maxSpeed ?? 4.5;
    const immediate = Boolean(opts.immediate || !initializedTransform);

    if (immediate) {
      root.position.set(x, y, z);
      root.rotation.y = yaw;
      prevYaw = yaw;
      smoothWalk = MathUtils.clamp(opts.speed01 ?? 0, 0, 1);
      prevWalkA = prevWalkB = smoothWalk;
      initializedTransform = true;
      root.updateMatrixWorld(true);
      return smoothWalk;
    }

    const lagDist = Math.hypot(x - root.position.x, z - root.position.z);
    const posAlpha = 1 - Math.exp(-posRate * safeDt);
    root.position.x += (x - root.position.x) * posAlpha;
    root.position.y += (y - root.position.y) * posAlpha;
    root.position.z += (z - root.position.z) * posAlpha;

    const yawDelta = shortestAngleDelta(root.rotation.y, yaw);
    let yawStep = yawDelta * (1 - Math.exp(-yawRate * safeDt));
    const maxYawStep = (opts.maxYawRadPerSec ?? 14) * safeDt;
    if (maxYawStep > 0 && Math.abs(yawStep) > maxYawStep) {
      yawStep = Math.sign(yawStep) * maxYawStep;
    }
    root.rotation.y += yawStep;
    const observedYawStep = Math.abs(shortestAngleDelta(prevYaw, root.rotation.y));
    if (telemetry.frames > 1) {
      if (observedYawStep > telemetry.maxYawStepRad) {
        telemetry.maxYawStepRad = observedYawStep;
      }
      if (safeDt > 1e-4) {
        const observedYawRate = observedYawStep / Math.max(safeDt, 1 / 120);
        if (observedYawRate > telemetry.maxYawRadPerSec) {
          telemetry.maxYawRadPerSec = observedYawRate;
        }
      }
    }
    prevYaw = root.rotation.y;

    const targetSpeed01 = opts.speed01 !== undefined
      ? MathUtils.clamp(opts.speed01, 0, 1)
      : MathUtils.clamp((lagDist * posRate) / Math.max(0.2, maxSpeed), 0, 1);
    smoothWalk = damp(smoothWalk, targetSpeed01, speedRate, safeDt);
    gaitPhase += smoothWalk * (opts.strideRate ?? 8.5) * safeDt;

    if (telemetry.frames > 2 && prevWalkA > 0.15 && prevWalkB < 0.01 && smoothWalk > 0.15) {
      telemetry.walkZeroFlips++;
    }
    prevWalkA = prevWalkB;
    prevWalkB = smoothWalk;

    root.updateMatrixWorld(true);
    return smoothWalk;
  }

  /**
   * Apply a root-space Euler offset (YXZ: rx pitches +Y toward +Z / forward lean,
   * ry twists around +Y, rz tilts around +Z) invariant to each GLB's local bone axes.
   */
  function applyRootEulerOffset(bone, rx, ry, rz) {
    if (!bone || (!rx && !ry && !rz)) return;
    TMP_EULER.set(rx || 0, ry || 0, rz || 0, 'YXZ');
    const rootWorld = root.getWorldQuaternion(TMP_Q1);
    const rootDelta = TMP_Q2.setFromEuler(TMP_EULER);
    const worldDelta = TMP_Q3.copy(rootWorld).multiply(rootDelta).multiply(TMP_Q4.copy(rootWorld).invert());
    const parentWorld = bone.parent ? bone.parent.getWorldQuaternion(TMP_Q1) : TMP_Q1.identity();
    const localDelta = TMP_Q4.copy(parentWorld).invert().multiply(worldDelta).multiply(parentWorld);
    bone.quaternion.premultiply(localDelta).normalize();
    bone.updateWorldMatrix(false, true);
  }

  function update(dt, pose = null) {
    const safeDt = Math.min(Math.max(Number.isFinite(dt) ? dt : 0, 0), 0.1);
    const immediate = Boolean(pose?.immediate || !initializedPose);
    const hasActiveClip = Boolean(activeAction && activeAction.enabled && (activeAction.isRunning() || activeAction.clampWhenFinished));

    if (hasActiveClip) {
      // Restore the last mixer-evaluated pose before mixer.update() so Three.js PropertyMixer's
      // constant-keyframe skip optimization never reads back our post-slerped curQuats.
      for (const bone of allBones) {
        const prevMixerQ = lastMixerQuats.get(bone);
        bone.quaternion.copy(prevMixerQ || restQuats.get(bone));
      }
      mixer.update(safeDt);
      for (const bone of allBones) {
        let saved = lastMixerQuats.get(bone);
        if (!saved) {
          saved = new Quaternion();
          lastMixerQuats.set(bone, saved);
        }
        saved.copy(bone.quaternion);
      }
      telemetry.clipPlayedFrames++;
    } else {
      lastMixerQuats.clear();
      // Compute target pose cleanly from rest pose before slerping persistent curQuats.
      for (const bone of allBones) {
        bone.quaternion.copy(restQuats.get(bone));
      }
      if (bones.Hips && restHipPos) bones.Hips.position.copy(restHipPos);
    }

    const crouchTarget = pose?.crouch ?? (pose && !hasActiveClip ? 0.05 : 0);
    smoothCrouch = immediate ? crouchTarget : damp(smoothCrouch, crouchTarget, pose?.crouchRate ?? 12, safeDt);
    const bob = !hasActiveClip && pose?.autoBob !== false
      ? Math.abs(Math.sin(gaitPhase)) * 0.028 * smoothWalk + Math.sin((pose?.time ?? 0) * 2.2) * 0.008
      : 0;
    mount.position.y = baseMountY - smoothCrouch + bob;
    root.updateMatrixWorld(true);

    if (pose) {
      // 1. Spine, chest, head and shoulders FIRST so arm IK solves from the rotated torso.
      const spineX = pose.spineX ?? 0;
      const spineY = pose.spineY ?? 0;
      const spineZ = pose.spineZ ?? 0;
      applyRootEulerOffset(bones.Spine, spineX * 0.45, spineY * 0.4, spineZ * 0.45);
      applyRootEulerOffset(bones.Spine1, spineX * 0.35, spineY * 0.35, spineZ * 0.35);
      applyRootEulerOffset(bones.Spine2, spineX * 0.2, spineY * 0.25, spineZ * 0.2);
      applyRootEulerOffset(bones.Head, pose.headX ?? -spineX * 0.35, pose.headY ?? -spineY * 0.4, pose.headZ ?? 0);
      applyRootEulerOffset(bones.LeftShoulder, 0, pose.leftShoulderY ?? 0, pose.leftShoulderZ ?? 0);
      applyRootEulerOffset(bones.RightShoulder, 0, pose.rightShoulderY ?? 0, pose.rightShoulderZ ?? 0);

      // 2. Grounded stance + smooth continuous stride when no native clip drives the legs.
      if (!hasActiveClip && pose.autoLegs !== false) {
        const stride = Math.sin(gaitPhase) * 0.48 * smoothWalk;
        const kneeLiftR = Math.max(0, Math.sin(gaitPhase)) * 0.42 * smoothWalk;
        const kneeLiftL = Math.max(0, -Math.sin(gaitPhase)) * 0.42 * smoothWalk;
        const stanceBend = MathUtils.clamp(smoothCrouch * 3.8, 0, 0.72);
        applyRootEulerOffset(bones.RightUpLeg, -stanceBend * 0.55 - stride, 0, -0.04);
        applyRootEulerOffset(bones.LeftUpLeg, -stanceBend * 0.55 + stride, 0, 0.04);
        applyRootEulerOffset(bones.RightLeg, stanceBend * 1.05 + kneeLiftR, 0, 0);
        applyRootEulerOffset(bones.LeftLeg, stanceBend * 1.05 + kneeLiftL, 0, 0);
      }

      // 3. Explicit per-bone root-space Euler overrides (optional).
      if (pose.boneOffsets) {
        for (const [key, rot] of Object.entries(pose.boneOffsets)) {
          const bone = getBone(key);
          if (bone && Array.isArray(rot)) applyRootEulerOffset(bone, rot[0], rot[1], rot[2]);
        }
      }

      root.updateMatrixWorld(true);

      // 4. Reach-clamped analytical 2-bone arm IK with natural outward elbow poles.
      if (pose.rightHand) {
        const target = pose.rightHand.isVector3 ? pose.rightHand : TMP_V4.fromArray(pose.rightHand);
        const pole = pose.rightPole
          ? (pose.rightPole.isVector3 ? pose.rightPole : TMP_V5.fromArray(pose.rightPole))
          : TMP_V5.set(metrics.rightArm.shoulderLocal.x - 0.55, metrics.rightArm.shoulderLocal.y - 0.28, metrics.rightArm.shoulderLocal.z - 0.55);
        solveTwoBoneIK(root, bones.RightArm, bones.RightForeArm, bones.RightHand, target, pole, telemetry);
      }
      if (pose.leftHand) {
        const target = pose.leftHand.isVector3 ? pose.leftHand : TMP_V4.fromArray(pose.leftHand);
        const pole = pose.leftPole
          ? (pose.leftPole.isVector3 ? pose.leftPole : TMP_V5.fromArray(pose.leftPole))
          : TMP_V5.set(metrics.leftArm.shoulderLocal.x + 0.55, metrics.leftArm.shoulderLocal.y - 0.28, metrics.leftArm.shoulderLocal.z - 0.55);
        solveTwoBoneIK(root, bones.LeftArm, bones.LeftForeArm, bones.LeftHand, target, pole, telemetry);
      }
    }

    // 5. Persistent per-bone Quaternion.slerp + angular velocity clamp (kills 1-frame 120-deg snaps).
    const poseRate = pose?.rate ?? (hasActiveClip ? 28 : 16);
    const maxStepRad = pose?.maxStepRad ?? Math.max(0.08, (pose?.maxRadPerSec ?? 16) * Math.max(safeDt, 1 / 120));
    const slerpAlpha = immediate ? 1 : 1 - Math.exp(-poseRate * safeDt);
    let frameMaxBoneStep = 0;

    for (const bone of allBones) {
      const targetQ = TMP_Q1.copy(bone.quaternion).normalize();
      const currentQ = curQuats.get(bone);
      if (immediate) {
        currentQ.copy(targetQ);
        bone.quaternion.copy(currentQ);
        continue;
      }
      const nextQ = TMP_Q2.copy(currentQ).slerp(targetQ, slerpAlpha);
      const stepAngle = currentQ.angleTo(nextQ);
      if (stepAngle > maxStepRad && stepAngle > 1e-6) {
        const clampedT = maxStepRad / stepAngle;
        nextQ.slerpQuaternions(currentQ, targetQ, Math.min(1, slerpAlpha * clampedT));
      }
      const appliedAngle = currentQ.angleTo(nextQ);
      if (appliedAngle > frameMaxBoneStep) frameMaxBoneStep = appliedAngle;
      currentQ.copy(nextQ);
      bone.quaternion.copy(currentQ);
    }

    if (telemetry.frames > 1) {
      if (frameMaxBoneStep > telemetry.maxBoneStepRad) {
        telemetry.maxBoneStepRad = frameMaxBoneStep;
      }
      if (safeDt > 1e-4) {
        const observedBoneRate = frameMaxBoneStep / Math.max(safeDt, 1 / 120);
        if (observedBoneRate > telemetry.maxBoneRadPerSec) {
          telemetry.maxBoneRadPerSec = observedBoneRate;
        }
      }
    }
    telemetry.frames++;
    initializedPose = true;
    root.updateMatrixWorld(true);
    return { walk01: smoothWalk, frameMaxBoneStep };
  }

  return {
    root,
    mount,
    model,
    bones,
    mixer,
    metrics,
    get clipNames() { return [...clips.keys()]; },
    get hasNativeClips() { return clips.size > 0; },
    get activeClip() { return activeClipName; },
    get walk01() { return smoothWalk; },
    getBone,
    addClips,
    retargetClipsFrom,
    playClip,
    playOnce,
    stopClips,
    attachToBone,
    getSocketWorldPosition,
    syncTransform,
    update,
    resetTelemetry,
    getTelemetry: () => ({
      ...telemetry,
      boneCount: metrics.boneCount,
      clipCount: clips.size,
      clipNames: [...clips.keys()],
      attachedSockets: [...sockets.keys()],
      hasNativeClips: clips.size > 0,
    }),
    dispose: () => {
      pendingReturn = null;
      mixer.removeEventListener('finished', onActionFinished);
      mixer.stopAllAction();
      mixer.uncacheRoot(model);
    },
  };
}
