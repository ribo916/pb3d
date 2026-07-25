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
import * as Power from './power.js';
import * as Scene from './scene.js';
import { makePlayer } from './players.js';
import { resolveSlotCharacter } from './characters.js';
import { makeCamera, updateCamera } from './camera.js';
import { makeRecorder, makePlayback, makeOrbitCam } from './replay.js';
import { clamp, dist2D } from './utils.js';
import { HIT, PHYS_V2, STABILITY, POWER_CAP, SPECIALTY, MOVEMENT, PRACTICE, TIMING_V2, REPLAY, SUPER, DRILL } from './constants.js';
import { normalizeMode } from './modes.js';
import * as DrillDirector from './drillDirector.js';

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
  // Which of P1-P4 actually exist for this drill (2/3/4 players) — read by
  // _initWorld's mode==='drill' roster branch. P1/P3 are always present in
  // practice (the anchor slots); P2/P4 are optional.
  this.drillActiveSlots = opts.drillActiveSlots || ['P1', 'P2', 'P3', 'P4'];
  this.onMatchOver = opts.onMatchOver || null;
  this.isMobile = !!opts.isMobile;
  // 'on' | 'off' — lets a match run classic rules with no power meter.
  this.superMode = (opts.superMode === 'off') ? 'off' : 'on';
  // TEST/DEBUG: multiplier on meter charge, and (when > 1) charge on EVERY
  // contact rather than clean ones only, so the super can be exercised without
  // grinding out clean hits. Set via the ?fastsuper=N URL param, or live from
  // the console: window.__game.superChargeMul = 20
  this.superChargeMul = opts.superChargeMul || 1;
  // Set while a super smash is in flight and a victim is marked for the blast.
  this.blast = null;
  // Supers spent per team in the CURRENT rally (see SUPER.MAX_PER_RALLY).
  this._rallySupers = { near: 0, far: 0 };
  // Armed-but-not-yet-executed poach; resolved when the ball reaches the poacher.
  this.pendingPoach = null;
  // Super-smash time dilation state (see _superTimeScale).
  this._timeScale = 1;
  this._superSlowHold = 0;
  // Lightweight always-on match metrics for A/B tuning (see tools/play.mjs).
  this.metrics = { pointsByReason: {}, rallyShots: [], netErrors: 0, serveFaults: 0,
                   // Super-smash balance counters (read by tools/play.mjs):
                   // supersFired vs supersBlasted is the "did it connect" rate;
                   // a low ratio means supers are sailing past unreturnable.
                   supersFired: 0, supersBlasted: 0, supersMissed: 0 };
  this.drillData = null;
  this.drillForcedShot = null;
  this.drillForcedMoves = {};
  this.drillScriptIndex = 0;
  this.drillHitCount = 0;
  this.drillEndGrace = 0;
  this.drillReplaying = false;
  this.drillPlayback = null;
  this._drillLoopHoldTimer = 0;
  this.state = STATE.MENU;
  this.excitement = 0;
  this.cameraShake = 0;
  this.renderQuality = renderQuality(this.isMobile);
  var CAM_MAP = { broadcast: 0, follow: 1, topdown: 2 };
  this.camMode = CAM_MAP[opts.cameraMode] !== undefined ? CAM_MAP[opts.cameraMode] : 1;
  this.msgTimer = 0;
  this.serveDelay = 0;
  this.pointPause = 0;
  // Instant replay: a rolling recorder of live frames + playback state.
  this.recorder = makeRecorder(REPLAY.WINDOW_SEC);
  this.replaying = false;
  this._swingsThisFrame = [];
  this._effectsThisFrame = [];
  this.replayPlayback = null;
  this.replayOrbit = null;
  this.replayFreeCam = false;   // true = free-orbit; false = reuse camMode presets
  this._replayStash = null;
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
      aiSwingTimer: 0, aiReactTarget: 0,
      // Power meter + knockback state (see src/power.js).
      power: Power.makeMeter(), stun: Power.makeStun(),
      voice: (colors && colors.voice) || 'girl',
      characterId: (colors && colors.id) || '',
      jersey: (colors && colors.jersey) || 0x7ce7ff
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
  } else if (this.mode === 'drill') {
    // Variable roster (2/3/4 players) — built from whichever of P1-P4 this
    // drill declares (drillActiveSlots), not always all four. Each player is
    // tagged with .drillSlot so drillDirector.js can resolve 'P1'..'P4' back
    // to the right object regardless of roster size/order.
    this.players = this.drillActiveSlots.map(function (slotKey) {
      var info = DrillDirector.SLOT_INFO[slotKey];
      var p = entry(info.team, info.teamSlot, false, palettes[info.rosterKey]);
      p.drillSlot = slotKey;
      return p;
    });
  } else {
    this.players = [
      entry('near', 0, true,  palettes.nearYou),
      entry('near', 1, false, palettes.nearMate),
      entry('far',  0, false, palettes.farA),
      entry('far',  1, false, palettes.farB)
    ];
  }
  if (this.partnerDiff && this.mode === 'doubles') this.players[1].ai = AI.makeAI(this.partnerDiff, palettes.nearMate.persona);
  // Tap every player's swing trigger so the replay recorder captures swing
  // events (who + type) — they're fire-and-forget and can't be re-derived from
  // pos/vel. Wrapping here covers all call sites (serve, human, CPU, partner).
  var self = this;
  this.players.forEach(function (pl, i) {
    var origSwing = pl.mesh.swing.bind(pl.mesh);
    pl.mesh.swing = function (type) {
      if (!self.replaying) self._swingsThisFrame.push({ player: i, type: type });
      return origSwing(type);
    };
  });
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

    // Blast shockwave at the victim's feet when a super connects. Additive so it
    // reads without bloom (mobile defaults to medium quality, bloom off).
    var blastFxMat = new THREE.MeshBasicMaterial({
      color: 0xffb02e,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    var blastFx = new THREE.Mesh(new THREE.RingGeometry(0.30, 0.52, 40), blastFxMat);
    blastFx.rotation.x = -Math.PI / 2;
    blastFx.visible = false;
    blastFx.frustumCulled = false;
    blastFx.renderOrder = 5;
    this.scene.add(blastFx);
    this.blastFx = { mesh: blastFx, age: 0, dur: 0.42 };

    // Dust puff kicked up as the body lands — pairs with the ground-thud SFX.
    var dustFxMat = new THREE.SpriteMaterial({
      map: makeHitFxTexture(),
      color: 0xd8c9a8,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    var dustFx = new THREE.Sprite(dustFxMat);
    dustFx.visible = false;
    dustFx.frustumCulled = false;
    dustFx.renderOrder = 6;
    this.scene.add(dustFx);
    this.dustFx = { mesh: dustFx, age: 0, dur: 0.5 };

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
// A team of 1 (real singles mode, or a solo-side drill) covers full width —
// checked by team size, not match mode, so a solo drill-mode team gets the
// same "no lane restriction" treatment singles always had.
Game.prototype._laneSign = function (p) {
  if (this._teamPlayers(p.team).length === 1) return 0;
  var side = (p.slot === Rules.rightSlot(this.match, p.team)) ? 'R' : 'L';
  return Rules.sideX(p.team, side);
};

// The slot on a team responsible for a given x-lane ("yours/mine"). A team
// of 1 is always responsible for everything on their side — same team-size
// check as _laneSign above, not a mode check, so it also covers a solo-side
// drill team correctly (their one player is always team-slot 0 already).
Game.prototype._responsibleSlot = function (team, atX) {
  if (this._teamPlayers(team).length === 1) return 0;
  var sgn = ((atX !== undefined ? atX : this.ball.pos.x) >= 0) ? 1 : -1;
  var pick = 0;
  for (var slot = 0; slot < 2; slot++) {
    var side = (slot === Rules.rightSlot(this.match, team)) ? 'R' : 'L';
    if (Rules.sideX(team, side) === sgn) { pick = slot; break; }
  }
  // Doubles only: if the lane owner is face-down from a super, their partner
  // covers. Without this the ball keeps being assigned to the player on the
  // ground and every blasted rally dies instantly. Singles has no partner —
  // which is exactly why a singles super is near-lethal.
  var owner = this._player(team, pick);
  if (owner && Power.stunBlocksInput(owner.stun)) {
    var mate = this._player(team, pick === 0 ? 1 : 0);
    if (mate && !Power.stunBlocksInput(mate.stun)) return pick === 0 ? 1 : 0;
  }
  return pick;
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
  if (this.input) {
    this.input.state.serveQueued = false;
    this.input.state.swingQueued = false;
    // Also drop the queued shot TYPE. Without this a lob (or a super) queued at
    // the end of one rally survives into the next and fires on the first swing.
    this.input.state.swingShot = null;
    this.input.state.superQueued = false;
  }
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
  var feedSpin = Physics.vec(2.4, (Math.random() - 0.5) * 0.7, 0);
  this.ball.pos = Physics.clone(p0);
  this._executeShotV2(p2.x, p2.z, PRACTICE.FEED_APEX, PRACTICE.FEED_MARGIN, feedSpin, { type: 'feed' });
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
  var srvSpec = Shots.specV2('serve', C.KITCHEN, C.HALF_L);
  var srvSpin = Physics.vec(srvSpec.spinX * -fwd, 0, 0);
  this.ball.pos = Physics.clone(p0);
  this._executeShotV2(target.x, target.z, srvSpec.apex, srvSpec.margin, srvSpin, { type: 'serve' });
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
  // Meters decay but do not reset between points: a full reset makes the bar
  // unreachable (a median rally is only 2-4 clean contacts per player), while
  // full persistence turns it into a stale bank.
  this.blast = null;
  this.pendingPoach = null;
  this._rallySupers = { near: 0, far: 0 };
  for (var pi = 0; pi < this.players.length; pi++) {
    Power.carryPoint(this.players[pi].power);
    this.players[pi].stun = Power.makeStun();
  }

  if (this.mode === 'drill') {
    // Don't reuse _resultMessage() — it says "You score!"/"Opponent WINS",
    // meaningless with no human in a drill. Reps never accumulate real
    // score/game-over either, so a long drill session can't trip one.
    this.pointPause = DRILL.REP_PAUSE;
    // Hitting the cap always shows as a deliberate "REP COMPLETE," not
    // whatever literal fault reason the untouched ball happened to trigger
    // (typically 'no-return') — an earlier, genuine fault still shows its
    // real reason.
    var reason = (this.drillHitCount >= this._drillMaxShots()) ? 'drill-end' : result.reason;
    var label = DrillDirector.DRILL_RESULT_LABELS[reason] || (result.scored ? 'Point' : 'Side out');
    this._message(label, 1.0);
    this.match.scores = { near: 0, far: 0 };
    this.match.gameOver = false; this.match.winner = null;
    return;
  }

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
/* Sim time scale. Slows the whole simulation while a super smash is live so the
 * beat is actually watchable — see SUPER.TIME_SCALE for why this exists.
 * Returns the scaled dt; everything downstream (physics, AI, animation AND the
 * replay recorder) sees the slowed stream, so replay reproduces it exactly. */
Game.prototype._superTimeScale = function (dt) {
  var want = 1;
  if (this.superMode !== 'off') {
    if (this.ball.superHot && this.ball.live && this.state === STATE.RALLY) {
      want = SUPER.TIME_SCALE;
      this._superSlowHold = SUPER.TIME_HOLD_AFTER;
    } else if (this._superSlowHold > 0) {
      // Keep it slow through the knockdown, then ease out.
      this._superSlowHold = Math.max(0, this._superSlowHold - dt);
      want = SUPER.TIME_SCALE;
    }
  } else {
    this._superSlowHold = 0;
  }
  var cur = (this._timeScale == null) ? 1 : this._timeScale;
  // Ease down fast (the hit should bite immediately), ease back out gently.
  var ramp = (want < cur) ? SUPER.TIME_RAMP_IN : SUPER.TIME_RAMP_OUT;
  var step = ramp > 0 ? (dt / ramp) : 1;
  this._timeScale = cur + clamp(want - cur, -step, step);
  if (Math.abs(this._timeScale - 1) < 0.01 && want === 1) this._timeScale = 1;
  return dt * this._timeScale;
};

Game.prototype.update = function (dt) {
  dt = Math.min(dt, 1 / 30);
  dt = this._superTimeScale(dt);
  this.excitement = Math.max(0, this.excitement - dt * 0.7);
  this.cameraShake = Math.max(0, this.cameraShake - dt * 0.8);
  this.msgTimer = Math.max(0, this.msgTimer - dt);
  this.shotTimer = Math.max(0, (this.shotTimer || 0) - dt);

  // Advance every knockback timeline before anything reads p.stun this frame.
  // The body-hits-ground thud fires on the blown->down edge, so it lands when
  // the body actually meets the floor rather than at the moment of contact.
  for (var si = 0; si < this.players.length; si++) {
    var sp = this.players[si];
    var wasBlown = sp.stun.phase === 'blown';
    Power.tickStun(sp.stun, dt);
    if (wasBlown && sp.stun.phase === 'down' && this.audio && this.audio.sfx.bodyThud) {
      this.audio.sfx.bodyThud();
    }
  }

  var inp = this.input ? this.input.poll() : null;
  if (this.swingWindow > 0) this.swingWindow -= dt;

  if (this.input && this.input.consumeCamCycle()) this._cycleCamera();

  // Drill mode drives players[0] via real AI (see _initWorld's roster
  // builder) — _updateHuman would otherwise fight _moveCPU's steering every
  // frame, actively decelerating vel toward zero right before _moveCPU
  // re-accelerates it toward the AI's target.
  if (this.mode !== 'drill') this._updateHuman(dt, inp);
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

  if (this.mode === 'drill') this._tickDrill(dt);
  else if (this.mode === 'practice') this._tickPractice(dt);
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

  // Feed the rolling replay buffer with this live frame, then clear the
  // per-frame swing list (populated by the wrapped mesh.swing triggers above).
  if (this.state !== STATE.MENU) this.recorder.record(this._captureFrame(), dt);
  this._swingsThisFrame = [];
  this._effectsThisFrame = [];
};

// Compact, mesh-relevant snapshot of the current live frame (plain numbers).
Game.prototype._captureFrame = function () {
  var b = this.ball;
  var players = [];
  for (var i = 0; i < this.players.length; i++) {
    var p = this.players[i], m = p.move || {};
    players.push({
      pos: { x: p.pos.x, z: p.pos.z },
      vel: { x: p.vel.x, z: p.vel.z },
      move: { kind: m.kind || '', split: m.split || 0, plant: m.plant || 0, lunge: m.lunge || 0,
              target: m.target ? { x: m.target.x, z: m.target.z } : null },
      // Meter + knockback, so the highlight of the match doesn't replay as a
      // normal ball and a standing victim.
      power: p.power ? p.power.charge : 0,
      armed: p.power ? p.power.armed : false,
      stun: p.stun ? { phase: p.stun.phase, t: p.stun.t, dur: p.stun.dur,
                       dirX: p.stun.dirX, dirZ: p.stun.dirZ } : null
    });
  }
  var m = this.match;
  return {
    ball: {
      pos: { x: b.pos.x, y: b.pos.y, z: b.pos.z },
      vel: { x: b.vel.x, y: b.vel.y, z: b.vel.z },
      spin: { x: b.spin.x, y: b.spin.y, z: b.spin.z },
      live: b.live,
      // Without this the highlight of the match replays as an ordinary fast
      // ball — no glow, no ribbon, no trail heat.
      superHot: !!b.superHot
    },
    players: players,
    hud: {
      scores: m ? { near: m.scores.near, far: m.scores.far } : { near: 0, far: 0 },
      server: m ? m.server : 'near',
      serverNum: m ? m.serverNum : 0
    },
    swings: this._swingsThisFrame.length ? this._swingsThisFrame.slice() : null,
    effects: this._effectsThisFrame.length ? this._effectsThisFrame.slice() : null
  };
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
    if (this.ball.flight) this.ball.flight.elapsed += h;
    var evs2 = Physics.stepV2(this.ball, h);
    for (var j = 0; j < evs2.length; j++) { this._clearFlightOn(evs2[j]); this._handleBallEvent(evs2[j]); }
    if (this.state !== STATE.RALLY) return;
    // Checked per SUBSTEP, not per frame: a super travels ~0.5m per frame, so a
    // frame-rate check could step straight past the victim.
    if (this.blast) {
      this._checkBlastContact();
      if (this.state !== STATE.RALLY) return;
    }
    if (this.pendingPoach) {
      this._checkPoachContact();
      if (this.state !== STATE.RALLY) return;
    }
    if (this.ball.superHot) this._sampleTrail();
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
    if (this.ball.flight) this.ball.flight.elapsed += h;
    var evs2 = Physics.stepV2(this.ball, h);
    for (var j = 0; j < evs2.length; j++) { this._clearFlightOn(evs2[j]); this._handlePracticeBallEvent(evs2[j]); }
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

// v2: drop the cached flight prediction once the ball bounces/nets, so the AI
// stops trusting a stale landing point and forward-integrates the roll-out.
Game.prototype._clearFlightOn = function (e) {
  if (e && (e.type === 'bounce' || e.type === 'floor-out' || e.type === 'net')) {
    this.ball.flight = null;
    // The super's heat and its pending blast both end the moment the ball
    // touches anything — if it bounced, the victim never got blasted. That is
    // the honest "couldn't reach it" outcome, counted for balance tracking.
    if (this.blast && this.metrics) this.metrics.supersMissed++;
    this.ball.superHot = false;
    this.blast = null;
    // A poach that never materialised (the ball bounced first) is simply off.
    this.pendingPoach = null;
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

Game.prototype._playPaddleContact = function (p, visualSwingType, effectMag) {
  p.mesh.swing(visualSwingType);
  if (this.audio) this.audio.sfx.paddle();
  this._triggerHitEffect(effectMag);
  this.cameraShake = Math.max(this.cameraShake, 0.08);
};

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
  // Blasted: no input at all. Slide backward under the knockback, then lie
  // there. humanPos IS players[0].pos (aliased), so writing it here is enough.
  var me = this.players[0];
  if (me && Power.stunBlocksInput(me.stun)) {
    var slide = Power.stunSlideSpeed(me.stun);
    this.humanVel.x = me.stun.dirX * slide;
    this.humanVel.z = me.stun.dirZ * slide;
    this.humanPos.x = clamp(this.humanPos.x + this.humanVel.x * dt, -C.HALF_W - 1.5, C.HALF_W + 1.5);
    this.humanPos.z = clamp(this.humanPos.z + this.humanVel.z * dt, 0.3, C.HALF_L + 2.0);
    me.move.kind = 'stun';
    return;
  }
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
  // Blasted: skip AI entirely so no stale plan accumulates in ai.target, and
  // slide backward under the knockback.
  if (Power.stunBlocksInput(p.stun)) {
    var sl = Power.stunSlideSpeed(p.stun);
    p.vel.x = p.stun.dirX * sl;
    p.vel.z = p.stun.dirZ * sl;
    p.pos.x = clamp(p.pos.x + p.vel.x * dt, -C.HALF_W - 1.5, C.HALF_W + 1.5);
    var lim = (p.team === 'near') ? 1 : -1;
    p.pos.z = clamp(p.pos.z + p.vel.z * dt,
      lim > 0 ? 0.3 : -(C.HALF_L + 2.0), lim > 0 ? (C.HALF_L + 2.0) : -0.3);
    p.move.kind = 'stun';
    return;
  }
  var team = p.team, fwd = (team === 'near') ? 1 : -1;
  var rally = this.match.rally;
  var lane = this._laneSign(p);                    // ±1: this player's side of center
  var incoming = this.ball.live && (this.ball.vel.z * fwd > 0);
  var pred = incoming ? AI.predict(this.ball) : null;
  // While a drill script beat is pending, _responsibleSlot's x-zone guess
  // (real-serve-rotation math, keyed off match.scores — always {0,0} in a
  // drill, per resetRep) is not just unnecessary but actively wrong: a
  // freeform drill placement (e.g. 4 corners) can make it independently
  // pick the WRONG teammate as "responsible," sending them chasing across
  // the court for a ball _checkContacts will only ever award to the actual
  // drillForcedShot.hitter anyway. Suppressed only while a beat is armed —
  // once the script runs out (drillForcedShot null), the real zone check
  // resumes for the genuine undirected free-play tail.
  var drillCapped = this.mode === 'drill' && this.drillHitCount >= this._drillMaxShots();
  var responsible = (this.mode === 'drill' && (this.drillForcedShot || drillCapped)) ? false :
    pred && (this.mode === 'singles' || p.slot === this._responsibleSlot(team, pred.x));
  // A drill's armed forced-shot target must actively move to intercept
  // regardless of the x-zone rotation (see the matching override in
  // _checkContacts) — otherwise they'd stand there "not responsible" while
  // the ball sails past, and the scripted shot would strand the rep.
  if (!drillCapped && this.drillForcedShot && this.drillForcedShot.hitter === p) responsible = true;
  // Strategy dispatch is per-TEAM, not per-match: a solo drill-mode team
  // (2/3-player drill) plays singles.js's movement logic (full-court
  // coverage, no partner/lane assumptions) even though the match's overall
  // mode is 'drill' and the opposing team may still be a real 2-player
  // doubles pair running strategies/doubles.js. ctx.mode is ONLY read by
  // ai.js's strategyForMode() for this dispatch — safe to override locally
  // without touching this.mode (still 'drill' everywhere else).
  var stratMode = (this._teamPlayers(team).length === 1) ? 'singles' : this.mode;
  var strategy = AI.chooseMovement(p.ai, this.ball, rally, {
    mode: stratMode,
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

  // A player who isn't currently and genuinely fetching the ball (and has no
  // active `moves` cue) defaults to holding their exact current spot in
  // drill mode — instead of each strategy's normal free-play positioning
  // formula (doubles.js's kitchen-advance default, or singles.js's
  // opponent-mirrored recovery), both tuned for organic free rallies, not a
  // deliberately positioned drill rep. Applies to doubles-shaped teams too
  // (2+ players/side), not just solo teams: drillDirector.js's
  // fireOpeningShot seeds every drill rally as already "open" specifically
  // so doubles.js's advanceAllowed reads true immediately, which otherwise
  // pulls EVERY player — including the two scripted hitters between their
  // own touches — toward the kitchen line by default. DRILLS.md documents
  // this as the intended contract ("script shadowing explicitly via `moves`
  // cues, don't rely on default AI") — this just enforces it universally.
  //
  // Gated on `pred && responsible`, not plain `responsible`: `responsible`
  // is forced true for the armed scripted hitter unconditionally (see
  // above), even before the ball is actually live and heading their way
  // (`pred` still null) — without the `pred` half, an armed-but-not-yet-
  // incoming hitter would fall through to the strategy's default formula
  // instead of holding. For a solo team this is equivalent to the old plain
  // `!responsible` gate (responsible there already reduces to exactly
  // `pred`), so the previously-verified 2-player case is unaffected.
  //
  // A `moves` cue (below) always takes priority over this default. Even
  // after the last scripted shot has fired (drillForcedShot already nulled),
  // drill mode keeps everyone on-script by holding rather than dropping back
  // into normal rally positioning before the rep resets.
  if (this.mode === 'drill' &&
      !(pred && responsible) && !(this.drillForcedMoves && this.drillForcedMoves[p.drillSlot])) {
    tx = p.pos.x; tz = p.pos.z; kind = 'hold';
  }

  // A drill movement cue (game.drillForcedMoves, armed by
  // DrillDirector.armMovesForBeat) overrides the AI-chosen steering target —
  // but never while this player is the currently-armed ball responsibility;
  // reaching the ball always wins (same precedent as the drillForcedShot
  // override on `responsible` above). Still flows into the same
  // Movement.seek() call below, so real accel/decel/arrive physics — not a
  // faked/interpolated position — produces the resulting motion.
  var forcedMoveHitter = this.drillForcedShot && this.drillForcedShot.hitter === p;
  var forcedMove = this.drillForcedMoves && this.drillForcedMoves[p.drillSlot];
  if (forcedMove) {
    if (forcedMoveHitter) {
      // This player has just become the armed hitter — any outstanding cue
      // from an earlier beat is now stale (a fresh cue for their OWN beat,
      // if authored, would already have overwritten it via
      // armMovesForBeat's per-slot merge). Drop it now instead of leaving
      // it dangling: left alone, it never gets deleted while they're the
      // hitter (that only happens in the `else` branch below), so the
      // moment they stop being the hitter it reactivates and steers them
      // toward a beat-old, outdated position instead of holding/recovering
      // where they actually are.
      delete this.drillForcedMoves[p.drillSlot];
    } else {
      tx = forcedMove.x; tz = forcedMove.z;
      if (dist2D(tx - p.pos.x, tz - p.pos.z) <= MOVEMENT.CPU_ARRIVE) {
        delete this.drillForcedMoves[p.drillSlot];
      }
    }
  }

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
  // Drill mode never restricts x by service lane, for any team size — not
  // just the lane===0 solo-team sentinel. _laneSign's ±1 lane assignment
  // comes from Rules.rightSlot, a real-serve-rotation concept keyed off
  // match score parity; a drill's match.scores is always reset to {0,0}
  // (resetRep), so that assignment is arbitrary/deterministic-but-
  // meaningless relative to where the drill actually placed its players.
  // validateDrill/DRILLS.md explicitly promise "no positional/zone
  // constraint — anywhere on your own side of the net" for startPositions;
  // without this, a doubles-shaped drill whose corner placement happens to
  // conflict with that arbitrary lane assignment gets one partner hard-
  // clamped clear across the center line every frame (observed: a player
  // placed at x=-4 snapped to x=-0.7, a 3m+ position jump, independent of
  // any AI/movement-cue target).
  this._clampToSide(p.pos, team, (this.mode === 'singles' || this.mode === 'drill') ? null : lane);
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
  // "The drill is the drill" — once the cap is reached, stop letting anyone
  // return the ball. It naturally bounces out untouched and the existing
  // real fault detection (Rules.onFloor's "no-return" rule) ends the point
  // for free — no separate forced-cutoff timer needed, and the capping
  // shot's own flight always completes and lands naturally first.
  if (this.mode === 'drill' && this.drillHitCount >= this._drillMaxShots()) return;
  if (this.lastHitCooldown > 0) return;
  var rally = this.match.rally;
  if (!rally) return;
  // The receiving team is whichever side the ball is on.
  var team = (this.ball.pos.z > 0) ? 'near' : 'far';
  if (rally.lastHitter === team) return;            // our own shot still outgoing
  var p = this._player(team, this._responsibleSlot(team));
  // A drill's forced/scripted shot always goes to its named target, full
  // stop — not "whichever teammate the real x-zone rotation happens to
  // assign," which only matches the intended target if they were authored
  // standing in that specific zone. Overriding here (same shape as the
  // human-poach override just below) means a script's target can be
  // authored ANYWHERE on their own side and still reliably receive the
  // shot; drillStore.js's validateDrill no longer needs a zone check.
  if (this.drillForcedShot && this.drillForcedShot.hitter.team === team) p = this.drillForcedShot.hitter;
  if (!p) return;
  // Human poach: the human may take a ball assigned to their partner by
  // stepping in front and timing a swing while within reach.
  // A stunned human can't poach — they're on the ground.
  var human = this.players[0];
  if (human.team === team && human !== p && !Power.stunBlocksInput(human.stun) &&
      this.swingWindow > 0 && !this.swingUsed && this._reachOK(human.pos)) {
    p = human;
  }
  // A blasted player has no agency at all. This is the gate that makes the
  // recovery pause actually cost the next ball instead of being decoration.
  if (Power.stunBlocksInput(p.stun)) return;
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
    // A charged AI holds out for a HIGHER ball than normal, so it visibly sets
    // up its overhead instead of spending the meter on a marginal one.
    var waitH = (this.superMode !== 'off' && p.power && p.power.armed)
      ? SUPER.AI_WAIT_H : POWER_CAP.SMASH_H;
    if (this.ball.vel.y > 0 && this.ball.pos.y < waitH) {
      var gAct = PHYS_V2.GRAVITY;
      var peakY = this.ball.pos.y + (this.ball.vel.y * this.ball.vel.y) / (2 * gAct);
      if (peakY >= waitH) {
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
  var sr = Shots.resolveV2(Math.abs(pos.z), this.ball.pos.y, intent, C.KITCHEN, C.HALF_L);
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

// Quality → apex degradation. v2 adds a modest, capped loft (a mishit is a
// "slightly high" attackable ball, never a lob — see Shots.apexForQualityV2).
Game.prototype._apexForQuality = function (baseApex, quality) {
  return Shots.apexForQualityV2(baseApex, quality);
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

// Bank power-meter charge for a paddle contact. Only CLEAN contacts pay, so the
// meter rewards timing rather than rally length. The economy itself lives in
// src/power.js so it stays node-testable.
Game.prototype._chargeMeter = function (p, quality, stabilityIdx) {
  if (!p || !p.power || this.superMode === 'off') return;
  var before = p.power.armed;
  var mul = this.superChargeMul || 1;
  // With the test flag on, ANY contact charges — otherwise you still have to
  // land clean hits to see the feature, which defeats the point of the flag.
  var q = (mul > 1) ? 'clean' : quality;
  var idx = (mul > 1 && stabilityIdx == null) ? 1 : stabilityIdx;
  Power.addCharge(p.power, Power.chargeFor(q, idx) * mul);
  // Announce the moment a human's bar fills — it's the cue to look for a high ball.
  if (!before && p.power.armed && p.isHuman) {
    this._message('SUPER READY', 1.2);
    if (this.audio && this.audio.sfx.superReady) this.audio.sfx.superReady();
  }
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
  var zOff = (this.ball.pos.z - p.pos.z) * fwd; // negative = in front, both teams
  var offset = Shots.timingOffsetFromContact(zOff);
  return Shots.applyTiming(offset, swingType, fwd);
};

// v2 timing-quality for a CPU: gaussian offset scaled by the tier's `timing`
// sigma. CPUs take only the pace/loft consequences — the lateral skew is zeroed
// because directional variance is already owned by cfg.err (strategies' aim
// scatter); keeping both double-counts lateral error at the low tiers.
Game.prototype._cpuTiming = function (ai, swingType, fwd) {
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

// Shot executor: routes a resolved shot to the flight solver. Receives the
// already-computed target/apex/margin/spin (apex is quality-adjusted, spin is
// sign-flipped by -fwd, targetX includes aim blend); opts carries the shot type
// + timing so the solver can pull vMax/direct/allowNet and apply the timing
// pace/loft.
Game.prototype._executeShot = function (targetX, targetZ, apex, margin, spinVec, opts) {
  this._executeShotV2(targetX, targetZ, apex, margin, spinVec, opts || {});
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
  // Any new contact cools the ball; _executeSuper re-lights it right after.
  this.ball.superHot = (opts.type === 'supersmash');
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
  if (rallyOver(res)) {
    this._playPaddleContact(p, visualSwingType);
    this._endPoint(res);
    return;
  }

  // Super smash — the power-meter spend. Checked BEFORE the ATP/Erne branches so
  // an explicit super is never silently converted into a specialty shot because
  // the player drifted wide, and AFTER the rally-over check so the meter is
  // never spent on a swing that already ended the point.
  //
  // A blocked super (too low, too early, kitchen volley) does NOT fire and does
  // NOT spend — the swing falls through to the normal path below and faults or
  // plays on exactly as it would have. You lose the point but keep the meter.
  if (this.swingShot === 'super' && this.superMode !== 'off' &&
      Power.canUnleash(p.power, this.ball.pos.y, {
        shots: rally ? rally.shots : 0,
        phase: rally ? rally.phase : '',
        volley: volley,
        inKitchen: inKitchen,
        teamUsed: this._rallySupers[p.team] || 0
      })) {
    Power.spend(p.power);
    this._executeSuper(p, fwd, this._aimTarget(p));
    return;
  }

  // ATP — flat around-the-post arc, only at Pro level.
  if (this.difficulty === 'hard' && this._isAtpPosition(p)) {
    this._playPaddleContact(p, visualSwingType);
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
    this._playPaddleContact(p, visualSwingType);
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
  this._chargeMeter(p, quality, stabilityIdx);

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
    this._playPaddleContact(p, visualSwingType);
    var dbTarget = Shots.dinkBattleTarget(pos, this.ball.pos, fwd, C.KITCHEN, C.HALF_W);
    var dbBaseApex = Shots.specV2('dink', C.KITCHEN, C.HALF_L).apex;
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
    this._playPaddleContact(p, visualSwingType);
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
  this._playPaddleContact(p, visualSwingType);
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

/* Launch a super smash and mark the receiver for the blast.
 * Shared by the human (_hit) and CPU (_cpuHit) paths so both deliver an
 * identical shot. `at` is the resolved aim target from _aimTarget/AI. */
Game.prototype._executeSuper = function (p, fwd, at) {
  var pos = p.pos;
  var blend = clamp((at && at.aim) || 0, -1, 1);

  // A super smash is aimed AT A PLAYER, not at a patch of court — that is the
  // whole point of a body bag. Pick the victim first, then solve the shot at
  // them; the blast marker uses the same player, so intent and outcome can't
  // disagree. Lateral input chooses WHICH opponent rather than a court spot.
  var victim = this._pickSuperVictim(p, blend);
  var spec = Shots.specV2('supersmash', C.KITCHEN, C.HALF_L);
  var targetX, targetZ;
  if (victim) {
    // Clamp into the court so aiming at someone stretched wide or standing
    // behind the baseline can't turn the super into an out-of-bounds fault.
    targetX = clamp(victim.pos.x, -C.HALF_W * 0.94, C.HALF_W * 0.94);
    // Keep it off the kitchen line too: a target that short makes the driven
    // solve steep and slow, which reads as a dud rather than a rocket.
    var vz = clamp(Math.abs(victim.pos.z), C.KITCHEN + 0.35, C.HALF_L * 0.94);
    targetZ = -fwd * vz;
  } else {
    targetX = blend * C.HALF_W * 0.92;
    targetZ = -fwd * spec.landZ;
  }
  var spin = Physics.vec(9.0 * -fwd, blend * 1.5, 0);

  p.mesh.swing('smash');
  this._flashShot('SUPER SMASH');
  this.cameraShake = Math.max(this.cameraShake, SUPER.SHAKE_DELIVER);
  this._triggerHitEffect(1.8);
  this.excitement = 1.0;
  if (this.audio && this.audio.sfx.superHit) this.audio.sfx.superHit();

  var tm = this._humanTiming(p, Shots.swingSide(pos.x, this.ball.pos.x, fwd), fwd);
  this._executeShotV2(targetX + tm.targetXSkew, targetZ,
    POWER_CAP.NET_H + 0.06, 0.04, spin,
    { type: 'supersmash', paceMul: tm.paceMul, apexAdd: 0 });

  // The blast resolves in _checkBlastContact once the ball reaches them.
  // (_executeShotV2 already marked the ball hot.)
  if (this.metrics) this.metrics.supersFired++;
  this._rallySupers[p.team] = (this._rallySupers[p.team] || 0) + 1;
  // Reset the trail so the ribbon starts at the paddle instead of stretching
  // back over wherever the ball came from.
  if (this.world && this.world.trailBuf) this.world.trailBuf.length = 0;
  this.blast = victim
    ? { team: victim.team, victim: victim, attacker: p }
    : null;
};

/* Choose who eats the super.
 *
 * Lateral aim picks the side in doubles; with the stick near neutral we target
 * whoever is closest to the net, since they have the least time to react and
 * make the most dramatic target. */
Game.prototype._pickSuperVictim = function (attacker, aimBlend) {
  // NOTE: _opponentsFor() returns {a, b}, NOT an array — use _teamPlayers.
  var foes = this._teamPlayers(attacker.team === 'near' ? 'far' : 'near');
  if (!foes || !foes.length) return null;
  var live = [];
  for (var i = 0; i < foes.length; i++) {
    if (!Power.stunBlocksInput(foes[i].stun)) live.push(foes[i]);
  }
  if (!live.length) live = foes;          // everyone down: still aim at someone
  if (live.length === 1) return live[0];

  if (Math.abs(aimBlend) > 0.2) {
    var wantSign = aimBlend > 0 ? 1 : -1;
    var aimed = null;
    for (var j = 0; j < live.length; j++) {
      var s = live[j].pos.x >= 0 ? 1 : -1;
      if (s === wantSign) {
        if (!aimed || Math.abs(live[j].pos.x) > Math.abs(aimed.pos.x)) aimed = live[j];
      }
    }
    if (aimed) return aimed;
  }
  // Neutral aim: the most exposed opponent — the one closest to the net.
  var best = live[0];
  for (var k = 1; k < live.length; k++) {
    if (Math.abs(live[k].pos.z) < Math.abs(best.pos.z)) best = live[k];
  }
  return best;
};

/* The scripted intercept: a super smash body-bags the marked receiver.
 *
 * WHY THIS IS SCRIPTED AND NOT A STABILITY PENALTY:
 * _checkContacts is gated on `lastHitCooldown > 0` (0.12s). A super covers ~3.6m
 * in that window and kitchen-to-kitchen is only ~4.3m, so a super struck near the
 * net arrives BEFORE the receiver is even eligible to be checked — they would be
 * silently skipped and it would be a free winner. Bypassing the cooldown here is
 * the whole point, and it is also what lets the victim contact the ball "while
 * being blown back": there is no reach gate to fail, no swing to time, and no
 * cooldown to wait out. Paddle contact and knockback fire in the same instant. */
Game.prototype._checkBlastContact = function () {
  var b = this.blast;
  if (!b || !b.victim || !this.ball.live) return;
  var rally = this.match.rally;
  if (!rally || !rally.live) return;
  // Only once the ball has actually crossed to the receiving side.
  var onTheirSide = (b.team === 'near') ? (this.ball.pos.z > 0) : (this.ball.pos.z < 0);
  if (!onTheirSide) return;

  var v = b.victim;
  var dx = this.ball.pos.x - v.pos.x, dz = this.ball.pos.z - v.pos.z;
  // Wider than HIT.REACH: the victim is being knocked INTO the ball, not
  // reaching for it.
  if (dist2D(dx, dz) > HIT.REACH * SUPER.BLAST_REACH_MUL) return;
  if (this.ball.pos.y > SUPER.BLAST_REACH_Y || this.ball.pos.y <= 0) return;

  this.blast = null;
  this.ball.superHot = false;
  if (this.metrics) this.metrics.supersBlasted++;

  var fwd = (v.team === 'near') ? 1 : -1;
  var volley = rally.bouncesSinceHit < 1;
  // The victim is EXEMPT from the kitchen-volley rule. Faulting someone for
  // being hit by the opponent's shot while standing in the kitchen would be
  // perverse; SUPER.MIN_SHOTS already guarantees the two-bounce lock is open.
  var res = Rules.onPaddleHit(this.match, v.team, { volley: volley, inKitchen: false });

  // They DO get a paddle on it — that is the design.
  v.mesh.swing(Shots.swingSide(v.pos.x, this.ball.pos.x, fwd));
  this._triggerBlastEffect(v);
  this.cameraShake = Math.max(this.cameraShake, SUPER.SHAKE_BLAST);
  this.excitement = 1.0;
  if (this.audio && this.audio.sfx.blastGrunt) {
    this.audio.sfx.blastGrunt(v.voice, this._voiceDetune(v));
  }

  Power.applyBlast(v.stun, Power.blastDirection(
    b.attacker ? b.attacker.pos.x : this.ball.pos.x,
    b.attacker ? b.attacker.pos.z : -this.ball.pos.z,
    v.pos.x, v.pos.z));

  if (rallyOver(res)) { this._endPoint(res); return; }

  // The forced return: a weak, high, short sitter back over the net. Not a
  // guaranteed put-away — its hang time is tuned to outlast the stun so a
  // doubles partner can cover. In singles there is nobody to cover, which is
  // deliberate.
  var popSpec = Shots.specV2('blastpop', C.KITCHEN, C.HALF_L);
  var popX = clamp(v.pos.x * 0.5, -C.HALF_W * 0.6, C.HALF_W * 0.6);
  var popZ = -fwd * popSpec.landZ;
  this._flashShot('BLASTED!');
  this._executeShotV2(popX, popZ, popSpec.apex, popSpec.margin,
    Physics.vec(popSpec.spinX * -fwd, 0, 0), { type: 'blastpop' });
  this._checkPoach(v.team);
};

// CPU paddle strike. Shot chosen by AI using the shot solver + stability.
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

  // "The drill is the drill" — a bounded, repeatable sequence, not
  // open-ended AI play. _checkContacts stops processing further hits once
  // this reaches DRILL.MAX_SHOTS, so this shot's own flight always
  // completes and lands naturally before the (untouched) ball triggers a
  // real "no-return" fault. drillEndGrace is a backstop only (armed once,
  // never reset — no further hits can occur once capped): a low-energy
  // shot can settle after a single bounce and never produce the second one
  // "no-return" needs, which would otherwise strand the rep forever.
  if (this.mode === 'drill') {
    this.drillHitCount++;
    if (this.drillHitCount >= this._drillMaxShots()) this.drillEndGrace = DRILL.END_GRACE;
  }

  var opponents = this._opponentsFor(p.team);
  // Stability at contact doubles as an incoming-difficulty signal: a stretched,
  // sprinting contact (low index) makes the AI more error-prone. Computed once
  // here and reused for the apex-quality degradation below.
  var stabilityIdx = this._computeStability(p);
  var shot;
  // Captured BEFORE armNextScriptedShot below can null drillForcedShot (on
  // the script's final beat) — _checkPoach needs to know whether THIS shot
  // was scripted, not whether a FUTURE one is armed.
  var firedScriptedShot = !!(this.drillForcedShot && this.drillForcedShot.hitter === p);
  if (firedScriptedShot) {
    var firingBeat = this.drillData.script[this.drillScriptIndex];
    shot = DrillDirector.getScriptedShot(this, this.drillData, this.drillScriptIndex, p);
    DrillDirector.armMovesForBeat(this, firingBeat);
    this.drillScriptIndex++;
    DrillDirector.armNextScriptedShot(this, this.drillData);
  } else {
    // Same per-team strategy dispatch as _moveCPU — see its comment.
    var stratMode = (this._teamPlayers(p.team).length === 1) ? 'singles' : this.mode;
    shot = AI.chooseShot(p.ai, this.ball, this.match, false, {
      mode: stratMode,
      opponents: opponents,
      hitterPos: pos,
      hitterTeam: p.team,
      servingTeam: this.match.server,
      contactQuality: stabilityIdx,
      superReady: this.superMode !== 'off' && !!(p.power && p.power.armed) &&
        (this._rallySupers[p.team] || 0) < SUPER.MAX_PER_RALLY
    });
  }
  // Super smash: spend the meter and route through the shared executor so the
  // AI delivers an identical shot to the human's (including the blast marker).
  if (shot.isSuper && p.power && p.power.armed) {
    Power.spend(p.power);
    this._executeSuper(p, fwd, {
      aim: clamp(shot.target.x / (C.HALF_W * 0.92), -1, 1)
    });
    return;
  }

  if (shot.isSmash || shot.type === 'erne') visualSwingType = 'smash';
  p.mesh.swing(visualSwingType);
  if (this.audio) this.audio.sfx.paddle();
  this._triggerHitEffect();

  // Deliberate fault: solve honestly toward the AI's deliberately-bad target
  // with net raising OFF, so it lands out or clips the tape — either way a fault.
  if (shot.fault) {
    var tgtZf = (p.team === 'near') ? -shot.target.z : shot.target.z;
    var spinVecF = Physics.vec(shot.spin.x * -fwd, shot.spin.y, shot.spin.z);
    this._executeShotV2(shot.target.x, tgtZf, shot.apex, shot.margin, spinVecF,
      { type: shot.type, allowNet: true });
    return;
  }

  var tgtZ = (p.team === 'near') ? -shot.target.z : shot.target.z;
  var isAtp = shot.type === 'atp';

  // CPU stability → apex modifier. Smashes are committed overheads — skip quality
  // degradation so a sprinting CPU doesn't turn a smash into a lob.
  // (stabilityIdx computed above and reused as the shot-selection contactQuality.)
  var quality = shot.isSmash ? 'clean' : Shots.stabilityQuality(stabilityIdx);
  // Charge off the TRUE contact quality, not the forced-clean smash value above,
  // or bangers would bank meter for every overhead regardless of how stretched
  // they were.
  this._chargeMeter(p, Shots.stabilityQuality(stabilityIdx), stabilityIdx);
  var apex = this._apexForQuality(shot.apex, quality);

  var spinVec = Physics.vec(shot.spin.x * -fwd, shot.spin.y, shot.spin.z);
  var cpuSide = Shots.swingSide(pos.x, this.ball.pos.x, fwd);
  var ctm = this._cpuTiming(p.ai, cpuSide, fwd);
  // Clean power shots fly the driven family; mishits fall back to the arc.
  this._executeShot(shot.target.x + ctm.targetXSkew, tgtZ, apex, shot.margin, spinVec,
    { type: shot.type, isAtp: isAtp, paceMul: ctm.paceMul, apexAdd: ctm.apexAdd,
      driven: quality === 'clean' ? null : false });

  // Poach check: can the net partner intercept this shot?
  this._checkPoach(p.team, firedScriptedShot);
};

// Poach check — called after a shot is fired toward `hitterTeam`'s opponents.
// Checks if the net-partner on the receiving team can intercept. If so, deflects
// the ball mid-flight toward open court on the hitter's side.
/* Decide whether the receiving team's partner will poach — but do NOT execute it
 * yet. Only arm it.
 *
 * This used to redirect the ball immediately, at the instant the ORIGINAL player
 * struck: it teleported the ball to the partner's position and relaunched from
 * there. Measured jumps of 4-5.5m in a single frame, often across the net, which
 * is what produced "the ball just appears and you never see anyone hit it". It
 * also skipped the entire intervening flight, so the opponent got no chance to
 * react to a ball that had visibly never travelled.
 *
 * Now it marks intent and _checkPoachContact() resolves it when the ball
 * actually reaches the poacher — same deferral pattern as _checkBlastContact. */
Game.prototype._checkPoach = function (hitterTeam, wasScriptedShot) {
  if (this.mode === 'singles' || this.mode === 'practice') return;
  // A real auto-poach would steal the ball from drillDirector.js's named
  // scripted target, bypassing drillForcedShot/armNextScriptedShot entirely
  // and desyncing drillScriptIndex from what actually gets hit. Gated on
  // whether the shot just fired was ITSELF a scripted beat — captured by
  // the caller before armNextScriptedShot advances/nulls drillForcedShot,
  // not by re-checking drillForcedShot here: on a script's FINAL beat,
  // drillForcedShot is already null by the time this runs, so that check
  // would wrongly allow a real auto-poach to hijack the climactic last
  // scripted contact. This also sidesteps _responsibleSlot's real-serve-
  // rotation zone math entirely for scripted beats (below) — that math is
  // meaningless for a drill's always-{0,0}-score, freeform-placed roster,
  // and the script already names the real receiver explicitly, so there's
  // no "off-ball partner" concept to compute for a scripted beat at all.
  if (wasScriptedShot) return;
  if (!this.ball.flight) return;
  var path = { samples: this.ball.flight.samples, landing: this.ball.flight.landing };
  var landingX = this.ball.flight.landing.x;
  var receivingTeam = hitterTeam === 'near' ? 'far' : 'near';
  // The partner is whichever player on the receiving team is NOT responsible.
  var responsibleSlot = this._responsibleSlot(receivingTeam, landingX);
  var partnerSlot = 1 - responsibleSlot;
  var partner = this._player(receivingTeam, partnerSlot);
  if (!partner || !partner.ai) return; // human partner: no auto-poach
  if (Power.stunBlocksInput(partner.stun)) return; // face-down: can't poach

  if (!AI.checkPoach(partner.ai, path, partner.pos)) return;

  this.pendingPoach = { team: receivingTeam, poacher: partner, hitterTeam: hitterTeam,
                        landingX: landingX };
};

/* Resolve an armed poach once the ball is genuinely within the poacher's reach.
 * Runs per substep so a fast ball can't step past the intercept window. */
Game.prototype._checkPoachContact = function () {
  var pp = this.pendingPoach;
  if (!pp || !this.ball.live) return;
  var rally = this.match.rally;
  if (!rally || !rally.live) { this.pendingPoach = null; return; }

  // Only once the ball has crossed to the poacher's side.
  var onTheirSide = (pp.team === 'near') ? (this.ball.pos.z > 0) : (this.ball.pos.z < 0);
  if (!onTheirSide) return;

  var q = pp.poacher;
  if (Power.stunBlocksInput(q.stun)) { this.pendingPoach = null; return; }
  var dx = this.ball.pos.x - q.pos.x, dz = this.ball.pos.z - q.pos.z;
  if (dist2D(dx, dz) > SPECIALTY.POACH_PRO_REACH) return;
  if (this.ball.pos.y > HIT.REACH_Y_MAX || this.ball.pos.y <= 0) return;

  this.pendingPoach = null;

  var volley = rally.bouncesSinceHit < 1;
  var inKitchen = Math.abs(q.pos.z) < C.KITCHEN;
  var res = Rules.onPaddleHit(this.match, q.team, { volley: volley, inKitchen: inKitchen });

  q.mesh.swing(Shots.swingSide(q.pos.x, this.ball.pos.x, (q.team === 'near') ? 1 : -1));
  if (this.audio) this.audio.sfx.paddle();
  this._triggerHitEffect();
  this.cameraShake = Math.max(this.cameraShake, 0.08);
  if (rallyOver(res)) { this._endPoint(res); return; }

  // Redirect toward open court, away from where the original hitter aimed.
  // The ball is already AT the poacher — no teleport; _executeShotV2 snaps to
  // the live contact point as it does for every other shot.
  var openX = -pp.landingX * 0.7 + (Math.random() - 0.5) * 0.6;
  var openZ = (pp.hitterTeam === 'near' ? 1 : -1) * (C.HALF_L * 0.72);
  this.ball.spin = Physics.vec(0, 0, 0);
  this._executeShotV2(openX, openZ, 1.4, 0.18, this.ball.spin, { type: 'drive' });
};

/* ----------------------------- rendering ------------------------------ */
// `mag` scales the burst (default 1). A super smash passes ~1.8 so the impact
// reads bigger than a normal contact without needing a separate effect.
Game.prototype._triggerHitEffect = function (mag) {
  if (!this.hitFx) return;
  mag = mag || 1;
  var mesh = this.hitFx.mesh;
  mesh.position.set(this.ball.pos.x, Math.max(C.BALL_R * 2.0, this.ball.pos.y), this.ball.pos.z);
  mesh.scale.set(0.62 * mag, 0.62 * mag, 1);
  mesh.visible = true;
  mesh.material.opacity = Math.min(1, 0.44 * mag);
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

// Shockwave + dust at the blasted player's feet.
Game.prototype._triggerBlastEffect = function (victim) {
  if (!this.replaying) {
    var idx = this.players.indexOf(victim);
    if (idx >= 0) this._effectsThisFrame.push({ type: 'blast', player: idx });
  }
  if (this.blastFx) {
    this.blastFx.mesh.position.set(victim.pos.x, 0.05, victim.pos.z);
    this.blastFx.mesh.scale.set(1, 1, 1);
    this.blastFx.mesh.visible = true;
    this.blastFx.mesh.material.opacity = 0.85;
    this.blastFx.age = this.blastFx.dur;
  }
  if (this.dustFx) {
    this.dustFx.mesh.position.set(victim.pos.x, 0.35, victim.pos.z);
    this.dustFx.mesh.scale.set(0.9, 0.9, 1);
    this.dustFx.mesh.visible = true;
    this.dustFx.mesh.material.opacity = 0.5;
    this.dustFx.age = this.dustFx.dur;
  }
};

Game.prototype._updateBlastEffect = function (dt) {
  var fx = this.blastFx;
  if (fx) {
    if (fx.age <= 0) { fx.mesh.visible = false; fx.mesh.material.opacity = 0; }
    else {
      fx.age = Math.max(0, fx.age - dt);
      var t = 1 - fx.age / fx.dur;
      var size = 1 + t * 5.0;                 // expands to ~3m
      fx.mesh.scale.set(size, size, 1);
      fx.mesh.material.opacity = (1 - t) * 0.85;
      if (fx.age <= 0) fx.mesh.visible = false;
    }
  }
  var du = this.dustFx;
  if (du) {
    if (du.age <= 0) { du.mesh.visible = false; du.mesh.material.opacity = 0; }
    else {
      du.age = Math.max(0, du.age - dt);
      var dt2 = 1 - du.age / du.dur;
      du.mesh.scale.set(0.9 + dt2 * 1.6, 0.9 + dt2 * 1.6, 1);
      du.mesh.position.y = 0.35 + dt2 * 0.5;  // drifts upward
      du.mesh.material.opacity = (1 - dt2) * 0.5;
      if (du.age <= 0) du.mesh.visible = false;
    }
  }
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
  this._updateBallAppearance(dt);
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
  this._updateSuperTrail();
  this._updateHitEffect(dt);
  this._updateBounceEffect(dt);
  this._updateNetEffect(dt);
  this._updateBlastEffect(dt);
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
    // 'stun' outranks everything — a blasted player is sliding fast, which
    // would otherwise classify as a run.
    var stunned = Power.stunBlocksInput(pl.stun);
    var visualOverride = stunned ? 'stun'
      : (move.lunge > 0 ? 'lunge' : (move.plant > 0 ? 'plant' : (move.split > 0 ? 'split' : '')));
    var visualMove = Movement.classifyVisual(local, v, this.state === STATE.SERVE || this.state === STATE.RALLY, visualOverride);
    if (pl.mesh.setStun) pl.mesh.setStun(pl.stun.phase);
    pl.mesh.object.position.set(pl.pos.x,
      this._reactionOffset(pl.team) + this._stunOffsetY(pl), pl.pos.z);
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

/* Push one trail sample. Normally called once per rendered frame, but a super
 * moves ~0.5m per frame — fast enough that a per-frame trail renders as a
 * visibly polygonal chain — so _tickRally also calls this each SUBSTEP while
 * the ball is hot, giving 4x the resolution exactly when it matters. */
Game.prototype._sampleTrail = function () {
  var buf = this.world && this.world.trailBuf;
  if (!buf) return;
  buf.push([this.ball.pos.x, this.ball.pos.y, this.ball.pos.z]);
  while (buf.length > this.world.trailLen) buf.shift();
};

/* Stable per-character pitch offset (±6%) derived from the character id, so the
 * five boys (and the seven girls) don't all sound like one cloned voice. */
Game.prototype._voiceDetune = function (p) {
  var key = (p && p.characterId) || (p && p.team + p.slot) || '';
  var h = 0;
  for (var i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) & 0xffff;
  return ((h % 1000) / 1000 - 0.5) * 0.12;
};

/* Build the camera-facing speed ribbon from the trail buffer.
 * Width tapers from the head to zero at the tail and the color fades white-hot
 * -> deep orange, which is what reads as SPEED; a constant-width ribbon just
 * looks like a tube. Only visible while the ball is hot. */
Game.prototype._updateSuperTrail = function () {
  var rb = this.world && this.world.superRibbon;
  if (!rb) return;
  if (!this.ball.superHot || !this.ball.live) { rb.visible = false; return; }

  var buf = this.world.trailBuf, segs = this.world.superRibbonSegs;
  if (!buf || buf.length < 2) { rb.visible = false; return; }

  var pos = rb.geometry.attributes.position;
  var col = rb.geometry.attributes.color;
  var camPos = this.camera.position;
  var head = buf.length - 1;

  for (var i = 0; i < segs; i++) {
    // i = 0 at the tail, segs-1 at the head (the ball).
    var srcIdx = head - (segs - 1 - i);
    var p = buf[srcIdx < 0 ? 0 : srcIdx];
    var pn = buf[Math.min(head, (srcIdx < 0 ? 0 : srcIdx) + 1)] || p;
    // Segment direction, then a perpendicular that faces the camera.
    var dx = pn[0] - p[0], dy = pn[1] - p[1], dz = pn[2] - p[2];
    var vx = p[0] - camPos.x, vy = p[1] - camPos.y, vz = p[2] - camPos.z;
    var nx = dy * vz - dz * vy, ny = dz * vx - dx * vz, nz = dx * vy - dy * vx;
    var nl = Math.hypot(nx, ny, nz) || 1;
    var t = i / (segs - 1);                       // 0 tail -> 1 head
    // Width in absolute metres, not ball radii: BALL_R*1.6 is ~6cm, which is
    // a couple of pixels at broadcast distance and reads as nothing.
    var w = SUPER.TRAIL_WIDTH * t * t;            // taper, biased toward the head
    nx = nx / nl * w; ny = ny / nl * w; nz = nz / nl * w;

    pos.setXYZ(i * 2, p[0] - nx, p[1] - ny, p[2] - nz);
    pos.setXYZ(i * 2 + 1, p[0] + nx, p[1] + ny, p[2] + nz);
    // White-hot at the head, deep orange fading out at the tail.
    var r = 0.35 + 0.65 * t, g = 0.12 + 0.60 * t * t, b = 0.02 + 0.55 * t * t * t;
    col.setXYZ(i * 2, r, g, b);
    col.setXYZ(i * 2 + 1, r, g, b);
  }
  pos.needsUpdate = true;
  col.needsUpdate = true;
  rb.visible = true;
};

/* Vertical lift for a blasted body.
 *
 * Driven by the MESH'S ACTUAL PITCH, not by the stun phase. The pitch eases out
 * slowly when a player gets up, while the phase flips to 'none' instantly — so
 * keying the lift off the phase left a window where the body was still ~66%
 * flat with zero lift and sank straight through the court. That was the
 * "falls under the ground" bug.
 *
 * The model pivot is at the FEET, so this must never go negative; pitching about
 * the feet already lays the body out at ground level and only a small lift is
 * needed to keep the torso off the surface. */
Game.prototype._stunOffsetY = function (p) {
  if (!p.mesh || !p.mesh.object) return 0;
  var pitch = Math.abs(p.mesh.object.rotation.x || 0);
  if (pitch < 0.01) return 0;
  return SUPER.STUN_LIFT * Math.min(1, pitch / SUPER.STUN_PITCH);
};

Game.prototype._updateTrail = function () {
  var buf = this.world.trailBuf, max = this.world.trailLen;
  // A hot ball is already being sampled per-substep by _tickRally.
  if (!this.ball.superHot) {
    buf.push([this.ball.pos.x, this.ball.pos.y, this.ball.pos.z]);
    while (buf.length > max) buf.shift();
  }
  var attr = this.world.trail.geometry.attributes.position;
  for (var i = 0; i < max; i++) {
    var p = buf[i] || buf[buf.length - 1] || [0, 0, 0];
    attr.setXYZ(i, p[0], p[1], p[2]);
  }
  attr.needsUpdate = true;
  // A super smash drives the trail hot and near-opaque. NOTE: this is a
  // THREE.Line, and `linewidth` is ignored on essentially every WebGL platform
  // (it always renders 1px) — so brightness and color are the only levers here.
  // The heavy tapered streak is a separate additive ribbon; see _updateSuperTrail.
  var mat = this.world.trail.material;
  if (!this.ball.live) {
    mat.opacity = 0;
  } else if (this.ball.superHot) {
    mat.opacity = SUPER.TRAIL_OPACITY;
    mat.color.setHex(0xffb02e);
  } else {
    mat.opacity = 0.35;
    mat.color.setHex(this.world.trailBaseColor != null ? this.world.trailBaseColor : 0xffffff);
  }
};

/* Single writer for the ball's material/scale/glow.
 *
 * The practice coaching cue and the super-smash heat both want this material
 * every frame, so they are resolved to ONE tier here and written once — two
 * independent writers would fight and flicker. Super always wins.
 *
 * Everything reads via emissive + the additive glow shell + scale, never bloom:
 * renderQuality() disables bloom on medium and MOBILE DEFAULTS TO MEDIUM, so a
 * bloom-driven effect would be invisible on phones. */
Game.prototype._updateBallAppearance = function (dt) {
  var mesh = this.world && this.world.ballMesh;
  if (!mesh || !mesh.material) return;
  var glow = mesh.children && mesh.children[0] && mesh.children[0].material ? mesh.children[0].material : null;
  var ghost = this.world.ballGhost && this.world.ballGhost.material ? this.world.ballGhost.material : null;

  // --- super smash: hot, swelling, pulsing ---
  if (this.ball.superHot && this.ball.live) {
    this._superGlowT = (this._superGlowT || 0) + (dt || 0);
    // Ease the swell in rather than snapping, so the ball visibly grows as it
    // leaves the paddle.
    this._superScale = this._superScale == null ? 1 : this._superScale;
    this._superScale += (SUPER.BALL_SCALE - this._superScale) * Math.min(1, (dt || 0) * 14);
    // A dead-steady glow reads as a texture; a pulsing one reads as charged.
    var pulse = 0.12 * Math.sin(this._superGlowT * 14 * Math.PI * 2 / 6.28);
    mesh.material.color.setHex(0xfff1c4);
    mesh.material.emissive.setHex(0xff7a10);
    mesh.material.emissiveIntensity = SUPER.BALL_EMISSIVE_INT;
    mesh.scale.setScalar(this._superScale);
    if (glow) { glow.color.setHex(0xffc06a); glow.opacity = 0.62 + pulse; }
    if (ghost) { ghost.color.setHex(0xffd9a0); ghost.opacity = 0.95; }
    return;
  }
  this._superGlowT = 0;
  this._superScale = 1;

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
      pos: Physics.vec(0, 0, 0),
      vel: Physics.vec(0, 0, 0),
      spin: Physics.vec(0, 0, 0)
    });
  }
};

Game.prototype._buildPracticeReturnShot = function (targetX, targetZ, apex, margin, spinVec, isAtp) {
  var p0 = Physics.vec(this.ball.pos.x, Math.max(0.5, this.ball.pos.y), this.ball.pos.z);
  // Honest flight for the cosmetic return: solve a launch velocity, integrate
  // it with stepV2 in _updatePracticeReturns. Marker sits at the solved landing.
  var sol = Physics.solveArc(p0, { x: targetX, z: targetZ }, {
    apex: apex, margin: margin, spin: spinVec, vMax: 22, allowNet: !!isAtp
  });
  return { P0: p0, v0: sol.v0, spin: spinVec, landing: sol.landing };
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
  slot.pos = Physics.clone(shot.P0);
  slot.vel = Physics.clone(shot.v0);
  slot.spin = Physics.clone(shot.spin);
  slot.mark.position.set(shot.landing.x, 0.04, shot.landing.z);
  slot.mesh.visible = true;
  slot.blob.visible = true;
  slot.mark.visible = true;
};

Game.prototype._updatePracticeReturns = function (dt) {
  for (var i = 0; i < this.practiceReturns.length; i++) {
    var rb = this.practiceReturns[i];
    if (!rb.active) continue;

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
      rb.active = false;
      rb.mesh.visible = false; rb.blob.visible = false; rb.mark.visible = false;
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
  var hidden = this.camMode === 2 && !this.replayFreeCam;
  for (var i = 0; i < overhead.length; i++) overhead[i].visible = !hidden;
};

/* --------------------------- Instant replay --------------------------- */
// Snap gameplay-only markers (they'd be misleading during a replay).
Game.prototype._setReplayMarkers = function (visible) {
  var els = [this.youMarker, this.youMarkerGlow, this.aimMarker, this.aimMarkerFill];
  for (var i = 0; i < els.length; i++) if (els[i]) els[i].visible = visible;
};

// Enter DVR replay: freeze the rolling buffer, stash live state, start playing.
Game.prototype.enterReplay = function () {
  if (this.replaying) return false;
  var window = this.recorder.snapshotWindow();
  if (!window.frames.length) return false;          // nothing to replay yet
  this._replayStash = { frame: this._captureFrame(), camMode: this.camMode };
  this.replayPlayback = makePlayback(window, REPLAY.DEFAULT_SPEED);
  this.replayOrbit = makeOrbitCam(REPLAY.ORBIT);
  this.replayFreeCam = false;
  this.replaying = true;
  this._setReplayMarkers(false);
  // Clear any mid-fade point banner / shot tag so it doesn't sit frozen on screen.
  this.msgTimer = 0; this.shotTimer = 0;
  this._updateHUD();
  this.replayPlayback.seek(0);
  this.replayPlayback.play();
  return true;
};

// Leave replay: restore the exact live frame we froze and resume the match.
Game.prototype.exitReplay = function () {
  if (!this.replaying) return;
  this.replaying = false;
  var st = this._replayStash;
  if (st) { this._applyFrame(st.frame); this.camMode = st.camMode; }
  this.replayFreeCam = false;
  this.replayPlayback = null;
  this.replayOrbit = null;
  this._replayStash = null;
  this._setReplayMarkers(true);
  this._syncOverhead();
  this._syncMeshes(0);
  updateCamera(this.camRig, this.ball, this.players[0].pos, this.camMode, 0, 1 / 60, { isMobile: this.isMobile });
};

// Write a recorded/sampled frame into the live ball + players (in place, so the
// physics objects keep their identity for a clean resume).
Game.prototype._applyFrame = function (frame) {
  var b = this.ball;
  b.pos.x = frame.ball.pos.x; b.pos.y = frame.ball.pos.y; b.pos.z = frame.ball.pos.z;
  b.vel.x = frame.ball.vel.x; b.vel.y = frame.ball.vel.y; b.vel.z = frame.ball.vel.z;
  b.spin.x = frame.ball.spin.x; b.spin.y = frame.ball.spin.y; b.spin.z = frame.ball.spin.z;
  b.live = frame.ball.live;
  b.superHot = !!frame.ball.superHot;
  for (var i = 0; i < this.players.length && i < frame.players.length; i++) {
    var p = this.players[i], fp = frame.players[i];
    p.pos.x = fp.pos.x; p.pos.z = fp.pos.z;
    p.vel.x = fp.vel.x; p.vel.z = fp.vel.z;
    if (p.move && fp.move) {
      p.move.kind = fp.move.kind; p.move.split = fp.move.split;
      p.move.plant = fp.move.plant; p.move.lunge = fp.move.lunge;
      if (fp.move.target) {
        if (!p.move.target) p.move.target = { x: 0, z: 0 };
        p.move.target.x = fp.move.target.x;
        p.move.target.z = fp.move.target.z;
      }
    }
    if (p.power) { p.power.charge = fp.power || 0; p.power.armed = !!fp.armed; }
    if (p.stun && fp.stun) {
      p.stun.phase = fp.stun.phase; p.stun.t = fp.stun.t; p.stun.dur = fp.stun.dur;
      p.stun.dirX = fp.stun.dirX; p.stun.dirZ = fp.stun.dirZ;
    }
  }
};

// Per-render-frame replay step (called from the main loop in place of update()).
Game.prototype.updateReplay = function (dtRender) {
  var pb = this.replayPlayback;
  if (!pb) return;
  pb.advance(dtRender);
  var frame = pb.sample();
  if (!frame) return;
  this._applyFrame(frame);
  var ev = pb.consumeEvents ? pb.consumeEvents() : { swings: pb.consumeSwings(), effects: [] };
  var swings = ev.swings || [];
  for (var i = 0; i < swings.length; i++) {
    var pl = this.players[swings[i].player];
    if (pl) pl.mesh.swing(swings[i].type);
  }
  var effects = ev.effects || [];
  for (var j = 0; j < effects.length; j++) {
    var fx = effects[j];
    if (fx.type === 'blast') {
      var victim = this.players[fx.player];
      if (victim) this._triggerBlastEffect(victim);
    }
  }
  // Hard freeze-frame while paused; live animation while playing.
  this._syncMeshes(pb.isPlaying() ? dtRender : 0);
  if (this.replayFreeCam) {
    this.replayOrbit.applyTo(this.camera, frame.ball.pos.x, REPLAY.ORBIT.TARGET_Y, frame.ball.pos.z);
  } else {
    updateCamera(this.camRig, this.ball, this.players[0].pos, this.camMode, 0, dtRender, { isMobile: this.isMobile });
  }
};

// ---- Replay control surface (driven by the DVR overlay in main.js) ----
Game.prototype.replayToggle = function () { if (this.replayPlayback) this.replayPlayback.toggle(); };
Game.prototype.replaySetSpeed = function (s) { if (this.replayPlayback) this.replayPlayback.setSpeed(s); };
Game.prototype.replaySeek = function (t) { if (this.replayPlayback) this.replayPlayback.seek(t); };
Game.prototype.replayStep = function (n) { if (this.replayPlayback) this.replayPlayback.stepFrames(n); };
Game.prototype.replayOrbitDrag = function (dx, dy) { if (this.replayFreeCam && this.replayOrbit) this.replayOrbit.onDrag(dx, dy); };
Game.prototype.replayOrbitZoom = function (delta) { if (this.replayFreeCam && this.replayOrbit) this.replayOrbit.onZoom(delta); };

Game.prototype._replayCamLabel = function () {
  return this.replayFreeCam ? 'FREE ORBIT' : ['BROADCAST', 'FOLLOW', 'TOP-DOWN'][this.camMode] || 'BROADCAST';
};

// Cycle Broadcast → Follow → Top-Down → Free-orbit → Broadcast …
Game.prototype.replayCycleCamera = function () {
  if (this.replayFreeCam) {
    this.replayFreeCam = false;
    this.camMode = 0;
  } else if (this.camMode >= 2) {
    this.replayFreeCam = true;
    if (this.replayOrbit) this.replayOrbit.reset();
  } else {
    this.camMode = this.camMode + 1;
  }
  this._syncOverhead();
  return this._replayCamLabel();
};

// Snapshot of playback state for the overlay to render each frame.
Game.prototype.replayInfo = function () {
  var pb = this.replayPlayback;
  if (!pb) return null;
  return {
    playhead: pb.getPlayhead(),
    duration: pb.getDuration(),
    playing: pb.isPlaying(),
    speed: pb.getSpeed(),
    freeCam: this.replayFreeCam,
    camLabel: this._replayCamLabel()
  };
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
    isHumanServe: this.isHumanServe(),
    power: this._powerHUD()
  });
};

// Meter readout for the HUD. players[0] is always the human, and the HUD relies
// on that ordering: index 0 drives the big bar, the rest become pips.
Game.prototype._powerHUD = function () {
  if (this.superMode === 'off') return [];
  var out = [];
  for (var i = 0; i < this.players.length; i++) {
    var p = this.players[i];
    if (!p.power) continue;
    out.push({
      charge: p.power.charge,
      armed: p.power.armed,
      color: '#' + (p.jersey || 0x7ce7ff).toString(16).padStart(6, '0')
    });
  }
  return out;
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
  this.state = STATE.SERVE;
  this.practice.timer = this.practice.feedNum <= 1 ? PRACTICE.READY_GAP : PRACTICE.FEED_INTERVAL;
  this._placePracticeFeed();
  this._message(feedback.banner, 1.2);
  this._flashShot(feedback.shot);
};

// Drill mode: real live simulated gameplay (real AI, real physics ball,
// real fault detection) directed just enough to enact a specific drill's
// premise — see src/drillDirector.js. Runs through the normal SERVE/RALLY/
// POINT state machine (unlike the old timeline approach, nothing here
// early-returns before update()'s tail, so camera cycling, instant replay,
// and mesh-sync all work unmodified).
Game.prototype.startDrill = function (drillData) {
  this.drillData = drillData;
  DrillDirector.resetRep(this, drillData);
  // Same "gameplay-only markers would be misleading" call real instant-
  // replay's enterReplay()/exitReplay() already make (_setReplayMarkers) —
  // drill mode never had an equivalent, so the "YOU" ring permanently
  // tracked players[0] (a CPU, not a human) for the entire drill and its
  // eternal replay loop. players[0] is never human in drill mode, so these
  // markers should just never appear, for the whole session.
  this._setReplayMarkers(false);
};

// "The drill is the drill" — the rep ends exactly when the authored `script`
// runs out, never with extra undirected AI touches tacked on. The cap is
// always the script's own length; DRILL.MAX_SHOTS is only a defensive
// fallback for the (invalid) case of a drill with no script at all.
Game.prototype._drillMaxShots = function () {
  var script = this.drillData && this.drillData.script;
  return (script && script.length) || DRILL.MAX_SHOTS;
};

Game.prototype._tickDrill = function (dt) {
  if (this.drillReplaying) { this._tickDrillReplay(dt); return; }
  if (this.state === STATE.SERVE) {
    this.serveDelay -= dt;
    if (this.serveDelay <= 0) DrillDirector.fireOpeningShot(this, this.drillData);
  } else if (this.state === STATE.RALLY) {
    this._tickRally(dt);
    // Backstop only — see the comment where drillEndGrace is armed in
    // _cpuHit. Re-check state: _tickRally may have already ended the point
    // naturally (the common case) this same tick.
    if (this.state === STATE.RALLY && this.drillEndGrace > 0) {
      this.drillEndGrace -= dt;
      if (this.drillEndGrace <= 0) {
        this._endPoint({ scored: false, reason: 'drill-end', rallyWinner: null });
      }
    }
  } else if (this.state === STATE.POINT) {
    this.pointPause -= dt;
    if (this.pointPause <= 0) DrillDirector.enterReplayLoop(this);
  }
};

// Once the bounded live rep ends (cap or fault), advance/loop the just-
// recorded replay of it — real pause/rewind/scrub (drillToggle/drillSeek),
// same makePlayback/_applyFrame machinery instant replay uses. Holds on the
// final frame briefly, then seeks back to Setup and plays again.
Game.prototype._tickDrillReplay = function (dt) {
  var pb = this.drillPlayback;
  if (!pb) return;
  if (this._drillLoopHoldTimer > 0) {
    this._drillLoopHoldTimer -= dt;
    if (this._drillLoopHoldTimer <= 0) { pb.seek(0); pb.play(); }
  } else {
    pb.advance(dt);
    if (!pb.isPlaying() && pb.getPlayhead() >= pb.getDuration()) {
      this._drillLoopHoldTimer = DRILL.LOOP_END_HOLD;
    }
  }
  var frame = pb.sample();
  if (!frame) return;
  this._applyFrame(frame);
  // Same event dispatch as updateReplay() — without this, position/ball
  // state loops correctly but no player ever visibly swings a paddle for
  // the entire (eternal) drill replay loop, since swing pose is driven
  // exclusively by mesh.swing()'s one-shot timer, never implied by
  // move.kind/position alone.
  var ev = pb.consumeEvents ? pb.consumeEvents() : { swings: pb.consumeSwings(), effects: [] };
  var swings = ev.swings || [];
  for (var i = 0; i < swings.length; i++) {
    var pl = this.players[swings[i].player];
    if (pl) pl.mesh.swing(swings[i].type);
  }
  var effects = ev.effects || [];
  for (var j = 0; j < effects.length; j++) {
    var fx = effects[j];
    if (fx.type === 'blast') {
      var victim = this.players[fx.player];
      if (victim) this._triggerBlastEffect(victim);
    }
  }
  // _syncMeshes/updateCamera run once already, unconditionally, in
  // update()'s shared tail right after _tickDrill returns — don't call
  // them again here.
};

Game.prototype.drillToggle = function () { if (this.drillPlayback) this.drillPlayback.toggle(); };
Game.prototype.drillSeek = function (t) { if (this.drillPlayback) this.drillPlayback.seek(t); };
Game.prototype.drillReplayInfo = function () {
  var pb = this.drillPlayback;
  if (!pb) return null;
  return { playhead: pb.getPlayhead(), duration: pb.getDuration(), playing: pb.isPlaying() };
};

// Live-viewing camera cycle (Broadcast/Follow/Top-Down) for the drill
// control bar — deliberately the plain 3-way cycler, not replayCycleCamera's
// 4-way-with-free-orbit (that's for actual instant-replay viewing).
Game.prototype.cycleCamera = function () { return this._cycleCamera(); };

Game.prototype.render = function () {
  if (this.composer) this.composer.render();
  else this.renderer.render(this.scene, this.camera);
};
