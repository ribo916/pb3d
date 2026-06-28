/* Node logic tests for the standalone pickleball pure modules.
 * Run: node pb3d/test/logic.test.mjs   (no Three.js needed)
 */
import assert from 'node:assert';
import * as Physics from '../src/physics.js';
import * as Shots from '../src/shots.js';
import * as Rules from '../src/rules.js';
import * as AI from '../src/ai.js';
import { buildMusicCatalog, sanitizeMusicState } from '../src/audio.js';

const C = Physics.COURT;
let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { console.error('FAIL  ' + name + '\n      ' + e.message); process.exitCode = 1; }
}

/* ---------------------------- shots ---------------------------- */
test('shot profiles resolve to the tuned values', () => {
  const drive = Shots.params('drive', C.KITCHEN, C.HALF_L);
  assert.equal(drive.apex, 1.3);
  assert.equal(drive.spinX, 4.0);
  assert.ok(Math.abs(drive.landZ - C.HALF_L * 0.82) < 1e-9, 'drive lands at 82% depth');
  const dink = Shots.params('dink', C.KITCHEN, C.HALF_L);
  assert.ok(Math.abs(dink.landZ - (C.KITCHEN + 0.25)) < 1e-9, 'dink lands just past kitchen');
  const drop = Shots.params('drop', C.KITCHEN, C.HALF_L);
  assert.ok(Math.abs(drop.landZ - C.KITCHEN * 0.55) < 1e-9, 'drop dies in kitchen');
});

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
  const base = Shots.params('drive', C.KITCHEN, C.HALF_L).landZ;
  const deep = Shots.aimDepth(base, 1, C.KITCHEN, C.HALF_L);
  const shallow = Shots.aimDepth(base, -1, C.KITCHEN, C.HALF_L);
  assert.ok(deep <= C.HALF_L * 0.92 + 1e-9, 'deep within max');
  assert.ok(shallow >= C.KITCHEN * 0.5 - 1e-9, 'shallow above min');
  assert.ok(deep > shallow, 'forward aims deeper than back');
});

/* ---------------------------- physics ---------------------------- */
test('launch raises the arc so the shot clears the net', () => {
  const p0 = Physics.vec(0, 0.6, C.HALF_L * 0.8);     // near baseline, low contact
  const target = Physics.vec(0, 0, -C.HALF_L * 0.7);  // deep far court
  const spin = Physics.vec(4, 0, 0);                  // topspin (dips)
  const v = Physics.launch(p0, target, 1.0, 0.22, spin);
  assert.ok(Physics.clearsNet(p0, v, 0.22, spin), 'launched velocity clears the net');
});

test('step bounces the ball and reports in/out of bounds', () => {
  const ball = Physics.makeBall();
  ball.pos = Physics.vec(0, 0.05, -3); ball.vel = Physics.vec(0, -2, 0); ball.live = true;
  let bounced = null;
  for (let i = 0; i < 30 && !bounced; i++) {
    const evs = Physics.step(ball, 1 / 120);
    bounced = evs.find(e => e.type === 'bounce' || e.type === 'floor-out');
  }
  assert.ok(bounced, 'a floor event fired');
  assert.equal(bounced.type, 'bounce');
  assert.equal(bounced.inBounds, true);
});

test('ball landing outside the sideline is floor-out', () => {
  const ball = Physics.makeBall();
  ball.pos = Physics.vec(C.HALF_W + 1, 0.05, -3); ball.vel = Physics.vec(0, -2, 0); ball.live = true;
  let ev = null;
  for (let i = 0; i < 30 && !ev; i++) {
    ev = Physics.step(ball, 1 / 120).find(e => e.type === 'bounce' || e.type === 'floor-out');
  }
  assert.equal(ev.type, 'floor-out');
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
  const shot = AI.chooseShot(ai, ball, m, true);
  assert.ok(shot.target.z > 0, 'far serve aims toward the near (+z) side');
  assert.equal(shot.type, 'serve');
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

console.log('\n' + passed + ' assertions passed.');
