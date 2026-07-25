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

// ---- 2) v2 landing + operational arriveBy deadlines ----
{
  const { page, errors } = await newPage();
  const drill = {
    id: 'drill-check-v2-landing', name: 'Check V2 Landing', players: 4, desc: '', goal: '', tags: [],
    startPositions: {
      P1: { x: 1.5, z: 4.0 }, P2: { x: -1.5, z: 3.2 },
      P3: { x: -1.5, z: -4.0 }, P4: { x: 1.5, z: -3.2 }
    },
    script: [
      {
        hitter: 'P1', receiver: 'P3', shotType: 'drop', landing: { x: -0.5, z: -3.0 },
        players: {
          P2: { to: { x: -1.0, z: 3.2 }, behavior: 'shadow', arriveBy: 'contact' },
          P4: { to: { x: -4.4, z: -6.5 }, behavior: 'retreat', arriveBy: 'bounce' }
        }
      },
      { hitter: 'P3', target: 'P1', shotType: 'dink' }
    ],
    steps: [{ title: 'Setup', desc: '' }]
  };
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.evaluate((d) => sessionStorage.setItem('pb3dWipDrill', JSON.stringify(d)), drill);
  await page.goto(base + '?testDrill=1', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__game && window.__game.players && window.__game.players.length >= 4, { timeout: 15000 });

  const observed = await page.waitForFunction(() => {
    const g = window.__game;
    if (!g || g.drillHitCount !== 1 || !g.ball.flight || !g.ball.flight.landing) return false;
    return {
      landing: { x: g.ball.flight.landing.x, z: g.ball.flight.landing.z },
      receiver: g.drillForcedShot && g.drillForcedShot.hitter && g.drillForcedShot.hitter.drillSlot,
      p2Deadline: g.drillForcedMoves.P2 && g.drillForcedMoves.P2.deadline,
      p4Deadline: g.drillForcedMoves.P4 && g.drillForcedMoves.P4.deadline,
      warnings: g.drillWarnings.slice()
    };
  }, { timeout: 15000 }).then(h => h.jsonValue()).catch(() => null);
  check(!!observed, 'v2 landing drill: never observed first scripted flight');
  if (observed) {
    check(Math.abs(observed.landing.x - drill.script[0].landing.x) < 0.25,
      'v2 landing drill: first flight landed near x=' + observed.landing.x.toFixed(2) + ', expected explicit x=' + drill.script[0].landing.x);
    check(Math.abs(observed.landing.z - drill.script[0].landing.z) < 0.25,
      'v2 landing drill: first flight landed near z=' + observed.landing.z.toFixed(2) + ', expected explicit z=' + drill.script[0].landing.z);
    check(observed.receiver === 'P3',
      'v2 landing drill: next receiver/hitter was ' + observed.receiver + ', expected P3');
    check(observed.p2Deadline && observed.p2Deadline.reachable,
      'v2 deadline drill: reachable contact directive did not receive an operational seek plan');
    check(observed.p4Deadline && !observed.p4Deadline.reachable,
      'v2 deadline drill: impossible bounce directive was not marked unreachable');
    check(observed.warnings.some(w => /P4: arriveBy bounce is unreachable/.test(w)),
      'v2 deadline drill: unreachable directive did not emit an authoring warning');
  }
  const snap = await playToReplay(page, 30000);
  check(!!snap && snap.replaying, 'v2 landing drill: never reached looped replay within 30s');
  check(errors.length === 0, 'v2 landing drill: page/console errors: ' + JSON.stringify(errors));
  await page.close();
}

// ---- 3) Shipped drills end-to-end, including swing animation in the LOOP ----
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

  // One-shot drills have a very short recorded swing window, so keep the
  // replay swing assertion focused on multi-shot drills where at least one
  // forced response goes through _cpuHit as well as the direct opener.
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
  console.log('OK — drill-mode live checks passed: 4-corner hold, v2 landing/deadlines, all 4 shipped drills complete + loop + animate + hide the YOU marker.');
}
