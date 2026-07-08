/* Shared PBR material normalization for the Mixamo character roster, applied
 * at BUILD TIME via @gltf-transform. Reused by both
 * tools/build-mixamo-character.mjs (source-of-truth build) and
 * tools/fix-mixamo-materials.mjs (in-place fixer for already-shipped GLBs), so
 * the two can never drift apart.
 *
 * WHY: the Blender FBX->glTF import bakes three things into the character
 * materials that make skin/cloth/hair read oily/"wet" under direct lighting
 * (there is no scene environment map to soften specular):
 *   1. KHR_materials_specular with specularColorFactor up to [2,2,2] -- a 2x
 *      dielectric-specular boost three.js loads onto MeshPhysicalMaterial.
 *   2. metallicFactor 0.5 on the realistic human bodies (and a stray metal=1.0
 *      chrome-eyebrow material) -- half-metal skin reflects the key light as a
 *      hard hotspot.
 *   3. hair roughness ~0.118 on a couple of characters -- glossy wet hair.
 *
 * This pass neutralizes all three as pure material metadata: no texture
 * re-encoding (diffuse/normal WebP stay byte-for-byte), and detaching the
 * specular extension orphans its specular maps so a following prune() actually
 * SHRINKS the file. The procedural "Headband" accessory material (metal 0,
 * rough 0.8, no specular) is already correct and every branch below leaves it
 * untouched.
 *
 * The caller is responsible for running prune() afterward to drop the now
 * orphaned specular textures.
 */

const DEFAULTS = {
  // Natural-matte target for skin/cloth (faint healthy sheen, no oily look).
  skinRoughFloor: 0.7,
  // Rescues the pathological ~0.118 wet-hair cases; leaves normal 0.553 hair.
  hairRoughFloor: 0.5,
  hairRe: /hair|brow/i,
  // Future-proofing only -- matches nothing in the current people-only roster,
  // so real metal props on a future asset keep their metalness.
  knownMetalRe: /\b(metal|chrome|steel|zipper|buckle|jewel|watch|ring|earring)\b/i,
};

export function normalizeCharacterMaterials(doc, opts = {}) {
  const cfg = { ...DEFAULTS, ...opts };
  const summary = { materials: 0, specularRemoved: 0, metalZeroed: 0, roughnessBumped: 0, mrTexDropped: 0 };

  for (const mat of doc.getRoot().listMaterials()) {
    summary.materials++;
    const name = mat.getName() || '';
    const floor = cfg.hairRe.test(name) ? cfg.hairRoughFloor : cfg.skinRoughFloor;

    // 1. metalness: kill it on everything that isn't explicitly a metal prop.
    if (!cfg.knownMetalRe.test(name) && mat.getMetallicFactor() !== 0) {
      mat.setMetallicFactor(0);
      summary.metalZeroed++;
    }

    // 2. specular: detach the boosted extension entirely (reverts to the
    //    default ~4% dielectric F0 and drops back to MeshStandardMaterial).
    if (mat.getExtension('KHR_materials_specular')) {
      mat.setExtension('KHR_materials_specular', null);
      summary.specularRemoved++;
    }

    // 3. roughness. The metallicRoughness textures on this roster are
    //    mis-converted from the donor Specular/Glossiness workflow: they read
    //    far too glossy, so the shirts/cloth stay oily even after metalness is
    //    zeroed, and a roughnessFactor can't push roughness ABOVE the map. Drop
    //    the suspect map and stand on a constant matte roughness instead (also
    //    orphans the texture so prune() shrinks the file). Constant-roughness
    //    materials just get the same matte floor.
    if (mat.getMetallicRoughnessTexture()) {
      mat.setMetallicRoughnessTexture(null);
      mat.setRoughnessFactor(floor);
      summary.mrTexDropped++;
      summary.roughnessBumped++;
    } else if (mat.getRoughnessFactor() < floor) {
      mat.setRoughnessFactor(floor);
      summary.roughnessBumped++;
    }
  }

  // Detaching per-material leaves the empty document-level extension registered
  // (it still shows in extensionsUsed). Dispose it so nothing advertises it.
  for (const ext of doc.getRoot().listExtensionsUsed()) {
    if (ext.extensionName === 'KHR_materials_specular') ext.dispose();
  }

  return summary;
}
