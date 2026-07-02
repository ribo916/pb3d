/* Build an authored player GLB for a `player-*` manifest slot from a Quaternius
 * "Universal Base Characters" body (CC0) + "Universal Animation Library" (CC0),
 * fitted to the PB3D authored-player adapter contract (see PLAYER-IMPORT.md).
 *
 * OFFLINE, ONE-OFF TOOL. Not wired into npm scripts; its deps are NOT in
 * package.json (like the raw music-generation helpers). Reproduce with:
 *
 *   npm i @gltf-transform/core @gltf-transform/extensions \
 *         @gltf-transform/functions sharp
 *
 *   # quick form (all defaults, reproduces player-human-v1):
 *   node tools/build-player-model.mjs \
 *     "<pack>/Base Characters/Godot - UE/Superhero_Male_FullBody.gltf" \
 *     "<pack>/Unreal-Godot/UAL1_Standard.glb" \
 *     assets/models/players/player-human-v1.glb
 *
 *   # config form (override clips / socket / texture size per player):
 *   node tools/build-player-model.mjs path/to/config.json
 *
 * config.json fields (all optional except base/anim/out):
 *   base, anim, out            input .gltf/.glb paths + output .glb path
 *   clipMap                    { "<sourceClip>": "<idle|ready|run|forehand|
 *                                backhand|serve|smash>" }
 *   socketBone                 bone to hang paddle_socket under (default hand_r)
 *   socketTranslation          [x,y,z] local offset of the socket in the hand
 *   stripTinyBones             drop finger/toe anim channels (default true)
 *   textureSize                max px, square (default 1024)
 *   textureQuality             WebP quality 1-100 (default 88)
 *   resampleTolerance          keyframe resample tolerance (default 1e-3)
 *   hairMesh                   path to a Quaternius "Rigged to Head Bone" hair
 *                              .gltf (e.g. Hair_Long.gltf). Its skin is
 *                              retargeted onto the base skeleton by bone name
 *                              (same trick as the animation clips) and the
 *                              mesh node is tagged as a `hair` variant so the
 *                              adapter shows it only when roster `hairStyle`
 *                              matches `hairVariantValue`.
 *   hairVariantValue           variant value for the merged hair (default
 *                              'long')
 *
 * See PLAYER-IMPORT.md for the itch.io download flow, the texture-filename
 * fix-ups the base pack needs, and the gltf-transform gotchas baked in here.
 */
import fs from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { mergeDocuments, prune, dedup, textureCompress, resample } from '@gltf-transform/functions';
import sharp from 'sharp';

const DEFAULTS = {
  clipMap: {
    Idle_Loop: 'idle',
    Sword_Idle: 'ready',
    Jog_Fwd_Loop: 'run',
    Sword_Attack: 'forehand',
    Punch_Cross: 'backhand',
    Spell_Simple_Shoot: 'serve',
    Punch_Jab: 'smash'
  },
  socketBone: 'hand_r',
  socketTranslation: [0, 0.05, 0],
  stripTinyBones: true,
  textureSize: 1024,
  textureQuality: 88,
  resampleTolerance: 1e-3
};

function loadConfig() {
  const a = process.argv.slice(2);
  if (a.length === 1 && a[0].endsWith('.json')) {
    return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(a[0], 'utf8')) };
  }
  const [base, anim, out] = a;
  if (!base || !anim || !out) {
    console.error('usage: build-player-model.mjs <base> <anim> <out.glb> | <config.json>');
    process.exit(1);
  }
  return { ...DEFAULTS, base, anim, out };
}

const cfg = loadConfig();
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(cfg.base);
const animDoc = await io.read(cfg.anim);
const root = doc.getRoot();

// --- capture base state BEFORE merge ---
const baseScene = root.getDefaultScene() || root.listScenes()[0];
const baseNodesByName = new Map();
for (const n of root.listNodes()) if (n.getName()) baseNodesByName.set(n.getName(), n);
const baseScenes = new Set(root.listScenes());
const baseSkins = new Set(root.listSkins());
const baseMeshes = new Set(root.listMeshes());
const baseMaterials = new Set(root.listMaterials());

// --- merge animation document in ---
mergeDocuments(doc, animDoc);

// --- retarget every animation channel onto the base skeleton by bone name ---
let retargeted = 0, missed = 0;
for (const anim of root.listAnimations()) {
  for (const ch of anim.listChannels()) {
    const tgt = ch.getTargetNode();
    if (!tgt) continue;
    const baseNode = baseNodesByName.get(tgt.getName());
    if (baseNode) { ch.setTargetNode(baseNode); retargeted++; } else missed++;
  }
}
console.log('channels retargeted:', retargeted, 'missed:', missed);

// Channel.dispose() leaves the sampler (+ its accessors) behind — dispose both.
function disposeChannel(ch) {
  const s = ch.getSampler();
  if (s) s.dispose();
  ch.dispose();
}

// --- strip root translation tracks (prevents forward/root-motion drift) ---
const rootBone = baseNodesByName.get('root');
for (const anim of root.listAnimations()) {
  for (const ch of anim.listChannels()) {
    if (ch.getTargetNode() === rootBone && ch.getTargetPath() === 'translation') disposeChannel(ch);
  }
}

// --- drop finger/toe channels (invisible while gripping a paddle; the bulk of
//     keyframe data). Bones stay for skinning; they just hold bind pose. ---
if (cfg.stripTinyBones) {
  const TINY_BONE = /(index|middle|pinky|ring|thumb)_|ball_|_leaf/i;
  let stripped = 0;
  for (const anim of root.listAnimations()) {
    for (const ch of anim.listChannels()) {
      const n = ch.getTargetNode();
      if (n && TINY_BONE.test(n.getName())) { disposeChannel(ch); stripped++; }
    }
  }
  console.log('stripped finger/toe channels:', stripped);
}

