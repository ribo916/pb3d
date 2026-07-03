'use strict';

import { COURT } from '../physics.js';
import * as Shots from '../shots.js';
import * as Rules from '../rules.js';
import { SPECIALTY, POWER_CAP, MOVEMENT } from '../constants.js';
import { clamp } from '../utils.js';
import { deeperOpponent, clampX, randomCornerX, rand } from './common.js';

const C = COURT;

export function servePosition(player, srv, rcv, laneX) {
  var fwd = (player.team === 'near') ? 1 : -1;
  var z;
  if (player.team === srv.team && player.slot === srv.slot) {
    z = fwd * (C.HALF_L + 0.45);
  } else if (player.team === srv.team) {
    z = fwd * (C.HALF_L + 0.2);
  } else if (player.team === rcv.team && player.slot === rcv.slot) {
    z = fwd * (C.HALF_L + 0.45);
  } else {
    z = fwd * (C.KITCHEN + 0.25);
  }
  return { x: laneX, z: z };
}

export function chooseMovement(ai, ball, rally, ctx) {
  var p = ctx.player;
  var team = p.team;
  var fwd = (team === 'near') ? 1 : -1;
  var lane = ctx.lane;
  var laneX = lane * (C.HALF_W * 0.55);
  var backZ = C.HALF_L - 0.9, upZ = C.KITCHEN + 0.3;
  var isServingTeam = (team === ctx.servingTeam);
  var shotsCompleted = (rally && rally.shots) || 0;
  var advanceAllowed = (rally && rally.phase === 'open') &&
    (!isServingTeam || shotsCompleted >= 3);
  var advance = advanceAllowed ? clamp(p.ai.cfg.smart * 1.6 - 0.2, 0, 1) : 0;
  var tx = laneX, tz = fwd * (backZ + (upZ - backZ) * advance);
  var kind = advanceAllowed ? 'recover' : 'hold';
  var pred = ctx.prediction;
  var incoming = ctx.incoming;

  if (pred && ctx.responsible) {
    var isPopup = ball.spline && ball.spline.P1.y >= 2.0;
    if (!isPopup) {
      tx = pred.x;
      tz = pred.z + fwd * 0.25;
    }
    var dist = ctx.distance(tx, tz);
    var timeLeft = ball.spline ? Math.max(0, ball.spline.duration - ball.spline.elapsed) : 0.65;
    var reachable = ai.cfg.speed * (timeLeft + ai.cfg.react + 0.16);
    kind = dist > reachable + 0.6 ? 'emergency' : 'intercept';
    if (isPopup) {
      if (p.move.kind !== 'split') p.move.split = Math.max(p.move.split || 0, MOVEMENT.SPLIT_STEP_TIME);
      kind = 'split';
    }
    if (dist > MOVEMENT.LUNGE_DIST && timeLeft < 0.36) {
      p.move.lunge = Math.max(p.move.lunge || 0, 0.18);
    }
  } else if (pred && incoming) {
    tx += -lane * MOVEMENT.RECOVER_SHADE_X;
    if (p.move.kind !== 'split') p.move.split = Math.max(p.move.split || 0, MOVEMENT.SPLIT_STEP_TIME);
    kind = 'split';
  }

  return { target: { x: tx, z: tz }, kind: kind };
}

export function neutralAimTarget(opponents) {
  var deeper = deeperOpponent(opponents);
  if (!deeper) return null;
  return {
    x: clampX(deeper.pos.x + ((deeper.pos.x >= 0) ? -0.6 : 0.6), 0.92),
    z: Math.abs(deeper.pos.z)
  };
}

