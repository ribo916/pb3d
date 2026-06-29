/* ============================================================================
 * game.js — Orchestrator. Wires Three.js rendering to the pure logic layer,
 * runs the match state machine, camera, players, ball and HUD.
 * Ported from the original Picklelife js/game.js (ESM). Audio, character
 * skinning, venues/night mode and the 2D-shell hooks are dropped; the doubles
 * gameplay, hit model, momentum aim and camera are preserved 1:1.
 * ==========================================================================*/
'use strict';

import * as THREE from 'three';
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
  this.camMode = 0;
  this.msgTimer = 0;
  this.serveDelay = 0;
  this.pointPause = 0;
  this._initThree();
  this._initWorld();
  this._bindResize();
}

Game.prototype._initThree = function () {
  var renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  this.renderer = renderer;

  this.scene = new THREE.Scene();
  var rig = makeCamera(this._aspect());
  this.camRig = rig;
  this.camera = rig.cam;
};

Game.prototype._aspect = function () {
  return (this.canvas.clientWidth || window.innerWidth) / (this.canvas.clientHeight || window.innerHeight);
};

Game.prototype._initWorld = function () {
  this.world = Scene.build(this.scene, {
    venue: this.venue,
    courtPalette: this.courtPalette,
    timeOfDay: this.timeOfDay
  });
  this.ball = Physics.makeBall();

  // DOUBLES roster: near team = human (slot 0) + CPU partner (slot 1);
  // far team = two CPUs. Fixed team palettes so all four read apart.
  var palettes = {
    nearYou: {
      jersey: 0xff7a1f, shorts: 0x20283c, paddle: 0x2bd4ff, shoe: 0xf6f8ff,
      skin: 0xe4bf9f, hair: 0x241814, height: 'tall', build: 'average',
      hairStyle: 'short', headwear: 'headband', headband: 0x2bd4ff
    },
    nearMate: {
      jersey: 0x21bdb0, shorts: 0x20283c, paddle: 0xffa53c, shoe: 0xf8fbff,
      skin: 0xe8c3ab, hair: 0x5b3724, height: 'medium', build: 'average',
      hairStyle: 'long', headwear: 'none'
    },
    farA: {
      jersey: 0xf14668, shorts: 0x30111e, paddle: 0x36d399, shoe: 0xf9fbff,
      skin: 0xf0cbb2, hair: 0xd5bb58, height: 'tower', build: 'slim',
      hairStyle: 'short', headwear: 'cap', headband: 0xf4f5f6
    },
    farB: {
      jersey: 0xff7aa8, shorts: 0x55233a, paddle: 0xc8ff65, shoe: 0xfffbff,
      skin: 0xedc6b0, hair: 0x4a2b22, height: 'medium', build: 'average',
      hairStyle: 'ponytail', headwear: 'none', headband: 0xffd166
    }
  };
  this.youColor = palettes.nearYou.jersey;

  var self = this;
  function entry(team, slot, isHuman, colors) {
    var mesh = makePlayer(colors);
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

  // AIM MARKER — a flat ring on the opponents' court showing where your held
  // direction will steer the shot. Hidden until it's your turn to hit.
  var aimMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false });
  var aimRing = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.05, 8, 24), aimMat);
  aimRing.rotation.x = -Math.PI / 2;
  this.scene.add(aimRing);
  this.aimMarker = aimRing;

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
  return this.state === STATE.SERVE && this._serverEntry().isHuman;
};

Game.prototype.start = function () {
  this.state = STATE.SERVE;
  var humanServes = this._serverEntry().isHuman;
  this.serveDelay = humanServes ? 0 : 0.9;
  this._message(humanServes ? 'YOUR SERVE — tap SERVE or Space' : 'OPPONENT SERVE', 2.2);
};

