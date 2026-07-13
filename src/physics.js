/* ============================================================================
 * physics.js  —  Pure ball/court physics. No Three.js, no DOM.
 * Ported from the original Picklelife js/physics.js (ESM).
 * Coordinate system (meters): see constants.js.
 * ==========================================================================*/
'use strict';

import { FT, COURT, PHYS, PHYS_V2, STABILITY } from './constants.js';

export { FT, COURT };
export const GRAVITY = PHYS.GRAVITY;

const AIR_DRAG = PHYS.AIR_DRAG;
const RESTITUTION = PHYS.RESTITUTION;
const FRICTION = PHYS.FRICTION;
const MAGNUS = PHYS.MAGNUS;
const SPIN_DECAY = PHYS.SPIN_DECAY;

export function vec(x, y, z) { return { x: x || 0, y: y || 0, z: z || 0 }; }
export function clone(v) { return { x: v.x, y: v.y, z: v.z }; }
export function add(a, b) { return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }; }
export function sub(a, b) { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
export function scale(a, s) { return { x: a.x * s, y: a.y * s, z: a.z * s }; }
export function len(a) { return Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z); }
export function lenXZ(a) { return Math.sqrt(a.x * a.x + a.z * a.z); }
export function norm(a) { var l = len(a) || 1; return { x: a.x / l, y: a.y / l, z: a.z / l }; }

// Net height interpolated across the court width (lower in the middle).
export function netHeightAt(x) {
  var t = Math.min(1, Math.abs(x) / COURT.HALF_W);
  return COURT.NET_H_CENTER + (COURT.NET_H_POST - COURT.NET_H_CENTER) * t;
}

// Create a ball state.
export function makeBall() {
  return {
    pos: vec(0, 1, 6),
    vel: vec(0, 0, 0),
    spin: vec(0, 0, 0), // angular-ish; only magnitude/dir matters for curve
    live: false,
    lastBounceSide: 0,  // +1 near, -1 far, 0 none
    spline: null,       // v1: {P0,P1,P2,duration,elapsed} while in spline-driven flight
    flight: null        // v2: {landing,T,apexY,samples,elapsed} cached solver result
  };
}

/* ============================================================
 * Spline (Quadratic Bezier) helpers — used by the spline-driven
 * trajectory system. Pure math; no THREE dependency.
 * ============================================================*/

/* Evaluate a quadratic Bezier at parameter t ∈ [0,1].
 * B(t) = (1-t)^2·P0 + 2(1-t)t·P1 + t^2·P2 */
export function bezierPoint(P0, P1, P2, t) {
  var s = 1 - t;
  return {
    x: s * s * P0.x + 2 * s * t * P1.x + t * t * P2.x,
    y: s * s * P0.y + 2 * s * t * P1.y + t * t * P2.y,
    z: s * s * P0.z + 2 * s * t * P1.z + t * t * P2.z
  };
}

/* First derivative of the Bezier (tangent direction × 2).
 * Divide by flightTime T to get velocity in m/s. */
export function bezierVel(P0, P1, P2, t, T) {
  var s = 1 - t;
  var scale = T > 0 ? 2 / T : 0;
  return {
    x: (s * (P1.x - P0.x) + t * (P2.x - P1.x)) * scale,
    y: (s * (P1.y - P0.y) + t * (P2.y - P1.y)) * scale,
    z: (s * (P1.z - P0.z) + t * (P2.z - P1.z)) * scale
  };
}

/* Estimate total flight time for a spline shot.
 * Reuses the same up+down time formula as solveShot so timing is consistent. */
export function splineFlightTime(P0, P2, apexY) {
  apexY = Math.max(apexY, P0.y + 0.4);
  var g = GRAVITY;
  var vy = Math.sqrt(2 * g * (apexY - P0.y));
  var tUp = vy / g;
  var tDown = Math.sqrt(2 * Math.max(0.01, apexY - COURT.BALL_R) / g);
  return tUp + tDown;
}

