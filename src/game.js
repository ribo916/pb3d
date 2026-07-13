/* ============================================================================
 * game.js — Orchestrator. Wires Three.js rendering to the pure logic layer,
 * runs the match state machine, camera, players, ball and HUD.
 * Ported from the original Picklelife js/game.js (ESM). Audio, character
 * skinning, venues/night mode and the 2D-shell hooks are dropped; the core
 * gameplay feel, hit model, momentum aim and camera are preserved 1:1.
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
import * as Practice from './practice.js';
import * as SinglesStrategy from './strategies/singles.js';
import * as DoublesStrategy from './strategies/doubles.js';
import * as Movement from './movement.js';
import * as Scene from './scene.js';
import { makePlayer } from './players.js';
import { resolveSlotCharacter } from './characters.js';
import { makeCamera, updateCamera } from './camera.js';
import { clamp, dist2D } from './utils.js';
import { HIT, PHYS, PHYS_V2, STABILITY, POWER_CAP, SPECIALTY, MOVEMENT, PRACTICE, TIMING_V2 } from './constants.js';
import { normalizeMode } from './modes.js';

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

// Approx. normal deviate (mean, sd) via the central-limit sum of uniforms.
// Cheap and good enough for reaction-time jitter; no dependency needed.
function gaussian(mean, sd) {
  if (!sd) return mean;
  var u = (Math.random() + Math.random() + Math.random()) / 3; // ~N(0.5, ...)
  return mean + (u - 0.5) * 2 * 1.732 * sd;
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

// Mechanics selector: 'v2' (DEFAULT) = honest simulated physics + numeric shot
// solver; 'v1' = the legacy scripted-Bezier flight (see physics.js /
// GAMEPLAY.md). Chosen by opts.mechanics, overridable at runtime via
// ?mech=v1|v2. v1 is kept only for A/B comparison during user testing and will
// be removed once testing completes.
function mechanicsMode(opt) {
  var forced = '';
  try {
    forced = new URLSearchParams(window.location.search).get('mech') || '';
  } catch (e) {}
  forced = String(forced || opt || '').toLowerCase();
  return forced === 'v1' ? 'v1' : 'v2';
}

function normalizeDifficulty(d) {
  if (d === '4.0' || d === 'beginner' || d === 'easy') return 'easy';
  if (d === '4.5' || d === 'intermediate' || d === 'normal') return 'normal';
  if (d === '5.0' || d === 'advanced' || d === 'hard') return 'hard';
  if (DIFFICULTY_META[d]) return d;
  return 'normal';
}

function strategyForMode(mode) {
  return mode === 'singles' ? SinglesStrategy : DoublesStrategy;
}

export function Game(opts) {
  this.opts = opts || {};
  this.canvas = opts.canvas;
  this.hud = opts.hud || null;
  this.audio = opts.audio || null;
  this.assets = opts.assets || null;
  this.difficulty = normalizeDifficulty(opts.difficulty);
  this.mode = normalizeMode(opts.mode);
  this.levelMeta = DIFFICULTY_META[this.difficulty] || DIFFICULTY_META.normal;
  this.venue = opts.venue || 'park';
  this.courtPalette = opts.courtPalette || 'blue';
  this.timeOfDay = this.venue === 'indoor' ? 'day' : (opts.timeOfDay || 'day');
  this.partnerDiff = opts.partnerDiff || null;
  this.roster = opts.roster || {};
  this.onMatchOver = opts.onMatchOver || null;
  this.isMobile = !!opts.isMobile;
  this.mechanics = mechanicsMode(opts.mechanics);
  this.mechanicsV2 = this.mechanics === 'v2';
  // Lightweight always-on match metrics for A/B tuning (see tools/play.mjs).
  this.metrics = { pointsByReason: {}, rallyShots: [], netErrors: 0, serveFaults: 0 };
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
    assets: this.assets,
    mode: this.mode
  });
  this._syncOverhead(); // honor an initial Top-Down camMode
  this.ball = Physics.makeBall();
  this.ball.mech = this.mechanicsV2 ? 'v2' : 'v1'; // tags forward-sim forces in AI.predict

  // Roster: doubles keeps the classic four-player setup; singles uses the
  // human plus the far-side opponent slot.
  //
  // Each slot picks one of the 12 Mixamo characters (src/characters.js,
  // shared with the menu picker); team/paddle color stays keyed by SLOT so
  // switching a slot's character doesn't change its team color.
  var roster = this.roster;
  function characterFor(position) {
    return resolveSlotCharacter(position, roster[position]);
  }
  var palettes = {
    nearYou: characterFor('nearYou'),
    nearMate: characterFor('nearMate'),
    farA: characterFor('farA'),
    farB: characterFor('farB')
  };
  this.youColor = palettes.nearYou.jersey;

  var self = this;
  function entry(team, slot, isHuman, colors) {
    var mesh = makePlayer(Object.assign({}, colors, { assets: self.assets }));
    self.scene.add(mesh.object);
    return {
      team: team, slot: slot, isHuman: isHuman, mesh: mesh,
      pos: { x: 0, z: 0 }, vel: { x: 0, z: 0 },
      move: { kind: 'ready', target: { x: 0, z: 0 }, split: 0, plant: 0, lunge: 0 },
      ai: isHuman ? null : AI.makeAI(self.difficulty, colors && colors.persona),
      aiSwingTimer: 0, aiReactTarget: 0
    };
  }
  if (this.mode === 'practice') {
    this.players = [
      entry('near', 0, true, palettes.nearYou)
    ];
  } else if (this.mode === 'singles') {
    this.players = [
      entry('near', 0, true,  palettes.nearYou),
      entry('far',  0, false, palettes.farA)
    ];
  } else {
    this.players = [
      entry('near', 0, true,  palettes.nearYou),
      entry('near', 1, false, palettes.nearMate),
      entry('far',  0, false, palettes.farA),
      entry('far',  1, false, palettes.farB)
    ];
  }
  if (this.partnerDiff && this.mode === 'doubles') this.players[1].ai = AI.makeAI(this.partnerDiff, palettes.nearMate.persona);
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

  this.practiceReturns = [];
  if (this.mode === 'practice') this._initPracticeReturnVisuals();

  this.practice = null;
  this.match = this.mode === 'practice' ? null : Rules.makeMatch({ server: 'near', mode: this.mode });
  this.lastHitCooldown = 0;
  this.swingWindow = 0; this.swingUsed = false; this.swingType = 'fh'; this.swingAim = 0;
  this.swingPower = 'power'; this.swingShot = null;
  if (this.mode === 'practice') this._placePracticeFeed();
  else this._placeServe();
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

Game.prototype._teamPlayers = function (team) {
  var out = [];
  for (var i = 0; i < this.players.length; i++) {
    if (this.players[i].team === team) out.push(this.players[i]);
  }
  return out;
};

Game.prototype._opponentsFor = function (team) {
  var opp = this._teamPlayers(team === 'near' ? 'far' : 'near');
  var first = opp[0] || null;
  var second = opp[1] || null;
  return { a: first, b: second };
};

// The world-x lane sign a player currently covers (depends on its service court).
Game.prototype._laneSign = function (p) {
  if (this.mode === 'singles') return 0;
  var side = (p.slot === Rules.rightSlot(this.match, p.team)) ? 'R' : 'L';
  return Rules.sideX(p.team, side);
};

// The slot on a team responsible for a given x-lane ("yours/mine").
Game.prototype._responsibleSlot = function (team, atX) {
  if (this.mode === 'singles') return 0;
  var sgn = ((atX !== undefined ? atX : this.ball.pos.x) >= 0) ? 1 : -1;
  for (var slot = 0; slot < 2; slot++) {
    var side = (slot === Rules.rightSlot(this.match, team)) ? 'R' : 'L';
    if (Rules.sideX(team, side) === sgn) return slot;
  }
  return 0;
};

// Starting serve formation.
Game.prototype._formationServe = function () {
  var srv = Rules.currentServer(this.match);
  var rcv = Rules.currentReceiver(this.match);
  var strategy = strategyForMode(this.mode);
  for (var i = 0; i < this.players.length; i++) {
    var p = this.players[i];
    var laneX = this._laneSign(p) * (C.HALF_W * 0.5);
    var servePos = strategy.servePosition(p, srv, rcv, laneX);
    p.pos.x = servePos.x; p.pos.z = servePos.z; p.vel.x = 0; p.vel.z = 0;
    p.move.kind = 'ready'; p.move.split = 0; p.move.plant = 0; p.move.lunge = 0;
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
  if (this.mode === 'practice') return false;
  return this.state === STATE.SERVE && !this.pendingServe && this._serverEntry().isHuman;
};

Game.prototype.start = function () {
  if (this.mode === 'practice') {
    this._startPractice();
    return;
  }
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

Game.prototype._startPractice = function () {
  this.state = STATE.SERVE;
  this.practice = {
    timer: PRACTICE.FEED_INTERVAL,
    rep: 0,
    feedNum: 0,
    clean: 0,
    streak: 0,
    bestStreak: 0,
    active: false,
    bounces: 0,
    target: null,
    origin: Practice.feedOrigin(),
    nearestDist: 99,
    swingAttempted: false,
    swingSide: 0,
    feedback: null
  };
  this.players[0].pos.x = 0;
  this.players[0].pos.z = PRACTICE.PLAYER_START_Z;
  this.players[0].vel.x = 0;
  this.players[0].vel.z = 0;
  this.players[0].move.target.x = 0;
  this.players[0].move.target.z = PRACTICE.PLAYER_START_Z;
  this._placePracticeFeed();
  this._message('PRACTICE — BALL MACHINE READY', 2.2);
};

Game.prototype._placePracticeFeed = function () {
  if (!this.practice) return;
  var origin = Practice.feedOrigin();
  this.practice.origin = origin;
  this.practice.active = false;
  this.practice.bounces = 0;
  this.practice.nearestDist = 99;
  this.practice.swingAttempted = false;
  this.practice.swingSide = 0;
  this.pendingServe = null;
  this.ball.live = false;
  this.ball.spline = null;
  this.ball.pos = Physics.vec(origin.x, origin.y, origin.z);
  this.ball.vel = Physics.vec(0, 0, 0);
  this.ball.spin = Physics.vec(0, 0, 0);
  this.swingWindow = 0;
  this.swingUsed = false;
};

Game.prototype._launchPracticeBall = function () {
  var target = this.practice.feedNum === 0 ? Practice.openingFeedTarget() : Practice.randomFeedTarget();
  var p0 = Physics.vec(this.practice.origin.x, this.practice.origin.y, this.practice.origin.z);
  var p2 = Physics.vec(target.x, 0, target.z);
  this.practice.target = target;
  this.practice.active = true;
  this.practice.feedNum += 1;
  this.practice.bounces = 0;
  this.practice.nearestDist = Practice.nearestBallDistance(this.players[0].pos, p0);
  this.practice.swingAttempted = false;
  this.practice.swingSide = 0;
  if (this.mechanicsV2) {
    var feedSpin = Physics.vec(2.4, (Math.random() - 0.5) * 0.7, 0);
    this.ball.pos = Physics.clone(p0);
    this._executeShotV2(p2.x, p2.z, PRACTICE.FEED_APEX, PRACTICE.FEED_MARGIN, feedSpin, { type: 'feed' });
  } else {
    var p1 = Physics.computeP1(p0, p2, PRACTICE.FEED_APEX, PRACTICE.FEED_MARGIN);
    var duration = Physics.splineFlightTime(p0, p2, p1.y);
    this.ball.spline = { P0: p0, P1: p1, P2: p2, duration: duration, elapsed: 0 };
    this.ball.spin = Physics.vec(2.4, (Math.random() - 0.5) * 0.7, 0);
    this.ball.live = true;
    this.ball.pos = Physics.clone(p0);
  }
  this.state = STATE.RALLY;
  this.lastHitCooldown = 0.04;
  if (this.audio) this.audio.sfx.serve();
  this.cameraShake = Math.max(this.cameraShake, 0.04);
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
  if (this.mechanicsV2) {
    var srvSpec = Shots.specV2('serve', C.KITCHEN, C.HALF_L);
    var srvSpin = Physics.vec(srvSpec.spinX * -fwd, 0, 0);
    this.ball.pos = Physics.clone(p0);
    this._executeShotV2(target.x, target.z, srvSpec.apex, srvSpec.margin, srvSpin, { type: 'serve' });
  } else {
    var serveSpin = Physics.vec(2.0, 0, 0);
    var serveApex = 2.5;
    var P1serve = Physics.computeP1(p0, target, serveApex, null);
    var T = Physics.splineFlightTime(p0, target, P1serve.y);
    this.ball.spline = { P0: p0, P1: P1serve, P2: target, duration: T, elapsed: 0 };
    this.ball.spin = serveSpin; this.ball.live = true; this.ball.pos = Physics.clone(p0);
  }
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
  // Metrics for A/B tuning (tools/play.mjs reads game.metrics).
  var m = this.metrics;
  if (m) {
    var reason = result.reason || 'unknown';
    m.pointsByReason[reason] = (m.pointsByReason[reason] || 0) + 1;
    if (this.match && this.match.rally) m.rallyShots.push(this.match.rally.shots || 0);
    if (reason === 'into-net') m.netErrors++;
    if (reason === 'serve-fault' || reason === 'serve-wrong-court') m.serveFaults++;
  }
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
    'volley-before-double-bounce': 'MUST BOUNCE ON 2ND/3RD HIT', 'serve-fault': 'SERVE FAULT',
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
      var humanFwd = (this.players[0].team === 'near') ? 1 : -1;
      var side = Shots.swingSide(this.players[0].pos.x, this.ball.pos.x, humanFwd);
      this.human.swing(side);
      this.swingType = side;
      this.swingAim = this.input.state.aim || 0;
      this.swingPower = this.input.state.swingPower || 'power';
      this.swingShot = this.input.state.swingShot || null;
      this.swingWindow = HIT.SWING_WINDOW;
      this.swingUsed = false;
      if (this.mode === 'practice' && this.practice) {
        this.practice.swingAttempted = true;
        this.practice.swingSide = this.ball.pos.z - this.players[0].pos.z;
      }
    }
  }

  if (this.mode === 'practice') this._tickPractice(dt);
  else if (this.state === STATE.SERVE) this._tickServe(dt);
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
    if (this.mechanicsV2) {
      if (this.ball.flight) this.ball.flight.elapsed += h;
      var evs2 = Physics.stepV2(this.ball, h);
      for (var j = 0; j < evs2.length; j++) { this._clearFlightOn(evs2[j]); this._handleBallEvent(evs2[j]); }
    } else if (this.ball.spline) {
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

Game.prototype._tickPractice = function (dt) {
  if (!this.practice) return;
  this._updatePracticeReturns(dt);
  if (this.state === STATE.SERVE) {
    this.practice.timer -= dt;
    var hold = this.practice.origin;
    this.ball.pos = Physics.vec(hold.x, hold.y + Math.sin(performance.now() / 180) * 0.025, hold.z);
    if (this.practice.timer <= 0) this._launchPracticeBall();
    return;
  }
  if (this.state !== STATE.RALLY) return;

  this.lastHitCooldown = Math.max(0, this.lastHitCooldown - dt);
  var steps = 4, h = dt / steps;
  for (var s = 0; s < steps; s++) {
    if (this.mechanicsV2) {
      if (this.ball.flight) this.ball.flight.elapsed += h;
      var evs2 = Physics.stepV2(this.ball, h);
      for (var j = 0; j < evs2.length; j++) { this._clearFlightOn(evs2[j]); this._handlePracticeBallEvent(evs2[j]); }
    } else if (this.ball.spline) this._stepSpline(h);
    else {
      var evs = Physics.step(this.ball, h);
      for (var i = 0; i < evs.length; i++) this._handlePracticeBallEvent(evs[i]);
    }
    this.practice.nearestDist = Math.min(
      this.practice.nearestDist,
      Practice.nearestBallDistance(this.players[0].pos, this.ball.pos)
    );
    if (this.state !== STATE.RALLY) return;
  }
  this._checkPracticeContacts();
  if (Math.abs(this.ball.pos.z) > C.HALF_L + 8 || Math.abs(this.ball.pos.x) > 12) {
    this._endPracticeRep(this._scorePracticeRep('whiff'));
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
    (this.mode === 'practice' ? this._handlePracticeBallEvent : this._handleBallEvent).call(this, {
      type: inBounds ? 'bounce' : 'floor-out',
      side: side, x: this.ball.pos.x, z: this.ball.pos.z, inBounds: inBounds
    });
  }
};

// v2: drop the cached flight prediction once the ball bounces/nets, so the AI
// stops trusting a stale landing point and forward-integrates the roll-out.
Game.prototype._clearFlightOn = function (e) {
  if (e && (e.type === 'bounce' || e.type === 'floor-out' || e.type === 'net')) this.ball.flight = null;
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

Game.prototype._handlePracticeBallEvent = function (e) {
  if (e.type === 'bounce' || e.type === 'floor-out') {
    if (this.audio) this.audio.sfx.bounce();
    this._triggerBounceEffect(e.x, e.z);
  } else if (e.type === 'net') {
    if (this.audio) this.audio.sfx.net();
    this._triggerNetEffect();
    this._endPracticeRep(this._scorePracticeRep('whiff'));
    return;
  }

  if (e.type === 'floor-out') {
    this._endPracticeRep(this._scorePracticeRep('whiff'));
    return;
  }
  if (e.side === 1) {
    this.practice.bounces += 1;
    if (this.practice.bounces >= 2) this._endPracticeRep(this._scorePracticeRep('whiff'));
  }
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
  Movement.seek(pos, vel, { x: tx, z: tz }, spd, dt, {
    accel: MOVEMENT.CPU_ACCEL,
    decel: MOVEMENT.CPU_DECEL,
    arrive: MOVEMENT.CPU_ARRIVE,
    stop: MOVEMENT.CPU_STOP
  });
};

/* ------------------------- player movement ---------------------------- */
Game.prototype._updateHuman = function (dt, inp) {
  var spd = HIT.HUMAN_SPEED;
  var mx = inp ? inp.move.x : 0, mz = inp ? inp.move.z : 0;
  if (inp && inp.joystickReleased) {
    this.humanVel.x = 0; this.humanVel.z = 0;
    inp.joystickReleased = false;
  } else if (inp && inp.usingJoystick) {
    Movement.drive(this.humanPos, this.humanVel, { x: mx, z: mz }, spd, dt, {
      accel: MOVEMENT.HUMAN_ACCEL * 1.35,
      decel: MOVEMENT.HUMAN_DECEL * 1.2,
      deadzone: MOVEMENT.DEADZONE
    });
  } else {
    Movement.drive(this.humanPos, this.humanVel, { x: mx, z: mz }, spd, dt, {
      accel: MOVEMENT.HUMAN_ACCEL,
      decel: MOVEMENT.HUMAN_DECEL,
      deadzone: MOVEMENT.DEADZONE
    });
  }
  this.humanPos.x = clamp(this.humanPos.x, -C.HALF_W - 1.5, C.HALF_W + 1.5);
  this.humanPos.z = clamp(this.humanPos.z, 0.3, C.HALF_L + 2.0);
  var speed = Math.hypot(this.humanVel.x, this.humanVel.z);
  var active = Math.hypot(mx || 0, mz || 0) > MOVEMENT.DEADZONE;
  var move = this.players[0].move;
  move.kind = active ? 'drive' : (speed > 0.25 ? 'recover' : 'ready');
  move.target.x = this.humanPos.x; move.target.z = this.humanPos.z;
  move.plant = Math.max(0, move.plant - dt);
  move.lunge = Math.max(0, move.lunge - dt);
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
  var incoming = this.ball.live && (this.ball.vel.z * fwd > 0);
  var pred = incoming ? AI.predict(this.ball) : null;
  var responsible = pred && (this.mode === 'singles' || p.slot === this._responsibleSlot(team, pred.x));
  var strategy = AI.chooseMovement(p.ai, this.ball, rally, {
    mode: this.mode,
    player: p,
    lane: lane,
    incoming: incoming,
    prediction: pred,
    responsible: responsible,
    servingTeam: this.match.server,
    opponents: this._opponentsFor(team),
    isReturner: this.state === STATE.RALLY && rally && rally.shots <= 1 && team !== this.match.server,
    distance: function (tx, tz) { return dist2D(tx - p.pos.x, tz - p.pos.z); }
  });
  var tx = strategy.target.x, tz = strategy.target.z, kind = strategy.kind;

  var spd = p.ai.cfg.speed;
  var beforeX = p.vel.x, beforeZ = p.vel.z;
  Movement.seek(p.pos, p.vel, { x: tx, z: tz }, spd, dt, {
    accel: MOVEMENT.CPU_ACCEL,
    decel: MOVEMENT.CPU_DECEL,
    arrive: kind === 'intercept' || kind === 'emergency' ? 0.35 : MOVEMENT.CPU_ARRIVE,
    stop: MOVEMENT.CPU_STOP
  });
  var was = Math.hypot(beforeX, beforeZ), now = Math.hypot(p.vel.x, p.vel.z);
  var dot = was > 0.01 && now > 0.01 ? (beforeX * p.vel.x + beforeZ * p.vel.z) / (was * now) : 1;
  if (was > MOVEMENT.PLANT_SPEED && dot < MOVEMENT.PLANT_TURN_DOT) {
    p.move.plant = Math.max(p.move.plant || 0, 0.16);
  }
  this._clampToSide(p.pos, team, this.mode === 'singles' ? null : lane);
  p.move.kind = kind;
  p.move.target.x = tx; p.move.target.z = tz;
  p.move.split = Math.max(0, (p.move.split || 0) - dt);
  p.move.plant = Math.max(0, (p.move.plant || 0) - dt);
  p.move.lunge = Math.max(0, (p.move.lunge || 0) - dt);
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
  if (!p) return;
  // Human poach: the human may take a ball assigned to their partner by
  // stepping in front and timing a swing while within reach.
  var human = this.players[0];
  if (human.team === team && human !== p &&
      this.swingWindow > 0 && !this.swingUsed && this._reachOK(human.pos)) {
    p = human;
  }
  if (!this._reachOK(p.pos)) return;

  if (p.isHuman) {
    if (this.swingWindow <= 0 || this.swingUsed) return; // human must time a swing
    if (this._holdForContact(p)) return; // v2: let the ball reach the body plane
    this._hit(p);
    this.swingUsed = true;
  } else {
    // CPUs should play sound pickleball: during the opening two-bounce lock,
    // set up for the landing instead of volleying the serve/return into a fault.
    if (Rules.isDoubleBounceVolleyLocked(this.match)) {
      p.aiSwingTimer = 0;
      return;
    }
    // If the ball is still rising and will reach smash height, wait for it.
    // This lets the CPU attack overhead instead of scooping it at ankle level.
    // Use the ACTIVE mechanics' gravity: under v2 (9.81) a rising ball peaks
    // ~27% higher than the v1 constant (13.5) predicts.
    if (this.ball.vel.y > 0 && this.ball.pos.y < POWER_CAP.SMASH_H) {
      var gAct = this.mechanicsV2 ? PHYS_V2.GRAVITY : PHYS.GRAVITY;
      var peakY = this.ball.pos.y + (this.ball.vel.y * this.ball.vel.y) / (2 * gAct);
      if (peakY >= POWER_CAP.SMASH_H) {
        p.aiSwingTimer = 0;
        return;
      }
    }
    // Reaction delay with per-ball gaussian jitter so the AI isn't metronomic
    // (beginners vary more). Sample the target once, when the timer starts.
    if (p.aiSwingTimer === 0) {
      p.aiReactTarget = Math.max(0.02, p.ai.cfg.react + gaussian(0, p.ai.cfg.reactJitter || 0));
    }
    p.aiSwingTimer += dt;
    if (p.aiSwingTimer < p.aiReactTarget) return;
    p.aiSwingTimer = 0;
    this._cpuHit(p);
  }
};

