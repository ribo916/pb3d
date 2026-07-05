/* Validate the visual-player GLB import contract without rendering.
 * Usage:
 *   node tools/validate-player-glb.mjs assets/models/players/mixamo/ch01.glb
 */

/* Headless texture shims: real authored character GLBs embed compressed
 * textures (PNG/WebP). three's GLTFLoader decodes images via the DOM
 * (Image / createObjectURL / fetch / createImageBitmap), which is absent in
 * Node. These no-op shims let the loader PARSE a textured GLB so we can
 * inspect geometry, nodes, materials, and clips. Pixels are not needed here. */
if (typeof globalThis.self === 'undefined') globalThis.self = globalThis;
if (typeof globalThis.createImageBitmap === 'undefined') {
  globalThis.createImageBitmap = async () => ({ width: 1, height: 1, close() {} });
}
if (typeof globalThis.Image === 'undefined') {
  globalThis.Image = class {
    constructor() { this.width = 1; this.height = 1; }
    set src(_v) { queueMicrotask(() => { if (this.onload) this.onload(); }); }
  };
}
if (typeof globalThis.URL.createObjectURL !== 'function') {
  const __blobUrls = new Map();
  let __blobId = 0;
  globalThis.URL.createObjectURL = (blob) => {
    const url = 'blob:pb3d/' + (++__blobId);
    __blobUrls.set(url, blob);
    return url;
  };
  globalThis.URL.revokeObjectURL = (url) => __blobUrls.delete(url);
  const __nativeFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => (
    typeof url === 'string' && __blobUrls.has(url)
      ? new Response(__blobUrls.get(url))
      : __nativeFetch(url, opts)
  );
}

import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

const file = process.argv[2] || 'assets/models/players/mixamo/ch01.glb';
const abs = path.resolve(process.cwd(), file);
// Budget applies to the Mixamo-sourced roster (see
// character-preview/CONTEXT.md, GRAPHICS.md).
const SIZE_BUDGET_MB = Number(process.argv[3]) || 3;

function slotFor(mesh, mat) {
  const tags = [
    mesh && mesh.name,
    mat && mat.name,
    mesh && mesh.userData && (mesh.userData.slot || mesh.userData.materialSlot)
  ].join(' ').toLowerCase();
  if (/jersey|shirt|top|torso|team/.test(tags)) return 'jersey';
  if (/short|pants|bottom|skirt/.test(tags)) return 'shorts';
  if (/shoe|sneaker|sock/.test(tags)) return 'shoe';
  if (/hair|brow/.test(tags)) return 'hair';
  if (/paddle|racket|racquet/.test(tags)) return 'paddle';
  if (/band|cap|visor|hat/.test(tags)) return 'headband';
  if (/skin|head|face|hand|arm|leg/.test(tags)) return 'skin';
  return '';
}

function clipKey(name) {
  name = String(name || '').toLowerCase();
  if (/ready/.test(name)) return 'ready';
  if (/idle|stand/.test(name)) return 'idle';
  if (/run|jog|walk|move/.test(name)) return 'run';
  if (/backhand|bh/.test(name)) return 'backhand';
  if (/forehand|fh|drive|swing/.test(name)) return 'forehand';
  if (/serve/.test(name)) return 'serve';
  if (/smash|overhead/.test(name)) return 'smash';
  return '';
}

function materialList(material) {
  return Array.isArray(material) ? material : [material].filter(Boolean);
}

function collectMaterialTextures(mat, out) {
  [
    'map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap',
    'emissiveMap', 'alphaMap', 'bumpMap', 'displacementMap'
  ].forEach((key) => {
    if (mat && mat[key]) out.add(mat[key].uuid || mat[key].name || key);
  });
}

async function loadGltf(filename) {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const buf = await fs.readFile(filename);
  const data = path.extname(filename).toLowerCase() === '.gltf'
    ? buf.toString('utf8')
    : buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const resourcePath = pathToFileURL(path.dirname(filename) + path.sep).href;
  return await new Promise((resolve, reject) => {
    loader.parse(data, resourcePath, resolve, reject);
  });
}

function formatVec(v) {
  return [v.x, v.y, v.z].map((n) => n.toFixed(2)).join(' x ');
}

