# DRILLS.md — Drill Mode (in progress)

> Status doc for building a **Drill Mode** into this game: browse a drill
> library and watch a drill play out as **real, live simulated gameplay**
> (real AI, real physics ball, real fault detection) — bounded to a fixed
> handful of hits, captured, and then looped as a real, pausable,
> rewindable, scrubbable replay, like a coaching demo reel — so a group of
> friends can look up "how does that drill go again" on a phone at the
> park. "The drill is the drill": a distinct start, starting positions, and
> end, not open-ended AI play. Drill creation/editing (phase 2) is not
> started yet.

This went through four iterations before landing on the current design:

1. **Pass 1** (`src/choreography.js`): players seek-walked toward authored
   positions, step by step, click-through. Rejected — wrong interaction
   model (user wanted continuous auto-play, not manual stepping).
2. **Pass 2** (`src/drillTimeline.js`): a compiler turned authored steps
   into a keyframe timeline played back through `replay.js`'s
   `makePlayback` (the same engine instant replay uses) — smooth,
   scrubbable, camera-switchable. Rejected after testing: **"There is no
   ball and players are literally sliding into place."** Root-caused to a
   real bug, not a taste issue: `Game.prototype._syncMeshes`
   (`src/game.js`) computes a player's body-facing angle from
   `base (fixed, toward the net) + yaw from ball-relative x or lateral
   vel.x only` — it never turns the body to face forward/backward (z)
   travel. That's correct for real rally repositioning (short, ball-reactive
   shuffles) but produces a moonwalk/gliding look for a long, scripted,
   non-rally straight-line translation — exactly what pass 2 produced and
   exactly what real gameplay never does.
3. **Pass 3**: don't fake anything. Run the actual game engine — real AI
   shot/movement decisions, real physics-simulated ball, real `Rules.js`
   fault detection — "directed" just enough to reliably enact a specific
   drill's premise. This is both simpler than another animation system and
   fixes the facing bug at its root, since real AI-driven movement is
   exactly what that formula was tuned against. Left running open-ended,
   though: real AI kept free-playing the rally until a fault happened to
   occur naturally, which could take many exchanges.
4. **Pass 4 (current)**: bound the live rep to a fixed number of hits
   (`DRILL.MAX_SHOTS`), capture it into a real recorder, and loop the
   *recorded replay* of that one bounded sequence forever — reusing
   `replay.js`'s `makePlayback` (the same engine instant replay uses) for
   real pause/rewind/scrub, rather than continuing to re-simulate live
   indefinitely. "The drill is the drill" — a repeatable, teachable
   sequence with a distinct start and end, not a live match that happens to
   be running in the background.

**Correction from an earlier assumption in this doc**: despite
`wrangler.toml` existing in the repo (a Cloudflare deployment experiment
that doesn't need to persist), the actual deployment target is **Vercel**,
same as the sibling `pickleball-drills` repo (Vercel serverless functions +
Neon Postgres). Matters for the phase-2 persistence decision, not this pass.

---

## Current status (read this first)

**Everything below is uncommitted** — working tree only, on `master`, no
commits made. `git status`: modified `index.html`, `src/characters.js`,
`src/constants.js`, `src/game.js`, `src/hud.js`, `src/main.js`,
`src/modes.js`, `test/logic.test.mjs`; new `src/drillDirector.js`,
`src/drillStore.js`, this file. Nothing staged.

**What works, verified live** (not just by reading code — see the
"Verified live" paragraph below for the exact evidence): open the drill
library, tap Drip Practice, and within ~30ms `#drillBar` appears at the
bottom (`● LOADING` → `● LIVE` once the game finishes constructing) with
Steps already populated and Exit already working. The Setup formation
holds, the scripted feed fires, P3's forced drop lands, real AI free-plays
for a couple more exchanges, the rep caps at exactly 4 hits, shows
"REP COMPLETE," and hands off to a real recorded replay loop (`🔁 REPLAY`,
play/pause + scrub + time) that repeats forever. `#hud` (score, music,
camera/pause/info icons) is **fully hidden** the entire time — `#drillBar`
is the only UI. `node test/logic.test.mjs` passes 98/98.

**Nothing else has been asked for or built yet**: no create/edit/delete, no
persistence, no second drill, no venue/roster customization. See "What's
still missing" at the bottom for the full list — that's the natural next
conversation (most likely: pick a persistence approach, since that gates
everything under "administer drills").

**If starting a fresh conversation from here**: read this whole file before
touching drill-mode code — it also documents *why* three earlier designs
were rejected and reworked (fake position animation → sliding-player bug;
open-ended AI play → "plays forever" complaint; the actual fix history is
in "Known issues" below), so the same mistakes don't get repeated.

---

## Architecture

Drill mode is a `mode: 'drill'` `Game`, layered onto the state machine
exactly the way `mode === 'practice'` already is — **not** a bypassed
custom state. This is what makes camera cycling, instant replay, and mesh
sync all work with zero drill-specific code: nothing early-returns before
`update()`'s tail (`_syncMeshes`, `updateCamera`, `this.recorder.record(...)`
all run unconditionally regardless of mode).

