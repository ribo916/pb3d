/* ============================================================================
 * ai.js — Opponent brain: positioning, anticipation, shot selection.
 * Pure logic. Ported from the original Picklelife js/ai.js (ESM).
 * ==========================================================================*/
'use strict';

import { COURT, GRAVITY, bezierPoint } from './physics.js';
import { SPECIALTY, POWER_CAP } from './constants.js';
import * as DoublesStrategy from './strategies/doubles.js';
import * as SinglesStrategy from './strategies/singles.js';

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

function strategyForMode(mode) {
  return mode === 'singles' ? SinglesStrategy : DoublesStrategy;
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
export function chooseMovement(ai, ball, rally, ctx) {
  ctx = ctx || {};
  ctx.prediction = ctx.prediction || predict(ball);
  var out = strategyForMode(ctx.mode).chooseMovement(ai, ball, rally, ctx);
  ai.target = out.target;
  return out;
}

/* Choose a shot when the AI strikes the ball. Returns
 * { target:{x,z}, apex, spin:{x,y,z} } to feed the spline shot system.
 * isServe  = the AI is serving.
 * opponents = optional {a:{pos,vel}, b:{pos,vel}} positions of the two near-side
 *             players — used to target the deeper one's feet.
 * hitterPos = optional {x,z} of the AI hitter — used for Erne/ATP detection.
 */
export function chooseShot(ai, ball, match, isServe, ctx) {
  ctx = ctx || {};
  return strategyForMode(ctx.mode).chooseShot(ai, ball, match, isServe, ctx);
}
