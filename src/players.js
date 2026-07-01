/* ============================================================================
 * players.js — Friendly, rounded "Mii"-style players built from primitives.
 * Ported from the original Picklelife js/players.js (ESM Three). Optional
 * authored player models can layer over this rig, but the primitive rig remains
 * the gameplay fallback and paddle/contact timing driver.
 *
 * Swing design (modeled on arcade tennis): the swing is a horizontal cross-body
 * arc driven by an isolated UPPER-BODY twist (upper.rotation.y) so it reads like
 * a real groundstroke, not a vertical pump. Contact happens mid-arc. The paddle
 * extends BEYOND the hand (continuation of the forearm).
 *
 * makePlayer(opts) -> { object, rig, update(dt,state), swing(type),
 *                       isSwinging(), atContact(), contactT, paddleWorld }
 * ==========================================================================*/
'use strict';

import * as THREE from 'three';
import { cloneModelScene } from './assets.js';

function pivot() { return new THREE.Object3D(); }
function sphere(r, mat, sx, sy, sz) {
  var m = new THREE.Mesh(new THREE.SphereGeometry(r, 18, 14), mat);
  if (sx !== undefined) m.scale.set(sx, sy, sz);
  m.castShadow = true; return m;
}
function limb(rad, len, mat) {
  var g = new THREE.Group();
  var cyl = new THREE.Mesh(new THREE.CylinderGeometry(rad, rad * 0.92, len, 12), mat);
  cyl.position.y = -len / 2; cyl.castShadow = true; g.add(cyl);
  var capTop = new THREE.Mesh(new THREE.SphereGeometry(rad, 12, 10), mat); capTop.castShadow = true; g.add(capTop);
  var capBot = new THREE.Mesh(new THREE.SphereGeometry(rad * 0.92, 12, 10), mat);
  capBot.position.y = -len; capBot.castShadow = true; g.add(capBot);
  return g;
}
function ease(t) { return t * t * (3 - 2 * t); } // smoothstep

function heightScale(kind) {
  if (kind === 'short') return 0.96;
  if (kind === 'tall') return 1.14;
  if (kind === 'tower') return 1.22;
  return 1.0;
}

function buildScale(kind) {
  if (kind === 'slim') return 0.9;
  return 1.0;
}

function box(w, h, d, mat) {
  var mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.castShadow = true;
  return mesh;
}

function colorValue(value, fallback) {
  return value !== undefined ? value : fallback;
}

function slotColor(slot, opts) {
  if (slot === 'skin') return colorValue(opts.skin, 0xf0c089);
  if (slot === 'jersey') return colorValue(opts.jersey, 0x2b6cff);
  if (slot === 'shorts') return colorValue(opts.shorts, 0x16213e);
  if (slot === 'shoe') return colorValue(opts.shoe, 0xffffff);
  if (slot === 'hair') return colorValue(opts.hair, 0x3a2417);
  if (slot === 'paddle') return colorValue(opts.paddle, 0xff5a3c);
  if (slot === 'headband') return colorValue(opts.headband || opts.jersey, 0xffffff);
  return null;
}

function materialSlot(mesh, mat) {
  var tags = [
    mesh && mesh.name,
    mat && mat.name,
    mesh && mesh.userData && (mesh.userData.slot || mesh.userData.materialSlot)
  ].join(' ').toLowerCase();
  if (/jersey|shirt|top|torso|team/.test(tags)) return 'jersey';
  if (/short|pants|bottom|skirt/.test(tags)) return 'shorts';
  if (/shoe|sneaker|sock/.test(tags)) return 'shoe';
  if (/hair|brow/.test(tags)) return 'hair';
  if (/paddle|racket|racquet/.test(tags)) return 'paddle';
  if (/band|cap|visor|hat/.test(tags)) return 'headband';
  if (/skin|head|face|hand|arm|leg/.test(tags)) return 'skin';
  return null;
}

