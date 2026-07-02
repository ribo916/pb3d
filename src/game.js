/* ============================================================================
 * game.js — Orchestrator. Wires Three.js rendering to the pure logic layer,
 * runs the match state machine, camera, players, ball and HUD.
 * Ported from the original Picklelife js/game.js (ESM). Audio, character
 * skinning, venues/night mode and the 2D-shell hooks are dropped; the doubles
 * gameplay, hit model, momentum aim and camera are preserved 1:1.
 * ==========================================================================*/
'use strict';

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import * as Physics from './physics.js';
import * as Rules from './rules.js';
import * as AI from './ai.js';
import * as Shots from './shots.js';
import * as Scene from './scene.js';
import { makePlayer } from './players.js';
import { makeCamera, updateCamera } from './camera.js';
import { clamp, dist2D } from './utils.js';
import { HIT, PHYS, STABILITY, POWER_CAP, SPECIALTY } from './constants.js';

const C = Physics.COURT;
Rules.setGeometry(C.KITCHEN, C.HALF_W);

export const STATE = { MENU: 'menu', SERVE: 'serve', RALLY: 'rally', POINT: 'point', OVER: 'over' };

const DIFFICULTY_META = {
  family: { label: 'FAMILY', tint: '#8a8f78' },
  easy:   { label: 'DUPR 4.0', tint: '#2bd47a' },
  normal: { label: 'DUPR 4.5', tint: '#ffb43c' },
  hard:   { label: 'DUPR 5.0', tint: '#e23b5a' }
};

