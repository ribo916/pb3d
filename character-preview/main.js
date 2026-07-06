import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { ASSET_MANIFEST } from '../assets/manifest.js';
import { makeGltfLoader, preloadPlayerModels } from '../src/assets.js';

const statusEl = document.getElementById('status');
const frameInfoEl = document.getElementById('frameInfo');
const characterButtonsEl = document.getElementById('characterButtons');
const clipButtonsEl = document.getElementById('clipButtons');
const topPicksButtonsEl = document.getElementById('topPicksButtons');
const skeletonButtonsEl = document.getElementById('skeletonButtons');
const playPauseEl = document.getElementById('playPause');
const scrubEl = document.getElementById('scrub');
const speedEl = document.getElementById('speed');
const skeletonOverlayEl = document.getElementById('skeletonOverlay');
const rawSkeletonBesideEl = document.getElementById('rawSkeletonBeside');

function setStatus(msg, isError = false) {
  statusEl.textContent = msg;
  statusEl.classList.toggle('error', isError);
}

// --- scene setup ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1b1e24);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.01, 100);
camera.position.set(2.2, 1.6, 2.6);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.getElementById('viewport').appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1, 0);
controls.enableDamping = true;

scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.2));
const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
keyLight.position.set(3, 5, 4);
scene.add(keyLight);
const rimLight = new THREE.DirectionalLight(0x88aaff, 0.6);
rimLight.position.set(-3, 2, -4);
scene.add(rimLight);

const grid = new THREE.GridHelper(6, 24, 0x555555, 0x333333);
scene.add(grid);
const axes = new THREE.AxesHelper(0.5);
scene.add(axes);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- catalog + loading ---
// Characters come from assets/manifest.js -- the same catalog the real game
// reads -- instead of a second hardcoded list. Character GLBs are fetched
// lazily via src/assets.js's preloadPlayerModels(), which is also what the
// real game and character picker use, so this tool never diverges from the
// shipped fetch/fallback/caching behavior. The 7 raw-FBX sport clips have no
// shipped/optimized equivalent -- nothing has been built or cut from them --
// so they stay on the original raw FBX + FBXLoader path below, fetched from
// the untracked character-preview/local-clips/ folder.
const fbxLoader = new FBXLoader();
const gltfLoader = makeGltfLoader();

function loadFbx(url) {
  return new Promise((resolve, reject) => {
    fbxLoader.load(url, resolve, undefined, reject);
  });
}

function loadGlb(url) {
  return new Promise((resolve, reject) => {
    gltfLoader.load(url, resolve, undefined, reject);
  });
}

const CHARACTERS = ASSET_MANIFEST.models
  .filter((m) => /^player-ch\d{2}-v1$/.test(m.key))
  .map((m) => ({ key: m.key, label: 'CH' + m.key.match(/ch(\d{2})/)[1] }))
  .sort((a, b) => a.label.localeCompare(b.label));

// forehand/backhand/overhead ship inside one shared, already-fixed GLB (see
// assets/manifest.js's 'mixamo-swings' entry -- this is the same file the
// real game loads). Bone names are canonical `mixamorig:Name` at rest, which
// three's GLTFLoader sanitizes to `mixamorigName` at runtime -- the exact
// same convention detectBonePrefix()/retargetClipNames() below already
// produce for the FBX-sourced clips, so no separate retargeting path is
// needed for these three.
const GLB_CLIP_LIBRARY_URL = (ASSET_MANIFEST.animations.find((a) => a.key === 'mixamo-swings') || {}).url;
const GLB_CLIP_LABELS = { forehand: 'Forehand', backhand: 'Backhand', overhead: 'Overhead' };

const CLIP_SOURCES = [
  { key: 'tennis-full', url: './local-clips/tennis-source.fbx', label: 'Tennis Source (full)' },
  { key: 'golf', url: './local-clips/golf.fbx', label: 'Golf Swing' },
  { key: 'baseball-batter', url: './local-clips/baseball-batter.fbx', label: 'Baseball Batter' },
  { key: 'baseball-pitcher', url: './local-clips/baseball-pitcher.fbx', label: 'Baseball Pitcher' },
  { key: 'soccer-penalty', url: './local-clips/soccer-penalty.fbx', label: 'Soccer Penalty Kick' },
  { key: 'soccer-passing', url: './local-clips/soccer-passing.fbx', label: 'Soccer Passing' },
  { key: 'football-qb', url: './local-clips/football-qb.fbx', label: 'Football QB' },
];

// One representative clip per `_top_picks` category (11 categories, 51 raw
// files total -- the user asked to preview one-per-folder for now rather than
// all 51; see character-preview/local-clips/top-picks/<category>/ for the
// rest if a different pick is wanted later). These are Unreal Engine 5 "Manny"
// mannequin mocap exports (Epic's free Paragon animation packs retargeted to
// the standard UE5 skeleton) -- a totally different bone-naming/hierarchy
// convention (`pelvis`, `clavicle_l`, `upperarm_l`, `calf_l`, ...) than the
// Mixamo `mixamorig*` rig these characters use, and skeleton-only (no mesh).
// See retargetMannyClip() below for how these get mapped onto the active
// character.
const TOP_PICKS = [
  { key: 'tp-idle', category: 'idle', label: 'Idle', url: './local-clips/top-picks/idle/Idle__AuroraManny.FBX' },
  { key: 'tp-ready', category: 'ready', label: 'Ready Stance', url: './local-clips/top-picks/ready/Steel_Idle_PreJump_ReadyPose__steelmanny.FBX' },
  { key: 'tp-run', category: 'run', label: 'Run (Fwd Jog)', url: './local-clips/top-picks/run/Jog_Fwd__AuroraManny.FBX' },
  { key: 'tp-backpedal', category: 'backpedal', label: 'Backpedal', url: './local-clips/top-picks/backpedal/Sprint_Backpedal__KallariManny.FBX' },
  { key: 'tp-side-shuffle', category: 'side_shuffle', label: 'Side Shuffle (Strafe L)', url: './local-clips/top-picks/side_shuffle/Strafe_Left__KhaimeraManny.FBX' },
  { key: 'tp-pivot-spin', category: 'pivot_spin', label: 'Pivot Spin (Fwd 180)', url: './local-clips/top-picks/pivot_spin/Jog_Fwd_Pivot180__DekkerManny.FBX' },
  { key: 'tp-serve', category: 'serve', label: 'Serve (Swing, Medium)', url: './local-clips/top-picks/serve/Primary_Swing1_Medium__NarbashManny.FBX' },
  { key: 'tp-jump-smash', category: 'jump_smash', label: 'Jump Smash (Apex)', url: './local-clips/top-picks/jump_smash/Jump_Apex__CrunchManny.FBX' },
  { key: 'tp-dive', category: 'dive', label: 'Dive (Fwd Roll)', url: './local-clips/top-picks/dive/Dive_Fwd_Roll__TwinBlastManny.FBX' },
  { key: 'tp-hit-react', category: 'hit_react', label: 'Hit React (Front)', url: './local-clips/top-picks/hit_react/HitReact_Front__AuroraManny.FBX' },
  { key: 'tp-victory', category: 'victory_celebration', label: 'Victory Emote', url: './local-clips/top-picks/victory_celebration/Victory_Emote__KallariManny.FBX' },
];

// Manny (UE5 mannequin) bone name -> mixamorig bone suffix, for the main
// rotation-driving joints only. Corrective/twist/IK-helper bones (calf_knee_*,
// upperarm_twist_*, ik_foot_*, finger bones, ...) carry no independent
// storytelling motion for a "should I use this clip" review, so they're left
// unmapped/dropped rather than chased down one-by-one.
const MANNY_BONE_MAP = {
  spine_01: 'Spine',
  spine_02: 'Spine1',
  spine_03: 'Spine2',
  neck_01: 'Neck',
  head: 'Head',
  clavicle_l: 'LeftShoulder',
  upperarm_l: 'LeftArm',
  lowerarm_l: 'LeftForeArm',
  hand_l: 'LeftHand',
  clavicle_r: 'RightShoulder',
  upperarm_r: 'RightArm',
  lowerarm_r: 'RightForeArm',
  hand_r: 'RightHand',
  thigh_l: 'LeftUpLeg',
  calf_l: 'LeftLeg',
  foot_l: 'LeftFoot',
  ball_l: 'LeftToeBase',
  thigh_r: 'RightUpLeg',
  calf_r: 'RightLeg',
  foot_r: 'RightFoot',
  ball_r: 'RightToeBase',
};

// Reverse of MANNY_BONE_MAP (target suffix -> source name), used to look up
// a BONE'S PARENT's source-side name -- e.g. given target suffix
// "LeftForeArm", its parent suffix is "LeftArm" (TARGET_PARENT), and this
// map turns that back into "upperarm_l" so the elbow-bend fix in
// retargetMannyClip can find the SOURCE parent's own rest/current world
// quaternion (already computed for every MANNY_BONE_MAP key by
// computeSourceWorldFrames, no extra plumbing needed).
const SOURCE_NAME_FOR_TARGET_SUFFIX = Object.fromEntries(
  Object.entries(MANNY_BONE_MAP).map(([source, target]) => [target, source])
);

// Target (mixamorig) bone suffix -> its immediate parent's suffix within our
// mapped set (Hips is the root of this set -- it has no entry here and is
// retargeted separately, see the Hips block in retargetMannyClip). Confirmed
// against the real hierarchy (dumping `bone.children` for the loaded GLB
// characters), not assumed. Needed for the world-space FK retarget below:
// converting a bone's newly-computed WORLD rotation back into the LOCAL
// rotation an AnimationClip track actually needs requires dividing out that
// SAME bone's parent's world rotation -- and since we're retargeting parents
// before children (MANNY_BONE_MAP's iteration order already respects this),
// "parent's world rotation" means the parent's own JUST-COMPUTED retargeted
// value for this frame, not its rest pose.
// For each mapped SOURCE bone, its own immediate child bone in the RAW
// Manny hierarchy (confirmed via a live hierarchy dump, not assumed --
// e.g. spine_03's real child is spine_04, an unmapped intermediate vertebra;
// clavicle_l/clavicle_r/neck_01 all actually parent off spine_05, two
// vertebrae further up than MANNY_BONE_MAP's coarse spine_03->Spine2 stop).
// Used ONLY to compute a WORLD-SPACE aim/swing direction for that bone (see
// retargetMannyClip's world-space-swing doc comment) -- never to walk the
// chain, so an unmapped intermediate child (spine_04, neck_02) is fine here.
// Bones with no single clean "next" bone (head, hands, toe bases -- leaves,
// or fanning into many corrective/finger children) are omitted and fall back
// to the older per-bone quaternion-delta method.
const SWING_SOURCE_CHILD = {
  spine_01: 'spine_02',
  spine_02: 'spine_03',
  spine_03: 'spine_04',
  neck_01: 'neck_02',
  clavicle_l: 'upperarm_l',
  upperarm_l: 'lowerarm_l',
  lowerarm_l: 'hand_l',
  clavicle_r: 'upperarm_r',
  upperarm_r: 'lowerarm_r',
  lowerarm_r: 'hand_r',
  thigh_l: 'calf_l',
  calf_l: 'foot_l',
  foot_l: 'ball_l',
  thigh_r: 'calf_r',
  calf_r: 'foot_r',
  foot_r: 'ball_r',
  // Hands: use the middle finger's metacarpal (confirmed a real child of
  // hand_l/hand_r in the raw hierarchy) purely as a "which way is the hand
  // pointing" aim reference -- not tracked/retargeted itself.
  hand_l: 'middle_metacarpal_l',
  hand_r: 'middle_metacarpal_r',
};

