/* ============================================================================
 * scene.js — Builds the 3D world: court, venue surroundings, lighting, sky and
 * the ball. Venue, court palette and outdoor time-of-day are selected from the
 * pre-match menu so visual variety stays centralized here.
 * ==========================================================================*/
'use strict';

import * as THREE from 'three';
import { COURT } from './constants.js';
import { cloneModelScene } from './assets.js';

const C = COURT;

const COURT_PALETTES = {
  blue: {
    court: '#1a4a8a',
    kitchen: '#4a9fd8',
    surround: 0x0a2a1e,
    indoorSurround: 0x24466f
  },
  green: {
    court: '#1d6a3a',
    kitchen: '#6fbe78',
    surround: 0x4a874f,
    indoorSurround: 0x4a874f
  }
};

const OUTDOOR_TOD_PRESETS = {
  day: {
    bgColor: 0x6ab4e8, fogColor: 0x9ed0ec, fogNear: 70, fogFar: 220,
    skyTop: 0x1a6fa8, skyBot: 0x8ed4f0,
    hemiSky: 0xb8deff, hemiGnd: 0x3d6a10, hemiInt: 0.9,
    sunColor: 0xfff8e8, sunInt: 2.2, sunPos: [6, 20, 8],
    fillColor: 0xddeeff, fillInt: 0.5,
    ballEmissive: 0x3a9e00, ballEmissiveInt: 0.55,
    ballGlow: 0x6cff14, ballGlowOpacity: 0.18,
    trail: 0x66e000, trailOpacity: 0.5,
    lampSet: null
  },
  night: {
    bgColor: 0x02050c, fogColor: 0x07111d, fogNear: 28, fogFar: 105,
    skyTop: 0x01040b, skyBot: 0x081a2f,
    hemiSky: 0x11233a, hemiGnd: 0x030608, hemiInt: 0.16,
    sunColor: 0xdde7ff, sunInt: 1.7, sunPos: [0, 21, 7],
    fillColor: 0x8fb6ff, fillInt: 0.55,
    ballEmissive: 0x56c400, ballEmissiveInt: 0.95,
    ballGlow: 0x96ff46, ballGlowOpacity: 0.26,
    trail: 0x8dff42, trailOpacity: 0.68,
    lampSet: 'outdoor'
  }
};

const VENUE_PRESETS = {
  park: {
    outdoor: true,
    apron: 0x162b10,
    tod: {
      day: {},
      night: { apron: 0x08110a }
    }
  },
  tropical: {
    outdoor: true,
    apron: 0x2f5f20,
    tod: {
      day: {
        bgColor: 0x86d7f6, fogColor: 0xc6f0fb, skyTop: 0x1f9bd1, skyBot: 0xb8f4ff,
        hemiSky: 0xd1efff, hemiGnd: 0x54722a, sunInt: 2.05, sunPos: [5, 19, 7],
        fillColor: 0xf8f2da, fillInt: 0.42
      },
      night: {
        bgColor: 0x030914, fogColor: 0x0a1623, skyTop: 0x041225, skyBot: 0x0b2741,
        hemiSky: 0x173450, hemiGnd: 0x07110b, fillColor: 0xa6d2ff, fillInt: 0.6
      }
    }
  },
  indoor: {
    outdoor: false,
    bgColor: 0xd8e4ef, fogColor: 0xe6eef5, fogNear: 85, fogFar: 190,
    hemiSky: 0xf3f8ff, hemiGnd: 0x9da8b1, hemiInt: 1.05,
    fillColor: 0xeaf2fa, fillInt: 0.85,
    fillPos: [-7, 10, -4],
    ballEmissive: 0x429900, ballEmissiveInt: 0.42,
    ballGlow: 0x7dff36, ballGlowOpacity: 0.12,
    trail: 0x70e529, trailOpacity: 0.42,
    apron: 0xcad2d8,
    hallFloor: 0xa6b3bc,
    wallLower: 0xd6dde4,
    wallUpper: 0xf3f7fb,
    steel: 0x7d8c98,
    curtain: 0x2d4e73,
    ceiling: 0xdfe6ed,
    courtShadow: 0.22
  }
};

