'use strict';

/* ============================================================================
 * drillDirector.js — Scripted-AI direction for Drill mode.
 *
 * Drill mode is NOT a fake animation: it's a real, live simulated rally
 * (real physics ball, real AI shot/movement decisions, real fault/rules
 * detection) directed just enough to reliably enact a specific drill's
 * premise. A drill scripts a `script` sequence — an ordered list of shots,
 * each {hitter, shotType, target}, where `target` is always a named player.
 * script[0] fires directly (the table-setting opener); script[1+] are forced
 * responses, armed one at a time and resolved through the SAME AI-shot-
 * execution pipeline (src/game.js's _cpuHit) real free-play uses, so real
 * stability/timing degradation still applies to them. Once the scripted
 * shots run out, everything is genuine, undirected AI/physics free-play —
 * src/game.js's normal _tickRally/_cpuHit/_moveCPU pipeline runs completely
 * unmodified. Player MOVEMENT is never scripted, only ball CONTACTS — an
 * earlier pass that scripted positions directly produced a visible sliding/
 * gliding artifact (see DRILLS.md's "Pass 2" note); real AI drives movement
 * at all times, including between and during scripted shots.
 *
 * "The drill is the drill" — not open-ended AI play. The live rep is
 * bounded to `_drillMaxShots()` paddle contacts (the opener counts as #1),
 * captured into a fresh recorder started exactly at Setup, then looped
 * forever as a real recorded replay (src/replay.js's makePlayback — the
 * same engine instant replay uses) with real pause/rewind/scrub, instead of
 * continuing to re-simulate indefinitely.
 *
 * Functions here take `game` (a Game instance) and mutate it directly —
 * same layering as src/practice.js (pure helpers) + game.js's _tickPractice/
 * _launchPracticeBall (the actual mutation).
 * ==========================================================================*/

import * as Physics from './physics.js';
import * as Rules from './rules.js';
import * as Shots from './shots.js';
import { makeRecorder, makePlayback } from './replay.js';
import { DRILL } from './constants.js';

const C = Physics.COURT;
// game.js's STATE.SERVE/STATE.RALLY string values, inlined to avoid a
// circular import (game.js imports this module).
const STATE_SERVE = 'serve';
const STATE_RALLY = 'rally';

// Canonical mapping from a drill's P-slot naming to the engine's actual
// roster shape — the single source of truth every other drill-aware module
// (drillStore.js's TEAM_OF/validateDrill, game.js's _initWorld roster
// construction, main.js's character preloading) derives from, instead of
// each keeping its own hardcoded copy of "P1=nearYou" etc. (previously only
// stated in comments in two different files — a real drift risk).
// `teamSlot` is the engine's own 0/1 index within a team; P1/P3 are always
// team-slot 0 by convention, so a solo player on a side (P2/P4 omitted) is
// always slot 0 already — no runtime remapping needed for the "team has
// only 1 player" case (see game.js's _responsibleSlot/_laneSign).
export var SLOT_INFO = {
  P1: { team: 'near', teamSlot: 0, rosterKey: 'nearYou' },
  P2: { team: 'near', teamSlot: 1, rosterKey: 'nearMate' },
  P3: { team: 'far', teamSlot: 0, rosterKey: 'farA' },
  P4: { team: 'far', teamSlot: 1, rosterKey: 'farB' }
};

// Roster size is variable now (2/3/4 players) — resolve a slot key by the
// `.drillSlot` tag game.js's _initWorld stamps on each constructed player,
// not by array index (which would silently break, or throw, for anything
// other than exactly 4 players in P1..P4 order).
function resolvePlayer(game, slotKey) {
  for (var i = 0; i < game.players.length; i++) {
    if (game.players[i].drillSlot === slotKey) return game.players[i];
  }
  return null;
}

// A target player's authored *standing* position can legitimately sit just
// behind the real baseline (drillStore.js's grid rows 1/10 resolve to
// z=±7.5, deliberately beyond HALF_L=±6.706, matching where a player
// naturally stands) — aiming a shot's LANDING point at that exact spot before
// they've moved (i.e. the opener, script[0]) sends it out of bounds. Clamps
// the magnitude to the same safe-inbounds ceiling shots.js's aimDepth already
// uses elsewhere (HALF_L*0.92) without touching the sign, so a forced
// response (script[1+]) that legitimately targets a live, already-in-bounds
// position — the entire point of "drip to P1's feet, wherever P1 is" — is
// left untouched in practice; only a target sitting behind the baseline gets
// pulled in.
function clampLandingZ(z) {
  var mag = Math.min(Math.abs(z), C.HALF_L * 0.92);
  return mag * (z < 0 ? -1 : 1);
}