function makeHitFxTexture() {
  var cv = document.createElement('canvas');
  cv.width = 96;
  cv.height = 96;
  var g = cv.getContext('2d');
  g.clearRect(0, 0, cv.width, cv.height);
  g.strokeStyle = 'rgba(255,255,255,0.96)';
  g.lineWidth = 8;
  g.beginPath();
  g.arc(48, 48, 25, 0, Math.PI * 2);
  g.stroke();
  g.strokeStyle = 'rgba(70,220,255,0.75)';
  g.lineWidth = 4;
  g.beginPath();
  g.arc(48, 48, 36, 0.25, Math.PI * 1.7);
  g.stroke();
  var tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeNetFxTexture() {
  var cv = document.createElement('canvas');
  cv.width = 96;
  cv.height = 96;
  var g = cv.getContext('2d');
  g.clearRect(0, 0, cv.width, cv.height);
  g.strokeStyle = 'rgba(255,255,255,0.92)';
  g.lineWidth = 7;
  g.beginPath();
  g.moveTo(28, 48); g.lineTo(68, 48);
  g.moveTo(48, 28); g.lineTo(48, 68);
  g.stroke();
  g.strokeStyle = 'rgba(141,255,66,0.68)';
  g.lineWidth = 4;
  g.beginPath();
  g.moveTo(34, 34); g.lineTo(62, 62);
  g.moveTo(62, 34); g.lineTo(34, 62);
  g.stroke();
  var tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function renderQuality(isMobile) {
  var forced = '';
  try {
    forced = new URLSearchParams(window.location.search).get('quality') ||
      window.localStorage.getItem('pb3d.renderQuality') || '';
  } catch (e) {}
  forced = String(forced).toLowerCase();
  var level = (forced === 'low' || forced === 'medium' || forced === 'high')
    ? forced : (isMobile ? 'medium' : 'high');
  if (level === 'low') return {
    level: level, pixelRatio: 1, shadowMap: 1024, bloom: false, antialias: false
  };
  if (level === 'medium') return {
    level: level, pixelRatio: 1.5, shadowMap: 1024, bloom: false, antialias: true
  };
  return {
    level: level, pixelRatio: 2, shadowMap: 2048, bloom: true, antialias: true
  };
}

function normalizeDifficulty(d) {
  if (d === '4.0' || d === 'beginner' || d === 'easy') return 'easy';
  if (d === '4.5' || d === 'intermediate' || d === 'normal') return 'normal';
  if (d === '5.0' || d === 'advanced' || d === 'hard') return 'hard';
  if (DIFFICULTY_META[d]) return d;
  return 'normal';
}

export function Game(opts) {
  this.opts = opts || {};
  this.canvas = opts.canvas;
  this.hud = opts.hud || null;
  this.audio = opts.audio || null;
  this.assets = opts.assets || null;
  this.difficulty = normalizeDifficulty(opts.difficulty);
  this.levelMeta = DIFFICULTY_META[this.difficulty] || DIFFICULTY_META.normal;
  this.venue = opts.venue || 'park';
  this.courtPalette = opts.courtPalette || 'blue';
  this.timeOfDay = this.venue === 'indoor' ? 'day' : (opts.timeOfDay || 'day');
  this.partnerDiff = opts.partnerDiff || null;
  this.onMatchOver = opts.onMatchOver || null;
  this.isMobile = !!opts.isMobile;
  this.state = STATE.MENU;
  this.excitement = 0;
  this.cameraShake = 0;
  this.renderQuality = renderQuality(this.isMobile);
  var CAM_MAP = { broadcast: 0, follow: 1, topdown: 2 };
  this.camMode = CAM_MAP[opts.cameraMode] !== undefined ? CAM_MAP[opts.cameraMode] : 1;
  this.msgTimer = 0;
  this.serveDelay = 0;
  this.pointPause = 0;
  this._initThree();
  this._initWorld();
  this._bindResize();
}

Game.prototype._initThree = function () {
  THREE.ColorManagement.enabled = true;
  var renderer = new THREE.WebGLRenderer({
    canvas: this.canvas,
    antialias: this.renderQuality.antialias,
    alpha: false,
    powerPreference: 'high-performance'
  });
  renderer.setPixelRatio(Math.min(this.renderQuality.pixelRatio, window.devicePixelRatio || 1));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.06;
  this.renderer = renderer;

  this.scene = new THREE.Scene();
  var rig = makeCamera(this._aspect());
  this.camRig = rig;
  this.camera = rig.cam;

  if (this.renderQuality.bloom) {
    var size = new THREE.Vector2(window.innerWidth || 1280, window.innerHeight || 720);
    var composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(this.scene, this.camera));
    var bloom = new UnrealBloomPass(size, 0.18, 0.28, 0.86);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
    this.composer = composer;
  }
};

Game.prototype._aspect = function () {
  return (this.canvas.clientWidth || window.innerWidth) / (this.canvas.clientHeight || window.innerHeight);
};

Game.prototype._initWorld = function () {
  this.world = Scene.build(this.scene, {
    venue: this.venue,
    courtPalette: this.courtPalette,
    timeOfDay: this.timeOfDay,
    quality: this.renderQuality,
    assets: this.assets
  });
  this._syncOverhead(); // honor an initial Top-Down camMode
  this.ball = Physics.makeBall();

  // DOUBLES roster: near team = human (slot 0) + CPU partner (slot 1);
  // far team = two CPUs. Fixed team palettes so all four read apart.
  var palettes = {
    nearYou: {
      jersey: 0xff7a1f, shorts: 0x20283c, paddle: 0x2bd4ff, shoe: 0xf6f8ff,
      skin: 0xe4bf9f, hair: 0x241814, height: 'tall', build: 'average',
      hairStyle: 'short', headwear: 'headband', headband: 0x2bd4ff,
      playerModelKey: 'player-human-v1'
    },
    nearMate: {
      jersey: 0x21bdb0, shorts: 0x20283c, paddle: 0xffa53c, shoe: 0xf8fbff,
      skin: 0xe8c3ab, hair: 0x5b3724, height: 'medium', build: 'average',
      hairStyle: 'long', headwear: 'none', playerModelKey: 'player-partner-v1'
    },
    farA: {
      jersey: 0xf14668, shorts: 0x30111e, paddle: 0x36d399, shoe: 0xf9fbff,
      skin: 0xf0cbb2, hair: 0xd5bb58, height: 'tower', build: 'slim',
      hairStyle: 'short', headwear: 'cap', headband: 0xf4f5f6,
      playerModelKey: 'player-poc'
    },
    farB: {
      jersey: 0xff7aa8, shorts: 0x55233a, paddle: 0xc8ff65, shoe: 0xfffbff,
      skin: 0xedc6b0, hair: 0x4a2b22, height: 'medium', build: 'average',
      hairStyle: 'ponytail', headwear: 'none', headband: 0xffd166,
      playerModelKey: 'player-poc'
    }
  };
  this.youColor = palettes.nearYou.jersey;

  var self = this;
  function entry(team, slot, isHuman, colors) {
    var mesh = makePlayer(Object.assign({}, colors, { assets: self.assets }));
    self.scene.add(mesh.object);
    return {
      team: team, slot: slot, isHuman: isHuman, mesh: mesh,
      pos: { x: 0, z: 0 }, vel: { x: 0, z: 0 },
      ai: isHuman ? null : AI.makeAI(self.difficulty), aiSwingTimer: 0
    };
  }
  this.players = [
    entry('near', 0, true,  palettes.nearYou),
    entry('near', 1, false, palettes.nearMate),
    entry('far',  0, false, palettes.farA),
    entry('far',  1, false, palettes.farB)
  ];
  if (this.partnerDiff) this.players[1].ai = AI.makeAI(this.partnerDiff);
  this.human = this.players[0].mesh; this.humanPos = this.players[0].pos; this.humanVel = this.players[0].vel;

  // "This is YOU" — a subtle ring on the ground under players[0].
  var ringMat = new THREE.MeshBasicMaterial({ color: this.youColor, transparent: true, opacity: 0.85, depthWrite: false });
  var ring = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.055, 8, 28), ringMat);
  ring.rotation.x = -Math.PI / 2;
  this.scene.add(ring);
  this.youMarker = ring;
  var ringGlowMat = new THREE.MeshBasicMaterial({
    color: this.youColor, transparent: true, opacity: 0.18, depthWrite: false,
    blending: THREE.AdditiveBlending
  });
  var ringGlow = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.035, 8, 32), ringGlowMat);
  ringGlow.rotation.x = -Math.PI / 2;
  this.scene.add(ringGlow);
  this.youMarkerGlow = ringGlow;

  // AIM MARKER — a flat ring on the opponents' court showing where your held
  // direction will steer the shot. Hidden until it's your turn to hit.
  var aimMat = new THREE.MeshBasicMaterial({ color: 0xf7fbff, transparent: true, opacity: 0, depthWrite: false });
  var aimRing = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.05, 8, 24), aimMat);
  aimRing.rotation.x = -Math.PI / 2;
  this.scene.add(aimRing);
  this.aimMarker = aimRing;
  var aimFillMat = new THREE.MeshBasicMaterial({
    color: 0x2bd4ff, transparent: true, opacity: 0, depthWrite: false,
    blending: THREE.AdditiveBlending
  });
  var aimFill = new THREE.Mesh(new THREE.CircleGeometry(0.28, 28), aimFillMat);
  aimFill.rotation.x = -Math.PI / 2;
  this.scene.add(aimFill);
  this.aimMarkerFill = aimFill;

  this.hitFx = null;
  this.bounceFx = null;
  this.netFx = null;
  if (this.renderQuality.level !== 'low') {
    var hitFxMat = new THREE.SpriteMaterial({
      map: makeHitFxTexture(),
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    var hitFx = new THREE.Sprite(hitFxMat);
    hitFx.visible = false;
    hitFx.frustumCulled = false;
    hitFx.renderOrder = 998;
    this.scene.add(hitFx);
    this.hitFx = { mesh: hitFx, age: 0, dur: 0.18 };

    var bounceFxMat = new THREE.MeshBasicMaterial({
      color: 0xf5fbff,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    var bounceFx = new THREE.Mesh(new THREE.RingGeometry(0.18, 0.31, 32), bounceFxMat);
    bounceFx.rotation.x = -Math.PI / 2;
    bounceFx.visible = false;
    bounceFx.frustumCulled = false;
    bounceFx.renderOrder = 4;
    this.scene.add(bounceFx);
    this.bounceFx = { mesh: bounceFx, age: 0, dur: 0.24 };

    var netFxMat = new THREE.SpriteMaterial({
      map: makeNetFxTexture(),
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    var netFx = new THREE.Sprite(netFxMat);
    netFx.visible = false;
    netFx.frustumCulled = false;
    netFx.renderOrder = 997;
    this.scene.add(netFx);
    this.netFx = { mesh: netFx, age: 0, dur: 0.22 };
  }

  this.match = Rules.makeMatch({ server: 'near' });
  this.lastHitCooldown = 0;
  this.swingWindow = 0; this.swingUsed = false; this.swingType = 'fh'; this.swingAim = 0;
  this.swingPower = 'power'; this.swingShot = null;
  this._placeServe();
};

Game.prototype.setInput = function (input) { this.input = input; };

// Find a roster entry by team + slot.
Game.prototype._player = function (team, slot) {
  for (var i = 0; i < this.players.length; i++) {
    var p = this.players[i];
    if (p.team === team && p.slot === slot) return p;
  }
  return null;
};

// The world-x lane sign a player currently covers (depends on its service court).
Game.prototype._laneSign = function (p) {
  var side = (p.slot === Rules.rightSlot(this.match, p.team)) ? 'R' : 'L';
  return Rules.sideX(p.team, side);
};

// The slot on a team responsible for a given x-lane ("yours/mine").
Game.prototype._responsibleSlot = function (team, atX) {
  var sgn = ((atX !== undefined ? atX : this.ball.pos.x) >= 0) ? 1 : -1;
  for (var slot = 0; slot < 2; slot++) {
    var side = (slot === Rules.rightSlot(this.match, team)) ? 'R' : 'L';
    if (Rules.sideX(team, side) === sgn) return slot;
  }
  return 0;
};

// Doubles starting formation.
Game.prototype._formationServe = function () {
  var srv = Rules.currentServer(this.match);
  var rcv = Rules.currentReceiver(this.match);
  for (var i = 0; i < this.players.length; i++) {
    var p = this.players[i];
    var fwd = (p.team === 'near') ? 1 : -1;       // +z near, -z far
    var laneX = this._laneSign(p) * (C.HALF_W * 0.5);
    var z;
    if (p.team === srv.team && p.slot === srv.slot) {
      z = fwd * (C.HALF_L + 0.45);                 // server: a step behind the baseline
    } else if (p.team === srv.team) {
      z = fwd * (C.HALF_L + 0.2);                  // server's partner: back beside server
    } else if (p.team === rcv.team && p.slot === rcv.slot) {
      z = fwd * (C.HALF_L + 0.45);                 // receiver: behind the baseline
    } else {
      z = fwd * (C.KITCHEN + 0.25);                // receiver's partner: up at the kitchen line
    }
    p.pos.x = laneX; p.pos.z = z; p.vel.x = 0; p.vel.z = 0;
  }
};

Game.prototype._bindResize = function () {
  var self = this;
  function resize() {
    var w = window.innerWidth, h = window.innerHeight;
    self.canvas.style.width = w + 'px';
    self.canvas.style.height = h + 'px';
    self.renderer.setSize(w, h, false);
    if (self.composer) self.composer.setSize(w, h);
    self.camera.aspect = w / h;
    self.camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', resize);
  resize();
};

/* ----------------------------- match flow ----------------------------- */
Game.prototype._serverEntry = function () {
  var s = Rules.currentServer(this.match);
  return this._player(s.team, s.slot);
};

Game.prototype.isHumanServe = function () {
  return this.state === STATE.SERVE && !this.pendingServe && this._serverEntry().isHuman;
};

Game.prototype.start = function () {
  this.state = STATE.SERVE;
  var humanServes = this._serverEntry().isHuman;
  this.serveDelay = humanServes ? 0 : 0.9;
  this._clearServeInput();
  this._message(humanServes ? 'YOUR SERVE — tap SERVE or Space' : 'OPPONENT SERVE', 2.2);
};

// Drop any swing/serve input queued during the previous rally so a stale press
// can't auto-fire the next serve. A fresh press is required each time.
Game.prototype._clearServeInput = function () {
  if (this.input) { this.input.state.serveQueued = false; this.input.state.swingQueued = false; }
};

Game.prototype._placeServe = function () {
  this._formationServe();
  var s = Rules.currentServer(this.match);
  var srvEntry = this._player(s.team, s.slot);
  this.ball.live = false;
  this.ball.spline = null;
  this.ball.pos = this._serveContactPoint(srvEntry);
  this.ball.vel = Physics.vec(0, 0, 0);
  this.ball.spin = Physics.vec(0, 0, 0);
  this.pendingServe = null;
  this.serveChecked = false;
  this._clearServeInput();
};

Game.prototype._doServe = function () {
  if (this.pendingServe) return;
  var srvEntry = this._serverEntry();
  var swingDur = srvEntry.mesh._swingDur || 0.44;
  var contactT = srvEntry.mesh.contactT || 0.5;
  this.pendingServe = { elapsed: 0, contactDelay: swingDur * contactT };
  this.ball.live = false;
  this.ball.spline = null;
  this.ball.vel = Physics.vec(0, 0, 0);
  this.ball.spin = Physics.vec(0, 0, 0);
  this.ball.pos = this._serveContactPoint(srvEntry);
  srvEntry.mesh.swing('serve');
};

Game.prototype._serveContactPoint = function (srvEntry) {
  var fwd = (srvEntry.team === 'near') ? 1 : -1;
  var rightHandX = (srvEntry.team === 'near') ? 0.3 : -0.3;
  return Physics.vec(srvEntry.pos.x + rightHandX, 0.88, srvEntry.pos.z - fwd * 0.24);
};

Game.prototype._servePaddlePoint = function (srvEntry) {
  var pw = srvEntry.mesh && srvEntry.mesh.paddleWorld;
  if (pw && Number.isFinite(pw.x) && Number.isFinite(pw.y) && Number.isFinite(pw.z)) {
    var dx = pw.x - srvEntry.pos.x, dz = pw.z - srvEntry.pos.z;
    if (Math.abs(dx) < 1.4 && Math.abs(dz) < 1.4 && pw.y > 0.2) {
      return Physics.vec(pw.x, clamp(pw.y, 0.5, 1.25), pw.z);
    }
  }
  return this._serveContactPoint(srvEntry);
};

Game.prototype._launchServe = function () {
  Rules.startRally(this.match);
  var s = Rules.currentServer(this.match);
  var rcv = Rules.currentReceiver(this.match);
  var srvEntry = this._player(s.team, s.slot);
  var fwd = (s.team === 'near') ? 1 : -1;
  var p0 = this._servePaddlePoint(srvEntry);
  // diagonal target into the correct (cross-court) service box, beyond kitchen
  var targetX = Rules.sideX(rcv.team, rcv.side) * (C.HALF_W * 0.5);
  var targetZ = -fwd * (C.HALF_L * 0.74);
  var target = Physics.vec(targetX + (Math.random() - 0.5) * 0.4, 0, targetZ);
  var serveSpin = Physics.vec(2.0, 0, 0);
  var serveApex = 2.5;
  var P1serve = Physics.computeP1(p0, target, serveApex, null);
  var T = Physics.splineFlightTime(p0, target, P1serve.y);
  this.ball.spline = { P0: p0, P1: P1serve, P2: target, duration: T, elapsed: 0 };
  this.ball.spin = serveSpin; this.ball.live = true; this.ball.pos = Physics.clone(p0);
  Rules.onPaddleHit(this.match, this.match.server, { volley: false });
  if (this.audio) this.audio.sfx.serve();
  this.cameraShake = Math.max(this.cameraShake, 0.05);
  this._triggerHitEffect();
  this.pendingServe = null;
  this.state = STATE.RALLY;
  this.lastHitCooldown = HIT.COOLDOWN_SERVE;
};

Game.prototype._endPoint = function (result) {
  this.state = STATE.POINT;
  this.pointPause = 1.5;
  this.ball.live = false;
  this.excitement = 1.0;
  this.cameraShake = result.scored ? 0.25 : 0.12;
  this._triggerPointReaction(result.rallyWinner);
  var msg = this._resultMessage(result);
  this._message(msg, 1.6);
  if (this.audio) { result.scored ? this.audio.sfx.point() : this.audio.sfx.fault(); }
  if (result.gameOver) {
    this.state = STATE.OVER;
    this._message(this.match.winner === 'near' ? 'YOU WIN!' : 'OPPONENT WINS', 6);
    if (this.onMatchOver) this.onMatchOver(this.match.winner);
  }
};

Game.prototype._resultMessage = function (r) {
  var who = r.rallyWinner === 'near' ? 'You' : 'Opponent';
  var reasons = {
    'out-of-bounds': 'OUT!', 'into-net': 'INTO THE NET',
    'no-return': 'NO RETURN', 'kitchen-volley': 'KITCHEN VOLLEY!',
    'volley-before-double-bounce': 'TWO-BOUNCE RULE', 'serve-fault': 'SERVE FAULT',
    'serve-wrong-court': 'WRONG COURT'
  };
  var tag = reasons[r.reason] || '';
  if (r.scored) return tag ? (who + ' score! ' + tag) : (who + ' score!');
  var lead = r.secondServer ? 'Second server' : 'Side out';
  return tag ? (lead + ' — ' + tag) : lead;
};

Game.prototype._nextServe = function () {
  if (this.state === STATE.OVER) return;
  this._placeServe();
  this.state = STATE.SERVE;
  var humanServes = this._serverEntry().isHuman;
  this.serveDelay = humanServes ? 0 : 0.8;
  this._message(humanServes ? 'Your serve' : 'Opponent serve', 1.4);
};

/* ----------------------------- per-frame ------------------------------ */
Game.prototype.update = function (dt) {
  dt = Math.min(dt, 1 / 30);
  this.excitement = Math.max(0, this.excitement - dt * 0.7);
  this.cameraShake = Math.max(0, this.cameraShake - dt * 0.8);
  this.msgTimer = Math.max(0, this.msgTimer - dt);
  this.shotTimer = Math.max(0, (this.shotTimer || 0) - dt);

  var inp = this.input ? this.input.poll() : null;
  if (this.swingWindow > 0) this.swingWindow -= dt;

  if (this.input && this.input.consumeCamCycle()) this._cycleCamera();

  this._updateHuman(dt, inp);
  this._updateCPUs(dt);

  // Swing input opens a short TIMING WINDOW (arcade-tennis style).
  if (this.state === STATE.RALLY && this.input) {
    var sw = this.input.consumeSwing();
    if (sw) {
      this.human.swing(sw);
      this.swingType = sw;
      this.swingAim = this.input.state.aim || 0;
      this.swingPower = this.input.state.swingPower || 'power';
      this.swingShot = this.input.state.swingShot || null;
      this.swingWindow = HIT.SWING_WINDOW;
      this.swingUsed = false;
    }
  }

  if (this.state === STATE.SERVE) this._tickServe(dt);
  else if (this.state === STATE.RALLY) this._tickRally(dt);
  else if (this.state === STATE.POINT) {
    this.pointPause -= dt;
    if (this.pointPause <= 0) this._nextServe();
  }

  this._syncMeshes(dt);
  updateCamera(this.camRig, this.ball, this.players[0].pos, this.camMode, this.cameraShake, dt, {
    isMobile: this.isMobile
  });
  this._updateHUD();
};

Game.prototype._tickServe = function (dt) {
  var s = Rules.currentServer(this.match);
  var srvEntry = this._player(s.team, s.slot);
  var hold = this._serveContactPoint(srvEntry);
  if (this.pendingServe) {
    this.pendingServe.elapsed += dt;
    this.ball.pos = this._servePaddlePoint(srvEntry);
    if (this.pendingServe.elapsed >= this.pendingServe.contactDelay) this._launchServe();
    return;
  }
  // keep the ball held at the paddle-side contact point until the serve swing starts
  this.ball.pos = Physics.vec(hold.x, hold.y + Math.sin(performance.now() / 200) * 0.03, hold.z);
  if (srvEntry.isHuman) {
    if (this.input && this.input.consumeServe()) {
      this.input.consumeSwing();
      // Must be behind the baseline on the server's own side to serve.
      var fwd = (s.team === 'near') ? 1 : -1;
      if (srvEntry.pos.z * fwd >= C.HALF_L - C.SERVE_LINE_TOL) this._doServe();
      else this._message('Move behind the baseline to serve', 1.2);
    }
  } else {
    this.serveDelay -= dt;
    if (this.serveDelay <= 0) this._doServe();
  }
};

Game.prototype._tickRally = function (dt) {
  this.lastHitCooldown = Math.max(0, this.lastHitCooldown - dt);
  var steps = 4, h = dt / steps;
  for (var s = 0; s < steps; s++) {
    if (this.ball.spline) {
      this._stepSpline(h);
    } else {
      var evs = Physics.step(this.ball, h);
      for (var i = 0; i < evs.length; i++) this._handleBallEvent(evs[i]);
    }
    if (this.state !== STATE.RALLY) return;
  }
  this._checkContacts(dt);
  if (Math.abs(this.ball.pos.z) > C.HALF_L + 8 || Math.abs(this.ball.pos.x) > 12) {
    var r = Rules.onOut(this.match);
    if (r.point !== undefined) this._endPoint(r);
  }
};

// Advance the active spline by h seconds. Fires a bounce/floor-out event when
// the ball reaches its landing point (t >= 1 or y <= BALL_R).
Game.prototype._stepSpline = function (h) {
  var sp = this.ball.spline;
  sp.elapsed += h;
  var t = Math.min(1, sp.elapsed / (sp.duration || 1));
  var pt = Physics.bezierPoint(sp.P0, sp.P1, sp.P2, t);
  var vt = Physics.bezierVel(sp.P0, sp.P1, sp.P2, t, sp.duration);
  this.ball.pos.x = pt.x; this.ball.pos.y = pt.y; this.ball.pos.z = pt.z;
  this.ball.vel.x = vt.x; this.ball.vel.y = vt.y; this.ball.vel.z = vt.z;

  if (t >= 1 || pt.y <= Physics.COURT.BALL_R) {
    // Transition back to physics-step for post-bounce roll-out.
    // The Bezier tangent vy at t=1 is geometrically weaker than real physics
    // (it's 2/T*(P2.y-P1.y) ≈ 4.3 m/s vs the correct ~7.5 m/s for a drop).
    // Derive the landing speed from the apex height so the first bounce is
    // physically correct; subsequent bounces are handled by Physics.step().
    var apexY = sp.P1.y;
    this.ball.spline = null;
    this.ball.pos.y = Math.max(Physics.COURT.BALL_R, this.ball.pos.y);
    var correctVy = Math.sqrt(2 * PHYS.GRAVITY * Math.max(0.01, apexY - Physics.COURT.BALL_R));
    this.ball.vel.y = correctVy * PHYS.RESTITUTION;
    this.ball.vel.x *= PHYS.FRICTION;
    this.ball.vel.z *= PHYS.FRICTION;
    var side = this.ball.pos.z >= 0 ? 1 : -1;
    var inBounds = Math.abs(this.ball.pos.x) <= C.HALF_W + C.BALL_R &&
                   Math.abs(this.ball.pos.z) <= C.HALF_L + C.BALL_R;
    this.ball.lastBounceSide = side;
    this._handleBallEvent({
      type: inBounds ? 'bounce' : 'floor-out',
      side: side, x: this.ball.pos.x, z: this.ball.pos.z, inBounds: inBounds
    });
  }
};

Game.prototype._handleBallEvent = function (e) {
  var r = null;
  if (e.type === 'bounce' || e.type === 'floor-out') {
    if (this.audio) this.audio.sfx.bounce();
    this._triggerBounceEffect(e.x, e.z);
    r = Rules.onFloor(this.match, { inBounds: e.type === 'bounce', x: e.x, z: e.z, side: e.side });
  } else if (e.type === 'net') {
    if (this.audio) this.audio.sfx.net();
    this._triggerNetEffect();
    r = Rules.onNetFault(this.match);
  }
  if (rallyOver(r)) this._endPoint(r);
};

// A rally ends on a point, a side-out, or a hand-off to the 2nd server.
function rallyOver(r) { return r && (r.point !== null || r.sideOut || r.secondServer); }

// Clamp a position to one team's side, with optional lane restriction for CPU doubles.
Game.prototype._clampToSide = function (pos, team, lane) {
  var over = 0.7;
  if (lane === null || lane === undefined) {
    pos.x = clamp(pos.x, -C.HALF_W - 1.5, C.HALF_W + 1.5);
  } else if (lane < 0) {
    pos.x = clamp(pos.x, -C.HALF_W - 1.5, over);
  } else {
    pos.x = clamp(pos.x, -over, C.HALF_W + 1.5);
  }
  if (team === 'far') pos.z = clamp(pos.z, -C.HALF_L - 2.0, -0.3);
  else pos.z = clamp(pos.z, 0.3, C.HALF_L + 2.0);
};

// Move pos toward (tx, tz) at speed spd, updating vel for animation.
Game.prototype._stepToward = function (pos, vel, tx, tz, spd, dt) {
  var dx = tx - pos.x, dz = tz - pos.z;
  var d = dist2D(dx, dz) || 1;
  var step = Math.min(d, spd * dt);
  vel.x = (dx / d) * (step / (dt || 1));
  vel.z = (dz / d) * (step / (dt || 1));
  pos.x += (dx / d) * step;
  pos.z += (dz / d) * step;
};

/* ------------------------- player movement ---------------------------- */
Game.prototype._updateHuman = function (dt, inp) {
  var spd = HIT.HUMAN_SPEED;
  var mx = inp ? inp.move.x : 0, mz = inp ? inp.move.z : 0;
  var tvx = mx * spd, tvz = mz * spd;
  if (inp && inp.joystickReleased) {
    this.humanVel.x = 0; this.humanVel.z = 0;
    inp.joystickReleased = false;
  } else if (inp && inp.usingJoystick) {
    this.humanVel.x = tvx; this.humanVel.z = tvz;
  } else {
    this.humanVel.x += (tvx - this.humanVel.x) * Math.min(1, dt * 12);
    this.humanVel.z += (tvz - this.humanVel.z) * Math.min(1, dt * 12);
  }
  this.humanPos.x += this.humanVel.x * dt;
  this.humanPos.z += this.humanVel.z * dt;
  this.humanPos.x = clamp(this.humanPos.x, -C.HALF_W - 1.5, C.HALF_W + 1.5);
  this.humanPos.z = clamp(this.humanPos.z, 0.3, C.HALF_L + 2.0);
};

Game.prototype._updateCPUs = function (dt) {
  if (this.state !== STATE.RALLY) return;     // hold the serve formation otherwise
  for (var i = 0; i < this.players.length; i++) {
    var p = this.players[i];
    if (!p.isHuman) this._moveCPU(p, dt);
  }
};

// Lane-aware doubles movement.
Game.prototype._moveCPU = function (p, dt) {
  var team = p.team, fwd = (team === 'near') ? 1 : -1;
  var rally = this.match.rally;
  var lane = this._laneSign(p);                    // ±1: this player's side of center
  var laneX = lane * (C.HALF_W * 0.55);
  // Kitchen race: once the rally is open, skilled players work up to the line.
  // Serving team stays at baseline until they've hit shot 3 (their first open-play
  // shot); the returning team's partner already starts at the kitchen in formation.
  var backZ = C.HALF_L - 0.9, upZ = C.KITCHEN + 0.3;
  var isServingTeam = (team === this.match.server);
  var shotsCompleted = (rally && rally.shots) || 0;
  var advanceAllowed = (rally && rally.phase === 'open') &&
    (!isServingTeam || shotsCompleted >= 3);
  var advance = advanceAllowed ? clamp(p.ai.cfg.smart * 1.6 - 0.2, 0, 1) : 0;
  var tx = laneX, tz = fwd * (backZ + (upZ - backZ) * advance);

  // Only the player whose LANE the ball is heading into goes for it.
  var incoming = this.ball.live && (this.ball.vel.z * fwd > 0);
  var pred = incoming ? AI.predict(this.ball) : null;
  if (pred && p.slot === this._responsibleSlot(team, pred.x)) {
    // Pop-up arc (high apex): stay near kitchen to intercept overhead rather than
    // retreating all the way to the baseline landing point.
    var isPopup = this.ball.spline && this.ball.spline.P1.y >= 2.0;
    if (!isPopup) { tx = pred.x; tz = pred.z; }
    // If popup: keep the default advance target so they can volley it overhead.
  }

  var spd = p.ai.cfg.speed;
  this._stepToward(p.pos, p.vel, tx, tz, spd, dt);
  this._clampToSide(p.pos, team, lane);
};

/* --------------------------- ball contact ----------------------------- */
Game.prototype._reachOK = function (pos) {
  var dx = this.ball.pos.x - pos.x, dz = this.ball.pos.z - pos.z;
  return dist2D(dx, dz) < HIT.REACH && this.ball.pos.y < HIT.REACH_Y_MAX && this.ball.pos.y > 0.0;
};

Game.prototype._checkContacts = function (dt) {
  if (this.lastHitCooldown > 0) return;
  var rally = this.match.rally;
  if (!rally) return;
  // The receiving team is whichever side the ball is on.
  var team = (this.ball.pos.z > 0) ? 'near' : 'far';
  if (rally.lastHitter === team) return;            // our own shot still outgoing
  var p = this._player(team, this._responsibleSlot(team));
  // Human poach: the human may take a ball assigned to their partner by
  // stepping in front and timing a swing while within reach.
  var human = this.players[0];
  if (human.team === team && human !== p &&
      this.swingWindow > 0 && !this.swingUsed && this._reachOK(human.pos)) {
    p = human;
  }
  if (!this._reachOK(p.pos)) return;
  // two-bounce rule: serve & return must bounce before being struck
  var mustBounce = (rally.phase === 'serve' || rally.phase === 'return');
  if (mustBounce && rally.bouncesSinceHit < 1) return;

  if (p.isHuman) {
    if (this.swingWindow <= 0 || this.swingUsed) return; // human must time a swing
    this._hit(p, this.swingType);
    this.swingUsed = true;
  } else {
    // If the ball is still rising and will reach smash height, wait for it.
    // This lets the CPU attack overhead instead of scooping it at ankle level.
    if (this.ball.vel.y > 0 && this.ball.pos.y < POWER_CAP.SMASH_H) {
      var peakY = this.ball.pos.y + (this.ball.vel.y * this.ball.vel.y) / (2 * PHYS.GRAVITY);
      if (peakY >= POWER_CAP.SMASH_H) {
        p.aiSwingTimer = 0;
        return;
      }
    }
    p.aiSwingTimer += dt;
    if (p.aiSwingTimer < p.ai.cfg.react) return;       // reaction delay
    p.aiSwingTimer = 0;
    this._cpuHit(p);
  }
};

// Resolve the AIMED shot for a human-controlled player from the held directional
// input ("momentum aim"): move.x steers left/right, -move.z steers depth.
// intentOverride optionally forces a specific intent (e.g. 'touch' for power cap).
Game.prototype._aimTarget = function (p, intentOverride) {
  var pos = p.pos, fwd = (p.team === 'near') ? 1 : -1;
  var move = (this.input && this.input.state.move) ? this.input.state.move : { x: 0, z: 0 };
  var aim = clamp((this.swingAim || 0) + (move.x || 0), -1, 1);
  var intent = intentOverride || ((this.swingShot === 'lob') ? 'lob' : (this.swingPower || 'power'));
  var sr = Shots.resolve(Math.abs(pos.z), this.ball.pos.y, intent, C.KITCHEN, C.HALF_L);
  var landZ = Shots.aimDepth(sr.sp.landZ, -(move.z || 0), C.KITCHEN, C.HALF_L);
  return { aim: aim, x: aim * C.HALF_W * 0.92, z: -fwd * landZ, type: sr.type, sp: sr.sp };
};

// True when all four players are within kitchen zone (|z| < KITCHEN + 0.5).
Game.prototype._allPlayersAtKitchen = function () {
  for (var i = 0; i < this.players.length; i++) {
    if (Math.abs(this.players[i].pos.z) >= C.KITCHEN + 0.5) return false;
  }
  return true;
};

// Compute the Stability Index [0,1] for player p at contact time.
// High = standing still near ball; low = stretched + sprinting.
Game.prototype._computeStability = function (p) {
  var sweet = (STABILITY.SWEET_SPOT[this.difficulty] || STABILITY.SWEET_SPOT.normal);
  var dx = this.ball.pos.x - p.pos.x, dz = this.ball.pos.z - p.pos.z;
  var dist = Math.sqrt(dx * dx + dz * dz);
  var distFactor = Math.max(0, 1 - dist / sweet);
  var speed = Math.sqrt(p.vel.x * p.vel.x + p.vel.z * p.vel.z);
  var velFactor = Math.max(0, 1 - (speed / HIT.HUMAN_SPEED) * STABILITY.VEL_WEIGHT);
  return distFactor * velFactor;
};

// Return the player on the opposing team who is furthest from the net.
Game.prototype._deeperOpponent = function (hitterTeam) {
  var oppTeam = hitterTeam === 'near' ? 'far' : 'near';
  var a = this._player(oppTeam, 0), b = this._player(oppTeam, 1);
  return (Math.abs(a.pos.z) >= Math.abs(b.pos.z)) ? a : b;
};

// True if player p is outside the sideline far enough for an ATP shot (Pro only).
Game.prototype._isAtpPosition = function (p) {
  return Math.abs(p.pos.x) > C.HALF_W + SPECIALTY.ATP_X_MARGIN;
};

// True if player p is outside the sideline AND within kitchen depth for an Erne.
Game.prototype._isErnePosition = function (p) {
  return Math.abs(p.pos.x) > C.HALF_W + SPECIALTY.ERNE_X_MARGIN &&
         Math.abs(p.pos.z) < SPECIALTY.ERNE_Z_MAX;
};

// Spline-based shot executor: snaps ball to contact point, builds the Bezier arc.
// isAtp = true bypasses the net-plane apex (ATP arc goes around the post).
Game.prototype._executeSplineShot = function (P2x, P2z, apex, margin, spinVec, isAtp) {
  var p0 = Physics.vec(this.ball.pos.x, Math.max(0.5, this.ball.pos.y), this.ball.pos.z);
  var p2 = Physics.vec(P2x, 0, P2z);
  var P1;
  if (isAtp) {
    // ATP: P1 placed very low (below net height) so the arc curves around the post.
    P1 = { x: (p0.x + p2.x) * 0.5, y: 0.4, z: p0.z * 0.5 };
  } else {
    P1 = Physics.computeP1(p0, p2, apex, margin);
  }
  var T = Physics.splineFlightTime(p0, p2, P1.y);
  this.ball.spline = { P0: p0, P1: P1, P2: p2, duration: T, elapsed: 0 };
  this.ball.spin = spinVec;
  this.ball.live = true;
  this.ball.pos = Physics.clone(p0); // snap
  this.lastHitCooldown = HIT.COOLDOWN_RALLY;
};

// Shared ball-launch tail: snaps ball to contact point (unless fault), applies vel/spin.
// Kept for reference; no longer called by the hit path (splines replaced it).
Game.prototype._executeHit = function (targetX, targetZ, apex, margin, spinVec, fault) {
  var p0 = Physics.vec(this.ball.pos.x, Math.max(0.5, this.ball.pos.y), this.ball.pos.z);
  // A deliberate fault bypasses the net-clearance solver so it actually misses.
  var v = fault
    ? Physics.solveShot(p0, Physics.vec(targetX, 0, targetZ), apex)
    : Physics.launch(p0, Physics.vec(targetX, 0, targetZ), apex, margin, spinVec);
  // Snap ball to solved contact point — else a low contact flies the arc 0.2m low → net clip.
  if (!fault) this.ball.pos = p0;
  this.ball.vel = v;
  this.ball.spin = spinVec;
  this.ball.live = true;
  this.lastHitCooldown = HIT.COOLDOWN_RALLY;
};

// Human paddle strike. Aim from input + stability index + height-based power cap.
Game.prototype._hit = function (p, swingType) {
  var pos = p.pos, fwd = (p.team === 'near') ? 1 : -1;
  var rally = this.match.rally;

  // Erne bypasses the kitchen volley rule (player has jumped outside the kitchen).
  var isErne = this.difficulty === 'hard' && this._isErnePosition(p);
  var maxI = Shots.maxIntent(this.ball.pos.y);
  var visualSwingType = (isErne || maxI === 'smash') ? 'smash' : (swingType || 'fh');
  var volley = rally ? (rally.bouncesSinceHit < 1) : false;
  var inKitchen = isErne ? false : (Math.abs(pos.z) < C.KITCHEN);
  var res = Rules.onPaddleHit(this.match, p.team, { volley: volley, inKitchen: inKitchen });
  this.cameraShake = Math.max(this.cameraShake, 0.08);
  p.mesh.swing(visualSwingType);
  if (this.audio) this.audio.sfx.paddle();
  this._triggerHitEffect();
  if (rallyOver(res)) { this._endPoint(res); return; }

  // ATP — flat around-the-post arc, only at Pro level.
  if (this.difficulty === 'hard' && this._isAtpPosition(p)) {
    var atpSign = pos.x > 0 ? 1 : -1;
    var atpX = atpSign * C.HALF_W * 0.85;
    var atpZ = -fwd * (C.HALF_L * 0.55);
    var atpSpin = Physics.vec(0, atpSign * 2.0, 0);
    this._flashShot('atp');
    this._executeSplineShot(atpX, atpZ, 0.75, 0, atpSpin, true);
    return;
  }

  // Erne — smash downward from outside the sideline near the kitchen.
  if (isErne) {
    var erneX = clamp(this.ball.pos.x, -C.HALF_W * 0.7, C.HALF_W * 0.7);
    var erneZ = -fwd * (C.HALF_L * 0.35);
    var erneSpin = Physics.vec(3.5 * -fwd, 0, 0);
    this._flashShot('erne');
    this._executeSplineShot(erneX, erneZ, 0.95, 0.05, erneSpin, false);
    return;
  }

  // Stability index → shot quality → apex modifier.
  var stabilityIdx = this._computeStability(p);
  var quality = Shots.stabilityQuality(stabilityIdx);

  // Power cap: ball height limits the allowed intent.
  // Read the aimed target from directional input.
  var at = this._aimTarget(p);

  // Override intent when power cap applies.
  if (maxI === 'touch' && at.type !== 'dink' && at.type !== 'drop') {
    // Force a dink when ball is at or below net height.
    at = this._aimTarget(p, 'touch');
  }

  // Dink battle: everyone at kitchen + ball below net height → cross-court dink.
  var allAtKitchen = this._allPlayersAtKitchen();
  if (allAtKitchen && this.ball.pos.y <= POWER_CAP.NET_H) {
    var dbTarget = Shots.dinkBattleTarget(pos, this.ball.pos, fwd, C.KITCHEN, C.HALF_W);
    var dbApex = Shots.apexForQuality(Shots.params('dink', C.KITCHEN, C.HALF_L).apex, quality);
    var dbSpin = Physics.vec(-1.0 * -fwd, 0, 0);
    this._flashShot('dink');
    this._executeSplineShot(dbTarget.x, dbTarget.z, dbApex, 0.16, dbSpin, false);
    return;
  }

  // Default aim: if stick is near-neutral, steer toward the deeper opponent.
  var timing = clamp((this.ball.pos.z - pos.z) * 0.25 * fwd, -0.6, 0.6);
  var blend = clamp(at.aim + (Math.abs(at.aim) < 0.2 ? timing : 0), -1, 1);
  var targetX = blend * C.HALF_W * 0.92;
  if (Math.abs(blend) < 0.15) {
    var deeper = this._deeperOpponent(p.team);
    var awaySign = deeper.pos.x >= 0 ? -1 : 1;
    targetX = clamp(deeper.pos.x + awaySign * 0.6, -C.HALF_W * 0.92, C.HALF_W * 0.92);
  }

  // Smash: ball at or above smash height — steep overhead arc matching the AI path.
  if (maxI === 'smash') {
    var smashSpin = Physics.vec(7.0 * -fwd, blend * 1.5, 0);
    this._flashShot('speedup');
    this._executeSplineShot(targetX, at.z, POWER_CAP.NET_H + 0.06, 0.06, smashSpin, false);
    this._checkPoach(p.team);
    return;
  }

  var apex = Shots.apexForQuality(at.sp.apex, quality);
  var spinVec = Physics.vec((at.sp.spinX + (swingType === 'bh' ? -1.5 : 0)) * -fwd,
                             blend * 1.5 + at.sp.spinY, 0);
  this._flashShot(at.type);
  this._executeSplineShot(targetX, at.z, apex, at.sp.margin, spinVec, false);
  this._checkPoach(p.team);
};

// CPU paddle strike. Shot chosen by AI using spline execution + stability.
Game.prototype._cpuHit = function (p) {
  var pos = p.pos, fwd = (p.team === 'near') ? 1 : -1;
  var rally = this.match.rally;
  var volley = rally ? (rally.bouncesSinceHit < 1) : false;
  var inKitchen = Math.abs(pos.z) < C.KITCHEN;
  if (volley && inKitchen) { pos.z = fwd * (C.KITCHEN + 0.3); inKitchen = false; }
  var res = Rules.onPaddleHit(this.match, p.team, { volley: volley, inKitchen: inKitchen });
  var visualSwingType = Math.random() < 0.3 ? 'bh' : 'fh';
  if (rallyOver(res)) {
    p.mesh.swing(visualSwingType);
    if (this.audio) this.audio.sfx.paddle();
    this._triggerHitEffect();
    this._endPoint(res);
    return;
  }

  // Build opponents object for deeper-target strategy (opposing near team).
  var oppTeam = p.team === 'far' ? 'near' : 'far';
  var opponents = {
    a: this._player(oppTeam, 0),
    b: this._player(oppTeam, 1)
  };

  var shot = AI.chooseShot(p.ai, this.ball, this.match, false, opponents, pos);
  if (shot.isSmash || shot.type === 'erne') visualSwingType = 'smash';
  p.mesh.swing(visualSwingType);
  if (this.audio) this.audio.sfx.paddle();
  this._triggerHitEffect();

  // Deliberate fault: use legacy velocity-based path so faults still miss properly.
  if (shot.fault) {
    var tgtZf = (p.team === 'near') ? -shot.target.z : shot.target.z;
    var spinVecF = Physics.vec(shot.spin.x * -fwd, shot.spin.y, shot.spin.z);
    this._executeHit(shot.target.x, tgtZf, shot.apex, shot.margin, spinVecF, shot.fault);
    return;
  }

  var tgtZ = (p.team === 'near') ? -shot.target.z : shot.target.z;
  var isAtp = shot.type === 'atp';

  // CPU stability → apex modifier. Smashes are committed overheads — skip quality
  // degradation so a sprinting CPU doesn't turn a smash into a lob.
  var stabilityIdx = this._computeStability(p);
  var quality = shot.isSmash ? 'clean' : Shots.stabilityQuality(stabilityIdx);
  var apex = Shots.apexForQuality(shot.apex, quality);

  var spinVec = Physics.vec(shot.spin.x * -fwd, shot.spin.y, shot.spin.z);
  this._executeSplineShot(shot.target.x, tgtZ, apex, shot.margin, spinVec, isAtp);

  // Poach check: can the net partner intercept this shot?
  this._checkPoach(p.team);
};

// Poach check — called after a spline shot is fired toward `hitterTeam`'s
// opponents. Checks if the net-partner on the receiving team can intercept.
// If so, deflects the ball mid-spline toward open court on the hitter's side.
Game.prototype._checkPoach = function (hitterTeam) {
  if (!this.ball.spline) return;
  var sp = this.ball.spline;
  var receivingTeam = hitterTeam === 'near' ? 'far' : 'near';
  // The partner is whichever player on the receiving team is NOT responsible.
  var responsibleSlot = this._responsibleSlot(receivingTeam, sp.P2.x);
  var partnerSlot = 1 - responsibleSlot;
  var partner = this._player(receivingTeam, partnerSlot);
  if (!partner || !partner.ai) return; // human partner: no auto-poach

  if (!AI.checkPoach(partner.ai, sp.P0, sp.P1, sp.P2, partner.pos)) return;

  // Poach: swing the partner and redirect the ball toward open court.
  partner.mesh.swing('fh');
  if (this.audio) this.audio.sfx.paddle();

  // New landing target: away from where the hitter aimed, on the hitter's side.
  var openX = -sp.P2.x * 0.7 + (Math.random() - 0.5) * 0.6;
  var openZ = (hitterTeam === 'near' ? 1 : -1) * (C.HALF_L * 0.72);
  var fwd = (receivingTeam === 'near') ? 1 : -1;
  var newP2 = Physics.vec(openX, 0, openZ);
  var newP1 = Physics.computeP1(partner.pos.x !== undefined
    ? Physics.vec(partner.pos.x, 1.1, partner.pos.z) : sp.P1,
    newP2, 1.4, 0.18);
  var newT = Physics.splineFlightTime(
    Physics.vec(partner.pos.x, 1.1, partner.pos.z), newP2, newP1.y);
  this.ball.spline = {
    P0: Physics.vec(partner.pos.x, 1.1, partner.pos.z),
    P1: newP1, P2: newP2, duration: newT, elapsed: 0
  };
  this.ball.pos = Physics.clone(this.ball.spline.P0);
  this._triggerHitEffect();
  this.lastHitCooldown = HIT.COOLDOWN_RALLY;
};

/* ----------------------------- rendering ------------------------------ */
Game.prototype._triggerHitEffect = function () {
  if (!this.hitFx) return;
  var mesh = this.hitFx.mesh;
  mesh.position.set(this.ball.pos.x, Math.max(C.BALL_R * 2.0, this.ball.pos.y), this.ball.pos.z);
  mesh.scale.set(0.62, 0.62, 1);
  mesh.visible = true;
  mesh.material.opacity = 0.44;
  this.hitFx.age = this.hitFx.dur;
};

Game.prototype._updateHitEffect = function (dt) {
  if (!this.hitFx) return;
  var fx = this.hitFx;
  if (fx.age <= 0) {
    fx.mesh.visible = false;
    fx.mesh.material.opacity = 0;
    return;
  }
  fx.age = Math.max(0, fx.age - dt);
  var t = 1 - fx.age / fx.dur;
  var size = 0.62 + t * 0.42;
  fx.mesh.scale.set(size, size, 1);
  fx.mesh.material.opacity = (1 - t) * 0.44;
  if (fx.age <= 0) fx.mesh.visible = false;
};

Game.prototype._triggerBounceEffect = function (x, z) {
  if (!this.bounceFx) return;
  var mesh = this.bounceFx.mesh;
  mesh.position.set(x || 0, 0.052, z || 0);
  mesh.scale.set(1, 1, 1);
  mesh.visible = true;
  mesh.material.opacity = 0.28;
  this.bounceFx.age = this.bounceFx.dur;
};

Game.prototype._updateBounceEffect = function (dt) {
  if (!this.bounceFx) return;
  var fx = this.bounceFx;
  if (fx.age <= 0) {
    fx.mesh.visible = false;
    fx.mesh.material.opacity = 0;
    return;
  }
  fx.age = Math.max(0, fx.age - dt);
  var t = 1 - fx.age / fx.dur;
  var size = 1 + t * 1.5;
  fx.mesh.scale.set(size, size, 1);
  fx.mesh.material.opacity = (1 - t) * 0.28;
  if (fx.age <= 0) fx.mesh.visible = false;
};

Game.prototype._triggerNetEffect = function () {
  if (!this.netFx) return;
  var mesh = this.netFx.mesh;
  mesh.position.set(this.ball.pos.x, Math.max(C.BALL_R * 2.0, this.ball.pos.y), this.ball.pos.z);
  mesh.scale.set(0.54, 0.54, 1);
  mesh.visible = true;
  mesh.material.opacity = 0.42;
  this.netFx.age = this.netFx.dur;
};

Game.prototype._updateNetEffect = function (dt) {
  if (!this.netFx) return;
  var fx = this.netFx;
  if (fx.age <= 0) {
    fx.mesh.visible = false;
    fx.mesh.material.opacity = 0;
    return;
  }
  fx.age = Math.max(0, fx.age - dt);
  var t = 1 - fx.age / fx.dur;
  var size = 0.54 + t * 0.36;
  fx.mesh.scale.set(size, size, 1);
  fx.mesh.material.opacity = (1 - t) * 0.42;
  if (fx.age <= 0) fx.mesh.visible = false;
};

Game.prototype._triggerPointReaction = function (winner) {
  if (this.renderQuality.level === 'low') return;
  this.pointReaction = { winner: winner, age: 0.55, dur: 0.55 };
};

Game.prototype._reactionOffset = function (team) {
  var rx = this.pointReaction;
  if (!rx || rx.age <= 0 || team !== rx.winner) return 0;
  var t = 1 - rx.age / rx.dur;
  return Math.sin(t * Math.PI) * 0.12;
};

Game.prototype._syncMeshes = function (dt) {
  // ball
  var b = this.ball, bm = this.world.ballMesh;
  bm.position.set(b.pos.x, b.pos.y, b.pos.z);
  bm.rotation.x += (b.vel.z) * dt * 2; bm.rotation.z -= (b.vel.x) * dt * 2;
  // Ghost marker (drawn on top) so the ball is never lost behind your own player.
  if (this.world.ballGhost) this.world.ballGhost.position.set(b.pos.x, b.pos.y, b.pos.z);
  // contact shadow blob
  var blob = this.world.ballBlob;
  blob.position.set(b.pos.x, 0.02, b.pos.z);
  var sc = clamp(1.4 - b.pos.y * 0.18, 0.4, 1.4);
  blob.scale.setScalar(sc);
  blob.material.opacity = clamp(0.35 - b.pos.y * 0.03, 0.06, 0.35);
  // trail
  this._updateTrail();
  this._updateHitEffect(dt);
  this._updateBounceEffect(dt);
  this._updateNetEffect(dt);
  if (this.pointReaction) this.pointReaction.age = Math.max(0, this.pointReaction.age - dt);

  // players — each faces the OPPONENT's side and only yaws toward the ball.
  for (var i = 0; i < this.players.length; i++) {
    var pl = this.players[i];
    var v = Math.hypot(pl.vel.x, pl.vel.z);
    var base = (pl.team === 'near') ? Math.PI : 0;
    var yaw = clamp((this.ball.pos.x - pl.pos.x) * 0.16, -0.6, 0.6);
    if (v > 0.4) yaw = clamp(pl.vel.x * 0.18, -0.7, 0.7);
    pl.mesh.object.position.set(pl.pos.x, this._reactionOffset(pl.team), pl.pos.z);
    pl.mesh.update(dt, {
      speed: v,
      facing: base + yaw,
      ready: this.state === STATE.SERVE || this.state === STATE.RALLY
    });
  }

  // keep the "you" ring under players[0], with a gentle pulse
  if (this.youMarker) {
    var me = this.players[0].pos;
    this.youMarker.position.set(me.x, 0.04, me.z);
    var pulse = 1 + Math.sin(performance.now() / 320) * 0.07;
    this.youMarker.scale.set(pulse, pulse, 1);
    if (this.youMarkerGlow) {
      this.youMarkerGlow.position.set(me.x, 0.035, me.z);
      this.youMarkerGlow.scale.set(1.05 + (pulse - 1) * 1.4, 1.05 + (pulse - 1) * 1.4, 1);
    }
  }

  // Aim marker: show on the opponents' court when it's your turn to hit.
  if (this.aimMarker) {
    var human = this.players[0];
    var rally = this.match.rally;
    var incoming = (this.state === STATE.RALLY && rally && rally.lastHitter !== 'near' &&
        this.ball.live && this.ball.vel.z > 0);
    var yourTurn = false;
    if (incoming) {
      this._aimPredT = (this._aimPredT || 0) - dt;
      if (this._aimPredT <= 0 || !this._aimPred) { this._aimPred = AI.predict(this.ball); this._aimPredT = 0.08; }
      yourTurn = (this._responsibleSlot('near', this._aimPred.x) === human.slot)
              || this._reachOK(human.pos);
    } else { this._aimPred = null; }
    if (yourTurn) {
      var at = this._aimTarget(human);
      this.aimMarker.position.set(at.x, 0.04, at.z);
      var target = this.swingWindow > 0 ? 0.8 : 0.32;
      this.aimMarker.material.opacity += (target - this.aimMarker.material.opacity) * Math.min(1, dt * 10);
      if (this.aimMarkerFill) {
        this.aimMarkerFill.position.set(at.x, 0.035, at.z);
        this.aimMarkerFill.material.opacity += ((target * 0.18) - this.aimMarkerFill.material.opacity) * Math.min(1, dt * 10);
      }
    } else {
      this.aimMarker.material.opacity += (0 - this.aimMarker.material.opacity) * Math.min(1, dt * 10);
      if (this.aimMarkerFill) {
        this.aimMarkerFill.material.opacity += (0 - this.aimMarkerFill.material.opacity) * Math.min(1, dt * 10);
      }
    }
  }
};

Game.prototype._updateTrail = function () {
  var buf = this.world.trailBuf, max = this.world.trailLen;
  buf.push([this.ball.pos.x, this.ball.pos.y, this.ball.pos.z]);
  while (buf.length > max) buf.shift();
  var attr = this.world.trail.geometry.attributes.position;
  for (var i = 0; i < max; i++) {
    var p = buf[i] || buf[buf.length - 1] || [0, 0, 0];
    attr.setXYZ(i, p[0], p[1], p[2]);
  }
  attr.needsUpdate = true;
  this.world.trail.material.opacity = this.ball.live ? 0.35 : 0;
};

/* ------------------------------- HUD ---------------------------------- */
Game.prototype._cycleCamera = function () {
  var names = ['BROADCAST', 'FOLLOW', 'TOP-DOWN'];
  this.camMode = (this.camMode + 1) % names.length;
  this._syncOverhead();
  this._message(names[this.camMode], 1.2);
  if (this.hud && this.hud.setCamMode) this.hud.setCamMode(this.camMode, names[this.camMode]);
};

// The straight-overhead Top-Down camera would otherwise look up into the indoor
// ceiling/trusses; hide that overhead geometry while it's active. Belt-and-braces
// against ever seeing "the ceiling" in top-down regardless of exact camera pose.
Game.prototype._syncOverhead = function () {
  var overhead = this.world && this.world.overhead;
  if (!overhead) return;
  var hidden = this.camMode === 2;
  for (var i = 0; i < overhead.length; i++) overhead[i].visible = !hidden;
};

Game.prototype._message = function (text, time) {
  this._msg = text; this.msgTimer = time || 1.5;
};
Game.prototype._flashShot = function (type) {
  this._shotName = String(type || '').toUpperCase();
  this.shotTimer = 0.9;
};
Game.prototype._updateHUD = function () {
  if (!this.hud) return;
  this.hud.update({
    scores: this.match.scores,
    server: this.match.server,
    serverNum: this.match.serverNum,
    msg: this.msgTimer > 0 ? this._msg : null,
    msgOpacity: Math.min(1, this.msgTimer * 2),
    shotName: this.shotTimer > 0 ? this._shotName : null,
    shotOpacity: Math.min(0.85, this.shotTimer * 1.6),
    level: this.levelMeta,
    isHumanServe: this.isHumanServe()
  });
};

Game.prototype.render = function () {
  if (this.composer) this.composer.render();
  else this.renderer.render(this.scene, this.camera);
};