function makeRng(seed) {
  var s = seed >>> 0;
  return function () {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function resolveOptions(opts) {
  var venue = VENUE_PRESETS[opts && opts.venue] ? opts.venue : 'park';
  var palette = COURT_PALETTES[opts && opts.courtPalette] ? opts.courtPalette : 'blue';
  var tod = venue === 'indoor' ? 'day' : ((opts && opts.timeOfDay) === 'night' ? 'night' : 'day');
  return { venue: venue, courtPalette: palette, timeOfDay: tod };
}

function resolvePreset(opts) {
  var cfg = resolveOptions(opts);
  var venue = VENUE_PRESETS[cfg.venue];
  var palette = COURT_PALETTES[cfg.courtPalette];
  if (!venue.outdoor) return Object.assign({ venueKey: cfg.venue }, venue, palette);
  return Object.assign(
    { venueKey: cfg.venue },
    OUTDOOR_TOD_PRESETS[cfg.timeOfDay],
    { apron: venue.apron },
    venue.tod[cfg.timeOfDay] || {},
    palette
  );
}

function courtTexture(colors) {
  var W = 1024, H = 1024;
  var cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  var g = cv.getContext('2d');
  var rng = makeRng(colors.venueKey === 'indoor' ? 9941 : (colors.court === '#1d6a3a' ? 4417 : 2281));
  var mPerPxX = (2 * C.HALF_W) / W;
  var mPerPxZ = (2 * C.HALF_L) / H;
  function X(m) { return (m + C.HALF_W) / mPerPxX; }
  function Z(m) { return (m + C.HALF_L) / mPerPxZ; }

  g.fillStyle = colors.court;
  g.fillRect(0, 0, W, H);
  var courtGrad = g.createLinearGradient(0, 0, W, H);
  courtGrad.addColorStop(0, 'rgba(255,255,255,0.10)');
  courtGrad.addColorStop(0.46, 'rgba(255,255,255,0.00)');
  courtGrad.addColorStop(1, 'rgba(0,0,0,0.16)');
  g.fillStyle = courtGrad;
  g.fillRect(0, 0, W, H);
  g.fillStyle = colors.kitchen;
  g.fillRect(0, Z(-C.KITCHEN), W, Z(C.KITCHEN) - Z(-C.KITCHEN));
  var kitchenGrad = g.createLinearGradient(0, Z(-C.KITCHEN), 0, Z(C.KITCHEN));
  kitchenGrad.addColorStop(0, 'rgba(255,255,255,0.14)');
  kitchenGrad.addColorStop(0.5, 'rgba(255,255,255,0.02)');
  kitchenGrad.addColorStop(1, 'rgba(0,0,0,0.10)');
  g.fillStyle = kitchenGrad;
  g.fillRect(0, Z(-C.KITCHEN), W, Z(C.KITCHEN) - Z(-C.KITCHEN));
  g.strokeStyle = 'rgba(0,0,0,0.20)';
  g.lineWidth = 13;
  g.lineCap = 'square';
  function line(x1, z1, x2, z2) {
    g.beginPath();
    g.moveTo(X(x1), Z(z1));
    g.lineTo(X(x2), Z(z2));
    g.stroke();
  }
  line(-C.HALF_W, -C.HALF_L, C.HALF_W, -C.HALF_L);
  line(-C.HALF_W, C.HALF_L, C.HALF_W, C.HALF_L);
  line(-C.HALF_W, -C.HALF_L, -C.HALF_W, C.HALF_L);
  line(C.HALF_W, -C.HALF_L, C.HALF_W, C.HALF_L);
  line(-C.HALF_W, -C.KITCHEN, C.HALF_W, -C.KITCHEN);
  line(-C.HALF_W, C.KITCHEN, C.HALF_W, C.KITCHEN);
  line(0, -C.HALF_L, 0, -C.KITCHEN);
  line(0, C.KITCHEN, 0, C.HALF_L);
  g.strokeStyle = '#f8fbff';
  g.lineWidth = 7;
  line(-C.HALF_W, -C.HALF_L, C.HALF_W, -C.HALF_L);
  line(-C.HALF_W, C.HALF_L, C.HALF_W, C.HALF_L);
  line(-C.HALF_W, -C.HALF_L, -C.HALF_W, C.HALF_L);
  line(C.HALF_W, -C.HALF_L, C.HALF_W, C.HALF_L);
  line(-C.HALF_W, -C.KITCHEN, C.HALF_W, -C.KITCHEN);
  line(-C.HALF_W, C.KITCHEN, C.HALF_W, C.KITCHEN);
  line(0, -C.HALF_L, 0, -C.KITCHEN);
  line(0, C.KITCHEN, 0, C.HALF_L);
  g.globalCompositeOperation = 'overlay';
  for (var i = 0; i < 5200; i++) {
    var a = rng() * 0.05;
    g.fillStyle = 'rgba(255,255,255,' + a + ')';
    g.fillRect(rng() * W, rng() * H, 1 + rng() * 2, 1 + rng() * 2);
  }
  g.globalCompositeOperation = 'source-over';
  for (var j = 0; j < 110; j++) {
    var x = rng() * W;
    var y = rng() * H;
    var len = 18 + rng() * 90;
    g.strokeStyle = 'rgba(255,255,255,' + (0.035 + rng() * 0.055) + ')';
    g.lineWidth = 1 + rng() * 2;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + len * (rng() > 0.5 ? 1 : -1), y + (rng() - 0.5) * 10);
    g.stroke();
  }
  for (var k = 0; k < 24; k++) {
    var sx = X((rng() * 2 - 1) * C.HALF_W * 0.86);
    var sz = Z((rng() * 2 - 1) * C.HALF_L * 0.86);
    var r = 12 + rng() * 32;
    var grad = g.createRadialGradient(sx, sz, 0, sx, sz, r);
    grad.addColorStop(0, 'rgba(0,0,0,0.045)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(sx, sz, r, 0, Math.PI * 2);
    g.fill();
  }
  var tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function netTexture() {
  var W = 512, H = 128;
  var cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  var g = cv.getContext('2d');
  g.clearRect(0, 0, W, H);
  g.strokeStyle = 'rgba(20,24,30,0.55)';
  g.lineWidth = 1.5;
  for (var x = 0; x <= W; x += 10) {
    g.beginPath();
    g.moveTo(x, 8);
    g.lineTo(x, H);
    g.stroke();
  }
  for (var y = 8; y <= H; y += 10) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(W, y);
    g.stroke();
  }
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, W, 9);
  var tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function fenceTexture() {
  var W = 256, H = 96;
  var cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  var g = cv.getContext('2d');
  g.clearRect(0, 0, W, H);
  g.strokeStyle = 'rgba(210,220,228,0.85)';
  g.lineWidth = 1.5;
  var s = 16;
  for (var d = -H; d < W; d += s) {
    g.beginPath();
    g.moveTo(d, 0);
    g.lineTo(d + H, H);
    g.stroke();
    g.beginPath();
    g.moveTo(d + H, 0);
    g.lineTo(d, H);
    g.stroke();
  }
  var tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

var INSTANCE_DUMMY = new THREE.Object3D();

function setInstance(mesh, index, x, y, z, sx, sy, sz, rx, ry, rz) {
  INSTANCE_DUMMY.position.set(x, y, z);
  INSTANCE_DUMMY.rotation.set(rx || 0, ry || 0, rz || 0);
  INSTANCE_DUMMY.scale.set(sx, sy, sz);
  INSTANCE_DUMMY.updateMatrix();
  mesh.setMatrixAt(index, INSTANCE_DUMMY.matrix);
}

function finishInstances(mesh) {
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}

function addFence(scene) {
  var fx = C.HALF_W + 2.6;
  var fz = C.HALF_L + 3.4;
  var fh = 2.2;
  var fenceMat = new THREE.MeshBasicMaterial({
    map: fenceTexture(), transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false
  });
  var railMat = new THREE.MeshStandardMaterial({ color: 0x9aa6ad, metalness: 0.5, roughness: 0.5 });
  function side(cx, cz, len, horiz) {
    var grp = new THREE.Group();
    var panel = new THREE.Mesh(new THREE.PlaneGeometry(len, fh), fenceMat);
    panel.position.y = fh / 2;
    if (!horiz) panel.rotation.y = Math.PI / 2;
    grp.add(panel);
    [0.06, fh - 0.02].forEach(function (ry) {
      var rail = new THREE.Mesh(
        new THREE.BoxGeometry(horiz ? len : 0.05, 0.05, horiz ? 0.05 : len),
        railMat
      );
      rail.position.y = ry;
      grp.add(rail);
    });
    var posts = Math.max(2, Math.round(len / 3));
    var postMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.04, 0.04, fh, 6), railMat, posts + 1);
    for (var i = 0; i <= posts; i++) {
      var t = i / posts - 0.5;
      setInstance(postMesh, i, horiz ? t * len : 0, fh / 2, horiz ? 0 : t * len, 1, 1, 1);
    }
    grp.add(finishInstances(postMesh));
    grp.position.set(cx, 0, cz);
    scene.add(grp);
  }
  side(0, fz, 2 * fx, true);
  side(0, -fz, 2 * fx, true);
  side(fx, 0, 2 * fz, false);
  side(-fx, 0, 2 * fz, false);
}

function scatterTrees(scene, spots, greens) {
  var group = new THREE.Group();
  var trunk = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.12, 0.18, 1.6, 7),
    new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 1 }),
    spots.length
  );
  var blobDefs = [[0, 1.9, 0, 0.95], [0.45, 1.7, 0.2, 0.7], [-0.4, 1.75, -0.2, 0.65]];
  var leaves = [];
  for (var g = 0; g < blobDefs.length; g++) {
    leaves.push(new THREE.InstancedMesh(
      new THREE.SphereGeometry(1, 8, 6),
      new THREE.MeshStandardMaterial({ color: greens[g % greens.length], roughness: 0.9, flatShading: true }),
      spots.length
    ));
  }
  for (var i = 0; i < spots.length; i++) {
    var sp = spots[i];
    var scale = sp[2] || 1;
    var rot = i * 1.7;
    var c = Math.cos(rot);
    var s = Math.sin(rot);
    setInstance(trunk, i, sp[0], 0.8 * scale, sp[1], scale, scale, scale, 0, rot, 0);
    for (var j = 0; j < blobDefs.length; j++) {
      var b = blobDefs[j];
      var bx = sp[0] + (b[0] * c + b[2] * s) * scale;
      var bz = sp[1] + (-b[0] * s + b[2] * c) * scale;
      setInstance(leaves[j], i, bx, b[1] * scale, bz, b[3] * scale, b[3] * scale, b[3] * scale, 0, rot, 0);
    }
  }
  group.add(finishInstances(trunk));
  for (var k = 0; k < leaves.length; k++) group.add(finishInstances(leaves[k]));
  scene.add(group);
}