/* Compute the Bezier apex control point P1.
 * P1.z = 0 (net plane midpoint in z), ensuring the curve crosses the net.
 * P1.x = lerp(P0.x, P2.x, 0.5) so the arc stays lateral-central.
 * P1.y = max(netHeightAt(P1.x) + margin, apexY).
 * margin defaults to 0.12 if null/undefined. */
export function computeP1(P0, P2, apexY, margin) {
  margin = (margin == null) ? 0.12 : margin;
  var mx = (P0.x + P2.x) * 0.5;
  var my = Math.max(netHeightAt(mx) + margin, apexY);
  return { x: mx, y: my, z: 0 };
}

/* Integrate the ball one timestep. Returns a list of discrete events
 * that occurred during the step so the rules engine can react:
 *   {type:'bounce', side, x, z, inBounds}
 *   {type:'net'}            ball struck the net cord/tape
 *   {type:'floor-out', x, z} bounce outside the court
 * dt should be small (we sub-step in the game loop).
 */
export function step(ball, dt) {
  var events = [];
  if (!ball.live) return events;

  // Magnus curve from spin (cross product of spin and velocity, simplified)
  var s = ball.spin, v = ball.vel;
  var magnus = {
    x: MAGNUS * (s.y * v.z - s.z * v.y),
    y: MAGNUS * (s.z * v.x - s.x * v.z),
    z: MAGNUS * (s.x * v.y - s.y * v.x)
  };

  // Acceleration: gravity + drag + magnus
  ball.vel.x += (magnus.x - AIR_DRAG * ball.vel.x) * dt;
  ball.vel.y += (-GRAVITY + magnus.y - AIR_DRAG * ball.vel.y) * dt;
  ball.vel.z += (magnus.z - AIR_DRAG * ball.vel.z) * dt;

  var prev = clone(ball.pos);
  ball.pos.x += ball.vel.x * dt;
  ball.pos.y += ball.vel.y * dt;
  ball.pos.z += ball.vel.z * dt;

  // Spin decays
  ball.spin = scale(ball.spin, Math.max(0, 1 - SPIN_DECAY * dt));

  // --- Net collision: crossing z=0 while below net height ---
  if ((prev.z > 0 && ball.pos.z <= 0) || (prev.z < 0 && ball.pos.z >= 0)) {
    // interpolate crossing point
    var t = prev.z / (prev.z - ball.pos.z);
    var cx = prev.x + (ball.pos.x - prev.x) * t;
    var cy = prev.y + (ball.pos.y - prev.y) * t;
    var nh = netHeightAt(cx);
    if (cy <= nh && Math.abs(cx) <= COURT.POST_X) {
      // hit the net: kill forward momentum, drop near the net
      ball.pos.x = cx;
      ball.pos.z = (prev.z > 0 ? 0.02 : -0.02);
      ball.pos.y = cy;
      ball.vel.z *= -0.12;
      ball.vel.x *= 0.3;
      ball.vel.y *= 0.2;
      ball.spin = vec(0, 0, 0);
      events.push({ type: 'net' });
    }
  }

  // --- Floor collision ---
  var floor = COURT.BALL_R;
  if (ball.pos.y <= floor && ball.vel.y < 0) {
    ball.pos.y = floor;
    var side = ball.pos.z >= 0 ? 1 : -1;
    var inBounds = Math.abs(ball.pos.x) <= COURT.HALF_W + COURT.BALL_R &&
                   Math.abs(ball.pos.z) <= COURT.HALF_L + COURT.BALL_R;
    // bounce
    ball.vel.y = -ball.vel.y * RESTITUTION;
    ball.vel.x *= FRICTION;
    ball.vel.z *= FRICTION;
    // topspin/backspin nudges forward speed a touch
    ball.vel.z += ball.spin.x * 0.03;
    ball.lastBounceSide = side;
    events.push({
      type: inBounds ? 'bounce' : 'floor-out',
      side: side, x: ball.pos.x, z: ball.pos.z, inBounds: inBounds
    });
  }

  return events;
}