// Same idea, for the TARGET (mixamorig) suffix -- its own immediate child
// bone within our tracked chain (confirmed against the live character
// hierarchy). Every entry here has a matching SWING_SOURCE_CHILD entry for
// its MANNY_BONE_MAP source name; where either side is missing, that bone
// uses the quaternion-delta fallback instead (see retargetMannyClip).
const SWING_TARGET_CHILD = {
  Spine: 'Spine1',
  Spine1: 'Spine2',
  Spine2: 'Neck',
  Neck: 'Head',
  LeftShoulder: 'LeftArm',
  LeftArm: 'LeftForeArm',
  LeftForeArm: 'LeftHand',
  RightShoulder: 'RightArm',
  RightArm: 'RightForeArm',
  RightForeArm: 'RightHand',
  LeftUpLeg: 'LeftLeg',
  LeftLeg: 'LeftFoot',
  LeftFoot: 'LeftToeBase',
  RightUpLeg: 'RightLeg',
  RightLeg: 'RightFoot',
  RightFoot: 'RightToeBase',
  // See SWING_SOURCE_CHILD's hand_l/hand_r comment -- LeftHandMiddle1/
  // RightHandMiddle1 are real children of LeftHand/RightHand, used the same
  // way, purely as an aim reference.
  LeftHand: 'LeftHandMiddle1',
  RightHand: 'RightHandMiddle1',
};

const TARGET_PARENT = {
  Spine: 'Hips',
  Spine1: 'Spine',
  Spine2: 'Spine1',
  Neck: 'Spine2',
  Head: 'Neck',
  LeftShoulder: 'Spine2',
  LeftArm: 'LeftShoulder',
  LeftForeArm: 'LeftArm',
  LeftHand: 'LeftForeArm',
  RightShoulder: 'Spine2',
  RightArm: 'RightShoulder',
  RightForeArm: 'RightArm',
  RightHand: 'RightForeArm',
  LeftUpLeg: 'Hips',
  LeftLeg: 'LeftUpLeg',
  LeftFoot: 'LeftLeg',
  LeftToeBase: 'LeftFoot',
  RightUpLeg: 'Hips',
  RightLeg: 'RightUpLeg',
  RightFoot: 'RightLeg',
  RightToeBase: 'RightFoot',
};

// Bones whose RAW bind pose is dramatically different from a relaxed
// standing pose -- confirmed by screenshot: with the character otherwise
// correctly retargeted, arms sat perfectly horizontal (a literal T-pose)
// during any clip stretch with little arm motion (idle, victory holds, ...),
// because ANY delta-from-rest method reduces to "show the target's own rest
// pose" whenever the source barely moves, and this rig's authored rest for
// the arms IS a T-pose, not a relaxed hang. These get an extra,
// per-character-measured correction (see computeHangDownOffsetWorld)
// rotating the baseline from "arm out horizontal" to "arm hangs by the side"
// before the clip's own motion is composed on top.
//
// LeftForeArm/RightForeArm NEED this too, for a second, DIFFERENT reason
// specific to the world-space SWING method (see retargetMannyClip): a raw
// T-pose forearm points almost exactly along the arm's OWN natural swing
// axis (mediolateral, left-right) -- a running arm's elbow segment swings
// by rotating roughly ABOUT that same left-right axis, so applying that
// rotation to a vector that ALREADY points along it is the textbook
// degenerate case (rotating a vector around an axis parallel to itself does
// almost nothing). Confirmed by measurement: with the raw T-pose baseline,
// the retargeted forearm's aim direction stayed pinned within a few percent
// of literal-T-pose-horizontal for the ENTIRE `run` clip (user-reported
// "runs like a fairy" -- arms held out, not swinging) while the SOURCE
// forearm swept through a wide, clearly time-varying range over the same
// clip. The upper arm's own hang-down correction alone does NOT fix this --
// it only fixes ITS OWN bone's degenerate alignment, not its child's -- the
// forearm needs the SAME kind of correction applied to ITS OWN rest baseline
// (hanging straight down, i.e. continuing the upper arm's line) so its own
// swing axis and rest direction are no longer parallel.
//
// LeftHand/RightHand, now also swing-transferred (see SWING_SOURCE_CHILD/
// SWING_TARGET_CHILD's hand entries), need it for the same forearm reason:
// a raw T-pose hand also points along the arm's own horizontal line.
const NEUTRAL_OFFSET_BONES = ['LeftForeArm', 'RightForeArm', 'LeftHand', 'RightHand'];

let mixer = null;
let currentAction = null;
let currentClip = null;
let scrubbing = false;

// Grounds `object` at y=0 and fits the camera/grid to `box` (already
// measured in object's current position). Shared by frameCameraToObject
// (mesh-based bounds) and the raw-skeleton preview (bone-position-based
// bounds -- there's no mesh geometry to measure there).
function frameCameraToBounds(object, box) {
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);

  // Ground the model at y=0 regardless of its authored origin.
  object.position.y -= box.min.y;
  object.updateMatrixWorld(true);
  box.translate(new THREE.Vector3(0, -box.min.y, 0));
  box.getCenter(center);

  const height = size.y || 1;
  grid.scale.setScalar(Math.max(height, 1) * 1.5);

  controls.target.set(center.x, height * 0.55, center.z);
  const dist = height * 1.8;
  camera.position.set(center.x + dist * 0.6, height * 0.7, center.z + dist * 0.85);
  camera.near = height / 100;
  camera.far = height * 100;
  camera.updateProjectionMatrix();
}

function frameCameraToObject(object) {
  // matrixWorld must be current before measuring bounds -- `object` was just
  // reparented (scene.add) and/or repositioned, and neither updates
  // descendant matrixWorld until the next render pass.
  object.updateMatrixWorld(true);
  // `precise: true` applies real per-vertex skin deformation instead of
  // trusting each mesh node's own local matrix -- required for the
  // Blender/glTF-converted Mixamo characters (ch01-12.glb), whose mesh nodes
  // sit under a rotated+rescaled Armature wrapper; the imprecise mode misreads
  // their true bind-pose bounds as a tiny near-zero "needle" (same bug fixed
  // in tools/validate-player-glb.mjs), which grounds the model at the wrong
  // height and makes it float above (or sink into) the grid.
  const box = new THREE.Box3().setFromObject(object, true);
  frameCameraToBounds(object, box);
}

// Bone-position-based bounds for the raw-skeleton preview: there's no mesh
// geometry to hand to Box3.setFromObject (FBX animation-only exports carry
// no skin), so bounds come from each bone's own world position instead.
function computeBoneBounds(root) {
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  let any = false;
  root.traverse((o) => {
    if (o.isBone) {
      o.getWorldPosition(v);
      box.expandByPoint(v);
      any = true;
    }
  });
  return any ? box : null;
}

function buildClipButton(key, label, onClick) {
  const btn = document.createElement('button');
  btn.textContent = label;
  btn.dataset.clip = key;
  btn.addEventListener('click', () => onClick(btn));
  clipButtonsEl.appendChild(btn);
  return btn;
}

function buildTopPickButton(key, label, onClick) {
  const btn = document.createElement('button');
  btn.textContent = label;
  btn.dataset.clip = key;
  btn.addEventListener('click', () => onClick(btn));
  topPicksButtonsEl.appendChild(btn);
  return btn;
}

function buildSkeletonButton(key, label, onClick) {
  const btn = document.createElement('button');
  btn.textContent = label;
  btn.dataset.clip = key;
  btn.addEventListener('click', () => onClick(btn));
  skeletonButtonsEl.appendChild(btn);
  return btn;
}

function buildCharacterButton(key, label) {
  const btn = document.createElement('button');
  btn.textContent = label;
  btn.dataset.character = key;
  btn.addEventListener('click', () => activateCharacter(key));
  characterButtonsEl.appendChild(btn);
  return btn;
}

const clips = new Map(); // name -> THREE.AnimationClip, scoped to the active character
let character = null;
let currentBonePrefix = 'mixamorig';
let currentTargetRestPose = null; // { restQuats, restPositions }, captured fresh per character activation
let glbSwingClips = null; // THREE.AnimationClip[] from pickleball-swings.glb, loaded once at init()

// THREE.SkeletonHelper drawn directly on the ACTIVE (retargeted) character,
// so its actual bone positions/orientations can be visually compared,
// in-place, against the raw-skeleton preview -- the debug visualization the
// user explicitly asked for (twice, per CONTEXT.md) instead of trusting a
// skinned mesh's silhouette alone to judge joint angles. Recreated on every
// character activation (a fresh SkeletonHelper per skeleton), visibility
// persists across character switches via skeletonOverlayVisible.
let skeletonOverlayHelper = null;
let skeletonOverlayVisible = false;

// Raw-skeleton-beside-character comparison: a SECOND, independent copy of
// the currently-playing top-pick clip's native rig, positioned next to the
// character and driven in lockstep with the character's OWN action time
// every frame (see animate() below) -- so both skeletons visibly move
// together, live, in the SAME view, instead of requiring separate
// screenshots at guessed camera angles to compare (which turned out to be
// actively misleading -- see CONTEXT.md's item 12 for how a mismatched
// camera angle alone made a correctly-retargeted run cycle look completely
// wrong). Synchronization works because the retargeted clip's tracks reuse
// the SOURCE clip's own keyframe `times` array verbatim (see
// `computeSourceWorldFrames`/`retargetMannyClip`), so the same `action.time`
// value lands on the same point in both animations. Rebuilt whenever the
// active top-pick clip or character changes; torn down for non-top-pick
// clips (forehand/backhand/... and the raw FBX sport clips have no raw
// Manny skeleton to compare against).
let comparisonSkeleton = null; // { root, mixer, action, helper, clipKey } | null
let comparisonSkeletonVisible = false;

function teardownComparisonSkeleton() {
  if (!comparisonSkeleton) return;
  scene.remove(comparisonSkeleton.root);
  scene.remove(comparisonSkeleton.helper);
  comparisonSkeleton = null;
}