- **`src/drillDirector.js`** (new, mutates a `Game` instance — same
  layering as `src/practice.js` staying pure while `game.js` does the
  actual mutation) — the "director." Scripts the *minimum* needed to
  establish a drill's premise, confirmed by the user's own call ("minimal
  scripting, let AI free-play after the opening"), and bounds the live rep
  to a fixed sequence before capturing and looping it:
  - `resetRep(game, drillData)` — snaps all 4 players to the drill's Setup
    formation, resets `match.scores`/`gameOver` (so a long session can
    never trip a real game-over) and the drill's own hit counter, arms the
    Setup-hold timer, and starts a **fresh** `makeRecorder(DRILL.RECORD_WINDOW_SEC)`
    (replacing `game.recorder`) so the eventual capture starts exactly at
    Setup — not a real match's rolling ~10s trailing window, which isn't
    the right shape for "capture one bounded rep from its true start."
  - `fireFeed(game, drillData)` — after the hold, seeds a synthetic
    `match.rally` object directly (bypassing `Rules.startRally()`, since
    P1's feed isn't a legal serve — it's framed as *the return itself*,
    pre-seeding `shots:1` so the serve-box legality check never fires, and
    `doubleBounceOpen:true` so future volleys aren't fault-locked), fires
    a real physics shot via the same `Game.prototype._executeShotV2` the
    practice-mode ball machine uses (counts as hit #1), then arms exactly
    one forced response. `match.server = 'far'` is load-bearing, not
    arbitrary: it makes `strategies/doubles.js`'s existing net-advance
    logic fire P3/P4 to the kitchen specifically after the 3rd shot (the
    drill's own "Resolution" step), and makes P1/P2 advance immediately
    once the feed lands (matching "the moment the ball leaves P1's paddle,
    P1 starts moving forward toward NVZ") — both for free, zero extra
    scripting.
  - `dropShotTarget(p1Pos, KITCHEN, HALF_L)` — the one forced-shot decision:
    P3's next contact must be a `'drop'` at P1's feet. Pure, same
    `{target,apex,spin,type,margin}` shape `AI.chooseShot()` returns, so
    every downstream consumer in `_cpuHit` treats it identically to a real
    AI shot. Deliberately **not** forced to "clean" quality — the real
    stability-based apex degradation stays active, so a late/stretched P3
    arrival can organically produce the drill's own documented "Popup: P2
    attacks" branch. That variability falls out of the existing pipeline
    for free; nothing needs to be scripted for it.
  - After the one forced shot, the director does nothing further *until the
    cap* — real `_tickRally`/`_checkContacts`/`_cpuHit`/`_moveCPU` handle
    everything else, unmodified, up to `DRILL.MAX_SHOTS` (4) total paddle
    contacts.
  - `enterReplayLoop(game)` — once the bounded rep ends (cap or an earlier
    genuine fault), snapshots the fresh recorder's window and hands it to
    `makePlayback`, looped by `Game.prototype._tickDrillReplay` (holds
    briefly on the final frame, then `seek(0)`+`play()`).
- **`src/game.js`** — `mode:'drill'` roster branch in `_initWorld` (all 4
  slots AI-driven, including `players[0]` — first time this game has a
  fully AI roster without the `tools/play.mjs`-style post-construction
  hack), `_updateHuman` gated off for drill mode (it would otherwise fight
  `_moveCPU`'s steering every frame), `_cpuHit`'s one-line forced-shot
  interception (`if (this.drillForcedShot && ...hitter===p) shot =
  DrillDirector.dropShotTarget(...)`) plus its hit-count increment,
  `_checkContacts`'s cap guard (stops processing any hit once
  `drillHitCount >= DRILL.MAX_SHOTS`, so the ball bounces out untouched and
  real "no-return" fault detection ends the point for free), `_endPoint`'s
  drill branch (shows "REP COMPLETE" when the cap was reached, or the real
  fault label for an earlier genuine one — never `_resultMessage()`'s "You
  score!"/"Opponent WINS," meaningless with no human — resets scores, then
  `_tickDrill`'s `STATE.POINT` branch calls `DrillDirector.enterReplayLoop`
  instead of re-simulating a fresh rep), and `_tickDrill`/`_tickDrillReplay`/
  `startDrill`/`cycleCamera`/`drillToggle`/`drillSeek`/`drillReplayInfo`.
- **`src/main.js`** — `startDrillView()` shows `#drillBar` (`● LOADING`,
  Steps pre-populated, Exit already working) and sets `drilling=true`
  *before* the async `preloadAssetPack()`/`Game` construction, so there's
  no blank gap on a real device — then launches `mode:'drill'` with the
  fixed `DRILL_ROSTER`, `superMode:'off'`, `'normal'` difficulty (so the
  scripted cast looks competent rather than fault-prone), no
  `game.setInput()` (no player to drive) and no `game.hud` (`#hud` — score,
  music picker, camera/pause/info icons — stays fully hidden the entire
  session; there's no score and no need for a second control surface).
  `#drillBar` is the only UI: `● LOADING` → `● LIVE` (no transport
  controls yet — nothing recorded) during the bounded live rep, then
  `🔁 REPLAY` plus a play/pause + scrub + time transport row once
  `enterReplayLoop` hands off — `updateDrillBar()` toggles the transport
  row's visibility off `game.drillReplayInfo()` being non-null.
- **`src/characters.js`** — `DRILL_ROSTER`: fixed cast, not user-selectable
  — Owen (P1) + Nina (P2) vs. AJ (P3) + Leo (P4), every drill, every time.
- **`src/drillStore.js`** — one drill for phase 1, **Drip Practice**
  (Cross-Court Dink Rally dropped entirely, per the user's call). Only
  step 0's `positions` (the Setup formation) is read by the engine now;
  steps 1+ carry `title`/`desc` only, shown in the Steps modal as a
  description of what the drill's own AI/physics naturally produce — not a
  script the engine follows.

**Verified live** (headless Playwright, direct `game.state`/`game.match`/
`game.drillPlayback` polling — screenshot-interleaved timing was found
unreliable under headless SwiftShader software rendering in an earlier
pass, so state polling is the trustworthy signal here): tap a drill card →
`#drillBar` shows `● LOADING` within 30ms even under throttled network,
before `game` exists → Setup hold → scripted feed → forced drop shot
correctly consumed by P3 (P4 originally grabbed it in first-draft testing —
see Known issues below) → real AI free-play with natural walk/run
animation (the original "sliding" bug is gone) → `drillHitCount` climbs
1→2→3→4 and **stops exactly at 4** (two real bugs found and fixed getting
here — see Known issues) → "REP COMPLETE" → `enterReplayLoop` captures a
real ~9s window → `#drillBar` flips to `🔁 REPLAY` with a working transport
row → playhead advances 0→duration, holds briefly, **loops back to 0** and
plays again → pause button and scrub-to-0 both work mid-replay → `#hud`'s
computed `display` is confirmed `none` throughout the entire session.
`node test/logic.test.mjs`: 98/98, including coverage of `dropShotTarget`
(pure) and the drill roster shape.

---

## Known issues found during verification (and how they were fixed)

- **The scripted feed's target-x landed in the wrong player's zone.**
  First draft aimed the feed at `P3`'s raw Setup grid coordinate (`F1`,
  positive x). `Game.prototype._responsibleSlot`'s real contact-assignment
  logic (`Rules.rightSlot`/`Rules.sideX`) determines who's "responsible"
  for an incoming ball purely from its x-sign vs. the service-court
  rotation — which didn't match the grid-authored coordinate's sign, so
  the real engine handed the return to P4, not P3, and the forced drop
  shot silently never fired (`drillForcedShot` stayed armed forever,
  caught by direct state polling). Fixed by deriving the feed's target x
  from `Rules.sideX('far', side)` — the same function the engine's own
  responsibility check uses — instead of trusting the authored grid
  coordinate's sign. **This is a sharp edge worth remembering for phase 2
  drill authoring**: a step's grid-coordinate positions and the engine's
  service-court-rotation math are two independent conventions that can
  silently disagree; anything that "aims" a scripted shot needs to target
  by the engine's real responsibility logic, not by an authored coordinate.
- **The bounded-rep cutoff's first design (a decaying grace timer, re-armed
  on every hit) never actually fired.** `drillHitCount` was observed
  climbing to 5, 6, 7... instead of stopping at 4 — caught by polling
  `drillHitCount`/`drillEndGrace` directly. Cause: arming
  `drillEndGrace = DRILL.END_GRACE` on *every* hit past the cap meant each
  new (still-real, still-AI-driven) shot reset the countdown before it
  could expire, since natural shot cadence was faster than the grace
  period. Fixed by moving the cutoff earlier in the pipeline:
  `_checkContacts` now refuses to process *any* hit once
  `drillHitCount >= DRILL.MAX_SHOTS`, so there's nothing left to keep
  resetting a timer — the capping shot's own flight always completes
  because nobody returns it.
- **...but an untouched ball doesn't always fault on its own.**
  `Rules.onFloor`'s "no-return" rule needs *two* bounces with no contact in
  between; a low-energy shot (a `'drop'`, tuned to die quickly) can settle
  after a single bounce and never produce a clean second one, leaving the
  rep stuck in `STATE.RALLY` forever — caught the same way, `drillHitCount`
  frozen at 4 with `drillReplaying` never flipping true even after a
  generous wait. Fixed by keeping `drillEndGrace` as a **backstop only**:
  armed once (not re-armed — `_checkContacts` guarantees no further hits
  can occur to reset it), it forces the point to end if real fault
  detection doesn't get there first. Whichever fires first wins; the timer
  is a safety net, not the primary mechanism.
- **Hiding `#hud` exposed a real loading-time gap.** After removing the
  top HUD entirely (user: "I shouldn't see... any of the controls on top
  of the screen... all controls are baked into our replay"), the user
  reported "the replay bar doesn't display until halfway into a rally."
  `#drillBar`'s own code hadn't changed and displayed correctly in a fast
  headless test, so this wasn't obvious at first — asked a clarifying
  question rather than guess, which narrowed it to "the *whole* bar," not
  just the transport row. Root cause: `#drillBar` only got `.active` added
  *after* `preloadAssetPack()` (real network/asset time, arbitrarily long
  on a real device) and `Game` construction both finished — previously
  masked because `#hud` was visible during that gap; now nothing was.
  Fixed by moving `drilling=true`/`.active`/the Steps content render to the
  very start of `startDrillView()`, before the async asset load, with the
  badge showing `● LOADING` until the game exists — confirmed via a
  network-throttled test that the bar (and a working Exit button) appear
  within 30ms of tapping a drill card, well before `game` exists.

---

## What's still missing (phase 2+)

1. **No create/edit/delete.** Still the actual point of "administer
   drills" — entirely unbuilt. `drillStore.js` is a hardcoded module.
2. **No persistence layer.** Real deployment target is Vercel (see
   correction above) — a Vercel-functions + Postgres approach (mirroring
   `pickleball-drills` almost exactly) is now the natural default, unlike
   the earlier (wrong) assumption that Cloudflare Workers/KV would be
   needed.
3. **Only one drill exists** (Drip Practice). Cross-Court Dink Rally was
   dropped, not migrated — a stationary dinking drill doesn't need the
   director's "opening feed + forced shot" shape at all; if it comes back,
   it likely wants a different, simpler drill "type" (e.g. no scripted
   feed, just a Setup formation and let real dinking AI take over), which
   argues for the drill schema eventually supporting more than one
   director "shape," not just Drip Practice's.
4. **Only 4-player, fixed-roster drills.** `DRILL_ROSTER`/`drillDirector.js`
   assume exactly P1-P4 with a specific cast; no sub-4 or user-selectable
   cast support.
5. **Launch config (venue/palette/time-of-day) is hardcoded** — always
   park/blue/day, regardless of any prior flow picks.

## What to decide before writing more code

- **Persistence** (gap #2) — gates everything under "administer."
- **Drill "shape" generalization** (gap #3) — Drip Practice's director
  (Setup → scripted feed → one forced shot → free-play) is one shape; a
  stationary dinking drill or a serve-practice drill would need a
  different one. Worth deciding whether phase 2's authoring model exposes
  a small set of director "templates" or something more general.
- **Scope of v1 CRUD** — full authoring UI (roles, tags, notes, a
  grid-coordinate picker, scripted-beat editor) vs. a trimmed subset.
