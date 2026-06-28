/* ============================================================================
 * scene.js — Builds the 3D world: court, net, park surroundings (grass, trees,
 * fence), lighting, sky and the ball. Returns handles the game loop animates.
 * Ported from the original Picklelife js/scene.js (ESM Three). Night mode,
 * family/farm venue (dog/speaker/snack table/weeds/bales), and the damaged
 * court are intentionally dropped for the standalone.
 * ==========================================================================*/
'use strict';

import * as THREE from 'three';
import { COURT } from './constants.js';

const C = COURT;

const TOD_PRESETS = {
  day: {
    bgColor: 0x6ab4e8, fogColor: 0x9ed0ec, fogNear: 70,  fogFar: 220,
    skyTop:  0x1a6fa8, skyBot:   0x8ed4f0,
    hemiSky: 0xb8deff, hemiGnd:  0x3d6a10, hemiInt: 0.9,
    sunColor: 0xfff8e8, sunInt: 2.2, sunPos: [6, 20, 8],
    fillColor: 0xddeeff, fillInt: 0.5,
    court: '#1a4a8a', kitchen: '#4a9fd8',
  },
  dusk: {
    bgColor: 0x4a1808, fogColor: 0x6a2808, fogNear: 40,  fogFar: 130,
    skyTop:  0x0d0520, skyBot:   0x8a3010,
    hemiSky: 0xff7040, hemiGnd:  0x180808, hemiInt: 0.5,
    sunColor: 0xff8030, sunInt: 1.0, sunPos: [14, 4, 4],
    fillColor: 0x4060d0, fillInt: 0.25,
    court: '#1a4a8a', kitchen: '#4a9fd8',
  },
  night: {
    bgColor: 0x0a1628, fogColor: 0x0a1628, fogNear: 45,  fogFar: 150,
    skyTop:  0x060d1a, skyBot:   0x122040,
    hemiSky: 0x1a2a40, hemiGnd:  0x0c1408, hemiInt: 0.50,
    sunColor: 0xffffff, sunInt: 0.75, sunPos: [6, 16, 8],
    fillColor: 0xbcd0ff, fillInt: 0.20,
    court: '#1a4a8a', kitchen: '#4a9fd8',
  }
};

function courtTexture(colors) {
  var courtCol   = (colors && colors.court)   || '#1a4a8a';
  var kitchenCol = (colors && colors.kitchen) || '#4a9fd8';
  var W = 1024, H = 1024;
  var cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  var g = cv.getContext('2d');
  // map court meters to pixels
  var mPerPxX = (2 * C.HALF_W) / W, mPerPxZ = (2 * C.HALF_L) / H;
  function X(m) { return (m + C.HALF_W) / mPerPxX; }
  function Z(m) { return (m + C.HALF_L) / mPerPxZ; }
  // playing surface
  g.fillStyle = courtCol; g.fillRect(0, 0, W, H);
  // non-volley zone (kitchen): lighter blue band (±7ft of net)
  g.fillStyle = kitchenCol;
  g.fillRect(0, Z(-C.KITCHEN), W, Z(C.KITCHEN) - Z(-C.KITCHEN));
  g.strokeStyle = '#f4f7fb'; g.lineWidth = 7; g.lineCap = 'square';
  function line(x1, z1, x2, z2) { g.beginPath(); g.moveTo(X(x1), Z(z1)); g.lineTo(X(x2), Z(z2)); g.stroke(); }
  // boundary
  line(-C.HALF_W, -C.HALF_L, C.HALF_W, -C.HALF_L);
  line(-C.HALF_W, C.HALF_L, C.HALF_W, C.HALF_L);
  line(-C.HALF_W, -C.HALF_L, -C.HALF_W, C.HALF_L);
  line(C.HALF_W, -C.HALF_L, C.HALF_W, C.HALF_L);
  // kitchen lines
  line(-C.HALF_W, -C.KITCHEN, C.HALF_W, -C.KITCHEN);
  line(-C.HALF_W, C.KITCHEN, C.HALF_W, C.KITCHEN);
  // center service lines (baseline to kitchen, both halves)
  line(0, -C.HALF_L, 0, -C.KITCHEN);
  line(0, C.KITCHEN, 0, C.HALF_L);
  // subtle texture noise
  for (var i = 0; i < 4000; i++) {
    g.fillStyle = 'rgba(255,255,255,' + (Math.random() * 0.03) + ')';
    g.fillRect(Math.random() * W, Math.random() * H, 2, 2);
  }
  var tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function netTexture() {
  var W = 512, H = 128;
  var cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  var g = cv.getContext('2d');
  g.clearRect(0, 0, W, H);
  g.strokeStyle = 'rgba(20,24,30,0.55)'; g.lineWidth = 1.5;
  for (var x = 0; x <= W; x += 10) { g.beginPath(); g.moveTo(x, 8); g.lineTo(x, H); g.stroke(); }
  for (var y = 8; y <= H; y += 10) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
  // white tape along top
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, 9);
  var tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Translucent chain-link panel texture (diamond mesh).
function fenceTexture() {
  var W = 256, H = 96;
  var cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  var g = cv.getContext('2d');
  g.clearRect(0, 0, W, H);
  g.strokeStyle = 'rgba(210,220,228,0.85)'; g.lineWidth = 1.5;
  var s = 16;
  for (var d = -H; d < W; d += s) {
    g.beginPath(); g.moveTo(d, 0); g.lineTo(d + H, H); g.stroke();
    g.beginPath(); g.moveTo(d + H, 0); g.lineTo(d, H); g.stroke();
  }
  var tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// A simple low-poly tree: a tapered trunk plus a couple of rounded canopies.
function makeTree(scale) {
  var grp = new THREE.Group();
  var trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 1 });
  var trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, 1.6, 7), trunkMat);
  trunk.position.y = 0.8; // no castShadow: trees sit outside the shadow frustum
  grp.add(trunk);
  // two greens so the foliage doesn't read as one flat blob
  var greens = [0x3f8a3a, 0x4fa044];
  var blobs = [[0, 1.9, 0, 0.95], [0.45, 1.7, 0.2, 0.7], [-0.4, 1.75, -0.2, 0.65]];
  for (var i = 0; i < blobs.length; i++) {
    var b = blobs[i];
    var leaf = new THREE.Mesh(
      new THREE.SphereGeometry(b[3], 8, 6),
      new THREE.MeshStandardMaterial({ color: greens[i % 2], roughness: 0.9, flatShading: true })
    );
    leaf.position.set(b[0], b[1], b[2]);
    grp.add(leaf);
  }
  grp.scale.setScalar(scale || 1);
  return grp;
}