// Builds (or rebuilds, if the clip changed) the comparison skeleton for the
// CURRENTLY ACTIVE top-pick clip, cloning the same raw FBX `retargetMannyClip`
// itself reads from (never the shared cached object -- see that function's
// doc comment for why mutating it would corrupt future retargets). Scaled
// to roughly match the active character's own height (computed once, from
// each skeleton's own bone-position bounding box) purely so the two are
// visually comparable side by side -- this scale has no bearing on
// correctness, only on making the comparison legible. Positioned at a fixed
// world-space offset alongside the character.
function rebuildComparisonSkeletonIfNeeded(clipKey, fbx, rawClip) {
  if (comparisonSkeleton && comparisonSkeleton.clipKey === clipKey) return;
  teardownComparisonSkeleton();
  if (!character) return;

  const root = fbx.clone(true);
  root.rotation.set(-Math.PI / 2, 0, 0); // same Z-up -> Y-up fix as activateSkeletonClip
  root.updateMatrixWorld(true);

  const rawBox = computeBoneBounds(root);
  const charBox = computeBoneBounds(character);
  if (rawBox && charBox) {
    const rawHeight = rawBox.max.y - rawBox.min.y || 1;
    const charHeight = charBox.max.y - charBox.min.y || 1;
    const scale = charHeight / rawHeight;
    root.scale.setScalar(scale);
    root.updateMatrixWorld(true);
  }
  // Re-measure after scaling to ground it at y=0 and offset it beside the
  // character (a fixed world-space gap, not proportional to width, so it
  // stays a comfortable comparison distance regardless of pose).
  const scaledBox = computeBoneBounds(root);
  if (scaledBox) {
    root.position.y -= scaledBox.min.y;
    root.position.x += 1.2;
  }
  scene.add(root);

  const helper = new THREE.SkeletonHelper(root);
  scene.add(helper);
  helper.visible = comparisonSkeletonVisible;
  root.visible = comparisonSkeletonVisible;

  const mixer = new THREE.AnimationMixer(root);
  const action = mixer.clipAction(rawClip);
  action.setLoop(THREE.LoopRepeat, Infinity);
  action.play();

  comparisonSkeleton = { root, mixer, action, helper, clipKey };
  window.__comparisonSkeleton = comparisonSkeleton; // ad-hoc Playwright/devtools inspection, see window.__poc
}

// Raw-skeleton preview state (see activateSkeletonClip below): plays a
// top-picks clip on ITS OWN native rig, no retargeting at all, as a
// ground-truth reference for judging a clip when the retargeted-onto-
// character version looks wrong -- reuses the shared mixer/currentAction/
// currentClip/play-pause/scrub wiring (so those controls "just work" for
// this mode too) but swaps `mixer` to point at a fresh AnimationMixer built
// directly on the loaded FBX root instead of the character.
let skeletonPreviewActive = false;
let skeletonPreviewRoot = null; // the raw FBX root currently in the scene, or null
let skeletonPreviewHelper = null; // its THREE.SkeletonHelper, or null
let characterMixer = null; // the character's own mixer, stashed here while skeleton mode borrows `mixer`

function exitSkeletonPreview() {
  if (!skeletonPreviewActive) return;
  skeletonPreviewActive = false;
  if (skeletonPreviewHelper) { scene.remove(skeletonPreviewHelper); skeletonPreviewHelper = null; }
  if (skeletonPreviewRoot) { scene.remove(skeletonPreviewRoot); skeletonPreviewRoot = null; }
  if (character) character.visible = true;
  if (characterMixer) mixer = characterMixer;
}

// Raw FBX clip sources are fetched at most once (network cost); the
// retargeted/stripped/frozen clip derived from them is per-active-character
// and gets rebuilt (cheaply, from the cached raw data) on every activation.
const rawFbxCache = new Map(); // clipKey -> loaded FBX root object
const fbxLoadPromises = new Map(); // clipKey -> in-flight load promise, deduped

function setActiveClipButton(name) {
  for (const btn of clipButtonsEl.children) btn.classList.toggle('active', btn.dataset.clip === name);
  for (const btn of topPicksButtonsEl.children) btn.classList.toggle('active', btn.dataset.clip === name);
  for (const btn of skeletonButtonsEl.children) btn.classList.toggle('active', btn.dataset.clip === name);
}

function playClip(name) {
  const clip = clips.get(name);
  if (!clip || !mixer) return;

  // Switching to a character-driven clip while the raw-skeleton preview was
  // showing -- tear that down and bring the character back.
  exitSkeletonPreview();

  // The raw-skeleton-beside-character comparison only applies to the
  // top-pick clip it was built for; switching to any other clip
  // (forehand/backhand/... or a different top pick) invalidates it.
  // activateMannyClip rebuilds it right after this call for its own clip.
  if (comparisonSkeleton && comparisonSkeleton.clipKey !== name) teardownComparisonSkeleton();

  if (currentAction) currentAction.stop();
  currentAction = mixer.clipAction(clip);
  currentAction.reset();
  currentAction.setLoop(THREE.LoopRepeat, Infinity);
  currentAction.timeScale = Number(speedEl.value);
  currentAction.play();
  currentClip = clip;

  scrubEl.value = '0';
  playPauseEl.textContent = 'Pause';
  currentAction.paused = false;
  scrubbing = false;

  setActiveClipButton(name);
}

playPauseEl.addEventListener('click', () => {
  if (!currentAction) return;
  currentAction.paused = !currentAction.paused;
  playPauseEl.textContent = currentAction.paused ? 'Play' : 'Pause';
});

skeletonOverlayEl.addEventListener('click', () => {
  skeletonOverlayVisible = !skeletonOverlayVisible;
  if (skeletonOverlayHelper) skeletonOverlayHelper.visible = skeletonOverlayVisible;
  skeletonOverlayEl.textContent = skeletonOverlayVisible ? 'Hide Skeleton Overlay' : 'Show Skeleton Overlay';
});

rawSkeletonBesideEl.addEventListener('click', () => {
  comparisonSkeletonVisible = !comparisonSkeletonVisible;
  if (comparisonSkeleton) {
    comparisonSkeleton.root.visible = comparisonSkeletonVisible;
    comparisonSkeleton.helper.visible = comparisonSkeletonVisible;
  } else if (comparisonSkeletonVisible && currentClip) {
    // Turned on with no comparison built yet (e.g. a top-pick clip is
    // already playing from before this toggle existed this session) --
    // build it now if the active clip has a cached raw source.
    const activeKey = [...clips.entries()].find(([, c]) => c === currentClip)?.[0];
    const cachedFbx = activeKey ? rawFbxCache.get(activeKey) : null;
    if (cachedFbx) rebuildComparisonSkeletonIfNeeded(activeKey, cachedFbx, cachedFbx.animations[0]);
  }
  rawSkeletonBesideEl.textContent = comparisonSkeletonVisible ? 'Hide Raw Skeleton Beside' : 'Show Raw Skeleton Beside (synced)';
});

scrubEl.addEventListener('input', () => {
  if (!currentAction || !currentClip) return;
  scrubbing = true;
  currentAction.paused = true;
  playPauseEl.textContent = 'Play';
  currentAction.time = Number(scrubEl.value) * currentClip.duration;
  mixer.update(0);
});

speedEl.addEventListener('input', () => {
  if (currentAction) currentAction.timeScale = Number(speedEl.value);
});

// Mixamo prefixes every bone with "mixamorig" plus a per-download session
// number (mixamorig7Hips, mixamorig2Hips, ...) to avoid collisions when
// multiple rigs are imported into one DCC scene. Two separately-downloaded
// exports (a character and an animation) can end up with different numeric
// suffixes even though the underlying rig/rest pose is identical, so
// THREE.AnimationMixer's name-based track binding silently matches nothing.
// Detect the ACTIVE character's actual prefix and rewrite every incoming
// clip's track names to match it before registering the clip. This mutates
// track names in place and is idempotent/re-appliable, so simply re-running
// it against the cached raw clip data each time the active character changes
// is enough -- no manual clip cloning needed.
function detectBonePrefix(characterObj) {
  let bonePrefix = 'mixamorig';
  characterObj.traverse((obj) => {
    const m = /^(mixamorig\d*)Hips$/.exec(obj.name || '');
    if (m) bonePrefix = m[1];
  });
  return bonePrefix;
}

function retargetClipNames(clip, bonePrefix) {
  clip.tracks.forEach((track) => {
    track.name = track.name.replace(/^mixamorig\d*/, bonePrefix);
  });
  return clip;
}

// These clips are mocap captured on one specific performer, then applied
// across six differently-proportioned characters. Rotation transfers fine
// (that's the whole motion), but every non-root bone also carries a baked
// .position track holding that performer's own ABSOLUTE bone-to-bone offset
// (e.g. their real ~11cm neck-to-head distance) and a near-1 .scale track.
// Applying those verbatim overrides each target character's own bind-pose
// bone length the instant any clip plays -- on a short-necked stylized
// character that stretches the neck to the performer's real proportions,
// invisible only in the untouched T-pose. A correct humanoid retarget only
// transfers rotation for non-root bones; position/scale should come from the
// target's own rig. Root (Hips) keeps its position track since that's
// legitimate root motion, not bone length.
function stripNonRootPositionAndScale(clip, bonePrefix) {
  const rootPosition = `${bonePrefix}Hips.position`;
  clip.tracks = clip.tracks.filter((track) => {
    const isPositionOrScale = track.name.endsWith('.position') || track.name.endsWith('.scale');
    return !isPositionOrScale || track.name === rootPosition;
  });
  return clip;
}

// These are one-shot swing clips looped with LoopRepeat for continuous
// preview, but Mixamo bakes real forward root motion into the Hips position
// track (the character steps into the swing) and the clip does not return to
// its start position -- so each loop iteration would carry the character
// further off-screen. Freeze the Hips track's horizontal (X/Z) motion so the
// swing plays in place; vertical (Y) motion (weight drop/rise) is left intact
// since that's part of the pose, not travel.
function freezeRootHorizontalMotion(clip, bonePrefix) {
  const track = clip.tracks.find((t) => t.name === `${bonePrefix}Hips.position`);
  if (!track) return clip;
  const v = track.values;
  for (let i = 0; i < v.length; i += 3) {
    v[i] = 0;
    v[i + 2] = 0;
  }
  return clip;
}

// Measures the WORLD-space rotation that would swing `bone`'s child to
// point straight down -- i.e. a per-character-measured "T-pose arm ->
// hanging arm" correction, not a guessed constant. Works entirely in world
// space (bone's live accumulated orientation, from matrixWorld) so it
// composes correctly with the world-space FK retarget in retargetMannyClip
// below -- no assumption about either rig's local axis convention.
function computeHangDownOffsetWorld(bone) {
  const child = bone.children.find((c) => c.isBone);
  if (!child) return null;
  const worldQuat = new THREE.Quaternion();
  bone.getWorldQuaternion(worldQuat);
  const currentDirWorld = child.position.clone().normalize().applyQuaternion(worldQuat).normalize();
  const down = new THREE.Vector3(0, -1, 0);
  if (currentDirWorld.lengthSq() < 1e-8) return null;
  return new THREE.Quaternion().setFromUnitVectors(currentDirWorld, down);
}

