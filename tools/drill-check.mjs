/* Live drill-mode regression check: real browser, real Vite dev server, real
 * engine — the layer test/drill.test.mjs's Game.prototype stubs deliberately
 * can't cover (actual mesh swing animation, real replay capture/loop timing,
 * the full Setup -> live rep -> REP COMPLETE -> looped-replay state machine).
 * Promotes the throwaway tools/_verify*.mjs scripts this repo's drill-mode
 * bug hunts kept reinventing into one permanent, checked-in script.
 *
 * Run: node tools/drill-check.mjs   (HEADED=1 for a visible browser)
 */
import { chromium } from 'playwright';
import { startViteServer } from './vite-test-server.mjs';

function expect(cond, msg) {
  if (!cond) throw new Error(msg);
}

const ROOT = new URL('..', import.meta.url).pathname;
const testServer = await startViteServer(ROOT);
const { server, base } = testServer;

const headed = process.env.HEADED === '1';
const browser = await chromium.launch({
  headless: !headed,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--enable-webgl']
});

const problems = [];
function check(cond, msg) {
  if (!cond) problems.push(msg);
}

async function newPage() {
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push('[console] ' + m.text()); });
  return { page, errors };
}

// Poll game state until the live rep ends and the replay loop starts, or a
// generous timeout elapses. Returns the last-seen snapshot.
async function playToReplay(page, maxMs) {
  const start = Date.now();
  let snap = null;
  while (Date.now() - start < maxMs) {
    snap = await page.evaluate(() => {
      const g = window.__game;
      return g && {
        state: g.state, hitCount: g.drillHitCount, scriptIndex: g.drillScriptIndex,
        replaying: g.drillReplaying, youVisible: g.youMarker ? g.youMarker.visible : null
      };
    });
    if (snap && snap.replaying) return snap;
    await page.waitForTimeout(100);
  }
  return snap;
}

// Watch for at least one player's mesh entering its swing pose, covering at
// least one full replay loop (sized from the actual recorded duration, not
// a guessed fixed window — a short 1-2-hit drill can have its only swing
// event occupy a small fraction of the loop, so a fixed short window is
// prone to missing it by sampling-phase luck alone).
async function sawSwingDuringReplay(page) {
  const duration = await page.evaluate(() => {
    const pb = window.__game && window.__game.drillPlayback;
    return pb ? pb.getDuration() : 3;
  });
  const windowMs = Math.max(3000, Math.ceil(duration * 1000 * 1.5));
  const start = Date.now();
  while (Date.now() - start < windowMs) {
    const swinging = await page.evaluate(() =>
      window.__game.players.some(p => p.mesh.isSwinging && p.mesh.isSwinging()));
    if (swinging) return true;
    await page.waitForTimeout(30);
  }
  return false;
}