/* Solve the launch velocity needed to send the ball from p0 to a target (tx,tz)
 * landing at a chosen apex height. Returns a velocity vec. Pure ballistics
 * (ignores drag/magnus, good enough as an aiming seed; AI/serve add variance).
 */
export function solveShot(p0, target, apex) {
  apex = Math.max(apex, p0.y + 0.4);
  var g = GRAVITY;
  // time to apex from launch: vy = sqrt(2 g (apex - y0))
  var vy = Math.sqrt(2 * g * (apex - p0.y));
  // total flight time: up to apex then down to target height (~ball radius)
  var tUp = vy / g;
  var tDown = Math.sqrt(2 * Math.max(0.01, apex - COURT.BALL_R) / g);
  var T = tUp + tDown;
  var vx = (target.x - p0.x) / T;
  var vz = (target.z - p0.z) / T;
  return vec(vx, vy, vz);
}

/* Will a ball launched from p0 with velocity v (and optional spin) clear the
 * net when it crosses z=0? Unlike a pure ballistic check, this integrates the
 * SAME forces as step() — gravity, air drag and Magnus — because drag makes
 * slow shots fall short and topspin makes drives dip, both of which cause the
 * ball to cross the net LOWER than a drag-free parabola predicts. That gap was
 * the main source of "balls into the net". */
export function clearsNet(p0, v, margin, spin) {
  margin = margin == null ? 0.12 : margin;
  if (v.z === 0) return true;
  if (-p0.z / v.z <= 0.001) return true;           // not heading toward the net
  var p = { x: p0.x, y: p0.y, z: p0.z };
  var vel = { x: v.x, y: v.y, z: v.z };
  var s = spin ? { x: spin.x, y: spin.y, z: spin.z } : { x: 0, y: 0, z: 0 };
  var dt = 1 / 120;
  for (var n = 0; n < 360; n++) {
    var mx = MAGNUS * (s.y * vel.z - s.z * vel.y);
    var my = MAGNUS * (s.z * vel.x - s.x * vel.z);
    var mz = MAGNUS * (s.x * vel.y - s.y * vel.x);
    vel.x += (mx - AIR_DRAG * vel.x) * dt;
    vel.y += (-GRAVITY + my - AIR_DRAG * vel.y) * dt;
    vel.z += (mz - AIR_DRAG * vel.z) * dt;
    var pz = p.z, px = p.x, py = p.y;
    p.x += vel.x * dt; p.y += vel.y * dt; p.z += vel.z * dt;
    var decay = Math.max(0, 1 - SPIN_DECAY * dt);
    s.x *= decay; s.y *= decay; s.z *= decay;
    if ((pz > 0 && p.z <= 0) || (pz < 0 && p.z >= 0)) {     // crossed the net plane
      var f = pz / (pz - p.z);
      var cx = px + (p.x - px) * f, cy = py + (p.y - py) * f;
      if (Math.abs(cx) > COURT.POST_X) return true;          // passes outside a post
      return cy >= netHeightAt(cx) + margin;
    }
    if (p.y <= COURT.BALL_R && vel.y < 0) return false;      // hit the ground before the net
  }
  return true;
}

/* Net-aware launcher: aims at target with the given apex, but raises the arc
 * until the (drag + Magnus aware) trajectory clears the net, so shots don't
 * clip the tape. Pass the intended `spin` so topspin/backspin is accounted
 * for. Returns a velocity vec. */
export function launch(p0, target, apex, margin, spin) {
  var v = solveShot(p0, target, apex);
  for (var a = apex; a <= apex + 3.01; a += 0.25) {
    v = solveShot(p0, target, a);
    if (clearsNet(p0, v, margin, spin)) return v;
  }
  return v;
}