// Captures each of the active character's mapped bones' REST-pose local AND
// WORLD quaternion/position, keyed by short mixamorig suffix ("Hips",
// "LeftArm", ...), plus per-bone neutral-pose corrections for
// NEUTRAL_OFFSET_BONES (see its comment). Must be called right after a
// character loads and before any clip plays -- once a mixer starts driving
// the skeleton these values are no longer the bind pose. Used as the
// reference frame for retargetMannyClip()'s world-space FK transfer below.
function captureTargetRestPose(characterObj, bonePrefix) {
  const restQuats = new Map();
  const restWorldQuats = new Map();
  const restWorldPositions = new Map();
  const restPositions = new Map();
  const neutralOffsetsWorld = new Map();
  // Also grab world positions for each swing chain's own CHILD suffix (e.g.
  // "Spine1" when processing "Spine"). Most of these are ALSO independently-
  // retargeted bones already covered by Object.values(MANNY_BONE_MAP) --
  // but NOT all: LeftHand/RightHand's swing-child references
  // ("LeftHandMiddle1"/"RightHandMiddle1", see SWING_TARGET_CHILD) are
  // finger bones that exist purely to give the hand an aim reference and
  // are never independently retargeted, so without this explicit union
  // they're silently missing from `restPositions` -- which made
  // `childLocalOffsetTarget` (in retargetMannyClip's parent-relative
  // branch) undefined for hands, `useParentRelative` silently false, and
  // hands falling through to the OLD, pre-item-15/16 world-space swing
  // method with none of that work's fixes applied. Found only because the
  // user reported the wrist had the exact same "bends backwards" symptom
  // as the elbow AFTER item 16 supposedly fixed it -- `useParentRelative`
  // was never even engaging for hands to begin with.
  const wantedSuffixes = new Set(['Hips', ...Object.values(MANNY_BONE_MAP), ...Object.values(SWING_TARGET_CHILD)]);
  let hipsParentWorldQuat = new THREE.Quaternion(); // identity fallback if Hips has no parent node
  characterObj.updateMatrixWorld(true);
  characterObj.traverse((obj) => {
    if (!obj.isBone || !obj.name.startsWith(bonePrefix)) return;
    const suffix = obj.name.slice(bonePrefix.length);
    if (!wantedSuffixes.has(suffix)) return;
    restQuats.set(suffix, obj.quaternion.clone());
    const worldQuat = new THREE.Quaternion();
    obj.getWorldQuaternion(worldQuat);
    restWorldQuats.set(suffix, worldQuat);
    const worldPos = new THREE.Vector3();
    obj.getWorldPosition(worldPos);
    restWorldPositions.set(suffix, worldPos);
    restPositions.set(suffix, obj.position.clone());
    if (NEUTRAL_OFFSET_BONES.includes(suffix)) {
      const offset = computeHangDownOffsetWorld(obj);
      if (offset) neutralOffsetsWorld.set(suffix, offset);
    }
    // Hips's LOCAL quaternion (what its AnimationClip track stores) is
    // relative to its PARENT NODE, not the scene root -- these Blender-
    // exported characters wrap every bone in an "Armature" node carrying its
    // own fixed rotation (CONTEXT.md's "+90-about-X wrapper"). Retargeting
    // Spine/LeftUpLeg/RightUpLeg (Hips's children in TARGET_PARENT) needs
    // Hips's TRUE WORLD quaternion as their parent reference, not its local
    // value -- conflating the two here corrupted every bone below Hips
    // (confirmed: the character collapsed into an unrecognizable blob until
    // this was captured and used instead of the raw local quat).
    if (suffix === 'Hips' && obj.parent) obj.parent.getWorldQuaternion(hipsParentWorldQuat);
  });
  return { restQuats, restWorldQuats, restWorldPositions, restPositions, neutralOffsetsWorld, hipsParentWorldQuat };
}

const IDENTITY_QUAT = new THREE.Quaternion();

function findTrack(clip, boneName, type) {
  return clip.tracks.find((t) => t.name === `${boneName}.${type}`);
}

function quatAt(track, i, out) {
  if (!track) return out.copy(IDENTITY_QUAT);
  return out.fromArray(track.values, i * 4);
}

// Full 3-axis "delta from rest" (see retargetMannyClip's doc comment) breaks
// down specifically for Hips: root+pelvis's combined rest orientation in this
// source rig is a huge (~90+ degree) fixed offset (confirmed via
// window.__debugRetarget logging -- not assumed), so transplanting the full
// rest-relative delta wholesale amplifies into the character's whole body
// pitching/rolling over, visible on every character regardless of clip
// (confirmed via screenshot: character floats sideways off the grid). Only
// the YAW (turning to face a new direction -- the part that actually matters
// for judging clips like pivot-spin/backpedal/side-shuffle) is extracted
// instead, computed in WORLD space (root's parent frame, which this loaded
// FBX hierarchy keeps Z-up -- confirmed empirically, not assumed, from
// `pelvis`'s rest position landing almost entirely in .z) via projecting a
// reference vector before/after rotation onto the horizontal (Z=up) plane
// and reading off the signed angle between the two. This sidesteps the
// per-bone local-axis-convention mismatch entirely since it never touches
// either bone's own local frame -- pitch/roll (leaning forward, side tilt)
// intentionally do not transfer for Hips; the character stays upright with
// its target rig's own natural stance, only turning to match the source.
//
// pickHorizontalRefAxis matters more than it looks: a first attempt hardcoded
// (1,0,0) as the reference and only bailed out below a 1e-6 length^2
// threshold. For this particular rig's rest orientation, (1,0,0) happens to
// land almost EXACTLY vertical (measured: (-0.0002, 0.0633, 0.9982) --
// 99.6% of its length is the Z/up component that then gets projected away),
// leaving a horizontal residual that's mostly numerical noise, not signal --
// well above the 1e-6 bailout, so it silently produced a near-random yaw
// every frame instead of erroring (confirmed via a world-bone-position dump:
// Hips ended up ~180 degrees off during a plain forward jog, throwing the
// legs up over the character's head on screenshot review). Fix: test all
// three basis vectors against the REST orientation once per clip and keep
// whichever comes out most horizontal, instead of assuming any single one is
// safe.
function pickHorizontalRefAxis(restQuat) {
  const candidates = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];
  let best = candidates[0];
  let bestLenSq = -1;
  const v = new THREE.Vector3();
  for (const c of candidates) {
    v.copy(c).applyQuaternion(restQuat);
    v.z = 0;
    if (v.lengthSq() > bestLenSq) {
      bestLenSq = v.lengthSq();
      best = c;
    }
  }
  return best;
}

const YAW_REST_V = new THREE.Vector3();
const YAW_CUR_V = new THREE.Vector3();
function worldYawDelta(refAxis, restQuat, currentQuat) {
  YAW_REST_V.copy(refAxis).applyQuaternion(restQuat);
  YAW_REST_V.z = 0;
  YAW_CUR_V.copy(refAxis).applyQuaternion(currentQuat);
  YAW_CUR_V.z = 0;
  if (YAW_REST_V.lengthSq() < 0.1 || YAW_CUR_V.lengthSq() < 0.1) return 0;
  YAW_REST_V.normalize();
  YAW_CUR_V.normalize();
  const cross = YAW_REST_V.x * YAW_CUR_V.y - YAW_REST_V.y * YAW_CUR_V.x;
  const dot = YAW_REST_V.dot(YAW_CUR_V);
  return Math.atan2(cross, dot);
}

const TARGET_UP = new THREE.Vector3(0, 1, 0);

// Builds a "canonical," twist-free world quaternion for a bone given ONLY
// its aim direction (local +Y, matching this rig's own child-offset
// convention -- see childLocalOffsetTarget's comment) plus a SHARED,
// externally-fixed up-hint. Used by the elbow/wrist parent-relative fix
// (item 16) to "carry" a relative aim between the source's and target's
// upper-arm frames WITHOUT inheriting either rig's own arbitrary twist:
// a bone's REAL world quaternion (from either rig's own swing retarget,
// which only ever constrains aim, never twist -- see item 15/16) can
// differ from the OTHER rig's by 100+ degrees of pure rotation around the
// arm's own long axis alone, confirmed by direct measurement (see item 16).
// Building BOTH sides' reference frame this same way, from nothing but the
// (correctly-tracked) aim direction and one shared up-hint, means any
// residual difference between them is due to genuine aim differences only.
// Degenerate-axis fallback (aim parallel to upHint) swaps in world +X --
// arms/legs are never aimed close to world up in any clip this tool plays.
function buildAimQuaternion(aimDir, upHint, out) {
  const y = aimDir;
  const x = new THREE.Vector3().crossVectors(upHint, y);
  if (x.lengthSq() < 1e-6) x.crossVectors(new THREE.Vector3(1, 0, 0), y);
  x.normalize();
  const z = new THREE.Vector3().crossVectors(x, y).normalize();
  const m = new THREE.Matrix4().makeBasis(x, y, z);
  return out.setFromRotationMatrix(m);
}

