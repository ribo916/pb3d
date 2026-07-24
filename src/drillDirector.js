'use strict';

/* ============================================================================
 * drillDirector.js — Scripted-AI direction for Drill mode.
 *
 * Drill mode is NOT a fake animation: it's a real, live simulated rally
 * (real physics ball, real AI shot/movement decisions, real fault/rules
 * detection) directed just enough to reliably enact a specific drill's
 * premise. This module scripts the minimum: the starting formation, one
 * opening feed, and one forced response shot. Everything after that is
 * genuine AI/physics free-play — src/game.js's normal _tickRally/_cpuHit/
 * _moveCPU pipeline runs completely unmodified once a rep is live.
 *
 * "The drill is the drill" — not open-ended AI play. The live rep is
 * bounded to DRILL.MAX_SHOTS paddle contacts (feed counts as #1), captured
 * into a fresh recorder started exactly at Setup, then looped forever as a
 * real recorded replay (src/replay.js's makePlayback — the same engine
 * instant replay uses) with real pause/rewind/scrub, instead of continuing
 * to re-simulate indefinitely.
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
const SLOT_KEYS = ['P1', 'P2', 'P3', 'P4'];
// game.js's STATE.SERVE/STATE.RALLY string values, inlined to avoid a
// circular import (game.js imports this module).
const STATE_SERVE = 'serve';
const STATE_RALLY = 'rally';

// Snap all 4 players to the drill's Setup formation and arm the hold timer
// before the next scripted feed fires. Called once, at drill start, to run
// the single bounded live rep that gets captured and looped from then on.
export function resetRep(game, drillData) {
  var positions = (drillData.steps[0] && drillData.steps[0].positions) || {};
  for (var i = 0; i < 4; i++) {
    var pos = positions[SLOT_KEYS[i]];
    if (!pos) continue;
    var p = game.players[i];
    p.pos.x = pos.x; p.pos.z = pos.z;
    p.vel.x = 0; p.vel.z = 0;
    p.move.kind = 'ready';
    p.move.target.x = pos.x; p.move.target.z = pos.z;
    p.move.split = 0; p.move.plant = 0; p.move.lunge = 0;
  }
  game.ball.live = false;

  // Reps never accumulate real score — a long drill session should never be
  // able to trip a real match.gameOver.
  game.match.scores = { near: 0, far: 0 };
  game.match.gameOver = false;
  game.match.winner = null;

  game.drillForcedShot = null;
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

// Called once the bounded live rep ends (deliberately cut at MAX_SHOTS, or
// a natural fault before that) — snapshot what was just recorded and loop
// it as a real replay, with real pause/rewind/scrub (game.drillToggle/
// drillSeek in game.js), instead of re-simulating a fresh rep.
export function enterReplayLoop(game) {
  var window = game.recorder.snapshotWindow();
  if (!window.frames.length) return;
  game.drillPlayback = makePlayback(window, 1);
  game.drillReplaying = true;
  game._drillLoopHoldTimer = 0;
  game.drillPlayback.play();
}

// Fire the drill's one scripted opening ball: a soft, floaty feed from P1
// toward P3, framed as the return itself (not a real serve — see the rally
// seeding below), then hand off to the real rally engine.
export function fireFeed(game, drillData) {
  var positions = (drillData.steps[0] && drillData.steps[0].positions) || {};
  var p1 = positions.P1, p3 = positions.P3;
  if (!p1 || !p3) return;

  // Seed the rally directly rather than calling Rules.startRally(): P1's
  // feed isn't a legal serve (no service-box check should apply to it), and
  // pre-seeding shots:1 makes the feed's own onPaddleHit call bump shots to
  // 2 before the ball's first floor contact, skipping onFloor's
  // shots===1 serve-fault check entirely. doubleBounceOpen:true is required
  // (not optional) — it's normally only set inside onFloor's shots===2
  // branch, which this sequence skips past; without it every future volley
  // in the rep would be fault-locked. server:'far' makes P3/P4 the
  // "serving" team, which is what src/strategies/doubles.js's net-advance
  // gate needs to make P3/P4 crash the net specifically after the 3rd shot
  // (the drill's "Resolution" step) — and, symmetrically, makes P1/P2
  // (non-serving) advance immediately once phase flips to 'open', matching
  // "the moment the ball leaves P1's paddle, P1 starts moving forward
  // toward NVZ." Both happen for free, no extra scripting.
  game.match.server = 'far';
  game.match.rally = {
    phase: 'return', lastHitter: 'far', shots: 1,
    bouncesSinceHit: 0, doubleBounceOpen: true,
    serverInfo: null, live: true, faulted: false
  };

  var spec = Shots.specV2('feed', C.KITCHEN, C.HALF_L);
  game.ball.pos.x = p1.x; game.ball.pos.y = 0.9; game.ball.pos.z = p1.z;
  // Aim at whichever x-sign P3 (far, slot 0) is actually responsible for
  // right now (Game.prototype._responsibleSlot's own logic, derived here so
  // the forced-shot hitter match below is guaranteed correct) — NOT P3's
  // raw Setup x. The grid-authored Setup coord (F1, positive x) doesn't
  // necessarily match Rules.sideX's court-side convention; landing the feed
  // in the wrong lane hands the real contact to P4 instead of P3, and the
  // forced drop shot never fires.
  var side = (0 === Rules.rightSlot(game.match, 'far')) ? 'R' : 'L';
  var targetX = Rules.sideX('far', side) * Math.abs(p3.x);
  var targetZ = p1.z > 0 ? -spec.landZ : spec.landZ; // toward P3's (far) side
  var spin = { x: spec.spinX || 0, y: spec.spinY || 0, z: 0 };
  game._executeShotV2(targetX, targetZ, spec.apex, spec.margin, spin, { type: 'feed' });
  Rules.onPaddleHit(game.match, 'near', { volley: false, inKitchen: false });
  game.drillHitCount = 1; // the feed is contact #1 of DRILL.MAX_SHOTS

  // Arm the one forced response: P3's next contact must be a drop at P1's
  // feet. Everything after that is real AI free-play.
  game.drillForcedShot = { hitter: game.players[2] };

  game.state = STATE_RALLY;
}

// The drill's one forced-shot decision — pure, same {target,apex,spin,type,
// margin} shape AI.chooseShot() returns, so every downstream consumer in
// _cpuHit treats it identically to a real AI shot. Deliberately not forced
// to "clean" quality: _cpuHit's real stability-based apex degradation stays
// in effect, so a late/stretched P3 arrival can organically produce the
// drill's own documented "Popup: P2 attacks" branch instead of a clean drop.
export function dropShotTarget(p1Pos, KITCHEN, HALF_L) {
  var sp = Shots.specV2('drop', KITCHEN, HALF_L);
  return {
    target: { x: p1Pos.x, z: Math.abs(p1Pos.z) },
    apex: sp.apex,
    margin: sp.margin,
    spin: { x: sp.spinX || 0, y: sp.spinY || 0, z: 0 },
    type: 'drop'
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
