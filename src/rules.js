/* ============================================================================
 * rules.js — Pickleball rules + rally state machine (doubles, side-out scoring)
 * Pure logic. Drives points from discrete rally events.
 * Ported from the original Picklelife js/rules.js (ESM).
 *
 * Rules modeled:
 *   - Serve must be diagonal (cross-court), clear the kitchen, land in bounds.
 *   - Double-bounce rule: serve must bounce, return must bounce (no volleys on
 *     the first two shots).
 *   - Non-volley zone: a volley (hit before bounce) is a fault if the hitter is
 *     standing in the kitchen.
 *   - Two bounces on one side before a return = point to the other side.
 *   - Into the net / out of bounds = fault on the hitter.
 *   - Side-out scoring: only the serving side scores. Game to 11, win by 2.
 *   - Doubles serve rotation with serverNum 1/2, serverSlot 0/1, 0-0-2 start.
 * ==========================================================================*/
'use strict';

export const NEAR = 'near';
export const FAR = 'far';
export function other(s) { return s === NEAR ? FAR : NEAR; }

export function makeMatch(opts) {
  opts = opts || {};
  return {
    scores: { near: 0, far: 0 },
    server: opts.server || NEAR,    // serving TEAM (near/far)
    // Doubles serve rotation. serverNum 1|2 = first/second server of the team's
    // turn; serverSlot 0|1 = which of the team's two players is serving. The
    // start-of-game exception: the first serving team gets only its 2nd server
    // (one fault ends their turn) — the standard "0-0-2" rule.
    serverNum: opts.serverNum || 2,
    serverSlot: (opts.serverSlot != null) ? opts.serverSlot : 0,
    pointTo: 11,
    winBy: 2,
    gameOver: false,
    winner: null,
    // live rally state
    rally: null,
    lastEvent: null,
    history: []
  };
}

// Which slot (0/1) of a team is on its RIGHT/even service court. Slot 0 starts
// on the right at score 0; teammates swap each point, so this tracks parity.
export function rightSlot(match, team) { return (match.scores[team] % 2 === 0) ? 0 : 1; }

// World-x sign of a team's right ('R') / left ('L') service court. The far team
// faces the opposite way, so its right court is on -x.
export function sideX(team, side) {
  var teamRight = (team === NEAR) ? 1 : -1;
  return (side === 'R') ? teamRight : -teamRight;
}

// The current server: team, slot, and which court side it's on.
export function currentServer(match) {
  var team = match.server, slot = match.serverSlot;
  var side = (slot === rightSlot(match, team)) ? 'R' : 'L';
  return { team: team, slot: slot, side: side, num: match.serverNum };
}

// The current receiver: diagonally opposite the server (same R/L designation,
// opposite world-x because the teams face each other).
export function currentReceiver(match) {
  var srv = currentServer(match);
  var team = other(match.server);
  var rs = rightSlot(match, team);
  var slot = (srv.side === 'R') ? rs : (1 - rs);
  return { team: team, slot: slot, side: srv.side };
}

// Court side that the server must serve into (diagonal). Based on the actual
// server's side so the 2nd server (who may be off-parity) still validates.
export function serveCourt(match) {
  var srv = currentServer(match);
  return { fromRight: (srv.side === 'R'), server: match.server, slot: srv.slot, side: srv.side };
}

// Begin a serve. Returns the rally object.
export function startRally(match) {
  var info = serveCourt(match);
  match.rally = {
    phase: 'serve',          // 'serve' -> 'return' -> 'open'
    lastHitter: match.server,
    shots: 0,                // total paddle contacts this rally
    bouncesSinceHit: 0,
    serverInfo: info,
    live: true,
    faulted: false
  };
  return match.rally;
}

/* Event handlers — each returns a result describing what happened, e.g.
 * {point:'near'|'far'|null, reason, sideOut:bool, scored:bool, gameOver}
 */

export function awardRally(match, winner, reason) {
  var serveTeam = match.server;
  var r = { point: null, sideOut: false, secondServer: false, scored: false,
            reason: reason, gameOver: false, rallyWinner: winner, serverNum: match.serverNum };
  if (winner === serveTeam) {
    // Serving team scores: a point. The same server keeps serving but the two
    // partners swap courts — that swap is implicit: score parity flips, so
    // rightSlot() flips and currentServer()'s side flips (game.js repositions).
    match.scores[winner] += 1;
    r.point = winner; r.scored = true;
  } else if (match.serverNum === 1) {
    // First server faulted: the team's SECOND server gets a turn (no point, no swap).
    match.serverNum = 2;
    match.serverSlot = 1 - match.serverSlot; // partner serves
    r.secondServer = true;
  } else {
    // Second server faulted: SIDE OUT — serve passes to the other team, whose
    // right/even player serves first as their first server.
    match.server = winner;
    match.serverNum = 1;
    match.serverSlot = rightSlot(match, winner);
    r.sideOut = true;
  }
  if (match.rally) match.rally.live = false;
  // game over check
  var a = match.scores.near, b = match.scores.far;
  var hi = Math.max(a, b), lo = Math.min(a, b);
  if (hi >= match.pointTo && (hi - lo) >= match.winBy) {
    match.gameOver = true;
    match.winner = (a > b) ? NEAR : FAR;
    r.gameOver = true;
  }
  match.history.push({ winner: winner, reason: reason, score: { near: a, far: b } });
  match.lastEvent = r;
  return r;
}

