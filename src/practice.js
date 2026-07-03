'use strict';

import { COURT, HIT, PRACTICE } from './constants.js';
import { clamp, dist2D } from './utils.js';

const FEEDBACK = {
  perfect: { banner: 'PERFECT SETUP', shot: 'PERFECT' },
  clean:   { banner: 'CLEAN CONTACT', shot: 'CLEAN' },
  good:    { banner: 'GOOD REP', shot: 'GOOD' },
  reach:   { banner: 'STRETCHED CONTACT', shot: 'REACH' },
  late:    { banner: 'LATE SWING', shot: 'LATE' },
  early:   { banner: 'EARLY SWING', shot: 'EARLY' },
  far:     { banner: 'TOO FAR', shot: 'FAR' },
  whiff:   { banner: 'MISS', shot: 'WHIFF' }
};

export function machineBase() {
  return { x: PRACTICE.MACHINE_X, z: -COURT.HALF_L + PRACTICE.MACHINE_Z_INSET };
}

export function feedOrigin() {
  var base = machineBase();
  return {
    x: base.x,
    y: PRACTICE.RELEASE_Y,
    z: base.z + PRACTICE.RELEASE_Z_OFFSET
  };
}

export function randomFeedTarget(rand) {
  var pick = rand || Math.random;
  return {
    x: (pick() * 2 - 1) * PRACTICE.TARGET_X_MAX,
    z: PRACTICE.TARGET_Z_MIN + pick() * (PRACTICE.TARGET_Z_MAX - PRACTICE.TARGET_Z_MIN)
  };
}

export function openingFeedTarget() {
  return {
    x: 0,
    z: PRACTICE.OPENING_TARGET_Z
  };
}

export function scoreTiming(contactDeltaZ) {
  var ideal = PRACTICE.TIMING_IDEAL_Z;
  var delta = (contactDeltaZ || 0) - ideal;
  var absDelta = Math.abs(delta);
  var grade = absDelta <= PRACTICE.TIMING_PERFECT_MAX ? 'perfect'
    : absDelta <= PRACTICE.TIMING_CLEAN_MAX ? 'clean'
    : absDelta <= PRACTICE.TIMING_GOOD_MAX ? 'good'
    : delta > 0 ? 'late' : 'early';
  return { delta: delta, absDelta: absDelta, grade: grade };
}

export function scoreContact(dist, stability, timing, result) {
  var d = Math.max(0, dist || 0);
  var s = clamp(stability || 0, 0, 1);
  if (result === 'whiff') {
    if (timing && timing.grade === 'late') return withMetrics('late', d, s, timing, result);
    if (timing && timing.grade === 'early') return withMetrics('early', d, s, timing, result);
    return withMetrics(d <= PRACTICE.POSITION_GOOD_MAX ? 'whiff' : 'far', d, s, timing, result);
  }
  if (d <= PRACTICE.POSITION_PERFECT_MAX && s >= PRACTICE.STABILITY_PERFECT_MIN &&
      timing && (timing.grade === 'perfect' || timing.grade === 'clean')) {
    return withMetrics('perfect', d, s, timing, result);
  }
  if (d <= PRACTICE.POSITION_GOOD_MAX && s >= PRACTICE.STABILITY_CLEAN_MIN && timing &&
      (timing.grade === 'perfect' || timing.grade === 'clean' || timing.grade === 'good')) {
    return withMetrics('clean', d, s, timing, result);
  }
  if (d <= PRACTICE.POSITION_GOOD_MAX && s >= PRACTICE.STABILITY_GOOD_MIN &&
      (!timing || timing.grade === 'good' || timing.grade === 'clean' || timing.grade === 'perfect')) {
    return withMetrics('good', d, s, timing, result);
  }
  if (timing && timing.grade === 'late') return withMetrics('late', d, s, timing, result);
  if (timing && timing.grade === 'early') return withMetrics('early', d, s, timing, result);
  return withMetrics(d <= HIT.REACH ? 'reach' : 'far', d, s, timing, result);
}

export function liveCue(dist, contactDeltaZ, ballY) {
  if (ballY <= 0 || ballY >= HIT.REACH_Y_MAX) return 'none';
  var d = Math.max(0, dist || 0);
  var timing = scoreTiming(contactDeltaZ);
  if (d <= PRACTICE.POSITION_GOOD_MAX && (timing.grade === 'perfect' || timing.grade === 'clean')) return 'perfect';
  if (d <= HIT.REACH * 0.95 && (timing.grade === 'perfect' || timing.grade === 'clean' || timing.grade === 'good')) return 'clean';
  if (d <= HIT.REACH * 1.2 && timing.grade !== 'early' && timing.grade !== 'late') return 'good';
  return 'none';
}

function withMetrics(key, dist, stability, timing, result) {
  return {
    key: key,
    banner: FEEDBACK[key].banner,
    shot: FEEDBACK[key].shot,
    dist: dist,
    stability: stability,
    timing: timing || null,
    result: result || 'contact'
  };
}

export function nearestBallDistance(playerPos, ballPos) {
  return dist2D(ballPos.x - playerPos.x, ballPos.z - playerPos.z);
}

export function sessionCallout(session) {
  return 'Rep ' + session.rep + ' · Clean ' + session.clean + ' · Best ' + session.bestStreak + ' streak';
}