function addScenery(scene) {
  var fx = C.HALF_W + 2.6, fz = C.HALF_L + 3.4, fh = 2.2;
  var fenceMat = new THREE.MeshBasicMaterial({
    map: fenceTexture(), transparent: true, opacity: 0.5,
    side: THREE.DoubleSide, depthWrite: false
  });
  var railMat = new THREE.MeshStandardMaterial({ color: 0x9aa6ad, metalness: 0.5, roughness: 0.5 });
  // Four fence sides: a mesh panel between a top + bottom rail, with posts.
  function side(cx, cz, len, horiz) {
    var grp = new THREE.Group();
    var panel = new THREE.Mesh(new THREE.PlaneGeometry(len, fh), fenceMat);
    panel.position.y = fh / 2;
    if (!horiz) panel.rotation.y = Math.PI / 2;
    grp.add(panel);
    [0.06, fh - 0.02].forEach(function (ry) {
      var rail = new THREE.Mesh(
        new THREE.BoxGeometry(horiz ? len : 0.05, 0.05, horiz ? 0.05 : len), railMat);
      rail.position.y = ry; grp.add(rail);
    });
    var posts = Math.max(2, Math.round(len / 3));
    for (var i = 0; i <= posts; i++) {
      var t = i / posts - 0.5;
      var post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, fh, 6), railMat);
      post.position.set(horiz ? t * len : 0, fh / 2, horiz ? 0 : t * len);
      grp.add(post);
    }
    grp.position.set(cx, 0, cz);
    scene.add(grp);
  }
  side(0, fz, 2 * fx, true);   side(0, -fz, 2 * fx, true);
  side(fx, 0, 2 * fz, false);  side(-fx, 0, 2 * fz, false);

  // Trees scattered around the park, outside the fence. Fixed layout.
  var spots = [
    [-fx - 3.5, fz + 2, 1.2], [fx + 4, fz + 1, 1.4], [-fx - 5, 0, 1.1],
    [fx + 5.5, -2, 1.3], [-fx - 4, -fz - 2, 1.25], [fx + 3.5, -fz - 3, 1.0],
    [-fx - 2, -fz - 5, 1.15], [fx + 2, fz + 5, 1.05], [0, fz + 6, 1.5],
    [-2.5, -fz - 6, 1.35], [fx + 7, fz + 5, 1.2], [-fx - 7, fz + 4, 1.1]
  ];
  for (var i = 0; i < spots.length; i++) {
    var sp = spots[i], tree = makeTree(sp[2]);
    tree.position.set(sp[0], 0, sp[1]);
    tree.rotation.y = i * 1.7;
    scene.add(tree);
  }
}

