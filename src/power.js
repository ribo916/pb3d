/* ============================================================================
 * power.js — Power meter + super smash economy (pure logic, no three/DOM).
 *
 * Two responsibilities, both deliberately kept out of game.js so they stay
 * node-testable:
 *   1. The CHARGE ECONOMY — how the meter fills (clean contacts only), when it
 *      may be spent, and what carries across a point.
 *   2. The STUN TIMELINE — the blown -> down -> up -> none state machine a
 *      blasted player runs through, and what it blocks while it runs.
 *
 * All tuning lives in constants.SUPER. Nothing here knows about rendering,
 * animation, or the scene graph; game.js reads this state and drives visuals.
 * ==========================================================================*/
'use strict';

import { SUPER, STABILITY } from './constants.js';
import { clamp } from './utils.js';

/* --------------------------- state factories --------------------------- */

export function makeMeter() {
  return { charge: 0, armed: false };
}

export function makeStun() {
  return { phase: 'none', t: 0, dur: 0, dirX: 0, dirZ: 0 };
}

/* --------------------------- charge economy ---------------------------- */

/* Meter gained from one paddle contact.
 * ONLY a clean contact charges — a float or popup gives nothing, so the meter
 * rewards timing rather than rally length. Above the clean threshold, a better
 * contact charges a little faster (scaled by CHARGE_QUALITY_BONUS). */
export function chargeFor(quality, stability) {
  if (quality !== 'clean') return 0;
  var s = (stability == null) ? 1 : stability;
  // How far above the float threshold this contact sat, normalized 0..1.
  var head = STABILITY.FLOAT_THRESHOLD >= 1 ? 0
    : clamp((s - STABILITY.FLOAT_THRESHOLD) / (1 - STABILITY.FLOAT_THRESHOLD), 0, 1);
  return SUPER.CHARGE_CLEAN * (1 + SUPER.CHARGE_QUALITY_BONUS * head);
}

export function addCharge(meter, amount) {
  if (!meter) return meter;
  meter.charge = clamp(meter.charge + (amount || 0), 0, SUPER.FULL);
  if (meter.charge >= SUPER.FULL) meter.armed = true;
  return meter;
}

/* Every gate on unleashing, in one place.
 * ctx: { shots, phase, volley, inKitchen }
 *
 * The kitchen gate is the important one. A super is an attacking shot from the
 * transition zone or the baseline, never a dink-battle weapon — so we refuse it
 * from inside the kitchen entirely, not just on a volley. That protects the
 * 4-shot pattern, and unlike a height threshold it is a condition the player
 * can deliberately satisfy by backing up.
 *
 * A refused super does NOT spend: canUnleash returning false means the branch
 * never fires, the meter is untouched, and the swing falls through to the
 * normal path. You may lose the point, but you keep the resource. */
export function canUnleash(meter, ballY, ctx) {
  if (!meter || !meter.armed) return false;
  if (!(ballY >= SUPER.SMASH_H)) return false;
  ctx = ctx || {};
  if ((ctx.shots || 0) < SUPER.MIN_SHOTS) return false;
  if (ctx.phase !== 'open') return false;
  // One per team per rally — bounds the long-rally feedback loop.
  if ((ctx.teamUsed || 0) >= SUPER.MAX_PER_RALLY) return false;
  if (SUPER.NO_KITCHEN && ctx.inKitchen) return false;
  // Even without the blanket kitchen rule, a kitchen volley is a plain fault.
  if (ctx.volley && ctx.inKitchen) return false;
  return true;
}

export function spend(meter) {
  if (!meter) return meter;
  meter.charge = clamp(meter.charge - SUPER.COST, 0, SUPER.FULL);
  meter.armed = false;
  return meter;
}

/* Carried between points. Full reset makes the meter unreachable (a median
 * rally is only 2-4 clean contacts per player); full persistence makes it a
 * stale bank. Partial carry gives a "build over 2-3 rallies" cadence. */
export function carryPoint(meter) {
  if (!meter) return meter;
  meter.charge = clamp(meter.charge * SUPER.POINT_CARRY, 0, SUPER.FULL);
  if (meter.charge < SUPER.FULL) meter.armed = false;
  return meter;
}

export function resetMeter(meter) {
  if (!meter) return meter;
  meter.charge = 0;
  meter.armed = false;
  return meter;
}

/* ------------------------------ blast/stun ----------------------------- */

/* Unit vector pointing from the attacker to the victim — the direction the
 * victim gets knocked. Degenerate (same position) falls back to +z. */
export function blastDirection(fromX, fromZ, toX, toZ) {
  var dx = toX - fromX, dz = toZ - fromZ;
  var d = Math.sqrt(dx * dx + dz * dz);
  if (d < 1e-6) return { x: 0, z: 1 };
  return { x: dx / d, z: dz / d };
}

export function applyBlast(stun, dir) {
  if (!stun) return stun;
  stun.phase = 'blown';
  stun.t = 0;
  stun.dur = SUPER.STUN.BLOWN;
  stun.dirX = dir ? dir.x : 0;
  stun.dirZ = dir ? dir.z : 1;
  return stun;
}

var NEXT_PHASE = { blown: 'down', down: 'up', up: 'none' };

function phaseDur(phase) {
  if (phase === 'blown') return SUPER.STUN.BLOWN;
  if (phase === 'down') return SUPER.STUN.DOWN;
  if (phase === 'up') return SUPER.STUN.UP;
  return 0;
}

/* Advance the stun timeline. Carries overflow into the next phase so the total
 * duration is exact regardless of frame pacing. Returns the stun for chaining;
 * callers read `phase` to drive visuals and gating. */
export function tickStun(stun, dt) {
  if (!stun || stun.phase === 'none') return stun;
  stun.t += (dt || 0);
  while (stun.phase !== 'none' && stun.t >= stun.dur) {
    var over = stun.t - stun.dur;
    stun.phase = NEXT_PHASE[stun.phase] || 'none';
    stun.dur = phaseDur(stun.phase);
    stun.t = over;
    if (stun.phase === 'none') { stun.t = 0; stun.dur = 0; break; }
  }
  return stun;
}

/* A stunned player has no agency at all — no movement input, no swing, no
 * contact eligibility. This is what makes the recovery pause actually cost the
 * next ball rather than being pure decoration. */
export function stunBlocksInput(stun) {
  return !!stun && stun.phase !== 'none';
}

/* Backward slide speed during the knockback, decaying to 0 across the BLOWN
 * phase. Zero in every other phase — once you're down, you're down. */
export function stunSlideSpeed(stun) {
  if (!stun || stun.phase !== 'blown') return 0;
  var d = SUPER.STUN.BLOWN;
  if (d <= 0) return 0;
  var remain = clamp(1 - (stun.t / d), 0, 1);
  // Average speed over the phase must cover BLAST_BACK meters; a linear decay
  // from 2*v_avg to 0 does exactly that.
  return (SUPER.BLAST_BACK / d) * 2 * remain;
}

export function stunTotal() {
  return SUPER.STUN.BLOWN + SUPER.STUN.DOWN + SUPER.STUN.UP;
}
