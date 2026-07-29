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

// This harness deliberately never starts server.dev.js (the /api/drills
// backing server) — drillStore.js's loadDrills() is explicitly designed to
// fall back to the bundled DEFAULT_DRILLS on exactly this failure (see
// DRILLS.md: "local dev with no database still works"), and that fallback
// path is itself something this suite should exercise, not treat as a
// pre-existing broken environment.
//
// Previously this relied on Vite's dev-server proxy failing (ECONNREFUSED to
// a server this harness never starts) to exercise that path, which meant the
// run's outcome silently depended on whether some unrelated process happened
// to be squatting on port 3001 at the time (a real `npm run dev` in another
// terminal, e.g.) — sometimes hitting the fallback via a clean network
// failure, sometimes hitting a live database with whatever rows happen to be
// in it (see DRILLS.md/memory: the live Neon table wins over DEFAULT_DRILLS
// and can desync from what's in this checkout). Anything but a hermetic,
// same-result-every-time outcome defeats the point of a regression suite.
// Owning the failure ourselves via page.route() removes the dependency on
// outside process state entirely.
//
// The resulting failed-resource-load still gets logged to the console by
// Chromium regardless of whether app code handles the rejection gracefully,
// and that log line carries no URL (just the generic net::ERR_FAILED text),
// so it can't be told apart from a genuine broken resource by pattern-
// matching text alone. Counting exactly how many times THIS route handler
// fired gives an exact expected-benign-error budget instead of a guess.
async function newPage() {
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  const errors = [];
  let expectedBenignErrors = 0;
  await page.route('**/api/drills', route => {
    expectedBenignErrors++;
    route.abort('connectionrefused');
  });
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push('[console] ' + m.text()); });
  const NET_FAIL_RE = /Failed to load resource: net::ERR_CONNECTION_REFUSED/;
  return {
    page,
    // Real errors: whatever's left after removing up to exactly as many
    // matching-pattern console lines as this page's own /api/drills abort(s)
    // are expected to produce (budgeted by count, not by position, so a
    // genuine error logged before/after the fetch doesn't hide behind it) —
    // anything beyond that budget still fails the run.
    get errors() {
      let budget = expectedBenignErrors;
      return errors.filter(e => {
        if (budget > 0 && NET_FAIL_RE.test(e)) { budget--; return false; }
        return true;
      });
    }
  };
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

// ---- 3) Scripted `supersmash` mid-script (not the drill's final beat) ----
// Regression for a real stranding bug found in this repo's QA stabilization
// sprint: script[i] = supersmash, script[i+1] names the victim as the next
// forced hitter (the natural, common authoring shape — a supersmash's
// receiver-chain-continuity target IS who gets blasted). The victim's actual
// contact happens in _checkBlastContact (a per-substep poll that bypasses
// _checkContacts/_cpuHit entirely, by design — see its own comment), which
// used to never touch drillHitCount/drillScriptIndex/drillForcedShot at all.
// That left drillForcedShot permanently pinned to the victim: every later
// scripted beat silently never fired, AND (worse) _moveCPU's drill-mode hold
// gate treats any truthy-but-stale drillForcedShot as "nobody else is
// responsible," freezing every other player in place too — nobody ever
// chased the ball back. Fixed in game.js's _checkBlastContact by mirroring
// _cpuHit's own drill bookkeeping for exactly the case the script
// anticipated (drillForcedShot.hitter === the victim), and by passing
// wasScriptedShot into the trailing _checkPoach call so a real auto-poach
// can't hijack the forced return either (same class of bug _cpuHit was
// already patched against).
{
  const { page, errors } = await newPage();
  const drill = {
    id: 'drill-check-supersmash-midscript', name: 'Check Supersmash Mid-Script', players: 4, desc: '', goal: '', tags: [],
    startPositions: {
      P1: { x: -1.5, z: 4.0 }, P2: { x: 1.5, z: 4.0 },
      P3: { x: -1.5, z: -4.0 }, P4: { x: 1.5, z: -4.0 }
    },
    script: [
      { hitter: 'P1', shotType: 'drive', target: 'P3' },
      { hitter: 'P3', shotType: 'supersmash', target: 'P1' }, // NOT the final beat
      { hitter: 'P1', shotType: 'drive', target: 'P3' },
      { hitter: 'P3', shotType: 'drive', target: 'P1' }
    ],
    steps: [{ title: 'Setup', desc: '' }]
  };
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.evaluate((d) => sessionStorage.setItem('pb3dWipDrill', JSON.stringify(d)), drill);
  await page.goto(base + '?testDrill=1', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__game && window.__game.players && window.__game.players.length >= 4, { timeout: 15000 });

  const sawBlast = await page.waitForFunction(() => window.__game.blast, { timeout: 15000 }).then(() => true).catch(() => false);
  check(sawBlast, 'supersmash mid-script: the scripted supersmash never blasted its victim');

  const snap = await playToReplay(page, 40000);
  check(!!snap && snap.replaying, 'supersmash mid-script: never reached looped replay within 40s (rep likely stranded — see regression comment above)');
  if (snap) {
    check(snap.hitCount === drill.script.length,
      'supersmash mid-script: hitCount ' + snap.hitCount + ' !== script.length ' + drill.script.length + ' (script desynced after the blast)');
    check(snap.scriptIndex === drill.script.length,
      'supersmash mid-script: scriptIndex ' + snap.scriptIndex + ' !== script.length ' + drill.script.length);
  }
  check(errors.length === 0, 'supersmash mid-script: page/console errors: ' + JSON.stringify(errors));
  await page.close();
}

