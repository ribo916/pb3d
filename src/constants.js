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
  POST_X: 10 * FT + 0.30,
  SERVE_LINE_TOL: 0.1     // server may be this far in front of the baseline and still serve
};

// Physics — honest simulated flight. The ball ALWAYS integrates under gravity +
// quadratic drag + Magnus; hits run a numeric solver (solveArc). Constants are
// near-real for a pickleball (24.5 g, 74 mm) with pace trimmed for playability
// via PACE.
//   Quadratic drag a = -DRAG_K·|v|·v  → terminal velocity √(GRAVITY/DRAG_K).
//   With DRAG_K = 0.042 that is ≈ 15.3 m/s, matching a real pickleball.
export const PHYS_V2 = {
  GRAVITY: 9.81,        // m/s^2 downward (real)
  DRAG_K: 0.042,        // quadratic drag coefficient (1/m); terminal vel ≈ √(g/k) ≈ 15.3 m/s
  MAGNUS_K: 0.010,      // a = MAGNUS_K·(spin × v); spin stays in existing game units
  RESTITUTION: 0.62,    // vertical bounce energy retained (real ball ≈ 0.64; start deader)
  BITE: 0.42,           // fraction of tangential surface slip removed at bounce
  SPIN_COUPLE: 0.11,    // spin units → surface speed (m/s) at contact ("effective radius")
  SIDE_KICK: 0.05,      // lateral bounce kick per unit spin.y
  SPIN_DECAY: 0.8,      // in-flight spin magnitude decay per second
  SPIN_BOUNCE_KEEP: 0.6,// spin magnitude retained through a bounce
  ROLL_BLEND: 0.35,     // post-bounce blend of spin.x toward rolling with new vz
  SOLVER_DT: 1 / 120,   // integration step for solveArc / simulateFlight
  PACE: 1.0             // global speed trim knob (playability tune; 1.0 = full physical)
};