// Snap all 4 players to the drill's Setup formation and arm the hold timer
// before the next scripted shot fires. Called once, at drill start, to run
// the single bounded live rep that gets captured and looped from then on.
export function resetRep(game, drillData) {
  var positions = drillData.startPositions || {};
  Object.keys(positions).forEach(function (slotKey) {
    var pos = positions[slotKey];
    var p = resolvePlayer(game, slotKey);
    if (!p) return;
    p.pos.x = pos.x; p.pos.z = pos.z;
    p.vel.x = 0; p.vel.z = 0;
    p.move.kind = 'ready';
    p.move.target.x = pos.x; p.move.target.z = pos.z;
    p.move.split = 0; p.move.plant = 0; p.move.lunge = 0;
  });
  game.ball.live = false;

  // Reps never accumulate real score — a long drill session should never be
  // able to trip a real match.gameOver.
  game.match.scores = { near: 0, far: 0 };
  game.match.gameOver = false;
  game.match.winner = null;

  game.drillForcedShot = null;
  game.drillScriptIndex = 0;
  game.drillHitCount = 0;
  game.drillEndGrace = 0;
  game.drillReplaying = false;
  game.drillPlayback = null;
  game._drillLoopHoldTimer = 0;
  // A fresh, generously-sized recorder starting exactly at Setup — so the
  // eventual snapshotWindow() in enterReplayLoop() captures this one
  // bounded rep from its true start, never truncated by a trailing-window
  // that (unlike a real match's rolling ~10s buffer) doesn't apply here.
  game.recorder = makeRecorder(DRILL.RECORD_WINDOW_SEC);

  game.serveDelay = DRILL.SETUP_HOLD;
  game.state = STATE_SERVE;
}

// Called once the bounded live rep ends (deliberately cut at the drill's
// max-shots cap, or a natural fault before that) — snapshot what was just
// recorded and loop it as a real replay, with real pause/rewind/scrub
// (game.drillToggle/drillSeek in game.js), instead of re-simulating a fresh
// rep.
export function enterReplayLoop(game) {
  var window = game.recorder.snapshotWindow();
  if (!window.frames.length) return;
  game.drillPlayback = makePlayback(window, 1);
  game.drillReplaying = true;
  game._drillLoopHoldTimer = 0;
  game.drillPlayback.play();
}

// Arms game.drillForcedShot for drillData.script[game.drillScriptIndex], if
// one exists — called once right after the opener fires (to arm script[1]),
// and again each time a forced shot resolves (to arm the one after it).
// Leaves drillForcedShot null once the script runs out, handing control to
// real undirected AI for the remainder of the rep. Same "arm now, resolve
// later when the ball actually arrives" shape DRILLS.md calls out as
// load-bearing (shared with poaching/the super's blast) — chained across an
// index now, not a single flag.
export function armNextScriptedShot(game, drillData) {
  var script = (drillData && drillData.script) || [];
  var next = script[game.drillScriptIndex];
  if (!next) { game.drillForcedShot = null; return; }
  var hitter = resolvePlayer(game, next.hitter);
  game.drillForcedShot = hitter ? { hitter: hitter } : null;
}

