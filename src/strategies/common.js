'use strict';

import { COURT } from '../physics.js';
import { SINGLES, POWER_CAP } from '../constants.js';
import { other } from '../rules.js';

const C = COURT;

export function clampX(x, frac) {
  return Math.max(-C.HALF_W * frac, Math.min(C.HALF_W * frac, x));
}

export function deeperOpponent(opponents) {
  if (!opponents || !opponents.a) return null;
  if (!opponents.b) return opponents.a;
  return (Math.abs(opponents.a.pos.z) >= Math.abs(opponents.b.pos.z)) ? opponents.a : opponents.b;
}

export function loneOpponent(opponents) {
  if (!opponents) return null;
  return opponents.a || opponents.b || null;
}

export function awaySign(x) {
  return (x >= 0) ? -1 : 1;
}

export function randomCornerX() {
  return (Math.random() < 0.5 ? -1 : 1) * C.HALF_W * 0.78;
}

export function singlesPassingTarget(defender, opts) {
  opts = opts || {};
  var widthFrac = opts.widthFrac || SINGLES.OPEN_COURT_PASS_FRAC;
  var wideFrac = opts.wideFrac || SINGLES.WIDE_PUNISH_FRAC;
  var bodyChance = opts.bodyChance === undefined ? SINGLES.BODY_SHOT_CHANCE : opts.bodyChance;
  if (!defender) return randomCornerX();
  if (Math.random() < bodyChance) return clampX(defender.pos.x * 0.22, 0.36);
  var stretched = Math.abs(defender.pos.x) > C.HALF_W * 0.52;
  var passFrac = stretched ? wideFrac : widthFrac;
  return awaySign(defender.pos.x) * C.HALF_W * passFrac;
}

export function feetDepth(defender) {
  var z = defender ? Math.abs(defender.pos.z) : C.HALF_L * 0.8;
  return Math.max(C.KITCHEN * 1.5, Math.min(C.HALF_L * 0.92, z));
}

export function rand(a, b) {
  return a + Math.random() * (b - a);
}

// The gap between risk appetite and shot IQ. Zero for the neutral `balanced`
// style (aggression seeded == shotIQ), so shot-selection formulas that
// subtract `aggBias` reproduce the pre-persona baseline. Positive = a banger
// (attacks more, drops less); negative = a defensive player (resets more).
export function aggBias(cfg) {
  return (cfg.aggression || 0) - (cfg.shotIQ != null ? cfg.shotIQ : cfg.smart || 0);
}

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

// True when every present opponent is packed at/inside the kitchen line — the
// classic "both teams up" situation where a lob over them wins the point.
function opponentsAtKitchen(opponents) {
  if (!opponents) return false;
  var list = [opponents.a, opponents.b].filter(Boolean);
  if (!list.length) return false;
  for (var i = 0; i < list.length; i++) {
    if (Math.abs(list[i].pos.z) > C.KITCHEN + 0.6) return false;
  }
  return true;
}

// Reactive lob decision (replaces the old flat `random < 0.06*smart` roll).
// Fires far more readily when opponents are jammed at the kitchen and our ball
// is too low to attack — the moment a real lob wins — scaled by shot IQ (reading
// the moment) and the persona's lobBias. Keeps a small residual for variety, so
// a `balanced` player in open play lobs at roughly the old rate.
export function situationalLob(opponents, ball, cfg) {
  var lobBias = cfg.lobBias || 1;
  if (lobBias <= 0) return false;
  var shotIQ = (cfg.shotIQ != null ? cfg.shotIQ : cfg.smart) || 0;
  var p = 0.06 * shotIQ; // residual, matches legacy open-play lob rate
  if (opponentsAtKitchen(opponents) && ball.pos.y <= POWER_CAP.NET_H + 0.15) {
    p += 0.30 * shotIQ;
  }
  return Math.random() < clamp01(p * lobBias);
}

// Score-awareness: modulate risk by game state. Protecting a lead near game
// point → play tighter (less aggression, fewer misses); behind late → gamble a
// little. Returns multipliers; neutral (1,1) mid-game so tuning is unchanged.
export function scorePressure(match, team) {
  var out = { aggMul: 1, missMul: 1 };
  if (!match || !match.scores || !team) return out;
  var me = match.scores[team] || 0;
  var opp = match.scores[other(team)] || 0;
  var pt = match.pointTo || 11;
  var late = Math.max(me, opp) >= pt - 2;
  if (!late) return out;
  if (me >= opp) { out.aggMul = 0.85; out.missMul = 0.9; }   // protect: tighten up
  else { out.aggMul = 1.15; }                                 // behind late: go for it
  return out;
}

// Incoming-ball difficulty → unforced-error multiplier. A clean sitter
// (contactQuality→1) roughly halves the miss chance; a stretched, hard ball
// (→0) inflates it. Centered so the average is ~1 (baseline preserved on
// typical contact). `q` is the hitter's Stability Index at contact (0..1).
export function ballDifficultyMult(q) {
  if (q == null) return 1;
  return 0.6 + (1 - clamp01(q)) * 0.8; // q=1 → 0.6, q=0 → 1.4
}
