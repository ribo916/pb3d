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
 *   # quick form (all defaults, reproduces player-male-v1 minus its hair):
 *   node tools/build-player-model.mjs \
 *     "<pack>/Base Characters/Godot - UE/Superhero_Male_FullBody.gltf" \
 *     "<pack>/Unreal-Godot/UAL1_Standard.glb" \
 *     assets/models/players/player-male-v1.glb
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
 *   extraMeshes                array of { path, variantGroup, variantValue }.
 *                              Each path is a Quaternius "Rigged to Head
 *                              Bone" mesh .gltf (e.g. Hair_Long.gltf or
 *                              Hair_Beard.gltf). Its skin is retargeted onto
 *                              the base skeleton by bone name (same trick as
 *                              the animation clips) and the mesh node is
 *                              tagged with the given variantGroup/variantValue
 *                              so the adapter shows it only when the
 *                              roster's matching cosmetic field (e.g.
 *                              hairStyle, facialHair) equals variantValue.
 *                              Multiple entries can share a variantGroup
 *                              (e.g. several hairstyles) to bake all options
 *                              into one GLB, toggled at runtime — or use
 *                              distinct groups (e.g. hair vs facialHair) so
 *                              two layers can be visible at once. AVOID
 *                              merging a mesh authored for a different donor
 *                              body/pack than `base` (e.g. clothing cut from
 *                              a different character) — matching bone names
 *                              is enough to retarget the skin without
 *                              erroring, but if the donor body's proportions
 *                              differ, the merged mesh will sit almost
 *                              flush against (and z-fight with) the base
 *                              body's own surface. This is exactly what went
 *                              wrong trying to reuse a "Modular Character
 *                              Outfits" pants mesh on this "Universal Base
 *                              Characters" body — no amount of polygon-offset
 *                              tuning fully fixed it, and the feature was
 *                              removed rather than shipped as a rendering
 *                              hack. Stick to meshes from the SAME pack as
 *                              `base` (hair here) unless you've confirmed
 *                              the donor asset is actually meant to attach
 *                              to this body, not just share bone names.
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

// Precompute each base-skeleton joint's inverse-bind matrix from the base
// body's own skin. Extra meshes (hair, pants) merged in later may come from
// a DIFFERENT Quaternius pack than the base body/anim (e.g. the pants come
// from "Modular Character Outfits", not "Universal Base Characters") — even
// when their skeleton uses the same bone NAMES, the donor rig's rest pose
// can differ enough that reusing its own inverse-bind matrices produces
// deformed/collapsed geometry once rebound to our joints. Always rebuild
// inverse-bind matrices from THIS base skin instead of trusting the donor's.
const baseJointInvBind = new Map();
for (const skin of baseSkins) {
  const ibm = skin.getInverseBindMatrices();
  if (!ibm) continue;
  const arr = ibm.getArray();
  skin.listJoints().forEach((joint, i) => {
    baseJointInvBind.set(joint, arr.slice(i * 16, i * 16 + 16));
  });
}

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

// --- optional: merge N pre-rigged extra meshes (hairstyles, facial hair,
//     ...), retargeting each skin onto the base skeleton by bone name (same
//     trick as the animation channels above). Quaternius ships meshes rigged
//     to the shared base skeleton specifically for this. Each entry is
//     merged and cleaned up in its own iteration so multiple meshes
//     accumulate into one output GLB instead of clobbering each other. ---
function disposeTree(n) {
  for (const c of n.listChildren()) disposeTree(c);
  n.dispose();
}

for (const extra of cfg.extraMeshes || []) {
  const preNodes = new Set(root.listNodes());
  const preMeshes = new Set(root.listMeshes());
  const preSkins = new Set(root.listSkins());
  const preMaterials = new Set(root.listMaterials());
  const preScenes = new Set(root.listScenes());

  const extraDoc = await io.read(extra.path);
  mergeDocuments(doc, extraDoc);

  const extraMeshNodes = root.listNodes().filter((n) => !preNodes.has(n) && n.getMesh());
  if (!extraMeshNodes.length) throw new Error('no mesh node found in extraMeshes doc: ' + extra.path);

  for (const node of extraMeshNodes) {
    const oldSkin = node.getSkin();
    if (oldSkin) {
      const newSkin = doc.createSkin(oldSkin.getName());
      const joints = [];
      for (const j of oldSkin.listJoints()) {
        const baseJoint = baseNodesByName.get(j.getName());
        if (!baseJoint) throw new Error('joint not found on base skeleton: ' + j.getName());
        newSkin.addJoint(baseJoint);
        joints.push(baseJoint);
      }
      // Use the BASE skeleton's own inverse-bind matrices (not the donor
      // mesh's) — see the baseJointInvBind comment above for why.
      const invBindData = new Float32Array(joints.length * 16);
      joints.forEach((baseJoint, i) => {
        const m = baseJointInvBind.get(baseJoint);
        if (!m) throw new Error('no base inverse-bind matrix for joint: ' + baseJoint.getName());
        invBindData.set(m, i * 16);
      });
      const invBindAccessor = doc.createAccessor().setArray(invBindData).setType('MAT4');
      newSkin.setInverseBindMatrices(invBindAccessor);
      const skRoot = oldSkin.getSkeleton();
      if (skRoot) {
        const baseSkRoot = baseNodesByName.get(skRoot.getName());
        if (baseSkRoot) newSkin.setSkeleton(baseSkRoot);
      }
      node.setSkin(newSkin);
      oldSkin.dispose();
    }
    // extra mesh node ships with an identity local transform in its own doc;
    // drop it onto the base scene directly (its pose comes entirely from the
    // retargeted skin, not this node's transform).
    node.setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
    node.setExtras({ variantGroup: extra.variantGroup, variantValue: extra.variantValue });
    baseScene.addChild(node);
  }

  for (const m of root.listMeshes()) if (!preMeshes.has(m)) baseMeshes.add(m);
  for (const s of root.listSkins()) if (!preSkins.has(s)) baseSkins.add(s);
  for (const m of root.listMaterials()) if (!preMaterials.has(m)) baseMaterials.add(m);

  // dispose this mesh's own duplicate skeleton copy (now unreferenced — the
  // mesh node above was already reparented off of it).
  for (const s of root.listScenes()) {
    if (preScenes.has(s)) continue;
    for (const n of s.listChildren()) disposeTree(n);
    s.dispose();
  }
  console.log('merged extra mesh (' + extra.variantGroup + '/' + extra.variantValue + '):',
    extraMeshNodes.map((n) => n.getName()).join(', '));
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