/* ============================================================================
 * MECHANICS V2 — honest simulated flight + numeric shot solver.
 *
 * The ball ALWAYS integrates under gravity + quadratic drag + Magnus (stepV2).
 * A hit runs solveArc(), a shooting-method solver that searches for a launch
 * velocity carrying the ball from the contact point to the aimed target while
 * clearing the net. Spin genuinely curves/dips flight and shapes the bounce.
 *
 * All tuning lives in constants.js PHYS_V2. These functions are pure (no THREE,
 * no DOM) so they stay node-testable alongside the v1 physics.
 * ==========================================================================*/

var V2 = PHYS_V2;

/* Acceleration under gravity + quadratic drag + Magnus. Single source of truth
 * shared by stepV2 / simulateFlight / solveArc so live and predicted flight agree.
 *   drag:   a = -DRAG_K · |v| · v          (proportional to v², like real air)
 *   magnus: a =  MAGNUS_K · (spin × v)     (curves/dips from spin) */
export function accelV2(vel, spin) {
  var sp = Math.sqrt(vel.x * vel.x + vel.y * vel.y + vel.z * vel.z);
  var k = V2.DRAG_K * sp;
  var m = V2.MAGNUS_K;
  return {
    x: -k * vel.x + m * (spin.y * vel.z - spin.z * vel.y),
    y: -V2.GRAVITY - k * vel.y + m * (spin.z * vel.x - spin.x * vel.z),
    z: -k * vel.z + m * (spin.x * vel.y - spin.y * vel.x)
  };
}

/* Spin-aware bounce. Mutates vel/spin in place given the pre-bounce values.
 * topspin (spin.x with sign toward travel) skids low & fast; backspin checks
 * up and can reverse; sidespin (spin.y) kicks laterally. */
function bounceV2(vel, spin) {
  vel.y = -vel.y * V2.RESTITUTION;
  // surface slip = ground-relative contact velocity (spin adds a surface speed)
  var slipX = vel.x + V2.SPIN_COUPLE * spin.z;
  var slipZ = vel.z - V2.SPIN_COUPLE * spin.x;
  vel.x = vel.x - V2.BITE * slipX + V2.SIDE_KICK * spin.y * Math.abs(vel.z);
  vel.z = vel.z - V2.BITE * slipZ;
  spin.x *= V2.SPIN_BOUNCE_KEEP;
  spin.y *= V2.SPIN_BOUNCE_KEEP;
  spin.z *= V2.SPIN_BOUNCE_KEEP;
  // pick up rolling spin consistent with the new forward speed
  spin.x += (vel.z / V2.SPIN_COUPLE - spin.x) * V2.ROLL_BLEND;
}

/* Integrate the ball one timestep with real physics. Returns the same discrete
 * event list as step() so rules.js / game._handleBallEvent are unchanged:
 *   {type:'bounce', side, x, z, inBounds} | {type:'net'} | {type:'floor-out',...} */
export function stepV2(ball, dt) {
  var events = [];
  if (!ball.live) return events;

  var a = accelV2(ball.vel, ball.spin);
  ball.vel.x += a.x * dt;
  ball.vel.y += a.y * dt;
  ball.vel.z += a.z * dt;

  var prev = clone(ball.pos);
  ball.pos.x += ball.vel.x * dt;
  ball.pos.y += ball.vel.y * dt;
  ball.pos.z += ball.vel.z * dt;

  ball.spin = scale(ball.spin, Math.max(0, 1 - V2.SPIN_DECAY * dt));

  // --- Net collision: crossing z=0 while below net height ---
  if ((prev.z > 0 && ball.pos.z <= 0) || (prev.z < 0 && ball.pos.z >= 0)) {
    var t = prev.z / (prev.z - ball.pos.z);
    var cx = prev.x + (ball.pos.x - prev.x) * t;
    var cy = prev.y + (ball.pos.y - prev.y) * t;
    var nh = netHeightAt(cx);
    if (cy <= nh && Math.abs(cx) <= COURT.POST_X) {
      ball.pos.x = cx;
      ball.pos.z = (prev.z > 0 ? 0.02 : -0.02);
      ball.pos.y = cy;
      ball.vel.z *= -0.12;
      ball.vel.x *= 0.3;
      ball.vel.y *= 0.2;
      ball.spin = vec(0, 0, 0);
      events.push({ type: 'net' });
    }
  }

  // --- Floor collision (spin-aware bounce) ---
  var floor = COURT.BALL_R;
  if (ball.pos.y <= floor && ball.vel.y < 0) {
    ball.pos.y = floor;
    var side = ball.pos.z >= 0 ? 1 : -1;
    var inBounds = Math.abs(ball.pos.x) <= COURT.HALF_W + COURT.BALL_R &&
                   Math.abs(ball.pos.z) <= COURT.HALF_L + COURT.BALL_R;
    bounceV2(ball.vel, ball.spin);
    ball.lastBounceSide = side;
    events.push({
      type: inBounds ? 'bounce' : 'floor-out',
      side: side, x: ball.pos.x, z: ball.pos.z, inBounds: inBounds
    });
  }

  return events;
}

