/* ============================================================================
 * ai.js — Opponent brain: positioning, anticipation, shot selection.
 * Pure logic. Ported from the original Picklelife js/ai.js (ESM).
 * ==========================================================================*/
'use strict';

import { COURT, GRAVITY, bezierPoint, accelV2 } from './physics.js';
import { SPECIALTY, POWER_CAP, PHYS_V2 } from './constants.js';
import * as DoublesStrategy from './strategies/doubles.js';
import * as SinglesStrategy from './strategies/singles.js';
import { PERSONAS, mergeTraits, normalizePersona } from './strategies/personas.js';

const C = COURT;

function normalizeLevel(level) {
  if (level === 'family' || level === 'damaged') return 'family';
  if (level === '4.0' || level === 'beginner' || level === 'easy') return 'easy';
  if (level === '4.5' || level === 'intermediate' || level === 'normal') return 'normal';
  if (level === '5.0' || level === 'advanced' || level === 'hard') return 'hard';
  return level || 'normal';
}

// Difficulty base configs. The old overloaded `smart` scalar is split into two
// independent axes — `shotIQ` (selection quality) and `aggression` (risk) — plus
// `reactJitter` (gaussian spread on reaction so the AI isn't metronomic). For the
// three ladder tiers, aggression is seeded equal to the old `smart` so the
// `balanced` persona reproduces today's attack rate; `family` is deliberately
// re-tuned to a genuine beginner instead of a clone of `normal`. `smart` is kept
// as an alias of `shotIQ` for any un-migrated reference. All numbers are a
// starting point to be balance-checked with tools/play.mjs.
// `timing` (v2 only) is the sigma of the CPU's per-shot contact-timing offset,
// feeding Shots.applyTiming — a lower tier mis-times more, adding organic
// direction skew + pace loss on top of `err` aim scatter. Ignored under v1.
export const LEVELS = {
  family: { speed: 4.4, react: 0.34, reactJitter: 0.10, err: 0.42, miss: 0.16, shotIQ: 0.34, smart: 0.34, aggression: 0.30, timing: 0.45 },
  easy:   { speed: 4.8, react: 0.30, reactJitter: 0.08, err: 0.45, miss: 0.18, shotIQ: 0.40, smart: 0.40, aggression: 0.40, timing: 0.35 },
  normal: { speed: 5.2, react: 0.18, reactJitter: 0.05, err: 0.28, miss: 0.08, shotIQ: 0.70, smart: 0.70, aggression: 0.70, timing: 0.20 },
  hard:   { speed: 5.6, react: 0.09, reactJitter: 0.03, err: 0.12, miss: 0.02, shotIQ: 0.92, smart: 0.92, aggression: 0.92, timing: 0.10 }
};

export { PERSONAS };

// Resolve the effective config for a difficulty tier + persona without building
// a full AI — used by the menu UI to show accurate trait bars for the exact
// opponent the player will face.
export function resolveTraits(level, persona) {
  var base = LEVELS[normalizeLevel(level)] || LEVELS.normal;
  return mergeTraits(base, PERSONAS[normalizePersona(persona)]);
}

export function makeAI(level, persona) {
  level = normalizeLevel(level);
  persona = normalizePersona(persona);
  var base = LEVELS[level] || LEVELS.normal;
  return {
    cfg: mergeTraits(base, PERSONAS[persona]),
    level: level || 'normal',
    persona: persona,
    target: { x: 0, z: -C.HALF_L + 0.7 }, // home: behind far baseline
    reactTimer: 0
  };
}

function strategyForMode(mode) {
  return mode === 'singles' ? SinglesStrategy : DoublesStrategy;
}

