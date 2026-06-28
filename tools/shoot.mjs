/* Visual smoke test: serve a static file server, load the game in headless
 * Chromium, capture venue/palette variants, then verify a match flow.
 * Run: node pb3d/tools/shoot.mjs   (uses the repo's playwright dep)
 * Output: pb3d/tools/shots/*.png
 */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(__dirname, 'shots');
fs.mkdirSync(OUT, { recursive: true });

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.css': 'text/css', '.png': 'image/png' };

const server = http.createServer((req, res) => {
  let url = decodeURIComponent(req.url.split('?')[0]);
  if (url === '/') url = '/index.html';
  const file = path.join(ROOT, url);
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

await new Promise((r) => server.listen(0, r));
const port = server.address().port;
const base = `http://localhost:${port}/`;

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
  var afterIndoor = api.syncTimeOfDayUI();
  var hiddenIndoor = document.getElementById('todGroup').classList.contains('is-hidden');
  venuePark.checked = true;
  var afterPark = api.syncTimeOfDayUI();
  var hiddenPark = document.getElementById('todGroup').classList.contains('is-hidden');
  return { afterIndoor, afterPark, hiddenIndoor, hiddenPark };
});

function expect(cond, msg) {
  if (!cond) throw new Error(msg);
}

expect(menuCheck.afterIndoor.timeOfDay === 'day', 'indoor config did not force daytime launch value');
expect(menuCheck.hiddenIndoor === true, 'indoor selection did not hide time-of-day controls');
expect(menuCheck.hiddenPark === false, 'park selection did not restore time-of-day controls');

async function selectOption(name, value) {
  await page.check('input[name="' + name + '"][value="' + value + '"]', { force: true });
  if (name === 'venue') await page.evaluate(() => window.__pb3dMenu.syncTimeOfDayUI());
}

async function captureMatch(cfg) {
  await page.reload({ waitUntil: 'networkidle' });
  await selectOption('venue', cfg.venue);
  await selectOption('palette', cfg.palette);
  if (cfg.tod) await selectOption('tod', cfg.tod);
  await page.screenshot({ path: path.join(OUT, cfg.menuShot) });
  await page.click('[data-diff="4.5"]');
  await page.waitForTimeout(cfg.wait || 900);
  await page.screenshot({ path: path.join(OUT, cfg.courtShot) });
}

await captureMatch({ venue: 'park', palette: 'blue', tod: 'day', menuShot: 'menu-day.png', courtShot: 'court.png', wait: 850 });
await captureMatch({ venue: 'park', palette: 'green', tod: 'night', menuShot: 'menu-park-green-night.png', courtShot: 'court-night.png', wait: 950 });
await captureMatch({ venue: 'tropical', palette: 'blue', tod: 'day', menuShot: 'menu-tropical-day.png', courtShot: 'court-tropical-day.png', wait: 850 });
await captureMatch({ venue: 'tropical', palette: 'green', tod: 'night', menuShot: 'menu-tropical-night.png', courtShot: 'court-tropical-night.png', wait: 950 });
await captureMatch({ venue: 'indoor', palette: 'blue', menuShot: 'menu-indoor-blue.png', courtShot: 'court-indoor-blue.png', wait: 850 });
await captureMatch({ venue: 'indoor', palette: 'green', menuShot: 'menu-indoor-green.png', courtShot: 'court-indoor-green.png', wait: 850 });

await page.reload({ waitUntil: 'networkidle' });
await selectOption('venue', 'park');
await selectOption('palette', 'blue');
await selectOption('tod', 'day');
await page.click('[data-diff="4.5"]');
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
server.close();

console.log('states seen:', [...seen].join(', '));
console.log('saw rally:', sawRally, ' saw point/score:', sawPoint, ' max total points:', maxScore);
console.log('final:', JSON.stringify(finalSnap));

const problems = [];
if (errors.length) problems.push('PAGE ERRORS:\n' + errors.join('\n'));
if (!sawRally) problems.push('never entered RALLY state (serve did not go live)');
if (!sawPoint) problems.push('no point was ever scored');

if (problems.length) { console.error('\n' + problems.join('\n')); process.exitCode = 1; }
else console.log('\nOK — serve/rally/scoring loop verified; shots in pb3d/tools/shots/');
