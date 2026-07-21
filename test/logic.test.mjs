/* Node logic tests for the standalone pickleball pure modules.
 * Run: node pb3d/test/logic.test.mjs   (no Three.js needed)
 */
import assert from 'node:assert';
import * as Physics from '../src/physics.js';
import * as Shots from '../src/shots.js';
import * as Rules from '../src/rules.js';
import * as AI from '../src/ai.js';
import * as Movement from '../src/movement.js';
import * as Practice from '../src/practice.js';
import * as SinglesStrategy from '../src/strategies/singles.js';
import * as DoublesStrategy from '../src/strategies/doubles.js';
import { normalizeMode } from '../src/modes.js';
import { buildMusicCatalog, sanitizeMusicState } from '../src/audio.js';
import * as Power from '../src/power.js';
import { makePlayback } from '../src/replay.js';
import { CHARACTERS, getCharacter } from '../src/characters.js';
import { STABILITY, POWER_CAP, SPECIALTY, MOVEMENT, HIT, PRACTICE, SUPER } from '../src/constants.js';
import { PERSONAS, mergeTraits, normalizePersona, PERSONA_META, personaStats, STAT_LABELS } from '../src/strategies/personas.js';
import { scorePressure, situationalLob, ballDifficultyMult, aggBias, rallyLengthMult } from '../src/strategies/common.js';
import { resolveTraits } from '../src/ai.js';

const C = Physics.COURT;
let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { console.error('FAIL  ' + name + '\n      ' + e.message); process.exitCode = 1; }
}

/* ---------------------------- shots ---------------------------- */
test('zoneOf classifies court bands', () => {
  assert.equal(Shots.zoneOf(C.KITCHEN, C.KITCHEN, C.HALF_L), 'kitchen');
  assert.equal(Shots.zoneOf(C.HALF_L - 0.5, C.KITCHEN, C.HALF_L), 'deep');
  assert.equal(Shots.zoneOf(C.HALF_L * 0.55, C.KITCHEN, C.HALF_L), 'transition');
});

test('classify maps intent + zone + height to shot type', () => {
  assert.equal(Shots.classify('kitchen', 'touch', false), 'dink');
  assert.equal(Shots.classify('kitchen', 'power', true), 'speedup');
  assert.equal(Shots.classify('kitchen', 'power', false), 'drive');
  assert.equal(Shots.classify('deep', 'touch', false), 'drop');
  assert.equal(Shots.classify('deep', 'power', false), 'drive');
  assert.equal(Shots.classify('transition', 'lob', true), 'lob');
});

test('aimDepth clamps to legal landing range', () => {
  const base = Shots.specV2('drive', C.KITCHEN, C.HALF_L).landZ;
  const deep = Shots.aimDepth(base, 1, C.KITCHEN, C.HALF_L);
  const shallow = Shots.aimDepth(base, -1, C.KITCHEN, C.HALF_L);
  assert.ok(deep <= C.HALF_L * 0.92 + 1e-9, 'deep within max');
  assert.ok(shallow >= C.KITCHEN * 0.5 - 1e-9, 'shallow above min');
  assert.ok(deep > shallow, 'forward aims deeper than back');
});

/* ---------------------------- rules ---------------------------- */
test('serving team scoring increments only on serve win', () => {
  const m = Rules.makeMatch({ server: 'near' });
  Rules.startRally(m);
  Rules.onPaddleHit(m, 'near', { volley: false });      // serve
  // serve lands good in the diagonal box
  Rules.onFloor(m, { inBounds: true, x: -C.HALF_W * 0.5, z: -C.HALF_L * 0.74, side: -1 });
  // far fails to return -> second floor contact on far side
  const r = Rules.onFloor(m, { inBounds: true, x: 0, z: -3, side: -1 });
  assert.equal(r.point, 'near');
  assert.equal(m.scores.near, 1);
});

test('full game runs to 11 win-by-2 with side-outs and 0-0-2', () => {
  const m = Rules.makeMatch({ server: 'near' });
  let guard = 0;
  // Land a legal serve in the correct diagonal service box for whoever serves.
  function goodServe() {
    Rules.onPaddleHit(m, m.server, { volley: false });
    const sc = Rules.serveCourt(m);
    const serverRightX = (m.server === 'near') ? 1 : -1;
    const targetXSign = sc.fromRight ? -serverRightX : serverRightX;
    const recvSign = (Rules.other(m.server) === 'near') ? 1 : -1;
    Rules.onFloor(m, { inBounds: true, x: targetXSign * C.HALF_W * 0.5, z: recvSign * C.HALF_L * 0.74, side: recvSign });
  }
  // Make the NEAR team always win the rally.
  function nearWinsRally() {
    Rules.startRally(m);
    goodServe();
    if (m.server === 'near') {
      // near serving: far fails to return -> near scores
      return Rules.onFloor(m, { inBounds: true, x: 0, z: -3, side: -1 });
    }
    // far serving: far's third shot sails out -> near wins rally
    return Rules.onFloor(m, { inBounds: false, x: 99, z: 99, side: -1 });
  }
  while (!m.gameOver && guard++ < 500) nearWinsRally();
  assert.ok(m.gameOver, 'game ended');
  assert.equal(m.winner, 'near');
  assert.ok(m.scores.near >= 11 && (m.scores.near - m.scores.far) >= 2, 'win by 2 to 11+');
});

test('volley before the two-bounce rule is a fault', () => {
  const m = Rules.makeMatch({ server: 'near' });
  Rules.startRally(m);
  Rules.onPaddleHit(m, 'near', { volley: false });   // serve (phase -> return)
  // receiver volleys the serve (illegal): far hits before a bounce
  const r = Rules.onPaddleHit(m, 'far', { volley: true, inKitchen: false });
  assert.ok(r.point || r.sideOut || r.secondServer, 'rally awarded against the volleyer');
});

test('serving team cannot volley the return before it bounces', () => {
  const m = Rules.makeMatch({ server: 'near' });
  Rules.startRally(m);
  Rules.onPaddleHit(m, 'near', { volley: false });   // serve
  Rules.onFloor(m, { inBounds: true, x: -1, z: -4, side: -1 }); // serve bounces
  Rules.onPaddleHit(m, 'far', { volley: false, inKitchen: false }); // return
  assert.equal(Rules.isDoubleBounceVolleyLocked(m), true, 'CPU should wait for return bounce');
  const r = Rules.onPaddleHit(m, 'near', { volley: true, inKitchen: false });
  assert.equal(r.reason, 'volley-before-double-bounce');
});

test('serving team may volley after the return bounce if outside kitchen', () => {
  const m = Rules.makeMatch({ server: 'near' });
  Rules.startRally(m);
  Rules.onPaddleHit(m, 'near', { volley: false });   // serve
  Rules.onFloor(m, { inBounds: true, x: -1, z: -4, side: -1 }); // serve bounces
  Rules.onPaddleHit(m, 'far', { volley: false, inKitchen: false }); // return
  Rules.onFloor(m, { inBounds: true, x: 1, z: 4, side: 1 }); // return bounces
  assert.equal(Rules.isDoubleBounceVolleyLocked(m), false, 'CPU may volley after return bounce');
  const r = Rules.onPaddleHit(m, 'near', { volley: true, inKitchen: false });
  assert.equal(r.point, null);
  assert.equal(r.illegal, false);
  assert.equal(m.rally.doubleBounceOpen, true);
});

test('kitchen volley is a fault in open play', () => {
  const m = Rules.makeMatch({ server: 'near' });
  Rules.startRally(m);
  Rules.onPaddleHit(m, 'near', { volley: false });   // serve
  Rules.onFloor(m, { inBounds: true, x: -1, z: -4, side: -1 }); // serve bounces
  Rules.onPaddleHit(m, 'far', { volley: false });    // return (phase -> open)
  Rules.onFloor(m, { inBounds: true, x: 1, z: 4, side: 1 });    // return bounces
  const r = Rules.onPaddleHit(m, 'near', { volley: true, inKitchen: true });
  assert.equal(r.reason, 'kitchen-volley');
});

test('serve into the wrong (non-diagonal) court faults', () => {
  const m = Rules.makeMatch({ server: 'near' });   // near server slot0 = right court
  Rules.startRally(m);
  Rules.onPaddleHit(m, 'near', { volley: false });
  // near serving from right must land in far's diagonal box (far's right = -x).
  // Land it on the WRONG (+x) side to trigger serve-wrong-court.
  const r = Rules.onFloor(m, { inBounds: true, x: C.HALF_W * 0.5, z: -C.HALF_L * 0.74, side: -1 });
  assert.ok(r.reason === 'serve-wrong-court' || r.reason === 'serve-fault', 'serve fault flagged');
});

test('singles score callout uses two numbers', () => {
  const m = Rules.makeMatch({ mode: 'singles', server: 'near' });
  assert.equal(m.serverNum, 1);
  assert.equal(Rules.scoreCallout(m), '0–0');
});