export function chooseShot(ai, ball, match, isServe, ctx) {
  var cfg = ai.cfg;
  var nearBaseZ = C.HALF_L - 0.5;
  var aim, apex, spin = { x: 0, y: 0, z: 0 }, type = 'drive', margin;
  var opponents = ctx.opponents;
  var hitterPos = ctx.hitterPos;

  if (!isServe && Math.random() < cfg.miss) {
    var mode = Math.random();
    if (mode < 0.10) {
      return { target: { x: rand(-1, 1), z: 0.4 }, apex: 0.9, spin: { x: 0, y: 0, z: 0 }, fault: 'net' };
    }
    var outX = (Math.random() < 0.5) ? rand(-C.HALF_W * 0.6, C.HALF_W * 0.6) : (Math.random() < 0.5 ? -1 : 1) * (C.HALF_W + 1.2);
    return { target: { x: outX, z: nearBaseZ + rand(0.8, 2.0) }, apex: 1.6, spin: { x: 3, y: 0, z: 0 }, fault: 'out' };
  }

  if (isServe) {
    var rcv = Rules.currentReceiver(match);
    aim = { x: Rules.sideX(rcv.team, rcv.side) * (C.HALF_W * 0.5), z: (C.HALF_L * 0.75) };
    apex = 2.4; spin.x = 2.0; type = 'serve';
  } else {
    if (cfg.smart >= 0.92 && hitterPos) {
      var hx = Math.abs(hitterPos.x), hz = Math.abs(hitterPos.z);
      if (hx > C.HALF_W + SPECIALTY.ERNE_X_MARGIN && hz < SPECIALTY.ERNE_Z_MAX) {
        return { target: { x: rand(-C.HALF_W * 0.6, C.HALF_W * 0.6), z: C.HALF_L * 0.35 },
          apex: 0.95, spin: { x: 3.5, y: 0, z: 0 }, type: 'erne', margin: 0.05 };
      }
      if (hx > C.HALF_W + SPECIALTY.ATP_X_MARGIN) {
        var atpSign = hitterPos.x > 0 ? 1 : -1;
        return { target: { x: atpSign * C.HALF_W * 0.85, z: C.HALF_L * 0.55 },
          apex: 0.75, spin: { x: 0, y: atpSign * 2.0, z: 0 }, type: 'atp', margin: 0 };
      }
    }

    var smart = cfg.smart;
    var absZ = Math.abs(ball.pos.z);
    var zone = Shots.zoneOf(absZ, C.KITCHEN, C.HALF_L);
    var ballHigh = ball.pos.y > 0.95;
    var intent;

    if (ball.pos.y >= 1.3 && Math.random() < smart) {
      var smashDepth = C.HALF_L * 0.75;
      var smashAimX = rand(-C.HALF_W * 0.72, C.HALF_W * 0.72);
      if (opponents) {
        var sdf = deeperOpponent(opponents);
        smashDepth = Math.max(C.KITCHEN * 1.5, Math.min(C.HALF_L * 0.92, Math.abs(sdf.pos.z)));
        var sSign = (sdf.pos.x >= 0) ? -1 : 1;
        smashAimX = clampX(sdf.pos.x + sSign * 0.6, 0.88);
      }
      return {
        target: { x: smashAimX, z: smashDepth },
        apex: POWER_CAP.NET_H + 0.06,
        spin: { x: 5.0 + smart * 2.0, y: 0, z: 0 },
        type: 'speedup', margin: 0.06, isSmash: true
      };
    }

    var isReturn = match && match.rally && match.rally.shots === 2;
    var isThirdShot = match && match.rally && match.rally.shots === 3;
    if (isReturn) {
      intent = 'power';
    } else if (isThirdShot && zone !== 'kitchen') {
      var thirdShotDrop = Math.max(0, smart - 0.1) * 1.25;
      intent = (Math.random() < thirdShotDrop) ? 'touch' : 'power';
    } else if (ball.pos.y <= POWER_CAP.NET_H) {
      intent = 'touch';
    } else if (Math.random() < 0.06 * smart) {
      intent = 'lob';
    } else if (zone === 'kitchen') {
      if (ballHigh && Math.random() < smart) intent = 'power';
      else intent = (Math.random() < Math.max(0, smart - 0.3) * 1.2) ? 'touch' : 'power';
    } else {
      var dropChance = Math.max(0, smart - 0.45) * 1.1;
      intent = (Math.random() < dropChance) ? 'touch' : 'power';
    }
    var sr = Shots.resolve(absZ, ball.pos.y, intent, C.KITCHEN, C.HALF_L);
    type = sr.type; var sp = sr.sp;

    var aimX;
    if (opponents && (type === 'drive' || type === 'speedup' || type === 'drop')) {
      var deeper = deeperOpponent(opponents);
      var away = (deeper.pos.x >= 0) ? -1 : 1;
      aimX = clampX(deeper.pos.x + away * 0.6, 0.88);
      if (type === 'drive' || type === 'speedup') {
        var feetDepth = Math.abs(deeper.pos.z);
        feetDepth = Math.max(C.KITCHEN * 1.5, Math.min(C.HALF_L * 0.92, feetDepth));
        aim = { x: aimX, z: feetDepth };
      } else {
        aim = { x: aimX, z: sp.landZ };
      }
    } else {
      if (type === 'drive' || type === 'lob') {
        aimX = randomCornerX();
      } else if (type === 'speedup') {
        aimX = rand(-C.HALF_W * 0.4, C.HALF_W * 0.4);
      } else {
        aimX = rand(-C.HALF_W * 0.7, C.HALF_W * 0.7);
      }
      aim = { x: aimX, z: sp.landZ };
    }
    apex = sp.apex; spin.x = sp.spinX; spin.y = sp.spinY; margin = sp.margin;
  }

  var e = cfg.err;
  aim.x += rand(-e, e) * 1.6;
  aim.z += rand(-e, e) * 1.4;
  apex += rand(-e, e) * 0.6;

  return { target: aim, apex: apex, spin: spin, type: type, margin: margin };
}