function scatterPalms(scene, spots) {
  var group = new THREE.Group();
  var trunk = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.11, 0.19, 3.9, 8),
    new THREE.MeshStandardMaterial({ color: 0x8c6036, roughness: 1 }),
    spots.length
  );
  var leafGeo = new THREE.PlaneGeometry(1.7, 0.34, 1, 1);
  var leafMatA = new THREE.MeshStandardMaterial({ color: 0x4ea64c, roughness: 0.95, side: THREE.DoubleSide });
  var leafMatB = new THREE.MeshStandardMaterial({ color: 0x7bcf5a, roughness: 0.95, side: THREE.DoubleSide });
  var leafA = new THREE.InstancedMesh(leafGeo, leafMatA, spots.length * 3);
  var leafB = new THREE.InstancedMesh(leafGeo, leafMatB, spots.length * 3);
  var ai = 0;
  var bi = 0;
  for (var i = 0; i < spots.length; i++) {
    var sp = spots[i];
    var scale = sp[2] || 1;
    var rot = sp[3] || (i * 0.8);
    setInstance(trunk, i, sp[0], 1.95 * scale, sp[1], scale, scale, scale, 0, rot, -0.08);
    for (var j = 0; j < 6; j++) {
      var target = j % 2 ? leafA : leafB;
      var index = j % 2 ? ai++ : bi++;
      setInstance(
        target,
        index,
        sp[0],
        3.9 * scale,
        sp[1],
        scale,
        scale,
        scale,
        -0.3 - (j % 2) * 0.1,
        rot + (Math.PI * 2 * j) / 6,
        -0.32 + (j % 3) * 0.08
      );
    }
  }
  group.add(finishInstances(trunk));
  group.add(finishInstances(leafA));
  group.add(finishInstances(leafB));
  scene.add(group);
}