/* Forward-simulate one flight from p0 with launch velocity v0 and spin, WITHOUT
 * mutating any ball. Stops at the first floor contact (or net block, or timeout).
 * Returns landing point, flight time, apex height, the net-crossing height, a
 * clearedNet flag, and up to 16 downsampled trajectory points (for AI predict /
 * poach reach checks).
 *   opts.maxT (default 4s), opts.dt (default SOLVER_DT), opts.samples (default 16) */
export function simulateFlight(p0, v0, spin, opts) {
  opts = opts || {};
  var dt = opts.dt || V2.SOLVER_DT;
  var maxT = opts.maxT || 4.0;
  var nSamples = opts.samples || 16;
  var p = { x: p0.x, y: p0.y, z: p0.z };
  var vel = { x: v0.x, y: v0.y, z: v0.z };
  var s = spin ? { x: spin.x, y: spin.y, z: spin.z } : { x: 0, y: 0, z: 0 };
  var apexY = p.y;
  var netCrossY = null, clearedNet = null;
  var raw = [{ x: p.x, y: p.y, z: p.z }];
  var T = 0;
  var steps = Math.ceil(maxT / dt);
  for (var n = 0; n < steps; n++) {
    var a = accelV2(vel, s);
    vel.x += a.x * dt; vel.y += a.y * dt; vel.z += a.z * dt;
    var prevx = p.x, prevy = p.y, prevz = p.z;
    p.x += vel.x * dt; p.y += vel.y * dt; p.z += vel.z * dt;
    var decay = Math.max(0, 1 - V2.SPIN_DECAY * dt);
    s.x *= decay; s.y *= decay; s.z *= decay;
    T += dt;
    if (p.y > apexY) apexY = p.y;
    // net-plane crossing bookkeeping
    if (netCrossY === null && ((prevz > 0 && p.z <= 0) || (prevz < 0 && p.z >= 0))) {
      var f = prevz / (prevz - p.z);
      var ncx = prevx + (p.x - prevx) * f;
      netCrossY = prevy + (p.y - prevy) * f;
      clearedNet = (Math.abs(ncx) > COURT.POST_X) || (netCrossY >= netHeightAt(ncx));
    }
    raw.push({ x: p.x, y: p.y, z: p.z });
    if (p.y <= COURT.BALL_R && vel.y < 0) {
      p.y = COURT.BALL_R;
      break;
    }
  }
  // downsample trajectory to nSamples points
  var samples = [];
  var stride = Math.max(1, Math.floor(raw.length / nSamples));
  for (var i = 0; i < raw.length; i += stride) samples.push(raw[i]);
  if (samples[samples.length - 1] !== raw[raw.length - 1]) samples.push(raw[raw.length - 1]);
  return {
    landing: { x: p.x, z: p.z },
    T: T, apexY: apexY,
    netCrossY: netCrossY, clearedNet: clearedNet === null ? true : clearedNet,
    samples: samples
  };
}

