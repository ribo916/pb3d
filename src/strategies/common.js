'use strict';

import { COURT } from '../physics.js';
import { SINGLES } from '../constants.js';

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
