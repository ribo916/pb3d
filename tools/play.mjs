/* Watch a full CPU-vs-CPU match play out in a real (headed) browser window,
 * optionally at high speed, to eyeball whether gameplay adheres to our goals.
 *
 * Every player is driven by the AI (players[0] is normally "you" — we hand it an
 * AI so no human input is needed), then we inject extra game.update() steps each
 * frame to fast-forward the simulation while the native render loop keeps drawing.
 *
 * Run:   node tools/play.mjs
 * Speed: SPEED=6 node tools/play.mjs          (≈6x real time; default 4)
 * Setup: VENUE=indoor PALETTE=green DIFF=4.5 node tools/play.mjs
 * Loop:  MATCHES=3 node tools/play.mjs        (play N matches back to back)
 *
 * Env:
 *   SPEED    sim speed multiplier            (default 4)
 *   VENUE    park|tropical|indoor            (default park)
 *   PALETTE  blue|green                      (default blue)
 *   TOD      day|night   (ignored indoors)   (default day)
 *   DIFF     difficulty radio value          (default 4.5)
 *   MATCHES  how many matches to play        (default 1)
 *   MAXSEC   real-seconds safety cap/match    (default 240)
 */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const SPEED = Number(process.env.SPEED || 4);
const VENUE = process.env.VENUE || 'park';
const PALETTE = process.env.PALETTE || 'blue';
const TOD = process.env.TOD || 'day';
const DIFF = process.env.DIFF || '4.5';
const MATCHES = Number(process.env.MATCHES || 1);
const MAXSEC = Number(process.env.MAXSEC || 240);

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg' };

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

const browser = await chromium.launch({
  headless: false,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist',
    '--enable-webgl', '--autoplay-policy=no-user-gesture-required']
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

async function selectOption(name, value) {
  await page.check(`input[name="${name}"][value="${value}"]`, { force: true });
  if (name === 'venue') await page.evaluate(() => window.__pb3dMenu.syncMenuSummary());
}

// Convert players[0] into an AI-driven player and start fast-forwarding the sim.
async function autoDrive(speed) {
  await page.evaluate((mult) => {
    const g = window.__game;
    const me = g.players[0];
    // Borrow an existing AI's config; give players[0] its own fresh AI state so
    // there's no target/timer bleed between players.
    const donor = g.players.find((p) => p.ai);
    me.isHuman = false;
    me.ai = { cfg: donor.ai.cfg, level: donor.ai.level,
      target: { x: 0, z: 0 }, reactTimer: 0 };
    me.aiSwingTimer = 0;

    // Fast-forward: the native rAF loop still renders every frame; we just add
    // extra fixed-step updates so simulated time outruns wall-clock time.
    if (window.__ffTimer) clearInterval(window.__ffTimer);
    const extra = Math.max(0, Math.round(mult) - 1);
    window.__ffTimer = setInterval(() => {
      const gg = window.__game;
      if (!gg) return;
      for (let k = 0; k < extra; k++) gg.update(1 / 60);
    }, 16);
  }, speed);
}

async function snapshot() {
  return page.evaluate(() => {
    const g = window.__game;
    if (!g) return null;
    return {
      state: g.state,
      near: g.match.scores.near,
      far: g.match.scores.far,
      games: g.match.games ? { near: g.match.games.near, far: g.match.games.far } : null
    };
  });
}

async function playOneMatch(i) {
  await page.goto(base, { waitUntil: 'networkidle' });
  await selectOption('venue', VENUE);
  await selectOption('palette', PALETTE);
  if (VENUE !== 'indoor') await selectOption('tod', TOD);
  await page.check(`input[name="difficulty"][value="${DIFF}"]`, { force: true });
  await page.click('#startBtn');
  await page.waitForTimeout(600);
  await autoDrive(SPEED);

  console.log(`\n=== match ${i + 1}/${MATCHES} — ${VENUE}/${PALETTE}/${TOD} diff ${DIFF} @ ${SPEED}x ===`);
  const t0 = Date.now();
  let last = '';
  while (true) {
    const snap = await snapshot();
    if (snap) {
      const line = `${snap.state.padEnd(6)}  near ${snap.near} : ${snap.far} far` +
        (snap.games ? `   games ${snap.games.near}:${snap.games.far}` : '');
      if (line !== last) { console.log(line); last = line; }
      if (snap.state === 'over') break;
    }
    if ((Date.now() - t0) / 1000 > MAXSEC) { console.log('(hit MAXSEC cap)'); break; }
    await page.waitForTimeout(150);
  }
  await page.waitForTimeout(3000); // let the winning celebration linger on screen
}

for (let i = 0; i < MATCHES; i++) await playOneMatch(i);

if (errors.length) console.error('\nPAGE ERRORS:\n' + errors.join('\n'));
console.log('\nDone — closing in 5s (Ctrl-C to keep the window).');
await page.waitForTimeout(5000);
await browser.close();
server.close();