/* Drag-free ballistic seed: launch velocity to reach `target` at height apex.
 * Same formula as solveShot but with PHYS_V2 gravity. The floor above contact
 * is small (0.15) — arc shots rise a touch, but they must not be forced into
 * balloons off a high contact; power shots use `driven` mode and skip this
 * entirely. */
function seedV2(p0, target, apex) {
  apex = Math.max(apex, p0.y + 0.15);
  var g = V2.GRAVITY;
  var vy = Math.sqrt(2 * g * (apex - p0.y));
  var tUp = vy / g;
  var tDown = Math.sqrt(2 * Math.max(0.01, apex - COURT.BALL_R) / g);
  var T = tUp + tDown;
  return { x: (target.x - p0.x) / T, y: vy, z: (target.z - p0.z) / T, T: T };
}

/* THE v2 shot solver. Finds a launch velocity that carries the ball from p0 to
 * the aimed target under real physics, clearing the net.
 *   spec = { apex, margin, spin:{x,y,z}, vMax, driven?, direct?, allowNet? }
 * Returns { v0, T, apexY, landing, samples, ok }.
 *
 * Three trajectory families:
 *   ARC (default — drop/dink/lob/serve/feed): ballistic seed at spec.apex,
 *     secant on launch speed against range; if the arc clips the net, raise
 *     apex 0.25 m and retry (unless allowNet).
 *   DRIVEN (drive/speedup): flat family. Solve launch vy (may be NEGATIVE —
 *     hit downward from a high contact) + horizontal speed so the ball crosses
 *     the net just above the tape (netHeight + margin) and lands at the target.
 *     If the vMax speed cap can't carry the depth at tape height, the crossing
 *     target rises 0.3 m at a time — loft is the physics-forced fallback, never
 *     the default.
 *   DIRECT (smash/Erne, contact above target): fixes the launch direction along
 *     the depressed line p0→target and only searches speed.
 * All modes end with a lateral pass canceling Magnus x-drift, and all speeds
 * clamp to vMax·PACE. */