Game.prototype._checkPracticeContacts = function () {
  if (this.lastHitCooldown > 0 || !this.practice || !this.practice.active) return;
  var p = this.players[0];
  if (!this._reachOK(p.pos)) return;
  if (this.swingWindow <= 0 || this.swingUsed) return;
  if (this._holdForContact(p)) return; // v2: let the ball reach the body plane
  this._hitPractice(p);
  this.swingUsed = true;
};

// v2 human strike deferral: an early swing press no longer strikes the ball
// the instant it crosses the 1.5m reach ring (max stretch, guaranteed-bad
// geometry). While the window is open, hold the strike until the ball is
// within TIMING_V2.HOLD_Z in front of the body — like arcade tennis, pressing
// early still connects, near ideal contact, with only the window as the limit.
// Strike immediately if the ball is already close, receding, or the window is
// on its final tick.
Game.prototype._holdForContact = function (p) {
  if (!this.mechanicsV2) return false;
  if (this.swingWindow <= 1 / 30) return false;             // window closing: hit now
  var fwd = (p.team === 'near') ? 1 : -1;
  var zOff = (this.ball.pos.z - p.pos.z) * fwd;             // negative = in front
  if (zOff >= -TIMING_V2.HOLD_Z) return false;              // near/behind the body plane
  return (this.ball.vel.z * fwd) > 0;                       // still approaching → wait
};

