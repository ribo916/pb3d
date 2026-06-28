/* Visual smoke test: serve a static file server, load the game in headless
 * Chromium, start a match, and capture a court frame + a mid-rally frame.
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
// start an intermediate match
await page.click('[data-diff="normal"]');
await page.waitForTimeout(800);
await page.screenshot({ path: path.join(OUT, 'court.png') });

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
