/* ============================================================================
 * shots.js — Pickleball SHOT MODEL. The single tuning surface for what each
 * shot type does and which shot an intent + court position produces.
 * Pure logic (no DOM/Three). Ported from the original Picklelife js/shots.js.
 *
 * A "shot" is a *physical envelope* fed to physics.solveArc: an apex HINT (the
 * solver raises it as needed to clear the net), a landing depth (meters past the
 * net, opponent side), a spin vector (spinX = topspin(+)/backspin(-), spinY =
 * sidespin), a net margin, and a speed cap (vMax). The solver auto-raises a
 * too-low arc to clear the net, so a low-apex dink aimed just over the net is
 * lofted only the minimum needed.
 * ==========================================================================*/
'use strict';

import { FT, STABILITY, POWER_CAP, TIMING_V2, PRACTICE } from './constants.js';

export const TYPES = ['drive', 'drop', 'dink', 'lob', 'speedup'];

/* ============================================================================
 * Shot grammar. The ball flies honest physics, so a shot is a *physical
 * envelope* fed to physics.solveArc: an apex HINT (the solver raises it as
 * needed to clear the net), a landing depth, a spin vector, a net margin, and a
 * speed cap (vMax). All shots — including serve/smash/ATP/Erne — are profiles
 * here so tuning stays in one place. `direct:true` = contact is above the target
 * (smash/Erne): aim straight down the line, search speed only. `allowNet:true` =
 * skip net-clearance raising (ATP goes around the post; deliberate faults go
 * into it).
 * ==========================================================================*/
const PROFILES_V2 = {
  //         apexHint depth               spinX  spinY margin vMax  flags
  // `driven` = the flat family: solveArc crosses the tape at netH+margin and
  // lands on target, hitting DOWN from high contact — apex is ignored except
  // as the mishit-arc fallback (a float/popup drive balloons via the arc path).
  drive:   { apex: 1.15, depthFrac: 0.80, spinX:  5.0, spinY: 0, margin: 0.18, vMax: 19, driven: true },
  drop:    { apex: 2.10, absZ: 'drop',    spinX: -3.0, spinY: 0, margin: 0.26, vMax: 9 },
  dink:    { apex: 1.35, absZ: 'dink',    spinX: -1.5, spinY: 0, margin: 0.14, vMax: 6.5 },
  lob:     { apex: 4.60, depthFrac: 0.86, spinX: -1.0, spinY: 0, margin: 0.35, vMax: 14 },
  speedup: { apex: 1.05, depthFrac: 0.55, spinX:  5.5, spinY: 0, margin: 0.12, vMax: 17, driven: true },
  serve:   { apex: 2.30, depthFrac: 0.75, spinX:  2.5, spinY: 0, margin: 0.30, vMax: 16 },
  smash:   { apex: 0.95, depthFrac: 0.70, spinX:  7.0, spinY: 0, margin: 0.05, vMax: 22, direct: true },
  // Super smash — the power-meter spend.
  //
  // DRIVEN, not direct, and that was a measured correction. The `direct` family
  // pins the launch straight down the p0->target line, which only works when
  // contact is genuinely ABOVE the target: measured net crossings from a 0.5-1.0m
  // contact were 0.27-0.57m, i.e. straight into a 0.86m net. Real contacts in
  // this game sit at a 0.49m median, so a direct super would have been a net
  // fault nearly every time.
  //
  // Driven crosses the tape at netH+margin and lands on target, so it clears
  // from any contact height. Launch speed then scales with how high the ball
  // was — ~11 m/s off the shoelaces, ~31 m/s off a genuine overhead. That is
  // physically honest AND good feel: a higher ball earns a faster super. The
  // super's identity is the blast and the knockback, not one fixed velocity.
  supersmash: { apex: 1.05, depthFrac: 0.70, spinX: 9.0, spinY: 0, margin: 0.14, vMax: 30, driven: true },
  // The forced return: what a blasted receiver produces while being knocked
  // back. Weak, high and short — a sitter for the attacking team, but NOT an
  // automatic put-away. Its hang time is tuned against SUPER.STUN's total so a
  // doubles partner has time to cover; in singles there is nobody to cover.
  blastpop:   { apex: 3.60, depthFrac: 0.30, spinX: -0.5, spinY: 0, margin: 0.55, vMax: 8 },
  // Popup — a forced weak return, not an AI-selectable intent (not in
  // `TYPES`). Represents a receiver jammed by a drive/drip at their feet
  // before reaching the kitchen: apex pinned at the stability system's own
  // mishit ceiling (STABILITY.MISHIT_APEX_MAX_V2), so it lands in the smash
  // zone regardless of the hitter's real contact quality — the same value
  // Shots.apexForQualityV2 already caps an organically-mishit drop/drive at.
  // Soft pace (vMax) and drop's kitchen-depth landing match a rushed reset
  // attempt, not a real shot. Scriptable in drills as `shotType: 'popup'`,
  // usually followed by a `smash`/`supersmash` beat.
  popup:   { apex: STABILITY.MISHIT_APEX_MAX_V2, absZ: 'drop', spinX: -1.0, spinY: 0, margin: 0.26, vMax: 7 },
  erne:    { apex: 0.95, depthFrac: 0.35, spinX:  4.0, spinY: 0, margin: 0.05, vMax: 18, direct: true },
  atp:     { apex: 0.60, depthFrac: 0.55, spinX:  0.0, spinY: 3.0, margin: 0, vMax: 15, allowNet: true },
  feed:    { apex: 2.55, depthFrac: 0.55, spinX:  1.0, spinY: 0, margin: 0.20, vMax: 12 }
};

