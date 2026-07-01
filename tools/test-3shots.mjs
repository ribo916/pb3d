/* Test first 3 shots at Pro difficulty — observe return of serve and third shot */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startViteServer } from './vite-test-server.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'tools/shots');
fs.mkdirSync(OUT, { recursive: true });

const testServer = await startViteServer(ROOT);
const server = testServer.server;
const base = testServer.base;

const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--enable-webgl']
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(base, { waitUntil: 'networkidle' });

// Start at Pro (hard / 5.0) difficulty
await page.check('input[name="difficulty"][value="5.0"]', { force: true });
await page.click('#startBtn');
await page.waitForTimeout(800);

const shots = [];
let shotCount = 0;
const LOG = [];

for (let i = 0; i < 200; i++) {
  const snap = await page.evaluate(() => {
    const g = window.__game;
    if (!g) return null;
    // Auto-serve for human
    if (g.isHumanServe && g.isHumanServe()) window.__input.state.serveQueued = true;
    const b = g.ball;
    const rally = g.match && g.match.rally;
    return {
      state: g.state,
      phase: rally ? rally.phase : null,
      shots: rally ? rally.shots : 0,
      ballX: +b.pos.x.toFixed(2),
      ballY: +b.pos.y.toFixed(2),
      ballZ: +b.pos.z.toFixed(2),
      ballLive: b.live,
      splineApex: b.spline ? +b.spline.P1.y.toFixed(2) : null,
      splineP2z: b.spline ? +b.spline.P2.z.toFixed(2) : null,
      near: g.match.scores.near,
      far: g.match.scores.far,
      lastHitter: rally ? rally.lastHitter : null,
      bounces: rally ? rally.bouncesSinceHit : null,
    };
  });
  if (!snap) { await page.waitForTimeout(80); continue; }

  // Log each new shot
  if (snap.shots !== undefined && snap.shots !== (LOG[LOG.length-1]?.shots ?? -1)) {
    LOG.push({ tick: i, ...snap });
  }

  // Screenshot at each shot transition (up to 4 including serve)
  if (snap.state === 'rally' && snap.shots > shotCount) {
    shotCount = snap.shots;
    const fname = `3shots-shot${shotCount}.png`;
    await page.screenshot({ path: path.join(OUT, fname) });
    shots.push({ shotNum: shotCount, snap, file: fname });
    console.log(`\nShot ${shotCount} — phase:${snap.phase} lastHitter:${snap.lastHitter}`);
    console.log(`  ball pos: x=${snap.ballX} y=${snap.ballY} z=${snap.ballZ}`);
    if (snap.splineApex !== null) {
      console.log(`  spline: apex=${snap.splineApex} P2z=${snap.splineP2z}`);
      const landZ = snap.splineP2z;
      const kitchenZ = 2.134;
      const baselineZ = 6.706;
      if (Math.abs(landZ) < kitchenZ) console.log(`  → LANDS IN KITCHEN (z=${landZ})`);
      else if (Math.abs(landZ) > baselineZ * 0.75) console.log(`  → LANDS DEEP (z=${landZ})`);
      else console.log(`  → LANDS MID-COURT (z=${landZ})`);
    }
    if (shotCount >= 3) break;
  }

  await page.waitForTimeout(80);
}

// Print final ball position summary
console.log('\n--- Shot log summary ---');
for (const s of shots) {
  const landZ = s.snap.splineP2z;
  const depth = landZ !== null
    ? (Math.abs(landZ) < 2.134 ? 'KITCHEN' : Math.abs(landZ) > 5.0 ? 'DEEP' : 'MID-COURT')
    : '(no spline)';
  console.log(`Shot ${s.snap.shots}: ${s.snap.lastHitter} → ${depth} (P2z=${landZ}) apex=${s.snap.splineApex}`);
}

if (errors.length) console.error('PAGE ERRORS:', errors.join('\n'));

await browser.close();
await server.close();