test('singles serving side scores and keeps serve', () => {
  const m = Rules.makeMatch({ mode: 'singles', server: 'near' });
  Rules.startRally(m);
  Rules.onPaddleHit(m, 'near', { volley: false });
  Rules.onFloor(m, { inBounds: true, x: -C.HALF_W * 0.5, z: -C.HALF_L * 0.74, side: -1 });
  const r = Rules.onFloor(m, { inBounds: true, x: 0, z: -3, side: -1 });
  assert.equal(r.point, 'near');
  assert.equal(r.scored, true);
  assert.equal(m.scores.near, 1);
  assert.equal(m.server, 'near');
  assert.equal(m.serverNum, 1);
  assert.equal(Rules.scoreCallout(m), '1–0');
});

test('singles receiver win is immediate side out', () => {
  const m = Rules.makeMatch({ mode: 'singles', server: 'near' });
  Rules.startRally(m);
  const r = Rules.awardRally(m, 'far', 'out-of-bounds');
  assert.equal(r.sideOut, true);
  assert.equal(r.secondServer, false);
  assert.equal(m.server, 'far');
  assert.equal(m.serverNum, 1);
  assert.equal(m.serverSlot, 0);
  assert.equal(Rules.scoreCallout(m), '0–0');
});

test('singles service side follows serving score parity', () => {
  const m = Rules.makeMatch({ mode: 'singles', server: 'near' });
  assert.equal(Rules.currentServer(m).side, 'R');
  Rules.awardRally(m, 'near', 'no-return');
  assert.equal(Rules.currentServer(m).side, 'L');
  Rules.awardRally(m, 'far', 'out-of-bounds');
  assert.equal(m.server, 'far');
  assert.equal(Rules.currentServer(m).side, 'R');
});

/* ---------------------------- ai ---------------------------- */
test('AI difficulty levels are monotonic on key levers', () => {
  assert.ok(AI.LEVELS.hard.smart > AI.LEVELS.normal.smart);
  assert.ok(AI.LEVELS.normal.smart > AI.LEVELS.easy.smart);
  assert.ok(AI.LEVELS.hard.react < AI.LEVELS.easy.react);
  assert.ok(AI.LEVELS.hard.miss < AI.LEVELS.easy.miss);
});

test('AI predict returns an intercept for a live incoming ball', () => {
  const ball = Physics.makeBall();
  ball.pos = Physics.vec(0, 1.2, 2); ball.vel = Physics.vec(0, 1, -6); ball.live = true;
  const pred = AI.predict(ball);
  assert.ok(pred && typeof pred.x === 'number' && typeof pred.z === 'number');
});

test('AI chooseShot serve aims diagonally into a service box', () => {
  const ai = AI.makeAI('normal');
  const m = Rules.makeMatch({ server: 'far' });
  const ball = Physics.makeBall();
  const shot = AI.chooseShot(ai, ball, m, true, { mode: 'doubles' });
  assert.ok(shot.target.z > 0, 'far serve aims toward the near (+z) side');
  assert.equal(shot.type, 'serve');
});

test('singles passing target goes away from defender on same half', () => {
  const ai = AI.makeAI('hard');
  const m = Rules.makeMatch({ mode: 'singles', server: 'far' });
  m.rally = { shots: 4, phase: 'open' };
  const ball = Physics.makeBall();
  ball.live = true;
  ball.pos = Physics.vec(0, 1.1, -4.8);
  // Pin the RNG above the body-shot (0.14) / miss / lob rolls so the assert
  // exercises the passing-lane branch deterministically (same pattern as the
  // situationalLob test).
  const realRandom = Math.random;
  Math.random = () => 0.5;
  let shot;
  try {
    shot = AI.chooseShot(ai, ball, m, false, {
      mode: 'singles',
      hitterPos: { x: 0.2, z: -4.8 },
      opponents: { a: { pos: { x: 1.1, z: 4.6 } } }
    });
  } finally {
    Math.random = realRandom;
  }
  assert.ok(shot.target.x < 0, 'targets away from right-side defender');
});

test('singles wide-defender case targets opposite open court', () => {
  const neutral = SinglesStrategy.neutralAimTarget({ a: { pos: { x: -2.0, z: 4.8 } } });
  assert.ok(neutral.x > 0, 'neutral aim biases opposite the stretched defender');
});

test('singles return-of-serve stays deep and avoids middle body ball', () => {
  const ai = AI.makeAI('hard');
  const m = Rules.makeMatch({ mode: 'singles', server: 'near' });
  m.rally = { shots: 2, phase: 'open' };
  const ball = Physics.makeBall();
  ball.live = true;
  ball.pos = Physics.vec(0.2, 1.0, -5.2);
  // Pin the RNG above the body-shot / miss rolls (deterministic branch; same
  // pattern as the situationalLob test).
  const realRandom = Math.random;
  Math.random = () => 0.5;
  let shot;
  try {
    shot = AI.chooseShot(ai, ball, m, false, {
      mode: 'singles',
      hitterPos: { x: 0.1, z: -5.1 },
      opponents: { a: { pos: { x: 1.3, z: 4.2 } } }
    });
  } finally {
    Math.random = realRandom;
  }
  assert.ok(shot.target.z > C.HALF_L * 0.7, 'return stays deep');
  assert.ok(Math.abs(shot.target.x) > C.HALF_W * 0.45, 'return is not centered at the body');
});

test('singles super-ready AI chooses a super without referencing doubles locals', () => {
  const ai = AI.makeAI('hard');
  ai.cfg.miss = 0;
  ai.cfg.aggression = 1;
  ai.cfg.superBias = 1;
  const m = Rules.makeMatch({ mode: 'singles', server: 'near' });
  m.rally = { shots: SUPER.MIN_SHOTS, phase: 'open' };
  const ball = Physics.makeBall();
  ball.live = true;
  ball.pos = Physics.vec(0.1, SUPER.SMASH_H + 0.15, -4.8);
  const realRandom = Math.random;
  Math.random = () => 0;
  let shot;
  try {
    shot = AI.chooseShot(ai, ball, m, false, {
      mode: 'singles',
      hitterPos: { x: 0.1, z: -4.8 },
      opponents: { a: { pos: { x: 1.0, z: 4.4 } } },
      superReady: true
    });
  } finally {
    Math.random = realRandom;
  }
  assert.equal(shot.type, 'supersmash');
  assert.equal(shot.isSuper, true);
});

test('doubles neutral aim still tracks away from the deeper opponent body', () => {
  const target = DoublesStrategy.neutralAimTarget({
    a: { pos: { x: 1.0, z: 5.4 } },
    b: { pos: { x: -0.2, z: 3.2 } }
  });
  assert.ok(target.x < 1.0, 'aims away from deeper opponent body');
  assert.ok(target.z >= 5.4, 'uses deeper opponent depth');
});

test('AI dispatcher selects the correct movement strategy by mode', () => {
  const ai = AI.makeAI('normal');
  const ball = Physics.makeBall();
  ball.live = true;
  ball.pos = Physics.vec(0.8, 1.0, -1.5);
  ball.vel = Physics.vec(0, 0, 5);
  ball.flight = { landing: { x: 0.8, z: 4.5 }, T: 1, apexY: 2, samples: [], elapsed: 0.2 };
  const singles = AI.chooseMovement(ai, ball, { shots: 2, phase: 'return' }, {
    mode: 'singles',
    player: { team: 'near', pos: { x: 0, z: 5 }, move: {} },
    incoming: true,
    responsible: true,
    prediction: { x: 0.8, z: 4.5 },
    opponents: { a: { pos: { x: -1.2, z: -4.5 } } },
    isReturner: true,
    distance: () => 0.6
  });
  const doubles = AI.chooseMovement(ai, ball, { shots: 4, phase: 'open' }, {
    mode: 'doubles',
    player: { team: 'near', pos: { x: 0, z: 5 }, move: {} , ai: ai },
    lane: 1,
    incoming: true,
    responsible: true,
    prediction: { x: 0.8, z: 4.5, peakY: 2.0, tLeft: 0.8 }, // popup peak → split step
    servingTeam: 'far',
    opponents: { a: { pos: { x: -1.2, z: -4.5 } }, b: { pos: { x: 1.1, z: -3.1 } } },
    distance: () => 0.6
  });
  assert.equal(singles.kind, 'intercept');
  assert.equal(doubles.kind, 'split');
});

test('normalizeMode accepts practice as a first-class mode', () => {
  assert.equal(normalizeMode('practice'), 'practice');
  assert.equal(normalizeMode('singles'), 'singles');
  assert.equal(normalizeMode('weird'), 'doubles');
});

test('practice feed targets stay on the near side inside the tuned drill band', () => {
  const left = Practice.randomFeedTarget(() => 0);
  const right = Practice.randomFeedTarget(() => 1);
  assert.equal(left.x, -PRACTICE.TARGET_X_MAX);
  assert.equal(left.z, PRACTICE.TARGET_Z_MIN);
  assert.equal(right.x, PRACTICE.TARGET_X_MAX);
  assert.equal(right.z, PRACTICE.TARGET_Z_MAX);
});