// Predict where the ball will cross the AI's reachable plane (its side).
// Returns a unified prediction { x, z, tLeft, peakY } (landing/intercept on the
// far side), or null. Both mechanics share this shape so strategies never touch
// spline/flight internals directly.
//   v1: ball.spline set → exact Bezier endpoint (P2), peak from P1.y.
//   v2: ball.flight set → exact solver landing, peak from cached apexY.
//   neither (post-bounce roll-out, pop-ups): forward-integrate.
export function predict(ball) {
  if (!ball.live) return null;

  // v1 fast path: ball is on a spline — evaluate endpoint directly.
  if (ball.spline) {
    var sp = ball.spline;
    return { x: sp.P2.x, z: sp.P2.z, tLeft: Math.max(0, (sp.duration || 0) - (sp.elapsed || 0)), peakY: sp.P1.y };
  }

  // v2 fast path: cached solver flight — exact landing + apex, O(1).
  if (ball.flight) {
    var fl = ball.flight;
    return { x: fl.landing.x, z: fl.landing.z, tLeft: Math.max(0, (fl.T || 0) - (fl.elapsed || 0)), peakY: fl.apexY };
  }

  // Fallback: forward integration. Use v2 forces when the ball is flagged v2 so
  // post-bounce prediction matches live flight; otherwise crude ballistics.
  var p = { x: ball.pos.x, y: ball.pos.y, z: ball.pos.z };
  var v = { x: ball.vel.x, y: ball.vel.y, z: ball.vel.z };
  var s = ball.spin ? { x: ball.spin.x, y: ball.spin.y, z: ball.spin.z } : { x: 0, y: 0, z: 0 };
  var dt = 1 / 60, steps = 0, t = 0, peakY = p.y;
  while (steps < 240) {
    if (ball.mech === 'v2') {
      var a = accelV2(v, s);
      v.x += a.x * dt; v.y += a.y * dt; v.z += a.z * dt;
      var decay = Math.max(0, 1 - PHYS_V2.SPIN_DECAY * dt);
      s.x *= decay; s.y *= decay; s.z *= decay;
    } else {
      v.y -= GRAVITY * dt;
    }
    p.x += v.x * dt; p.y += v.y * dt; p.z += v.z * dt;
    if (p.y > peakY) peakY = p.y;
    t += dt;
    if (p.y <= C.BALL_R && v.y < 0) return { x: p.x, z: p.z, tLeft: t, peakY: peakY };
    if (p.z < -C.HALF_L + 0.5 && v.z < 0) return { x: p.x, z: p.z, tLeft: t, peakY: peakY };
    steps++;
  }
  return { x: p.x, z: p.z, tLeft: t, peakY: peakY };
}

/* Check whether the net-partner on the given team should poach a shot.
 * The trajectory is passed as `path`, which is either:
 *   v1: { P0, P1, P2 }        — Bezier control points (sampled below), or
 *   v2: { samples, landing }  — pre-sampled flight points + landing.
 * Difficulty-scaled:
 *   easy (4.0): never poaches.
 *   normal(4.5): poach if the landing lands within a narrow lateral box.
 *   hard (5.0/Pro): physical check — any trajectory point within reach radius.
 * Returns true when the partner should intercept. */
export function checkPoach(ai, path, partnerPos) {
  var level = ai.level;
  if (level === 'easy' || level === 'family') return false;

  var landing = path.landing || (path.P2 ? { x: path.P2.x, z: path.P2.z } : null);
  if (level === 'normal') {
    if (!landing) return false;
    return Math.abs(landing.x - partnerPos.x) < SPECIALTY.POACH_NORMAL_X_HALF;
  }

  // hard (Pro): scan trajectory points for a close approach.
  var reach = SPECIALTY.POACH_PRO_REACH;
  var pts;
  if (path.samples) {
    pts = path.samples;
  } else {
    pts = [];
    var STEPS = 12;
    for (var i = 0; i <= STEPS; i++) pts.push(bezierPoint(path.P0, path.P1, path.P2, i / STEPS));
  }
  for (var k = 0; k < pts.length; k++) {
    var dx = pts[k].x - partnerPos.x, dz = pts[k].z - partnerPos.z;
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