// Resolve the AIMED shot for a human-controlled player from the held directional
// input ("momentum aim"): move.x steers left/right, -move.z steers depth.
// intentOverride optionally forces a specific intent (e.g. 'touch' for power cap).
Game.prototype._aimTarget = function (p, intentOverride) {
  var pos = p.pos, fwd = (p.team === 'near') ? 1 : -1;
  var move = (this.input && this.input.state.move) ? this.input.state.move : { x: 0, z: 0 };
  var aim = clamp((this.swingAim || 0) + (move.x || 0), -1, 1);
  var intent = intentOverride || ((this.swingShot === 'lob') ? 'lob' : (this.swingPower || 'power'));
  var sr = this.mechanicsV2
    ? Shots.resolveV2(Math.abs(pos.z), this.ball.pos.y, intent, C.KITCHEN, C.HALF_L)
    : Shots.resolve(Math.abs(pos.z), this.ball.pos.y, intent, C.KITCHEN, C.HALF_L);
  var landZ = Shots.aimDepth(sr.sp.landZ, -(move.z || 0), C.KITCHEN, C.HALF_L);
  return { aim: aim, x: aim * C.HALF_W * 0.92, z: -fwd * landZ, type: sr.type, sp: sr.sp };
};

// True when every active player is within kitchen zone (|z| < KITCHEN + 0.5).
Game.prototype._allPlayersAtKitchen = function () {
  for (var i = 0; i < this.players.length; i++) {
    if (Math.abs(this.players[i].pos.z) >= C.KITCHEN + 0.5) return false;
  }
  return true;
};