test('practice opening feed starts deep up the middle', () => {
  const opening = Practice.openingFeedTarget();
  assert.equal(opening.x, 0);
  assert.equal(opening.z, PRACTICE.OPENING_TARGET_Z);
});

test('practice timing score prefers mid-window contact', () => {
  const perfect = Practice.scoreTiming(-0.18);
  const late = Practice.scoreTiming(0.62);
  assert.equal(perfect.grade, 'perfect');
  assert.equal(late.grade, 'late');
});

test('practice feedback prefers centered stable contact over stretched contact', () => {
  const timing = { grade: 'perfect' };
  const centered = Practice.scoreContact(0.12, 0.86, timing, 'contact');
  const stretched = Practice.scoreContact(1.2, 0.18, timing, 'contact');
  assert.equal(centered.key, 'perfect');
  assert.ok(stretched.key === 'reach' || stretched.key === 'far');
});

test('practice clean/perfect thresholds are reachable with a normal sweet-spot swing', () => {
  const perfect = Practice.scoreContact(0.42, 0.4, { grade: 'clean' }, 'contact');
  const clean = Practice.scoreContact(0.78, 0.12, { grade: 'good' }, 'contact');
  assert.equal(perfect.key, 'perfect');
  assert.equal(clean.key, 'clean');
});

test('practice live cue turns on before an ideal contact window', () => {
  assert.equal(Practice.liveCue(0.4, -0.18, 1.0), 'perfect');
  assert.equal(Practice.liveCue(0.82, -0.05, 1.0), 'perfect');
  assert.equal(Practice.liveCue(1.45, -0.18, 1.0), 'good');
  assert.equal(Practice.liveCue(1.7, -0.9, 1.0), 'none');
});

test('practice miss feedback maps swing misses to early or late buckets', () => {
  const early = Practice.scoreContact(0.3, 0, { grade: 'early' }, 'whiff');
  const late = Practice.scoreContact(0.3, 0, { grade: 'late' }, 'whiff');
  assert.equal(early.key, 'early');
  assert.equal(late.key, 'late');
});

test('makeBall includes a null flight field', () => {
  const b = Physics.makeBall();
  assert.ok('flight' in b, 'flight property present');
  assert.equal(b.flight, null);
});

/* ---------------------- stability / quality helpers -------------------- */
test('stabilityQuality returns correct tier at boundary values', () => {
  assert.equal(Shots.stabilityQuality(0.05), 'popup',
    'stability << POPUP_THRESHOLD → popup');
  assert.equal(Shots.stabilityQuality(STABILITY.POPUP_THRESHOLD + 0.01), 'float',
    'just above popup threshold → float');
  assert.equal(Shots.stabilityQuality(STABILITY.FLOAT_THRESHOLD + 0.01), 'clean',
    'above float threshold → clean');
});

/* ----------------------- power cap helpers ----------------------------- */
test('maxIntent returns touch for ball at floor, smash above SMASH_H', () => {
  assert.equal(Shots.maxIntent(0.1), 'touch',
    'floor-level ball → forced touch');
  assert.equal(Shots.maxIntent(POWER_CAP.NET_H - 0.01), 'touch',
    'just below net height → touch');
  assert.equal(Shots.maxIntent(POWER_CAP.NET_H + 0.1), 'power',
    'above net → normal power');
  assert.equal(Shots.maxIntent(POWER_CAP.SMASH_H + 0.1), 'smash',
    'high ball → smash');
});

test('swingSide picks fh/bh from ball position relative to hitter, mirrored by team', () => {
  // near team (fwd=1): ball to hitter's world +x is forehand (paddle side),
  // world -x is backhand.
  assert.equal(Shots.swingSide(0, 1, 1), 'fh', 'near: ball to the right → forehand');
  assert.equal(Shots.swingSide(0, -1, 1), 'bh', 'near: ball to the left → backhand');
  // far team (fwd=-1): mirrored — world -x is forehand, world +x is backhand.
  assert.equal(Shots.swingSide(0, -1, -1), 'fh', 'far: ball to the left → forehand');
  assert.equal(Shots.swingSide(0, 1, -1), 'bh', 'far: ball to the right → backhand');
  // dead-center ball defaults to forehand (no flicker deadzone).
  assert.equal(Shots.swingSide(2.0, 2.02, 1), 'fh', 'near dead-center → defaults forehand');
});

/* -------------------- super smash shot envelope ------------------------ */
test('supersmash is a DRIVEN shot (direct cannot clear the net from low contact)', () => {
  const sm = Shots.specV2('smash', C.KITCHEN, C.HALF_L);
  const su = Shots.specV2('supersmash', C.KITCHEN, C.HALF_L);
  assert.equal(su.driven, true, 'must be the driven (flat) family');
  assert.equal(su.direct, false, 'direct would fire into the net from a low contact');
  assert.ok(su.vMax > sm.vMax, 'higher speed ceiling than a normal smash');
  assert.ok(su.spinX > sm.spinX, 'more topspin so it skids off the bounce');
});

// The bug this guards: real contact heights median ~0.49m. A `direct` super
// from there crosses the net plane at ~0.3m — straight into a 0.86m net.
test('supersmash clears the net from realistic (low) contact heights', () => {
  const spec = Shots.specV2('supersmash', C.KITCHEN, C.HALF_L);
  for (const y of [0.45, 0.6, 0.9, 1.4, 2.2]) {
    const sol = Physics.solveArc(Physics.vec(0, y, 3.0), { x: 0, z: -spec.landZ }, spec);
    const sim = Physics.simulateFlight(Physics.vec(0, y, 3.0), sol.v0, spec.spin);
    assert.ok(sim.clearedNet, `contact ${y}m must clear the net, crossed at ${sim.netCrossY}`);
    assert.ok(Math.abs(sim.landing.z) < C.HALF_L,
      `contact ${y}m must land inbounds, landed ${sim.landing.z}`);
  }
});

test('supersmash speed scales with contact height', () => {
  const spec = Shots.specV2('supersmash', C.KITCHEN, C.HALF_L);
  const speedAt = (y) => {
    const sol = Physics.solveArc(Physics.vec(0, y, 3.0), { x: 0, z: -spec.landZ }, spec);
    return Math.hypot(sol.v0.x, sol.v0.y, sol.v0.z);
  };
  assert.ok(speedAt(2.2) > speedAt(1.2), 'a higher ball earns a faster super');
  assert.ok(speedAt(1.2) > speedAt(0.5), 'and lower contact is slower');
});

test('supersmash is NOT selectable via classify (state-triggered only)', () => {
  assert.ok(!Shots.TYPES.includes('supersmash'), 'not in the selectable list');
  assert.ok(!Shots.TYPES.includes('blastpop'), 'not in the selectable list');
});

// This is the property the whole feature rests on: for the DIRECT family the
// speed cap binds before the ball reaches the aimed depth, so vMax translates
// into launch speed ~1:1 AND the ball always lands short of target — it can
// never sail out, no matter how hard it is hit.
test('direct-family launch speed tracks vMax and never sails long', () => {
  const p0 = Physics.vec(0, 2.2, 3.0);
  const target = { x: 0, z: -C.HALF_L * 0.66 };
  for (const vMax of [22, 30, 40]) {
    const spec = Shots.specV2('smash', C.KITCHEN, C.HALF_L);
    spec.vMax = vMax;
    const sol = Physics.solveArc(p0, target, spec);
    const speed = Math.hypot(sol.v0.x, sol.v0.y, sol.v0.z);
    assert.ok(Math.abs(speed - vMax) < 0.5,
      `vMax ${vMax}: launch speed ${speed.toFixed(2)} should bind at the cap`);
    assert.ok(Math.abs(sol.landing.z) < C.HALF_L,
      `vMax ${vMax}: landed at z=${sol.landing.z.toFixed(2)}, must stay inbounds`);
    // Lands SHORT of the aimed target, never beyond it.
    assert.ok(Math.abs(sol.landing.z) <= Math.abs(target.z) + 0.01,
      `vMax ${vMax}: must not overshoot the aimed depth`);
  }
});

test('blastpop is a weak, high, short return that hangs long enough to chase', () => {
  const spec = Shots.specV2('blastpop', C.KITCHEN, C.HALF_L);
  const smash = Shots.specV2('smash', C.KITCHEN, C.HALF_L);
  assert.ok(spec.vMax < smash.vMax * 0.5, 'much slower than an attacking shot');
  assert.ok(spec.apex > 3.0, 'sits up high');
  assert.ok(spec.landZ < C.HALF_L * 0.45, 'lands short — a sitter');

  // Hang time must exceed the stun so a doubles partner can actually cover.
  const p0 = Physics.vec(0, 0.9, 3.0);
  const sol = Physics.solveArc(p0, { x: 0, z: -spec.landZ }, spec);
  assert.ok(sol.T > Power.stunTotal(),
    `blastpop hangs ${sol.T.toFixed(2)}s but stun lasts ${Power.stunTotal().toFixed(2)}s ` +
    '— the pop-up must outlast the stun or the super is a guaranteed winner');
});

