/* ============================================================================
 * ai.js — Opponent brain: positioning, anticipation, shot selection.
 * Pure logic. Ported from the original Picklelife js/ai.js (ESM).
 * ==========================================================================*/
'use strict';

import { COURT, GRAVITY, bezierPoint } from './physics.js';
import * as Shots from './shots.js';
import * as Rules from './rules.js';
import { SPECIALTY, POWER_CAP } from './constants.js';

const C = COURT;

function normalizeLevel(level) {
  if (level === 'family' || level === 'damaged') return 'family';
  if (level === '4.0' || level === 'beginner' || level === 'easy') return 'easy';
  if (level === '4.5' || level === 'intermediate' || level === 'normal') return 'normal';
  if (level === '5.0' || level === 'advanced' || level === 'hard') return 'hard';
  return level || 'normal';
}

export const LEVELS = {
  family: { speed: 5.2, react: 0.18, err: 0.28, smart: 0.7, aggression: 0.45, miss: 0.08 },
  easy:   { speed: 4.8, react: 0.30, err: 0.45, smart: 0.4, aggression: 0.25, miss: 0.18 },
  normal: { speed: 5.2, react: 0.18, err: 0.28, smart: 0.7, aggression: 0.45, miss: 0.08 },
  hard:   { speed: 5.6, react: 0.09, err: 0.12, smart: 0.92, aggression: 0.6, miss: 0.02 }
};

export function makeAI(level) {
  level = normalizeLevel(level);
  return {
    cfg: LEVELS[level] || LEVELS.normal,
    level: level || 'normal',
    target: { x: 0, z: -C.HALF_L + 0.7 }, // home: behind far baseline
    reactTimer: 0
  };
}

// Predict where the ball will cross the AI's reachable plane (its side).
// Returns predicted {x, z} landing/intercept on the far side, or null.
// If ball.spline is set, samples the Bezier directly (exact and fast).
export function predict(ball) {
  if (!ball.live) return null;

  // Fast path: ball is on a spline — evaluate endpoint directly.
  if (ball.spline) {
    var sp = ball.spline;
    return { x: sp.P2.x, z: sp.P2.z };
  }

  // Fallback: crude ballistic integration (no drag/Magnus).
  var p = { x: ball.pos.x, y: ball.pos.y, z: ball.pos.z };
  var v = { x: ball.vel.x, y: ball.vel.y, z: ball.vel.z };
  var g = GRAVITY, dt = 1 / 60, steps = 0;
  while (steps < 240) {
    v.y -= g * dt;
    p.x += v.x * dt; p.y += v.y * dt; p.z += v.z * dt;
    if (p.y <= C.BALL_R && v.y < 0) {
      return { x: p.x, z: p.z };
    }
    if (p.z < -C.HALF_L + 0.5 && v.z < 0) return { x: p.x, z: p.z };
    steps++;
  }
  return { x: p.x, z: p.z };
}

/* Check whether the net-partner on the given team should poach a shot whose
 * spline is described by P0/P1/P2. Difficulty-scaled per the spec:
 *   easy  (4.0): never poaches.
 *   normal(4.5): poaches if P2 lands within a narrow lateral bounding box.
 *   hard  (5.0 / Pro): physical check — samples curve for closest approach.
 * Returns true when the partner should intercept. */
export function checkPoach(ai, P0, P1, P2, partnerPos) {
  var level = ai.level;
  if (level === 'easy' || level === 'family') return false;

  if (level === 'normal') {
    // Narrow lateral bounding box: poach only if P2 lands near the partner's x.
    return Math.abs(P2.x - partnerPos.x) < SPECIALTY.POACH_NORMAL_X_HALF;
  }

  // hard (Pro): check if any point on the Bezier passes within reach radius.
  var reach = SPECIALTY.POACH_PRO_REACH;
  var STEPS = 12; // sample resolution
  for (var i = 0; i <= STEPS; i++) {
    var t = i / STEPS;
    var pt = bezierPoint(P0, P1, P2, t);
    var dx = pt.x - partnerPos.x, dz = pt.z - partnerPos.z;
    if (Math.sqrt(dx * dx + dz * dz) < reach) return true;
  }
  return false;
}

/* Decide where the AI should move this frame.
 * Returns a target {x, z} for the far-side player. Handles "stack at kitchen"
 * strategy: after the third shot, good players crash the non-volley line.
 */
