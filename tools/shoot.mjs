/* Visual smoke test: serve a static file server, load the game in headless
 * Chromium, capture venue/palette variants, then verify a match flow.
 * Run: node pb3d/tools/shoot.mjs   (uses the repo's playwright dep)
 * Output: pb3d/tools/shots/*.png
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startViteServer } from './vite-test-server.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(__dirname, 'shots');
fs.mkdirSync(OUT, { recursive: true });

const testServer = await startViteServer(ROOT);
const server = testServer.server;
const base = testServer.base;

const headed = process.env.HEADED === '1';
const browser = await chromium.launch({
  headless: !headed,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--enable-webgl']
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(base, { waitUntil: 'networkidle' });
const menuCheck = await page.evaluate(() => {
  var api = window.__pb3dMenu;
  var venueIndoor = document.querySelector('input[name="venue"][value="indoor"]');
  var venuePark = document.querySelector('input[name="venue"][value="park"]');
  venueIndoor.checked = true;
  var afterIndoor = api.syncMenuSummary();
  var disabledIndoor = document.querySelector('input[name="tod"][value="night"]').disabled;
  venuePark.checked = true;
  var afterPark = api.syncMenuSummary();
  var disabledPark = document.querySelector('input[name="tod"][value="night"]').disabled;
  return { afterIndoor, afterPark, disabledIndoor, disabledPark };
});

function expect(cond, msg) {
  if (!cond) throw new Error(msg);
}

expect(menuCheck.afterIndoor.timeOfDay === 'day', 'indoor config did not force daytime launch value');
expect(menuCheck.disabledIndoor === true, 'indoor selection did not disable time-of-day controls');
expect(menuCheck.disabledPark === false, 'park selection did not restore time-of-day controls');

async function selectOption(name, value) {
  await page.check('input[name="' + name + '"][value="' + value + '"]', { force: true });
  await page.evaluate(() => window.__pb3dMenu.syncMenuSummary());
}

async function captureMatch(cfg) {
  await page.reload({ waitUntil: 'networkidle' });
  await selectOption('venue', cfg.venue);
  await selectOption('palette', cfg.palette);
  if (cfg.tod) await selectOption('tod', cfg.tod);
  await page.screenshot({ path: path.join(OUT, cfg.menuShot) });
  await page.check('input[name="difficulty"][value="4.5"]', { force: true });
  await page.click('#startBtn');
  await page.waitForTimeout(cfg.wait || 900);
  await page.screenshot({ path: path.join(OUT, cfg.courtShot) });
}

async function captureRosterCloseup(cfg) {
  await page.reload({ waitUntil: 'networkidle' });
  await selectOption('venue', cfg.venue);
  await selectOption('palette', cfg.palette);
  if (cfg.tod) await selectOption('tod', cfg.tod);
  await page.check('input[name="difficulty"][value="4.5"]', { force: true });
  await page.click('#startBtn');
  await page.waitForTimeout(900);
  await page.evaluate(() => {
    var g = window.__game;
    if (!g) return;
    var hud = document.getElementById('hud');
    if (hud) hud.style.display = 'none';
    g.msgTimer = 0;
    g.ball.live = false;
    g.ball.pos.x = 0;
    g.ball.pos.y = 0.9;
    g.ball.pos.z = -7;
    var poses = [
      { x:  2.1, z: 4.8, yaw: Math.PI - 0.35 },
      { x: -2.1, z: 4.2, yaw: Math.PI + 0.22 },
      { x:  1.2, z: 1.8, yaw: -0.05 },
      { x: -1.2, z: 1.5, yaw:  0.18 }
    ];
    g.players.forEach(function (pl, i) {
      pl.pos.x = poses[i].x;
      pl.pos.z = poses[i].z;
      pl.vel.x = 0;
      pl.vel.z = 0;
    });
    g._syncMeshes(0.016);
    g.players.forEach(function (pl, i) {
      pl.mesh.object.rotation.y = poses[i].yaw;
    });
    g.camera.position.set(-0.2, 2.7, 7.9);
    g.camera.lookAt(0, 1.0, 2.9);
    g.render();
  });
  await page.screenshot({ path: path.join(OUT, cfg.shot) });
}

async function captureSinglesSmoke() {
  await page.reload({ waitUntil: 'networkidle' });
  await selectOption('mode', 'singles');
  await selectOption('venue', 'park');
  await selectOption('palette', 'blue');
  await selectOption('tod', 'day');
  await page.check('input[name="difficulty"][value="4.5"]', { force: true });
  await page.click('#startBtn');
  await page.waitForTimeout(900);
  const snap = await page.evaluate(() => {
    const g = window.__game;
    const callout = document.getElementById('callout');
    return {
      mode: g && g.mode,
      players: g && g.players && g.players.length,
      state: g && g.state,
      callout: callout && callout.textContent
    };
  });
  expect(snap.mode === 'singles', 'singles match did not boot in singles mode');
  expect(snap.players === 2, 'singles match did not create exactly two players');
  expect(snap.state === 'serve', 'singles match did not reach serve state');
  expect(/^\d+–\d+$/.test(snap.callout), 'singles HUD did not use two-number scoring');
  await page.screenshot({ path: path.join(OUT, 'singles-court.png') });
}

await captureMatch({ venue: 'park', palette: 'blue', tod: 'day', menuShot: 'menu-day.png', courtShot: 'court.png', wait: 850 });
await captureMatch({ venue: 'park', palette: 'green', tod: 'night', menuShot: 'menu-park-green-night.png', courtShot: 'court-night.png', wait: 950 });
await captureMatch({ venue: 'tropical', palette: 'blue', tod: 'day', menuShot: 'menu-tropical-day.png', courtShot: 'court-tropical-day.png', wait: 850 });
await captureMatch({ venue: 'tropical', palette: 'green', tod: 'night', menuShot: 'menu-tropical-night.png', courtShot: 'court-tropical-night.png', wait: 950 });
await captureMatch({ venue: 'indoor', palette: 'blue', menuShot: 'menu-indoor-blue.png', courtShot: 'court-indoor-blue.png', wait: 850 });
await captureMatch({ venue: 'indoor', palette: 'green', menuShot: 'menu-indoor-green.png', courtShot: 'court-indoor-green.png', wait: 850 });
await captureRosterCloseup({ venue: 'park', palette: 'blue', tod: 'day', shot: 'roster-closeup.png' });
await captureSinglesSmoke();

await page.reload({ waitUntil: 'networkidle' });
await selectOption('mode', 'doubles');
await selectOption('venue', 'park');
await selectOption('palette', 'blue');
await selectOption('tod', 'day');
await page.check('input[name="difficulty"][value="4.5"]', { force: true });
await page.click('#startBtn');
await page.waitForTimeout(900);

// Drive the match: auto-serve whenever it's the human's serve and keep swinging,
// for a few seconds, capturing mid-rally frames and tracking state transitions.
// The human stays passive (no swings) so rallies to its lane end deterministically
// in a no-return — exercising the full serve -> rally -> point loop quickly. (Manual
// play and the diag trace confirm the human CAN return; this is just a stable check.)
const seen = new Set();
let sawRally = false, sawPoint = false, maxScore = 0, shotN = 0;
for (let i = 0; i < 140; i++) {
  const snap = await page.evaluate(() => {
    const g = window.__game;
    if (!g) return null;
    if (g.isHumanServe && g.isHumanServe()) window.__input.state.serveQueued = true;
    return { state: g.state, near: g.match.scores.near, far: g.match.scores.far };
  });
  if (snap) {
    seen.add(snap.state);
    if (snap.state === 'rally') sawRally = true;
    if (snap.state === 'point' || snap.state === 'over') sawPoint = true;
    maxScore = Math.max(maxScore, snap.near + snap.far);
  }
  if (snap && snap.state === 'rally' && shotN < 3) { await page.screenshot({ path: path.join(OUT, `rally-${shotN++}.png`) }); }
  await page.waitForTimeout(120);
}

const finalSnap = await page.evaluate(() => {
  const g = window.__game;
  return { state: g.state, near: g.match.scores.near, far: g.match.scores.far };
});

await browser.close();
await server.close();

console.log('states seen:', [...seen].join(', '));
console.log('saw rally:', sawRally, ' saw point/score:', sawPoint, ' max total points:', maxScore);
console.log('final:', JSON.stringify(finalSnap));

const problems = [];
if (errors.length) problems.push('PAGE ERRORS:\n' + errors.join('\n'));
if (!sawRally) problems.push('never entered RALLY state (serve did not go live)');
if (!sawPoint) problems.push('no point was ever scored');

if (problems.length) { console.error('\n' + problems.join('\n')); process.exitCode = 1; }
else console.log('\nOK — serve/rally/scoring loop verified; shots in pb3d/tools/shots/');
