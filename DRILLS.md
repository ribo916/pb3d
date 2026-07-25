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
    { hitter: 'P3', shotType: 'drop',  target: 'P1', moves: [{ player: 'P1', to: 'F8' }] }
  ],
  steps: [{ title, desc }, ...]            // pure on-screen narration, NOT read by the engine
}
```

No separate `maxShots` cap exists anymore — the rep ends EXACTLY when `script`
runs out (`game.js`'s `_drillMaxShots()` is always `script.length`), never
with extra undirected AI touches tacked on. If you author N scripted shots,
you get exactly N hits, every rep, every time. A `script` entry can also
carry an optional `moves: [{player, to}]` — movement cues (self-recovery or a
partner poach/shadow) that arm the instant that beat's shot fires; see
"Movement cues" below.

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
  (`drive`/`drop`/`dink`/`lob`/`speedup`) plus `smash`. `target` is always a
  player slot on the hitter's OPPOSING team — a shot can't be aimed at your
  own partner.
- **Movement cues (`moves`, optional per beat)**: `{player, to}` entries that
  arm the instant that beat's shot fires (`drillDirector.js`'s
  `armMovesForBeat`), directing any active player (the hitter's own
  recovery, or a partner's poach/shadow) toward a spot. They only ever
  override the steering TARGET fed into the existing per-frame
  `Movement.seek()` call (`game.js`'s `_moveCPU`) — never position directly
  — so real accel/decel physics still produces the resulting velocity/
  animation, the same load-bearing property that made the sliding-artifact
  fix (Pass 2, above) stick. Cues are fire-and-forget: non-blocking, cleared
  on arrival, always overridden by real ball responsibility, and an
  outstanding cue persists across later beats unless one re-issued for that
  slot. This is also the replacement for what free-play-after-script used to
  paper over (shadowing/coverage) — script it explicitly instead.
- **`validateDrill(drill)`** (`drillStore.js`) — the only authoring
  constraints left: roster shape (at least one player per side; P2 can't
  exist without P1, P4 can't exist without P3; every script `hitter`/
  `target` must be in the active roster) and same-team targets. Returns a
  list of human-readable errors; used in `test/logic.test.mjs` and live by
  the builder tool. **There is no positional/zone constraint** — a script
  target can be authored anywhere on their own side of the net (see below
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
  `_executeShotV2` (a table-setting injection, no timing/stability noise —
  nothing realistically "swings" for it). Seeds a synthetic `match.rally`
  already "deep in" (`shots: 4`, `phase: 'open'`) rather than framing it as a
  serve or return: skips `Rules.onFloor`'s shots===1 serve-fault check on
  the first bounce, and clears `strategies/doubles.js`'s `advanceAllowed`
  threshold (>=3) so both teams read as "already at the net" immediately.
  Targets the named player's **actual live position** (x and z) directly —
  the chess-like "aim at this player" semantics the schema promises. Then
  arms `script[1]` via `armNextScriptedShot`.
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
  app's own court/creator UI):
  - Player icons: P1/P2 (near) below the court, P3/P4 (far) above it —
    matching where those teams actually render on the court, not an
    arbitrary choice. Circular, color-coded to match the court dots.
  - P1/P3 are always present, no control to remove them. P2/P4 each have an
    explicit **checkbox** ("include") — unambiguous add/remove, separate
    from the icon's job (select for placement). Unchecking strips that
    slot's position and any script entry referencing it.
  - Click-anywhere placement (not a coarse fixed grid — extends past the
    sidelines/baseline so serve and ATP-style positions are placeable), but
    constrained to the selected player's own side of the net: a click on
    the wrong side snaps to the nearest legal spot at the net line instead
    of placing there or being ignored.
  - Script editor: ordered hitter/shotType/target rows; the target dropdown
    only ever offers the hitter's opponents.
  - Live `validateDrill` banner.
  - **"Generate drill JSON"** — paste-ready `DEFAULT_DRILLS` entry.
  - **"▶ Test this drill live"** — stages the drill in `sessionStorage` and
    opens the real game via `?testDrill=1`: a real live rep, capped,
    captured, and looped, before anything is ever pasted anywhere.
  - No save/persistence beyond the browser session (still gap #2 below), no
    drag-and-drop, no editing of already-shipped drills in place.

### Shipped drills (`DEFAULT_DRILLS`, `src/drillStore.js`)

- **`drill-drip`** ("Drip Practice", 4 players, 2 scripted shots) — P1
  simulates a short return down the line to P3, who drips back at P1's
  feet; P1 and P3 share a grid column for a genuine down-the-line lane.
  P2 shades/poaches, P4 follows P3 in. **Open item, not silently
  resolved**: the drip shot is authored as `shotType: 'drop'`. Described as
  "a drive that lands at P1's feet" — real `drive` (`shots.js`) is the
  flat, fast, driven family; `drop` is the soft, arcing, kitchen-dying
  family, closer to the original neutralize-the-point intent. Flagged in a
  comment directly above the script entry — confirm or correct. **Also
  pending confirmation post-`maxShots` removal**: its `goal` describes P1
  working "the emergency split-step reset" after P3's drip, but the script
  only has 2 entries, so the rep now ends right when P3's drip lands —
  before P1 ever gets to hit that reset. Needs either a 3rd scripted entry
  (P1's reset) or a rewritten goal/steps; not decided yet.
- **`drill-dink-rally`** ("Cross-Court Dink Rally", 4 players, 1 scripted
  shot) — P1 opens with a soft dink cross-court to P3 (opposite x, a true
  diagonal). **Pending confirmation post-`maxShots` removal**: this used to
  free-play 4 more touches for a real back-and-forth "rally" feel with P2/P4
  shadowing; with no free-play tail, the rep now ends after that single
  dink. Needs its `script` extended to alternate P1↔P3 for as many touches
  as the rally should have, with `moves` cues replacing what the shadowing
  used to get from ordinary AI free-play; not decided yet.
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
is also verified end-to-end. `node test/logic.test.mjs`: 113/113.

---

## What's still missing (phase 2+)

1. **No create/edit/delete in the shipped app.** `tools/drill-builder.html`
   covers *authoring* (place players, build the script, validate, test
   live, generate JSON) but is a standalone dev tool with a copy-paste
   handoff, not integrated into pb3d's own UI, and has no save/load.
2. **No persistence layer.** Real deployment target is Vercel (see design
   history above) — a Vercel-functions + Postgres approach (mirroring
   `pickleball-drills` almost exactly) is the natural default. This is what
   would let the builder tool actually save instead of just generating
   pasteable JSON.
3. **Only four real drills exist** (Drip Practice, Cross-Court Dink Rally,
   plus the two minimal 2/3-player test drills). The `script` schema isn't
   shape-limited — a serve-practice drill, a poaching drill, etc. are just
   a different shot sequence, no `drillDirector.js` changes needed. Content
   is the bottleneck, not the engine.
4. **No user-selectable cast.** Roster size is flexible (2/3/4 players) but
   which character plays which slot is still fixed (`DRILL_ROSTER` in
   `characters.js`).
5. **Launch config (venue/palette/time-of-day) is hardcoded** — always
   park/blue/day, regardless of any prior flow picks.

## What to decide before writing more code

- **Persistence** (gap #2) — gates everything under "administer," and gates
  whether the builder tool becomes a real save flow or stays copy-paste.
- **Whether/how the builder tool integrates into pb3d's own UI** (or stays
  a separate dev page) — and whether a real admin flow reuses it, extends
  it, or replaces it once persistence exists.