function addParkScenery(scene) {
  addFence(scene);
  scatterTrees(scene, [
    [-C.HALF_W - 6.1, C.HALF_L + 5.4, 1.2], [C.HALF_W + 6.4, C.HALF_L + 4.4, 1.4],
    [-C.HALF_W - 7.2, 0, 1.1], [C.HALF_W + 7.5, -2, 1.3],
    [-C.HALF_W - 6.5, -C.HALF_L - 5.5, 1.25], [C.HALF_W + 5.9, -C.HALF_L - 6.2, 1.0],
    [-2.8, -C.HALF_L - 8.4, 1.35], [0.6, C.HALF_L + 8.2, 1.5]
  ], [0x3f8a3a, 0x4fa044]);
}

function addTropicalScenery(scene) {
  var sandMat = new THREE.MeshStandardMaterial({ color: 0xd7c28a, roughness: 1 });
  var sand = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), sandMat);
  sand.rotation.x = -Math.PI / 2;
  sand.position.y = -0.012;
  sand.receiveShadow = true;
  scene.add(sand);

  var beachBand = new THREE.Mesh(
    new THREE.PlaneGeometry(2 * C.HALF_W + 10, 2 * C.HALF_L + 10),
    new THREE.MeshStandardMaterial({ color: 0xbea167, roughness: 0.98 })
  );
  beachBand.rotation.x = -Math.PI / 2;
  beachBand.position.y = -0.003;
  beachBand.receiveShadow = true;
  scene.add(beachBand);

  var water = new THREE.Mesh(
    new THREE.PlaneGeometry(58, 16),
    new THREE.MeshStandardMaterial({ color: 0x56b7d4, roughness: 0.2, metalness: 0.08 })
  );
  water.rotation.x = -Math.PI / 2;
  water.position.set(0, -0.015, -C.HALF_L - 15);
  scene.add(water);

  scatterPalms(scene, [
    [-C.HALF_W - 6.4, C.HALF_L + 5.1, 1.15, 0.5], [C.HALF_W + 6.8, C.HALF_L + 4.6, 1.35, -0.4],
    [-C.HALF_W - 7.1, -1.3, 1.05, 0.9], [C.HALF_W + 7.5, -2.4, 1.22, -0.7],
    [-C.HALF_W - 5.8, -C.HALF_L - 5.8, 1.18, 0.35], [C.HALF_W + 6.1, -C.HALF_L - 6.5, 1.08, -0.2]
  ]);
  scatterTrees(scene, [
    [-1.2, C.HALF_L + 7.5, 1.45], [1.7, -C.HALF_L - 8.2, 1.35], [C.HALF_W + 4.5, C.HALF_L + 7.9, 0.95]
  ], [0x2d7f39, 0x53b95e, 0x91d166]);
}

