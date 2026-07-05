/* Give the authored Quaternius player body a colorable shirt + pants by
 * SPLITTING its single body mesh into 3 primitives (skin / jersey / shorts),
 * each its own material, tagged with `userData.slot` so the existing
 * runtime tinting system (players.js `applyModelMaterials`/`tintMaterial`)
 * recolors them from `opts.jersey`/`opts.shorts` exactly like it already
 * does for the primitive rig's own jersey/shorts materials — this is the
 * SAME slot system, just finally wired up for the authored body too.
 *
 * Why splitting geometry instead of texture-painting a fixed color (the
 * previous version of this tool): a baked color can't be changed per
 * character at runtime. Splitting the body's own triangles into separate
 * primitives — no new geometry, no donor mesh, just the body's existing
 * surface partitioned by material — means each region's material.color can
 * be set independently per roster slot, live, the same way the primitive
 * rig's colors already work. No z-fighting risk either: it's the exact same
 * continuous surface, just different triangle ranges per material.
 *
 * Method: for each body-mesh vertex, sum its skinning weight (`JOINTS_0`/
 * `WEIGHTS_0`) across a leg joint group and a torso joint group (see
 * PLAYER-IMPORT.md "Done: texture-painted clothing" for why these groups
 * are shaped the way they are — pelvis/spine_01 folded into legs to avoid a
 * gap at the hip, clavicle suppressed wherever upperarm weight is also
 * present to avoid a fake sleeve). Classify each vertex leg/torso/skin by
 * whichever sum is highest (and clears 0.5), then each TRIANGLE by majority
 * vote of its 3 vertices. That gives 3 disjoint triangle sets, which become
 * 3 new index accessors over the SAME position/normal/uv/joints/weights
 * accessors (no vertex duplication) — the skin set stays on the original
 * primitive/material untouched, and 2 new sibling nodes are added for
 * jersey/shorts, each skinned identically, each with a clone of the base
 * material pointing at a NEW, fully desaturated + brightness-clamped copy
 * of the original texture (so material.color tinting reproduces the
 * selected color cleanly, while the desaturated copy still carries the
 * original bake's muscle/fold shading as luminance detail).
 *
 * `--legs` controls how much of the leg is a colorable "shorts" region:
 * `full` (pelvis+spine_01+thigh+calf — full leggings) or `brief` (pelvis
 * only, trimmed further to a short band at the hip — bare thighs/calves).
 * Both bodies now use `full`: an earlier male-only `brief` cut (bare
 * thighs/calves) left a hard height-trimmed hem low on the thigh where the
 * mesh is coarse, producing a visibly jagged edge; `full` pushes that same
 * jagged hem down to the ankle (matching the female body), where it's far
 * less noticeable. `brief` is kept as an option, not removed, in case the
 * bare-thigh look is wanted again with a better hem fix.
 *
 * OFFLINE, ONE-OFF TOOL (same category as build-player-model.mjs) — not
 * wired into npm scripts. Usage:
 *   node tools/paint-player-clothing.mjs assets/models/players/player-male-v1.glb --legs=full
 *   node tools/paint-player-clothing.mjs assets/models/players/player-female-v1.glb --legs=full
 */
import fs from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import sharp from 'sharp';

const SPINE_JOINTS = new Set(['spine_01', 'spine_02', 'spine_03']);
const CLAVICLE_JOINTS = new Set(['clavicle_l', 'clavicle_r']);
const UPPERARM_JOINTS = new Set(['upperarm_l', 'upperarm_r']);
const NECK_JOINTS = new Set(['neck_01', 'Head']);

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const flags = process.argv.slice(2).filter((a) => a.startsWith('--'));
const inPath = args[0];
const outPath = args[1] || inPath;
const dumpMask = flags.includes('--dump-mask');
const legsFlag = (flags.find((f) => f.startsWith('--legs=')) || '--legs=full').split('=')[1];
// Always classify by the FULL leg joint set — narrowing the joint set itself
// (e.g. pelvis-only) undershoots: the visible brief graphic on the male body
// extends into territory where thigh_l/r are the dominant joint, so a
// pelvis-only group left most of the brief's own pixels stuck on the
// unpainted 'skin' primitive, uncolorable. `brief` mode instead trims the
// full leg region by HEIGHT after classification (see briefHeightCutoff
// below) — the actual brief graphic is a band near the hip regardless of
// which joint happens to dominate the skinning there.
const LEG_JOINTS = legsFlag === 'none' ? new Set()
  : new Set(['pelvis', 'spine_01', 'thigh_l', 'thigh_r', 'calf_l', 'calf_r']);