/* -------------------- power meter / super smash ------------------------ */
test('chargeFor: only clean contacts charge the meter', () => {
  assert.equal(Power.chargeFor('float', 0.9), 0, 'a float gives nothing');
  assert.equal(Power.chargeFor('popup', 0.9), 0, 'a popup gives nothing');
  assert.ok(Power.chargeFor('clean', 1.0) > 0, 'a clean contact charges');
});

test('chargeFor: a better clean contact charges faster, but is bounded', () => {
  const low = Power.chargeFor('clean', STABILITY.FLOAT_THRESHOLD);
  const high = Power.chargeFor('clean', 1.0);
  assert.ok(high > low, 'higher stability charges more');
  assert.ok(Math.abs(low - SUPER.CHARGE_CLEAN) < 1e-9, 'floor is the base rate');
  assert.ok(high <= SUPER.CHARGE_CLEAN * (1 + SUPER.CHARGE_QUALITY_BONUS) + 1e-9,
    'bonus is capped');
});

test('addCharge clamps at FULL and arms exactly at FULL', () => {
  const m = Power.makeMeter();
  Power.addCharge(m, SUPER.FULL - 0.01);
  assert.equal(m.armed, false, 'not armed just below full');
  Power.addCharge(m, 0.01);
  assert.equal(m.armed, true, 'armed at full');
  Power.addCharge(m, 5);
  assert.equal(m.charge, SUPER.FULL, 'charge clamps at FULL');
});

test('canUnleash enforces every gate', () => {
  const armed = Power.addCharge(Power.makeMeter(), SUPER.FULL);
  const ok = { shots: SUPER.MIN_SHOTS, phase: 'open', volley: false, inKitchen: false };
  const high = SUPER.SMASH_H + 0.2;
  assert.equal(Power.canUnleash(armed, high, ok), true, 'baseline: allowed');

  assert.equal(Power.canUnleash(Power.makeMeter(), high, ok), false, 'not armed');
  assert.equal(Power.canUnleash(armed, SUPER.SMASH_H - 0.01, ok), false, 'ball too low');
  assert.equal(Power.canUnleash(armed, high, { ...ok, shots: SUPER.MIN_SHOTS - 1 }), false,
    'too early in the rally');
  assert.equal(Power.canUnleash(armed, high, { ...ok, phase: 'serve' }), false,
    'not in the open phase');
  assert.equal(Power.canUnleash(armed, high, { ...ok, volley: true, inKitchen: true }), false,
    'kitchen volley is refused, not exempted');
  assert.equal(Power.canUnleash(armed, high, { ...ok, volley: true, inKitchen: false }), true,
    'a volley outside the kitchen is fine');
});

test('a blocked super leaves the meter unspent', () => {
  const m = Power.addCharge(Power.makeMeter(), SUPER.FULL);
  const blocked = { shots: SUPER.MIN_SHOTS, phase: 'open', volley: true, inKitchen: true };
  assert.equal(Power.canUnleash(m, SUPER.SMASH_H + 0.2, blocked), false);
  assert.equal(m.charge, SUPER.FULL, 'charge untouched');
  assert.equal(m.armed, true, 'still armed for the next chance');
});

test('spend clears armed and drains the meter', () => {
  const m = Power.addCharge(Power.makeMeter(), SUPER.FULL);
  Power.spend(m);
  assert.equal(m.armed, false);
  assert.ok(Math.abs(m.charge - (SUPER.FULL - SUPER.COST)) < 1e-9);
});

test('carryPoint applies the configured between-point carry', () => {
  const m = Power.addCharge(Power.makeMeter(), SUPER.FULL);
  Power.carryPoint(m);
  assert.ok(Math.abs(m.charge - SUPER.FULL * SUPER.POINT_CARRY) < 1e-9,
    'charge scaled by POINT_CARRY');
  // Armed state must stay consistent with the charge after carrying.
  assert.equal(m.armed, m.charge >= SUPER.FULL,
    'armed iff still full after the carry');
});

// The meter is only meaningful if it can actually FILL at the real clean-contact
// rate. Measured in AI-vs-AI doubles: ~0.2 clean contacts per player per point,
// ~20 points per game. Guard against a future tuning change silently making the
// bar unreachable (which a 0.6 POINT_CARRY did during development).
test('meter is reachable at the measured clean-contact rate', () => {
  const CLEAN_PER_POINT = 0.2;   // measured
  const POINTS_PER_GAME = 20;    // 11 win-by-2
  const m = Power.makeMeter();
  for (let pt = 0; pt < POINTS_PER_GAME; pt++) {
    // Fractional contacts accumulate as an expected value.
    Power.addCharge(m, Power.chargeFor('clean', 0.8) * CLEAN_PER_POINT);
    Power.carryPoint(m);
  }
  assert.ok(m.armed,
    `meter must be reachable within a game; reached ${m.charge.toFixed(2)} of ${SUPER.FULL}`);
});

test('tickStun sequences blown -> down -> up -> none with exact total', () => {
  const s = Power.applyBlast(Power.makeStun(), { x: 0, z: 1 });
  assert.equal(s.phase, 'blown');
  const seen = [];
  let elapsed = 0;
  const dt = 1 / 120;
  for (let i = 0; i < 1000 && s.phase !== 'none'; i++) {
    if (seen[seen.length - 1] !== s.phase) seen.push(s.phase);
    Power.tickStun(s, dt);
    elapsed += dt;
  }
  assert.deepEqual(seen, ['blown', 'down', 'up'], 'phases in order');
  assert.equal(s.phase, 'none', 'recovers');
  assert.ok(Math.abs(elapsed - Power.stunTotal()) < 0.02,
    'total stun matches summed phase durations');
});

test('tickStun carries overflow so a coarse dt does not lose time', () => {
  const s = Power.applyBlast(Power.makeStun(), { x: 0, z: 1 });
  // One huge step should skip straight through to recovery, not stall a phase.
  Power.tickStun(s, Power.stunTotal() + 0.5);
  assert.equal(s.phase, 'none');
});

test('stun blocks input for its whole duration and slides only while blown', () => {
  const s = Power.applyBlast(Power.makeStun(), { x: 0, z: 1 });
  assert.equal(Power.stunBlocksInput(s), true, 'blocked while blown');
  assert.ok(Power.stunSlideSpeed(s) > 0, 'slides while blown');
  Power.tickStun(s, SUPER.STUN.BLOWN + 0.001);
  assert.equal(s.phase, 'down');
  assert.equal(Power.stunSlideSpeed(s), 0, 'no slide once down');
  assert.equal(Power.stunBlocksInput(s), true, 'still blocked while down');
  Power.tickStun(s, SUPER.STUN.DOWN + SUPER.STUN.UP + 0.01);
  assert.equal(Power.stunBlocksInput(s), false, 'free once recovered');
});

test('blastDirection points attacker -> victim and is unit length', () => {
  const d = Power.blastDirection(0, -3, 0, 3);
  assert.ok(Math.abs(d.z - 1) < 1e-9 && Math.abs(d.x) < 1e-9, 'straight down +z');
  const d2 = Power.blastDirection(0, 0, 3, 4);
  assert.ok(Math.abs(Math.hypot(d2.x, d2.z) - 1) < 1e-9, 'unit length');
  const d3 = Power.blastDirection(1, 1, 1, 1);
  assert.ok(Math.abs(Math.hypot(d3.x, d3.z) - 1) < 1e-9, 'degenerate case still unit');
});

test('classifyVisual: stun overrides everything including high speed', () => {
  const fast = { side: 0, forward: -5 };
  assert.equal(Movement.classifyVisual(fast, 5.0, false, 'stun'), 'stun',
    'stun wins over run/backpedal');
  assert.equal(Movement.classifyVisual(fast, 5.0, false, 'lunge'), 'lunge',
    'other overrides still work');
});

test('character roster: every character has an explicit boy/girl voice', () => {
  assert.equal(CHARACTERS.length, 12, 'roster size');
  for (const c of CHARACTERS) {
    assert.ok(c.voice === 'boy' || c.voice === 'girl',
      `${c.label} (${c.id}) must have an explicit voice, got ${JSON.stringify(c.voice)}`);
    assert.ok(SUPER.VOICE_BASE[c.voice] > 0, `${c.voice} needs a base pitch`);
  }
  // Canaries: these two are exactly the cases name-based inference gets wrong.
  assert.equal(getCharacter('ch03').voice, 'girl', 'Leo is a girl');
  assert.equal(getCharacter('ch09').voice, 'girl', 'Max is a girl');
});