// --- keep only mapped animations, rename to adapter keys ---
for (const anim of root.listAnimations()) {
  const key = cfg.clipMap[anim.getName()];
  if (!key) {
    anim.listChannels().forEach((c) => disposeChannel(c));
    anim.listSamplers().forEach((s) => s.dispose());
    anim.dispose();
    continue;
  }
  anim.setName(key);
}
console.log('kept clips:', root.listAnimations().map((a) => a.getName()).join(', ') || '(none)');

// --- optional: merge a pre-rigged hairstyle mesh, retargeting its skin onto
//     the base skeleton by bone name (same trick as the animation channels
//     above). Quaternius ships these hair meshes specifically for this. ---
if (cfg.hairMesh) {
  const preNodes = new Set(root.listNodes());
  const preMeshes = new Set(root.listMeshes());
  const preSkins = new Set(root.listSkins());
  const preMaterials = new Set(root.listMaterials());
  const preScenes = new Set(root.listScenes());

  const hairDoc = await io.read(cfg.hairMesh);
  mergeDocuments(doc, hairDoc);

  const hairMeshNodes = root.listNodes().filter((n) => !preNodes.has(n) && n.getMesh());
  if (!hairMeshNodes.length) throw new Error('no mesh node found in hairMesh doc: ' + cfg.hairMesh);

  for (const node of hairMeshNodes) {
    const oldSkin = node.getSkin();
    if (oldSkin) {
      const newSkin = doc.createSkin(oldSkin.getName());
      for (const j of oldSkin.listJoints()) {
        const baseJoint = baseNodesByName.get(j.getName());
        if (!baseJoint) throw new Error('hair joint not found on base skeleton: ' + j.getName());
        newSkin.addJoint(baseJoint);
      }
      newSkin.setInverseBindMatrices(oldSkin.getInverseBindMatrices());
      const skRoot = oldSkin.getSkeleton();
      if (skRoot) {
        const baseSkRoot = baseNodesByName.get(skRoot.getName());
        if (baseSkRoot) newSkin.setSkeleton(baseSkRoot);
      }
      node.setSkin(newSkin);
      oldSkin.dispose();
    }
    // hair node ships with an identity local transform in its own doc; drop
    // it onto the base scene directly (its pose comes entirely from the
    // retargeted skin, not this node's transform).
    node.setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
    node.setExtras({ variantGroup: 'hair', variantValue: cfg.hairVariantValue || 'long' });
    baseScene.addChild(node);
  }

  for (const m of root.listMeshes()) if (!preMeshes.has(m)) baseMeshes.add(m);
  for (const s of root.listSkins()) if (!preSkins.has(s)) baseSkins.add(s);
  for (const m of root.listMaterials()) if (!preMaterials.has(m)) baseMaterials.add(m);

  // dispose the hair doc's own duplicate skeleton copy (now unreferenced —
  // the mesh node above was already reparented off of it).
  function disposeTree(n) {
    for (const c of n.listChildren()) disposeTree(c);
    n.dispose();
  }
  for (const s of root.listScenes()) {
    if (preScenes.has(s)) continue;
    for (const n of s.listChildren()) disposeTree(n);
    s.dispose();
  }
  console.log('merged hair mesh:', hairMeshNodes.map((n) => n.getName()).join(', '));
}

// --- drop merged-in scenes / skins / meshes / materials that aren't base ---
for (const s of root.listScenes()) if (!baseScenes.has(s)) s.dispose();
for (const s of root.listSkins()) if (!baseSkins.has(s)) s.dispose();
for (const m of root.listMeshes()) if (!baseMeshes.has(m)) m.dispose();
for (const m of root.listMaterials()) if (!baseMaterials.has(m)) m.dispose();

root.setDefaultScene(baseScene);

// --- GLB requires a single buffer ---
const mainBuffer = root.listBuffers()[0];
for (const acc of root.listAccessors()) acc.setBuffer(mainBuffer);
for (const b of root.listBuffers()) if (b !== mainBuffer) b.dispose();

// --- clean orphans, then compress textures ---
await doc.transform(
  resample({ tolerance: cfg.resampleTolerance }),
  prune(),
  dedup(),
  textureCompress({ encoder: sharp, targetFormat: 'webp', quality: cfg.textureQuality, resize: [cfg.textureSize, cfg.textureSize] })
);

// --- add paddle_socket under the chosen hand bone (AFTER prune; empty leaf) ---
const handBone = baseNodesByName.get(cfg.socketBone);
if (!handBone) throw new Error('socket bone not found: ' + cfg.socketBone);
const socket = doc.createNode('paddle_socket');
socket.setTranslation(cfg.socketTranslation);
socket.setExtras({ slot: 'paddleSocket' });
handBone.addChild(socket);

// --- dispose any accessors left attached only to Root (sampler leftovers) ---
let orphans = 0;
for (const acc of root.listAccessors()) {
  if (acc.listParents().filter((p) => p.propertyType !== 'Root').length === 0) { acc.dispose(); orphans++; }
}
if (orphans) console.log('disposed orphan accessors:', orphans);

await io.write(cfg.out, doc);
const bytes = fs.statSync(cfg.out).size;
console.log(`wrote ${cfg.out} (${(bytes / 1024 / 1024).toFixed(2)} MB, ${root.listAnimations().length} clips)`);