// ---- 1) Exact 4-corner / no-cues regression from this session's bug hunt ----
// Real court corners (HALF_W=3.048, HALF_L=6.706), a plain P1<->P3 back-and-
// forth, zero `moves` cues. Every player must hold within a small reach-
// adjustment tolerance of their authored corner for the whole scripted rep.
{
  const { page, errors } = await newPage();
  const half = 2.8, near = 6.4, far = -6.4;
  const start = { P1: [-half, near], P2: [half, near], P3: [-half, far], P4: [half, far] };
  const drill = {
    id: 'drill-check-4corner', name: 'Check 4-Corner', players: 4, desc: '', goal: '', tags: [],
    startPositions: {
      P1: { x: -half, z: near }, P2: { x: half, z: near },
      P3: { x: -half, z: far }, P4: { x: half, z: far }
    },
    script: [
      { hitter: 'P1', shotType: 'drive', target: 'P3' },
      { hitter: 'P3', shotType: 'drive', target: 'P1' },
      { hitter: 'P1', shotType: 'drive', target: 'P3' },
      { hitter: 'P3', shotType: 'drive', target: 'P1' }
    ],
    steps: [{ title: 'Setup', desc: '' }]
  };
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.evaluate((d) => sessionStorage.setItem('pb3dWipDrill', JSON.stringify(d)), drill);
  await page.goto(base + '?testDrill=1', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__game && window.__game.players && window.__game.players.length >= 4, { timeout: 15000 });

  let maxDriftWhileScripted = 0;
  const t0 = Date.now();
  while (Date.now() - t0 < 8000) {
    const snap = await page.evaluate(() => {
      const g = window.__game;
      const out = {};
      ['P1', 'P2', 'P3', 'P4'].forEach(slot => {
        const p = g.players.find(pp => pp.drillSlot === slot);
        out[slot] = p ? [p.pos.x, p.pos.z] : null;
      });
      return { forcedShot: !!g.drillForcedShot, replaying: g.drillReplaying, pos: out };
    });
    if (snap.forcedShot) {
      for (const slot of Object.keys(start)) {
        if (!snap.pos[slot]) continue;
        const [sx, sz] = start[slot], [px, pz] = snap.pos[slot];
        maxDriftWhileScripted = Math.max(maxDriftWhileScripted, Math.hypot(px - sx, pz - sz));
      }
    }
    if (snap.replaying) break;
    await page.waitForTimeout(80);
  }
  check(maxDriftWhileScripted < 0.5,
    '4-corner drill: a player drifted ' + maxDriftWhileScripted.toFixed(2) + 'm from their corner while a beat was still scripted (expect < 0.5m reach-adjustment only)');
  check(errors.length === 0, '4-corner drill: page/console errors: ' + JSON.stringify(errors));
  await page.close();
}

// ---- 2) Shipped drills end-to-end, including swing animation in the LOOP ----
for (const id of ['drill-drip', 'drill-dink-rally', 'drill-1v1-test', 'drill-2v1-test']) {
  const { page, errors } = await newPage();
  await page.goto(base + '?drill=' + id, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__game && window.__game.players && window.__game.players.length >= 2, { timeout: 15000 });

  const scriptLength = await page.evaluate(() => window.__game.drillData.script.length);
  // Generous budget: Setup hold + N real shots (dinks/drops resolve slower
  // than drives) + the post-script settle tail + REP_PAUSE before the loop
  // starts — a 5-beat dink rally alone measured ~30s end-to-end.
  const snap = await playToReplay(page, 45000);
  check(!!snap && snap.replaying, id + ': never reached the looped replay within 45s');
  if (snap) {
    check(snap.hitCount === scriptLength, id + ': hitCount ' + snap.hitCount + ' !== script.length ' + scriptLength + ' (possible desync)');
    check(snap.scriptIndex === scriptLength, id + ': scriptIndex ' + snap.scriptIndex + ' !== script.length ' + scriptLength);
    check(snap.youVisible === false, id + ': the "YOU" ring marker was visible (should always be hidden in drill mode)');
  }

  // The opener (script[0]) is fired directly by fireOpeningShot, a "table-
  // setting injection" that deliberately never calls mesh.swing() (nothing
  // realistically "swings" for it, per drillDirector.js) — only script[1+],
  // fired through _cpuHit, ever produces a swing event. A 1-shot drill
  // (drill-1v1-test/2v1-test) therefore has ZERO swing events in its
  // entire recorded rep, by design; only check drills with a real second+ shot.
  if (scriptLength > 1) {
    const sawSwing = await sawSwingDuringReplay(page);
    check(sawSwing, id + ': no swing animation observed during the LOOPED replay (regression: _tickDrillReplay must consume swing events)');
  }

  check(errors.length === 0, id + ': page/console errors: ' + JSON.stringify(errors));
  await page.close();
}

await browser.close();
await server.close();

if (problems.length) {
  console.error('\nFAILED:\n' + problems.map(p => '  - ' + p).join('\n'));
  process.exitCode = 1;
} else {
  console.log('OK — drill-mode live checks passed: 4-corner hold, all 4 shipped drills complete + loop + animate + hide the YOU marker.');
}