// A paddle strikes the ball. hitter = 'near'|'far'.
// ctx: { volley:bool (hit before bounce), inKitchen:bool, overNet:bool(optional) }
export function onPaddleHit(match, hitter, ctx) {
  ctx = ctx || {};
  var r = match.rally;
  if (!r || !r.live) return { point: null, illegal: false };

  // Double-bounce rule: first two shots (serve + return) cannot be volleys.
  if ((r.phase === 'serve' || r.phase === 'return') && ctx.volley) {
    return awardRally(match, other(hitter), 'volley-before-double-bounce');
  }

  // Non-volley-zone fault: volley while in the kitchen.
  if (ctx.volley && ctx.inKitchen) {
    return awardRally(match, other(hitter), 'kitchen-volley');
  }

  // Legal contact: advance phase.
  r.shots += 1;
  r.lastHitter = hitter;
  r.bouncesSinceHit = 0;
  if (r.phase === 'serve') r.phase = 'return';
  else if (r.phase === 'return') r.phase = 'open';
  return { point: null, illegal: false, phase: r.phase };
}

// injected geometry (kept loose so rules.js stays dependency-free)
var _KIT = 7 * 0.3048, _HW = 10 * 0.3048;
function require_kitchen() { return _KIT; }
function require_halfw() { return _HW; }
export function setGeometry(kitchen, halfW) { _KIT = kitchen; _HW = halfW; }

// Validate a serve's first floor contact. Returns a fault reason or null.
export function serveFault(match, ev) {
  var r = match.rally;
  var server = match.server, receiver = other(server);
  var recvSign = (receiver === NEAR) ? 1 : -1;
  var onReceiverSide = (ev.z * recvSign) > 0;
  var beyondKitchen = Math.abs(ev.z) >= require_kitchen();
  var inWidth = Math.abs(ev.x) <= require_halfw() + 0.02;
  var fromRight = r.serverInfo.fromRight;
  var serverRightX = (server === NEAR) ? 1 : -1;
  var targetXSign = fromRight ? -serverRightX : serverRightX; // diagonal flip
  var diagonalOk = (ev.x * targetXSign) >= -0.15;
  if (!ev.inBounds || !onReceiverSide || !beyondKitchen || !inWidth) return 'serve-fault';
  if (!diagonalOk) return 'serve-wrong-court';
  return null;
}

/* Unified floor-contact handler. ev = {inBounds, x, z, side}. This is the
 * single source of truth for every time the ball touches the ground.
 *
 * Key correctness rule: a fault for landing OUT only applies to the FIRST
 * bounce since the last paddle hit (the hitter sailed it long/wide). Once the
 * ball has legally bounced in once, any SECOND floor contact means the
 * RECEIVER failed to return it — so the hitter wins ("no-return"), regardless
 * of where that second contact lands.
 */
export function onFloor(match, ev) {
  var r = match.rally;
  if (!r || !r.live) return { point: null };
  r.bouncesSinceHit += 1;

  // Serve's first floor contact: validate the service box.
  if (r.shots === 1 && !r.serveChecked) {
    r.serveChecked = true;
    var fault = serveFault(match, ev);
    if (fault) return awardRally(match, other(match.server), fault);
    return { point: null, serveGood: true, firstBounce: true };
  }

  // Second (or later) bounce since the last hit -> receiver failed to return.
  if (r.bouncesSinceHit >= 2) {
    return awardRally(match, r.lastHitter, 'no-return');
  }

  // First bounce since a rally shot.
  if (!ev.inBounds) return awardRally(match, other(r.lastHitter), 'out-of-bounds');
  return { point: null, firstBounce: true, bounceOn: ev.side > 0 ? NEAR : FAR };
}

// Back-compat thin wrappers (used by unit tests).
export function onBounce(match, side) { return onFloor(match, { inBounds: true, x: 0, z: side > 0 ? 3 : -3, side: side }); }
export function onServeLand(match, landing) {
  return onFloor(match, { inBounds: true, x: landing.x, z: landing.z, side: landing.z > 0 ? 1 : -1 });
}

// Safety: ball wandered far away without a tracked bounce. Hitter loses.
export function onOut(match) {
  var r = match.rally;
  if (!r || !r.live) return { point: null };
  return awardRally(match, other(r.lastHitter), 'out-of-bounds');
}

// The ball hits the net and fails to cross (game decides "fail"). Hitter loses.
export function onNetFault(match) {
  var r = match.rally;
  if (!r || !r.live) return { point: null };
  return awardRally(match, other(r.lastHitter), 'into-net');
}