/* ------------------------- replay passthrough --------------------------- */
// makePlayback.sample() REBUILDS the frame by interpolation rather than passing
// it through, so any field added to Game._captureFrame that isn't listed there
// is silently dropped and reads as undefined downstream. That bug shipped once:
// the super-smash glow and the knockdown pose were captured correctly but never
// survived into replay, so the highlight of the match replayed as a plain ball
// and a standing victim. This guards the discrete fields.
test('replay sample() carries discrete ball + player state, not just positions', () => {
  const mkFrame = (hot, phase) => ({
    ball: { pos: { x: 0, y: 1, z: 0 }, vel: { x: 0, y: 0, z: -5 },
            spin: { x: 0, y: 0, z: 0 }, live: true, superHot: hot },
    players: [{ pos: { x: 0, z: 3 }, vel: { x: 0, z: 0 }, move: { kind: 'ready' },
                power: 0.75, armed: true, stun: { phase, t: 0.1, dur: 0.3, dirX: 0, dirZ: 1 } }],
    hud: { scores: { near: 0, far: 0 }, server: 'near', serverNum: 2 }
  });
  const win = { frames: [{ t: 0, frame: mkFrame(true, 'blown') },
                         { t: 0.5, frame: mkFrame(true, 'blown') }], duration: 0.5 };
  const pb = makePlayback(win, 1);
  pb.seek(0.25);
  const f = pb.sample();
  assert.equal(f.ball.superHot, true, 'ball superHot must survive sampling');
  assert.equal(f.players[0].power, 0.75, 'meter charge must survive sampling');
  assert.equal(f.players[0].armed, true, 'armed flag must survive sampling');
  assert.ok(f.players[0].stun, 'stun state must survive sampling');
  assert.equal(f.players[0].stun.phase, 'blown', 'stun phase must survive sampling');
  // Positions are still interpolated as before.
  assert.ok(f.ball.pos && typeof f.ball.pos.x === 'number', 'positions still interpolate');
});

test('replay consumeEvents carries one-shot power-shot effects with swings', () => {
  const frame = {
    ball: { pos: { x: 0, y: 1, z: 0 }, vel: { x: 0, y: 0, z: -5 },
            spin: { x: 0, y: 0, z: 0 }, live: true, superHot: true },
    players: [{ pos: { x: 0, z: 3 }, vel: { x: 0, z: 0 }, move: { kind: 'ready' },
                power: 0, armed: false, stun: { phase: 'none', t: 0, dur: 0, dirX: 0, dirZ: 0 } }],
    hud: { scores: { near: 0, far: 0 }, server: 'near', serverNum: 2 },
    swings: [{ player: 0, type: 'smash' }],
    effects: [{ type: 'blast', player: 0 }]
  };
  const win = { frames: [
    { t: 0, frame: Object.assign({}, frame, { swings: null, effects: null }) },
    { t: 0.1, frame },
    { t: 0.2, frame: Object.assign({}, frame, { swings: null, effects: null }) }
  ], duration: 0.2 };
  const pb = makePlayback(win, 1);
  pb.play();
  pb.advance(0.11);
  const ev = pb.consumeEvents();
  assert.deepEqual(ev.swings, [{ player: 0, type: 'smash' }], 'swing event survives');
  assert.deepEqual(ev.effects, [{ type: 'blast', player: 0 }], 'blast effect event survives');
  const again = pb.consumeEvents();
  assert.equal(again.swings.length, 0, 'swing event is one-shot');
  assert.equal(again.effects.length, 0, 'effect event is one-shot');
});

/* ----------------------- AI poach helpers ------------------------------ */
test('checkPoach returns false for easy difficulty', () => {
  const ai = AI.makeAI('easy');
  const path = { P0: Physics.vec(0, 0.8, -5), P1: Physics.vec(0, 2.0, 0), P2: Physics.vec(0, 0, 5) };
  assert.equal(AI.checkPoach(ai, path, { x: 0, z: 2 }), false);
});

// NOTE: these two previously passed a v1 {P0,P1,P2} bezier path, which
// checkPoach stopped reading when v2 landed — they were exercising a dead code
// path and asserting the wrong thing. Rewritten against the real v2 API.
test('checkPoach returns true for Pro when partner is directly in path', () => {
  const ai = AI.makeAI('hard');
  const samples = [{ x: 0, z: -4, t: 0 }, { x: 0, z: 0, t: 0.3 }, { x: 0, z: 2, t: 0.5 }];
  assert.equal(AI.checkPoach(ai, { samples, landing: { x: 0, z: 4 } }, { x: 0, z: 2 }), true);
});

test('checkPoach returns false for Pro when partner is far from path', () => {
  const ai = AI.makeAI('hard');
  const samples = [{ x: 0, z: -4, t: 0 }, { x: 0, z: 0, t: 0.3 }, { x: 0, z: 2, t: 0.5 }];
  assert.equal(AI.checkPoach(ai, { samples, landing: { x: 0, z: 4 } }, { x: C.HALF_W, z: 2 }), false);
});

test('checkPoach rejects a ball that is close but arrives too fast to reach', () => {
  const ai = AI.makeAI('hard');
  const partner = { x: 0, z: 2 };
  // 1.8m away — inside the 1.9m Pro reach sphere, so the old purely geometric
  // check accepted it regardless of pace.
  const near = (t) => ({ samples: [{ x: 1.8, z: 2, t }], landing: { x: 1.8, z: 2 } });
  // Arriving in 0.02s: unreachable (needs 1.8m of travel in ~0.11s).
  assert.equal(AI.checkPoach(ai, near(0.02), partner), false);
  // Same geometry, but a floating ball that takes 1s to get there: reachable.
  assert.equal(AI.checkPoach(ai, near(1.0), partner), true);
});

test('simulateFlight samples carry monotonically increasing flight time', () => {
  const r = Physics.simulateFlight(
    Physics.vec(0, 1.0, 4), Physics.vec(0, 3.0, -9), Physics.vec(0, 0, 0));
  assert.ok(r.samples.length > 2, 'expected multiple samples');
  assert.equal(r.samples[0].t, 0, 'first sample is at t=0');
  for (let i = 1; i < r.samples.length; i++) {
    assert.ok(r.samples[i].t > r.samples[i - 1].t, 'sample time must increase');
  }
  assert.ok(Math.abs(r.samples[r.samples.length - 1].t - r.T) < 0.05,
    'last sample time should match total flight time');
});

test('checkPoach (v2) accepts flight samples for the Pro physical check', () => {
  const ai = AI.makeAI('hard');
  const samples = [{ x: 0, z: -4 }, { x: 0, z: 0 }, { x: 0, z: 2 }, { x: 0, z: 4 }];
  assert.equal(AI.checkPoach(ai, { samples, landing: { x: 0, z: 4 } }, { x: 0, z: 2 }), true);
  assert.equal(AI.checkPoach(ai, { samples, landing: { x: 0, z: 4 } }, { x: C.HALF_W, z: 2 }), false);
});

/* -------------------- AI predict flight fast-path --------------------- */
test('AI predict uses cached flight landing when ball.flight is set', () => {
  const ball = Physics.makeBall();
  ball.live = true;
  ball.flight = {
    landing: { x: 1.5, z: -4.2 },
    T: 1.0, apexY: 2, samples: [], elapsed: 0.3
  };
  const pred = AI.predict(ball);
  assert.ok(Math.abs(pred.x - 1.5) < 1e-9 && Math.abs(pred.z - -4.2) < 1e-9,
    'predict returns the cached landing when flight is active');
});

/* ------------------------- movement helpers ---------------------------- */
test('movement drive accelerates toward analog input without exceeding max speed', () => {
  const pos = { x: 0, z: 0 };
  const vel = { x: 0, z: 0 };
  Movement.drive(pos, vel, { x: 1, z: 0 }, HIT.HUMAN_SPEED, 1 / 60, {
    accel: MOVEMENT.HUMAN_ACCEL,
    decel: MOVEMENT.HUMAN_DECEL,
    deadzone: MOVEMENT.DEADZONE
  });
  assert.ok(vel.x > 0, 'accelerated laterally');
  assert.ok(Math.hypot(vel.x, vel.z) <= HIT.HUMAN_SPEED + 1e-9, 'within max speed');
});

test('movement seek brakes as it reaches the target', () => {
  const pos = { x: 0, z: 0 };
  const vel = { x: 0, z: 0 };
  const far = Movement.seek(pos, vel, { x: 4, z: 0 }, 5, 1 / 60, {
    accel: 100,
    decel: 100,
    arrive: 1,
    stop: 0.01
  });
  assert.ok(far.desiredSpeed > 4.9, 'far target requests full speed');
  pos.x = 0.8; vel.x = 0; vel.z = 0;
  const near = Movement.seek(pos, vel, { x: 1, z: 0 }, 5, 1 / 60, {
    accel: 100,
    decel: 100,
    arrive: 1,
    stop: 0.01
  });
  assert.ok(near.desiredSpeed < far.desiredSpeed, 'near target requests a slower arrival speed');
});