function addNightLights(scene) {
  var poles = new THREE.Group();
  var poleMat = new THREE.MeshStandardMaterial({ color: 0x5b6776, metalness: 0.7, roughness: 0.4 });
  var lampMat = new THREE.MeshStandardMaterial({
    color: 0xe8edf6, emissive: 0xcddfff, emissiveIntensity: 1.2, metalness: 0.15, roughness: 0.35
  });
  var glowMat = new THREE.MeshBasicMaterial({
    color: 0xb8d7ff, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false
  });
  var spots = [
    [-C.HALF_W - 2.8, 4.8, C.HALF_L - 0.8],
    [C.HALF_W + 2.8, 4.8, C.HALF_L - 0.8],
    [-C.HALF_W - 2.8, 4.8, -C.HALF_L + 0.8],
    [C.HALF_W + 2.8, 4.8, -C.HALF_L + 0.8]
  ];
  for (var i = 0; i < spots.length; i++) {
    var sp = spots[i];
    var pole = new THREE.Group();
    var mast = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, sp[1], 10), poleMat);
    mast.position.y = sp[1] / 2;
    pole.add(mast);
    var arm = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.07, 0.07), poleMat);
    arm.position.set(sp[0] < 0 ? 0.32 : -0.32, sp[1] - 0.18, 0);
    pole.add(arm);
    var head = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.16, 0.28), lampMat);
    head.position.set(sp[0] < 0 ? 0.6 : -0.6, sp[1] - 0.2, 0);
    pole.add(head);
    var glow = new THREE.Mesh(new THREE.SphereGeometry(0.38, 12, 10), glowMat);
    glow.position.set(sp[0] < 0 ? 0.6 : -0.6, sp[1] - 0.2, 0);
    pole.add(glow);
    pole.position.set(sp[0], 0, sp[2]);
    poles.add(pole);
  }
  scene.add(poles);
  return poles;
}

