# DRILLS.md — Drill Mode

> Browse a drill library and watch a drill play out as **real, live
> simulated gameplay** (real AI, real physics ball, real fault detection) —
> bounded to a fixed handful of hits, captured, and then looped as a real,
> pausable, rewindable, scrubbable replay, like a coaching demo reel — so a
> group of friends can look up "how does that drill go again" on a phone at
> the park. "The drill is the drill": a distinct start, positions, and end,
> not open-ended AI play. This file documents current state; read it in
> full before touching drill-mode code.

---

## Design history (why it's built this way)

Four passes before the live-simulation approach landed:

1. **Players seek-walked to authored positions, step by step, click-through**
   (`src/choreography.js`, retired). Rejected — wrong interaction model
   (continuous auto-play was wanted, not manual stepping).
2. **A keyframe timeline compiled from authored steps**, played back through
   `replay.js`'s `makePlayback` (`src/drillTimeline.js`, retired). Rejected:
   "There is no ball and players are literally sliding into place." Root
   cause: `Game.prototype._syncMeshes`'s facing-angle formula only reacts to
   ball-relative/lateral movement, never scripted forward/backward travel —
   correct for real rally repositioning, wrong for a long scripted
   straight-line walk. **This is why player movement is never scripted in
   the current design, only ball contacts** — real AI-driven movement is
   exactly what that facing formula is tuned against.
3. **Run the real engine, directed just enough to enact a premise**, left
   open-ended. Fixed the sliding bug at the root, but real AI free-played
   until a fault happened to occur naturally — could take many exchanges.
4. **Bound the live rep to a fixed hit count, capture it, loop the replay**
   forever instead of re-simulating indefinitely — the current design.

**Schema evolution**: an initial `type`-keyed `SHAPES` dispatch table (one
hardcoded "shape" per drill) was replaced by a general `script` — an ordered
list of scripted shots — after it became clear two shapes wasn't enough and
hand-authoring kept producing geometrically wrong drills from prose
descriptions. (Called `script`, not `beats` — "beat" is screenwriting/music
jargon that caused real confusion when read cold.)

**A real bug, not a hard limit**: for a while, a `script` target had to be
authored on a specific fixed "responsibility zone" (positive/negative world-x
depending on slot) or the engine would silently hand the return to their
partner instead. This produced confusing failures — `P1 drive P3` then
`P3 drive P1`, an obviously reasonable back-and-forth, failed validation for
a reason with no sensible authoring-side explanation — and forced Drip
Practice into an unintuitive `P1`↔`P4` pairing instead of the natural
`P1`↔`P3`. Root-caused and fixed (see Architecture below): the constraint
doesn't exist anymore. Drip Practice uses its natural `P1`↔`P3` pairing.

**Roster evolution**: fixed 4-player (2v2) only, then generalized to 2, 3,
or 4 players (1-2 per side, P1/P3 always the anchor).

**Deployment target**: despite `wrangler.toml` existing in the repo (a
Cloudflare experiment that doesn't need to persist), the real target is
**Vercel** — same as the sibling `pickleball-drills` repo (Vercel serverless
functions + Neon Postgres). Matters for the still-open persistence gap, not
current gameplay.

---

## Architecture (current state)

Drill mode is a `mode: 'drill'` `Game`, layered onto the state machine
exactly the way `mode === 'practice'` already is — not a bypassed custom
state. Nothing early-returns before `update()`'s tail (`_syncMeshes`,
`updateCamera`, `this.recorder.record(...)` all run unconditionally
regardless of mode), which is what makes camera cycling, instant replay, and
mesh sync all work with zero drill-specific code.

### Schema (`src/drillStore.js`)

```js
{
  id, name, desc, goal, tags, players,   // players is a display count, informational
  startPositions: { P1: 'F10', P2: 'D7', P3: 'F1', P4: 'C2' },  // grid coords or raw {x,z}; only present slots are in the roster
  script: [
    { hitter: 'P1', shotType: 'drive', target: 'P3' },
    { hitter: 'P3', shotType: 'drop',  target: 'P1', players: { P1: { to: 'F8', behavior: 'recover', arriveBy: 'bounce' } } },
    { hitter: 'P1', shotType: 'lob', receiver: 'P4', landing: 'G2' } // receiver is separate from landing
  ],
  steps: [{ title, desc }, ...]            // pure on-screen narration, NOT read by the engine
}
```