export function solveArc(p0, target, spec) {
  spec = spec || {};
  var spin = spec.spin || { x: 0, y: 0, z: 0 };
  var margin = spec.margin == null ? 0.12 : spec.margin;
  var vMax = (spec.vMax || 30) * V2.PACE;
  var apex = Math.max(spec.apex || (p0.y + 0.5), 0.1);
  var allowNet = !!spec.allowNet;

  // ground direction and distance from contact to target
  var gdx = target.x - p0.x, gdz = target.z - p0.z;
  var gdist = Math.sqrt(gdx * gdx + gdz * gdz) || 1e-4;
  var ux = gdx / gdist, uz = gdz / gdist; // unit ground direction toward target

  var best = null;

  function tryArc(aim, apx) {
    return simulateFlight(p0, aim, spin, { dt: V2.SOLVER_DT });
  }

  // Build an initial launch velocity from a ballistic seed at the given apex.
  function makeAim(apx) {
    if (spec.direct) {
      // aim straight along the p0->target line; speed from a rough time estimate
      var dx = target.x - p0.x, dy = COURT.BALL_R - p0.y, dz = target.z - p0.z;
      var dl = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-4;
      var guess = Math.min(vMax, 18);
      return { x: dx / dl * guess, y: dy / dl * guess, z: dz / dl * guess };
    }
    var seed = seedV2(p0, target, apx);
    return { x: seed.x, y: seed.y, z: seed.z };
  }

  // Secant search on a scalar speed multiplier along the ground direction so the
  // ball lands at the right along-track distance. vy is held from the seed (apex).
  function solveSpeed(apx) {
    var aim = makeAim(apx);
    var vy = aim.y;
    // horizontal speed guesses
    var h0 = Math.sqrt(aim.x * aim.x + aim.z * aim.z) || 1;
    function rangeErr(h) {
      var a = spec.direct
        ? scaleDir(h)
        : { x: ux * h, y: vy, z: uz * h };
      var r = tryArc(a, apx);
      // signed along-track landing distance from p0
      var lx = r.landing.x - p0.x, lz = r.landing.z - p0.z;
      var along = lx * ux + lz * uz;
      return { err: along - gdist, res: r, aim: a };
    }
    function scaleDir(h) {
      // direct mode: full 3D direction scaled to speed h (h ~ total speed)
      var dx = target.x - p0.x, dy = COURT.BALL_R - p0.y, dz = target.z - p0.z;
      var dl = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-4;
      return { x: dx / dl * h, y: dy / dl * h, z: dz / dl * h };
    }
    var hA = h0, rA = rangeErr(hA);
    var hB = h0 * 1.35 + 1, rB = rangeErr(hB);
    var last = rB;
    for (var it = 0; it < 6; it++) {
      var denom = (rB.err - rA.err);
      var hC = Math.abs(denom) < 1e-6 ? hB : hB - rB.err * (hB - hA) / denom;
      hC = Math.max(0.2, Math.min(vMax, hC));
      var rC = rangeErr(hC);
      last = rC;
      if (Math.abs(rC.err) < 0.08) break;
      hA = hB; rA = rB; hB = hC; rB = rC;
    }
    return last;
  }

  /* DRIVEN mode — the flat trajectory family (drives, speedups). Instead of
   * arcing over an apex, solve launch vy (may be NEGATIVE: hit down from a
   * high contact) + horizontal speed so the ball crosses the net just above
   * the tape (netHeight + margin) and lands at the target. Loft is the
   * FALLBACK: only if the speed cap can't carry the depth at tape height does
   * the crossing target rise. */
  function rangeErrVy(h, vy) {
    var a = { x: ux * h, y: vy, z: uz * h };
    var r = tryArc(a);
    var lx = r.landing.x - p0.x, lz = r.landing.z - p0.z;
    return { err: lx * ux + lz * uz - gdist, res: r, aim: a };
  }

  // Inner secant: land at the aimed range with this vy (h capped at vMax).
  function solveRangeAtVy(vy) {
    var hA = Math.min(vMax, 13), rA = rangeErrVy(hA, vy);
    var hB = Math.min(vMax, hA * 1.35 + 1.5), rB = rangeErrVy(hB, vy);
    var last = (Math.abs(rA.err) < Math.abs(rB.err)) ? rA : rB;
    for (var it = 0; it < 5; it++) {
      var denom = rB.err - rA.err;
      var hC = Math.abs(denom) < 1e-6 ? hB : hB - rB.err * (hB - hA) / denom;
      hC = Math.max(0.2, Math.min(vMax, hC));
      var rC = rangeErrVy(hC, vy);
      if (Math.abs(rC.err) < Math.abs(last.err)) last = rC;
      if (Math.abs(rC.err) < 0.08) break;
      hA = hB; rA = rB; hB = hC; rB = rC;
    }
    return last;
  }

  function solveDriven() {
    // Ground leg from contact to the net plane along the aim direction.
    var sNet = Math.abs(uz) > 1e-4 ? Math.abs(p0.z / uz) : gdist * 0.5;
    var xNet = p0.x + ux * sNet;
    var baseClearY = netHeightAt(xNet) + margin;
    var bestD = null;
    for (var lift = 0; lift < 8; lift++) {
      var clearY = baseClearY + lift * 0.3; // loft fallback: raise crossing 0.3m at a time
      // vy seed: reach clearY at the net leg including the gravity drop en route.
      var hEst = Math.min(vMax, 14);
      var tNet = sNet / hEst;
      var vyA = ((clearY - p0.y) + 0.5 * V2.GRAVITY * tNet * tNet) / Math.max(0.05, tNet);
      var solA = solveRangeAtVy(vyA);
      var eA = (solA.res.netCrossY == null) ? -1.0 : (solA.res.netCrossY - clearY);
      var vyB = vyA + 1.2;
      var solB = solveRangeAtVy(vyB);
      var eB = (solB.res.netCrossY == null) ? -1.0 : (solB.res.netCrossY - clearY);
      var cur = Math.abs(eA) < Math.abs(eB) ? solA : solB;
      var curE = Math.abs(eA) < Math.abs(eB) ? eA : eB;
      for (var it2 = 0; it2 < 4; it2++) {
        var den = eB - eA;
        var vyC = Math.abs(den) < 1e-6 ? vyB : vyB - eB * (vyB - vyA) / den;
        vyC = Math.max(-12, Math.min(14, vyC));
        var solC = solveRangeAtVy(vyC);
        var eC = (solC.res.netCrossY == null) ? -1.0 : (solC.res.netCrossY - clearY);
        if (Math.abs(eC) < Math.abs(curE)) { cur = solC; curE = eC; }
        if (Math.abs(eC) < 0.03) break;
        vyA = vyB; eA = eB; vyB = vyC; eB = eC;
      }
      bestD = cur;
      // Accept when it clears the tape and reaches the aimed depth; otherwise
      // the speed cap is binding — raise the crossing (loft) and try again.
      var clearsOK = cur.res.netCrossY != null &&
                     cur.res.netCrossY >= netHeightAt(xNet) + Math.max(0, margin - 0.05);
      if (clearsOK && Math.abs(cur.err) < 0.35) break;
    }
    return bestD;
  }

  if (spec.driven && !spec.direct && !allowNet) {
    best = solveDriven();
    // Lateral Magnus pass (same idea as the arc branch).
    var dDrift = best.res.landing.x - target.x;
    if (Math.abs(dDrift) > 0.12) {
      var dTarget = { x: target.x - dDrift, z: target.z };
      var dgx = dTarget.x - p0.x, dgz = dTarget.z - p0.z;
      var dgd = Math.sqrt(dgx * dgx + dgz * dgz) || 1e-4;
      ux = dgx / dgd; uz = dgz / dgd; gdist = dgd;
      var bestD2 = solveDriven();
      if (dist2(bestD2.res.landing, target) < dist2(best.res.landing, target)) best = bestD2;
    }
    var rr = best.res;
    return {
      v0: best.aim,
      T: rr.T, apexY: rr.apexY, landing: rr.landing, samples: rr.samples,
      ok: Math.sqrt(dist2(rr.landing, target)) < 0.6 && rr.clearedNet
    };
  }

  var apx = apex;
  var raised = 0;
  while (true) {
    var sol = solveSpeed(apx);
    best = sol;
    if (allowNet || sol.res.clearedNet || raised >= 12) break;
    apx += 0.25;
    raised++;
  }

  // Lateral pass: cancel Magnus-induced x drift by shifting the aim target.
  if (!spec.direct) {
    var driftX = best.res.landing.x - target.x;
    if (Math.abs(driftX) > 0.12) {
      var target2 = { x: target.x - driftX, z: target.z };
      var gdx2 = target2.x - p0.x, gdz2 = target2.z - p0.z;
      var gd2 = Math.sqrt(gdx2 * gdx2 + gdz2 * gdz2) || 1e-4;
      ux = gdx2 / gd2; uz = gdz2 / gd2; gdist = gd2;
      var sol2 = solveSpeed(apx);
      // keep whichever landed closer to the true target
      if (dist2(sol2.res.landing, target) < dist2(best.res.landing, target)) best = sol2;
    }
  }

  var r = best.res;
  var landErr = Math.sqrt(dist2(r.landing, target));
  return {
    v0: best.aim,
    T: r.T, apexY: r.apexY, landing: r.landing, samples: r.samples,
    ok: landErr < 0.6 && (allowNet || r.clearedNet)
  };
}

function dist2(a, b) {
  var dx = a.x - b.x, dz = a.z - b.z;
  return dx * dx + dz * dz;
}
