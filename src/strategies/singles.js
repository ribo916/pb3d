'use strict';

import { COURT } from '../physics.js';
import * as Shots from '../shots.js';
import * as Rules from '../rules.js';
import { SPECIALTY, POWER_CAP, MOVEMENT, SINGLES } from '../constants.js';
import { clamp } from '../utils.js';
import { clampX, loneOpponent, singlesPassingTarget, feetDepth, rand,
         situationalLob, scorePressure, ballDifficultyMult } from './common.js';

const C = COURT;

export function servePosition(player, srv, rcv) {
  var fwd = (player.team === 'near') ? 1 : -1;
  var info = player.team === srv.team ? srv : rcv;
  return {
    x: Rules.sideX(player.team, info.side) * (C.HALF_W * 0.5),
    z: fwd * (C.HALF_L + 0.45)
  };
}

export function chooseMovement(ai, ball, rally, ctx) {
  var p = ctx.player;
  var team = p.team;
  var fwd = (team === 'near') ? 1 : -1;
  var pred = ctx.prediction;
  var incoming = ctx.incoming;
  var opp = loneOpponent(ctx.opponents);
  var recoverX = opp ? clamp(-opp.pos.x * SINGLES.READY_W_FRAC, -C.HALF_W * 0.32, C.HALF_W * 0.32) : 0;
  var recoverZMag = ctx.isReturner ? SINGLES.RETURN_READ_Z : SINGLES.RECOVER_Z;
  var tx = recoverX;
  var tz = fwd * recoverZMag;
  var kind = (rally && rally.phase === 'open') ? 'recover' : 'hold';

  if (pred && incoming) {
    tx = clamp(pred.x + (pred.x - p.pos.x) * SINGLES.CHASE_X_BIAS, -C.HALF_W - 0.45, C.HALF_W + 0.45);
    tz = pred.z + fwd * SINGLES.INTERCEPT_CUSHION;
    tz = clamp(tz, -C.HALF_L - 0.35, C.HALF_L + 0.35);
    var dist = ctx.distance(tx, tz);
    var timeLeft = ball.spline ? Math.max(0, ball.spline.duration - ball.spline.elapsed) : 0.65;
    var reachable = ai.cfg.speed * (timeLeft + ai.cfg.react + 0.2);
    kind = dist > reachable + 0.45 ? 'emergency' : 'intercept';
    if (dist > MOVEMENT.LUNGE_DIST && timeLeft < 0.34) {
      p.move.lunge = Math.max(p.move.lunge || 0, 0.18);
    }
  }

  return { target: { x: tx, z: tz }, kind: kind };
}

export function neutralAimTarget(opponents) {
  var opp = loneOpponent(opponents);
  if (!opp) return null;
  return {
    x: singlesPassingTarget(opp, { bodyChance: 0 }),
    z: Math.max(C.KITCHEN * 1.6, Math.abs(opp.pos.z))
  };
}