let gltf;
try {
  gltf = await loadGltf(abs);
} catch (error) {
  console.error('Player GLB validation failed to load:');
  console.error(error && error.message ? error.message : error);
  process.exit(1);
}

const root = gltf.scene;
const nodeNames = new Set();
const materialNames = new Set();
const textureIds = new Set();
const slots = new Set();
let meshes = 0;
let skinnedMeshes = 0;
let triangles = 0;

root.updateWorldMatrix(true, true);
root.traverse((node) => {
  if (node.name) nodeNames.add(node.name);
  if (!node.isMesh) return;
  meshes += 1;
  if (node.isSkinnedMesh) skinnedMeshes += 1;
  const geom = node.geometry;
  if (geom) {
    if (geom.index) triangles += geom.index.count / 3;
    else if (geom.attributes && geom.attributes.position) triangles += geom.attributes.position.count / 3;
  }
  materialList(node.material).forEach((mat) => {
    if (mat && mat.name) materialNames.add(mat.name);
    collectMaterialTextures(mat, textureIds);
    const slot = slotFor(node, mat);
    if (slot) slots.add(slot);
  });
});

// Bounds from geometry positions in world space. `Box3.setFromObject(root)`
// (imprecise mode) only applies each mesh NODE's own matrixWorld, which
// under-measures a SkinnedMesh whenever the mesh node's own local transform
// isn't a reasonable stand-in for the true skinned shape (confirmed on a
// Mixamo/Blender-exported character: naive node-matrix bounds read as
// 0.02 x 1.45 x 0.02 -- a near-zero-width "needle" -- while the actual
// bind-pose shape, verified independently via manual joint*inverseBind
// skinning math, is a normal ~1.6 x 2.1 x 0.7 m T-pose). `precise: true`
// applies real per-vertex skin deformation (bone matrices) instead, and
// matches that independently-verified true shape -- use it for both
// skinned and static meshes.
root.updateMatrixWorld(true);
const box = new THREE.Box3().setFromObject(root, true);
const size = new THREE.Vector3();
box.getSize(size);

const socketNames = ['paddle_socket', 'paddlesocket', 'right_hand_socket', 'hand_r_socket'];
const hasSocket = [...nodeNames].some((name) => socketNames.some((needle) => name.toLowerCase().includes(needle)));
const armNodes = [
  'visual_left_upper_arm',
  'visual_left_forearm',
  'visual_right_upper_arm',
  'visual_right_forearm'
];
const missingArmNodes = armNodes.filter((name) => !nodeNames.has(name));

// Facing diagnostic: measure, don't guess (see PLAYER-IMPORT.md). Finds a
// bone by trying several naming variants (plain rig names, and Mixamo's
// `mixamorig:`/`mixamorigN:` prefixed names), reads its CURRENT world
// position (post playerRotation, if this file is loaded already wired into
// the manifest with a rotation applied upstream -- here we read the raw
// GLB's own rest pose, i.e. what playerRotation: [0,0,0] would look like),
// and reports which horizontal axis/sign the toe-vs-heel and head-vs-neck
// vectors point along, so a per-model playerRotation can be picked from
// evidence instead of trial and error.
function findBoneNamed(root, baseNames) {
  // three's GLTFLoader sanitizes node names and strips the colon out of
  // glTF-source names like "mixamorig:Hips" -> "mixamorigHips" at runtime,
  // so match both the raw glTF-source form (colon) and the sanitized
  // runtime form (no colon), across the numbered Mixamo prefix variants
  // some characters in this roster carry (see tools/lib/mixamo-bones.mjs).
  const prefixes = [];
  ['', 'mixamorig', 'mixamorig1', 'mixamorig2', 'mixamorig3', 'mixamorig4',
    'mixamorig5', 'mixamorig6', 'mixamorig7', 'mixamorig8', 'mixamorig9', 'mixamorig10'].forEach((p) => {
    prefixes.push(p);
    if (p) prefixes.push(p + ':');
  });
  for (const base of baseNames) {
    for (const prefix of prefixes) {
      const node = root.getObjectByName(prefix + base);
      if (node) return node;
    }
  }
  return null;
}

function dominantAxis(vec) {
  const abs = { x: Math.abs(vec.x), y: Math.abs(vec.y), z: Math.abs(vec.z) };
  const axis = abs.x >= abs.z ? 'x' : 'z';
  const sign = vec[axis] >= 0 ? '+' : '-';
  return sign + axis.toUpperCase();
}