if (!inPath) {
  console.error('usage: paint-player-clothing.mjs <in.glb> [out.glb] [--legs=full|brief|none] [--dump-mask]');
  process.exit(1);
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(inPath);
const root = doc.getRoot();
const scene = root.getDefaultScene() || root.listScenes()[0];

// This tool is meant to be re-runnable on its own prior output (e.g. to
// retune the classification without a from-scratch rebuild, which needs the
// original external donor pack). A previous run left the body split into 3
// sibling primitives (skin keeps the original triangles minus jersey/shorts,
// which live in new `<body>_Jersey`/`<body>_Shorts` nodes). Undo that split
// first — concatenate each garment node's indices back onto the base body's
// index buffer and drop the garment node — so classification always starts
// from the one full continuous surface, never a partially-carved one.
for (const node of root.listNodes()) {
  const suffix = ['_Jersey', '_Shorts'].find((s) => node.getName().endsWith(s));
  if (!suffix) continue;
  const baseName = node.getName().slice(0, -suffix.length);
  const baseNode = root.listNodes().find((n) => n.getName() === baseName);
  if (!baseNode) continue;
  const basePrim = baseNode.getMesh().listPrimitives()[0];
  const baseIndices = basePrim.getIndices();
  const extraPrim = node.getMesh().listPrimitives()[0];
  const baseArr = baseIndices.getArray();
  const extraArr = extraPrim.getIndices().getArray();
  const merged = new baseArr.constructor(baseArr.length + extraArr.length);
  merged.set(baseArr, 0);
  merged.set(extraArr, baseArr.length);
  baseIndices.setArray(merged);
  const mat = extraPrim.getMaterial();
  const tex = mat && mat.getBaseColorTexture();
  const mesh = node.getMesh();
  node.dispose();
  mesh.dispose();
  if (mat) mat.dispose();
  if (tex) tex.dispose();
}

const bodyMesh = root.listMeshes().find((m) =>
  m.listPrimitives().some((p) => p.getMaterial() && /Superhero/i.test(p.getMaterial().getName()))
);
if (!bodyMesh) throw new Error('no Superhero body mesh found in ' + inPath);
const bodyPrim = bodyMesh.listPrimitives()[0];
const baseMat = bodyPrim.getMaterial();
const bodyNode = root.listNodes().find((n) => n.getMesh() === bodyMesh);
const skin = bodyNode.getSkin();
const jointNames = skin.listJoints().map((j) => j.getName());

const jointsAcc = bodyPrim.getAttribute('JOINTS_0');
const weightsAcc = bodyPrim.getAttribute('WEIGHTS_0');
const vertCount = bodyPrim.getAttribute('POSITION').getCount();

function smoothstep(lo, hi, x) {
  const t = Math.min(1, Math.max(0, (x - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
}

const rawIndices = bodyPrim.getIndices().getArray();

// Vertex adjacency (from the mesh's OWN connectivity) used to smooth the
// leg/torso weight fields below — the raw per-vertex sums follow whatever
// jaggedness is in the source rig's own weight painting, which reads as
// zigzag "V-cut" garment edges once split into hard geometry (no texture
// alpha left to soften it). A few rounds of neighbor-averaging round that
// into a smoother, more plausible seam line before classification.
function buildAdjacency() {
  const adj = [];
  for (let i = 0; i < vertCount; i++) adj.push(new Set());
  for (let t = 0; t < rawIndices.length / 3; t++) {
    const a = rawIndices[t * 3], b = rawIndices[t * 3 + 1], c = rawIndices[t * 3 + 2];
    adj[a].add(b); adj[a].add(c);
    adj[b].add(a); adj[b].add(c);
    adj[c].add(a); adj[c].add(b);
  }
  return adj;
}

function smoothField(field, adj, iterations) {
  let cur = field;
  for (let it = 0; it < iterations; it++) {
    const next = new Float32Array(cur.length);
    for (let i = 0; i < cur.length; i++) {
      let sum = cur[i], count = 1;
      for (const n of adj[i]) { sum += cur[n]; count++; }
      next[i] = sum / count;
    }
    cur = next;
  }
  return cur;
}

// raw per-vertex weight sums
let legW = new Float32Array(vertCount);
let torsoW = new Float32Array(vertCount);
let neckW = new Float32Array(vertCount);
for (let i = 0; i < vertCount; i++) {
  const j = jointsAcc.getElement(i, [0, 0, 0, 0]);
  const w = weightsAcc.getElement(i, [0, 0, 0, 0]);
  let leg = 0, spine = 0, clavicle = 0, upperArm = 0, neck = 0;
  for (let k = 0; k < 4; k++) {
    const name = jointNames[j[k]];
    if (LEG_JOINTS.has(name)) leg += w[k];
    if (SPINE_JOINTS.has(name)) spine += w[k];
    if (CLAVICLE_JOINTS.has(name)) clavicle += w[k];
    if (UPPERARM_JOINTS.has(name)) upperArm += w[k];
    if (NECK_JOINTS.has(name)) neck += w[k];
  }
  legW[i] = leg;
  torsoW[i] = spine + clavicle * (1 - smoothstep(0.02, 0.15, upperArm));
  neckW[i] = neck;
}

const adjacency = buildAdjacency();
legW = smoothField(legW, adjacency, 45);
torsoW = smoothField(torsoW, adjacency, 45);
neckW = smoothField(neckW, adjacency, 45);

// per-vertex region: 'shorts' | 'jersey' | 'skin'. No 0.5 "majority" gate —
// that left a strip of vertices where NEITHER side reached 0.5 (common
// right at the true anatomical boundary, where two bones split weight
// close to evenly) stuck on the untinted 'skin' primitive. With a light
// garment color selected, that strip showed up as a visible gap revealing
// the body's own original baked texture (looking like the paint "missed"
// the existing shorts/bra graphic). Only true non-candidates (near-zero
// both sums — head, hands, feet) should stay 'skin'; everywhere else, treat
// leg vs. torso as two competing candidates and take whichever is larger.
//
// `neck`/`Head` joint weight is checked FIRST as a third competing
// candidate, not folded into `torso` — without it, any vertex with even
// slight spine/clavicle influence defaulted to 'jersey' as soon as it
// cleared SKIN_EPS, with nothing to out-vote it once the actual neck bone
// took over from the spine. That let the jersey region ride all the way up
// the neck to the jaw (a turtleneck) instead of stopping at the collar.
const SKIN_EPS = 0.15;
const vertRegion = new Array(vertCount);
for (let i = 0; i < vertCount; i++) {
  const leg = legW[i], torso = torsoW[i], neck = neckW[i];
  if (neck >= SKIN_EPS && neck >= torso && neck >= leg) vertRegion[i] = 'skin';
  else if (leg < SKIN_EPS && torso < SKIN_EPS) vertRegion[i] = 'skin';
  else if (leg >= torso) vertRegion[i] = 'shorts';
  else vertRegion[i] = 'jersey';
}

// `brief` mode: trim the full leg region down to a short band at the hip
// (where the male body's own baked-in brief graphic actually sits) by
// bind-pose height, rather than by joint set — the brief extends into
// territory where thigh_l/r, not pelvis, is the dominant joint, so a
// joint-only restriction undershoots the graphic's real extent.
//
// The fraction below is measured against the FULL leg span (hip to ankle),
// not just the thigh — an earlier pass raised it to 0.45 to satisfy the
// `--dump-mask` debug visualization, not realizing that visualization only
// draws small dots at each vertex rather than filling triangle interiors,
// so it understated how much of the brief graphic real (filled) triangles
// already covered. 0.45 of the full leg span reaches close to knee height,
// which is well past the actual brief and made the (jagged, mesh-resolution
// limited) hem boundary visible partway down the thigh. Lowered back down —
// verify coverage via an actual RENDER, not the dot-mask, if this ever needs
// retuning.
if (legsFlag === 'brief') {
  const posAcc = bodyPrim.getAttribute('POSITION');
  let yMin = Infinity, yMax = -Infinity;
  for (let i = 0; i < vertCount; i++) {
    if (vertRegion[i] !== 'shorts') continue;
    const y = posAcc.getElement(i, [0, 0, 0])[1];
    if (y < yMin) yMin = y;
    if (y > yMax) yMax = y;
  }
  const cutoffY = yMax - 0.22 * (yMax - yMin);
  for (let i = 0; i < vertCount; i++) {
    if (vertRegion[i] === 'shorts' && posAcc.getElement(i, [0, 0, 0])[1] < cutoffY) vertRegion[i] = 'skin';
  }
}

const origIndices = bodyPrim.getIndices();
const idxArr = origIndices.getArray();
const triCount = idxArr.length / 3;

const buckets = { skin: [], jersey: [], shorts: [] };
for (let t = 0; t < triCount; t++) {
  const a = idxArr[t * 3], b = idxArr[t * 3 + 1], c = idxArr[t * 3 + 2];
  const ra = vertRegion[a], rb = vertRegion[b], rc = vertRegion[c];
  let region = 'skin';
  if (ra === rb && ra !== 'skin') region = ra;
  else if (ra === rc && ra !== 'skin') region = ra;
  else if (rb === rc && rb !== 'skin') region = rb;
  buckets[region].push(a, b, c);
}
console.log('triangles — skin:', buckets.skin.length / 3, 'jersey:', buckets.jersey.length / 3, 'shorts:', buckets.shorts.length / 3);

const IndexArrayType = idxArr.constructor; // match original component type (Uint16/32Array)

// skin keeps the original primitive/material, just a smaller index buffer
origIndices.setArray(new IndexArrayType(buckets.skin));

function luminance(r, g, b) { return 0.2126 * r + 0.7152 * g + 0.0722 * b; }

// The male brief and the torso/skin bake sit at very different absolute
// brightness in the SOURCE texture (a near-black brief vs. mid-tone skin).
// A fixed global brightness remap left the brief region too dark to ever
// read as a light tint (e.g. picking "White" pants still looked near-black,
// since material.color can only multiply a texture darker, never brighten
// it past the texture's own luminance). Instead, rasterize this region's own
// triangles in UV space to find its ACTUAL observed luminance range, and
// stretch that range to the output band, so every garment region reaches a
// usable light-to-dark span regardless of how dark its source bake was.
// (An earlier version only sampled at vertex UV positions rather than
// rasterizing full triangles, which missed the true darkest interior pixels
// of small regions like the male brief and understated how dark `lo` really
// was — the stretch then left most of the region clamped near the dark end.)
function regionLumRange(uvAcc, data, CH, W, H, triIndices) {
  let lo = 255, hi = 0;
  const triCount = triIndices.length / 3;
  for (let t = 0; t < triCount; t++) {
    const uv0 = uvAcc.getElement(triIndices[t * 3], [0, 0]);
    const uv1 = uvAcc.getElement(triIndices[t * 3 + 1], [0, 0]);
    const uv2 = uvAcc.getElement(triIndices[t * 3 + 2], [0, 0]);
    const p0 = [uv0[0] * W, uv0[1] * H], p1 = [uv1[0] * W, uv1[1] * H], p2 = [uv2[0] * W, uv2[1] * H];
    const minX = Math.max(0, Math.floor(Math.min(p0[0], p1[0], p2[0])));
    const maxX = Math.min(W - 1, Math.ceil(Math.max(p0[0], p1[0], p2[0])));
    const minY = Math.max(0, Math.floor(Math.min(p0[1], p1[1], p2[1])));
    const maxY = Math.min(H - 1, Math.ceil(Math.max(p0[1], p1[1], p2[1])));
    const area = (p1[0] - p0[0]) * (p2[1] - p0[1]) - (p2[0] - p0[0]) * (p1[1] - p0[1]);
    if (area === 0) continue;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5, py = y + 0.5;
        const w0 = (p1[0] - px) * (p2[1] - py) - (p2[0] - px) * (p1[1] - py);
        const w1 = (p2[0] - px) * (p0[1] - py) - (p0[0] - px) * (p2[1] - py);
        const w2 = (p0[0] - px) * (p1[1] - py) - (p1[0] - px) * (p0[1] - py);
        const hasNeg = w0 < 0 || w1 < 0 || w2 < 0;
        const hasPos = w0 > 0 || w1 > 0 || w2 > 0;
        if (hasNeg && hasPos) continue;
        const o = (y * W + x) * CH;
        const lum = luminance(data[o], data[o + 1], data[o + 2]);
        if (lum < lo) lo = lum;
        if (lum > hi) hi = lum;
      }
    }
  }
  if (hi - lo < 30) { lo = Math.max(0, lo - 30); hi = Math.min(255, hi + 30); }
  return [lo, hi];
}

// Blur radius for the neutral texture copy. The source texture bakes real
// drawn clothing (the female bra graphic, the male brief) as ink, not as a
// lighting gradient — desaturating it alone just turns "dark ink" into
// "dark gray ink," which still reads as a printed garment shape once tinted
// (glaringly so under a light color: a bra-shaped print on a white shirt).
// A blur wide enough to erase that ink's edges, while leaving the body's
// broad ambient-occlusion shading (which is already low-frequency) mostly
// intact, is the difference between "shows the old garment outline" and
// "looks like plain fabric with soft shading." Stats (regionLumRange) and
// the final output are both computed from this SAME blurred buffer, so the
// contrast stretch is calibrated to what actually gets exported.
const NEUTRAL_BLUR_SIGMA = 20;

// Blur alone didn't fully fix the ghost-garment look on the female body —
// turns out the darkest patch there isn't fine printed linework at all, it's
// a broad, low-frequency AO shadow the source bake casts under the bust
// (the same kind of shading that reads fine as "muscle definition" on the
// male chest, but here happens to fall in bra territory and reads as a
// printed garment once the surrounding fabric is light). Blur can't remove
// low-frequency content by design — it only erases FINE detail — so the fix
// is a separate knob: compress the shading CONTRAST around the midpoint
// before mapping to the output band, pulling every dark-or-light extreme
// back toward neutral gray. `CONTRAST_FACTOR` of 1 keeps full original
// contrast (the bra-shadow problem); 0 would be perfectly flat (no fabric
// shading at all, reads flat/plasticky). ~0.35 keeps just enough shading to
// look like fabric folds without any single AO feature reading as a print.
const CONTRAST_FACTOR = 0.15;

function desaturateInPlace(data, CH, W, H, lumRange) {
  const [lo, hi] = lumRange;
  for (let i = 0; i < W * H; i++) {
    const o = i * CH;
    const lum = luminance(data[o], data[o + 1], data[o + 2]);
    let t = Math.min(1, Math.max(0, (lum - lo) / (hi - lo)));
    t = 0.5 + (t - 0.5) * CONTRAST_FACTOR;
    const g = Math.round(35 + t * 200);
    data[o] = g; data[o + 1] = g; data[o + 2] = g;
  }
}

async function makeGarmentPrimitive(name, slot, indices) {
  if (indices.length === 0) return;
  const mat = baseMat.clone();
  mat.setName(baseMat.getName() + '_' + slot);
  const baseColorTex = baseMat.getBaseColorTexture();
  if (baseColorTex) {
    const srcBuf = Buffer.from(baseColorTex.getImage());
    const decoded = await sharp(srcBuf).blur(NEUTRAL_BLUR_SIGMA).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const { data, info } = decoded;
    const lumRange = regionLumRange(
      bodyPrim.getAttribute('TEXCOORD_0'), data, info.channels, info.width, info.height, indices
    );
    desaturateInPlace(data, info.channels, info.width, info.height, lumRange);
    const tex = doc.createTexture(baseColorTex.getName() + '_' + slot);
    tex.setImage(await sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } })
      .webp({ quality: 88 })
      .toBuffer());
    tex.setMimeType('image/webp');
    mat.setBaseColorTexture(tex);
  }
  mat.setBaseColorFactor([1, 1, 1, 1]);
  // The base material's normal map bakes in all the body's muscle/anatomy
  // bump detail — cloning carries that reference over, so no amount of
  // flattening the base-color texture stops lighting from revealing the
  // underlying anatomy through the "fabric" (this was the actual cause of
  // "still too see-through," not insufficient contrast reduction above).
  // Garments are flat cloth, not a second skin — strip the normal map and
  // the detail roughness map, and use a plain matte-fabric roughness.
  mat.setNormalTexture(null);
  mat.setMetallicRoughnessTexture(null);
  mat.setRoughnessFactor(0.85);
  mat.setMetallicFactor(0);

  const prim = doc.createPrimitive();
  for (const semantic of bodyPrim.listSemantics()) {
    prim.setAttribute(semantic, bodyPrim.getAttribute(semantic));
  }
  prim.setIndices(doc.createAccessor().setArray(new IndexArrayType(indices)).setType('SCALAR'));
  prim.setMaterial(mat);

  const mesh = doc.createMesh(name);
  mesh.addPrimitive(prim);

  const node = doc.createNode(name);
  node.setMesh(mesh);
  node.setSkin(skin);
  node.setExtras({ slot: slot });
  scene.addChild(node);
}