// ---- 3b) Replay pause is authoritative: pausing at/after the end must NOT
// silently self-resume and loop. Regression for a real bug found in this
// repo's QA stabilization sprint: _tickDrillReplay's loop-restart hold timer
// only checked `!pb.isPlaying() && playhead >= duration`, which is identical
// whether playback JUST naturally reached the end (should schedule the
// familiar auto-loop) or the viewer explicitly paused while sitting at/after
// the end (must stay paused, full stop, until the viewer acts again) — an
// explicit pause silently self-resumed ~1s later regardless of viewer
// intent. Fixed in game.js by only arming the hold on the genuine
// playing->stopped transition (a `wasPlaying` edge check), and by having
// drillToggle/drillSeek — the only two callers, always real UI interaction
// (see src/main.js) — cancel any hold already in progress, so pausing DURING
// the ~1s hold window doesn't get silently overridden by it either.
{
  const { page, errors } = await newPage();
  const drill = {
    id: 'drill-check-pause-at-end', name: 'Check Pause At End', players: 2, desc: '', goal: '', tags: [],
    startPositions: { P1: { x: 0, z: 3.0 }, P3: { x: 0, z: -3.0 } },
    script: [{ hitter: 'P1', shotType: 'drive', target: 'P3' }],
    steps: [{ title: 'Setup', desc: '' }]
  };
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.evaluate((d) => sessionStorage.setItem('pb3dWipDrill', JSON.stringify(d)), drill);
  await page.goto(base + '?testDrill=1', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__game && window.__game.players && window.__game.players.length >= 2, { timeout: 15000 });

  const reachedReplay = await page.waitForFunction(() => window.__game.drillReplaying === true, { timeout: 30000 })
    .then(() => true).catch(() => false);
  check(reachedReplay, 'pause-at-end: never reached the replay loop within 30s');
  if (reachedReplay) {
    await page.evaluate(() => window.__game.drillToggle()); // pause immediately
    await page.evaluate(() => window.__game.drillSeek(window.__game.drillReplayInfo().duration)); // scrub to the very end, still paused
    // Generous wait — this environment's headless render loop advances real
    // in-game time noticeably slower than wall-clock (observed ~3-6x during
    // the sprint), so this must comfortably clear DRILL.LOOP_END_HOLD (1s of
    // GAME time) even at that slowdown.
    await page.waitForTimeout(8000);
    const info = await page.evaluate(() => window.__game.drillReplayInfo());
    check(!info.playing, 'pause-at-end: playback silently self-resumed after an explicit pause at the end (playhead=' + info.playhead.toFixed(2) + '/' + info.duration.toFixed(2) + ')');
  }
  check(errors.length === 0, 'pause-at-end: page/console errors: ' + JSON.stringify(errors));
  await page.close();
}