export function build(scene, tod) {
  var p = TOD_PRESETS[tod] || TOD_PRESETS.day;
  var handles = { lights: {} };

  // --- Sky + fog ---
  scene.background = new THREE.Color(p.bgColor);
  scene.fog = new THREE.Fog(p.fogColor, p.fogNear, p.fogFar);
  var skyGeo = new THREE.SphereGeometry(150, 32, 16);
  var skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: { top: { value: new THREE.Color(p.skyTop) }, bot: { value: new THREE.Color(p.skyBot) } },
    vertexShader: 'varying vec3 vP; void main(){ vP=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader: 'varying vec3 vP; uniform vec3 top; uniform vec3 bot; void main(){ float h=clamp(normalize(vP).y,0.0,1.0); gl_FragColor=vec4(mix(bot,top,h),1.0);}'
  });
  scene.add(new THREE.Mesh(skyGeo, skyMat));

  // --- Ground apron (darker grassy park lawn; textured court sits on top) ---
  var apron = new THREE.Mesh(
    new THREE.PlaneGeometry(120, 120),
    new THREE.MeshStandardMaterial({ color: 0x162b10, roughness: 1 })
  );
  apron.rotation.x = -Math.PI / 2; apron.position.y = -0.01; apron.receiveShadow = true;
  scene.add(apron);

  // surrounding court-margin band (darker teal-green)
  var surround = new THREE.Mesh(
    new THREE.PlaneGeometry(2 * C.HALF_W + 6, 2 * C.HALF_L + 6),
    new THREE.MeshStandardMaterial({ color: 0x0a2a1e, roughness: 0.95 })
  );
  surround.rotation.x = -Math.PI / 2; surround.position.y = 0.0; surround.receiveShadow = true;
  scene.add(surround);

  // --- Court surface ---
  var court = new THREE.Mesh(
    new THREE.PlaneGeometry(2 * C.HALF_W, 2 * C.HALF_L),
    new THREE.MeshStandardMaterial({ map: courtTexture({ court: p.court, kitchen: p.kitchen }), roughness: 0.7, metalness: 0.05 })
  );
  court.rotation.x = -Math.PI / 2; court.position.y = 0.012; court.receiveShadow = true;
  scene.add(court);
  handles.court = court;

  // --- Net ---
  var netGroup = new THREE.Group();
  var postMat = new THREE.MeshStandardMaterial({ color: 0x20242c, metalness: 0.6, roughness: 0.4 });
  [-1, 1].forEach(function (s) {
    var post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, C.NET_H_POST + 0.08, 12), postMat);
    post.position.set(s * C.POST_X, (C.NET_H_POST) / 2, 0); post.castShadow = true;
    netGroup.add(post);
  });
  var netMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(2 * C.POST_X, C.NET_H_POST, 24, 4),
    new THREE.MeshStandardMaterial({ map: netTexture(), transparent: true, side: THREE.DoubleSide, depthWrite: false })
  );
  // sag the net slightly in the middle
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
  handles.net = netGroup;

  // --- Park surroundings: a low chain-link fence + scattered trees. ---
  addScenery(scene);

  // --- Lighting ---
  var hemi = new THREE.HemisphereLight(p.hemiSky, p.hemiGnd, p.hemiInt);
  scene.add(hemi);
  var sun = new THREE.DirectionalLight(p.sunColor, p.sunInt);
  sun.position.set(p.sunPos[0], p.sunPos[1], p.sunPos[2]);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.near = 1; sun.shadow.camera.far = 50;
  sun.shadow.camera.left = -10; sun.shadow.camera.right = 10;
  sun.shadow.camera.top = 12; sun.shadow.camera.bottom = -12;
  sun.shadow.bias = -0.0004;
  scene.add(sun);
  handles.lights.sun = sun;
  var fill = new THREE.DirectionalLight(p.fillColor, p.fillInt);
  fill.position.set(-6, 8, -6);
  scene.add(fill);

  // --- Ball --- deep, saturated neon "optic green" (Vulcan-style).
  var ballMat = new THREE.MeshStandardMaterial({
    color: 0x4fc800, roughness: 0.62, metalness: 0.0,
    emissive: 0x3a9e00, emissiveIntensity: 0.55
  });
  var ballMesh = new THREE.Mesh(new THREE.SphereGeometry(C.BALL_R * 1.5, 20, 16), ballMat);
  ballMesh.castShadow = true;
  // tight, saturated green glow shell so the ball pops without a pale halo
  var glow = new THREE.Mesh(
    new THREE.SphereGeometry(C.BALL_R * 2.2, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0x6cff14, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false })
  );
  ballMesh.add(glow);
  scene.add(ballMesh);
  handles.ballMesh = ballMesh;

  // contact shadow blob under ball (fakes soft shadow on the move)
  var blob = new THREE.Mesh(
    new THREE.CircleGeometry(C.BALL_R * 2.2, 16),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3 })
  );
  blob.rotation.x = -Math.PI / 2; blob.position.y = 0.02;
  scene.add(blob);
  handles.ballBlob = blob;

  // ball trail (line that follows recent positions)
  var trailGeo = new THREE.BufferGeometry();
  var TRAIL = 18;
  trailGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL * 3), 3));
  var trail = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({ color: 0x66e000, transparent: true, opacity: 0.5 }));
  trail.frustumCulled = false;
  scene.add(trail);
  handles.trail = trail; handles.trailLen = TRAIL; handles.trailBuf = [];

  return handles;
}