// Landing distance from the net (meters) for a profile on this court.
function landingZV2(p, KITCHEN, HALF_L) {
  if (p.absZ === 'drop') return KITCHEN * 0.55;   // soft, dies in the kitchen
  if (p.absZ === 'dink') return KITCHEN + 0.25;   // just over the non-volley line
  return HALF_L * (p.depthFrac || 0.80);
}

/* specV2(type, KITCHEN, HALF_L) -> physical envelope for physics.solveArc:
 *   { apex, landZ, spin:{x,y,z}, margin, vMax, direct, allowNet }
 * KITCHEN/HALF_L default to regulation if omitted (tests). */
export function specV2(type, KITCHEN, HALF_L) {
  if (KITCHEN == null) KITCHEN = 7 * FT;
  if (HALF_L == null) HALF_L = 22 * FT;
  var p = PROFILES_V2[type] || PROFILES_V2.drive;
  return {
    apex: p.apex,
    landZ: landingZV2(p, KITCHEN, HALF_L),
    spin: { x: p.spinX || 0, y: p.spinY || 0, z: 0 },
    spinX: p.spinX || 0,
    spinY: p.spinY || 0,
    margin: p.margin,
    vMax: p.vMax,
    driven: !!p.driven,
    direct: !!p.direct,
    allowNet: !!p.allowNet
  };
}

/* Resolve intent + position + ball height -> {type, sp} where sp is the
 * physical envelope from specV2. */
export function resolveV2(absZ, ballY, intent, kitchen, halfL) {
  var zone = zoneOf(absZ, kitchen, halfL);
  var type = classify(zone, intent, ballY > 0.95);
  return { type: type, sp: specV2(type, kitchen, halfL) };
}

/* ============================================================================
 * Timing-quality model (v2), anchored to CONTACT GEOMETRY.
 *
 * timingOffsetFromContact(zOffFwd) grades where the ball sat relative to the
 * hitter's body at the strike. `zOffFwd` = (ball.z - hitter.z) normalized by the
 * hitter's facing so NEGATIVE = in front for both teams — the same measurement
 * practice mode's coaching grades (`Practice.scoreTiming`), against the same
 * ideal contact point (PRACTICE.TIMING_IDEAL_Z: ball slightly out front).
 * Returns offsetNorm ∈ [-1,1]: negative = early (ball still far out front —
 * you committed too soon), 0 = perfect, positive = late (ball at/behind the
 * body). Pure + testable; match play and practice agree by construction. */