No separate `maxShots` cap exists anymore — the rep ends EXACTLY when `script`
runs out (`game.js`'s `_drillMaxShots()` is always `script.length`), never
with extra undirected AI touches tacked on. If you author N scripted shots,
you get exactly N hits, every rep, every time. A `script` entry can also
carry optional per-player directives (`players: { P1: {to, behavior,
arriveBy} }`) that arm the instant that beat's shot fires; see "Player
directives" below. Legacy `moves: [{player, to}]` entries still load.

- **Roster is variable**: 2, 3, or 4 players, derived purely from which
  `P1`-`P4` keys exist in `startPositions` (`activeSlotsOf(drill)`, exported
  from `drillStore.js`). **P1 (near) and P3 (far) are always present** — the
  anchors; **P2 and P4 are each independently optional**, as long as at
  least one player ends up on each side. A solo player is always P1 or P3,
  never P2/P4 alone — sidesteps a real correctness trap (see below).
- **Teams are fixed, not a per-drill choice**: P1+P2 are always partners on
  the near side of the net; P3+P4 always partners on the far side — same as
  every other game mode, derived from `drillDirector.js`'s `SLOT_INFO` (the
  single source of truth for the P-slot-to-engine mapping: team, team-slot,
  character-roster-key).
- **`script`** is the ordered shot sequence: `script[0]` is the opener,
  fired directly; `script[1+]` are forced responses, armed one at a time and
  resolved through the same AI-shot-execution pipeline real free-play uses
  (so real stability/timing degradation still applies — a forced shot can
  still pop up). The rep ends the instant `script` runs out — no undirected
  free-play tail. `shotType` is any of `Shots.TYPES`
  (`drive`/`drop`/`dink`/`lob`/`speedup`) plus `smash`. Legacy entries use
  `target` as both the receiver and the body-position landing proxy. v2
  entries can use `receiver` plus `landing` to separate "who must play the
  next ball" from "where the ball lands." `receiver`/`target` must always be
  a player slot on the hitter's OPPOSING team — a shot can't be aimed at
  your own partner.