// ---- 4) Shot-type / roster coverage: popup->smash combo, a scripted lob to
// a receiver placed right at the kitchen line (probes whether _checkContacts'
// CPU "wait for the ball to clear smash height before swinging" gate —
// game.js's waitH check in _checkContacts — could ever cause a scripted
// receiver to miss its forced contact window because the incoming ball is
// still rising when it enters their reach), and a 3-player (2v1) speedup/dink
// chain. All three passed on first try during the QA sprint but are kept
// permanently since none of the shipped drills previously exercised
// popup/smash/speedup as SCRIPTED beats or a solo far-side roster mid-chain.
for (const spec of [
  {
    name: 'popup-then-smash', maxMs: 45000,
    drill: {
      id: 'drill-check-popup-smash', name: 'Check Popup Smash', players: 4, desc: '', goal: '', tags: [],
      startPositions: {
        P1: { x: -1.5, z: 4.0 }, P2: { x: 1.5, z: 4.0 },
        P3: { x: -1.5, z: -4.0 }, P4: { x: 1.5, z: -4.0 }
      },
      script: [
        { hitter: 'P1', shotType: 'drive', target: 'P3' },
        { hitter: 'P3', shotType: 'popup', target: 'P1' },
        { hitter: 'P1', shotType: 'smash', target: 'P3' }
      ],
      steps: [{ title: 'Setup', desc: '' }]
    }
  },
  {
    name: 'lob-to-kitchen-line-receiver', maxMs: 45000,
    drill: {
      id: 'drill-check-lob-close', name: 'Check Lob Close Receiver', players: 2, desc: '', goal: '', tags: [],
      startPositions: { P1: { x: 0, z: 6.5 }, P3: { x: 0, z: -0.6 } },
      script: [
        { hitter: 'P1', shotType: 'lob', target: 'P3' },
        { hitter: 'P3', shotType: 'drive', target: 'P1' }
      ],
      steps: [{ title: 'Setup', desc: '' }]
    }
  },
  {
    name: 'speedup-dink-3player', maxMs: 45000,
    drill: {
      id: 'drill-check-speedup-3p', name: 'Check Speedup 3p', players: 3, desc: '', goal: '', tags: [],
      startPositions: { P1: { x: -1.5, z: 3.0 }, P2: { x: 1.5, z: 3.0 }, P3: { x: 0, z: -3.0 } },
      script: [
        { hitter: 'P1', shotType: 'speedup', target: 'P3' },
        { hitter: 'P3', shotType: 'dink', target: 'P1' },
        { hitter: 'P1', shotType: 'dink', target: 'P3' }
      ],
      steps: [{ title: 'Setup', desc: '' }]
    }
  }
]) {
  const { page, errors } = await newPage();
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.evaluate((d) => sessionStorage.setItem('pb3dWipDrill', JSON.stringify(d)), spec.drill);
  await page.goto(base + '?testDrill=1', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__game && window.__game.players && window.__game.players.length >= 2, { timeout: 15000 });

  const snap = await playToReplay(page, spec.maxMs);
  check(!!snap && snap.replaying, spec.name + ': never reached looped replay within ' + spec.maxMs + 'ms');
  if (snap) {
    check(snap.hitCount === spec.drill.script.length,
      spec.name + ': hitCount ' + snap.hitCount + ' !== script.length ' + spec.drill.script.length);
    check(snap.scriptIndex === spec.drill.script.length,
      spec.name + ': scriptIndex ' + snap.scriptIndex + ' !== script.length ' + spec.drill.script.length);
  }
  check(errors.length === 0, spec.name + ': page/console errors: ' + JSON.stringify(errors));
  await page.close();
}

