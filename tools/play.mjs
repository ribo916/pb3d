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
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startViteServer } from './vite-test-server.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const SPEED = Number(process.env.SPEED || 4);
const VENUE = process.env.VENUE || 'park';
const PALETTE = process.env.PALETTE || 'blue';
const TOD = process.env.TOD || 'day';
const DIFF = process.env.DIFF || '4.5';
const MATCHES = Number(process.env.MATCHES || 1);
const MAXSEC = Number(process.env.MAXSEC || 240);

const testServer = await startViteServer(ROOT);
const server = testServer.server;
const base = testServer.base;

const browser = await chromium.launch({
  headless: false,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist',
    '--enable-webgl', '--autoplay-policy=no-user-gesture-required']
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

// Radios live inside the arcade-flow screens now; set them programmatically.
async function selectOption(name, value) {
  await page.evaluate(({ name, value }) => {
    const el = document.querySelector(`input[name="${name}"][value="${value}"]`);
    if (el) { el.checked = true; el.dispatchEvent(new Event('change', { bubbles: true })); }
    window.__pb3dMenu.syncMenuSummary();
  }, { name, value });
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
      games: g.match.games ? { near: g.match.games.near, far: g.match.games.far } : null,
      metrics: g.metrics
    };
  });
}

// Compact histogram + fault-reason breakdown for A/B tuning.
function printMetrics(metrics) {
  if (!metrics) return;
  const rallies = metrics.rallyShots || [];
  const n = rallies.length || 1;
  const sorted = [...rallies].sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
  const mean = rallies.reduce((a, b) => a + b, 0) / n;
  const buckets = [0, 0, 0, 0, 0]; // 0-2, 3-4, 5-6, 7-9, 10+
  rallies.forEach((r) => {
    const i = r <= 2 ? 0 : r <= 4 ? 1 : r <= 6 ? 2 : r <= 9 ? 3 : 4;
    buckets[i]++;
  });
  console.log(`\n--- metrics — ${rallies.length} points ---`);
  console.log(`rally shots: median ${median}, mean ${mean.toFixed(1)}`);
  console.log(`  hist  0-2:${buckets[0]}  3-4:${buckets[1]}  5-6:${buckets[2]}  7-9:${buckets[3]}  10+:${buckets[4]}`);
  console.log(`net errors: ${metrics.netErrors}   serve faults: ${metrics.serveFaults}`);
  const reasons = Object.entries(metrics.pointsByReason || {}).sort((a, b) => b[1] - a[1]);
  console.log('point reasons: ' + reasons.map(([k, v]) => `${k}:${v}`).join('  '));
  // Arc-shape stats: mean apex + launch speed per shot type — the lens that
  // catches "everything is a lob" (rally counts alone can't see it).
  const stats = metrics.shotStats;
  if (stats && Object.keys(stats).length) {
    console.log('shot shape (mean apex m / mean launch m/s / count):');
    Object.entries(stats).sort((a, b) => b[1].n - a[1].n).forEach(([type, s]) => {
      console.log(`  ${type.padEnd(8)} ${(s.apexSum / s.n).toFixed(2)} / ${(s.speedSum / s.n).toFixed(1)} / ${s.n}`);
    });
  }
}

async function playOneMatch(i) {
  await page.goto(base, { waitUntil: 'networkidle' });
  await selectOption('venue', VENUE);
  await selectOption('palette', PALETTE);
  if (VENUE !== 'indoor') await selectOption('tod', TOD);
  await selectOption('difficulty', DIFF);
  await page.evaluate(() => window.__pb3dMenu.launch());
  await page.waitForTimeout(600);
  await autoDrive(SPEED);

  console.log(`\n=== match ${i + 1}/${MATCHES} — ${VENUE}/${PALETTE}/${TOD} diff ${DIFF} @ ${SPEED}x ===`);
  const t0 = Date.now();
  let last = '', lastSnap = null;
  while (true) {
    const snap = await snapshot();
    if (snap) {
      lastSnap = snap;
      const line = `${snap.state.padEnd(6)}  near ${snap.near} : ${snap.far} far` +
        (snap.games ? `   games ${snap.games.near}:${snap.games.far}` : '');
      if (line !== last) { console.log(line); last = line; }
      if (snap.state === 'over') break;
    }
    if ((Date.now() - t0) / 1000 > MAXSEC) { console.log('(hit MAXSEC cap)'); break; }
    await page.waitForTimeout(150);
  }
  if (lastSnap) printMetrics(lastSnap.metrics);
  await page.waitForTimeout(3000); // let the winning celebration linger on screen
}

for (let i = 0; i < MATCHES; i++) await playOneMatch(i);

if (errors.length) console.error('\nPAGE ERRORS:\n' + errors.join('\n'));
console.log('\nDone — closing in 5s (Ctrl-C to keep the window).');
await page.waitForTimeout(5000);
await browser.close();
await server.close();