function facingReport(root) {
  const toe = findBoneNamed(root, ['LeftToeBase', 'RightToeBase', 'LeftToe_End']);
  const foot = findBoneNamed(root, ['LeftFoot', 'RightFoot']);
  const head = findBoneNamed(root, ['Head']);
  const neck = findBoneNamed(root, ['Neck']);
  const lines = [];
  const pToe = new THREE.Vector3();
  const pFoot = new THREE.Vector3();
  const pHead = new THREE.Vector3();
  const pNeck = new THREE.Vector3();
  if (toe && foot) {
    toe.getWorldPosition(pToe);
    foot.getWorldPosition(pFoot);
    const dir = pToe.clone().sub(pFoot);
    lines.push(`toe-vs-foot: dz=${dir.z.toFixed(3)} dx=${dir.x.toFixed(3)} -> facing ${dominantAxis(dir)}`);
  } else {
    lines.push('toe-vs-foot: bones not found (' + (toe ? 'toe OK' : 'toe MISSING') + ', ' + (foot ? 'foot OK' : 'foot MISSING') + ')');
  }
  if (head && neck) {
    head.getWorldPosition(pHead);
    neck.getWorldPosition(pNeck);
    const dir = pHead.clone().sub(pNeck);
    lines.push(`head-vs-neck: dz=${dir.z.toFixed(3)} dx=${dir.x.toFixed(3)} dy=${dir.y.toFixed(3)} (expect small horizontal lean, not a facing signal alone)`);
  }
  return lines;
}
const facingLines = facingReport(root);

const clips = new Map();
(gltf.animations || []).forEach((clip) => {
  const key = clipKey(clip.name);
  if (key && !clips.has(key)) clips.set(key, clip.name);
});
const expectedClips = ['idle', 'ready', 'run', 'forehand', 'backhand', 'serve', 'smash'];
const missingClips = expectedClips.filter((key) => !clips.has(key));
const expectedSlots = ['jersey', 'shorts', 'skin', 'hair', 'shoe', 'headband'];
const missingSlots = expectedSlots.filter((key) => !slots.has(key));

const fileSizeMB = fsSync.statSync(abs).size / 1024 / 1024;
const usedExtensions = (gltf.parser && gltf.parser.json && gltf.parser.json.extensionsUsed) || [];
const hasMeshopt = usedExtensions.includes('EXT_meshopt_compression');

console.log('Player GLB validation');
console.log('file:', path.relative(process.cwd(), abs));
console.log('size:', fileSizeMB.toFixed(2) + ' MB', '(budget: ' + SIZE_BUDGET_MB + ' MB)');
console.log('meshopt geometry compression:', hasMeshopt ? 'OK' : 'not present');
console.log('meshes:', meshes, 'skinned:', skinnedMeshes, 'triangles:', Math.round(triangles));
console.log('materials:', materialNames.size, 'textures:', textureIds.size);
console.log('bounds:', formatVec(size), '(w x h x d)');
console.log('paddle_socket:', hasSocket ? 'OK' : 'MISSING');
facingLines.forEach((line) => console.log('facing:', line));
console.log('color slots:', [...slots].sort().join(', ') || 'none');
console.log('clips:', expectedClips.map((key) => key + '=' + (clips.get(key) || 'missing')).join(', '));

const warnings = [];
if (fileSizeMB > SIZE_BUDGET_MB) warnings.push(`file size ${fileSizeMB.toFixed(2)} MB exceeds the ${SIZE_BUDGET_MB} MB mobile-over-cellular budget`);
if (size.y < 1.4 || size.y > 2.2) warnings.push('height is outside the recommended 1.7-1.9 m authored-player range');
if (missingArmNodes.length) warnings.push('missing primitive-arm sync nodes: ' + missingArmNodes.join(', '));
if (missingSlots.length) warnings.push('missing recommended color slots: ' + missingSlots.join(', '));
if (missingClips.length) warnings.push('missing recommended animation clips: ' + missingClips.join(', '));
if (triangles > 90000) warnings.push('triangle count is above the recommended Player 1 budget; consider LOD/mobile fallback');

warnings.forEach((warning) => console.warn('warning:', warning));

if (!hasSocket) {
  console.error('error: required paddle_socket node was not found');
  process.exit(1);
}