test('movement visual classifier distinguishes shuffle and backpedal', () => {
  assert.equal(Movement.classifyVisual({ side: 3, forward: 0.5 }, 3.04, true), 'shuffle');
  assert.equal(Movement.classifyVisual({ side: 0.2, forward: -2 }, 2.01, true), 'backpedal');
  assert.equal(Movement.classifyVisual({ side: 0, forward: 0 }, 0, true), 'ready');
});

/* ---------------------------- audio helpers ---------------------------- */
test('music catalog groups tracks by genre', () => {
  const catalog = buildMusicCatalog([
    { key: 'a', genre: 'pop', genreLabel: 'POP', label: 'A', file: 'a.wav' },
    { key: 'b', genre: 'pop', genreLabel: 'POP', label: 'B', file: 'b.wav' },
    { key: 'c', genre: 'rap', genreLabel: 'RAP', label: 'C', file: 'c.wav' }
  ]);
  assert.equal(catalog.length, 2);
  assert.equal(catalog[0].tracks.length, 2);
  assert.equal(catalog[1].label, 'RAP');
});

test('music state sanitization clamps volume and falls back to the first valid track', () => {
  const catalog = buildMusicCatalog([
    { key: 'a', genre: 'kpop', genreLabel: 'KPOP', label: 'A', file: 'a.wav' },
    { key: 'b', genre: 'pop', genreLabel: 'POP', label: 'B', file: 'b.wav' }
  ]);
  const state = sanitizeMusicState({ genreKey: 'missing', trackKey: 'unknown', volume: 2, muted: true }, catalog);
  assert.equal(state.genreKey, 'kpop');
  assert.equal(state.trackKey, 'a');
  assert.equal(state.volume, 1);
  assert.equal(state.muted, true);
});

/* ---------------------------- AI traits & personas ---------------------------- */
test('difficulty configs use the split trait vector and FAMILY is a real beginner', () => {
  // shotIQ + aggression replace the old overloaded `smart`; smart kept as alias.
  ['family', 'easy', 'normal', 'hard'].forEach((lvl) => {
    const c = AI.LEVELS[lvl];
    assert.equal(c.smart, c.shotIQ, lvl + ' keeps smart alias == shotIQ');
    assert.ok(typeof c.aggression === 'number', lvl + ' has aggression');
    assert.ok(typeof c.reactJitter === 'number', lvl + ' has reactJitter');
  });
  // FAMILY is no longer a byte-identical clone of NORMAL.
  assert.ok(AI.LEVELS.family.shotIQ < AI.LEVELS.normal.shotIQ, 'family less skilled than normal');
  assert.ok(AI.LEVELS.family.speed < AI.LEVELS.normal.speed, 'family slower than normal');
});

test('mergeTraits: balanced is the identity persona; styles separate risk from skill', () => {
  const base = AI.LEVELS.normal;
  const all = mergeTraits(base, PERSONAS.balanced);
  assert.equal(all.aggression, base.aggression, 'balanced preserves aggression');
  assert.equal(all.shotIQ, base.shotIQ, 'balanced preserves shotIQ');
  assert.equal(all.smart, all.shotIQ, 'smart alias preserved');
  assert.equal(all.dropBias, 1, 'neutral biases default to 1');
  assert.ok(aggBias(all) === 0, 'balanced aggBias is exactly 0 (baseline neutral)');

  const banger = mergeTraits(base, PERSONAS.banger);
  const defensive = mergeTraits(base, PERSONAS.defensive);
  assert.ok(banger.aggression > defensive.aggression, 'banger more aggressive than defensive');
  assert.ok(banger.dropBias < defensive.dropBias, 'banger drops far less than defensive');
  assert.ok(aggBias(banger) > 0 && aggBias(defensive) < 0, 'aggBias signs split by style');
  assert.equal(normalizePersona('nope'), 'balanced', 'unknown style falls back to balanced');
  assert.equal(normalizePersona('grinder'), 'defensive', 'legacy grinder folds onto defensive');
  assert.equal(normalizePersona('retriever'), 'defensive', 'legacy retriever folds onto defensive');
});

test('aggression is actually consumed: banger drives the 3rd shot far more than the defensive', () => {
  function thirdShotDriveRate(persona) {
    const ai = AI.makeAI('normal', persona);
    ai.cfg.miss = 0; // isolate shot selection from the unforced-error branch
    const match = { rally: { shots: 3 }, scores: { near: 0, far: 0 }, pointTo: 11 };
    const ball = { pos: { x: 0, y: 1.0, z: 4.0 }, vel: { x: 0, y: 0, z: 0 } };
    const ctx = {
      mode: 'doubles', hitterPos: { x: 0, z: 4 }, hitterTeam: 'far', contactQuality: 1,
      opponents: { a: { pos: { x: 1, z: 3 } }, b: { pos: { x: -1, z: 3 } } }
    };
    let drives = 0, N = 500;
    for (let i = 0; i < N; i++) {
      if (DoublesStrategy.chooseShot(ai, ball, match, false, ctx).type === 'drive') drives++;
    }
    return drives / N;
  }
  const banger = thirdShotDriveRate('banger');
  const defensive = thirdShotDriveRate('defensive');
  assert.ok(banger > defensive + 0.25, 'banger drive-rate (' + banger.toFixed(2) +
    ') clearly exceeds defensive (' + defensive.toFixed(2) + ')');
});

test('scorePressure tightens risk on a late lead and loosens it when behind late', () => {
  const neutral = scorePressure({ scores: { near: 3, far: 2 }, pointTo: 11 }, 'near');
  assert.equal(neutral.aggMul, 1, 'mid-game is neutral');
  const lead = scorePressure({ scores: { near: 10, far: 5 }, pointTo: 11 }, 'near');
  assert.ok(lead.aggMul < 1 && lead.missMul < 1, 'protect a late lead: play tighter');
  const behind = scorePressure({ scores: { near: 5, far: 10 }, pointTo: 11 }, 'near');
  assert.ok(behind.aggMul > 1, 'behind late: gamble');
});

test('situationalLob fires when opponents are jammed at the kitchen, not from open play', () => {
  const cfg = AI.makeAI('normal', 'defensive').cfg;
  const lowBall = { pos: { x: 0, y: 0.8, z: 4 } };
  const jammed = { a: { pos: { x: 0.5, z: 1.5 } }, b: { pos: { x: -0.5, z: 1.8 } } };
  const open = { a: { pos: { x: 0.5, z: 4 } }, b: { pos: { x: -0.5, z: 4 } } };
  const realRandom = Math.random;
  Math.random = () => 0.3; // between the open-play rate and the jammed rate
  try {
    assert.ok(situationalLob(jammed, lowBall, cfg), 'lobs over a jammed kitchen');
    assert.ok(!situationalLob(open, lowBall, cfg), 'does not lob from open play');
  } finally {
    Math.random = realRandom;
  }
});

test('rallyLengthMult is neutral early and ramps (capped) for long rallies', () => {
  assert.equal(rallyLengthMult(0), 1, 'no pressure at rally start');
  assert.equal(rallyLengthMult(8), 1, 'still neutral through the threshold');
  assert.ok(rallyLengthMult(30) > rallyLengthMult(15), 'monotonic ramp past the threshold');
  assert.ok(rallyLengthMult(1000) <= 5.0, 'capped');
});

test('ballDifficultyMult scales unforced errors by contact quality', () => {
  assert.ok(ballDifficultyMult(1) < 1, 'a clean sitter lowers the miss chance');
  assert.ok(ballDifficultyMult(0) > 1, 'a stretched, hard ball raises it');
  assert.equal(ballDifficultyMult(null), 1, 'unknown quality is neutral');
});

test('persona presentation: every persona has meta, and stat bars reflect tier x style', () => {
  Object.keys(PERSONAS).forEach((p) => {
    assert.ok(PERSONA_META[p] && PERSONA_META[p].tag && PERSONA_META[p].blurb, p + ' has display meta');
  });
  // resolveTraits + personaStats produce in-range bars that track the axes.
  assert.equal(Object.keys(PERSONAS).length, 3, 'exactly three play styles');
  const proBanger = personaStats(resolveTraits('5.0', 'banger'));
  const beginnerDefensive = personaStats(resolveTraits('4.0', 'defensive'));
  STAT_LABELS.forEach((k) => {
    assert.ok(proBanger[k] >= 0 && proBanger[k] <= 1, k + ' bar in range');
  });
  assert.ok(proBanger.Power > beginnerDefensive.Power, 'banger shows more Power than a defensive');
  assert.ok(proBanger.Speed > beginnerDefensive.Speed, 'a Pro is faster than a 4.0');
  assert.ok(personaStats(resolveTraits('5.0', 'defensive')).Touch >
    personaStats(resolveTraits('5.0', 'banger')).Touch, 'defensive shows more Touch than a banger');
});

