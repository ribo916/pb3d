/* Build ONE shared animation-clip-library GLB from several Blender-converted
 * Mixamo mocap clips (see tools/blender-fbx-to-gltf.py "clip" mode). This is
 * the O(1) alternative to baking swing clips into every character GLB: one
 * small file, loaded once, applied at runtime to whichever roster character
 * is active via src/players.js's collectAnimationClips(), which already
 * merges `opts.assets.animations[...]` clips onto a model by recognized
 * name -- no runtime code change needed, that hook already exists (see
 * assets/manifest.js's `animations` bucket and src/assets.js line ~155).
 *
 * OFFLINE, ONE-OFF TOOL. Deps not in package.json:
 *   npm i --no-save @gltf-transform/core @gltf-transform/extensions @gltf-transform/functions
 *
 * Usage:
 *   node tools/build-mixamo-clip-library.mjs out.glb \
 *     forehand=path/to/forehand.glb backhand=path/to/backhand.glb overhead=path/to/overhead.glb
 *
 * Each `<key>=<path>` pins the adapter clip name (src/players.js's clipKey()
 * regexes match on 'forehand'/'fh', 'backhand'/'bh', 'smash'/'overhead',
 * etc. -- use the exact key you want the output animation named).
 */
import fs from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { mergeDocuments, prune, dedup, resample } from '@gltf-transform/functions';
import {
  detectBonePrefix,
  normalizeBoneNames,
  stripNonRootPositionAndScale,
  freezeRootHorizontalMotion,
  stripTinyBoneChannels
} from './lib/mixamo-bones.mjs';

const [outPath, ...clipArgs] = process.argv.slice(2);
if (!outPath || !clipArgs.length) {
  console.error('usage: build-mixamo-clip-library.mjs <out.glb> <key>=<path.glb> [<key>=<path.glb> ...]');
  process.exit(1);
}
const clips = clipArgs.map((a) => {
  const i = a.indexOf('=');
  return { key: a.slice(0, i), path: a.slice(i + 1) };
});

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

// --- first clip's document becomes the base: it owns the one canonical
//     skeleton every other clip's channels get retargeted onto by name. ---
const baseDoc = await io.read(clips[0].path);
normalizeBoneNames(baseDoc, detectBonePrefix(baseDoc));
const baseRoot = baseDoc.getRoot();
const baseNodesByName = new Map();
for (const n of baseRoot.listNodes()) if (n.getName()) baseNodesByName.set(n.getName(), n);
const baseScene = baseRoot.getDefaultScene() || baseRoot.listScenes()[0];
const baseScenes = new Set(baseRoot.listScenes());

baseRoot.listAnimations()[0].setName(clips[0].key);
console.log('base clip', clips[0].path, '->', clips[0].key);

function disposeChannel(ch) {
  const s = ch.getSampler();
  if (s) s.dispose();
  ch.dispose();
}

function disposeTree(n) {
  for (const c of n.listChildren()) disposeTree(c);
  n.dispose();
}

for (const { key, path } of clips.slice(1)) {
  const doc = await io.read(path);
  normalizeBoneNames(doc, detectBonePrefix(doc));

  const preScenes = new Set(baseRoot.listScenes());
  mergeDocuments(baseDoc, doc);

  let retargeted = 0, missed = 0;
  // Each source clip file has exactly one animation. Previously-processed
  // clips are already renamed to their adapter key, so the one animation
  // whose name isn't yet any assigned key is this iteration's freshly
  // merged one.
  const merged = baseRoot.listAnimations().find((a) => !clips.some((c) => c.key === a.getName()));
  for (const ch of merged.listChannels()) {
    const tgt = ch.getTargetNode();
    if (!tgt) continue;
    const baseNode = baseNodesByName.get(tgt.getName());
    if (baseNode && baseNode !== tgt) { ch.setTargetNode(baseNode); retargeted++; } else if (!baseNode) missed++;
  }
  merged.setName(key);
  console.log('clip', path, '->', key, `(retargeted ${retargeted}, missed ${missed})`);

  // drop the merged doc's own duplicate skeleton scene (now unreferenced).
  for (const s of baseRoot.listScenes()) {
    if (preScenes.has(s)) continue;
    for (const n of s.listChildren()) disposeTree(n);
    s.dispose();
  }
}

baseRoot.setDefaultScene(baseScene);
for (const s of baseRoot.listScenes()) if (!baseScenes.has(s)) s.dispose();

stripNonRootPositionAndScale(baseDoc);
freezeRootHorizontalMotion(baseDoc);
stripTinyBoneChannels(baseDoc);

await baseDoc.transform(resample({ tolerance: 1e-3 }), prune(), dedup());

const mainBuffer = baseRoot.listBuffers()[0];
for (const acc of baseRoot.listAccessors()) acc.setBuffer(mainBuffer);
for (const b of baseRoot.listBuffers()) if (b !== mainBuffer) b.dispose();

await io.write(outPath, baseDoc);
const bytes = fs.statSync(outPath).size;
console.log(`wrote ${outPath} (${(bytes / 1024 / 1024).toFixed(2)} MB, ${baseRoot.listAnimations().length} clips: ${baseRoot.listAnimations().map((a) => a.getName()).join(', ')})`);