export function chooseMovement(ai, ball, rally) {
  var cfg = ai.cfg;
  var pred = predict(ball);
  var homeZ = -C.HALF_L + 0.7;
  var kitchenZ = -C.KITCHEN - 0.25;
  var tx = 0, tz = homeZ;

  var ballComingToFar = ball.live && ball.vel.z < 0 && ball.pos.z < C.HALF_L;

  if (pred && ballComingToFar) {
    tx = pred.x;
    // depth: if it's a soft ball landing near kitchen, step in; else hold deep
    if (pred.z > -C.KITCHEN - 1.2 && rally && rally.phase === 'open') {
      tz = Math.max(kitchenZ, pred.z - 0.3);
    } else {
      tz = Math.min(homeZ + 1.5, pred.z - 0.4);
    }
  } else {
    // recover toward strategic position (kitchen line if aggressive & rally open)
    if (rally && rally.phase === 'open' && Math.random() < cfg.aggression) tz = kitchenZ;
  }

  // clamp to far half + a bit of margin to chase wide balls
  tx = Math.max(-C.HALF_W - 0.6, Math.min(C.HALF_W + 0.6, tx));
  tz = Math.max(-C.HALF_L - 0.5, Math.min(-0.4, tz));
  ai.target = { x: tx, z: tz };
  return ai.target;
}

/* Choose a shot when the AI strikes the ball. Returns
 * { target:{x,z}, apex, spin:{x,y,z} } to feed the spline shot system.
 * isServe  = the AI is serving.
 * opponents = optional {a:{pos,vel}, b:{pos,vel}} positions of the two near-side
 *             players — used to target the deeper one's feet.
 * hitterPos = optional {x,z} of the AI hitter — used for Erne/ATP detection.
 */
