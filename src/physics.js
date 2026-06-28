/* ============================================================================
 * physics.js  —  Pure ball/court physics. No Three.js, no DOM.
 * Ported from the original Picklelife js/physics.js (ESM).
 * Coordinate system (meters): see constants.js.
 * ==========================================================================*/
'use strict';

import { FT, COURT, PHYS } from './constants.js';

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
    lastBounceSide: 0   // +1 near, -1 far, 0 none
  };
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