function tintMaterial(mat, slot, opts) {
  if (!mat || !mat.color) return mat;
  var color = slotColor(slot, opts);
  if (color === null) return mat;
  var next = mat.clone();
  next.color.set(color);
  return next;
}

function applyModelMaterials(root, opts) {
  root.traverse(function (node) {
    if (!node.isMesh) return;
    node.castShadow = true;
    node.receiveShadow = true;
    if (Array.isArray(node.material)) {
      node.material = node.material.map(function (mat) {
        return tintMaterial(mat, materialSlot(node, mat), opts);
      });
    } else {
      node.material = tintMaterial(node.material, materialSlot(node, node.material), opts);
    }
  });
}

function hidePrimitiveBody(api) {
  var paddle = api.rig && api.rig.paddle;
  api.object.traverse(function (node) {
    if (!node.isMesh) return;
    var n = node;
    var keep = false;
    while (n) {
      if (n === paddle) { keep = true; break; }
      n = n.parent;
    }
    node.visible = keep;
  });
}

function applyTransformFromArray(obj, prop, value) {
  if (!value || value.length < 3) return;
  obj[prop].set(value[0], value[1], value[2]);
}

function configureAuthoredModel(model, item) {
  item = item || {};
  if (item.playerOffset) applyTransformFromArray(model, 'position', item.playerOffset);
  if (item.playerRotation) applyTransformFromArray(model, 'rotation', item.playerRotation);
  if (item.playerScale !== undefined) {
    if (Array.isArray(item.playerScale)) applyTransformFromArray(model, 'scale', item.playerScale);
    else model.scale.setScalar(item.playerScale);
  }
}

function clipKey(name) {
  name = String(name || '').toLowerCase();
  if (/idle|stand|ready/.test(name)) return 'idle';
  if (/run|jog|walk|move/.test(name)) return 'run';
  if (/backhand|bh/.test(name)) return 'bh';
  if (/forehand|fh|drive|swing/.test(name)) return 'fh';
  if (/serve/.test(name)) return 'serve';
  if (/smash|overhead/.test(name)) return 'smash';
  return '';
}

function collectAnimationClips(opts, modelRecord) {
  var out = {};
  function addClip(clip) {
    var key = clipKey(clip && clip.name);
    if (key && !out[key]) out[key] = clip;
  }
  var gltf = modelRecord && modelRecord.payload;
  ((gltf && gltf.animations) || []).forEach(addClip);
  if (opts.assets && opts.assets.animations) {
    Object.keys(opts.assets.animations).forEach(function (key) {
      var record = opts.assets.animations[key];
      var payload = record && record.payload;
      ((payload && payload.animations) || []).forEach(addClip);
    });
  }
  return out;
}

function installAuthoredModel(api, opts) {
  var assets = opts.assets;
  var key = opts.playerModelKey || 'player-base';
  var record = assets && assets.getModel ? assets.getModel(key) : null;
  var model = cloneModelScene(record);
  if (!model) return api;

  model.name = 'AuthoredPlayerModel';
  configureAuthoredModel(model, record.item);
  applyModelMaterials(model, opts);
  hidePrimitiveBody(api);
  api.object.add(model);

  var mixer = new THREE.AnimationMixer(model);
  var clips = collectAnimationClips(opts, record);
  var actions = {};
  Object.keys(clips).forEach(function (name) {
    actions[name] = mixer.clipAction(clips[name]);
    actions[name].clampWhenFinished = false;
  });

  api.authored = {
    model: model,
    mixer: mixer,
    actions: actions,
    active: null,
    locomotion: null
  };

  var baseUpdate = api.update;
  var baseSwing = api.swing;

  function playLoop(name) {
    var action = actions[name];
    if (!action || api.authored.locomotion === action) return;
    action.reset().setLoop(THREE.LoopRepeat, Infinity).fadeIn(0.12).play();
    if (api.authored.locomotion) api.authored.locomotion.fadeOut(0.12);
    api.authored.locomotion = action;
  }

  function playOnce(name) {
    var action = actions[name] || actions.fh;
    if (!action) return;
    action.reset().setLoop(THREE.LoopOnce, 1).fadeIn(0.04).play();
    if (api.authored.active && api.authored.active !== action) api.authored.active.fadeOut(0.05);
    api.authored.active = action;
  }

  api.update = function (dt, st) {
    baseUpdate.call(this, dt, st);
    if (this.authored && this.authored.mixer) {
      this.authored.mixer.update(dt);
      if (!this.isSwinging()) playLoop(st && st.speed > 0.15 ? 'run' : 'idle');
    }
  };

  api.swing = function (type) {
    baseSwing.call(this, type);
    playOnce(type || 'fh');
  };

  return api;
}