export function chooseShot(ai, ball, match, isServe, opponents, hitterPos) {
  var cfg = ai.cfg;
  var nearBaseZ = C.HALF_L - 0.5;
  var aim, apex, spin = { x: 0, y: 0, z: 0 }, type = 'drive', margin;

  // Difficulty-driven unforced error: occasionally the CPU misjudges and
  // either dumps it into the net or sails it long/wide. This is the primary,
  // monotonic lever that makes lower difficulties easier to beat.
  if (!isServe && Math.random() < cfg.miss) {
    var mode = Math.random();
    if (mode < 0.10) {
      // occasionally dump into the net (most errors sail out instead, below)
      return { target: { x: rand(-1, 1), z: 0.4 }, apex: 0.9, spin: { x: 0, y: 0, z: 0 }, fault: 'net' };
    }
    // sail it out (beyond baseline or wide)
    var outX = (Math.random() < 0.5) ? rand(-C.HALF_W * 0.6, C.HALF_W * 0.6) : (Math.random() < 0.5 ? -1 : 1) * (C.HALF_W + 1.2);
    return { target: { x: outX, z: nearBaseZ + rand(0.8, 2.0) }, apex: 1.6, spin: { x: 3, y: 0, z: 0 }, fault: 'out' };
  }

  if (isServe) {
    // diagonal deep serve into correct box
    var rcv = Rules.currentReceiver(match);
    aim = { x: Rules.sideX(rcv.team, rcv.side) * (C.HALF_W * 0.5), z: (C.HALF_L * 0.75) };
    apex = 2.4; spin.x = 2.0; type = 'serve'; // light topspin
  } else {
    // Pro Erne/ATP — check hitter position before normal shot logic.
    if (cfg.smart >= 0.92 && hitterPos) {
      var hx = Math.abs(hitterPos.x), hz = Math.abs(hitterPos.z);
      if (hx > C.HALF_W + SPECIALTY.ERNE_X_MARGIN && hz < SPECIALTY.ERNE_Z_MAX) {
        // Erne: smash downward from outside the kitchen sideline.
        var erneTargetX = rand(-C.HALF_W * 0.6, C.HALF_W * 0.6);
        return { target: { x: erneTargetX, z: C.HALF_L * 0.35 },
          apex: 0.95, spin: { x: 3.5, y: 0, z: 0 }, type: 'erne', margin: 0.05 };
      }
      if (hx > C.HALF_W + SPECIALTY.ATP_X_MARGIN) {
        // ATP: flat around-the-post shot — P1 will be placed below net by game.js.
        var atpSign = hitterPos.x > 0 ? 1 : -1;
        return { target: { x: atpSign * C.HALF_W * 0.85, z: C.HALF_L * 0.55 },
          apex: 0.75, spin: { x: 0, y: atpSign * 2.0, z: 0 }, type: 'atp', margin: 0 };
      }
    }

    // SKILL-SCALED shot selection. Intent (power vs touch) is chosen from the
    // hitter's court zone, the ball height, and difficulty: beginners (low
    // smart) bang power from everywhere; advanced players drop from the back,
    // dink at the kitchen, and speed up balls that float high.
    var smart = cfg.smart;
    var absZ = Math.abs(ball.pos.z);
    var zone = Shots.zoneOf(absZ, C.KITCHEN, C.HALF_L);
    var ballHigh = ball.pos.y > 0.95;
    var intent;

    // Overhead smash: ball is high — return a low-apex shot that dives steeply
    // downward. Skill-gated so Pro attacks almost every pop-up.
    if (ball.pos.y >= 1.3 && Math.random() < smart) {
      var smashDepth = C.HALF_L * 0.75;
      var smashAimX = rand(-C.HALF_W * 0.72, C.HALF_W * 0.72);
      if (opponents) {
        var sdf = (Math.abs(opponents.a.pos.z) >= Math.abs(opponents.b.pos.z))
          ? opponents.a : opponents.b;
        smashDepth = Math.max(C.KITCHEN * 1.5, Math.min(C.HALF_L * 0.92, Math.abs(sdf.pos.z)));
        var sSign = (sdf.pos.x >= 0) ? -1 : 1;
        smashAimX = Math.max(-C.HALF_W * 0.88, Math.min(C.HALF_W * 0.88,
          sdf.pos.x + sSign * 0.6));
      }
      return {
        target: { x: smashAimX, z: smashDepth },
        apex: POWER_CAP.NET_H + 0.06,  // just clears net → steep downward angle
        spin: { x: 5.0 + smart * 2.0, y: 0, z: 0 },
        type: 'speedup', margin: 0.06, isSmash: true
      };
    }

    // Return of serve (2nd paddle contact): always drive deep regardless of ball
    // height — no pro drops the return. rally.phase is already 'open' here
    // (advanced by onPaddleHit before chooseShot is called), so key off shots===2.
    // This must come before the power-cap check so it isn't overridden.
    var isReturn = match && match.rally && match.rally.shots === 2;
    // Third shot (serving team's first open-play hit): strongly prefer a drop.
    // Shots alternate so shots===3 is always the serving team hitting again.
    var isThirdShot = match && match.rally && match.rally.shots === 3;
    if (isReturn) {
      intent = 'power';
    } else if (isThirdShot && zone !== 'kitchen') {
      // smart=0.40 (easy): ~37.5%; smart=0.70 (normal): ~75%; smart=0.92 (hard): ~97.5%
      var thirdShotDrop = Math.max(0, smart - 0.1) * 1.25;
      intent = (Math.random() < thirdShotDrop) ? 'touch' : 'power';
    // Power cap: ball at or below net height forces a soft shot.
    } else if (ball.pos.y <= POWER_CAP.NET_H) {
      intent = 'touch';
    } else if (Math.random() < 0.06 * smart) {
      intent = 'lob';                                   // occasional change-up
    } else if (zone === 'kitchen') {
      if (ballHigh && Math.random() < smart) intent = 'power';        // attack high ball -> speedup
      else intent = (Math.random() < Math.max(0, smart - 0.3) * 1.2) ? 'touch' : 'power'; // dink vs pop
    } else {
      // Third shot and beyond: drop tendency rises with skill (third-shot-drop strategy).
      var dropChance = Math.max(0, smart - 0.45) * 1.1;
      intent = (Math.random() < dropChance) ? 'touch' : 'power';
    }
    var sr = Shots.resolve(absZ, ball.pos.y, intent, C.KITCHEN, C.HALF_L);
    type = sr.type; var sp = sr.sp;

    // Deeper-opponent targeting: default aim toward the opponent who is further
    // from the net, aimed laterally away from their body.
    var aimX;
    if (opponents && (type === 'drive' || type === 'speedup' || type === 'drop')) {
      var deeper = (Math.abs(opponents.a.pos.z) >= Math.abs(opponents.b.pos.z))
        ? opponents.a : opponents.b;
      var awaySign = (deeper.pos.x >= 0) ? -1 : 1; // aim away from their body
      aimX = deeper.pos.x + awaySign * 0.6;
      aimX = Math.max(-C.HALF_W * 0.88, Math.min(C.HALF_W * 0.88, aimX));
      if (type === 'drive' || type === 'speedup') {
        // Aim at wherever their feet actually are on the court.
        // Minimum depth is mid-transition so drives never plop into the kitchen.
        var feetDepth = Math.abs(deeper.pos.z);
        feetDepth = Math.max(C.KITCHEN * 1.5, Math.min(C.HALF_L * 0.92, feetDepth));
        aim = { x: aimX, z: feetDepth };
      } else {
        aim = { x: aimX, z: sp.landZ }; // drop: always target kitchen depth
      }
    } else {
      if (type === 'drive' || type === 'lob') {
        aimX = (Math.random() < 0.5 ? -1 : 1) * C.HALF_W * 0.78; // to a corner
      } else if (type === 'speedup') {
        aimX = rand(-C.HALF_W * 0.4, C.HALF_W * 0.4);           // at the body / middle
      } else {
        aimX = rand(-C.HALF_W * 0.7, C.HALF_W * 0.7);           // drop / dink
      }
      aim = { x: aimX, z: sp.landZ };
    }
    apex = sp.apex; spin.x = sp.spinX; spin.y = sp.spinY; margin = sp.margin;
  }

  // Difficulty error: scatter the aim point.
  var e = cfg.err;
  aim.x += rand(-e, e) * 1.6;
  aim.z += rand(-e, e) * 1.4;
  apex += rand(-e, e) * 0.6;

  return { target: aim, apex: apex, spin: spin, type: type, margin: margin };
}

function rand(a, b) { return a + Math.random() * (b - a); }