function addIndoorShell(scene, p) {
  var overhead = []; // ceiling + trusses — hidden by the straight-overhead camera
  var floor = new THREE.Mesh(
    new THREE.PlaneGeometry(120, 120),
    new THREE.MeshStandardMaterial({ color: p.hallFloor, roughness: 0.95 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.012;
  floor.receiveShadow = true;
  scene.add(floor);

  var wallLowerMat = new THREE.MeshStandardMaterial({ color: p.wallLower, roughness: 0.95 });
  var wallUpperMat = new THREE.MeshStandardMaterial({ color: p.wallUpper, roughness: 0.95 });
  var steelMat = new THREE.MeshStandardMaterial({ color: p.steel, metalness: 0.5, roughness: 0.45 });
  var curtainMat = new THREE.MeshStandardMaterial({ color: p.curtain, roughness: 0.95, side: THREE.DoubleSide });

  function wall(width, height, x, z, rotY) {
    var grp = new THREE.Group();
    var lower = new THREE.Mesh(new THREE.PlaneGeometry(width, height * 0.45), wallLowerMat);
    lower.position.y = height * 0.225;
    grp.add(lower);
    var upper = new THREE.Mesh(new THREE.PlaneGeometry(width, height * 0.55), wallUpperMat);
    upper.position.y = height * 0.725;
    grp.add(upper);
    grp.position.set(x, 0, z);
    grp.rotation.y = rotY || 0;
    scene.add(grp);
  }

  wall(44, 12, 0, C.HALF_L + 13, Math.PI);
  wall(44, 12, 0, -C.HALF_L - 13, 0);
  wall(50, 12, C.HALF_W + 14, 0, -Math.PI / 2);
  wall(50, 12, -C.HALF_W - 14, 0, Math.PI / 2);

  var ceiling = new THREE.Mesh(
    new THREE.PlaneGeometry(46, 48),
    new THREE.MeshStandardMaterial({ color: p.ceiling, roughness: 0.92, side: THREE.DoubleSide })
  );
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = 11.9;
  scene.add(ceiling);
  overhead.push(ceiling);

  for (var i = -2; i <= 2; i++) {
    var truss = new THREE.Group();
    var beam = new THREE.Mesh(new THREE.BoxGeometry(42, 0.18, 0.18), steelMat);
    beam.position.y = 10.8;
    truss.add(beam);
    var left = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.8, 0.16), steelMat);
    left.position.set(-18, 9.9, 0);
    truss.add(left);
    var right = left.clone();
    right.position.x = 18;
    truss.add(right);
    truss.position.z = i * 7.5;
    scene.add(truss);
    overhead.push(truss);
  }

  for (var j = -1; j <= 1; j += 2) {
    var curtain = new THREE.Mesh(new THREE.PlaneGeometry(18, 6.8), curtainMat);
    curtain.position.set(j * (C.HALF_W + 6.7), 4.2, 0);
    curtain.rotation.y = -j * Math.PI / 2;
    scene.add(curtain);
  }

  var stripes = [
    [-C.HALF_W - 13.8, 0, Math.PI / 2],
    [C.HALF_W + 13.8, 0, -Math.PI / 2]
  ];
  for (var k = 0; k < stripes.length; k++) {
    var s = stripes[k];
    var band = new THREE.Mesh(
      new THREE.PlaneGeometry(50, 1.1),
      new THREE.MeshStandardMaterial({ color: 0x8fb6d6, roughness: 0.95 })
    );
    band.position.set(s[0], 5.6, s[1]);
    band.rotation.y = s[2];
    scene.add(band);
  }

  return overhead;
}

function addOutdoorGround(scene, p) {
  var apron = new THREE.Mesh(
    new THREE.PlaneGeometry(120, 120),
    new THREE.MeshStandardMaterial({ color: p.apron, roughness: 1 })
  );
  apron.rotation.x = -Math.PI / 2;
  apron.position.y = -0.01;
  apron.receiveShadow = true;
  scene.add(apron);

  var surround = new THREE.Mesh(
    new THREE.PlaneGeometry(2 * C.HALF_W + 6, 2 * C.HALF_L + 6),
    new THREE.MeshStandardMaterial({ color: p.surround, roughness: 0.95 })
  );
  surround.rotation.x = -Math.PI / 2;
  surround.position.y = 0.0;
  surround.receiveShadow = true;
  scene.add(surround);
}

function addCourt(scene, p) {
  var court = new THREE.Mesh(
    new THREE.PlaneGeometry(2 * C.HALF_W, 2 * C.HALF_L),
    new THREE.MeshStandardMaterial({ map: courtTexture(p), roughness: 0.82, metalness: 0.02 })
  );
  court.rotation.x = -Math.PI / 2;
  court.position.y = 0.012;
  court.receiveShadow = true;
  scene.add(court);
  addCourtAccents(scene, p);
  return court;
}

function addCourtAccents(scene, p) {
  var edgeMat = new THREE.MeshStandardMaterial({
    color: p.venueKey === 'indoor' ? 0xdce8f2 : 0x17212a,
    roughness: 0.72,
    metalness: 0.02
  });
  function rail(w, d, x, z) {
    var m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.045, d), edgeMat);
    m.position.set(x, 0.035, z);
    m.castShadow = true;
    m.receiveShadow = true;
    scene.add(m);
  }
  rail(2 * C.HALF_W + 0.26, 0.08, 0, C.HALF_L + 0.11);
  rail(2 * C.HALF_W + 0.26, 0.08, 0, -C.HALF_L - 0.11);
  rail(0.08, 2 * C.HALF_L + 0.26, C.HALF_W + 0.11, 0);
  rail(0.08, 2 * C.HALF_L + 0.26, -C.HALF_W - 0.11, 0);

  var badgeMat = new THREE.MeshStandardMaterial({
    color: p.venueKey === 'indoor' ? 0xffffff : 0xf5fbff,
    roughness: 0.65,
    transparent: true,
    opacity: 0.34
  });
  [-1, 1].forEach(function (s) {
    var badge = new THREE.Mesh(new THREE.PlaneGeometry(1.05, 0.16), badgeMat);
    badge.rotation.x = -Math.PI / 2;
    badge.position.set(0, 0.018, s * (C.HALF_L - 0.38));
    scene.add(badge);
  });
}

function addNet(scene) {
  var netGroup = new THREE.Group();
  var postMat = new THREE.MeshStandardMaterial({ color: 0x20242c, metalness: 0.6, roughness: 0.4 });
  [-1, 1].forEach(function (s) {
    var post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, C.NET_H_POST + 0.08, 12), postMat);
    post.position.set(s * C.POST_X, C.NET_H_POST / 2, 0);
    post.castShadow = true;
    netGroup.add(post);
  });
  var netMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(2 * C.POST_X, C.NET_H_POST, 24, 4),
    new THREE.MeshStandardMaterial({ map: netTexture(), transparent: true, side: THREE.DoubleSide, depthWrite: false })
  );
  var pos = netMesh.geometry.attributes.position;
  for (var i = 0; i < pos.count; i++) {
    var px = pos.getX(i);
    var sag = -0.06 * (1 - Math.pow(px / C.POST_X, 2));
    pos.setY(i, pos.getY(i) + sag);
  }
  pos.needsUpdate = true;
  netMesh.position.set(0, C.NET_H_POST / 2, 0);
  netGroup.add(netMesh);
  scene.add(netGroup);
  return netGroup;
}