/* ======================= mechanics v2: physics core ======================= */
import { PHYS_V2, TIMING_V2 } from '../src/constants.js';

test('v2 free-fall converges to terminal velocity √(g/DRAG_K)', () => {
  const term = Math.sqrt(PHYS_V2.GRAVITY / PHYS_V2.DRAG_K);
  const ball = Physics.makeBall();
  ball.pos = Physics.vec(0, 2000, 0); ball.vel = Physics.vec(0, 0, 0); ball.live = true;
  for (let i = 0; i < 2400 && ball.pos.y > 100; i++) Physics.stepV2(ball, 1 / 120); // ~20s, stays airborne
  const vy = Math.abs(ball.vel.y);
  assert.ok(Math.abs(vy - term) / term < 0.05,
    'terminal vy (' + vy.toFixed(2) + ') within 5% of √(g/k) (' + term.toFixed(2) + ')');
});

test('v2 drag is quadratic: deceleration at 2v ≈ 4× at v', () => {
  const a1 = Physics.accelV2({ x: 5, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
  const a2 = Physics.accelV2({ x: 10, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
  assert.ok(Math.abs((-a2.x) / (-a1.x) - 4) < 0.05, 'quadratic drag scaling (~4×)');
});

test('v2 solveArc converges + clears the net across the shot envelope grid', () => {
  const spin = { x: 3, y: 0, z: 0 };
  const contacts = [
    { x: 0, y: 0.5, z: C.HALF_L * 0.9 },   // deep low (baseline drive)
    { x: 1.5, y: 0.9, z: C.HALF_L * 0.6 }, // transition
    { x: 0, y: 0.4, z: C.KITCHEN + 0.3 },  // kitchen low (dink)
    { x: -1, y: 1.7, z: C.KITCHEN + 0.1 }  // high (smash-ish)
  ];
  contacts.forEach((p0, i) => {
    const target = { x: -p0.x * 0.5, z: -C.HALF_L * 0.6 };
    const sol = Physics.solveArc(p0, target, { apex: Math.max(1.1, p0.y + 0.5), margin: 0.2, spin, vMax: 20 });
    assert.ok(sol.ok, 'contact ' + i + ' solves (ok)');
    assert.ok(sol.landing && Math.hypot(sol.landing.x - target.x, sol.landing.z - target.z) < 0.3,
      'contact ' + i + ' lands within 0.3m of target');
    assert.ok(sol.T > 0.2 && sol.T < 3.5, 'contact ' + i + ' flight time plausible');
  });
});

test('v2 solveArc also solves for the far team direction (+z target)', () => {
  const p0 = { x: 0, y: 0.6, z: -C.HALF_L * 0.85 };
  const target = { x: 0.5, z: C.HALF_L * 0.6 };
  const sol = Physics.solveArc(p0, target, { apex: 1.2, margin: 0.2, spin: { x: -3, y: 0, z: 0 }, vMax: 20 });
  assert.ok(sol.ok, 'far-side shot solves');
  assert.ok(Math.hypot(sol.landing.x - target.x, sol.landing.z - target.z) < 0.3, 'far-side lands near target');
});

test('v2 spin-aware bounce: topspin skids faster than backspin', () => {
  function bounceVz(spinX) {
    const ball = Physics.makeBall();
    ball.pos = Physics.vec(0, 0.05, -3); ball.vel = Physics.vec(0, -3, -6); ball.spin = Physics.vec(spinX, 0, 0); ball.live = true;
    for (let i = 0; i < 40; i++) {
      const ev = Physics.stepV2(ball, 1 / 240).find(e => e.type === 'bounce' || e.type === 'floor-out');
      if (ev) return Math.abs(ball.vel.z);
    }
    return null;
  }
  // Ball travels -z. In the absolute physics frame, topspin (rolls forward, Magnus
  // dips it) is spin.x < 0 for a -z shot; backspin is spin.x > 0. (The game flips
  // spin by -fwd before it reaches physics, so this frame is already absolute.)
  const top = bounceVz(-6), flat = bounceVz(0), back = bounceVz(6);
  assert.ok(top !== null && flat !== null && back !== null, 'all bounced');
  assert.ok(top > flat && flat > back, 'topspin skids fastest, backspin checks up (' +
    top.toFixed(2) + ' > ' + flat.toFixed(2) + ' > ' + back.toFixed(2) + ')');
});

test('v2 sidespin kicks the bounce laterally with correct sign', () => {
  function bounceVx(spinY) {
    const ball = Physics.makeBall();
    ball.pos = Physics.vec(0, 0.05, -3); ball.vel = Physics.vec(0, -3, -6); ball.spin = Physics.vec(0, spinY, 0); ball.live = true;
    for (let i = 0; i < 40; i++) {
      const ev = Physics.stepV2(ball, 1 / 240).find(e => e.type === 'bounce' || e.type === 'floor-out');
      if (ev) return ball.vel.x;
    }
    return null;
  }
  assert.ok(bounceVx(5) > bounceVx(0), 'positive sidespin kicks +x');
  assert.ok(bounceVx(-5) < bounceVx(0), 'negative sidespin kicks -x');
});

test('v2 Magnus in flight: topspin lands shorter than no-spin', () => {
  const p0 = { x: 0, y: 0.8, z: 5 };
  const v0 = { x: 0, y: 5, z: -12 };
  const flat = Physics.simulateFlight(p0, v0, { x: 0, y: 0, z: 0 });
  const top = Physics.simulateFlight(p0, v0, { x: -6, y: 0, z: 0 }); // topspin (-x for a -z shot) dips it
  assert.ok(Math.abs(top.landing.z) < Math.abs(flat.landing.z),
    'topspin dips the ball shorter (' + top.landing.z.toFixed(2) + ' vs ' + flat.landing.z.toFixed(2) + ')');
});

/* ======================= mechanics v2: shot grammar ======================= */
test('specV2 returns physical envelopes with the inlined shots present', () => {
  ['drive', 'drop', 'dink', 'lob', 'speedup', 'serve', 'smash', 'erne', 'atp', 'feed'].forEach((t) => {
    const sp = Shots.specV2(t, C.KITCHEN, C.HALF_L);
    assert.ok(sp && typeof sp.landZ === 'number' && sp.spin && typeof sp.vMax === 'number', t + ' has a full envelope');
  });
  const drop = Shots.specV2('drop', C.KITCHEN, C.HALF_L);
  assert.ok(Math.abs(drop.landZ - C.KITCHEN * 0.55) < 1e-9, 'drop still dies in the kitchen');
  assert.ok(Shots.specV2('smash', C.KITCHEN, C.HALF_L).direct, 'smash is a direct shot');
  assert.ok(Shots.specV2('atp', C.KITCHEN, C.HALF_L).allowNet, 'atp bypasses net raising');
});

test('resolveV2 maps intent+zone+height to a type with an envelope', () => {
  const r = Shots.resolveV2(C.HALF_L * 0.8, 0.7, 'touch', C.KITCHEN, C.HALF_L);
  assert.equal(r.type, 'drop');
  assert.ok(r.sp.vMax <= 12, 'a drop is a slow shot');
});

test('v2 clean drop bounces below net height; a popup-quality drop sits up', () => {
  // Solve a clean drop from the baseline, then sim it through the bounce and
  // measure the apex of the FIRST bounce. Clean must stay below the net (0.86);
  // a popup-quality drop (apex ×2.6) must rise into the attack zone.
  const p0 = { x: 0, y: 0.6, z: C.HALF_L * 0.82 };
  function bouncePeak(apexHint) {
    const sp = Shots.specV2('drop', C.KITCHEN, C.HALF_L);
    const target = { x: 0, z: -sp.landZ };
    const sol = Physics.solveArc(p0, target, { apex: apexHint, margin: sp.margin, spin: sp.spin, vMax: sp.vMax });
    const ball = Physics.makeBall();
    ball.pos = { x: p0.x, y: p0.y, z: p0.z };
    ball.vel = { x: sol.v0.x, y: sol.v0.y, z: sol.v0.z };
    ball.spin = { x: sp.spin.x, y: sp.spin.y, z: 0 };
    ball.live = true;
    let bounced = false, peak = 0;
    for (let i = 0; i < 1200; i++) {
      const evs = Physics.stepV2(ball, 1 / 240);
      if (!bounced && evs.some(e => e.type === 'bounce' || e.type === 'floor-out')) bounced = true;
      else if (bounced) { peak = Math.max(peak, ball.pos.y); if (ball.pos.y <= C.BALL_R + 1e-3 && ball.vel.y < 0) break; }
    }
    return peak;
  }
  const dropApex = Shots.specV2('drop', C.KITCHEN, C.HALF_L).apex;
  const clean = bouncePeak(dropApex);
  const popup = bouncePeak(Shots.apexForQualityV2(dropApex, 'popup'));
  assert.ok(clean < POWER_CAP.NET_H, 'clean drop bounce peak (' + clean.toFixed(2) + ') below net');
  assert.ok(popup > clean, 'popup drop (' + popup.toFixed(2) + ') sits up higher than clean (' + clean.toFixed(2) + ')');
});

test('v2 mishits sit up but are NEVER lobs (additive, capped)', () => {
  const lobApex = Shots.specV2('lob', C.KITCHEN, C.HALF_L).apex;
  ['drive', 'drop', 'dink', 'speedup'].forEach((t) => {
    const base = Shots.specV2(t, C.KITCHEN, C.HALF_L).apex;
    const flt = Shots.apexForQualityV2(base, 'float');
    const pop = Shots.apexForQualityV2(base, 'popup');
    assert.ok(base < flt && flt < pop, t + ': clean < float < popup');
    assert.ok(pop <= lobApex - 1.0, t + ' popup (' + pop.toFixed(2) + ') stays well below a deliberate lob (' + lobApex + ')');
  });
  const dropPop = Shots.apexForQualityV2(Shots.specV2('drop', C.KITCHEN, C.HALF_L).apex, 'popup');
  assert.ok(dropPop >= 2.0, 'popped drop (' + dropPop.toFixed(2) + ') still reads as attackable to the CPU popup-hold (>= 2.0)');
});

test('v2 driven family: power shots fly flat and fast, hit DOWN from high contact', () => {
  const spin = { x: -5, y: 0, z: 0 }; // topspin for a -z shot
  // High-volley drive: must not balloon — apex stays near contact height.
  const hv = Physics.solveArc({ x: 0, y: 1.3, z: 3.0 }, { x: 0, z: -C.HALF_L * 0.8 },
    { apex: 1.15, margin: 0.18, spin, vMax: 19, driven: true });
  assert.ok(hv.ok, 'high-volley drive solves');
  assert.ok(hv.apexY <= 1.3 + 0.15, 'high-volley drive stays flat (apex ' + hv.apexY.toFixed(2) + ')');
  assert.ok(Math.hypot(hv.v0.x, hv.v0.y, hv.v0.z) >= 13, 'high-volley drive has pace');
  // Speedup from the kitchen: fast and short-hop, not a hanging arc.
  const su = Physics.solveArc({ x: 0, y: 1.1, z: 2.3 }, { x: 0, z: -C.HALF_L * 0.55 },
    { apex: 1.05, margin: 0.12, spin: { x: -5.5, y: 0, z: 0 }, vMax: 17, driven: true });
  assert.ok(su.ok && Math.hypot(su.v0.x, su.v0.y, su.v0.z) >= 11, 'speedup has pace');
  assert.ok(su.T <= 0.65, 'speedup arrives fast (T ' + su.T.toFixed(2) + ')');
  // Low contact still clears with an upward launch.
  const low = Physics.solveArc({ x: 0, y: 0.6, z: 5.8 }, { x: 0, z: -C.HALF_L * 0.8 },
    { apex: 1.15, margin: 0.18, spin, vMax: 19, driven: true });
  assert.ok(low.ok && low.v0.y > 0, 'low-contact drive lifts over the tape and lands');
});

test('v2 driven loft fallback: a speed-capped shot floats rather than netting', () => {
  const capped = Physics.solveArc({ x: 0, y: 0.9, z: 5.5 }, { x: 0, z: -C.HALF_L * 0.8 },
    { apex: 1.15, margin: 0.18, spin: { x: -5, y: 0, z: 0 }, vMax: 8, driven: true });
  assert.ok(capped.apexY > 1.6, 'capped drive lofts (' + capped.apexY.toFixed(2) + ')');
  assert.ok(capped.apexY < Shots.specV2('lob', C.KITCHEN, C.HALF_L).apex, 'but never to lob height');
});

test('timingOffsetFromContact grades ball-vs-body geometry like practice coaching', () => {
  // zOffFwd: facing-normalized (ball.z - hitter.z); negative = ball in front.
  assert.equal(Shots.timingOffsetFromContact(PRACTICE.TIMING_IDEAL_Z), 0, 'ideal contact (slightly out front) = perfect');
  assert.equal(Shots.timingOffsetFromContact(-1.5), -1, 'ball far out front = fully early (saturated)');
  const atBody = Shots.timingOffsetFromContact(0);
  const behind = Shots.timingOffsetFromContact(0.3);
  assert.ok(atBody > 0 && behind > atBody, 'ball at/behind the body grades late, monotonically');
});

test('v2 timing and stability optima now coincide (contact geometry coherence)', () => {
  // At the ideal contact point the ball is 0.18m from the body — near-max
  // stability AND perfect timing. At max reach (1.5m out front) both systems
  // agree it is a bad hit: stability ~0 and timing fully early with pace loss.
  const perfect = Shots.applyTiming(Shots.timingOffsetFromContact(PRACTICE.TIMING_IDEAL_Z), 'fh', 1);
  assert.ok(Math.abs(perfect.targetXSkew) < 1e-9 && Math.abs(perfect.paceMul - 1) < 1e-9,
    'ideal-geometry contact takes no timing penalty');
  const stretched = Shots.applyTiming(Shots.timingOffsetFromContact(-1.5), 'fh', 1);
  assert.ok(stretched.paceMul < 1 && stretched.apexAdd > 0,
    'max-reach contact loses pace and lofts — consistent with its ~0 stability');
});

test('applyTiming direction: early pulls cross-body (away from paddle side), late pushes toward it', () => {
  // Near-team forehand: paddle side is world +x (see swingSide).
  assert.ok(Shots.applyTiming(-1, 'fh', 1).targetXSkew < 0, 'early fh pulls to -x (cross-body)');
  assert.ok(Shots.applyTiming(1, 'fh', 1).targetXSkew > 0, 'late fh pushes to +x (paddle side)');
});

test('applyTiming: perfect timing is neutral, mistiming skews + saturates', () => {
  const perfect = Shots.applyTiming(0, 'fh', 1);
  assert.ok(Math.abs(perfect.targetXSkew) < 1e-9 && Math.abs(perfect.paceMul - 1) < 1e-9 && perfect.apexAdd === 0,
    'perfect timing is a no-op');
  const early = Shots.applyTiming(-1, 'fh', 1);
  const late = Shots.applyTiming(1, 'fh', 1);
  assert.ok(Math.sign(early.targetXSkew) === -Math.sign(late.targetXSkew), 'early and late skew opposite ways');
  assert.ok(early.paceMul < 1 && late.paceMul < 1, 'both mistimes lose pace');
  assert.ok(early.apexAdd > 0, 'edge hit lofts');
  // backhand mirrors the skew direction relative to forehand
  const earlyBh = Shots.applyTiming(-1, 'bh', 1);
  assert.ok(Math.sign(earlyBh.targetXSkew) === -Math.sign(early.targetXSkew), 'bh mirrors fh skew');
  // far team mirrors again
  const earlyFar = Shots.applyTiming(-1, 'fh', -1);
  assert.ok(Math.sign(earlyFar.targetXSkew) === -Math.sign(early.targetXSkew), 'far team mirrors near team skew');
});

test('v2 CPU timing sigma tightens with difficulty (hard < normal < easy < family)', () => {
  const t = (lvl) => AI.makeAI(lvl, 'balanced').cfg.timing;
  assert.ok(t('hard') < t('normal') && t('normal') < t('easy') && t('easy') < t('family'),
    'timing noise decreases with skill');
});

test('v2 predict returns the cached flight landing exactly', () => {
  const ball = Physics.makeBall();
  ball.live = true;
  ball.flight = { landing: { x: 1.2, z: -4.3 }, T: 1.1, apexY: 2.4, samples: [], elapsed: 0.3 };
  const pred = AI.predict(ball);
  assert.ok(Math.abs(pred.x - 1.2) < 1e-9 && Math.abs(pred.z + 4.3) < 1e-9, 'landing from cache');
  assert.ok(Math.abs(pred.tLeft - 0.8) < 1e-9, 'tLeft = T - elapsed');
  assert.ok(Math.abs(pred.peakY - 2.4) < 1e-9, 'peakY from cached apex');
});

test('v2 predict forward-sim (post-bounce) lands within 0.3m of a fine sim', () => {
  const p0 = { x: 0, y: 0.9, z: 2 };
  const v0 = { x: 1.0, y: 3.0, z: -5.0 };
  const fine = Physics.simulateFlight(p0, v0, { x: 0, y: 0, z: 0 }, { dt: 1 / 240 });
  const ball = Physics.makeBall();
  ball.live = true; ball.flight = null;
  ball.pos = { x: p0.x, y: p0.y, z: p0.z }; ball.vel = { x: v0.x, y: v0.y, z: v0.z }; ball.spin = { x: 0, y: 0, z: 0 };
  const pred = AI.predict(ball);
  assert.ok(Math.hypot(pred.x - fine.landing.x, pred.z - fine.landing.z) < 0.3,
    'coarse predict within 0.3m of fine sim');
});

console.log('\n' + passed + ' assertions passed.');
