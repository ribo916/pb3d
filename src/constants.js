/* ============================================================================
 * constants.js — Single source of truth for court geometry + all gameplay
 * tuning (physics, shots, AI, camera). Ported from the original Picklelife
 * 3D match (js/physics.js, js/shots.js, js/ai.js, js/game.js). Keep these
 * numbers IDENTICAL to preserve the tuned swing/ball feel.
 *
 * Coordinate system (meters):
 *   x : sideways across the court  (+x = right when standing on near baseline)
 *   y : up
 *   z : along the court length      (+z = near/human side, -z = far/AI side)
 *   net plane is z = 0
 * ==========================================================================*/
'use strict';

export const FT = 0.3048; // feet -> meters

// Regulation pickleball court (20ft x 44ft), expressed in half-extents.
export const COURT = {
  HALF_W: 10 * FT,        // sideline at x = ±3.048
  HALF_L: 22 * FT,        // baseline at z = ±6.706
  KITCHEN: 7 * FT,        // non-volley line at z = ±2.134
  NET_H_CENTER: 0.86,     // 34 in
  NET_H_POST: 0.914,      // 36 in
  LINE_W: 0.05,
  BALL_R: 0.037,          // ~74mm dia pickleball
  POST_X: 10 * FT + 0.30
};

// Arcade-tuned physics constants (slightly punchier than real life so rallies read well)
export const PHYS = {
  GRAVITY: 13.5,       // m/s^2 downward
  AIR_DRAG: 0.045,     // linear drag coefficient per second
  RESTITUTION: 0.66,   // vertical bounce energy retained
  FRICTION: 0.78,      // horizontal speed retained on bounce
  MAGNUS: 0.020,       // spin -> lateral/vertical curve factor
  SPIN_DECAY: 1.5      // spin magnitude decay per second
};

// Match rules
export const RULES = {
  POINT_TO: 11,
  WIN_BY: 2
};

// Camera (broadcast pose behind near baseline)
export const CAMERA = {
  FOV: 70,
  POS: { x: 0, y: 6.6, z: 11.4 },
  LOOK: { x: 0, y: 0.7, z: -0.5 },
  FOLLOW_POS_LERP: 2.2,
  FOLLOW_LOOK_LERP: 3.0,
  FOLLOW_X_SCALE: 0.18,
  FOLLOW_X_RANGE: 1.3,
  // Mode 1 — Follow: tight behind/above the human player
  FOLLOW: {
    Y: 2.8, Z_OFFSET: 3.2, LERP: 4.5,
    MOBILE_PULLBACK_START_Z: 4.3,
    MOBILE_PULLBACK_END_Z: 2.0,
    MOBILE_PULLBACK_Z: 1.0,
    MOBILE_PULLBACK_Y: 0.35
  },
  // Mode 2 — Top-Down: a near-overhead view carrying a small deliberate tilt.
  // A pure straight-down camera can't show the ball's arc, so lobs/drops read as
  // unexplained speed/size swings (perspective scales by camY/(camY-ballHeight)).
  // Offsetting POS.z ahead of LOOK.z gives a gentle ~9° tilt (atan(1.7/10.4)) so
  // height maps to vertical screen travel and the ball separates from its shadow.
  // Y stays BELOW the indoor truss beams (y=10.8, see scene.js) so the camera
  // never stares through a beam; the wide FOV keeps both baselines/servers framed.
  TOPDOWN: { POS: { x: 0, y: 10.4, z: 1.7 }, LOOK: { x: 0, y: 0.4, z: 0 }, FOV: 80 }
};

// Hit model timings
export const HIT = {
  SWING_WINDOW: 0.30,   // seconds the human timing window stays open
  REACH: 1.5,           // paddle reach radius (m)
  REACH_Y_MAX: 2.3,
  COOLDOWN_SERVE: 0.25,
  COOLDOWN_RALLY: 0.12,
  HUMAN_SPEED: 5.2
};

// Stability Index tuning — controls hit quality based on player position + velocity at contact.
// Sweet-spot radius (m) scales with DUPR: low DUPR = tight zone, Pro = generous buffer.
export const STABILITY = {
  SWEET_SPOT: { family: 1.2, easy: 0.7, normal: 1.0, hard: 1.4 },
  VEL_WEIGHT: 0.45,      // fraction of max speed that zeroes out stability
  FLOAT_THRESHOLD: 0.45, // stability below this → float arc (high P1, overshooting P2)
  POPUP_THRESHOLD: 0.18, // stability below this → pop-up arc (spiked P1)
  FLOAT_APEX_MULT: 1.65, // apex multiplier for float
  POPUP_APEX_MULT: 2.6   // apex multiplier for pop-up
};

// Power cap — incoming ball height limits how hard the hitter can return it.
export const POWER_CAP = {
  NET_H: 0.86,           // same as COURT.NET_H_CENTER; ball at/below this → forced soft
  BELOW_DEPTH_FRAC: 0.4, // max landing depth (fraction of HALF_L) for a below-net ball
  SMASH_H: 1.5           // ball at/above this height enables overhead smash intent
};

// Specialty shot triggers and poach windows.
export const SPECIALTY = {
  ATP_X_MARGIN: 0.35,        // player must be this far outside sideline for ATP
  ERNE_X_MARGIN: 0.25,       // player must be this far outside sideline for Erne
  ERNE_Z_MAX: 2.7,           // Erne only within this z-distance of the net (kitchen zone)
  POACH_NORMAL_X_HALF: 0.85, // ±x bounding box for DUPR 4.5 poach intercept
  POACH_PRO_REACH: 1.9       // physical reach sphere radius (m) for Pro poach check
};
