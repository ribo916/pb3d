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
  FOLLOW: { Y: 2.8, Z_OFFSET: 3.2, LERP: 4.5 },
  // Mode 2 — Sideline: low TV angle from the right side of the court
  SIDELINE: { POS: { x: 5.8, y: 2.4, z: 3.0 }, LOOK: { x: 0, y: 0.9, z: 0 } },
  // Mode 3 — Top-Down: aerial overview
  TOPDOWN: { POS: { x: 0, y: 16, z: 3.0 }, LOOK: { x: 0, y: 0, z: 0 } }
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