await makeGarmentPrimitive(bodyNode.getName() + '_Jersey', 'jersey', buckets.jersey);
await makeGarmentPrimitive(bodyNode.getName() + '_Shorts', 'shorts', buckets.shorts);

// The donor "Superhero" body texture bakes a drawn-on brief/bra graphic
// directly into the skin diffuse map under the shorts region. That's left
// untouched deliberately: the "None" shirt/pants option (see players.js
// `bareSkinMaterial`) reuses this same real skin material verbatim, so
// picking "None" shows the character exactly as the donor asset was
// originally imported — including its baked-in brief/bra — rather than
// erasing it into fully bare skin or flattening it into a solid-color
// bodysuit.

if (dumpMask) {
  const posAcc = bodyPrim.getAttribute('POSITION');
  const uvAcc = bodyPrim.getAttribute('TEXCOORD_0');
  const srcBuf = Buffer.from(baseMat.getBaseColorTexture().getImage());
  const decoded = await sharp(srcBuf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { data, info } = decoded;
  const W = info.width, H = info.height, CH = info.channels;
  const vis = Buffer.from(data); // copy
  const colors = { skin: null, jersey: [220, 40, 40], shorts: [40, 120, 220] };
  for (const [region, tris] of Object.entries(buckets)) {
    const rgb = colors[region];
    if (!rgb) continue;
    for (let t = 0; t < tris.length / 3; t++) {
      for (let k = 0; k < 3; k++) {
        const vi = tris[t * 3 + k];
        const uv = uvAcc.getElement(vi, [0, 0]);
        const x = Math.round(uv[0] * W), y = Math.round(uv[1] * H);
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            const px = x + dx, py = y + dy;
            if (px < 0 || py < 0 || px >= W || py >= H) continue;
            const o = (py * W + px) * CH;
            vis[o] = rgb[0]; vis[o + 1] = rgb[1]; vis[o + 2] = rgb[2];
          }
        }
      }
    }
  }
  const maskPath = outPath.replace(/\.glb$/, '') + '-mask-debug.png';
  await sharp(vis, { raw: { width: W, height: H, channels: CH } }).png().toFile(maskPath);
  console.log('wrote mask debug image:', maskPath);
}

await io.write(outPath, doc);
const bytes = fs.statSync(outPath).size;
console.log(`wrote ${outPath} (${(bytes / 1024 / 1024).toFixed(2)} MB)`);