// Builds, for a FRESH CLONE of the raw source FBX (never the shared cached
// object -- see retargetMannyClip's doc comment for why that matters), each
// wanted bone's WORLD-space quaternion AND world-space position at (a) the
// skeleton's authored rest pose and (b) every keyframe of rawClip. Uses
// three.js's own matrixWorld/FK propagation (apply every quaternion track's
// sampled value to its bone, then updateMatrixWorld) instead of hand-deriving
// forward-kinematics composition -- less code to get wrong. Every ANCESTOR of
// a wanted bone that carries its own track (spine_04/05, twist bones, ...)
// gets posed too, even though it's not individually retargeted, because
// correct FK for a wanted bone requires its whole ancestor chain to be
// correctly posed for that frame, not just the wanted bones themselves.
//
// `boneNames` is expected to include both MANNY_BONE_MAP's keys AND
// SWING_SOURCE_CHILD's values (some of which, like spine_04/neck_02, are not
// themselves individually retargeted -- they exist only so a mapped bone's
// world-space aim direction can be measured against its own real child; see
// retargetMannyClip's per-bone swing-transfer comment below).
function computeSourceWorldFrames(rawFbx, rawClip, boneNames) {
  const clone = rawFbx.clone(true);
  // This source FBX loads Z-up in three.js (confirmed empirically, same as
  // the raw-skeleton preview's rotation -- see activateSkeletonClip). World
  // quaternions/positions computed here MUST share the same up-axis
  // convention as the TARGET character's world space (plain Y-up, like the
  // rest of this scene) for the world-space delta transfer below to be
  // meaningful -- mixing a Z-up "world" with a Y-up "world" is exactly the
  // same class of axis-convention bug this whole rewrite exists to
  // eliminate. An earlier version of this function skipped this rotation
  // entirely, silently computing sourceRestWorld/sourceCurrentWorld in the
  // WRONG up-axis convention -- confirmed by the character collapsing into
  // an unrecognizable blob the instant this function's output was actually
  // used (not just a subtle pose error, a total collapse -- that magnitude
  // is the tell for "these two quaternions are not in the same frame at
  // all", not a smaller calibration issue).
  clone.rotation.x = -Math.PI / 2;
  const quatTracks = rawClip.tracks.filter((t) => t.name.endsWith('.quaternion'));
  const trackBones = quatTracks
    .map((t) => ({ track: t, bone: clone.getObjectByName(t.name.replace('.quaternion', '')) }))
    .filter((x) => x.bone);
  const targetBones = boneNames.map((name) => ({ name, bone: clone.getObjectByName(name) }));
  const n = quatTracks.length ? quatTracks[0].times.length : 0;

  clone.updateMatrixWorld(true);
  const restWorldQuats = new Map();
  const restWorldPositions = new Map();
  for (const { name, bone } of targetBones) {
    if (!bone) continue;
    const q = new THREE.Quaternion();
    bone.getWorldQuaternion(q);
    restWorldQuats.set(name, q);
    const p = new THREE.Vector3();
    bone.getWorldPosition(p);
    restWorldPositions.set(name, p);
  }

  const perFrameWorldQuats = new Map();
  const perFrameWorldPositions = new Map();
  for (const { name, bone } of targetBones) {
    if (!bone) continue;
    perFrameWorldQuats.set(name, []);
    perFrameWorldPositions.set(name, []);
  }
  for (let i = 0; i < n; i++) {
    for (const { track, bone } of trackBones) bone.quaternion.fromArray(track.values, i * 4);
    clone.updateMatrixWorld(true);
    for (const { name, bone } of targetBones) {
      if (!bone) continue;
      const q = new THREE.Quaternion();
      bone.getWorldQuaternion(q);
      perFrameWorldQuats.get(name).push(q);
      const p = new THREE.Vector3();
      bone.getWorldPosition(p);
      perFrameWorldPositions.get(name).push(p);
    }
  }
  return {
    restWorldQuats,
    restWorldPositions,
    perFrameWorldQuats,
    perFrameWorldPositions,
    times: n ? quatTracks[0].times : new Float32Array(0),
  };
}