// Timing-quality model. Timing is anchored to CONTACT GEOMETRY:
// where the ball sits relative to the hitter's body at the strike, measured as a
// facing-normalized z-offset (negative = in front), graded against the same ideal
// contact point practice mode coaches (PRACTICE.TIMING_IDEAL_Z — ball slightly out
// front). Ball far in front = swung early → pulled cross-body; ball at/behind the
// body = swung late → pushed to the paddle side; both lose pace and edge hits
// loft. Perceivable (you see the ball vs the body), consistent with the Stability
// Index (same geometry, same direction), and it makes match play agree with
// practice's early/late coaching by construction. CPU players sample a gaussian
// offset instead (LEVELS.timing) and take only the pace/loft effects — lateral
// scatter stays owned by LEVELS.err.
export const TIMING_V2 = {
  Z_HALF_WIDTH: 0.6, // meters of contact-z deviation from ideal that saturates the effect
  SKEW_X: 1.1,       // meters of lateral skew at full offset (early = cross-body pull, late = paddle-side push)
  PACE_LOSS: 0.25,   // paceMul = 1 - PACE_LOSS·offsetNorm^2
  LOFT_EDGE: 0.55,   // |offsetNorm| beyond which edge loft begins — only genuinely shanked timing
  LOFT_ADD: 0.35,    // apex meters added at the window edge: a "slightly high" ball, never a lob
  HOLD_Z: 0.45       // human strike deferral: with the window open, wait until the ball is
                     // within this many meters in front of the body before striking (an early
                     // press connects near ideal geometry instead of at the reach-ring edge)
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

// Instant replay (DVR review of the last ~10s of live play).
export const REPLAY = {
  WINDOW_SEC: 10,            // rolling buffer length captured during live play
  SPEEDS: [0.25, 0.5, 1, 2],
  DEFAULT_SPEED: 1,
  // Free-orbit camera: spherical offset around the sampled ball position.
  ORBIT: {
    RADIUS: 9.0, MIN_RADIUS: 3.5, MAX_RADIUS: 22.0,
    ELEVATION: 0.55,                       // radians above the horizon (start pose)
    MIN_ELEVATION: 0.12, MAX_ELEVATION: 1.45,
    AZIMUTH: 0,                            // radians around Y (start pose, 0 = behind near baseline)
    TARGET_Y: 1.0,
    DRAG_SENS: 0.006,                     // radians per pixel dragged
    ZOOM_SENS: 0.012                      // radius units per wheel delta
  }
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

// Player movement tuning. Top speeds remain sourced from HIT/AI difficulty;
// these values shape how players accelerate, brake, recover, and visually plant.
export const MOVEMENT = {
  HUMAN_ACCEL: 28.0,
  HUMAN_DECEL: 34.0,
  CPU_ACCEL: 18.0,
  CPU_DECEL: 24.0,
  CPU_ARRIVE: 0.55,
  CPU_STOP: 0.08,
  DEADZONE: 0.05,
  PLANT_SPEED: 2.8,
  PLANT_TURN_DOT: 0.15,
  LUNGE_DIST: 1.15,
  SPLIT_STEP_TIME: 0.20,
  RECOVER_SHADE_X: 0.45
};

// Stability Index tuning — controls hit quality based on player position + velocity at contact.
// Sweet-spot radius (m) scales with DUPR: low DUPR = tight zone, Pro = generous buffer.
export const STABILITY = {
  SWEET_SPOT: { family: 1.2, easy: 0.7, normal: 1.0, hard: 1.4 },
  VEL_WEIGHT: 0.45,      // fraction of max speed that zeroes out stability
  FLOAT_THRESHOLD: 0.45, // stability below this → float arc (hangs above the net)
  POPUP_THRESHOLD: 0.18, // stability below this → pop-up arc (sits into smash zone)
  // Mishit loft is ADDITIVE and CAPPED (design intent: a mishit is a "slightly
  // high" attackable ball — it hangs or sits into the smash zone — never a lob;
  // lobs are deliberate shots only).
  FLOAT_APEX_ADD_V2: 0.55, // float: hangs, bounces above the net, speedup-attackable
  POPUP_APEX_ADD_V2: 1.3,  // popup: descends through smash height at the kitchen
  MISHIT_APEX_MAX_V2: 3.4  // hard cap, well below the deliberate lob apex (4.6)
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

// Singles-only tactical tuning. Keep shot profile values in shots.js; these
// numbers only control how singles players position and choose placement.
export const SINGLES = {
  READY_W_FRAC: 0.18,          // central ready shade before the ball is incoming
  RECOVER_Z: 5.35,             // recover a bit inside the baseline
  RETURN_READ_Z: 4.95,         // receiver reads serves less deep to cut down whiffs
  CHASE_X_BIAS: 0.42,          // start lateral pursuit before the ball fully commits
  INTERCEPT_CUSHION: 0.12,     // set up closer to the bounce/contact point
  OPEN_COURT_PASS_FRAC: 0.86,  // default passing width target
  WIDE_PUNISH_FRAC: 0.90,      // wider target when opponent is stretched off-court
  BODY_SHOT_CHANCE: 0.14,      // occasional variation; not the default
  THIRD_SHOT_DROP_SCALE: 0.62, // fewer routine drops than doubles
  RETURN_CROSSCOURT_FRAC: 0.84 // deep return target when hitting behind recovery
};

// Ball-machine practice tuning.
export const PRACTICE = {
  MACHINE_X: 0,
  MACHINE_Z_INSET: 0.18,
  RELEASE_Y: 1.18,
  RELEASE_Z_OFFSET: 0.5,
  FEED_INTERVAL: 1.35,
  READY_GAP: 1.0,
  FEED_APEX: 2.55,
  FEED_MARGIN: 0.2,
  PLAYER_START_Z: COURT.HALF_L - 0.28,
  OPENING_TARGET_Z: COURT.HALF_L * 0.84,
  TARGET_X_MAX: COURT.HALF_W * 0.82,
  TARGET_Z_MIN: COURT.KITCHEN + 0.9,
  TARGET_Z_MAX: COURT.HALF_L * 0.86,
  POSITION_PERFECT_MAX: 0.62,
  POSITION_GOOD_MAX: 1.08,
  TIMING_IDEAL_Z: -0.18,
  TIMING_PERFECT_MAX: 0.26,
  TIMING_CLEAN_MAX: 0.42,
  TIMING_GOOD_MAX: 0.62,
  STABILITY_PERFECT_MIN: 0.32,
  STABILITY_CLEAN_MIN: 0.08,
  STABILITY_GOOD_MIN: 0.0,
  RETURN_VISUALS_MAX: 4
};
