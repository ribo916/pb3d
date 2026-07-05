import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { ASSET_MANIFEST } from '../assets/manifest.js';
import { makeGltfLoader, preloadPlayerModels } from '../src/assets.js';

const statusEl = document.getElementById('status');
const frameInfoEl = document.getElementById('frameInfo');
const characterButtonsEl = document.getElementById('characterButtons');
const clipButtonsEl = document.getElementById('clipButtons');
const playPauseEl = document.getElementById('playPause');
const scrubEl = document.getElementById('scrub');
const speedEl = document.getElementById('speed');

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

let mixer = null;
let currentAction = null;
let currentClip = null;
let scrubbing = false;

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
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);

  // Ground the model at y=0 regardless of its authored origin.
  object.position.y -= box.min.y;
  object.updateMatrixWorld(true);
  box.setFromObject(object, true);
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

function buildClipButton(key, label, onClick) {
  const btn = document.createElement('button');
  btn.textContent = label;
  btn.dataset.clip = key;
  btn.addEventListener('click', () => onClick(btn));
  clipButtonsEl.appendChild(btn);
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
let glbSwingClips = null; // THREE.AnimationClip[] from pickleball-swings.glb, loaded once at init()

// Raw FBX clip sources are fetched at most once (network cost); the
// retargeted/stripped/frozen clip derived from them is per-active-character
// and gets rebuilt (cheaply, from the cached raw data) on every activation.
const rawFbxCache = new Map(); // clipKey -> loaded FBX root object
const fbxLoadPromises = new Map(); // clipKey -> in-flight load promise, deduped

function playClip(name) {
  const clip = clips.get(name);
  if (!clip || !mixer) return;

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

  for (const btn of clipButtonsEl.children) {
    btn.classList.toggle('active', btn.dataset.clip === name);
  }
}

playPauseEl.addEventListener('click', () => {
  if (!currentAction) return;
  currentAction.paused = !currentAction.paused;
  playPauseEl.textContent = currentAction.paused ? 'Play' : 'Pause';
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

    if (character) scene.remove(character);
    if (currentAction) currentAction.stop();
    currentAction = null;
    currentClip = null;
    clips.clear();
    clipButtonsEl.innerHTML = '';

    character = scene3;
    scene.add(character);
    frameCameraToObject(character);
    mixer = new THREE.AnimationMixer(character);
    currentBonePrefix = detectBonePrefix(character);

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

    const swingGltf = await loadGlb(GLB_CLIP_LIBRARY_URL);
    glbSwingClips = swingGltf.animations || [];

    window.__THREE = THREE;
    window.__camera = camera;
    window.__controls = controls;

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

  controls.update();
  renderer.render(scene, camera);
}

init();
animate();