function addOutdoorSky(scene, p) {
  scene.background = new THREE.Color(p.bgColor);
  scene.fog = new THREE.Fog(p.fogColor, p.fogNear, p.fogFar);
  var skyGeo = new THREE.SphereGeometry(150, 32, 16);
  var skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: {
      top: { value: new THREE.Color(p.skyTop) },
      bot: { value: new THREE.Color(p.skyBot) }
    },
    vertexShader: 'varying vec3 vP; void main(){ vP=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader: 'varying vec3 vP; uniform vec3 top; uniform vec3 bot; void main(){ float h=clamp(normalize(vP).y,0.0,1.0); gl_FragColor=vec4(mix(bot,top,h),1.0);}'
  });
  scene.add(new THREE.Mesh(skyGeo, skyMat));
}

function addIndoorLighting(scene, handles, p) {
  scene.background = new THREE.Color(p.bgColor);
  scene.fog = new THREE.Fog(p.fogColor, p.fogNear, p.fogFar);

  var hemi = new THREE.HemisphereLight(p.hemiSky, p.hemiGnd, p.hemiInt);
  scene.add(hemi);

  var key = new THREE.DirectionalLight(0xffffff, 1.15);
  key.position.set(0, 16, 1.5);
  key.castShadow = true;
  key.shadow.mapSize.set(p.shadowMapSize || 1024, p.shadowMapSize || 1024);
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 48;
  key.shadow.camera.left = -11;
  key.shadow.camera.right = 11;
  key.shadow.camera.top = 13;
  key.shadow.camera.bottom = -13;
  key.shadow.bias = -0.00022;
  key.shadow.normalBias = 0.02;
  scene.add(key);
  handles.lights.sun = key;

  var fill = new THREE.DirectionalLight(p.fillColor, p.fillInt);
  fill.position.set(p.fillPos[0], p.fillPos[1], p.fillPos[2]);
  scene.add(fill);
  handles.lights.fill = fill;

  for (var i = -1; i <= 1; i++) {
    var lamp = new THREE.RectAreaLight(0xf8fbff, 10, 12, 1.4);
    lamp.position.set(0, 10.4, i * 6.5);
    lamp.rotation.x = -Math.PI / 2;
    scene.add(lamp);
  }
}

function addOutdoorLighting(scene, handles, p) {
  var hemi = new THREE.HemisphereLight(p.hemiSky, p.hemiGnd, p.hemiInt);
  scene.add(hemi);

  var sun = new THREE.DirectionalLight(p.sunColor, p.sunInt);
  sun.position.set(p.sunPos[0], p.sunPos[1], p.sunPos[2]);
  sun.castShadow = true;
  sun.shadow.mapSize.set(p.shadowMapSize || 1024, p.shadowMapSize || 1024);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 50;
  sun.shadow.camera.left = -10;
  sun.shadow.camera.right = 10;
  sun.shadow.camera.top = 12;
  sun.shadow.camera.bottom = -12;
  sun.shadow.bias = -0.00025;
  sun.shadow.normalBias = 0.018;
  scene.add(sun);
  handles.lights.sun = sun;

  var fill = new THREE.DirectionalLight(p.fillColor, p.fillInt);
  fill.position.set(-7, 10, -4);
  scene.add(fill);
  handles.lights.fill = fill;

  if (p.lampSet) {
    handles.lights.poles = addNightLights(scene);
    var lamps = [
      { key: 'lampA', color: 0xe8f2ff, intensity: 3.0, pos: [-6.5, 7.5, 11.5], target: [0, 0, 2.2], angle: Math.PI / 5.2, pen: 0.45, decay: 1.1, shadow: true },
      { key: 'lampB', color: 0xd7e6ff, intensity: 2.4, pos: [6.5, 7.2, 11.5], target: [0, 0, 1.5], angle: Math.PI / 5.0, pen: 0.55, decay: 1.15 },
      { key: 'lampC', color: 0xcfe0ff, intensity: 2.0, pos: [-6.2, 7.2, -11.5], target: [0, 0, -1.8], angle: Math.PI / 5.0, pen: 0.55, decay: 1.2 },
      { key: 'lampD', color: 0xcfe0ff, intensity: 1.9, pos: [6.2, 7.0, -11.5], target: [0, 0, -2.4], angle: Math.PI / 5.2, pen: 0.55, decay: 1.2 }
    ];
    lamps.forEach(function (cfg) {
      var lamp = new THREE.SpotLight(cfg.color, cfg.intensity, 38, cfg.angle, cfg.pen, cfg.decay);
      lamp.position.set(cfg.pos[0], cfg.pos[1], cfg.pos[2]);
      lamp.target.position.set(cfg.target[0], cfg.target[1], cfg.target[2]);
      if (cfg.shadow) {
        lamp.castShadow = true;
        lamp.shadow.mapSize.set(p.shadowMapSize || 1024, p.shadowMapSize || 1024);
        lamp.shadow.camera.near = 1;
        lamp.shadow.camera.far = 28;
        lamp.shadow.bias = -0.00025;
        lamp.shadow.normalBias = 0.018;
      }
      scene.add(lamp);
      scene.add(lamp.target);
      handles.lights[cfg.key] = lamp;
    });
  }
}

