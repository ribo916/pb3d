/* Validate the visual-player GLB import contract without rendering.
 * Usage:
 *   node tools/validate-player-glb.mjs assets/models/players/player-poc.glb
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const file = process.argv[2] || 'assets/models/players/player-poc.glb';
const abs = path.resolve(process.cwd(), file);

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

const box = new THREE.Box3().setFromObject(root);
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

const clips = new Map();
(gltf.animations || []).forEach((clip) => {
  const key = clipKey(clip.name);
  if (key && !clips.has(key)) clips.set(key, clip.name);
});
const expectedClips = ['idle', 'ready', 'run', 'forehand', 'backhand', 'serve', 'smash'];
const missingClips = expectedClips.filter((key) => !clips.has(key));
const expectedSlots = ['jersey', 'shorts', 'skin', 'hair', 'shoe', 'headband'];
const missingSlots = expectedSlots.filter((key) => !slots.has(key));

console.log('Player GLB validation');
console.log('file:', path.relative(process.cwd(), abs));
console.log('meshes:', meshes, 'skinned:', skinnedMeshes, 'triangles:', Math.round(triangles));
console.log('materials:', materialNames.size, 'textures:', textureIds.size);
console.log('bounds:', formatVec(size), '(w x h x d)');
console.log('paddle_socket:', hasSocket ? 'OK' : 'MISSING');
console.log('color slots:', [...slots].sort().join(', ') || 'none');
console.log('clips:', expectedClips.map((key) => key + '=' + (clips.get(key) || 'missing')).join(', '));

const warnings = [];
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