// Retargets a Manny/UE5-skeleton clip (see MANNY_BONE_MAP above) onto the
// active character's mixamorig-named rig. These two skeletons share no bone
// names and have differently-built rest poses, so the existing name-based
// retargetClipNames() path (built for same-rig-family Mixamo clips) does not
// apply here at all -- nothing would bind.
//
// This went through several iterations, each one found wrong by actually
// watching the render, not by re-deriving the math (see CONTEXT.md for the
// full history -- worth reading before touching this again):
//
// 1. Raw quaternion "delta from BIND pose", in each bone's own LOCAL space
//    (targetRest * (sourceRest^-1 * sourceLocal(t))) -- the standard "quick"
//    retarget technique. Broke because the two rigs' per-bone LOCAL AXIS
//    CONVENTIONS disagree, and their bind poses don't represent the same
//    real-world stance -- compounded down the spine chain into an ~80-90
//    degree persistent hunch.
// 2. Switched the reference to the clip's OWN FIRST FRAME -- collapsed the
//    hunch, but revealed the arms reverting to a literal T-pose whenever the
//    source barely moves (inherent to ANY single-reference delta method).
// 3. Geometric SWING transfer (direction-vector rotation instead of raw
//    quaternion) -- fixed the T-pose-when-still problem (via a measured
//    "hang down" baseline correction) but turned out to have the SAME root
//    disease as bug 1 in a new outfit: the swing was computed in the
//    SOURCE bone's own local/parent-relative frame and then composed
//    directly onto the TARGET bone's own (different) local/parent-relative
//    frame -- valid only if the two rigs' local axis conventions happen to
//    agree, which they don't. Symptom, reported directly by the user:
//    "upper body facing forward... legs running to the side... skeleton is
//    facing sideways in the body" -- small bind-pose rotations (spine, after
//    the T-pose fix) hid the bug, large/divergent ones (thigh) exposed it
//    as a full wrong-plane mismatch between torso and legs.
// 4. CURRENT approach: full WORLD-SPACE forward-kinematics retarget, i.e.
//    generalizing the one thing that's actually been robust the whole time
//    -- Hips's yaw calculation below, which only ever worked in genuine
//    world space, never either rig's local axes. For every mapped bone,
//    compute its REST and PER-FRAME world-space orientation via real FK
//    (computeSourceWorldQuatsPerFrame, for source; live matrixWorld/
//    getWorldQuaternion, for target's rest -- both using three.js's own
//    scene-graph math, not hand-derived composition), transfer the delta
//    (targetRestWorld * (sourceRestWorld^-1 * sourceCurrentWorld)) entirely
//    in that shared world frame, then convert back to the LOCAL rotation
//    the AnimationClip track needs by dividing out the bone's PARENT's
//    world orientation for that SAME frame (TARGET_PARENT) -- the parent's
//    just-computed retargeted value, not its rest, since parents are
//    retargeted before children (MANNY_BONE_MAP's order already respects
//    this). Never touches either rig's local axis convention at any joint,
//    so it can't reproduce bugs 1 or 3's failure mode by construction.
//    NEUTRAL_OFFSET_BONES's T-pose correction (bug 2) still applies, now
//    composed directly in world space (computeHangDownOffsetWorld).
// 5. Bug 4 turned out to ALSO have bug 1/3's exact disease, just hidden one
//    level deeper. `targetRestWorld * (sourceRestWorld^-1 * sourceCurrentWorld)`
//    LOOKS like a pure world-space operation because every quaternion fed
//    into it is a world quaternion, but the formula itself still computes
//    `sourceRestWorld^-1 * sourceCurrentWorld` -- a rotation expressed IN
//    the source bone's own rest-orientation frame -- and then reapplies that
//    SAME numeric rotation as if it meant something in the TARGET bone's own
//    rest-orientation frame. That's only valid if the two rigs' bones agree
//    on what "my local axes" mean at rest, which UE Manny and this Mixamo
//    rig do not (confirmed: measured per-bone delta angles for a plain jog
//    never dropped below ~20-40 degrees for spine/shoulders across the
//    ENTIRE cycle, and independently, sampling limb direction vectors from
//    both the retargeted character and the raw-skeleton ground truth at the
//    same clip time showed the angle between them swinging incoherently
//    from under 1 degree to over 120 degrees frame-to-frame with no fixed
//    relationship -- i.e. legs/arms swinging in a visibly wrong PLANE, not a
//    small calibration error. Verified this wasn't an interpolation/sign-
//    flip artifact by sampling 300 sub-keyframe steps across the clip and
//    finding zero discontinuities -- the wrong-plane motion itself is
//    perfectly smooth, meaning every individual keyframe's computed pose is
//    wrong, not the playback).
//
//    CURRENT (actual) fix: stop transferring rotation at all for bones with
//    a clean single "next" bone in their own chain (SWING_SOURCE_CHILD /
//    SWING_TARGET_CHILD) -- transfer a WORLD-SPACE AIM/SWING instead, which
//    never reads either rig's local axis convention:
//      sourceAimRest    = normalize(sourceChildRestWorldPos - sourceRestWorldPos)
//      sourceAimCurrent = normalize(sourceChildWorldPos(t)  - sourceWorldPos(t))
//      swingQ(t)        = Quaternion.setFromUnitVectors(sourceAimRest, sourceAimCurrent)
//      newWorldQ        = swingQ(t) * effectiveTargetRestWorld
//    `swingQ(t)` is a genuine world-frame (extrinsic) rotation -- "however
//    much this limb segment's real-world aim direction swung since rest" --
//    and applying it via PRE-multiplication onto the target's own rest
//    orientation (exactly the same composition style as the Hips yaw fix
//    below, the one thing that worked from the very first attempt) means
//    the target ends up aimed the same real-world direction the source was,
//    regardless of what either rig calls "local X" at that joint. The only
//    information deliberately discarded is TWIST around that aim axis
//    (forearm pronation, thigh rotation, ...) -- an actual, bounded
//    limitation of this method, not an oversight, and far less damaging
//    than a wrong swing PLANE. Bones with no clean single next-bone (Head,
//    LeftHand/RightHand, LeftToeBase/RightToeBase -- true leaves, or ones
//    fanning into many finger/corrective children) keep the old bug-4
//    quaternion-delta method: their bind-pose rotation magnitude is small
//    enough, and their visual footprint narrow enough, that the axis-
//    mismatch risk is much lower and not worth chasing further here.
//
// Root motion is a special case: `root`+`pelvis` (source) both feed the
// single `Hips` bone (target). Rotation composes both deltas. Position only
// transfers the VERTICAL component (source `.position.z` is "up" -- this
// source FBX loads Z-up in three.js) as a delta added to the target's own
// rest Hips height -- on the TARGET side that means local Z, not local Y
// (this rig's true vertical axis; see the assignment below for how that was
// found and confirmed). Horizontal (target X/Y) is left at the target's
// rest value, i.e. frozen.
function retargetMannyClip(clipKey, rawFbx, rawClip, bonePrefix, targetRestPose) {
  const { restQuats, restWorldQuats, restWorldPositions, restPositions, neutralOffsetsWorld, hipsParentWorldQuat } = targetRestPose;
  const tracks = [];

  const rootBone = rawFbx.getObjectByName('root');
  const pelvisBone = rawFbx.getObjectByName('pelvis');
  const targetHipsQuat = restQuats.get('Hips');
  const targetHipsPos = restPositions.get('Hips');
  let hipsQuatValues = null; // populated below; read afterward to seed targetWorldPerFrame
  if (rootBone && pelvisBone && targetHipsQuat && targetHipsPos) {
    const rootQTrack = findTrack(rawClip, 'root', 'quaternion');
    const pelvisQTrack = findTrack(rawClip, 'pelvis', 'quaternion');
    const rootPosTrack = findTrack(rawClip, 'root', 'position');
    const pelvisPosTrack = findTrack(rawClip, 'pelvis', 'position');
    const times = (rootQTrack || pelvisQTrack).times;
    const n = times.length;
    const quatValues = new Float32Array(n * 4);
    const posValues = new Float32Array(n * 3);
    // ROTATION reference = this clip's OWN frame 0 (see the big comment
    // above this function for why). POSITION reference stays the skeleton's
    // authored bind-pose height, NOT frame 0 -- a clip's frame 0 is often
    // mid-stride, crouched, or otherwise not a "standing tall" pose (e.g.
    // this run clip's frame 0 pelvis height is ~13 units below its bind-pose
    // height), so using it as the height baseline shifted the whole
    // character up/down by that clip-dependent constant -- confirmed by
    // comparing the retargeted Hips local Y across clips (idle 0.2, ready
    // 0.42, but run 3.28 -- no real difference in standing height between
    // these should produce a swing that size) right after the frame-0
    // rotation-reference fix sank characters into the ground on some clips.
    // Rotation and position need DIFFERENT references; conflating them was
    // the bug.
    const q1 = new THREE.Quaternion();
    const q2 = new THREE.Quaternion();
    quatAt(rootQTrack, 0, q1);
    quatAt(pelvisQTrack, 0, q2);
    const combinedRestQ = q1.clone().multiply(q2);
    const yawRefAxis = pickHorizontalRefAxis(combinedRestQ);
    const rootRestZ = rootBone.position.z;
    const pelvisRestZ = pelvisBone.position.z;
    const combinedCurrent = new THREE.Quaternion();
    const yawQuat = new THREE.Quaternion();
    const target = new THREE.Quaternion();
    for (let i = 0; i < n; i++) {
      quatAt(rootQTrack, i, q1);
      quatAt(pelvisQTrack, i, q2);
      combinedCurrent.copy(q1).multiply(q2);
      const yaw = worldYawDelta(yawRefAxis, combinedRestQ, combinedCurrent);
      yawQuat.setFromAxisAngle(TARGET_UP, yaw);
      target.copy(yawQuat).multiply(targetHipsQuat);
      target.toArray(quatValues, i * 4);

      const rootZ = rootPosTrack ? rootPosTrack.values[i * 3 + 2] : rootRestZ;
      const pelvisZ = pelvisPosTrack ? pelvisPosTrack.values[i * 3 + 2] : pelvisRestZ;
      const verticalDelta = (rootZ - rootRestZ) + (pelvisZ - pelvisRestZ);
      // This target rig's LOCAL Z is its VERTICAL axis (world Y is
      // proportional to -localZ; confirmed empirically by nudging Hips.z on
      // a live character and watching world Y move, not assumed) -- NOT
      // local Y, despite Y being "up" in this tool's own three.js scene.
      // Local Y/X are this rig's HORIZONTAL axes and stay frozen at rest.
      // An earlier version put the bounce on local Y (this scene's up axis,
      // by analogy with the OLD raw-FBX Mixamo clips this tool's other
      // clip path uses, which really are Y-up with no wrapper) -- on this
      // wrapped rig that did nothing for height at all, AND a subsequent
      // freezeRootHorizontalMotion call (since removed for this path, see
      // activateMannyClip) zeroed local Z outright, snapping every
      // character's Hips exactly to floor level. The world-Y-vs-local-Z
      // relationship is negative here, so an increase in source height
      // (verticalDelta > 0) needs local Z to DECREASE, hence the subtraction.
      posValues[i * 3] = targetHipsPos.x;
      posValues[i * 3 + 1] = targetHipsPos.y;
      posValues[i * 3 + 2] = targetHipsPos.z - verticalDelta;
    }
    tracks.push(new THREE.QuaternionKeyframeTrack(`${bonePrefix}Hips.quaternion`, times, quatValues));
    tracks.push(new THREE.VectorKeyframeTrack(`${bonePrefix}Hips.position`, times, posValues));
    hipsQuatValues = quatValues;
  }

  // World-space FK retarget for every non-Hips mapped bone (see the doc
  // comment above this function, items 4 and 5). One pass computes every
  // mapped source bone's world orientation AND world position -- rest and
  // per-frame -- via a cloned rig driven through three.js's own FK
  // (computeSourceWorldFrames) -- avoids hand-deriving chain composition for
  // ~20 bones individually. Also fetch each swing bone's own child (some of
  // which, like spine_04/neck_02, aren't otherwise-mapped bones at all --
  // see SWING_SOURCE_CHILD's comment) so a world-space aim direction can be
  // measured per bone.
  const sourceNames = Array.from(new Set([...Object.keys(MANNY_BONE_MAP), ...Object.values(SWING_SOURCE_CHILD)]));
  const {
    restWorldQuats: sourceRestWorld,
    restWorldPositions: sourceRestPos,
    perFrameWorldQuats: sourcePerFrame,
    perFrameWorldPositions: sourcePerFramePos,
    times: fkTimes,
  } = computeSourceWorldFrames(rawFbx, rawClip, sourceNames);
  const fkN = fkTimes.length;

  // Target world quats we build up AS we retarget, keyed by suffix, so each
  // bone's children can divide out THIS frame's just-computed parent world
  // quat (not the parent's rest) -- MANNY_BONE_MAP's order already visits
  // parents before children. Seed with Hips's per-frame WORLD quat: compose
  // its LOCAL track value (built above into hipsQuatValues) with its
  // PARENT's own world rotation (hipsParentWorldQuat -- the Armature
  // wrapper's fixed rotation), NOT the local value alone (see
  // captureTargetRestPose's comment on hipsParentWorldQuat for why that
  // distinction matters).
  const targetWorldPerFrame = new Map();
  if (hipsQuatValues) {
    const hipsFrames = [];
    const hipsLocalQ = new THREE.Quaternion();
    for (let i = 0; i < fkN; i++) {
      hipsLocalQ.fromArray(hipsQuatValues, i * 4);
      hipsFrames.push(hipsParentWorldQuat.clone().multiply(hipsLocalQ));
    }
    targetWorldPerFrame.set('Hips', hipsFrames);
  }

  const deltaQ = new THREE.Quaternion();
  const newWorldQ = new THREE.Quaternion();
  const localQ = new THREE.Quaternion();
  const swingQ = new THREE.Quaternion();
  const sourceAimRest = new THREE.Vector3();
  const sourceAimCurrent = new THREE.Vector3();
  const debug = window.__RETARGET_DEBUG ? {} : null;
  for (const [sourceName, targetSuffix] of Object.entries(MANNY_BONE_MAP)) {
    const sourceRestW = sourceRestWorld.get(sourceName);
    const sourceFrames = sourcePerFrame.get(sourceName);
    const targetRestW = restWorldQuats.get(targetSuffix);
    const parentSuffix = TARGET_PARENT[targetSuffix];
    const parentFrames = targetWorldPerFrame.get(parentSuffix);
    if (!sourceRestW || !sourceFrames || !targetRestW || !parentFrames) continue;

    // Prefer the world-space AIM/SWING transfer (see item 5 above) whenever
    // this bone has a clean single "next" bone on BOTH rigs; otherwise fall
    // back to the old per-bone quaternion delta (item 4) for leaves (Head,
    // hands, toe bases).
    const sourceChildName = SWING_SOURCE_CHILD[sourceName];
    const targetChildSuffix = SWING_TARGET_CHILD[targetSuffix];
    const sourceChildRestPos = sourceChildName ? sourceRestPos.get(sourceChildName) : null;
    const sourceChildFramePos = sourceChildName ? sourcePerFramePos.get(sourceChildName) : null;
    const sourceRestPosThis = sourceRestPos.get(sourceName);
    const sourceFramePosThis = sourcePerFramePos.get(sourceName);
    const useSwing = targetChildSuffix && sourceChildRestPos && sourceChildFramePos && sourceRestPosThis && sourceFramePosThis;

    // Effective world-space baseline: target's own rest, corrected toward a
    // relaxed hang for the bones whose bind pose is a stark T-pose (see
    // NEUTRAL_OFFSET_BONES/computeHangDownOffsetWorld above). Used as the
    // BASELINE the swing is composed onto (see the swing branch below for
    // why it must be the baseline, not a correction bolted on afterward),
    // and as the whole answer for the delta fallback.
    const neutralOffset = neutralOffsetsWorld.get(targetSuffix);
    const effectiveTargetRestWorld = neutralOffset ? neutralOffset.clone().multiply(targetRestW) : targetRestW;

    const sourceRestInv = sourceRestW.clone().invert();

    // PARENT-RELATIVE bend fix (item 15) -- only for bones that carry a
    // NEUTRAL_OFFSET_BONES correction (forearm, hand). See the big comment
    // in the loop body below for the full reasoning; this block just
    // gathers the extra per-bone data (parent's source-side name, its rest/
    // per-frame world quats, target's own child-offset vector) needed to
    // compute the elbow/wrist bend AS SEEN FROM the parent bone's own
    // moving frame, instead of as an independent world-space quantity.
    // See the useParentRelative branch below for what this feeds -- direct
    // transplant of the source's current parent-relative elbow/wrist aim,
    // not a delta from either rig's own (mismatched) rest pose.
    const parentSourceName = SOURCE_NAME_FOR_TARGET_SUFFIX[parentSuffix];
    const sourceParentFramePos = parentSourceName ? sourcePerFramePos.get(parentSourceName) : null;
    const childLocalOffsetTarget = targetChildSuffix ? restPositions.get(targetChildSuffix) : null;
    // The PARENT's (upper arm's) own child-offset -- i.e. THIS bone's own
    // rest local position, since this bone IS the parent's child -- used to
    // derive the parent's own aim direction each frame from its already-
    // computed world quaternion (parentFrames[i]), without needing a
    // separate lookup of the parent's actual live bone object.
    const targetParentChildOffset = restPositions.get(targetSuffix);
    const useParentRelative =
      useSwing && neutralOffset && sourceParentFramePos && childLocalOffsetTarget && targetParentChildOffset;
    const targetAimRestWorld = useParentRelative
      ? childLocalOffsetTarget.clone().applyQuaternion(targetRestW).normalize()
      : null;

    const values = new Float32Array(fkN * 4);
    const thisBoneFrames = [];
    const debugFrames = debug ? [] : null;
    if (useSwing) sourceAimRest.copy(sourceChildRestPos).sub(sourceRestPosThis).normalize();
    for (let i = 0; i < fkN; i++) {
      if (useParentRelative) {
        // Elbow/wrist bend, computed RELATIVE TO THE PARENT'S OWN CURRENT
        // ORIENTATION instead of as an independent world-space rotation.
        //
        // Item 14 found the plain world-space swing (below) locks the
        // elbow's bend PLANE to a near-constant value regardless of pose.
        // A first attempt at a parent-relative fix (delta from each rig's
        // OWN rest, replayed onto the target) turned out to have a much
        // bigger problem than axis convention: dumping the actual rest
        // vectors showed the SOURCE rig's rest pose has the elbow already
        // bent ~129° away from straight (`sourceAimRestLocal` measured as
        // `(0.777, -0.629, 0)`, vs. a dead-straight `(0, 1, 0)` for this
        // target's literal T-pose) -- this Manny rig's "rest" is a relaxed,
        // already-bent-arm stance, not a T-pose, matching item 13's finding
        // that its upper-arm rest also isn't a T-pose. Computing "delta
        // from rest" and replaying that small delta (source's elbow barely
        // moves further from its OWN already-bent rest during a run) onto
        // the target's dead-straight rest just reproduces a dead-straight
        // elbow with a small wobble -- technically a correct delta, on
        // completely incompatible baselines, the exact same disease as
        // item 13's amplitude bug, just impossible to fix by correcting
        // the target's baseline alone (there's no single "which way is
        // 129° bent" to rotate a straight T-pose toward without more
        // information than a bind-pose comparison can give).
        //
        // Fix: stop trying to preserve "delta from rest" for this bone
        // entirely. Directly transplant the source's CURRENT elbow aim,
        // expressed relative to ITS OWN upper arm's current orientation,
        // onto the TARGET's own upper arm's ACTUAL current orientation.
        // This trades away matching the target's own rest-pose bend
        // exactly (there is no principled way to reconcile a 129° rest
        // mismatch from bind-pose data alone) for directly reproducing the
        // source's real elbow configuration every frame, which is what
        // actually matters for a visibly-correct running motion.
        //
        // IMPORTANT (item 16): "the upper arm's own current orientation"
        // here MUST be a TWIST-FREE, canonically-built reference
        // (`buildAimQuaternion`, using only the upper arm's aim direction
        // plus a shared world-up hint) -- NOT the upper arm's REAL world
        // quaternion (`sourceParentFrames[i]` / `parentFrames[i]`). The
        // upper-arm swing method (item 13, and every swing bone) only ever
        // constrains AIM, never twist, so each rig's real upper-arm
        // quaternion carries its own arbitrary "shortest path" twist
        // convention. An earlier version of this fix used the REAL
        // quaternions directly -- it was mathematically self-consistent
        // (confirmed: target's parent-relative forearm direction matched
        // source's EXACTLY) but the user immediately reported the elbow
        // now bending "90 degrees backwards." Measured directly: the
        // quaternion difference between target's and source's upper arm,
        // at matching frames, was a 120-140° rotation with 70-80% of that
        // axis aligned with the arm's own aim direction -- i.e. mostly
        // pure, arbitrary TWIST mismatch, not an aim disagreement (aim
        // itself tracks well, per item 13). Carrying the elbow's relative
        // configuration through each rig's OWN twist-laden frame rotated
        // the elbow's bend PLANE by that same ~100+ degree mismatch, even
        // though the delta transfer itself was correct. Building both
        // sides' carrier frame the SAME way, from nothing but the
        // (correctly-tracked) aim direction and one shared up-hint,
        // eliminates this: any twist convention either rig's OWN bones
        // have is never consulted.
        sourceAimCurrent.copy(sourceChildFramePos[i]).sub(sourceFramePosThis[i]).normalize();
        const sourceUpperArmAim = sourceFramePosThis[i].clone().sub(sourceParentFramePos[i]).normalize();
        const sourceCarrierQ = buildAimQuaternion(sourceUpperArmAim, TARGET_UP, new THREE.Quaternion());
        const sourceAimCurrentLocal = sourceAimCurrent.clone().applyQuaternion(sourceCarrierQ.clone().invert());

        const targetUpperArmAim = targetParentChildOffset.clone().applyQuaternion(parentFrames[i]).normalize();
        const targetCarrierQ = buildAimQuaternion(targetUpperArmAim, TARGET_UP, new THREE.Quaternion());
        const targetAimWorldNew = sourceAimCurrentLocal.clone().applyQuaternion(targetCarrierQ);

        const finalSwing = new THREE.Quaternion().setFromUnitVectors(targetAimRestWorld, targetAimWorldNew);
        swingQ.copy(finalSwing); // for window.__RETARGET_DEBUG inspection only
        // Multiply onto the LITERAL rest here (targetRestW), matching
        // targetAimRestWorld above -- NOT effectiveTargetRestWorld, which
        // would be inconsistent (finalSwing was built to map targetRestW's
        // own aim to targetAimWorldNew, not effectiveTargetRestWorld's).
        newWorldQ.copy(finalSwing).multiply(targetRestW);
      } else if (useSwing) {
        // World-space AIM/SWING transfer: measure how far the source limb
        // segment's real-world aim direction has rotated since rest, then
        // apply that SAME world rotation on top of the target's own rest
        // orientation. Never reads either rig's local bone axes, so it
        // can't reproduce the wrong-swing-plane failure of the raw
        // quaternion-delta method (see item 5's doc comment above).
        //
        // The baseline this gets applied to MUST be `effectiveTargetRestWorld`
        // (swing composed directly onto it: `swingQ * effectiveTargetRestWorld`),
        // NOT the literal T-pose rest with `neutralOffset` bolted on
        // afterward as a separate global step. An earlier version tried the
        // latter (`neutralOffset * (swingQ * targetRestW)`, reasoning that
        // swingQ was "measured against literal rest, so it should apply to
        // literal rest") and it was WRONG in a way that's easy to miss on a
        // near-static clip but severe on a dynamic one: `neutralOffset` is a
        // FIXED, single rotation (roughly "swing the T-pose arm down to
        // hanging"), and applying that SAME fixed rotation to whatever
        // direction the swing already produced pulls EVERY result partway
        // back toward "hanging down" regardless of how far the source
        // actually reached -- confirmed by measuring the hand's lateral
        // (horizontal) distance from the hip, character vs. raw skeleton,
        // at 30 points through a full `run` cycle: the retargeted hand
        // reached only ~10-50% of the source's proportional lateral swing,
        // EVERY frame, not just near-rest ones (the user caught this by
        // direct visual comparison via the raw-skeleton-beside tool -- the
        // character's arm looked tucked in close to the body while the raw
        // skeleton's swung a full reach out to the side). Composing swing
        // directly onto `effectiveTargetRestWorld` instead has no such
        // bias: the correction is baked into the BASELINE once, and swingQ
        // -- a real, measured, unscaled rotation -- is free to carry the
        // limb as far as the source actually moved it. This is also what
        // originally fixed the item-9 degenerate-forearm-freeze bug (a raw
        // T-pose forearm's aim is nearly parallel to its own natural swing
        // axis; hang-down is not), so this formula has always been the
        // right one for genuine motion -- the mistake was ever moving away
        // from it. Item 11's actual bug (Idle hand curling toward the
        // midline) turned out to be caused by `NEUTRAL_OFFSET_BONES`
        // including `LeftArm`/`RightArm`, which never actually needed the
        // correction in the first place (see item 13) -- with this formula
        // restored AND the upper arm's unnecessary correction removed,
        // full regression testing (item 13) found idle/ready/run/serve/
        // victory/hit-react all natural on both `ch01` and `ch02`.
        sourceAimCurrent.copy(sourceChildFramePos[i]).sub(sourceFramePosThis[i]).normalize();
        swingQ.setFromUnitVectors(sourceAimRest, sourceAimCurrent);
        newWorldQ.copy(swingQ).multiply(effectiveTargetRestWorld);
      } else {
        // Leaf fallback: old world-space "delta from rest" (item 4). Still
        // subject to item 5's axis-convention caveat, but these bones' rest
        // rotation magnitude is small and their visual footprint narrow.
        deltaQ.copy(sourceRestInv).multiply(sourceFrames[i]);
        newWorldQ.copy(effectiveTargetRestWorld).multiply(deltaQ);
      }
      // Convert back to the LOCAL rotation the track needs, dividing out
      // THIS frame's parent world orientation.
      localQ.copy(parentFrames[i]).invert().multiply(newWorldQ);
      localQ.toArray(values, i * 4);
      thisBoneFrames.push(newWorldQ.clone());
      if (debugFrames) {
        debugFrames.push({
          method: useParentRelative ? 'parent-relative' : useSwing ? 'swing' : 'delta',
          sourceRestW: sourceRestW.toArray(),
          sourceCurrentW: sourceFrames[i].toArray(),
          targetRestW: targetRestW.toArray(),
          effectiveTargetRestWorld: effectiveTargetRestWorld.toArray(),
          newWorldQ: newWorldQ.toArray(),
          parentFrameW: parentFrames[i].toArray(),
          localQ: localQ.toArray(),
          sourceAimRest: useSwing ? sourceAimRest.toArray() : null,
          sourceAimCurrent: useSwing ? sourceAimCurrent.toArray() : null,
          swingQ: useSwing ? swingQ.toArray() : null,
        });
      }
    }
    targetWorldPerFrame.set(targetSuffix, thisBoneFrames);
    tracks.push(new THREE.QuaternionKeyframeTrack(`${bonePrefix}${targetSuffix}.quaternion`, fkTimes, values));
    if (debug) debug[targetSuffix] = debugFrames;
  }
  if (debug) window.__lastRetargetDebug = { clipKey, debug, fkTimes: Array.from(fkTimes) };

  return new THREE.AnimationClip(clipKey, rawClip.duration, tracks);
}

