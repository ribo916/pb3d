/* Build an optimized, mobile-sized player character GLB from a
 * Blender-converted Mixamo character glTF (see tools/blender-fbx-to-gltf.py
 * "character" mode). Sibling tool to tools/build-player-model.mjs, but for
 * the new Mixamo roster instead of the Quaternius base bodies:
 *   - no animation merge (swing/idle/run clips live in ONE shared file,
 *     see tools/build-mixamo-clip-library.mjs, not baked per-character)
 *   - meshopt geometry compression instead of leaving geometry uncompressed
 *   - a small procedural "headband" accessory node instead of full
 *     jersey/shorts mesh-splitting (tools/paint-player-clothing.mjs), so
 *     team color still works through the EXISTING src/players.js
 *     materialSlot('headband') / tintMaterial() runtime path with zero
 *     runtime code changes -- just needs a mesh/material named to match
 *     that slot's name regex (/band|cap|visor|hat/).
 *
 * OFFLINE, ONE-OFF TOOL. Deps not in package.json (same convention as
 * build-player-model.mjs): npm i --no-save @gltf-transform/core
 * @gltf-transform/extensions @gltf-transform/functions sharp meshoptimizer
 *
 * Usage:
 *   node tools/build-mixamo-character.mjs <in.glb> <out.glb> [socketBone]
 *
 * <in.glb> is the output of `blender-fbx-to-gltf.py character <fbx> <glb>`.
 * [socketBone] defaults to mixamorig:RightHand.
 */
import fs from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, dedup, weld, meshopt, textureCompress } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';
import { detectBonePrefix, normalizeBoneNames } from './lib/mixamo-bones.mjs';
import { normalizeCharacterMaterials } from './lib/normalize-materials.mjs';

const [inPath, outPath, socketBoneArg] = process.argv.slice(2);
if (!inPath || !outPath) {
  console.error('usage: build-mixamo-character.mjs <in.glb> <out.glb> [socketBone]');
  process.exit(1);
}

await MeshoptEncoder.ready;

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(inPath);
const root = doc.getRoot();

const bonePrefix = detectBonePrefix(doc);
const renamed = normalizeBoneNames(doc, bonePrefix);
console.log('detected bone prefix:', bonePrefix, renamed ? `(renamed ${renamed} nodes)` : '(already canonical)');

const socketBoneName = socketBoneArg || 'mixamorig:RightHand';
const handBone = root.listNodes().find((n) => n.getName() === socketBoneName);
if (!handBone) throw new Error('socket bone not found: ' + socketBoneName);

const headBone = root.listNodes().find((n) => n.getName() === 'mixamorig:Head');
if (!headBone) throw new Error('head bone not found for headband accessory');

// --- paddle_socket (added later, after prune, same trap as build-player-model.mjs:
//     prune() deletes empty leaf nodes) ---

// --- procedural headband accessory: a small crude box band around the
//     forehead, parented directly to the Head bone (like paddle_socket,
//     it just rides the bone's animated transform -- not itself skinned).
//     Placeholder art; matches src/players.js's materialSlot() 'headband'
//     regex (/band|cap|visor|hat/) via its mesh/material name so the
//     existing runtime tinting path picks it up with zero code changes. ---
function buildHeadbandMesh() {
  const w = 0.09, h = 0.02, d = 0.09; // meters, half-extents around the head
  const positions = new Float32Array([
    -w, -h, -d,  w, -h, -d,  w, h, -d,  -w, h, -d, // back
    -w, -h,  d,  w, -h,  d,  w, h,  d,  -w, h,  d, // front
  ]);
  const indices = new Uint16Array([
    0, 1, 2, 0, 2, 3, // back
    4, 6, 5, 4, 7, 6, // front
    0, 4, 5, 0, 5, 1, // bottom
    3, 2, 6, 3, 6, 7, // top
    0, 3, 7, 0, 7, 4, // left
    1, 5, 6, 1, 6, 2, // right
  ]);
  const posAccessor = doc.createAccessor('headband_position').setArray(positions).setType('VEC3');
  const idxAccessor = doc.createAccessor('headband_indices').setArray(indices).setType('SCALAR');
  const material = doc.createMaterial('Headband').setBaseColorFactor([1, 1, 1, 1]).setRoughnessFactor(0.8).setMetallicFactor(0);
  const prim = doc.createPrimitive().setAttribute('POSITION', posAccessor).setIndices(idxAccessor).setMaterial(material);
  const mesh = doc.createMesh('Headband').addPrimitive(prim);
  const node = doc.createNode('Headband').setMesh(mesh).setTranslation([0, 0.02, 0.02]);
  node.setExtras({ slot: 'headband' });
  headBone.addChild(node);
  return node;
}
buildHeadbandMesh();

// --- normalize PBR materials so skin/cloth/hair don't read oily/"wet"
//     (detach KHR_materials_specular boost, zero metalness, floor roughness);
//     the prune() below then drops the orphaned specular textures. Shared with
//     tools/fix-mixamo-materials.mjs so a rebuild can't regress. ---
const matSummary = normalizeCharacterMaterials(doc);
console.log('normalized materials:', JSON.stringify(matSummary));

// --- meshopt geometry compression (weld first: meshopt needs indexed,
//     welded geometry to reorder/quantize effectively) ---
await doc.transform(
  weld(),
  prune(),
  dedup(),
  textureCompress({ encoder: sharp, targetFormat: 'webp', quality: 88, resize: [1024, 1024] }),
  meshopt({ encoder: MeshoptEncoder, level: 'medium' })
);

// --- paddle_socket, added AFTER prune (prune deletes empty leaf nodes) ---
const socket = doc.createNode('paddle_socket');
socket.setTranslation([0, 0.05, 0]);
socket.setExtras({ slot: 'paddleSocket' });
handBone.addChild(socket);

// --- GLB requires a single buffer ---
const mainBuffer = root.listBuffers()[0];
for (const acc of root.listAccessors()) acc.setBuffer(mainBuffer);
for (const b of root.listBuffers()) if (b !== mainBuffer) b.dispose();

await io.write(outPath, doc);
const bytes = fs.statSync(outPath).size;
console.log(`wrote ${outPath} (${(bytes / 1024 / 1024).toFixed(2)} MB)`);