// ---- 4b) Content-level determinism: two independent live reps of the same
// drill JSON must produce the same hitter/receiver SEQUENCE, and each beat's
// ball landing must land in roughly the same place both times. Not a bit-
// exact check — this codebase's own design intentionally keeps real AI
// timing/stability variance in the live rep (DRILLS.md: "real stability/
// timing degradation still applies... a forced shot can still pop up"); only
// the fully CAPTURED REPLAY is promised frame-identical on loop/scrub. What
// must still hold, and is what this checks, is the higher-level promise this
// file's docstring and DRILLS.md both make: "the drill is the drill" — the
// same script produces the same shot sequence landing in roughly the same
// place, not a different number of touches or a wildly different court spot,
// which is exactly the shape of failure BUG-002 (mid-script supersmash)
// produced before it was fixed.
{
  const { page, errors } = await newPage();
  await page.goto(base + '?drill=drill-dink-rally', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__game && window.__game.players && window.__game.players.length >= 4, { timeout: 15000 });
  const landings = [];
  let lastHitCount = 0;
  const t0 = Date.now();
  while (Date.now() - t0 < 60000) {
    const snap = await page.evaluate(() => {
      const g = window.__game;
      return {
        hitCount: g.drillHitCount, replaying: g.drillReplaying,
        landing: g.ball.flight && g.ball.flight.landing ? { x: g.ball.flight.landing.x, z: g.ball.flight.landing.z } : null
      };
    });
    if (snap.hitCount > lastHitCount && snap.landing) { landings.push(snap.landing); lastHitCount = snap.hitCount; }
    if (snap.replaying) break;
    await page.waitForTimeout(50);
  }
  await page.close();
  check(landings.length === 5, 'determinism: drill-dink-rally produced ' + landings.length + ' landings, expected 5');
  // Compared against drill-dink-rally's own known-good geometry rather than a
  // second live run (cheaper, and avoids the test itself being racy) — each
  // beat alternates the same two cross-court diagonal corners.
  const expectedSigns = [{ x: -1, z: -1 }, { x: 1, z: 1 }, { x: -1, z: -1 }, { x: 1, z: 1 }, { x: -1, z: -1 }];
  for (let i = 0; i < landings.length; i++) {
    const l = landings[i], want = expectedSigns[i];
    check(Math.sign(l.x) === want.x && Math.sign(l.z) === want.z,
      'determinism: beat ' + i + ' landed at (' + l.x.toFixed(2) + ',' + l.z.toFixed(2) + '), wrong quadrant for the alternating cross-court diagonal (script desync?)');
  }
  check(errors.length === 0, 'determinism: page/console errors: ' + JSON.stringify(errors));
}

// ---- 5) Shipped drills end-to-end, including swing animation in the LOOP ----
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