- **Player directives (`players`, optional per beat)**: keyed by player slot,
  e.g. `players: { P2: { to: 'D7', behavior: 'shadow', arriveBy:
  'contact' } }`. They arm the instant that beat's shot fires
  (`drillDirector.js`'s `armMovesForBeat`), directing any active player
  (the hitter's own recovery, or a partner's poach/shadow) toward a spot.
  `behavior` is authored intent metadata (`move`/`recover`/`shadow`/
  `crash`/`retreat`/`switch`/`chase`/`hold`); `arriveBy` is timing metadata
  (`none`/`bounce`/`contact`/`ball-contact`/`next-contact`). `bounce` uses
  the current solved `ball.flight.T`; the three contact spellings are
  aliases for the next paddle contact, estimated from the first hittable
  cached flight sample near the solved landing (with
  `DRILL.CONTACT_AFTER_BOUNCE` as a sparse/legacy-flight fallback). The
  runtime simulates the existing
  `Movement.seek()` path against cloned state to choose the lowest real
  movement speed that can satisfy the deadline. If even the player's normal
  top speed cannot make it, the player still runs at that real top speed and
  `game.drillWarnings` receives a one-time authoring warning — positions are
  never faked. Directives only
  ever override the steering TARGET fed into the existing per-frame
  `Movement.seek()` call (`game.js`'s `_moveCPU`) — never position directly
  — so real accel/decel physics still produces the resulting velocity/
  animation, the same load-bearing property that made the sliding-artifact
  fix (Pass 2, above) stick. Cues are fire-and-forget: non-blocking, cleared
  on arrival, always overridden by real ball responsibility, and an
  outstanding cue persists across later beats unless one re-issued for that
  slot. Legacy `moves: [{player, to}]` are normalized into this same runtime
  queue for backward compatibility. This is also the replacement for what
  free-play-after-script used to paper over (shadowing/coverage) — script it
  explicitly instead.
- **`validateDrill(drill)`** (`drillStore.js`) — the only authoring
  constraints: roster shape (at least one player per side; P2 can't exist
  without P1, P4 can't exist without P3; optional `players` count must match
  `startPositions`), legal own-side starting positions, minimum spacing,
  every script `hitter` and effective receiver (`receiver || target`) in
  the active roster, cross-net receivers, receiver-chain continuity
  (`script[i]`'s receiver must be `script[i+1].hitter`), valid shot types,
  legal explicit `landing` points, and well-formed `players`/legacy `moves`
  (one directive per player per beat, on that player's own side). Returns a list of
  human-readable errors; used in `test/drill.test.mjs` and live by the
  builder tool. **There is no lane/zone-sign constraint** — a script
  receiver can be authored anywhere on their own side of the net (see below
  for why that's safe).

### Director (`src/drillDirector.js`)

- **`SLOT_INFO`** — canonical `{P1: {team, teamSlot, rosterKey}, ...}` table,
  the single source of truth every other drill-aware module derives from.
- **`resolvePlayer(game, slotKey)`** — scans `game.players` for a
  `.drillSlot` tag (stamped on each player at construction), not array-index
  math — robust to a roster that isn't always 4 entries in a fixed order.
- **`resetRep(game, drillData)`** — snaps active players to their Setup
  positions (iterating `Object.keys(startPositions)`, not a hardcoded
  4-loop), resets `match.scores`/`gameOver` (a long session can never trip
  a real game-over) and the drill's own counters, arms the Setup-hold timer,
  starts a fresh recorder sized to capture one bounded rep from its true
  start.
- **`fireOpeningShot(game, drillData)`** — fires `script[0]` directly via
  `_executeShotV2` (a table-setting injection, no timing/stability noise,
  but still with visible swing/audio/contact feedback). Seeds a synthetic `match.rally`
  already "deep in" (`shots: 4`, `phase: 'open'`) rather than framing it as a
  serve or return: skips `Rules.onFloor`'s shots===1 serve-fault check on
  the first bounce, and clears `strategies/doubles.js`'s `advanceAllowed`
  threshold (>=3) so both teams read as "already at the net" immediately.
  Legacy entries target the named receiver's actual live position (x and z)
  directly; v2 entries with `landing` target that explicit court spot while
  keeping the named receiver responsible for the next contact. Then arms
  `script[1]` via `armNextScriptedShot`.
- **`getScriptedShot(game, drillData, scriptIndex, hitterPlayer)`** — the
  forced-shot computation for the current script index; same
  `{target, apex, spin, type, margin}` shape `AI.chooseShot()` returns.
- **`armNextScriptedShot(game, drillData)`** — arms `game.drillForcedShot`
  for the next script entry, or clears it once the list runs out. Same
  "arm now, resolve later when the ball actually arrives" shape as
  poaching/the super's blast — chained across an index, not a single flag.
- **`clampLandingZ(z)`** — a target's authored *standing* position can
  legitimately sit just behind the real baseline (grid rows 1/10 resolve to
  `z=±7.5`, past `HALF_L=±6.706`, matching a natural stance); aiming a
  shot's landing point exactly there before the target has moved (always
  true for `script[0]`) sent the ball out of bounds. Clamped to
  `HALF_L*0.92` (same convention `shots.js`'s `aimDepth` uses).

### The responsibility-zone fix (`src/game.js`)

The zone constraint that used to exist was a symptom, not a design choice:
`_checkContacts` picked who even got *considered* for an incoming contact
using the engine's general-purpose, score-parity-based x-zone rotation
(`_responsibleSlot`) — completely unaware a specific forced shot might be
armed for someone else on that team. A script could aim exactly at its named
target's authored position and the ball would still be handed to their
partner. Fixed at the two call sites that actually decide who hits:

- **`_checkContacts`**: right after computing the x-zone-based responsible
  player, override it — if a `drillForcedShot` is armed for a player on the
  receiving team, that player is who gets checked (reach, swing timing),
  full stop. Same shape as the existing human-poach override in the same
  function.
- **`_moveCPU`**: the forced-shot target's `responsible` flag is forced
  `true`, so they actively move to intercept (real movement, not scripted
  position) instead of standing there "not responsible" while the ball
  sails past.

Both key off `this.drillForcedShot`, which only exists in drill mode — zero
risk to singles/doubles/practice. Consequence: a script target can be
authored anywhere on their own side and will always receive that shot.

### Variable roster (`src/game.js`, `src/main.js`)

- `Game` constructor option `drillActiveSlots` (default all 4) drives
  `_initWorld`'s `mode==='drill'` roster branch — builds `this.players`
  from the active slots only, tagging each with `.drillSlot`.
- `_responsibleSlot`/`_laneSign`'s old `mode==='singles'` special case is
  generalized to `this._teamPlayers(team).length === 1` — correctly treats
  a solo drill-mode team the same way real singles mode already worked
  (full-court coverage, always "responsible"), no other special-casing
  needed.
- AI strategy dispatch (`_moveCPU`/`_cpuHit`'s ctx passed to
  `AI.chooseMovement`/`chooseShot`) is **per-team**, not per-match: a solo
  team's players use `strategies/singles.js` (full-court coverage) even
  when the opposing team is a real 2-player `strategies/doubles.js` pair —
  done by overriding just the `mode` field in the ctx object at those two
  call sites (`ctx.mode` is read nowhere else). **Known simplification**:
  `strategies/common.js`'s `loneOpponent()` only ever looks at one of two
  opponents, so a solo player in a 1-vs-2 drill doesn't get genuinely
  optimal 1-vs-2 positioning — acceptable, not a crash or a broken drill.
- `main.js`'s `startDrillView` computes `activeSlotsOf(drill)` and passes it
  as `drillActiveSlots`; asset preloading only requests characters for
  active slots.

### Other `game.js` drill-mode pieces (unchanged by the above)

`_updateHuman` gated off for drill mode (would otherwise fight `_moveCPU`'s
steering every frame — drill mode drives `players[0]` via real AI too).
`_checkContacts`'s cap guard (stops processing any hit once
`drillHitCount >= this._drillMaxShots()`, so the ball bounces out untouched
and real "no-return" fault detection ends the point for free — no cutoff
timer needed for the common case). `drillEndGrace` is a **backstop only**:
a low-energy shot (e.g. a drop) can settle after one bounce and never
produce the second bounce "no-return" needs, which would otherwise strand
the rep forever — armed once (not re-armed) when the cap is reached, forces
the point to end if real fault detection doesn't get there first.
`_endPoint`'s drill branch shows "REP COMPLETE" when the cap was reached, or
the real fault label otherwise (never `_resultMessage()`'s "You score!" —
meaningless with no human), resets scores, hands off to
`DrillDirector.enterReplayLoop`. `_tickDrill`/`_tickDrillReplay`/
`startDrill`/`cycleCamera`/`drillToggle`/`drillSeek`/`drillReplayInfo` round
out the state machine and replay-loop transport.

### UI (`src/main.js`, `tools/drill-builder.html`)

- **`main.js`**: `startDrillView()` shows `#drillBar` (`● LOADING`, Steps
  pre-populated, Exit already working) *before* the async
  `preloadAssetPack()`/`Game` construction, so there's no blank gap on a
  real device. `#hud` (score, music, camera/pause/info icons) stays fully
  hidden the entire session — `#drillBar` is the only UI: `● LOADING` →
  `● LIVE` during the bounded live rep, then `🔁 REPLAY` plus a play/pause +
  scrub + time transport row once the rep caps. `?drill=<id>` deep-links
  straight into the viewer; `?testDrill=1` reads a work-in-progress drill
  staged in `sessionStorage` by the builder tool and launches it the same
  way, without it ever being in `DEFAULT_DRILLS`.
- **`tools/drill-builder.html`** — standalone visual builder (served by
  `npm run dev`, ES-module imports straight from `src/drillStore.js`/
  `src/drillDirector.js`/`src/shots.js`/`src/constants.js`, no new build
  step, purpose-built for this schema rather than ported from the sibling
  app's own court/creator UI). Markup + a dark theme mirrored from the main
  game only; logic lives in `tools/drill-builder/` as plain ES modules
  loaded via `<script type="module" src="./drill-builder/main.js">` (still
  no build step — Vite's dev server resolves the imports natively, same as
  it already did for the single-file version): `state.js` (shared authoring
  state + roster derivation + `computeStepPositions`, the step-position
  estimator), `court-svg.js` (the court/player/cue rendering, plus
  `attachStepCourtClicks`/`renderStepCourt` for the per-step preview),
  `step-view.js` (the merged single-step editor), `main.js` (wiring + the
  validation gate, below). `script-editor.js` (the older all-shots-at-once
  Script/Steps panels + separate narration modal) is frozen and no longer
  imported by anything — `state.js`/`court-svg.js` only ever gained new,
  additive exports so it could stay untouched, but both this tool and the
  in-app editor (`src/drillAdmin.js`, see "Persistence" below) now use
  `step-view.js`'s merged view instead.
  - **Single merged, step-by-step view** — one panel, court on the left,
    the current step's editor on the right (not stacked, so you're never
    scrolling away from the court to edit a step). You page through the
    drill one step at a time: **Setup** (roster + starting positions), then
    one step per scripted shot. A chip strip ("Setup", "Shot 1", "Shot 2",
    …) plus Prev/Next buttons navigate; clicking a chip or Next/Prev is the
    only way to change which step is being viewed. At the last step, "Next"
    itself becomes **"+ Add shot"** — there's no separate always-visible add
    button; adding is just where "next" naturally leads once there's nothing
    left to navigate to.
  - The court redraws per step via `computeStepPositions(stepIndex)`: an
    authoring-time approximation, not real physics (the runtime's actual
    per-rally movement is live AI/physics, never authored data). Positions
    carry forward step to step; a shot's **receiver moves to the ball**
    (its `landing`, or their own prior spot if no landing was set) by
    default — the same "move to intercept" behavior the real AI exhibits —
    and an explicit `moves[].to` cue for that same player overrides it, same
    as any other player's cue. The current hitter gets a solid yellow ring
    (a fixed highlight color, not their own player color — a same-hue ring
    around a same-hue dot barely reads as a highlight); the current receiver
    gets a dashed yellow ring instead of a separate ball marker — since the
    receiver always ends up exactly at the ball (see above), drawing a
    filled ball dot on top of them would just hide their "P2" label, so the
    dashed hitter→ball path line is drawn but the ball's own dot is skipped
    whenever a receiver is standing right there. The *previous* step renders
    faded behind the current one as a ghost — both player-movement lines and
    the last shot's ball path — so motion between steps reads at a glance.
  - **Hitter lock**: the first scripted shot's hitter is a free choice.
    Every later step's hitter is fixed at creation time to the previous
    step's receiver and shown as a read-only label — "only the person who
    can hit is selected," matching the receiver-chain-continuity rule
    `validateDrill` already enforces. Editing an earlier step's receiver
    does **not** auto-cascade into later (locked) hitters; a resulting
    chain mismatch is flagged by the same validation banner as before,
    fixed by deleting/re-adding the affected step(s).
  - **Add step** inserts immediately after the step currently being viewed
    (not always at the end) and moves the view to the new step. Each step
    has its own "Remove this step" action. There's no "duplicate" action in
    this view.
  - **Narration is inline and collapsed by default**, not a separate modal —
    a "▸ Narration" disclosure at the top of each step's editor (Setup
    included), showing a `•` marker once it has text. Setup's narration is
    still `state.steps[0]` (defaulting to `{title:'Setup'}`); each scripted
    step carries its own optional title/desc. `main.js`'s `buildDrill()`
    derives the exported top-level `steps: [...]` array from these at export
    time — **always one entry per step, even blank** (not filtered down to
    only the non-empty ones) so an editor reloading this drill can map
    narration back to the right step reliably; the two places that actually
    display `steps[]` to a player filter blanks out at render time instead
    (see "Persistence" below).
  - Player icons: P1/P2 (near) below the court, P3/P4 (far) above it —
    matching where those teams actually render on the court. Circular,
    color-coded to match the court dots. The picker is only shown/usable on
    the Setup step, since placement only ever applies there.
  - The placement apron outside the court has subtle near/far team color,
    stronger reference-grid lines, and coordinate labels so wide serve/ATP
    positions remain legible instead of floating in an indistinct dark box.
  - P1/P3 are always present, no control to remove them. P2/P4 each have an
    explicit **checkbox** ("include") — unambiguous add/remove, separate
    from the icon's job (select for placement). Unchecking strips that
    slot's position and any script entry referencing it.
  - Click-anywhere placement (not a coarse fixed grid — extends past the
    sidelines/baseline so serve and ATP-style positions are placeable), but
    constrained to the selected player's own side of the net: a click on
    the wrong side snaps to the nearest legal spot at the net line instead
    of placing there or being ignored.
  - Per-step editor: hitter/shotType/receiver fields (target dropdown only
    ever offers the hitter's opponents), landing placement, and player
    directives. A directive's "Movement" field is just two options — "Moves
    to a destination" or "Holds position" — not the old eight-label
    "coaching label" picker: `src/drillDirector.js`'s `armMovesForBeat` only
    ever special-cases `behavior === 'hold'`, every other label drove
    identical movement physics, so the extra labels were purely cosmetic
    clutter with no functional difference to show for it.
  - Live `validateDrill` banner.
  - **"Generate drill JSON"** — paste-ready `DEFAULT_DRILLS` entry.
  - **"▶ Test this drill live"** — stages the drill in `sessionStorage` and
    opens the real game via `?testDrill=1`: a real live rep, capped,
    captured, and looped, before anything is ever pasted anywhere.
  - **"💾 Save to server"** — saves via `/api/drills`, the same store the
    in-app Drills screen (`src/drillAdmin.js`) reads/writes; no drag-and-drop,
    no editing of an already-saved drill from this tool (that's the in-app
    Drills screen's job, which shares this exact step-by-step view — see
    "Persistence" below).

### Shipped drills (`DEFAULT_DRILLS`, `src/drillStore.js`)

- **`drill-drip`** ("Drip Practice", 4 players, 2 scripted shots) — P1
  simulates a short return down the line to P3, who drips back at P1's
  feet; P1 and P3 share a grid column for a genuine down-the-line lane.
  P2 shades/poaches, P4 follows P3 in. The drip shot is authored as
  `shotType: 'drop'` because real `drive` (`shots.js`) is the flat, fast,
  driven family; `drop` is the soft, arcing, kitchen-dying family, closer
  to the neutralizing drip intent.
- **`drill-dink-rally`** ("Cross-Court Dink Rally", 4 players, 5 scripted
  shots) — P1/P3 alternate a true diagonal dink exchange, and P2/P4 carry
  explicit moves cues to shadow in/out while staying off-ball. This used to
  depend on the removed free-play tail; the current config now scripts the
  full five-touch exchange directly.
- **`drill-1v1-test`** (2 players, 1 scripted shot) and **`drill-2v1-test`**
  (3 players, near side has a partner, far side doesn't, 1 scripted shot) —
  minimal drills tagged `['test']`, shipped specifically to exercise the
  variable-roster code path in the test suite and be manually launchable
  from the drill library.

---

## Verified live

Headless Playwright, direct `game.state`/`game.drillHitCount`/
`game.drillPlayback` polling (screenshot-interleaved timing is unreliable
under headless SwiftShader software rendering — state polling is the
trustworthy signal). All four shipped drills confirmed: correct player
count, forced shots fire (or don't, per shape) and land where intended, hit
count climbs and stops exactly at `script.length`, "REP COMPLETE" hands off to a
real captured replay that loops forever with working pause/scrub, `#hud`
stays hidden throughout. `drill-drip` specifically confirmed post-fix: ball
x at both scripted contacts (P1→P3 and P3→P1) is exactly `1.524` — a true
shared-column down-the-line exchange. The builder tool's full flow (place
players via icons+checkboxes, script a back-and-forth, validate, test live)
is also verified end-to-end.

**Test suite**: `npm test` (`test/run-all.mjs`) runs `test/logic.test.mjs`
(general pure-logic/physics/AI) and `test/drill.test.mjs` (drill schema,
validation, director, and — via lightweight `Object.create(Game.prototype)`
stubs that never touch three.js/DOM — the drill-specific branches inside
`_moveCPU`/`_checkContacts`/`_checkPoach`/`_clampToSide`) as one suite.
`npm run drill:check` (`tools/drill-check.mjs`) is the permanent live-
browser companion for what a stub can't cover: real mesh swing animation,
real replay capture/loop timing, and a real Setup→live-rep→REP COMPLETE→
looped-replay run of all four shipped drills plus the exact 4-player-
corners/no-cues scenario from this repo's drill-mode bug-hunt history.
Before this, live verification was a series of throwaway `tools/_verify*.mjs`
scripts reinvented per debugging session — `drill-check.mjs` is that pattern
made permanent.

A later audit pass (see git history around the "drill mode: full audit" work)
found and fixed several more engine bugs the same way this file's design
history already anticipated bugs would surface — by reproducing exact
failure scenarios live, not by inspection: `_clampToSide` and the
`_moveCPU`/`_checkContacts` responsibility override (documented above) were
the first round; a second round fixed `_checkPoach` reading an already-
nulled `drillForcedShot` on a script's final beat (letting a real auto-poach
hijack the climactic last scripted contact), the same zone-guess bug in
`_checkPoach`'s own partner selection, a stale `moves` cue reactivating one
beat late instead of being dropped when its player becomes the armed
hitter, `_tickDrillReplay` never dispatching swing events (so every looped
replay showed the ball changing direction with nobody visibly swinging,
forever), and the "YOU" ring never being hidden in drill mode. All are
covered by regression tests in `test/drill.test.mjs`'s "Engine" section.

---

## Persistence + in-app manage UI (landed)

Drill data now lives in Neon Postgres (`pb3d_drills` table, `db/schema.sql`)
behind a Vercel serverless function (`api/drills.js`), same Neon project as
the sibling `pickleball-drills` repo but its own dedicated table (one row per
drill, not the sibling's single-blob `kv_store` pattern — pb3d's own
create/edit/delete needs atomic single-row writes, not a whole-array
read-modify-write). `src/drillStore.js`'s `loadDrills()` fetches `/api/drills`
for real now, falling back to the bundled `DEFAULT_DRILLS` on any failure
(no `.env.local`, network error, DB down) — local dev with no database still
works. New `createDrill`/`updateDrill`/`deleteDrill` exports back both the
in-app editor and the standalone builder tool.

### Latency: never block a render on the database

Assume every uncached read of `/api/drills` is slow — Neon autosuspend means
the first query after a few idle minutes wakes the compute, which can take
seconds. Nothing on a render path is allowed to wait for that. Four rules,
each of which fixed a real stall:

- **`loadDrills()` is stale-while-revalidate, not fetch-then-render.**
  `peekDrills()` returns the last known list synchronously (memory, then a
  `localStorage` copy under `pb3dDrillsCache`), so `renderDrillLibrary()`
  paints cards on the same frame as the tap; `Loading…` is only ever seen on
  a genuine cold start. The background refresh notifies via
  `onDrillsUpdated()`. **The failure result is cached too** (behind
  `FAIL_TTL_MS`) — the original cached only on success, so a slow or dead API
  cost a full round trip on *every* call, including every card tap.
- **One request per session, not per interaction.** `_inflight` dedupes
  concurrent callers, and the list is prefetched at boot (idle-scheduled in
  `main.js`) so the round trip overlaps the title screen.
- **The GET is CDN-cacheable** (`s-maxage` + `stale-while-revalidate` +
  ETag/304 in `api/drills.js`), so most opens never reach Neon at all. A
  local mutation opens a `MUTATION_QUIET_MS` window in `drillStore.js` that
  suppresses the background refresh — it **must stay longer than the
  handler's `s-maxage`**, or a refresh can serve a pre-save CDN copy and
  visibly revert a drill the user just saved.
- **Every write is one round trip.** POST/PUT use
  `ON CONFLICT … RETURNING` / `UPDATE … RETURNING`; an empty result set *is*
  the 409/404 answer. The old SELECT-then-write pairs doubled save latency
  and raced on duplicate ids. Seeding an empty table is likewise one batched
  `jsonb_to_recordset` INSERT, guarded by a module-level flag so it isn't
  retried on every list GET. `test/drillsApi.test.mjs` asserts these
  round-trip counts against a stubbed Neon endpoint — the count is part of
  the contract now, so read it before "simplifying" the handler.

Drill *launch* latency is a separate, non-database problem:
`preloadAssetPack()` is cached per config in `src/assets.js` and loads its
manifest entries in parallel, and `main.js` prewarms the pack when the Drills
library opens. `drillAssetConfig()` deliberately resolves all four
`DRILL_ROSTER` slots rather than the ones a given drill declares, so every
drill shares one cache entry — scoping it per drill meant a 2-player drill
could not reuse a 4-player drill's pack and the prewarm covered nothing.
Consumers clone via `cloneModelScene`/`SkeletonUtils`, which is what makes
sharing one pack across launches safe.

**In-app create/edit/delete**: a new `#scrDrillEdit` flow screen
(`src/drillAdmin.js`) reuses `tools/drill-builder/{state,court-svg,
step-view}.js` — the same merged step-by-step court+editor view the
standalone builder uses (chip strip + Prev/Next, per-step hitter lock,
ghosted movement/ball-path preview, collapsed-by-default inline narration
accordion) — rather than re-implementing court placement/step editing a
second time. Those modules' render/compute functions take explicit
target-element arguments so the same code can point at this screen's
elements instead of the standalone tool's ids. Reachable via "+ New Drill"
on the Drills library screen and a per-card edit (✎) button.
`script-editor.js` (the older all-shots-at-once Script/Steps panels and
narration modal) is no longer used by either tool — kept around only as a
frozen, unimported file in case it's useful reference, not wired into
anything.

**Narration round-trips through save/load now**: `buildDrill()` in both
tools emits the exported `steps[]` array *unfiltered* — always exactly one
entry per step (Setup + one per script index), even blank — instead of
dropping empty ones. That's what lets `drillAdmin.js`'s `loadIntoState()`
reliably map `drill.steps[i+1]` back onto `script[i]`'s narration fields
when opening an existing drill for editing. The two places that display
`steps[]` to a player (`src/main.js`'s live in-drill step list and the
drill-card's "N steps" count on the library screen) filter out blank entries
at render time instead, so the on-screen experience is unchanged. A
hand-authored drill whose `steps` predates this convention (a short,
free-standing caption list not correlated to script length, e.g. the
`DEFAULT_DRILLS` seeds) won't map perfectly onto per-step fields on load —
narration is cosmetic-only, so this is an accepted, low-stakes approximation
rather than something worth a schema migration.

`tools/drill-builder.html` stays as the desktop/power-user authoring surface
(more room than a mobile flow screen) and now has a real "Save to server"
button (create-only — it has no load-an-existing-drill path, so edit/delete
of an already-saved drill is the in-app screen's job) alongside the existing
Generate JSON / Test Live.

## What's still missing (phase 3+)

1. **Only four seeded drills exist** (Drip Practice, Cross-Court Dink Rally,
   plus the two minimal 2/3-player test drills) — now just the initial seed
   of a live, editable table, not a hard limit. The `script` schema isn't
   shape-limited — a serve-practice drill, a poaching drill, etc. are just a
   different shot sequence, no `drillDirector.js` changes needed.
2. **No user-selectable cast.** Roster size is flexible (2/3/4 players) but
   which character plays which slot is still fixed (`DRILL_ROSTER` in
   `characters.js`).
3. **Launch config (venue/palette/time-of-day) is hardcoded** — always
   park/blue/day, regardless of any prior flow picks.
