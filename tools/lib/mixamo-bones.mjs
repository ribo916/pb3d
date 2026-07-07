/* Shared Mixamo bone/clip fixes, applied at BUILD TIME via @gltf-transform,
 * reused by both tools/build-mixamo-character.mjs and
 * tools/build-mixamo-clip-library.mjs.
 *
 * Ports three runtime fixes character-preview/main.js proved necessary when
 * applying shared mocap clips to Mixamo characters, moved here so the fix
 * happens once per asset at build time instead of once per active character
 * at runtime:
 *   - bone-prefix normalization (character-preview's `detectBonePrefix` /
 *     `retargetClipNames`, adapted: Blender's FBX->glTF export preserves
 *     Mixamo's native `mixamorig:Name` colon-namespaced bone names, not the
 *     colon-stripped `mixamorigNName` numeric-session convention THREE's
 *     FBXLoader produces when multiple FBX files share a scene at runtime.
 *     Since every conversion here runs in its own isolated Blender process,
 *     that numeric-session collision never arises -- but a defensive
 *     normalizer is kept in case some donor asset ships a stray numeral
 *     (e.g. `mixamorig1:Hips`), so every converted character and every
 *     converted clip is guaranteed to agree on identical bone names without
 *     per-asset manual fixups.
 *   - `stripNonRootPositionAndScale` (the "long neck" bug): every non-root
 *     bone channel also carries a baked ABSOLUTE position/scale track (the
 *     mocap performer's own real bone length), which overrides the target
 *     character's own bind-pose bone length the instant the clip plays. Only
 *     rotation should transfer for non-root bones; the root (Hips)
 *     legitimately keeps its position track (that's root motion, not bone
 *     length).
 *   - `freezeRootHorizontalMotion`: these are one-shot swing clips looped
 *     with LoopRepeat; baked forward root motion in the Hips position track
 *     would walk the character off-screen over time. Freeze the two
 *     HORIZONTAL local axes, leave the VERTICAL one (genuine weight-drop/
 *     rise) alone. On these Blender-converted assets that's local X/Y, NOT
 *     X/Z: Blender's `export_yup` leaves a +90-degree-about-X wrapper
 *     rotation on the top-level Armature/Reference node instead of baking it
 *     into the data (see tools/blender-fbx-to-gltf.py), so a child bone's
 *     own translation channel is still expressed in Blender's original
 *     Z-up authoring frame -- local Z is vertical there, local Y is a
 *     horizontal (forward/back) axis. (character-preview/main.js's
 *     original version of this fix -- ported from THREE.FBXLoader loading
 *     the raw .fbx directly, no such wrapper -- correctly used local Y as
 *     vertical in THAT coordinate frame; that assumption doesn't carry over
 *     to this Blender-glTF pipeline's node hierarchy.) Confirmed on the raw
 *     pre-freeze forehand clip: local X spans roughly -121..-175 (large
 *     drift), local Y spans roughly 62..125 (large, ~63cm -- too big for a
 *     hip bob, this is footwork), local Z stays within roughly -77..-83 (a
 *     tight ~6cm range -- a believable weight-shift wobble, and its
 *     magnitude lines up with a standing character's own hip height once
 *     re-mapped through the wrapper rotation).
 */

const MIXAMO_PREFIX_RE = /^mixamorig\d*:/;
const CANONICAL_PREFIX = 'mixamorig:';

export function detectBonePrefix(doc) {
  for (const node of doc.getRoot().listNodes()) {
    const m = /^(mixamorig\d*:)Hips$/.exec(node.getName() || '');
    if (m) return m[1];
  }
  return CANONICAL_PREFIX;
}

/** Rename every node under the detected Mixamo prefix to the canonical
 * `mixamorig:` prefix, so characters and the shared clip library always
 * agree on bone names regardless of which numbered Mixamo session either
 * asset was originally downloaded in. */
export function normalizeBoneNames(doc, bonePrefix) {
  if (bonePrefix === CANONICAL_PREFIX) return;
  let renamed = 0;
  for (const node of doc.getRoot().listNodes()) {
    const name = node.getName();
    if (name && MIXAMO_PREFIX_RE.test(name)) {
      node.setName(name.replace(MIXAMO_PREFIX_RE, CANONICAL_PREFIX));
      renamed++;
    }
  }
  return renamed;
}

function disposeChannel(ch) {
  const s = ch.getSampler();
  if (s) s.dispose();
  ch.dispose();
}

export function stripNonRootPositionAndScale(doc) {
  const rootName = `${CANONICAL_PREFIX}Hips`;
  let stripped = 0;
  for (const anim of doc.getRoot().listAnimations()) {
    for (const ch of anim.listChannels()) {
      const path = ch.getTargetPath();
      if (path !== 'translation' && path !== 'scale') continue;
      const tgt = ch.getTargetNode();
      const isRootPosition = path === 'translation' && tgt && tgt.getName() === rootName;
      if (!isRootPosition) { disposeChannel(ch); stripped++; }
    }
  }
  return stripped;
}

export function freezeRootHorizontalMotion(doc) {
  const rootName = `${CANONICAL_PREFIX}Hips`;
  let frozen = 0;
  for (const anim of doc.getRoot().listAnimations()) {
    for (const ch of anim.listChannels()) {
      if (ch.getTargetPath() !== 'translation') continue;
      const tgt = ch.getTargetNode();
      if (!tgt || tgt.getName() !== rootName) continue;
      const sampler = ch.getSampler();
      const output = sampler.getOutput();
      const arr = output.getArray().slice();
      for (let i = 0; i < arr.length; i += 3) {
        arr[i] = 0;
        arr[i + 1] = 0;
      }
      output.setArray(arr);
      frozen++;
    }
  }
  return frozen;
}

/** Strip Mixamo's finger/toe/leaf bone channels -- invisible while gripping
 * a paddle, and the bulk of a clip's keyframe data. Same regex convention as
 * tools/build-player-model.mjs uses for the Quaternius rig, adapted to
 * Mixamo's `mixamorig:LeftHandThumb1`-style names. Bones stay for skinning;
 * they just hold bind pose. */
export function stripTinyBoneChannels(doc) {
  const TINY_BONE = /(Thumb|Index|Middle|Ring|Pinky|Toe)/i;
  let stripped = 0;
  for (const anim of doc.getRoot().listAnimations()) {
    for (const ch of anim.listChannels()) {
      const tgt = ch.getTargetNode();
      if (tgt && TINY_BONE.test(tgt.getName())) { disposeChannel(ch); stripped++; }
    }
  }
  return stripped;
}