function addBall(scene, handles, p, shadowOpacity) {
  var ballMat = new THREE.MeshStandardMaterial({
    color: 0x73ff26,
    roughness: 0.48,
    metalness: 0.0,
    emissive: p.ballEmissive,
    emissiveIntensity: p.ballEmissiveInt
  });
  var ballMesh = new THREE.Mesh(new THREE.SphereGeometry(C.BALL_R * 1.55, 24, 18), ballMat);
  ballMesh.castShadow = true;

  var glow = new THREE.Mesh(
    new THREE.SphereGeometry(C.BALL_R * 2.2, 16, 12),
    new THREE.MeshBasicMaterial({
      color: p.ballGlow,
      transparent: true,
      opacity: p.ballGlowOpacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    })
  );
  ballMesh.add(glow);
  scene.add(ballMesh);
  handles.ballMesh = ballMesh;

  // "Ghost" ball — a faint marker drawn ON TOP of everything (depthTest off) so
  // the ball is never lost behind your own player mesh. In Follow mode the low,
  // close camera looks over your shoulder, and a fast/low incoming ball travels
  // inside your avatar's silhouette until it passes you; the ghost keeps it
  // trackable. When the ball is in the open the ghost just sits on it as a faint
  // glow. A top-level sibling (not a child of ballMesh) with a high renderOrder
  // reliably paints over opaque geometry.
  var ghost = new THREE.Mesh(
    new THREE.SphereGeometry(C.BALL_R * 1.5, 16, 12),
    new THREE.MeshBasicMaterial({
      color: p.ballGlow,
      transparent: true,
      opacity: 0.35,
      depthTest: false,
      depthWrite: false
    })
  );
  ghost.renderOrder = 999;
  scene.add(ghost);
  handles.ballGhost = ghost;

  var blob = new THREE.Mesh(
    new THREE.CircleGeometry(C.BALL_R * 2.2, 16),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: shadowOpacity })
  );
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = 0.02;
  scene.add(blob);
  handles.ballBlob = blob;

  var trailGeo = new THREE.BufferGeometry();
  var trailLen = 22;
  trailGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(trailLen * 3), 3));
  var trail = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({
    color: p.trail,
    transparent: true,
    opacity: p.trailOpacity
  }));
  trail.frustumCulled = false;
  scene.add(trail);
  handles.trail = trail;
  handles.trailLen = trailLen;
  handles.trailBuf = [];
}

function addLoadedModel(scene, assets, key) {
  if (!assets || !assets.getModel) return null;
  var model = cloneModelScene(assets.getModel(key));
  if (!model) return null;
  model.traverse(function (obj) {
    if (obj && obj.isMesh) {
      obj.castShadow = obj.castShadow !== false;
      obj.receiveShadow = obj.receiveShadow !== false;
    }
  });
  scene.add(model);
  return model;
}

function addLoadedVenueAssets(scene, handles, cfg, assets) {
  var loaded = [];
  var shared = addLoadedModel(scene, assets, 'venue-shared');
  if (shared) loaded.push(shared);
  var venue = addLoadedModel(scene, assets, 'venue-' + cfg.venue);
  if (venue) loaded.push(venue);
  handles.loadedAssets = loaded;
  handles.assetFallback = loaded.length === 0;
}

export function build(scene, opts) {
  var cfg = resolveOptions(opts);
  var p = resolvePreset(cfg);
  var quality = (opts && opts.quality) || {};
  p.shadowMapSize = quality.shadowMap || 1024;
  var handles = { lights: {}, venue: cfg.venue, courtPalette: cfg.courtPalette, timeOfDay: cfg.timeOfDay };

  if (cfg.venue === 'indoor') {
    handles.overhead = addIndoorShell(scene, p);
    addIndoorLighting(scene, handles, p);
  } else {
    addOutdoorSky(scene, p);
    addOutdoorGround(scene, p);
    if (cfg.venue === 'tropical') addTropicalScenery(scene);
    else addParkScenery(scene);
    addOutdoorLighting(scene, handles, p);
  }

  addLoadedVenueAssets(scene, handles, cfg, opts && opts.assets);

  if (cfg.venue === 'indoor') {
    var indoorSurround = new THREE.Mesh(
      new THREE.PlaneGeometry(2 * C.HALF_W + 6, 2 * C.HALF_L + 6),
      new THREE.MeshStandardMaterial({ color: p.indoorSurround || p.surround, roughness: 0.85 })
    );
    indoorSurround.rotation.x = -Math.PI / 2;
    indoorSurround.position.y = 0;
    indoorSurround.receiveShadow = true;
    scene.add(indoorSurround);
  }

  handles.court = addCourt(scene, p);
  handles.net = addNet(scene);
  addBall(scene, handles, p, cfg.venue === 'indoor' ? p.courtShadow : 0.3);

  return handles;
}