export function chooseShot(ai, ball, match, isServe, ctx) {
  var cfg = ai.cfg;
  var nearBaseZ = C.HALF_L - 0.5;
  var aim, apex, spin = { x: 0, y: 0, z: 0 }, type = 'drive', margin;
  var hitterPos = ctx.hitterPos;
  var opp = loneOpponent(ctx.opponents);

  // Score-awareness + pressure-linked errors (see doubles.js for rationale).
  var pressure = scorePressure(match, ctx.hitterTeam);
  var effMiss = cfg.miss * ballDifficultyMult(ctx.contactQuality) * pressure.missMul;

  if (!isServe && Math.random() < effMiss) {
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
        return { target: { x: rand(-C.HALF_W * 0.7, C.HALF_W * 0.7), z: C.HALF_L * 0.35 },
          apex: 0.95, spin: { x: 3.5, y: 0, z: 0 }, type: 'erne', margin: 0.05 };
      }
      if (hx > C.HALF_W + SPECIALTY.ATP_X_MARGIN) {
        var atpSign = hitterPos.x > 0 ? 1 : -1;
        return { target: { x: atpSign * C.HALF_W * 0.85, z: C.HALF_L * 0.55 },
          apex: 0.75, spin: { x: 0, y: atpSign * 2.0, z: 0 }, type: 'atp', margin: 0 };
      }
    }

    var smart = cfg.smart;
    var shotIQ = cfg.shotIQ != null ? cfg.shotIQ : smart;
    var aggr = clamp(cfg.aggression * pressure.aggMul, 0, 1);
    var bias = aggr - shotIQ;
    var absZ = Math.abs(ball.pos.z);
    var zone = Shots.zoneOf(absZ, C.KITCHEN, C.HALF_L);
    var ballHigh = ball.pos.y > 0.95;
    var intent;
    var isReturn = match && match.rally && match.rally.shots === 2;
    var isThirdShot = match && match.rally && match.rally.shots === 3;

    if (ball.pos.y >= cfg.smashMin && Math.random() < aggr * cfg.speedupBias) {
      return {
        target: { x: singlesPassingTarget(opp, { bodyChance: 0.08 }), z: feetDepth(opp) },
        apex: POWER_CAP.NET_H + 0.06,
        spin: { x: 5.0 + smart * 2.0, y: 0, z: 0 },
        type: 'speedup', margin: 0.06, isSmash: true
      };
    }

    if (isReturn) {
      intent = 'power';
    } else if (isThirdShot && zone !== 'kitchen') {
      var thirdShotDrop = clamp(Math.max(0, shotIQ - 0.1) * 1.25 - bias * 0.8, 0, 1) *
        SINGLES.THIRD_SHOT_DROP_SCALE * cfg.dropBias;
      intent = (Math.random() < thirdShotDrop) ? 'touch' : 'power';
    } else if (ball.pos.y <= POWER_CAP.NET_H) {
      intent = 'touch';
    } else if (situationalLob(ctx.opponents, ball, cfg)) {
      intent = 'lob';
    } else if (zone === 'kitchen') {
      if (ballHigh && Math.random() < aggr * cfg.speedupBias) intent = 'power';
      else {
        var dinkChance = clamp(Math.max(0, shotIQ - 0.4) - bias * 0.8, 0, 1) * cfg.dinkBias;
        intent = (Math.random() < dinkChance) ? 'touch' : 'power';
      }
    } else {
      var dropChance = clamp(Math.max(0, shotIQ - 0.55) * 0.9 - bias * 0.8, 0, 1) * cfg.dropBias;
      intent = (Math.random() < dropChance) ? 'touch' : 'power';
    }

    var sr = Shots.resolve(absZ, ball.pos.y, intent, C.KITCHEN, C.HALF_L);
    type = sr.type; var sp = sr.sp;

    if (type === 'drive' || type === 'speedup') {
      aim = {
        x: singlesPassingTarget(opp),
        z: isReturn ? C.HALF_L * SINGLES.RETURN_CROSSCOURT_FRAC : feetDepth(opp)
      };
    } else if (type === 'drop') {
      aim = {
        x: clampX(singlesPassingTarget(opp, { bodyChance: 0 }) * 0.72, 0.76),
        z: sp.landZ
      };
    } else if (type === 'lob') {
      aim = {
        x: singlesPassingTarget(opp, { widthFrac: 0.8, wideFrac: 0.86, bodyChance: 0 }),
        z: Math.max(C.HALF_L * 0.82, feetDepth(opp))
      };
    } else {
      aim = { x: rand(-C.HALF_W * 0.52, C.HALF_W * 0.52), z: sp.landZ };
    }

    apex = sp.apex; spin.x = sp.spinX; spin.y = sp.spinY; margin = sp.margin;
  }

  var e = cfg.err;
  aim.x += rand(-e, e) * 1.45;
  aim.z += rand(-e, e) * 1.25;
  apex += rand(-e, e) * 0.55;

  return { target: aim, apex: apex, spin: spin, type: type, margin: margin };
}