export function makePrimitivePlayer(opts) {
  opts = opts || {};
  var skin = new THREE.MeshStandardMaterial({ color: opts.skin || 0xf0c089, roughness: 0.7 });
  var jersey = new THREE.MeshStandardMaterial({ color: opts.jersey || 0x2b6cff, roughness: 0.55 });
  var shorts = new THREE.MeshStandardMaterial({ color: opts.shorts || 0x16213e, roughness: 0.7 });
  var shoe = new THREE.MeshStandardMaterial({ color: opts.shoe || 0xffffff, roughness: 0.5 });
  var hair = new THREE.MeshStandardMaterial({ color: opts.hair || 0x3a2417, roughness: 0.9 });
  var bodyW = buildScale(opts.build);
  var limbW = 0.95 + (bodyW - 0.9) * 0.5;
  var shoulderW = 0.96 + (bodyW - 0.9) * 0.4;
  var hipW = 0.98 + (bodyW - 0.9) * 0.3;
  var tall = heightScale(opts.height);

  var root3 = new THREE.Group();
  root3.scale.y = tall;
  root3.position.y = -0.285 * (1 - tall);
  var pelvis = pivot(); pelvis.position.y = 0.62; root3.add(pelvis);

  // upper body pivot (torso+head+arms) so the swing twist doesn't rotate legs
  var upper = pivot(); pelvis.add(upper);

  var hips = sphere(0.18, shorts, 1.05 * hipW, 0.7, 0.9); hips.position.y = 0.02; pelvis.add(hips);
  var torso = sphere(0.21, jersey, bodyW, 1.15, 0.85);
  torso.position.y = 0.30; upper.add(torso);

  var neck = pivot(); neck.position.y = 0.52; upper.add(neck);
  // short neck so the head reads as attached, not a balloon on the shoulders
  var neckCyl = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.07, 0.12, 10), skin);
  neckCyl.position.y = 0.06; neckCyl.castShadow = true; neck.add(neckCyl);
  // head: smaller than the torso, slightly egg-shaped (taller than wide)
  var head = sphere(0.185, skin, 1.0, 1.08, 0.96); head.position.y = 0.25; neck.add(head);
  // Hair + headwear stay attached to the head group so the swing twist never
  // shears them away from the face.
  var hairStyle = opts.hairStyle || 'short';
  var headwear = opts.headwear || 'none';
  var shortHair = new THREE.Mesh(new THREE.SphereGeometry(0.192, 20, 16, 0, Math.PI * 2, 0, Math.PI * 0.62), hair);
  shortHair.position.y = 0.27; shortHair.scale.set(1.0, 1.05, 1.0); shortHair.castShadow = true; neck.add(shortHair);
  function hairPanel(x, y, z, w, h, d) {
    var panel = box(w, h, d, hair);
    panel.position.set(x, y, z);
    neck.add(panel);
    return panel;
  }
  if (hairStyle === 'short') {
    hairPanel(-0.18, 0.205, 0.02, 0.035, 0.08, 0.10);
    hairPanel(0.18, 0.205, 0.02, 0.035, 0.08, 0.10);
  }
  if (hairStyle === 'long' || hairStyle === 'ponytail') {
    hairPanel(-0.19, 0.175, 0.01, 0.05, 0.20, 0.12);
    hairPanel(0.19, 0.175, 0.01, 0.05, 0.20, 0.12);
    var backHair = box(0.22, hairStyle === 'ponytail' ? 0.18 : 0.22, hairStyle === 'ponytail' ? 0.08 : 0.055, hair);
    backHair.position.set(0, hairStyle === 'ponytail' ? 0.15 : 0.14, hairStyle === 'ponytail' ? -0.12 : -0.15);
    neck.add(backHair);

    if (hairStyle === 'ponytail') {
      var tieMat = new THREE.MeshStandardMaterial({ color: opts.headband || opts.jersey || 0xffffff, roughness: 0.5 });
      var tie = box(0.09, 0.028, 0.035, tieMat);
      tie.position.set(0.02, 0.17, -0.185);
      neck.add(tie);

      var pony = sphere(0.075, hair, 0.62, 1.2, 0.62);
      pony.position.set(0.035, 0.10, -0.205);
      pony.castShadow = true; neck.add(pony);
    }
  }
  if (headwear === 'cap') {
    var capMat = new THREE.MeshStandardMaterial({ color: opts.headband || opts.jersey || 0xffffff, roughness: 0.55 });
    var capCrown = new THREE.Mesh(new THREE.SphereGeometry(0.198, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.46), capMat);
    capCrown.position.y = 0.325;
    capCrown.scale.set(1.04, 0.72, 1.02);
    capCrown.castShadow = true; neck.add(capCrown);

    var brim = box(0.22, 0.026, 0.10, capMat);
    brim.position.set(0, 0.245, 0.215);
    brim.castShadow = true; neck.add(brim);
  } else if (headwear === 'headband') {
    var bandMat = new THREE.MeshStandardMaterial({ color: opts.headband || 0xffffff, roughness: 0.5 });
    var frontBand = box(0.31, 0.028, 0.035, bandMat);
    frontBand.position.set(0, 0.235, 0.165); neck.add(frontBand);
    var leftBand = box(0.035, 0.028, 0.16, bandMat);
    leftBand.position.set(-0.17, 0.235, 0.045); neck.add(leftBand);
    var rightBand = box(0.035, 0.028, 0.16, bandMat);
    rightBand.position.set(0.17, 0.235, 0.045); neck.add(rightBand);
    var rearBand = box(0.28, 0.028, 0.035, bandMat);
    rearBand.position.set(0, 0.235, -0.12); neck.add(rearBand);
  }

  var eyeMat = new THREE.MeshStandardMaterial({ color: 0x20242c });
  [-0.062, 0.062].forEach(function (dx) {
    var e = new THREE.Mesh(new THREE.SphereGeometry(0.021, 10, 8), eyeMat);
    e.position.set(dx, 0.27, 0.165); neck.add(e);
  });
  var nose = sphere(0.022, skin); nose.position.set(0, 0.235, 0.182); neck.add(nose);

  function buildArm(side) {
    var shoulder = pivot();
    shoulder.position.set(side * 0.20 * shoulderW, 0.40, 0); upper.add(shoulder);
    // deltoid: a jersey-coloured shoulder cap that bridges torso -> arm so the
    // limb never looks detached when it swings out.
    var deltoid = sphere(0.096 * shoulderW, jersey); shoulder.add(deltoid);
    var up = limb(0.07 * limbW, 0.21, skin); shoulder.add(up);
    var elbow = pivot(); elbow.position.y = -0.21; shoulder.add(elbow);
    var elbowBall = sphere(0.063 * limbW, skin); elbow.add(elbowBall); // covers the joint
    var fore = limb(0.062 * limbW, 0.19, skin); elbow.add(fore);
    var hand = sphere(0.078 * limbW, skin); hand.position.y = -0.19; elbow.add(hand);
    return { shoulder: shoulder, elbow: elbow, hand: hand };
  }
  // The model's face is on +z, so the anatomical RIGHT arm is on local -x.
  // The paddle arm (armR) lives there so the player is right-handed.
  var armL = buildArm(1);
  var armR = buildArm(-1);

  // paddle: an elongated rounded pickleball face (taller than wide) on a short
  // grip, extending BEYOND the hand down the forearm axis.
  var paddle = new THREE.Group();
  var gripMat = new THREE.MeshStandardMaterial({ color: 0x23262e, roughness: 0.6 });
  var grip = new THREE.Mesh(new THREE.CylinderGeometry(0.021, 0.023, 0.12, 10), gripMat);
  grip.position.y = -0.04; paddle.add(grip);
  var throat = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.034, 0.06, 10), gripMat);
  throat.position.y = -0.12; paddle.add(throat); // connects grip to the face
  var faceMat = new THREE.MeshStandardMaterial({ color: opts.paddle || 0xff5a3c, roughness: 0.4, metalness: 0.05 });
  var blade = new THREE.Mesh(new THREE.CylinderGeometry(0.115, 0.115, 0.022, 28), faceMat);
  blade.rotation.x = Math.PI / 2;   // flat face along the forearm swing plane
  blade.scale.set(0.84, 1.12, 1);   // oval: a touch narrow, a touch tall = paddle
  blade.position.y = -0.22;         // beyond the hand
  blade.castShadow = true; paddle.add(blade);
  paddle.position.y = -0.19;        // mount at the hand
  armR.elbow.add(paddle);
  var bladeRef = blade;

  function buildLeg(side) {
    var hip = pivot(); hip.position.set(side * 0.11 * hipW, -0.05, 0); pelvis.add(hip);
    var thigh = limb(0.083 * limbW, 0.26, skin); hip.add(thigh);
    var knee = pivot(); knee.position.y = -0.26; hip.add(knee);
    var shin = limb(0.07 * limbW, 0.26, skin); knee.add(shin);
    var foot = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.07, 0.22), shoe);
    foot.position.set(0, -0.30, 0.05); foot.castShadow = true; knee.add(foot);
    var toe = sphere(0.05, shoe, 1.2, 0.7, 1); toe.position.set(0, -0.30, 0.15); knee.add(toe);
    return { hip: hip, knee: knee, foot: foot };
  }
  var legL = buildLeg(-1);
  var legR = buildLeg(1);

  var api = {
    object: root3,
    rig: { pelvis: pelvis, upper: upper, armL: armL, armR: armR, legL: legL, legR: legR, paddle: paddle },
    _t: 0, _stride: 0, _swing: 0, _swingDur: 0.44, _swingType: 'fh', _facing: 0,
    contactT: 0.5,                 // fraction of swing where the paddle meets the ball
    paddleWorld: new THREE.Vector3()
  };

  api.update = function (dt, st) {
    st = st || {};
    this._t += dt;
    var speed = st.speed || 0, moving = speed > 0.15, t = this._t;

    if (st.facing !== undefined) {
      this._facing += angDelta(this._facing, st.facing) * Math.min(1, dt * 10);
      root3.rotation.y = this._facing;
    }

    // Distance-based stride: the leg cycle advances with ground actually
    // covered (not wall-clock time), so the feet never "run in place".
    this._stride += speed * dt * 2.9;
    var gait = moving ? Math.sin(this._stride) : Math.sin(t * 2) * 0.1;
    var amp = moving ? Math.min(0.85, 0.3 + speed * 0.12) : 0.06;
    // a small vertical bounce timed to each footfall (twice per cycle)
    var bob = Math.sin(t * 2) * 0.012;
    pelvis.position.y = 0.62 + bob + (moving ? Math.abs(Math.sin(this._stride)) * 0.035 : 0);
    legL.hip.rotation.x = gait * amp;
    legR.hip.rotation.x = -gait * amp;
    legL.knee.rotation.x = Math.max(0, -gait) * amp * 1.3 + 0.08;
    legR.knee.rotation.x = Math.max(0, gait) * amp * 1.3 + 0.08;
    armL.shoulder.rotation.x = -gait * amp * 0.7;
    armL.shoulder.rotation.z = 0.18; armL.elbow.rotation.x = -0.5; // off arm splays out (+x); elbow flexes FORWARD (-x rot)
    pelvis.rotation.x = moving ? -0.08 : 0;

    if (this._swing > 0) {
      this._swing -= dt;
      var raw = 1 - Math.max(0, this._swing) / this._swingDur; // 0..1 linear
      var p = ease(raw);                                       // 0..1 eased
      var arc = Math.sin(raw * Math.PI);                       // 0->1->0 (peak mid)
      // "extend" peaks slightly BEFORE mid so the arm is straightest right at
      // the contact point (contactT ~0.45), not at the midpoint of the arc.
      var ext = Math.sin(Math.min(1, raw / this.contactT) * Math.PI * 0.5); // 0->1 by contact
      if (this._swingType === 'serve') {
        // UNDERHAND serve (pickleball-legal): a pendulum that starts low and
        // behind the hip, swings FORWARD through a low contact (~waist), and
        // follows through up to the chest — paddle under the ball throughout.
        upper.rotation.y = 0;
        armR.shoulder.rotation.z = -0.22;            // a touch out to the right
        armR.shoulder.rotation.x = 0.80 - p * 1.95;  // back-low -> forward-up
        armR.elbow.rotation.x = -0.60 + arc * 0.45;  // bent forward, extends at contact
      } else if (this._swingType === 'bh') {
        // BACKHAND: torso loads to the right (paddle cocked across to the left
        // side), then unwinds left; the arm reaches across then extends out
        // front-left, finishing high. Cross-body comes from the twist.
        upper.rotation.y = 0.75 - p * 1.5;                  // loaded right -> follow left
        armR.shoulder.rotation.z = 0.55 - p * 1.05;         // across-left -> opens out
        armR.shoulder.rotation.x = 0.35 - p * 1.25 - arc * 0.4; // back -> reach out -> up
        armR.elbow.rotation.x = -1.15 + ext * 1.0;          // bent forward -> straight at contact
      } else {
        // FOREHAND: torso loads to the right (paddle cocked back on the right),
        // then unwinds hard to the left; the forward-raised arm is swept across
        // the body by the twist and EXTENDS straight through contact, finishing
        // high on the left.
        upper.rotation.y = -0.85 + p * 1.6;                 // loaded right -> follow left
        armR.shoulder.rotation.z = -0.55 + p * 1.1;         // out right -> across to left
        armR.shoulder.rotation.x = 0.35 - p * 1.25 - arc * 0.4; // back -> reach out -> up
        armR.elbow.rotation.x = -1.2 + ext * 1.05;          // bent forward -> straight at contact
      }
    } else {
      // ready: paddle up & forward, body square
      upper.rotation.y += (0 - upper.rotation.y) * Math.min(1, dt * 12);
      armR.shoulder.rotation.x = -0.85 - (moving ? -gait * amp * 0.3 : 0);
      armR.shoulder.rotation.z = -0.18;  // paddle held up in front, slightly right
      armR.elbow.rotation.x = -1.05;     // elbow flexes FORWARD so the paddle is in front
    }

    bladeRef.getWorldPosition(this.paddleWorld);
  };

  api.swing = function (type) { this._swingType = type || 'fh'; this._swing = this._swingDur; };
  api.isSwinging = function () { return this._swing > 0; };
  // true during the brief contact window around contactT of the swing
  api.atContact = function () {
    var p = 1 - Math.max(0, this._swing) / this._swingDur;
    return this._swing > 0 && Math.abs(p - this.contactT) < 0.12;
  };
  return api;
}

export function makePlayer(opts) {
  opts = opts || {};
  return installAuthoredModel(makePrimitivePlayer(opts), opts);
}

function angDelta(a, b) {
  var d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