function loadFbxSource(clipKey, url) {
  if (rawFbxCache.has(clipKey)) return Promise.resolve(rawFbxCache.get(clipKey));
  let promise = fbxLoadPromises.get(clipKey);
  if (!promise) {
    promise = loadFbx(url).finally(() => fbxLoadPromises.delete(clipKey));
    fbxLoadPromises.set(clipKey, promise);
  }
  return promise.then((fbx) => {
    rawFbxCache.set(clipKey, fbx);
    return fbx;
  });
}

// Fetches (or reuses the cached fetch of) one raw-FBX clip source, then
// retargets/strips/freezes it against the currently active character's rig
// and plays it. Each button owns its own try/catch: these files live in the
// untracked local-clips/ folder, so a fresh clone without them must degrade
// to a per-button error instead of breaking the whole page.
async function activateFbxClip(clipKey, url, label, btn) {
  if (clips.has(clipKey)) {
    playClip(clipKey);
    return;
  }
  btn.classList.remove('error');
  btn.classList.add('loading');
  try {
    const fbx = await loadFbxSource(clipKey, url);
    if (!fbx.animations || fbx.animations.length === 0) throw new Error('no animation track in source file');
    const bonePrefix = currentBonePrefix;
    const clip = stripNonRootPositionAndScale(retargetClipNames(fbx.animations[0], bonePrefix), bonePrefix);
    clips.set(clipKey, freezeRootHorizontalMotion(clip, bonePrefix));
    playClip(clipKey);
  } catch (err) {
    console.error(err);
    btn.classList.add('error');
    setStatus(`Failed to load clip "${label}": ${err.message || err}`, true);
  } finally {
    btn.classList.remove('loading');
  }
}