// Quality → apex degradation for the active mechanics. v1 multiplies; v2 adds
// a modest, capped loft (a mishit is a "slightly high" attackable ball, never
// a lob — see Shots.apexForQualityV2).
Game.prototype._apexForQuality = function (baseApex, quality) {
  return this.mechanicsV2
    ? Shots.apexForQualityV2(baseApex, quality)
    : Shots.apexForQuality(baseApex, quality);
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

// v2 timing-quality for the human, anchored to CONTACT GEOMETRY: where the ball
// sits relative to the body at the strike (facing-normalized z-offset, negative
// = in front), graded against the same ideal contact practice mode coaches
// (PRACTICE.TIMING_IDEAL_Z). Ball far out front = early → cross-body pull; ball
// into the body = late → paddle-side push; both cost pace, edge hits loft. This
// is the signal the player can actually see, it lines up with the swing
// animation's contact pose, and it REINFORCES the Stability Index (same
// geometry) instead of fighting it the way a press-clock anchor did.
Game.prototype._humanTiming = function (p, swingType, fwd) {
  if (!this.mechanicsV2) return { targetXSkew: 0, paceMul: 1, apexAdd: 0 };
  var zOff = (this.ball.pos.z - p.pos.z) * fwd; // negative = in front, both teams
  var offset = Shots.timingOffsetFromContact(zOff);
  return Shots.applyTiming(offset, swingType, fwd);
};

// v2 timing-quality for a CPU: gaussian offset scaled by the tier's `timing`
// sigma. CPUs take only the pace/loft consequences — the lateral skew is zeroed
// because directional variance is already owned by cfg.err (strategies' aim
// scatter); keeping both double-counts lateral error at the low tiers.
Game.prototype._cpuTiming = function (ai, swingType, fwd) {
  if (!this.mechanicsV2) return { targetXSkew: 0, paceMul: 1, apexAdd: 0 };
  var sigma = (ai && ai.cfg && ai.cfg.timing != null) ? ai.cfg.timing : 0.2;
  var offset = clamp(gaussian(0, sigma), -1, 1);
  var tm = Shots.applyTiming(offset, swingType, fwd);
  return { targetXSkew: 0, paceMul: tm.paceMul, apexAdd: tm.apexAdd };
};

// Return the player on the opposing team who is furthest from the net.
Game.prototype._deeperOpponent = function (hitterTeam) {
  var opponents = this._opponentsFor(hitterTeam);
  if (!opponents.a) return null;
  if (!opponents.b) return opponents.a;
  return (Math.abs(opponents.a.pos.z) >= Math.abs(opponents.b.pos.z)) ? opponents.a : opponents.b;
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

// Mechanics dispatcher: routes a resolved shot to the active flight model. Both
// paths receive the SAME already-computed target/apex/margin/spin (apex is
// quality-adjusted, spin is sign-flipped by -fwd, targetX includes aim blend);
// opts carries the shot type + timing so v2 can pull vMax/direct/allowNet and
// apply the timing pace/loft. This is the single seam between v1 and v2.
Game.prototype._executeShot = function (targetX, targetZ, apex, margin, spinVec, opts) {
  opts = opts || {};
  if (this.mechanicsV2) {
    this._executeShotV2(targetX, targetZ, apex, margin, spinVec, opts);
  } else {
    this._executeSplineShot(targetX, targetZ, apex, margin, spinVec, !!opts.isAtp);
  }
};

// v2 executor: snap to contact, solve an honest launch velocity, cache the
// forward-simmed flight for AI prediction. The ball then integrates under real
// physics (stepV2) every substep — no scripted curve.
Game.prototype._executeShotV2 = function (targetX, targetZ, apex, margin, spinVec, opts) {
  opts = opts || {};
  var profile = opts.type ? Shots.specV2(opts.type, C.KITCHEN, C.HALF_L) : null;
  var vMax = (opts.vMax != null ? opts.vMax : (profile ? profile.vMax : 16));
  var driven = (opts.driven != null ? opts.driven : (profile ? profile.driven : false));
  var direct = (opts.direct != null ? opts.direct : (profile ? profile.direct : false));
  var allowNet = (opts.allowNet != null ? opts.allowNet : (profile ? profile.allowNet : false));
  var paceMul = (opts.paceMul != null ? opts.paceMul : 1);
  var apexAdd = (opts.apexAdd != null ? opts.apexAdd : 0);
  var p0 = Physics.vec(this.ball.pos.x, Math.max(0.5, this.ball.pos.y), this.ball.pos.z);
  // Timing loft: a driven shot has no apex — raise its tape-crossing target
  // instead (the drive floats up); arc shots take the loft on the apex.
  var spec = {
    apex: driven ? apex : apex + apexAdd,
    margin: driven ? margin + apexAdd : margin,
    spin: spinVec,
    vMax: vMax * paceMul, driven: driven, direct: direct, allowNet: allowNet
  };
  var sol = Physics.solveArc(p0, { x: targetX, z: targetZ }, spec);
  this.ball.pos = Physics.clone(p0); // snap to contact point
  this.ball.vel = { x: sol.v0.x, y: sol.v0.y, z: sol.v0.z };
  this.ball.spin = spinVec;
  this.ball.spline = null;
  this.ball.live = true;
  this.ball.flight = { landing: sol.landing, T: sol.T, apexY: sol.apexY, samples: sol.samples, elapsed: 0 };
  // Arc-shape metrics: mean apex + launch speed per shot type (the tuning
  // blind spot that let "everything is a lob" slip past rally-length A/B).
  if (this.metrics) {
    var stats = this.metrics.shotStats || (this.metrics.shotStats = {});
    var key = opts.type || 'other';
    var st = stats[key] || (stats[key] = { n: 0, apexSum: 0, speedSum: 0 });
    st.n++;
    st.apexSum += sol.apexY;
    st.speedSum += Math.sqrt(sol.v0.x * sol.v0.x + sol.v0.y * sol.v0.y + sol.v0.z * sol.v0.z);
  }
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

Game.prototype._hitPractice = function (p) {
  var pos = p.pos, fwd = (p.team === 'near') ? 1 : -1;
  var maxI = Shots.maxIntent(this.ball.pos.y);
  var swingType = Shots.swingSide(pos.x, this.ball.pos.x, fwd);
  var visualSwingType = maxI === 'smash' ? 'smash' : swingType;
  p.mesh.swing(visualSwingType);
  if (this.audio) this.audio.sfx.paddle();
  this._triggerHitEffect();
  this.cameraShake = Math.max(this.cameraShake, 0.08);

  var stabilityIdx = this._computeStability(p);
  var quality = Shots.stabilityQuality(stabilityIdx);
  var at = this._aimTarget(p);
  if (maxI === 'touch' && at.type !== 'dink' && at.type !== 'drop') at = this._aimTarget(p, 'touch');
  var timing = Practice.scoreTiming(this.ball.pos.z - pos.z);
  var contactDist = dist2D(this.ball.pos.x - pos.x, this.ball.pos.z - pos.z);
  var feedback = Practice.scoreContact(contactDist, stabilityIdx, timing, 'contact');

  var shot;
  if (maxI === 'smash') {
    shot = this._buildPracticeReturnShot(at.x, at.z, POWER_CAP.NET_H + 0.06, 0.06,
      Physics.vec(7.0 * -fwd, at.aim * 1.5, 0), false);
  } else {
    var apex = this._apexForQuality(at.sp.apex, quality);
    var spinVec = Physics.vec((at.sp.spinX + (swingType === 'bh' ? -1.5 : 0)) * -fwd,
      at.aim * 1.5 + at.sp.spinY, 0);
    shot = this._buildPracticeReturnShot(at.x, at.z, apex, at.sp.margin, spinVec, false);
  }
  this._spawnPracticeReturn(shot);
  this._endPracticeRep(feedback);
};

// Human paddle strike. Aim from input + stability index + height-based power cap.
Game.prototype._hit = function (p) {
  var pos = p.pos, fwd = (p.team === 'near') ? 1 : -1;
  var rally = this.match.rally;

  // Erne bypasses the kitchen volley rule (player has jumped outside the kitchen).
  var isErne = this.difficulty === 'hard' && this._isErnePosition(p);
  var maxI = Shots.maxIntent(this.ball.pos.y);
  var swingType = Shots.swingSide(pos.x, this.ball.pos.x, fwd);
  var visualSwingType = (isErne || maxI === 'smash') ? 'smash' : swingType;
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
    this._executeShot(atpX, atpZ, 0.75, 0, atpSpin, { type: 'atp', isAtp: true, allowNet: true });
    return;
  }

  // Erne — smash downward from outside the sideline near the kitchen.
  if (isErne) {
    var erneX = clamp(this.ball.pos.x, -C.HALF_W * 0.7, C.HALF_W * 0.7);
    var erneZ = -fwd * (C.HALF_L * 0.35);
    var erneSpin = Physics.vec(3.5 * -fwd, 0, 0);
    this._flashShot('erne');
    this._executeShot(erneX, erneZ, 0.95, 0.05, erneSpin, { type: 'erne' });
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
    var dbBaseApex = (this.mechanicsV2 ? Shots.specV2('dink', C.KITCHEN, C.HALF_L) : Shots.params('dink', C.KITCHEN, C.HALF_L)).apex;
    var dbApex = this._apexForQuality(dbBaseApex, quality);
    var dbSpin = Physics.vec(-1.0 * -fwd, 0, 0);
    this._flashShot('dink');
    var dbTm = this._humanTiming(p, swingType, fwd);
    this._executeShot(dbTarget.x + dbTm.targetXSkew, dbTarget.z, dbApex, 0.16, dbSpin,
      { type: 'dink', paceMul: dbTm.paceMul, apexAdd: dbTm.apexAdd });
    return;
  }

  // Default aim: if stick is near-neutral, steer toward the deeper opponent.
  var timing = clamp((this.ball.pos.z - pos.z) * 0.25 * fwd, -0.6, 0.6);
  var blend = clamp(at.aim + (Math.abs(at.aim) < 0.2 ? timing : 0), -1, 1);
  var targetX = blend * C.HALF_W * 0.92;
  if (Math.abs(blend) < 0.15) {
    var neutralTarget = strategyForMode(this.mode).neutralAimTarget(this._opponentsFor(p.team));
    if (neutralTarget) {
      targetX = clamp(neutralTarget.x, -C.HALF_W * 0.92, C.HALF_W * 0.92);
      at.z = -fwd * neutralTarget.z;
    }
  }

  // Smash: ball at or above smash height — steep overhead arc matching the AI path.
  if (maxI === 'smash') {
    var smashSpin = Physics.vec(7.0 * -fwd, blend * 1.5, 0);
    this._flashShot('speedup');
    var smashTm = this._humanTiming(p, swingType, fwd);
    this._executeShot(targetX + smashTm.targetXSkew, at.z, POWER_CAP.NET_H + 0.06, 0.06, smashSpin,
      { type: 'smash', paceMul: smashTm.paceMul, apexAdd: smashTm.apexAdd });
    this._checkPoach(p.team);
    return;
  }

  var apex = this._apexForQuality(at.sp.apex, quality);
  var spinVec = Physics.vec((at.sp.spinX + (swingType === 'bh' ? -1.5 : 0)) * -fwd,
                             blend * 1.5 + at.sp.spinY, 0);
  this._flashShot(at.type);
  var tm = this._humanTiming(p, swingType, fwd);
  // Only a CLEAN power shot flies the driven (flat) family; a float/popup
  // falls back to the arc solver with the quality-lofted apex — the mishit
  // "sits up a little" and becomes attackable.
  this._executeShot(targetX + tm.targetXSkew, at.z, apex, at.sp.margin, spinVec,
    { type: at.type, paceMul: tm.paceMul, apexAdd: tm.apexAdd,
      driven: quality === 'clean' ? null : false });
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
  var visualSwingType = Shots.swingSide(pos.x, this.ball.pos.x, fwd);
  if (rallyOver(res)) {
    p.mesh.swing(visualSwingType);
    if (this.audio) this.audio.sfx.paddle();
    this._triggerHitEffect();
    this._endPoint(res);
    return;
  }

  var opponents = this._opponentsFor(p.team);
  // Stability at contact doubles as an incoming-difficulty signal: a stretched,
  // sprinting contact (low index) makes the AI more error-prone. Computed once
  // here and reused for the apex-quality degradation below.
  var stabilityIdx = this._computeStability(p);
  var shot = AI.chooseShot(p.ai, this.ball, this.match, false, {
    mode: this.mode,
    opponents: opponents,
    hitterPos: pos,
    hitterTeam: p.team,
    servingTeam: this.match.server,
    contactQuality: stabilityIdx
  });
  if (shot.isSmash || shot.type === 'erne') visualSwingType = 'smash';
  p.mesh.swing(visualSwingType);
  if (this.audio) this.audio.sfx.paddle();
  this._triggerHitEffect();

  // Deliberate fault: use legacy velocity-based path so faults still miss properly.
  if (shot.fault) {
    var tgtZf = (p.team === 'near') ? -shot.target.z : shot.target.z;
    var spinVecF = Physics.vec(shot.spin.x * -fwd, shot.spin.y, shot.spin.z);
    if (this.mechanicsV2) {
      // v2 fault: solve honestly toward the AI's deliberately-bad target with net
      // raising OFF, so it lands out or clips the tape — either way a fault.
      this._executeShotV2(shot.target.x, tgtZf, shot.apex, shot.margin, spinVecF,
        { type: shot.type, allowNet: true });
    } else {
      this._executeHit(shot.target.x, tgtZf, shot.apex, shot.margin, spinVecF, shot.fault);
    }
    return;
  }

  var tgtZ = (p.team === 'near') ? -shot.target.z : shot.target.z;
  var isAtp = shot.type === 'atp';

  // CPU stability → apex modifier. Smashes are committed overheads — skip quality
  // degradation so a sprinting CPU doesn't turn a smash into a lob.
  // (stabilityIdx computed above and reused as the shot-selection contactQuality.)
  var quality = shot.isSmash ? 'clean' : Shots.stabilityQuality(stabilityIdx);
  var apex = this._apexForQuality(shot.apex, quality);

  var spinVec = Physics.vec(shot.spin.x * -fwd, shot.spin.y, shot.spin.z);
  var cpuSide = Shots.swingSide(pos.x, this.ball.pos.x, fwd);
  var ctm = this._cpuTiming(p.ai, cpuSide, fwd);
  // Clean power shots fly the driven family; mishits fall back to the arc.
  this._executeShot(shot.target.x + ctm.targetXSkew, tgtZ, apex, shot.margin, spinVec,
    { type: shot.type, isAtp: isAtp, paceMul: ctm.paceMul, apexAdd: ctm.apexAdd,
      driven: quality === 'clean' ? null : false });

  // Poach check: can the net partner intercept this shot?
  this._checkPoach(p.team);
};

// Poach check — called after a spline shot is fired toward `hitterTeam`'s
// opponents. Checks if the net-partner on the receiving team can intercept.
// If so, deflects the ball mid-spline toward open court on the hitter's side.
Game.prototype._checkPoach = function (hitterTeam) {
  if (this.mode === 'singles' || this.mode === 'practice') return;
  // Trajectory + landing come from whichever flight model is active.
  var path, landingX;
  if (this.mechanicsV2) {
    if (!this.ball.flight) return;
    path = { samples: this.ball.flight.samples, landing: this.ball.flight.landing };
    landingX = this.ball.flight.landing.x;
  } else {
    if (!this.ball.spline) return;
    var sp = this.ball.spline;
    path = { P0: sp.P0, P1: sp.P1, P2: sp.P2 };
    landingX = sp.P2.x;
  }
  var receivingTeam = hitterTeam === 'near' ? 'far' : 'near';
  // The partner is whichever player on the receiving team is NOT responsible.
  var responsibleSlot = this._responsibleSlot(receivingTeam, landingX);
  var partnerSlot = 1 - responsibleSlot;
  var partner = this._player(receivingTeam, partnerSlot);
  if (!partner || !partner.ai) return; // human partner: no auto-poach

  if (!AI.checkPoach(partner.ai, path, partner.pos)) return;

  // Poach: swing the partner and redirect the ball toward open court.
  partner.mesh.swing('fh');
  if (this.audio) this.audio.sfx.paddle();

  // New landing target: away from where the hitter aimed, on the hitter's side.
  var openX = -landingX * 0.7 + (Math.random() - 0.5) * 0.6;
  var openZ = (hitterTeam === 'near' ? 1 : -1) * (C.HALF_L * 0.72);
  var contact = Physics.vec(partner.pos.x, 1.1, partner.pos.z);

  if (this.mechanicsV2) {
    // Re-solve an honest redirected shot from the partner's contact point.
    this.ball.pos = Physics.clone(contact);
    this.ball.spin = Physics.vec(0, 0, 0);
    this._executeShotV2(openX, openZ, 1.4, 0.18, this.ball.spin, { type: 'drive' });
  } else {
    var newP2 = Physics.vec(openX, 0, openZ);
    var newP1 = Physics.computeP1(contact, newP2, 1.4, 0.18);
    var newT = Physics.splineFlightTime(contact, newP2, newP1.y);
    this.ball.spline = { P0: contact, P1: newP1, P2: newP2, duration: newT, elapsed: 0 };
    this.ball.pos = Physics.clone(contact);
    this.lastHitCooldown = HIT.COOLDOWN_RALLY;
  }
  this._triggerHitEffect();
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
  this._updatePracticeBallCue();
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
    var facing = base + yaw;
    var local = Movement.localVelocity(pl.vel, facing);
    var move = pl.move || {};
    var visualOverride = move.lunge > 0 ? 'lunge' : (move.plant > 0 ? 'plant' : (move.split > 0 ? 'split' : ''));
    var visualMove = Movement.classifyVisual(local, v, this.state === STATE.SERVE || this.state === STATE.RALLY, visualOverride);
    pl.mesh.object.position.set(pl.pos.x, this._reactionOffset(pl.team), pl.pos.z);
    pl.mesh.update(dt, {
      speed: v,
      facing: facing,
      ready: this.state === STATE.SERVE || this.state === STATE.RALLY,
      localForward: local.forward,
      localSide: local.side,
      moveKind: move.kind || '',
      visualMove: visualMove,
      split: move.split || 0,
      plant: move.plant || 0,
      lunge: move.lunge || 0,
      target: move.target || null,
      ballX: this.ball.pos.x,
      ballZ: this.ball.pos.z
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
    var rally = this.match && this.match.rally;
    var incoming = this.mode === 'practice'
      ? (this.state === STATE.RALLY && this.ball.live && this.ball.pos.z < C.HALF_L + 0.5)
      : (this.state === STATE.RALLY && rally && rally.lastHitter !== 'near' &&
          this.ball.live && this.ball.vel.z > 0);
    var yourTurn = false;
    if (incoming) {
      if (this.mode === 'practice') {
        yourTurn = true;
      } else {
        this._aimPredT = (this._aimPredT || 0) - dt;
        if (this._aimPredT <= 0 || !this._aimPred) { this._aimPred = AI.predict(this.ball); this._aimPredT = 0.08; }
        yourTurn = (this._responsibleSlot('near', this._aimPred.x) === human.slot)
                || this._reachOK(human.pos);
      }
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

Game.prototype._updatePracticeBallCue = function () {
  var mesh = this.world && this.world.ballMesh;
  if (!mesh || !mesh.material) return;
  var glow = mesh.children && mesh.children[0] && mesh.children[0].material ? mesh.children[0].material : null;
  var ghost = this.world.ballGhost && this.world.ballGhost.material ? this.world.ballGhost.material : null;
  var cue = 'none';
  if (this.mode === 'practice' && this.practice && this.state === STATE.RALLY && this.ball.live) {
    var p = this.players[0];
    var dist = dist2D(this.ball.pos.x - p.pos.x, this.ball.pos.z - p.pos.z);
    cue = Practice.liveCue(dist, this.ball.pos.z - p.pos.z, this.ball.pos.y);
  }
  if (cue === 'perfect') {
    mesh.material.color.setHex(0xff7a18);
    mesh.material.emissive.setHex(0xff4c00);
    mesh.material.emissiveIntensity = 1.5;
    mesh.scale.setScalar(1.18);
    if (glow) { glow.color.setHex(0xffb066); glow.opacity = 0.42; }
    if (ghost) { ghost.color.setHex(0xffb066); ghost.opacity = 0.82; }
  } else if (cue === 'clean') {
    mesh.material.color.setHex(0x1fe4ff);
    mesh.material.emissive.setHex(0x00a6d6);
    mesh.material.emissiveIntensity = 1.22;
    mesh.scale.setScalar(1.12);
    if (glow) { glow.color.setHex(0xa6fbff); glow.opacity = 0.34; }
    if (ghost) { ghost.color.setHex(0xa6fbff); ghost.opacity = 0.72; }
  } else if (cue === 'good') {
    mesh.material.color.setHex(0xd6ff4a);
    mesh.material.emissive.setHex(0x8fbe00);
    mesh.material.emissiveIntensity = 0.98;
    mesh.scale.setScalar(1.06);
    if (glow) { glow.color.setHex(0xe4ff8a); glow.opacity = 0.24; }
    if (ghost) { ghost.color.setHex(0xe4ff8a); ghost.opacity = 0.58; }
  } else {
    mesh.material.color.setHex(this.world.ballBaseColor || 0x73ff26);
    mesh.material.emissive.setHex(this.world.ballBaseEmissive || 0x3a9e00);
    mesh.material.emissiveIntensity = this.timeOfDay === 'night' ? 0.95 : (this.venue === 'indoor' ? 0.42 : 0.55);
    mesh.scale.setScalar(1);
    if (glow) {
      glow.color.setHex(this.world.ballBaseGlow || 0x6cff14);
      glow.opacity = this.timeOfDay === 'night' ? 0.26 : (this.venue === 'indoor' ? 0.12 : 0.18);
    }
    if (ghost) {
      ghost.color.setHex(this.world.ballBaseGlow || 0x6cff14);
      ghost.opacity = 0.35;
    }
  }
};

Game.prototype._initPracticeReturnVisuals = function () {
  var sharedGeo = new THREE.SphereGeometry(C.BALL_R * 1.45, 20, 16);
  var glowGeo = new THREE.SphereGeometry(C.BALL_R * 2.0, 14, 10);
  var blobGeo = new THREE.CircleGeometry(C.BALL_R * 2.0, 16);
  var markGeo = new THREE.RingGeometry(0.14, 0.24, 20);
  for (var i = 0; i < PRACTICE.RETURN_VISUALS_MAX; i++) {
    var mesh = new THREE.Mesh(sharedGeo, new THREE.MeshStandardMaterial({
      color: 0x73ff26, roughness: 0.48, metalness: 0, emissive: 0x3a9e00, emissiveIntensity: 0.55
    }));
    mesh.castShadow = true;
    mesh.visible = false;
    var glow = new THREE.Mesh(glowGeo, new THREE.MeshBasicMaterial({
      color: 0x96ff46, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false
    }));
    mesh.add(glow);
    this.scene.add(mesh);

    var blob = new THREE.Mesh(blobGeo, new THREE.MeshBasicMaterial({
      color: 0x000000, transparent: true, opacity: 0.18
    }));
    blob.rotation.x = -Math.PI / 2;
    blob.visible = false;
    this.scene.add(blob);

    var mark = new THREE.Mesh(markGeo, new THREE.MeshBasicMaterial({
      color: 0x7ef0ff, transparent: true, opacity: 0.65, depthWrite: false
    }));
    mark.rotation.x = -Math.PI / 2;
    mark.visible = false;
    this.scene.add(mark);

    this.practiceReturns.push({
      mesh: mesh,
      blob: blob,
      mark: mark,
      active: false,
      age: 0,
      spline: null,
      pos: Physics.vec(0, 0, 0),
      vel: Physics.vec(0, 0, 0),
      spin: Physics.vec(0, 0, 0)
    });
  }
};

Game.prototype._buildPracticeReturnShot = function (targetX, targetZ, apex, margin, spinVec, isAtp) {
  var p0 = Physics.vec(this.ball.pos.x, Math.max(0.5, this.ball.pos.y), this.ball.pos.z);
  var p2 = Physics.vec(targetX, 0, targetZ);
  if (this.mechanicsV2) {
    // Honest flight for the cosmetic return: solve a launch velocity, integrate
    // it with stepV2 in _updatePracticeReturns. Marker sits at the solved landing.
    var sol = Physics.solveArc(p0, { x: targetX, z: targetZ }, {
      apex: apex, margin: margin, spin: spinVec, vMax: 22, allowNet: !!isAtp
    });
    return { v2: true, P0: p0, v0: sol.v0, spin: spinVec, landing: sol.landing };
  }
  var p1 = isAtp
    ? { x: (p0.x + p2.x) * 0.5, y: 0.4, z: p0.z * 0.5 }
    : Physics.computeP1(p0, p2, apex, margin);
  var duration = Physics.splineFlightTime(p0, p2, p1.y);
  return { P0: p0, P1: p1, P2: p2, duration: duration, spin: spinVec };
};

Game.prototype._spawnPracticeReturn = function (shot) {
  if (!this.practiceReturns.length || !shot) return;
  var slot = null;
  for (var i = 0; i < this.practiceReturns.length; i++) {
    if (!this.practiceReturns[i].active) { slot = this.practiceReturns[i]; break; }
  }
  slot = slot || this.practiceReturns[0];
  slot.active = true;
  slot.age = 0;
  if (shot.v2) {
    slot.spline = null;
    slot.v2 = true;
    slot.pos = Physics.clone(shot.P0);
    slot.vel = Physics.clone(shot.v0);
    slot.spin = Physics.clone(shot.spin);
    slot.mark.position.set(shot.landing.x, 0.04, shot.landing.z);
  } else {
    slot.v2 = false;
    slot.spline = {
      P0: Physics.clone(shot.P0),
      P1: Physics.clone(shot.P1),
      P2: Physics.clone(shot.P2),
      duration: shot.duration,
      elapsed: 0
    };
    slot.pos = Physics.clone(shot.P0);
    slot.vel = Physics.vec(0, 0, 0);
    slot.spin = Physics.clone(shot.spin);
    slot.mark.position.set(shot.P2.x, 0.04, shot.P2.z);
  }
  slot.mesh.visible = true;
  slot.blob.visible = true;
  slot.mark.visible = true;
};

Game.prototype._updatePracticeReturns = function (dt) {
  for (var i = 0; i < this.practiceReturns.length; i++) {
    var rb = this.practiceReturns[i];
    if (!rb.active) continue;

    if (rb.v2) {
      // Honest integration of the cosmetic return ball (no rules/scoring).
      rb.age += dt;
      var vb = { pos: rb.pos, vel: rb.vel, spin: rb.spin, live: true };
      var evs = Physics.stepV2(vb, dt);
      rb.pos = vb.pos; rb.vel = vb.vel; rb.spin = vb.spin;
      var landed = evs.some(function (e) { return e.type === 'bounce' || e.type === 'floor-out'; });
      rb.mesh.position.set(rb.pos.x, rb.pos.y, rb.pos.z);
      rb.mesh.rotation.x += rb.vel.z * dt * 2;
      rb.mesh.rotation.z -= rb.vel.x * dt * 2;
      rb.blob.position.set(rb.pos.x, 0.02, rb.pos.z);
      var scv = clamp(1.3 - rb.pos.y * 0.16, 0.35, 1.3);
      rb.blob.scale.setScalar(scv);
      rb.blob.material.opacity = clamp(0.22 - rb.pos.y * 0.024, 0.05, 0.22);
      rb.mark.material.opacity = clamp(0.65 - rb.age * 0.4, 0.26, 0.65);
      if (landed || rb.age > 4) {
        if (landed) this._triggerBounceEffect(rb.pos.x, rb.pos.z);
        rb.active = false; rb.v2 = false;
        rb.mesh.visible = false; rb.blob.visible = false; rb.mark.visible = false;
      }
      continue;
    }

    var sp = rb.spline;
    if (!sp) {
      rb.active = false;
      rb.mesh.visible = false;
      rb.blob.visible = false;
      rb.mark.visible = false;
      continue;
    }
    sp.elapsed += dt;
    var t = Math.min(1, sp.elapsed / (sp.duration || 1));
    var pt = Physics.bezierPoint(sp.P0, sp.P1, sp.P2, t);
    var vt = Physics.bezierVel(sp.P0, sp.P1, sp.P2, t, sp.duration);
    rb.pos = pt;
    rb.vel = vt;
    rb.mesh.position.set(pt.x, pt.y, pt.z);
    rb.mesh.rotation.x += vt.z * dt * 2;
    rb.mesh.rotation.z -= vt.x * dt * 2;
    rb.blob.position.set(pt.x, 0.02, pt.z);
    var sc = clamp(1.3 - pt.y * 0.16, 0.35, 1.3);
    rb.blob.scale.setScalar(sc);
    rb.blob.material.opacity = clamp(0.22 - pt.y * 0.024, 0.05, 0.22);
    rb.mark.material.opacity = clamp(0.65 - t * 0.28, 0.26, 0.65);
    if (t >= 1 || pt.y <= C.BALL_R) {
      this._triggerBounceEffect(sp.P2.x, sp.P2.z);
      rb.active = false;
      rb.spline = null;
      rb.mesh.visible = false;
      rb.blob.visible = false;
      rb.mark.visible = false;
    }
  }
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
  var scores = this.match ? this.match.scores : { near: 0, far: 0 };
  var server = this.match ? this.match.server : 'near';
  var callout = this.mode === 'practice'
    ? Practice.sessionCallout(this.practice || { rep: 0, clean: 0, bestStreak: 0 })
    : Rules.scoreCallout(this.match);
  this.hud.update({
    scores: scores,
    server: server,
    serverNum: this.match ? this.match.serverNum : 0,
    mode: this.mode,
    callout: callout,
    msg: this.msgTimer > 0 ? this._msg : null,
    msgOpacity: Math.min(1, this.msgTimer * 2),
    shotName: this.shotTimer > 0 ? this._shotName : null,
    shotOpacity: Math.min(0.85, this.shotTimer * 1.6),
    level: this.levelMeta,
    isHumanServe: this.isHumanServe()
  });
};

Game.prototype._scorePracticeRep = function (result) {
  var dist = this.practice ? this.practice.nearestDist : 99;
  var timing = null;
  if (this.practice && this.practice.swingAttempted) {
    timing = { grade: this.practice.swingSide > 0 ? 'late' : 'early' };
  }
  return Practice.scoreContact(dist, 0, timing, result || 'whiff');
};

Game.prototype._endPracticeRep = function (feedback) {
  if (!this.practice) return;
  this.practice.rep += 1;
  this.practice.feedback = feedback;
  var clean = feedback && (feedback.key === 'perfect' || feedback.key === 'clean' || feedback.key === 'good');
  if (clean) {
    this.practice.clean += 1;
    this.practice.streak += 1;
    this.practice.bestStreak = Math.max(this.practice.bestStreak, this.practice.streak);
  } else {
    this.practice.streak = 0;
  }
  this.ball.live = false;
  this.ball.spline = null;
  this.state = STATE.SERVE;
  this.practice.timer = this.practice.feedNum <= 1 ? PRACTICE.READY_GAP : PRACTICE.FEED_INTERVAL;
  this._placePracticeFeed();
  this._message(feedback.banner, 1.2);
  this._flashShot(feedback.shot);
};

Game.prototype.render = function () {
  if (this.composer) this.composer.render();
  else this.renderer.render(this.scene, this.camera);
};
