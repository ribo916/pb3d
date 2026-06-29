/* ============================================================================
 * shots.js — Pickleball SHOT MODEL. The single tuning surface for what each
 * shot type does and which shot an intent + court position produces.
 * Pure logic (no DOM/Three). Ported from the original Picklelife js/shots.js.
 *
 * A "shot" is a parameter profile fed to physics.launch(p0, target, apex,
 * margin, spin): apex = arc height, landZ = how far past the net it lands
 * (meters, opponent side), spinX = topspin(+)/backspin(-), spinY = sidespin,
 * margin = net-clearance buffer. launch() auto-raises a too-low arc to clear
 * the net, so a low-apex dink aimed just over the net is lofted only the
 * minimum needed.
 * ==========================================================================*/
'use strict';

import { FT, STABILITY, POWER_CAP } from './constants.js';

// margin = net-clearance buffer (m). launch() is ballistic (no drag), but real
// flight has drag that pulls slow/soft shots down short — so soft shots carry a
// GENEROUS margin to avoid clipping the tape. apex is also lifted a touch.
const PROFILES = {
  drive:   { apex: 1.3, depthFrac: 0.82, spinX:  4.0, spinY: 0, margin: 0.22 },
  drop:    { apex: 1.75, absZ: null,     spinX: -2.0, spinY: 0, margin: 0.22 },
  dink:    { apex: 1.4, absZ: null,      spinX: -1.0, spinY: 0, margin: 0.16 },
  lob:     { apex: 4.2, depthFrac: 0.85, spinX: -1.0, spinY: 0, margin: 0.30 },
  speedup: { apex: 1.3, depthFrac: 0.50, spinX:  4.0, spinY: 0, margin: 0.18 }
};

export const TYPES = ['drive', 'drop', 'dink', 'lob', 'speedup'];

// Resolve a shot's landing distance from the net (meters) for this court.
function landingZ(type, KITCHEN, HALF_L) {
  if (type === 'drop') return KITCHEN * 0.55;      // soft, dies in the kitchen
  if (type === 'dink') return KITCHEN + 0.25;      // just over the non-volley line
  var p = PROFILES[type] || PROFILES.drive;
  return HALF_L * (p.depthFrac || 0.80);
}

/* params(type, KITCHEN, HALF_L) -> { apex, landZ, spinX, spinY, margin }.
 * KITCHEN/HALF_L default to regulation if the caller omits geometry (tests). */
export function params(type, KITCHEN, HALF_L) {
  if (KITCHEN == null) KITCHEN = 7 * FT;
  if (HALF_L == null) HALF_L = 22 * FT;
  var p = PROFILES[type] || PROFILES.drive;
  return {
    apex: p.apex, landZ: landingZ(type, KITCHEN, HALF_L),
    spinX: p.spinX, spinY: p.spinY, margin: p.margin
  };
}

// Depth AIMING: nudge a shot's landing distance from the net based on the held
// directional input at contact. depthAim is -move.z, so +1 = pressing forward
// (up on the pad, toward the net) -> land deeper toward the baseline; -1 =
// pressing back -> pull it shorter toward the kitchen line. Pure placement; the
// shot type (apex/spin) is unchanged. Clamped to stay legal (and launch() still
// raises the arc to clear the net). KITCHEN/HALF_L default to regulation.
export function aimDepth(baseLandZ, depthAim, KITCHEN, HALF_L) {
  if (KITCHEN == null) KITCHEN = 7 * FT;
  if (HALF_L == null) HALF_L = 22 * FT;
  if (!isFinite(depthAim)) depthAim = 0;
  depthAim = Math.max(-1, Math.min(1, depthAim));
  var nearFloor = KITCHEN * 0.5;                                    // just over the net
  var landZ = baseLandZ;
  if (depthAim > 0) landZ += depthAim * (HALF_L * 0.9 - baseLandZ); // toward baseline
  else landZ += depthAim * (baseLandZ - nearFloor);                 // toward the net
  return Math.max(nearFloor, Math.min(HALF_L * 0.92, landZ));
}

// Which court zone a player is in, from |z| (distance from the net).
export function zoneOf(absZ, KITCHEN, HALF_L) {
  if (absZ <= KITCHEN + 0.4) return 'kitchen';
  if (absZ >= HALF_L - 1.4) return 'deep';
  return 'transition';
}

/* The shared brain: intent (+ position + ball height) -> shot type.
 *   intent: 'power' | 'touch' | 'lob'
 *   zone:   'kitchen' | 'transition' | 'deep'
 *   ballHigh: is the ball high enough to attack (speed up)?
 */
export function classify(zone, intent, ballHigh) {
  if (intent === 'lob') return 'lob';
  if (zone === 'kitchen') {
    if (intent === 'touch') return 'dink';
    return ballHigh ? 'speedup' : 'drive'; // can't speed up a low ball — firm it
  }
  // deep or transition
  return (intent === 'touch') ? 'drop' : 'drive';
}

export function resolve(absZ, ballY, intent, kitchen, halfL) {
  var zone = zoneOf(absZ, kitchen, halfL);
  var type = classify(zone, intent, ballY > 0.95);
  return { type: type, sp: params(type, kitchen, halfL) };
}

/* ============================================================
 * Stability Index helpers
 * ============================================================*/

/* Map raw stability [0,1] + difficulty to a quality tier.
 * Returns 'clean' | 'float' | 'popup'. */
export function stabilityQuality(stability) {
  // stability is already 0-1 from game._computeStability (sweet-spot applied there).
  if (stability <= STABILITY.POPUP_THRESHOLD) return 'popup';
  if (stability <= STABILITY.FLOAT_THRESHOLD) return 'float';
  return 'clean';
}

/* Scale a base apex by shot quality. */
export function apexForQuality(baseApex, quality) {
  if (quality === 'popup') return baseApex * STABILITY.POPUP_APEX_MULT;
  if (quality === 'float') return baseApex * STABILITY.FLOAT_APEX_MULT;
  return baseApex;
}

/* ============================================================
 * Power cap helpers
 * ============================================================*/

/* Given incoming ball height, return the maximum allowed intent string.
 * 'touch'  — ball is at or below net height → forced soft shot
 * 'power'  — normal range
 * 'smash'  — ball is high enough to smash */
export function maxIntent(ballY) {
  if (ballY <= POWER_CAP.NET_H) return 'touch';
  if (ballY >= POWER_CAP.SMASH_H) return 'smash';
  return 'power';
}

/* ============================================================
 * Dink battle target
 * ============================================================*/

/* Return P2 for a Dink Battle (both teams at kitchen, ball below net height).
 * Default: cross-court diagonal kitchen corner.
 * If the player is pulled severely (|playerX - ballX| > 1.5m): return a
 * straight-ahead neutral dink to avoid giving away more position. */
export function dinkBattleTarget(playerPos, ballPos, fwd, KITCHEN, HALF_W) {
  if (KITCHEN == null) KITCHEN = 7 * FT;
  if (HALF_W == null) HALF_W = 10 * FT;
  var pulled = Math.abs(playerPos.x - ballPos.x) > 1.5;
  var targetX = pulled ? 0 : -Math.sign(playerPos.x || 1) * HALF_W * 0.70;
  var targetZ = -fwd * (KITCHEN * 0.85);
  return { x: targetX, z: targetZ };
}