// Same lazy-fetch/per-button-error pattern as activateFbxClip, but for the
// Manny/UE5-rig top-picks clips: retargetMannyClip() (not
// retargetClipNames/strip/freeze) does the actual bone mapping, since these
// clips share no bone names with the Mixamo rig at all.
async function activateMannyClip(clipKey, url, label, btn) {
  if (clips.has(clipKey)) {
    playClip(clipKey);
    const cachedFbx = rawFbxCache.get(clipKey);
    if (cachedFbx) rebuildComparisonSkeletonIfNeeded(clipKey, cachedFbx, cachedFbx.animations[0]);
    return;
  }
  btn.classList.remove('error');
  btn.classList.add('loading');
  try {
    const fbx = await loadFbxSource(clipKey, url);
    if (!fbx.animations || fbx.animations.length === 0) throw new Error('no animation track in source file');
    if (!currentTargetRestPose) throw new Error('no active character rest pose captured');
    const clip = retargetMannyClip(clipKey, fbx, fbx.animations[0], currentBonePrefix, currentTargetRestPose);
    // NOT freezeRootHorizontalMotion here -- that function assumes local
    // X/Z are horizontal and Y is vertical (true for the OLD raw-FBX Mixamo
    // clips it was written for, loaded Y-up with no wrapper). These
    // characters are Blender-exported with an Armature wrapper where Z is
    // actually vertical (world Y is proportional to -local Z, confirmed
    // empirically -- see retargetMannyClip's Hips block); applying it here
    // zeroed the VERTICAL axis, snapping every character's Hips straight to
    // the floor. retargetMannyClip's own Hips block already freezes the
    // correct (X/Y) horizontal axes by construction.
    clips.set(clipKey, clip);
    playClip(clipKey);
    rebuildComparisonSkeletonIfNeeded(clipKey, fbx, fbx.animations[0]);
  } catch (err) {
    console.error(err);
    btn.classList.add('error');
    setStatus(`Failed to load clip "${label}": ${err.message || err}`, true);
  } finally {
    btn.classList.remove('loading');
  }
}

// Plays a top-picks clip on its OWN native rig -- no bone-name mapping, no
// retargeting math of any kind, just THREE.AnimationMixer binding the clip's
// tracks directly onto the same skeleton they were authored against. This
// is the ground-truth reference for "is this clip actually good," immune by
// construction to every retargeting bug this tool has hit so far.
//
// Uses a CLONED root (fbx.clone(true)), not the cached raw fbx object
// directly -- that cached object is shared with retargetMannyClip, which
// reads its bones' quaternions assuming they're still in the untouched bind
// pose. Driving the cached object with its own mixer here would leave it
// mid-animation the next time a retargeted clip needs to read its "rest"
// pose, silently corrupting the retarget. THREE.AnimationMixer binds tracks
// by bone NAME within whatever root object it's given, so the ORIGINAL
// clip (fbx.animations[0], read-only, safe to share) still plays correctly
// on the clone.
async function activateSkeletonClip(fetchKey, skeletonKey, url, label, btn) {
  btn.classList.remove('error');
  btn.classList.add('loading');
  try {
    // fetchKey (the plain top-picks key, e.g. "tp-idle") shares
    // loadFbxSource's cache with activateMannyClip -- same URL, so no
    // duplicate network fetch just because this button has a different
    // identity (skeletonKey) for UI/active-state purposes.
    const fbx = await loadFbxSource(fetchKey, url);
    if (!fbx.animations || fbx.animations.length === 0) throw new Error('no animation track in source file');

    if (currentAction) currentAction.stop();
    if (skeletonPreviewHelper) scene.remove(skeletonPreviewHelper);
    if (skeletonPreviewRoot) scene.remove(skeletonPreviewRoot);
    if (character) character.visible = false;

    const previewRoot = fbx.clone(true);
    // This source FBX loads Z-up in three.js (confirmed empirically -- see
    // retargetMannyClip's doc comment); rotate -90 about X to match this
    // scene's Y-up convention (grid/camera/every other clip in this tool).
    previewRoot.rotation.set(-Math.PI / 2, 0, 0);
    previewRoot.position.set(0, 0, 0);
    scene.add(previewRoot);

    const helper = new THREE.SkeletonHelper(previewRoot);
    scene.add(helper);

    previewRoot.updateMatrixWorld(true);
    const box = computeBoneBounds(previewRoot);
    if (box) frameCameraToBounds(previewRoot, box);

    skeletonPreviewActive = true;
    skeletonPreviewRoot = previewRoot;
    skeletonPreviewHelper = helper;

    mixer = new THREE.AnimationMixer(previewRoot);
    currentAction = mixer.clipAction(fbx.animations[0]);
    currentAction.reset();
    currentAction.setLoop(THREE.LoopRepeat, Infinity);
    currentAction.timeScale = Number(speedEl.value);
    currentAction.play();
    currentClip = fbx.animations[0];

    scrubEl.value = '0';
    playPauseEl.textContent = 'Pause';
    currentAction.paused = false;
    scrubbing = false;
    setActiveClipButton(skeletonKey);
    setStatus(`Raw skeleton preview: ${label} (no retargeting)`);
    window.__skeletonPreview = { root: previewRoot, mixer, action: currentAction, clip: fbx.animations[0] };
  } catch (err) {
    console.error(err);
    btn.classList.add('error');
    setStatus(`Failed to load clip "${label}": ${err.message || err}`, true);
  } finally {
    btn.classList.remove('loading');
  }
}

let activateRequestId = 0;

// Lazily fetches (via src/assets.js's preloadPlayerModels -- the same
// scoped/cached loader the real game and character picker use) and activates
// one character on click. Per-button loading/error state, so a failed fetch
// never crashes the rest of the page.
async function activateCharacter(key) {
  const myRequestId = ++activateRequestId;
  const btn = characterButtonsEl.querySelector(`[data-character="${key}"]`);
  if (btn) {
    btn.classList.remove('error');
    btn.classList.add('loading');
  }
  setStatus(`Loading ${key}…`);
  try {
    const pack = await preloadPlayerModels([key]);
    if (myRequestId !== activateRequestId) return; // superseded by a newer click
    const record = pack.getModel(key);
    if (!record) throw new Error('model failed to load (see console for details)');
    const scene3 = record.payload.scene;
    scene3.traverse((obj) => {
      if (obj.isMesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
      }
    });

    exitSkeletonPreview();
    if (character) scene.remove(character);
    if (skeletonOverlayHelper) { scene.remove(skeletonOverlayHelper); skeletonOverlayHelper = null; }
    teardownComparisonSkeleton(); // different character = different height/scale factor
    if (currentAction) currentAction.stop();
    currentAction = null;
    currentClip = null;
    clips.clear();
    clipButtonsEl.innerHTML = '';

    character = scene3;
    scene.add(character);
    frameCameraToObject(character);
    skeletonOverlayHelper = new THREE.SkeletonHelper(character);
    skeletonOverlayHelper.visible = skeletonOverlayVisible;
    scene.add(skeletonOverlayHelper);
    mixer = new THREE.AnimationMixer(character);
    characterMixer = mixer;
    currentBonePrefix = detectBonePrefix(character);
    currentTargetRestPose = captureTargetRestPose(character, currentBonePrefix);

    // Any animation baked into this specific character's own export (e.g. an
    // idle/T-pose picked on Mixamo). "mixamo.com" is a watermark/attribution
    // track free Mixamo exports embed, not a real animation -- skip it. (The
    // shipped ch01-12.glb characters carry no baked-in clips at all -- this
    // loop is a no-op for them today, kept for when idle/run/ready/serve
    // clips get added to the character files.)
    (record.payload.animations || []).forEach((clip, i) => {
      if (clip.name === 'mixamo.com') return;
      const name = clip.name || `character_clip_${i}`;
      clips.set(name, retargetClipNames(clip, currentBonePrefix));
      buildClipButton(name, `Character: ${clip.name || i}`, () => playClip(name));
    });

    // forehand/backhand/overhead from the shared, already-fixed GLB clip
    // library -- no retargeting/strip/freeze needed here (unlike the FBX path
    // below): bone names are already canonical on both the GLB characters and
    // this GLB clip library, and root-motion/long-neck fixes are already
    // baked in at build time (tools/build-mixamo-clip-library.mjs).
    (glbSwingClips || []).forEach((clip) => {
      clips.set(clip.name, clip);
      buildClipButton(clip.name, GLB_CLIP_LABELS[clip.name] || clip.name, () => playClip(clip.name));
    });

    for (const { key: clipKey, label, url } of CLIP_SOURCES) {
      buildClipButton(clipKey, label, (btn2) => activateFbxClip(clipKey, url, label, btn2));
    }

    for (const b of characterButtonsEl.children) {
      b.classList.toggle('active', b.dataset.character === key);
    }

    const first = clips.has('forehand') ? 'forehand' : clips.keys().next().value;
    if (first) playClip(first);

    setStatus(`Loaded ${key}. ${clips.size} clip(s) available.`);
    window.__poc = { character, clips, mixer };
  } catch (err) {
    if (myRequestId !== activateRequestId) return;
    console.error(err);
    if (btn) btn.classList.add('error');
    setStatus(`Failed to load ${key}: ${err.message || err}`, true);
  } finally {
    if (btn) btn.classList.remove('loading');
  }
}

async function init() {
  try {
    setStatus('Loading swing clip library…');
    CHARACTERS.forEach((c) => buildCharacterButton(c.key, c.label));
    TOP_PICKS.forEach(({ key, label, url }) => {
      buildTopPickButton(key, label, (btn) => activateMannyClip(key, url, label, btn));
      const skeletonKey = `sk-${key}`;
      buildSkeletonButton(skeletonKey, label, (btn) => activateSkeletonClip(key, skeletonKey, url, label, btn));
    });

    const swingGltf = await loadGlb(GLB_CLIP_LIBRARY_URL);
    glbSwingClips = swingGltf.animations || [];

    window.__THREE = THREE;
    window.__camera = camera;
    window.__controls = controls;
    window.__scene = scene;

    if (CHARACTERS[0]) await activateCharacter(CHARACTERS[0].key);
  } catch (err) {
    console.error(err);
    setStatus(`Load failed: ${err.message || err}`, true);
  }
}

const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const delta = clock.getDelta();

  if (mixer && currentAction && !currentAction.paused && !scrubbing) {
    mixer.update(delta);
    if (currentClip && currentClip.duration > 0) {
      const t = (currentAction.time % currentClip.duration) / currentClip.duration;
      scrubEl.value = String(t);
    }
  }

  if (currentClip && currentAction) {
    frameInfoEl.textContent =
      `time: ${currentAction.time.toFixed(3)}s / ${currentClip.duration.toFixed(3)}s  ` +
      `(${((currentAction.time / currentClip.duration) * 100).toFixed(1)}%)`;
  }

  // Keep the raw-skeleton-beside comparison locked to the character's own
  // action time every frame (not just on click) -- pause/scrub/speed on the
  // main controls all just change `currentAction.time` one way or another,
  // and this makes all of them apply to the comparison for free instead of
  // needing separate wiring per control.
  if (comparisonSkeleton && currentAction) {
    comparisonSkeleton.action.time = currentAction.time;
    comparisonSkeleton.mixer.update(0);
  }

  controls.update();
  renderer.render(scene, camera);
}

init();
animate();