export function timingOffsetFromContact(zOffFwd) {
  var d = (zOffFwd - PRACTICE.TIMING_IDEAL_Z) / TIMING_V2.Z_HALF_WIDTH;
  return Math.max(-1, Math.min(1, isFinite(d) ? d : 0));
}

/* applyTiming(offsetNorm, side, fwd) → modifiers applied to a shot before
 * solveArc:
 *   targetXSkew — meters of lateral skew: an EARLY hit (contact out front, the
 *                 paddle already rotated through) pulls the ball cross-body,
 *                 away from the paddle side; a LATE hit (ball into the body)
 *                 pushes it out toward the paddle side. Backhand mirrors.
 *   paceMul     — multiplies the shot's vMax (any mistiming costs pace)
 *   apexAdd     — extra apex meters past LOFT_EDGE (a shanked ball sits up)
 * `side` ('fh'|'bh') and `fwd` (+1 near / -1 far) orient the skew in world x so
 * the pull/push direction is correct for both wings and both teams. */
export function applyTiming(offsetNorm, side, fwd) {
  var o = Math.max(-1, Math.min(1, offsetNorm || 0));
  var T = TIMING_V2;
  // `wing` = world-x sign of the hitter's paddle side (fh = +x for the near
  // team; bh and the far team each mirror). Late (o>0) pushes toward the wing,
  // early (o<0) pulls away from it.
  var wing = (side === 'bh' ? -1 : 1) * (fwd >= 0 ? 1 : -1);
  var targetXSkew = o * T.SKEW_X * wing;
  var paceMul = 1 - T.PACE_LOSS * o * o;
  var edge = Math.max(0, Math.abs(o) - T.LOFT_EDGE) / Math.max(1e-6, 1 - T.LOFT_EDGE);
  var apexAdd = edge * T.LOFT_ADD;
  return { targetXSkew: targetXSkew, paceMul: paceMul, apexAdd: apexAdd };
}

// Depth AIMING: nudge a shot's landing distance from the net based on the held
// directional input at contact. depthAim is -move.z, so +1 = pressing forward
// (up on the pad, toward the net) -> land deeper toward the baseline; -1 =
// pressing back -> pull it shorter toward the kitchen line. Pure placement; the
// shot type (apex/spin) is unchanged. Clamped to stay legal (and solveArc still
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

/* Mishit loft: ADDITIVE and CAPPED. Design intent: a mishit drop/dink/drive
 * is a "slightly high" ball — a float hangs and bounces above the net
 * (speedup-attackable), a popup sits into the smash zone — but it is NOT a lob.
 * Lobs are deliberate shots only (explicit intent / situationalLob); the cap
 * keeps every accident well below PROFILES_V2.lob.apex. */
export function apexForQualityV2(baseApex, quality) {
  if (quality === 'popup') return Math.min(STABILITY.MISHIT_APEX_MAX_V2, baseApex + STABILITY.POPUP_APEX_ADD_V2);
  if (quality === 'float') return Math.min(STABILITY.MISHIT_APEX_MAX_V2, baseApex + STABILITY.FLOAT_APEX_ADD_V2);
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

/* Which side of the hitter's body the ball is on -> 'fh' | 'bh' (forehand /
 * backhand). Every player model is rigged with the paddle in the right hand
 * (see paddle_socket lookup in players.js), and each team faces the other
 * across the net (near faces -z, far faces +z — see game.js's per-frame
 * facing calc). Working through that facing, a near-team player's paddle
 * side is toward world +x and a far-team player's paddle side is toward
 * world -x; `fwd` (already +1 for near, -1 for far at every call site)
 * cancels that mirroring so a single sign check works for both teams: the
 * ball is on the backhand side whenever (ballX - hitterX) * fwd < 0.
 * A small deadzone avoids fh/bh flicker when the ball is nearly dead-center
 * on the hitter, defaulting to forehand on a tie. */
export function swingSide(hitterX, ballX, fwd) {
  var lateral = (ballX - hitterX) * fwd;
  return lateral < -0.08 ? 'bh' : 'fh';
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