// Fire the drill's scripted opener (script[0]) — a real, physics-fired shot,
// injected directly via _executeShotV2 (a table-setting injection, not a
// "real" swing with timing/stability noise — there's no player realistically
// winding up for it). Seeds a synthetic match.rally directly rather than
// calling Rules.startRally(): this shot isn't a legal serve, so no
// service-box check should apply to it.
export function fireOpeningShot(game, drillData) {
  var script = (drillData && drillData.script) || [];
  var first = script[0];
  if (!first) return;
  var hitter = resolvePlayer(game, first.hitter);
  var targetPlayer = resolvePlayer(game, first.target);
  if (!hitter || !targetPlayer) return;

  var hitterTeam = hitter.team;
  var responderTeam = (hitterTeam === 'near') ? 'far' : 'near';
  // Seed a rally already "deep in" (shots:4, phase:'open') rather than
  // framing this shot as a serve or a return — skips Rules.onFloor's
  // shots===1 serve-fault check on the very first bounce, and clears
  // strategies/doubles.js's advanceAllowed threshold (shots>=3) so BOTH
  // teams read as "already at the net" immediately, matching every drill's
  // premise so far (nobody should drift baseline-ward the way a fresh
  // point's early shots would cause). doubleBounceOpen:true is required
  // (not optional) — normally only set inside onFloor's shots===2 branch,
  // which this seed skips past; without it every future volley in the rep
  // would be fault-locked. shots:4 also clears strategies/common.js's
  // rallyLengthMult ramp (starts past 8), so it adds no artificial miss
  // pressure either.
  game.match.server = responderTeam;
  game.match.rally = {
    phase: 'open', lastHitter: hitterTeam, shots: 4,
    bouncesSinceHit: 0, doubleBounceOpen: true,
    serverInfo: null, live: true, faulted: false
  };

  var spec = Shots.specV2(first.shotType, C.KITCHEN, C.HALF_L);
  game.ball.pos.x = hitter.pos.x; game.ball.pos.y = 0.9; game.ball.pos.z = hitter.pos.z;
  var spin = { x: spec.spinX || 0, y: spec.spinY || 0, z: 0 };
  // Target the named player's ACTUAL current position (x and z) directly —
  // the chess-like "aim at this player" semantics the schema promises, and
  // (unlike deriving an x-sign from Rules.sideX's service-court-rotation
  // formula, which two earlier drills got wrong) can't misfire onto empty
  // court: it's aimed at exactly where the target visibly stands. game.js's
  // _checkContacts/_moveCPU also override the engine's normal x-zone
  // contact-responsibility check whenever a drillForcedShot is armed, so the
  // named target always gets the chance to hit it regardless of which zone
  // their authored position happens to sit in.
  game._executeShotV2(targetPlayer.pos.x, clampLandingZ(targetPlayer.pos.z), spec.apex, spec.margin, spin, { type: first.shotType });
  Rules.onPaddleHit(game.match, hitterTeam, { volley: false, inKitchen: false });
  game.drillHitCount = 1; // the opener is contact #1 of the drill's max-shots cap

  game.drillScriptIndex = 1;
  armNextScriptedShot(game, drillData);

  game.state = STATE_RALLY;
}

// The forced-shot decision for drillData.script[scriptIndex] — pure given
// its inputs, same {target,apex,spin,type,margin} shape AI.chooseShot()
// returns, so every downstream consumer in _cpuHit (stability-based apex
// degradation, CPU timing, poach-check) treats it identically to a real AI
// shot. A scripted forced shot is deliberately NOT forced to "clean"
// quality — a late/stretched arrival can still organically pop the ball up.
//
// target.z follows the same convention _cpuHit's normal AI path expects
// (src/game.js, the `tgtZ = (p.team==='near') ? -shot.target.z :
// shot.target.z` line): the hitter's own team sign-flips it at execution
// time, so it's pre-flipped here to cancel that out and land on the
// target's real, signed z regardless of which side the CURRENT hitter is
// on — generalizing the original dropShotTarget, which only ever had a
// far-team hitter (P3) targeting a near-team player (P1) and so never
// needed the flip made explicit.
export function getScriptedShot(game, drillData, scriptIndex, hitterPlayer) {
  var script = (drillData && drillData.script) || [];
  var entry = script[scriptIndex];
  if (!entry) return null;
  var targetPlayer = resolvePlayer(game, entry.target);
  if (!targetPlayer) return null;
  var sp = Shots.specV2(entry.shotType, C.KITCHEN, C.HALF_L);
  var zSign = (hitterPlayer.team === 'near') ? -1 : 1;
  return {
    target: { x: targetPlayer.pos.x, z: clampLandingZ(targetPlayer.pos.z) * zSign },
    apex: sp.apex,
    margin: sp.margin,
    spin: { x: sp.spinX || 0, y: sp.spinY || 0, z: 0 },
    type: entry.shotType
  };
}

// Fault/outcome labels for the drill's rep-end flash message — deliberately
// NOT src/game.js's _resultMessage(), which says "You score!"/"Opponent
// WINS", meaningless with no human in a drill.
export var DRILL_RESULT_LABELS = {
  'out-of-bounds': 'OUT!',
  'into-net': 'INTO THE NET',
  'no-return': 'NO RETURN',
  'kitchen-volley': 'KITCHEN VOLLEY!',
  'volley-before-double-bounce': 'MUST BOUNCE FIRST',
  'serve-fault': 'FAULT',
  'serve-wrong-court': 'FAULT',
  'drill-end': 'REP COMPLETE'
};
