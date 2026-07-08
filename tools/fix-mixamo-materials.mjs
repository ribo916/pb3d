/* In-place PBR material fixer for the already-shipped Mixamo character GLBs.
 *
 * Removes the baked-in "wet"/oily look (KHR_materials_specular boost, half-metal
 * skin, glossy hair) by rewriting only material metadata -- diffuse/normal WebP
 * textures are passed through byte-for-byte (no textureCompress), and detaching
 * the specular extension + prune() drops orphaned specular maps so files shrink.
 * The actual per-material rule lives in tools/lib/normalize-materials.mjs and is
 * shared with tools/build-mixamo-character.mjs so a future rebuild stays fixed.
 *
 * OFFLINE, ONE-OFF TOOL (same convention as build-mixamo-character.mjs). Deps
 * not in package.json:
 *   npm i --no-save @gltf-transform/core @gltf-transform/extensions \
 *     @gltf-transform/functions meshoptimizer
 *
 * Usage:
 *   node tools/fix-mixamo-materials.mjs                 # fix the whole roster
 *   node tools/fix-mixamo-materials.mjs <in.glb> [out]  # fix one file
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, dedup, meshopt } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { normalizeCharacterMaterials } from './lib/normalize-materials.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const MIXAMO_DIR = path.join(ROOT, 'assets', 'models', 'players', 'mixamo');

// Active roster (ch13 is intentionally excluded -- not selectable).
const ROSTER = ['ch01', 'ch03', 'ch04', 'ch06', 'ch07',
  'ch08', 'ch09', 'ch10', 'ch11', 'ch12', 'ch14', 'ch15'];

await MeshoptDecoder.ready;
await MeshoptEncoder.ready;

const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({
    'meshopt.decoder': MeshoptDecoder, // to READ the meshopt-compressed GLBs
    'meshopt.encoder': MeshoptEncoder, // to WRITE meshopt geometry back
  });

async function fixOne(inPath, outPath) {
  const before = fs.statSync(inPath).size;
  const doc = await io.read(inPath);

  const summary = normalizeCharacterMaterials(doc);

  await doc.transform(
    // keepLeaves: the shipped GLBs carry an empty-leaf `paddle_socket` node that
    // a default prune() would delete (the build tool sidesteps this by adding the
    // socket AFTER its own prune). We still want prune to drop the now-orphaned
    // specular textures, just not the socket.
    prune({ keepLeaves: true }),
    dedup(),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }), // re-apply geometry compression
  );

  // GLB requires a single buffer (same consolidation the build tool does).
  const root = doc.getRoot();
  const mainBuffer = root.listBuffers()[0];
  for (const acc of root.listAccessors()) acc.setBuffer(mainBuffer);
  for (const b of root.listBuffers()) if (b !== mainBuffer) b.dispose();

  // Write to a temp sibling, then atomically replace (safe for in-place).
  // Keep the .glb extension so NodeIO writes a binary GLB (it picks GLB vs
  // glTF-with-external-files by extension).
  const tmp = outPath.replace(/\.glb$/, '') + '.tmp.glb';
  await io.write(tmp, doc);
  fs.renameSync(tmp, outPath);

  const after = fs.statSync(outPath).size;
  const kb = (n) => (n / 1024).toFixed(0) + 'KB';
  console.log(
    `${path.basename(outPath)}: ${kb(before)} -> ${kb(after)} ` +
    `(mats ${summary.materials}, spec-removed ${summary.specularRemoved}, ` +
    `metal-zeroed ${summary.metalZeroed}, rough-bumped ${summary.roughnessBumped})`
  );
}

const [argIn, argOut] = process.argv.slice(2);
if (argIn) {
  await fixOne(argIn, argOut || argIn);
} else {
  for (const id of ROSTER) {
    const p = path.join(MIXAMO_DIR, `${id}.glb`);
    if (!fs.existsSync(p)) { console.warn('skip (missing):', p); continue; }
    await fixOne(p, p);
  }
}
console.log('done.');