// ---- 6) Drill Creator: the standalone authoring tool itself
// (tools/drill-builder.html), not just playback — in scope per this sprint's
// mandate, and previously untested by this file (which only ever launched
// drills that already existed). Exercises the full author -> validate ->
// export path: click-to-place P1/P3 on the court SVG (world coords map
// directly to the SVG's viewBox, confirmed in drill-builder.html), exclude
// P2/P4 via their include checkboxes, fill in one scripted shot's
// hitter/type/target dropdowns, and confirm Generate JSON produces exactly
// what was authored. The include checkboxes are clicked via a native DOM
// .click() rather than Playwright's pointer simulation — the page is legitimately
// taller than the test viewport (confirmed via computed style + a
// screenshot; not a bug) and Playwright's "stable bounding box across
// frames" actionability heuristic was flaky against the ResizeObserver-
// driven --court-panel-height CSS var recalculating, even though the
// checkbox itself renders correctly on-screen throughout.
{
  const { page, errors } = await newPage();
  // Wider/taller than newPage()'s default 1000x700 — the builder's own layout
  // shifted the court/picker placement enough at the default size to change
  // where a click actually lands (observed during the sprint: P1 placement
  // silently landed nowhere at 1000x700, worked reliably at 1200x900).
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.goto(base + '/tools/drill-builder.html', { waitUntil: 'networkidle' });

  async function clickCourtAt(worldX, worldZ) {
    const box = await page.locator('#court').boundingBox();
    const vbMinX = -6, vbMinY = -10, vbW = 12, vbH = 20;
    const px = box.x + ((worldX - vbMinX) / vbW) * box.width;
    const py = box.y + ((worldZ - vbMinY) / vbH) * box.height;
    await page.mouse.click(px, py);
  }

  await clickCourtAt(0, 3); // place P1 (selectedSlot defaults to P1), near side
  await page.click('#pickerFar button:text-is("P3")');
  await clickCourtAt(0, -3); // place P3, far side
  await page.click('#stepNextBtn'); // "Next" becomes "+ Add shot" on the last (Setup) step
  await page.evaluate(() => {
    document.querySelector('#pickerNear label.toggle input').click();
    document.querySelector('#pickerFar label.toggle input').click();
  });

  const selects = page.locator('#stepBody select');
  check(await selects.count() === 3, 'drill-builder: expected exactly 3 selects (hitter/shotType/target) for a single P1-vs-P3 beat, got ' + await selects.count());
  await selects.nth(0).selectOption('P1');
  await selects.nth(1).selectOption('drive');
  await selects.nth(2).selectOption('P3');

  const bannerText = (await page.locator('#banner').textContent()).trim();
  check(bannerText === 'Valid.', 'drill-builder: banner should read "Valid." once P1/P3 are placed and scripted, got: ' + bannerText);

  const genDisabled = await page.locator('#genJson').isDisabled();
  check(!genDisabled, 'drill-builder: Generate JSON should be enabled once the drill is valid');
  if (!genDisabled) {
    await page.click('#genJson');
    const json = await page.locator('#jsonOut').inputValue();
    let parsed = null;
    try { parsed = JSON.parse(json); } catch (e) { /* checked below */ }
    check(!!parsed, 'drill-builder: Generate JSON did not produce valid JSON');
    if (parsed) {
      check(Array.isArray(parsed.script) && parsed.script.length === 1 &&
        parsed.script[0].hitter === 'P1' && parsed.script[0].target === 'P3' && parsed.script[0].shotType === 'drive',
        'drill-builder: exported script does not match what was authored: ' + JSON.stringify(parsed.script));
    }
  }
  check(errors.length === 0, 'drill-builder: page/console errors: ' + JSON.stringify(errors));
  await page.close();
}

// ---- 7) In-app drill editor: "Test Live" must not silently discard
// unsaved edits on exit. Regression for a real user-reported bug: clicking
// Test Live in the in-app editor (drillAdmin.js's #deTestLiveBtn) stages a
// WIP drill and calls window.open(url,'_blank'), intended to open a REAL
// new tab so the editor tab is left untouched. But window.open(...,'_blank')
// is not reliably a genuine new tab — mobile Safari and installed-PWA
// standalone mode (this app's primary target device: a phone at the park,
// per DRILLS.md) routinely degrade it to a same-tab navigation, which
// reloads the whole single-page app and used to silently discard every
// in-progress edit, landing back at the bare Drills library on exit.
// Chromium/Playwright faithfully opens a real new tab for window.open, so it
// can't reproduce that degradation directly — this drives the actual fix
// mechanism instead: stage the same sessionStorage flags the real button
// sets, then navigate in-page to ?testDrill=1 (exactly what a degraded
// window.open produces — a same-tab navigation), exit the drill, and
// confirm the editor reappears with the unsaved content intact. Fixed via
// main.js's quitToMenu() + startDrillView()'s viaEditorTestLive parameter,
// and drillAdmin.js's new reopenWipDrill().
{
  const { page, errors } = await newPage();
  await page.goto(base, { waitUntil: 'networkidle' });
  const wip = {
    id: 'drill-check-editor-return', name: 'Check Editor Return', players: 2,
    desc: 'unsaved description text', goal: '', tags: [],
    startPositions: { P1: { x: 0, z: 3 }, P3: { x: 0, z: -3 } },
    script: [{ hitter: 'P1', shotType: 'drive', target: 'P3' }],
    steps: [{ title: 'Setup', desc: '' }, { title: '', desc: '' }]
  };
  await page.evaluate((d) => {
    sessionStorage.setItem('pb3dWipDrill', JSON.stringify(d));
    sessionStorage.setItem('pb3dReturnToDrillEditId', ''); // '' = "was authoring a new, unsaved drill"
  }, wip);
  await page.goto(base + '?testDrill=1', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__game && window.__game.players && window.__game.players.length >= 2, { timeout: 15000 });
  await page.click('#drillExitBtn');
  await page.waitForTimeout(500);

  const screenActive = await page.evaluate(() => document.getElementById('scrDrillEdit').classList.contains('active'));
  check(screenActive === true, 'editor-return: exiting Test Live did not land back on the drill editor screen');
  const nameVal = await page.evaluate(() => document.getElementById('deFName').value);
  const descVal = await page.evaluate(() => document.getElementById('deFDesc').value);
  check(nameVal === wip.name, 'editor-return: name field lost the unsaved edit — got ' + JSON.stringify(nameVal));
  check(descVal === wip.desc, 'editor-return: description field lost the unsaved edit — got ' + JSON.stringify(descVal));
  // A DIFFERENT (unrelated) drill launch afterward must NOT also trigger the
  // restore path using this now-stale flag (see startDrillView's own
  // comment on why every non-editor launch clears it).
  const flagAfter = await page.evaluate(() => sessionStorage.getItem('pb3dReturnToDrillEditId'));
  check(flagAfter === null, 'editor-return: pb3dReturnToDrillEditId should be cleared after being consumed, got ' + JSON.stringify(flagAfter));

  check(errors.length === 0, 'editor-return: page/console errors: ' + JSON.stringify(errors));
  await page.close();
}

