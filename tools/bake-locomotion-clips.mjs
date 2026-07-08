/* Bake the character-preview's "perfected" locomotion/serve animations into a
 * single shared clip-library GLB the game can load (assets/animations/
 * pickleball-locomotion.glb), the same way pickleball-swings.glb ships the
 * forehand/backhand/overhead swings.
 *
 * WHY A HEADLESS BROWSER: the perfected clips are raw UE5 "Manny" FBX retargeted
 * onto the Mixamo rig by ~700 lines of heavily-debugged runtime code in
 * character-preview/main.js (retargetMannyClip + T-pose/twist/hip/ready-leg
 * fixes). Re-porting that math offline would risk visual drift. Instead we drive
 * the ACTUAL preview in headless Chromium (via its window.__bake hook), retarget
 * each pick onto a canonical character, and export the live clips with
 * GLTFExporter -- so the baked result is exactly what the preview renders.
 *
 * OFFLINE, ONE-OFF TOOL. Uses the repo's playwright + gltf-transform deps
 * (the latter is a --no-save dep also used by build-mixamo-clip-library.mjs):
 *   npm i --no-save @gltf-transform/core @gltf-transform/extensions @gltf-transform/functions
 *
 * Usage: node tools/bake-locomotion-clips.mjs
 * Output: assets/animations/pickleball-locomotion.glb
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { resample, prune, dedup } from '@gltf-transform/functions';
import { startViteServer } from './vite-test-server.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CACHE_DIR = path.join(__dirname, '.cache', 'mixamo-converted');
const OUT_PATH = path.join(ROOT, 'assets', 'animations', 'pickleball-locomotion.glb');

// Canonical character to bake against. The 12 chNN characters share the standard
// Mixamo rest skeleton (the shared pickleball-swings.glb already works across all
// of them), so one bake applies to every character via collectAnimationClips().
const CANONICAL_CHARACTER = 'player-ch01-v1';

// preview top-pick key -> shipped adapter clip name. The name is what
// src/players.js clipKey() matches on, so it MUST stay in that vocabulary:
// idle / ready / run / serve / backpedal / shuffle_left / shuffle_right.
const BAKE_SET = [
  { pickKey: 'tp-idle', name: 'idle' },
  // Alive/weight-shift idle used by the character preview as the resting beat
  // between swings. clipKey() maps 'idle_noise' -> 'idle_noise' (a distinct
  // action, kept out of the generic 'idle' slot). See src/players.js.
  { pickKey: 'tp-idle-noise', name: 'idle_noise' },
  { pickKey: 'tp-ready', name: 'ready' },
  { pickKey: 'tp-run', name: 'run' },
  { pickKey: 'tp-serve', name: 'serve' },
  { pickKey: 'tp-backpedal', name: 'backpedal' },
  { pickKey: 'tp-side-shuffle-left', name: 'shuffle_left' },
  { pickKey: 'tp-side-shuffle-right', name: 'shuffle_right' }
];

const headed = process.env.HEADED === '1';

const testServer = await startViteServer(ROOT);
const browser = await chromium.launch({
  headless: !headed,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--enable-webgl']
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

// Vite pre-bundles deps on first cold load and then does a one-time full page
// reload ("optimized dependencies changed. reloading"), which destroys any
// in-flight execution context. Ride past it: load once, reload to settle, then
// wait for the bake hook on the stable context before doing real work.
async function openSettled() {
  await page.goto(testServer.base + 'character-preview/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__bake && typeof window.__bake.loadCharacter === 'function', { timeout: 30000 });
}

let base64Glb;
try {
  await openSettled();

  console.log('loading canonical character', CANONICAL_CHARACTER, '…');
  await page.evaluate((key) => window.__bake.loadCharacter(key), CANONICAL_CHARACTER);

  for (const { pickKey, name } of BAKE_SET) {
    const clipName = await page.evaluate((k) => window.__bake.retarget(k), pickKey);
    console.log('retargeted', pickKey, '->', name, `(source clip "${clipName}")`);
  }

  console.log('exporting GLB from live scene…');
  base64Glb = await page.evaluate((entries) => window.__bake.exportGlb(entries), BAKE_SET);
} finally {
  await browser.close();
  await testServer.server.close();
}

if (errors.length) console.warn('page console/errors during bake:\n' + errors.join('\n'));
if (!base64Glb) throw new Error('bake produced no GLB');

// --- decode the raw browser export, then strip the character mesh/materials/
//     textures/skin (we only want the skeleton + animation tracks) and optimize
//     for size, matching the ~0.07 MB footprint of pickleball-swings.glb. No
//     freezeRootHorizontalMotion pass: retargetMannyClip already freezes the
//     correct horizontal axes by construction (see its Hips block), and the
//     exported clips are exactly what the preview renders in place. ---
fs.mkdirSync(CACHE_DIR, { recursive: true });
const rawPath = path.join(CACHE_DIR, 'locomotion-raw.glb');
fs.writeFileSync(rawPath, Buffer.from(base64Glb, 'base64'));
console.log(`raw export ${(fs.statSync(rawPath).size / 1024 / 1024).toFixed(2)} MB -> ${rawPath}`);

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(rawPath);
const root = doc.getRoot();

// Detach meshes from nodes, then drop all mesh/material/texture/skin data.
// Bone nodes remain (they're referenced by the animation channels, so prune
// keeps them); only the heavy skinned-mesh payload goes away.
for (const node of root.listNodes()) {
  if (node.getMesh()) node.setMesh(null);
  if (node.getSkin()) node.setSkin(null);
}
for (const mesh of root.listMeshes()) mesh.dispose();
for (const skin of root.listSkins()) skin.dispose();
for (const mat of root.listMaterials()) mat.dispose();
for (const tex of root.listTextures()) tex.dispose();

await doc.transform(
  resample({ tolerance: 1e-3 }),
  prune(),
  dedup()
);

const mainBuffer = root.listBuffers()[0];
for (const acc of root.listAccessors()) acc.setBuffer(mainBuffer);
for (const b of root.listBuffers()) if (b !== mainBuffer) b.dispose();

fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
await io.write(OUT_PATH, doc);
const bytes = fs.statSync(OUT_PATH).size;
const names = root.listAnimations().map((a) => a.getName());
console.log(`\nwrote ${OUT_PATH} (${(bytes / 1024 / 1024).toFixed(2)} MB, ${names.length} clips: ${names.join(', ')})`);

if (names.length !== BAKE_SET.length) {
  console.error(`expected ${BAKE_SET.length} clips, got ${names.length}`);
  process.exitCode = 1;
}
