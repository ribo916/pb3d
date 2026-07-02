/* ============================================================================
 * movement.js — Pure player locomotion helpers.
 *
 * Gameplay still owns hit timing/reach. These helpers only shape how the player
 * position/velocity moves toward human input or CPU tactical targets, and derive
 * visual locomotion hints for the renderer.
 * ==========================================================================*/
'use strict';

import { clamp } from './utils.js';

function len2(x, z) {
  return Math.sqrt(x * x + z * z);
}

function approachVec(vx, vz, tx, tz, maxDelta) {
  var dx = tx - vx, dz = tz - vz;
  var d = len2(dx, dz);
  if (d <= maxDelta || d < 1e-6) return { x: tx, z: tz };
  return { x: vx + dx / d * maxDelta, z: vz + dz / d * maxDelta };
}

function desiredFromInput(ix, iz, maxSpeed, deadzone) {
  var mag = len2(ix || 0, iz || 0);
  if (mag <= (deadzone || 0)) return { x: 0, z: 0, active: false, strength: 0 };
  var strength = Math.min(1, mag);
  return {
    x: (ix / mag) * maxSpeed * strength,
    z: (iz / mag) * maxSpeed * strength,
    active: true,
    strength: strength
  };
}

export function drive(pos, vel, input, maxSpeed, dt, opts) {
  opts = opts || {};
  var desired = desiredFromInput(input && input.x, input && input.z, maxSpeed, opts.deadzone || 0);
  return stepVelocity(pos, vel, desired, dt, opts);
}

export function seek(pos, vel, target, maxSpeed, dt, opts) {
  opts = opts || {};
  target = target || pos;
  var dx = target.x - pos.x, dz = target.z - pos.z;
  var d = len2(dx, dz);
  var arrive = opts.arrive || 0.5;
  var stop = opts.stop || 0.05;
  var speed = d <= stop ? 0 : maxSpeed * clamp(d / arrive, 0, 1);
  var desired = d > 1e-6
    ? { x: dx / d * speed, z: dz / d * speed, active: speed > 0, strength: maxSpeed > 0 ? speed / maxSpeed : 0 }
    : { x: 0, z: 0, active: false, strength: 0 };
  return stepVelocity(pos, vel, desired, dt, opts);
}

export function stepVelocity(pos, vel, desired, dt, opts) {
  opts = opts || {};
  desired = desired || { x: 0, z: 0, active: false };
  var accel = opts.accel || 20;
  var decel = opts.decel || accel;
  var wasSpeed = len2(vel.x, vel.z);
  var targetSpeed = len2(desired.x, desired.z);
  var turnDot = 1;
  if (wasSpeed > 0.01 && targetSpeed > 0.01) {
    turnDot = (vel.x * desired.x + vel.z * desired.z) / (wasSpeed * targetSpeed);
  }
  var rate = targetSpeed > wasSpeed ? accel : decel;
  if (turnDot < 0.0) rate = Math.max(rate, decel);
  var next = approachVec(vel.x, vel.z, desired.x, desired.z, rate * dt);
  if (!desired.active && len2(next.x, next.z) < 0.02) {
    next.x = 0; next.z = 0;
  }
  vel.x = next.x; vel.z = next.z;
  pos.x += vel.x * dt;
  pos.z += vel.z * dt;
  return {
    speed: len2(vel.x, vel.z),
    desiredSpeed: targetSpeed,
    desiredActive: !!desired.active,
    turningDot: turnDot
  };
}

export function localVelocity(vel, facing) {
  var fx = Math.sin(facing), fz = Math.cos(facing);       // local +z in world
  var sx = Math.cos(facing), sz = -Math.sin(facing);      // local +x in world
  return {
    side: vel.x * sx + vel.z * sz,
    forward: vel.x * fx + vel.z * fz
  };
}

export function classifyVisual(local, speed, ready, override) {
  if (override === 'lunge' || override === 'plant' || override === 'split') return override;
  if (speed < 0.15) return ready ? 'ready' : 'idle';
  var side = Math.abs(local.side);
  var fwd = Math.abs(local.forward);
  if (side > fwd * 1.15) return 'shuffle';
  if (local.forward < -0.35) return 'backpedal';
  return 'run';
}