Game.prototype._placeServe = function () {
  this._formationServe();
  var s = Rules.currentServer(this.match);
  var sp = this._player(s.team, s.slot).pos;
  var fwd = (s.team === 'near') ? 1 : -1;
  // hold the ball at the server's paddle, just in front toward the net
  this.ball.live = false;
  this.ball.pos = Physics.vec(sp.x + (s.team === 'near' ? 0.3 : -0.3), 0.9, sp.z - fwd * 0.2);
  this.ball.vel = Physics.vec(0, 0, 0);
  this.ball.spin = Physics.vec(0, 0, 0);
  this.serveChecked = false;
};

Game.prototype._doServe = function () {
  Rules.startRally(this.match);
  var s = Rules.currentServer(this.match);
  var rcv = Rules.currentReceiver(this.match);
  var srvEntry = this._player(s.team, s.slot);
  var sp = srvEntry.pos;
  var fwd = (s.team === 'near') ? 1 : -1;
  var p0 = Physics.vec(sp.x, 0.85, sp.z - fwd * 0.3);
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
  srvEntry.mesh.swing('serve');
  if (this.audio) this.audio.sfx.serve();
  this.state = STATE.RALLY;
  this.lastHitCooldown = HIT.COOLDOWN_SERVE;
};

Game.prototype._endPoint = function (result) {
  this.state = STATE.POINT;
  this.pointPause = 1.5;
  this.ball.live = false;
  this.excitement = 1.0;
  this.cameraShake = result.scored ? 0.25 : 0.12;
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
  var sp = srvEntry.pos;
  var fwd = (s.team === 'near') ? 1 : -1;
  // keep ball glued to the server's paddle
  this.ball.pos = Physics.vec(sp.x + (s.team === 'near' ? 0.3 : -0.3),
    0.9 + Math.sin(performance.now() / 200) * 0.03, sp.z - fwd * 0.2);
  if (srvEntry.isHuman) {
    if (this.input && this.input.consumeServe()) { this.input.consumeSwing(); this._doServe(); }
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
    this.ball.spline = null;
    this.ball.pos.y = Math.max(Physics.COURT.BALL_R, this.ball.pos.y);
    // Apply bounce: flip vy, apply restitution + friction.
    if (this.ball.vel.y < 0) this.ball.vel.y = -this.ball.vel.y * PHYS.RESTITUTION;
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
    r = Rules.onFloor(this.match, { inBounds: e.type === 'bounce', x: e.x, z: e.z, side: e.side });
  } else if (e.type === 'net') {
    if (this.audio) this.audio.sfx.net();
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
  var backZ = C.HALF_L - 0.9, upZ = C.KITCHEN + 0.3;
  var advance = (rally && rally.phase === 'open') ? clamp((p.ai.cfg.smart - 0.35) * 1.4, 0, 1) : 0;
  var tx = laneX, tz = fwd * (backZ + (upZ - backZ) * advance);

  // Only the player whose LANE the ball is heading into goes for it.
  var incoming = this.ball.live && (this.ball.vel.z * fwd > 0);
  var pred = incoming ? AI.predict(this.ball) : null;
  if (pred && p.slot === this._responsibleSlot(team, pred.x)) { tx = pred.x; tz = pred.z; }

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
  if (!this._reachOK(p.pos)) return;
  // two-bounce rule: serve & return must bounce before being struck
  var mustBounce = (rally.phase === 'serve' || rally.phase === 'return');
  if (mustBounce && rally.bouncesSinceHit < 1) return;

  if (p.isHuman) {
    if (this.swingWindow <= 0 || this.swingUsed) return; // human must time a swing
    this._hit(p, this.swingType);
    this.swingUsed = true;
  } else {
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
  var volley = rally ? (rally.bouncesSinceHit < 1) : false;
  var inKitchen = isErne ? false : (Math.abs(pos.z) < C.KITCHEN);
  var res = Rules.onPaddleHit(this.match, p.team, { volley: volley, inKitchen: inKitchen });
  this.cameraShake = Math.max(this.cameraShake, 0.08);
  p.mesh.swing(swingType || 'fh');
  if (this.audio) this.audio.sfx.paddle();
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
  var maxI = Shots.maxIntent(this.ball.pos.y);

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
  p.mesh.swing(Math.random() < 0.3 ? 'bh' : 'fh');
  if (this.audio) this.audio.sfx.paddle();
  if (rallyOver(res)) { this._endPoint(res); return; }

  // Build opponents object for deeper-target strategy (opposing near team).
  var oppTeam = p.team === 'far' ? 'near' : 'far';
  var opponents = {
    a: this._player(oppTeam, 0),
    b: this._player(oppTeam, 1)
  };

  var shot = AI.chooseShot(p.ai, this.ball, this.match, false, opponents, pos);

  // Deliberate fault: use legacy velocity-based path so faults still miss properly.
  if (shot.fault) {
    var tgtZf = (p.team === 'near') ? -shot.target.z : shot.target.z;
    var spinVecF = Physics.vec(shot.spin.x * -fwd, shot.spin.y, shot.spin.z);
    this._executeHit(shot.target.x, tgtZf, shot.apex, shot.margin, spinVecF, shot.fault);
    return;
  }

  var tgtZ = (p.team === 'near') ? -shot.target.z : shot.target.z;
  var isAtp = shot.type === 'atp';

  // CPU stability → apex modifier.
  var stabilityIdx = this._computeStability(p);
  var quality = Shots.stabilityQuality(stabilityIdx);
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
  this.lastHitCooldown = HIT.COOLDOWN_RALLY;
};

/* ----------------------------- rendering ------------------------------ */
Game.prototype._syncMeshes = function (dt) {
  // ball
  var b = this.ball, bm = this.world.ballMesh;
  bm.position.set(b.pos.x, b.pos.y, b.pos.z);
  bm.rotation.x += (b.vel.z) * dt * 2; bm.rotation.z -= (b.vel.x) * dt * 2;
  // contact shadow blob
  var blob = this.world.ballBlob;
  blob.position.set(b.pos.x, 0.02, b.pos.z);
  var sc = clamp(1.4 - b.pos.y * 0.18, 0.4, 1.4);
  blob.scale.setScalar(sc);
  blob.material.opacity = clamp(0.35 - b.pos.y * 0.03, 0.06, 0.35);
  // trail
  this._updateTrail();

  // players — each faces the OPPONENT's side and only yaws toward the ball.
  for (var i = 0; i < this.players.length; i++) {
    var pl = this.players[i];
    var v = Math.hypot(pl.vel.x, pl.vel.z);
    var base = (pl.team === 'near') ? Math.PI : 0;
    var yaw = clamp((this.ball.pos.x - pl.pos.x) * 0.16, -0.6, 0.6);
    if (v > 0.4) yaw = clamp(pl.vel.x * 0.18, -0.7, 0.7);
    pl.mesh.object.position.set(pl.pos.x, 0, pl.pos.z);
    pl.mesh.update(dt, { speed: v, facing: base + yaw });
  }

  // keep the "you" ring under players[0], with a gentle pulse
  if (this.youMarker) {
    var me = this.players[0].pos;
    this.youMarker.position.set(me.x, 0.04, me.z);
    var pulse = 1 + Math.sin(performance.now() / 320) * 0.07;
    this.youMarker.scale.set(pulse, pulse, 1);
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
      yourTurn = (this._responsibleSlot('near', this._aimPred.x) === human.slot);
    } else { this._aimPred = null; }
    if (yourTurn) {
      var at = this._aimTarget(human);
      this.aimMarker.position.set(at.x, 0.04, at.z);
      var target = this.swingWindow > 0 ? 0.8 : 0.32;
      this.aimMarker.material.opacity += (target - this.aimMarker.material.opacity) * Math.min(1, dt * 10);
    } else {
      this.aimMarker.material.opacity += (0 - this.aimMarker.material.opacity) * Math.min(1, dt * 10);
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
  this._message(names[this.camMode], 1.2);
  if (this.hud && this.hud.setCamMode) this.hud.setCamMode(this.camMode, names[this.camMode]);
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

Game.prototype.render = function () { this.renderer.render(this.scene, this.camera); };