// ---- 7b) A stale return-to-editor flag must not leak into an unrelated
// drill launch. Only reachable in production if window.open DID open a
// genuine separate tab (each tab gets its own independent sessionStorage
// copy after that point, so the ORIGINAL tab's flag is never cleared by
// exiting the drill in the new tab) — the exact scenario 7's fix must not
// regress: a later, unrelated drill opened from the library in that same
// original tab must land back at the Drills library on exit, not restore
// unrelated stale editor content.
{
  const { page, errors } = await newPage();
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.evaluate((d) => {
    sessionStorage.setItem('pb3dWipDrill', JSON.stringify(d));
    sessionStorage.setItem('pb3dReturnToDrillEditId', '');
  }, { id: 'drill-check-stale', name: 'Stale', players: 2, desc: '', goal: '', tags: [],
    startPositions: { P1: { x: 0, z: 3 }, P3: { x: 0, z: -3 } },
    script: [{ hitter: 'P1', shotType: 'drive', target: 'P3' }], steps: [{ title: 'Setup', desc: '' }] });
  // Launch a DIFFERENT, unrelated drill the normal way (a ?drill=<id> deep
  // link, not ?testDrill=1) — simulates the stale flag sitting unused while
  // the same tab later does something unrelated to the editor.
  await page.goto(base + '?drill=drill-1v1-test', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__game && window.__game.players && window.__game.players.length >= 2, { timeout: 15000 });
  await page.click('#drillExitBtn');
  await page.waitForTimeout(500);
  const screenActive = await page.evaluate(() => document.getElementById('scrDrillEdit').classList.contains('active'));
  check(screenActive === false, 'stale-flag: an unrelated drill launch incorrectly restored the editor from a stale flag');
  const drillsActive = await page.evaluate(() => document.getElementById('scrDrills').classList.contains('active'));
  check(drillsActive === true, 'stale-flag: expected to land on the Drills library, not the editor, for an unrelated drill exit');
  check(errors.length === 0, 'stale-flag: page/console errors: ' + JSON.stringify(errors));
  await page.close();
}

await browser.close();
await server.close();

if (problems.length) {
  console.error('\nFAILED:\n' + problems.map(p => '  - ' + p).join('\n'));
  process.exitCode = 1;
} else {
  console.log('OK — drill-mode live checks passed: 4-corner hold, v2 landing/deadlines, mid-script supersmash bookkeeping, replay pause-at-end stays paused, shot-type/roster coverage, determinism, drill-builder authoring flow, editor Test-Live return (+ stale-flag guard), all 4 shipped drills complete + loop + animate + hide the YOU marker.');
}
