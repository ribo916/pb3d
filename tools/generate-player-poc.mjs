/* Generate a small authored-style player GLB used as the Phase 6.5 character
 * POC. This is intentionally lightweight and reproducible: it is not final art,
 * but it exercises the player model adapter with named material slots and clips.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'assets/models/players/player-poc.glb');

if (typeof globalThis.FileReader === 'undefined') {
  globalThis.FileReader = class FileReader {
    readAsArrayBuffer(blob) {
      blob.arrayBuffer().then((buffer) => {
        this.result = buffer;
        if (this.onloadend) this.onloadend();
      }).catch((error) => {
        if (this.onerror) this.onerror(error);
      });
    }
  };
}

function mat(name, color, roughness = 0.62, metalness = 0.02) {
  const m = new THREE.MeshStandardMaterial({ color, roughness, metalness });
  m.name = name;
  return m;
}

const mats = {
  jersey: mat('jersey', 0xff7a1f, 0.5, 0.03),
  jerseyDark: mat('jersey_dark_trim', 0xa63d12, 0.55, 0.02),
  shorts: mat('shorts', 0x20283c, 0.68, 0.02),
  skin: mat('skin', 0xe4bf9f, 0.7, 0.0),
  hair: mat('hair', 0x241814, 0.82, 0.0),
  shoe: mat('shoe', 0xf6f8ff, 0.42, 0.05),
  sock: mat('shoe_sock', 0xdfe8f3, 0.55, 0.0),
  headband: mat('headband', 0x2bd4ff, 0.48, 0.03),
  stripe: mat('jersey_light_stripe', 0xffd166, 0.5, 0.02)
};

function mesh(name, geometry, material, pos, scale, rot) {
  const m = new THREE.Mesh(geometry, material);
  m.name = name;
  if (pos) m.position.set(pos[0], pos[1], pos[2]);
  if (scale) m.scale.set(scale[0], scale[1], scale[2]);
  if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function cyl(name, rTop, rBot, h, material, pos, scale, rot) {
  return mesh(name, new THREE.CylinderGeometry(rTop, rBot, h, 24, 2), material, pos, scale, rot);
}

function sph(name, r, material, pos, scale) {
  return mesh(name, new THREE.SphereGeometry(r, 32, 18), material, pos, scale);
}

function box(name, w, h, d, material, pos, scale, rot) {
  return mesh(name, new THREE.BoxGeometry(w, h, d), material, pos, scale, rot);
}

const root = new THREE.Group();
root.name = 'player_poc_root';

function variantGroup(group, value) {
  const g = new THREE.Group();
  g.name = 'variant_' + group + '_' + value;
  g.userData.variantGroup = group;
  g.userData.variantValue = value;
  return g;
}

const hips = new THREE.Group();
hips.name = 'hips';
hips.position.y = 0.78;
root.add(hips);

const torso = new THREE.Group();
torso.name = 'torso';
torso.position.y = 0.92;
root.add(torso);

torso.add(sph('jersey_torso', 0.34, mats.jersey, [0, 0.07, 0], [0.74, 1.1, 0.46]));
torso.add(box('jersey_side_panel_left', 0.035, 0.44, 0.16, mats.jerseyDark, [-0.24, 0.05, 0.01]));
torso.add(box('jersey_side_panel_right', 0.035, 0.44, 0.16, mats.jerseyDark, [0.24, 0.05, 0.01]));
torso.add(box('jersey_chest_stripe', 0.36, 0.035, 0.025, mats.stripe, [0, 0.18, 0.135]));
torso.add(cyl('skin_neck', 0.06, 0.07, 0.12, mats.skin, [0, 0.48, 0]));
torso.add(sph('skin_head', 0.17, mats.skin, [0, 0.67, 0.03], [0.92, 1.08, 0.88]));
torso.add(sph('skin_nose', 0.025, mats.skin, [0, 0.65, 0.18], [0.75, 0.85, 1.2]));

const shortHair = variantGroup('hair', 'short');
shortHair.add(mesh('hair_short_cap', new THREE.SphereGeometry(0.176, 32, 16, 0, Math.PI * 2, 0, Math.PI * 0.58), mats.hair, [0, 0.715, 0.02], [0.98, 0.82, 0.9]));
shortHair.add(sph('hair_short_back_volume', 0.12, mats.hair, [0, 0.62, -0.11], [1.15, 0.95, 0.55]));
torso.add(shortHair);

const longHair = variantGroup('hair', 'long');
longHair.add(mesh('hair_long_cap', new THREE.SphereGeometry(0.176, 32, 16, 0, Math.PI * 2, 0, Math.PI * 0.58), mats.hair, [0, 0.715, 0.02], [0.98, 0.82, 0.9]));
longHair.add(box('hair_long_left_panel', 0.045, 0.24, 0.12, mats.hair, [-0.155, 0.56, 0.0]));
longHair.add(box('hair_long_right_panel', 0.045, 0.24, 0.12, mats.hair, [0.155, 0.56, 0.0]));
longHair.add(box('hair_long_back_panel', 0.22, 0.25, 0.055, mats.hair, [0, 0.54, -0.13]));
torso.add(longHair);

const ponyHair = variantGroup('hair', 'ponytail');
ponyHair.add(mesh('hair_ponytail_cap', new THREE.SphereGeometry(0.176, 32, 16, 0, Math.PI * 2, 0, Math.PI * 0.58), mats.hair, [0, 0.715, 0.02], [0.98, 0.82, 0.9]));
ponyHair.add(box('hair_ponytail_back_pad', 0.18, 0.14, 0.075, mats.hair, [0, 0.575, -0.125]));
ponyHair.add(box('headband_ponytail_tie', 0.08, 0.028, 0.035, mats.headband, [0.02, 0.57, -0.19]));
ponyHair.add(sph('hair_ponytail_tail', 0.075, mats.hair, [0.03, 0.49, -0.215], [0.62, 1.2, 0.62]));
torso.add(ponyHair);

const headband = variantGroup('headwear', 'headband');
headband.add(box('headband_front', 0.27, 0.028, 0.028, mats.headband, [0, 0.675, 0.17]));
headband.add(box('headband_left', 0.025, 0.028, 0.13, mats.headband, [-0.15, 0.675, 0.055]));
headband.add(box('headband_right', 0.025, 0.028, 0.13, mats.headband, [0.15, 0.675, 0.055]));
torso.add(headband);

const cap = variantGroup('headwear', 'cap');
cap.add(mesh('headband_cap_crown', new THREE.SphereGeometry(0.18, 32, 16, 0, Math.PI * 2, 0, Math.PI * 0.45), mats.headband, [0, 0.735, 0.02], [1.04, 0.68, 0.98]));
cap.add(box('headband_cap_brim', 0.22, 0.025, 0.10, mats.headband, [0, 0.67, 0.205]));
torso.add(cap);

[-1, 1].forEach((side) => {
  torso.add(sph(side < 0 ? 'jersey_left_shoulder_cap' : 'jersey_right_shoulder_cap',
    0.105, mats.jersey, [side * 0.26, 0.25, 0.0], [1.0, 0.85, 0.92]));
});

function makeArm(side) {
  const sideName = side > 0 ? 'left' : 'right';
  const upper = new THREE.Group();
  upper.name = 'visual_' + sideName + '_upper_arm';
  upper.position.set(side * 0.29, 0.25, 0);
  torso.add(upper);

  upper.add(cyl('jersey_' + sideName + '_sleeve',
    0.058, 0.052, 0.22, mats.jersey, [0, -0.11, 0], [1.0, 1.0, 0.9]));

  const fore = new THREE.Group();
  fore.name = 'visual_' + sideName + '_forearm';
  fore.position.y = -0.22;
  upper.add(fore);
  fore.add(cyl('skin_' + sideName + '_forearm',
    0.046, 0.04, 0.22, mats.skin, [0, -0.11, 0], [0.95, 1.0, 0.85]));
  fore.add(sph('skin_' + sideName + '_hand',
    0.058, mats.skin, [0, -0.24, 0], [0.9, 0.9, 0.82]));
  if (side < 0) {
    const socket = new THREE.Group();
    socket.name = 'paddle_socket';
    socket.position.set(0, -0.24, 0);
    socket.userData.slot = 'paddleSocket';
    fore.add(socket);
  }
}

makeArm(1);
makeArm(-1);

hips.add(sph('shorts_hips', 0.25, mats.shorts, [0, 0.0, 0], [1.02, 0.58, 0.72]));
hips.add(box('shorts_waistband', 0.42, 0.055, 0.20, mats.jerseyDark, [0, 0.13, 0.0]));

function makeLeg(side) {
  const leg = new THREE.Group();
  leg.name = side < 0 ? 'left_leg' : 'right_leg';
  leg.position.set(side * 0.12, 0.78, 0);
  root.add(leg);

  leg.add(cyl(side < 0 ? 'shorts_left_thigh' : 'shorts_right_thigh',
    0.07, 0.062, 0.34, mats.shorts, [0, -0.18, 0], [1.0, 1.0, 0.9]));
  leg.add(cyl(side < 0 ? 'skin_left_calf' : 'skin_right_calf',
    0.048, 0.055, 0.31, mats.skin, [0, -0.51, 0.005], [0.95, 1.0, 0.86]));
  leg.add(cyl(side < 0 ? 'shoe_left_sock' : 'shoe_right_sock',
    0.05, 0.052, 0.08, mats.sock, [0, -0.70, 0.006], [0.95, 1.0, 0.9]));
  leg.add(box(side < 0 ? 'shoe_left' : 'shoe_right',
    0.12, 0.065, 0.24, mats.shoe, [0, -0.76, 0.055]));
  leg.add(box(side < 0 ? 'shoe_left_sole' : 'shoe_right_sole',
    0.13, 0.018, 0.25, mats.jerseyDark, [0, -0.80, 0.055]));
  return leg;
}

const leftLeg = makeLeg(-1);
const rightLeg = makeLeg(1);

function vecTrack(name, times, values) {
  return new THREE.VectorKeyframeTrack(name + '.position', times, values);
}

function quatValues(eulers) {
  const out = [];
  eulers.forEach((e) => {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(e[0], e[1], e[2]));
    out.push(q.x, q.y, q.z, q.w);
  });
  return out;
}

function quatTrack(name, times, eulers) {
  return new THREE.QuaternionKeyframeTrack(name + '.quaternion', times, quatValues(eulers));
}

const clips = [];
clips.push(new THREE.AnimationClip('idle', 1.4, [
  vecTrack('torso', [0, 0.7, 1.4], [0, 0.92, 0, 0, 0.94, 0, 0, 0.92, 0]),
  vecTrack('hips', [0, 0.7, 1.4], [0, 0.78, 0, 0, 0.795, 0, 0, 0.78, 0])
]));
clips.push(new THREE.AnimationClip('ready', 1.2, [
  vecTrack('torso', [0, 0.6, 1.2], [0, 0.895, 0.035, 0, 0.91, 0.025, 0, 0.895, 0.035]),
  vecTrack('hips', [0, 0.6, 1.2], [0, 0.745, 0, 0, 0.76, 0, 0, 0.745, 0]),
  quatTrack('torso', [0, 0.6, 1.2], [[-0.08, 0, 0], [-0.055, 0, 0], [-0.08, 0, 0]]),
  quatTrack('left_leg', [0, 0.6, 1.2], [[0.12, 0.04, 0.02], [0.08, 0.04, -0.015], [0.12, 0.04, 0.02]]),
  quatTrack('right_leg', [0, 0.6, 1.2], [[0.12, -0.04, -0.02], [0.08, -0.04, 0.015], [0.12, -0.04, -0.02]])
]));
clips.push(new THREE.AnimationClip('run', 0.62, [
  quatTrack('left_leg', [0, 0.31, 0.62], [[0.45, 0, 0], [-0.45, 0, 0], [0.45, 0, 0]]),
  quatTrack('right_leg', [0, 0.31, 0.62], [[-0.45, 0, 0], [0.45, 0, 0], [-0.45, 0, 0]]),
  quatTrack('torso', [0, 0.31, 0.62], [[0, 0, 0.035], [0, 0, -0.035], [0, 0, 0.035]]),
  vecTrack('hips', [0, 0.155, 0.31, 0.465, 0.62], [0, 0.78, 0, 0, 0.805, 0, 0, 0.78, 0, 0, 0.805, 0, 0, 0.78, 0])
]));
const swingTimes = [0, 0.10, 0.22, 0.34, 0.44];
clips.push(new THREE.AnimationClip('forehand', 0.44, [
  // Contact stays at 0.22s, matching primitive contactT 0.5 on the 0.44s swing.
  quatTrack('torso', swingTimes, [[0.02, -0.44, 0.04], [0.00, -0.62, 0.06], [0.00, 0.22, -0.08], [0.02, 0.46, -0.13], [0.00, 0.12, -0.02]]),
  quatTrack('hips', swingTimes, [[0.00, -0.10, 0.00], [0.00, -0.18, 0.00], [0.00, 0.08, 0.00], [0.00, 0.16, 0.00], [0.00, 0.02, 0.00]]),
  quatTrack('left_leg', swingTimes, [[0.10, 0.05, 0.04], [0.18, 0.08, 0.05], [0.08, 0.00, -0.02], [0.04, -0.04, -0.04], [0.08, 0.02, 0.00]]),
  quatTrack('right_leg', swingTimes, [[0.06, -0.08, -0.03], [0.04, -0.13, -0.05], [0.12, -0.02, 0.02], [0.18, 0.07, 0.04], [0.08, -0.02, 0.00]]),
  vecTrack('torso', swingTimes, [0, 0.895, 0.03, 0, 0.885, 0.045, 0, 0.905, 0.02, 0, 0.915, 0.0, 0, 0.90, 0.02])
]));
clips.push(new THREE.AnimationClip('backhand', 0.44, [
  quatTrack('torso', swingTimes, [[0.02, 0.44, -0.04], [0.00, 0.62, -0.06], [0.00, -0.22, 0.08], [0.02, -0.46, 0.13], [0.00, -0.12, 0.02]]),
  quatTrack('hips', swingTimes, [[0.00, 0.10, 0.00], [0.00, 0.18, 0.00], [0.00, -0.08, 0.00], [0.00, -0.16, 0.00], [0.00, -0.02, 0.00]]),
  quatTrack('left_leg', swingTimes, [[0.06, 0.08, 0.03], [0.04, 0.13, 0.05], [0.12, 0.02, -0.02], [0.18, -0.07, -0.04], [0.08, 0.02, 0.00]]),
  quatTrack('right_leg', swingTimes, [[0.10, -0.05, -0.04], [0.18, -0.08, -0.05], [0.08, 0.00, 0.02], [0.04, 0.04, 0.04], [0.08, -0.02, 0.00]]),
  vecTrack('torso', swingTimes, [0, 0.895, 0.03, 0, 0.885, 0.045, 0, 0.905, 0.02, 0, 0.915, 0.0, 0, 0.90, 0.02])
]));
clips.push(new THREE.AnimationClip('serve', 0.44, [
  quatTrack('torso', swingTimes, [[0.10, -0.18, 0.02], [0.16, -0.24, 0.03], [-0.16, 0.10, -0.02], [-0.20, 0.22, -0.04], [0.02, 0.04, 0.00]]),
  quatTrack('hips', swingTimes, [[0.00, -0.04, 0.00], [0.00, -0.08, 0.00], [0.00, 0.04, 0.00], [0.00, 0.08, 0.00], [0.00, 0.00, 0.00]]),
  quatTrack('left_leg', swingTimes, [[0.08, 0.05, 0.02], [0.12, 0.07, 0.03], [0.04, 0.02, 0.00], [0.02, -0.02, -0.01], [0.08, 0.00, 0.00]]),
  quatTrack('right_leg', swingTimes, [[0.16, -0.06, -0.02], [0.22, -0.08, -0.03], [0.08, -0.02, 0.00], [0.04, 0.02, 0.01], [0.08, 0.00, 0.00]]),
  vecTrack('torso', swingTimes, [0, 0.895, 0.035, 0, 0.875, 0.05, 0, 0.91, 0.02, 0, 0.925, 0.005, 0, 0.90, 0.025])
]));
clips.push(new THREE.AnimationClip('smash', 0.44, [
  // Contact stays at 0.22s; this is visual-only overhead body language.
  quatTrack('torso', swingTimes, [[-0.16, -0.18, 0.03], [-0.26, -0.22, 0.06], [0.10, 0.10, -0.08], [0.22, 0.18, -0.12], [0.02, 0.04, -0.02]]),
  quatTrack('hips', swingTimes, [[0.00, -0.06, 0.00], [0.00, -0.10, 0.00], [0.00, 0.06, 0.00], [0.00, 0.12, 0.00], [0.00, 0.02, 0.00]]),
  quatTrack('left_leg', swingTimes, [[0.16, 0.05, 0.04], [0.22, 0.07, 0.05], [0.10, 0.00, -0.02], [0.05, -0.03, -0.03], [0.08, 0.00, 0.00]]),
  quatTrack('right_leg', swingTimes, [[0.06, -0.07, -0.03], [0.04, -0.12, -0.04], [0.18, -0.02, 0.03], [0.22, 0.06, 0.05], [0.08, 0.00, 0.00]]),
  vecTrack('torso', swingTimes, [0, 0.91, 0.02, 0, 0.93, 0.00, 0, 0.90, 0.025, 0, 0.885, 0.045, 0, 0.90, 0.02])
]));

const exporter = new GLTFExporter();
const glb = await new Promise((resolve, reject) => {
  exporter.parse(
    root,
    (result) => resolve(result),
    (error) => reject(error),
    { binary: true, animations: clips, trs: true, onlyVisible: false }
  );
});

await fs.mkdir(path.dirname(OUT), { recursive: true });
await fs.writeFile(OUT, Buffer.from(glb));
console.log(`wrote ${path.relative(ROOT, OUT)} (${Buffer.byteLength(Buffer.from(glb))} bytes)`);
