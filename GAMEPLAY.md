# Pickleball 3D — Gameplay Reference

> This file is the authoritative description of every active gameplay system.
> It is read by AI agents at the start of sessions that touch gameplay. Keep it
> current whenever a mechanic or tuning number changes.
>
> For project structure, tech stack, commands, and extension points see
> [`AGENTS.md`](AGENTS.md). For Claude-specific workflow notes see
> [`CLAUDE.md`](CLAUDE.md).

---

## Coordinate System

```
x = sideways  (+x = right when standing on the near baseline)
y = up
z = court length  (+z = near/human side, -z = far/AI side)
Net plane: z = 0
```

All distances in **meters**. Key court landmarks (from `constants.js`):

| Constant | Value | Meaning |
|---|---|---|
| `COURT.HALF_W` | 3.048 m | Sideline at `x = ±3.048` |
| `COURT.HALF_L` | 6.706 m | Baseline at `z = ±6.706` |
| `COURT.KITCHEN` | 2.134 m | Non-volley line at `z = ±2.134` |
| `COURT.NET_H_CENTER` | 0.86 m | Net height at centre (34 in) |
| `COURT.NET_H_POST` | 0.914 m | Net height at posts (36 in) |
| `COURT.BALL_R` | 0.037 m | Ball radius (74 mm) |

Practice-specific landmarks/tuning also live in `constants.js` `PRACTICE`:
- Machine base at `x = 0`, `z = -HALF_L + 0.18`
- Feed release slightly in front/above the machine
- Human practice start near the near baseline
- Grading windows for position/timing/stability

---

## Ball State

```js
ball = {
  pos:   {x, y, z},       // world position (m)
  vel:   {x, y, z},       // velocity (m/s)
  spin:  {x, y, z},       // angular-ish magnitude (decay over time)
  live:  boolean,
  lastBounceSide: 0|1|-1, // +1 near, -1 far, 0 none
  flight: null | {         // cached solver result; null during roll-out
    landing, T, apexY,     // solved landing point, flight time, apex height
    samples,               // pre-sampled flight points (for poach checks)
    elapsed                // time elapsed so far (s)
  }
}
```

---

## Trajectory System — Honest Simulated Physics + Shot Solver

The ball **always integrates real physics** every substep (`Physics.stepV2`) —
there is no scripted curve and no guaranteed landing point:

- **Gravity** `PHYS_V2.GRAVITY = 9.81` (real).
- **Quadratic air drag** `a = -DRAG_K·|v|·v` (`DRAG_K = 0.042`) → terminal
  velocity ≈ 15.3 m/s, matching a real pickleball (a very draggy ball).
- **Magnus** `a = MAGNUS_K·(spin × v)` shapes the arc *in flight* — topspin
  genuinely dips the ball, backspin floats it, sidespin curves it.
- **Spin-aware bounce**: topspin skids low & fast, backspin checks up (reverses
  at high spin), sidespin kicks laterally. Tuned by `BITE`, `SPIN_COUPLE`,
  `SIDE_KICK`, `ROLL_BLEND`, `RESTITUTION = 0.62`.

All physics constants live in `constants.js` `PHYS_V2`. `PHYS_V2.PACE` is the
global speed-trim knob for the playability tune. A hit caches its solved flight
(`ball.flight`: landing, flight time, apex, samples) for AI prediction; the cache
is dropped on bounce/net so post-bounce balls forward-integrate the roll-out.

### The shot solver (`Physics.solveArc`) — three trajectory families

A hit no longer scripts a curve — it **solves for a launch velocity**. `solveArc`
takes the contact point, the aimed target, and a shot *envelope* and picks one of
three families:

- **DRIVEN** (`driven: true` — drive, speedup): the flat family. Solves launch
  vy (may be **negative** — hit downward from a high contact) + horizontal speed
  so the ball **crosses the net just above the tape** (`netHeight + margin`) and
  lands at the target. If the `vMax` speed cap can't carry the depth at tape
  height, the crossing target rises 0.3 m at a time — **loft is the
  physics-forced fallback, never the default.** This is what makes drives and
  speedups read as pace instead of arcs.
- **ARC** (default — drop, dink, lob, serve, feed): seed ballistically at the
  apex hint, secant on launch speed for range, raise the apex until the arc
  clears the net (clearance guaranteed by construction).
- **DIRECT** (smash, Erne): aim down the depressed line to the target, search
  speed only.

All modes end with a lateral pass canceling Magnus drift. `allowNet` (ATP,
deliberate faults) skips clearance raising.

### Shot grammar (`shots.js` `PROFILES_V2` / `specV2`)

Every shot — including serve, smash, ATP, Erne and the practice feed — is a
physical envelope here:

| Type | family | apex hint | spinX | vMax | Notes |
|---|---|---|---|---|---|
| drive | **driven** | (1.15)* | +5.0 topspin | 19 | flat, tape-skimming, down from high contact |
| drop | arc | 2.10 | −3.0 backspin | 9 | soft, dies in kitchen (bounce peak < net) |
| dink | arc | 1.35 | −1.5 | 6.5 | soft kitchen exchange |
| lob | arc | 4.60 | −1.0 | 14 | **deliberate only** — explicit intent / situationalLob |
| speedup | **driven** | (1.05)* | +5.5 | 17 | fast attack on a high ball |
| serve | arc | 2.30 | +2.5 | 16 | diagonal deep |
| smash | direct | 0.95 | +7.0 | 22 | steep overhead |
| erne | direct | 0.95 | +4.0 | 18 | |
| atp | arc | 0.60 | sidespin | 15 | `allowNet` — around the post |
| feed | arc | 2.55 | +1.0 | 12 | practice machine |

\* driven shots ignore the apex hint when struck clean; it is the base for the
mishit arc fallback.

**Mishits sit up — they are never lobs** (design intent: lobs are deliberate;
an accidental high ball is just "slightly high" and attackable).
`Shots.apexForQualityV2` adds a modest, capped loft: float = base +
`STABILITY.FLOAT_APEX_ADD_V2` (0.55 — hangs, bounces above the net,
speedup-attackable); popup = base + `POPUP_APEX_ADD_V2` (1.3 — descends through
smash height); both hard-capped at `MISHIT_APEX_MAX_V2` (3.4), well below the
deliberate lob (4.6). A float/popup-quality drive/speedup also **drops out of
the driven family** into the arc solver — the mishit balloons a little and
becomes the punishable sitter.

### Timing = quality + direction (`TIMING_V2`, `Shots.applyTiming`)

Human timing is anchored to **contact geometry** — where the ball sits
relative to the hitter's body at the strike — not to a press-clock. At contact,
`Shots.timingOffsetFromContact((ball.z − hitter.z)·fwd)` grades the
facing-normalized z-offset against the same ideal contact point practice mode
coaches (`PRACTICE.TIMING_IDEAL_Z` — ball slightly out front), normalized by
`TIMING_V2.Z_HALF_WIDTH` (0.6 m):

- **early** (ball still far out front — you committed too soon) pulls the shot
  cross-body, away from the paddle side; **late** (ball at/behind the body)
  pushes it toward the paddle side (skew ≤ `SKEW_X = 1.1 m`, mirrored for
  backhand and the far team);
- any mistiming costs pace (`paceMul = 1 − PACE_LOSS·offset²`);
- edge hits loft slightly (`LOFT_ADD = 0.35` past `LOFT_EDGE = 0.55`) — a
  shanked ball sits up a little; on a driven shot the loft raises the
  tape-crossing target instead (the drive floats up).

**Strike deferral** (`TIMING_V2.HOLD_Z = 0.45`, `game._holdForContact`): with
the window open, the strike waits until the approaching ball is within
`HOLD_Z` in front of the body (or the window is on its final tick) instead of
firing the instant the ball crosses the 1.5 m reach ring. An early press
therefore connects near ideal geometry with only a small penalty — arcade-
tennis behavior — rather than guaranteeing a max-stretch float.

Because timing and the Stability Index read the same geometry, they **reinforce**
each other: the ideal contact (ball ~0.2 m out front, body set) is optimal for
both; a max-reach stab is punished by both. Match-play timing and practice-mode
early/late coaching agree by construction. CPUs sample a gaussian offset scaled
by `LEVELS.timing` (family 0.45 → hard 0.10) and take **only the pace/loft
effects** — the lateral skew is zeroed for CPUs because directional variance is
already owned by `LEVELS.err` (keeping both would double-count lateral error at
the low tiers).

### AI

`AI.predict` returns a unified `{x, z, tLeft, peakY}` from the cached solver
flight (`ball.flight`, exact and O(1)) — the AI reads the real landing, scatter
included. Post-bounce balls forward-integrate with the same forces. Strategies
read `prediction.peakY`/`prediction.tLeft` instead of flight internals, and
resolve shot envelopes with `Shots.resolveV2`, so `PROFILES_V2` is the CPU tuning
surface too. A **rally-length pressure** term (`common.rallyLengthMult`) ramps the
unforced-error rate in long exchanges so dink battles resolve in a realistic
window instead of stalling.

### Metrics

`game.metrics` (rally-length histogram, net errors, serve faults, point reasons)
is always on; `tools/play.mjs` prints a summary per match for tuning.

---

## Shot Types

Defined in `shots.js` `PROFILES_V2`. Each profile sets a physical envelope (apex
**hint**, depth, spin, margin, `vMax`, family flags) fed to `Physics.solveArc`;
Stability Index, power cap, and depth aim modify it before the solve.

| Type | Family | Apex hint | Depth | SpinX | vMax | Use |
|---|---|---|---|---|---|---|
| `drive` | driven | 1.15 m | 80% court | +5.0 (topspin) | 19 | Baseline power shot |
| `drop` | arc | 2.10 m | 55% kitchen | −3.0 (backspin) | 9 | Third-shot drop; lands in kitchen |
| `dink` | arc | 1.35 m | kitchen+0.25 m | −1.5 (backspin) | 6.5 | Soft kitchen exchange |
| `lob` | arc | 4.60 m | 86% court | −1.0 (backspin) | 14 | Overhead change-up (deliberate only) |
| `speedup` | driven | 1.05 m | 55% court | +5.5 (topspin) | 17 | Attack a high floated ball |
| `supersmash` | driven | 1.05 m | 70% court | +9.0 (topspin) | 30 | Power-meter spend; aimed at a player |
| `blastpop` | arc | 3.60 m | 30% court | −0.5 | 8 | The forced return from a blasted player |

The five rows above `supersmash` are the *selectable* types (`Shots.TYPES`).
`serve`/`smash`/`erne`/`atp`/`feed`/`supersmash`/`blastpop` are **state-triggered**
— never returned by `classify()`, only fired by explicit branches.

⚠️ `supersmash` is **driven, not direct**, unlike `smash`. `direct` pins the launch
along the contact→target line, which only works from a genuine overhead: measured
net crossings from a 0.5–1.0 m contact were 0.27–0.57 m, i.e. straight into a
0.86 m net. See "Power Meter & Super Smash".

Driven shots (drive, speedup, supersmash) ignore the apex hint when struck clean — they fly
flat and hit DOWN from a high contact; the hint is only the mishit-arc fallback.

### Bounce Height Reference

Bounce height ≈ `apex × RESTITUTION²` (= `apex × 0.38`, `PHYS_V2.RESTITUTION =
0.62`). Net height is **0.86 m**. Meaningful for arc shots (drop/dink/lob);
driven shots skim the tape rather than arcing to their apex hint.

| Shot | Apex | Clean bounce | vs Net | Notes |
|---|---|---|---|---|
| dink | 1.35 m | ~0.52 m | below ✓ | Receiver must lift |
| drop (clean) | 2.10 m | ~0.80 m | below ✓ | Kitchen player forced to dink |
| drop (float) | 2.65 m | ~1.01 m | above — attackable | Bad drop; kitchen player can speedup |
| drop (popup) | 3.40 m | ~1.30 m | smash zone | Very bad drop; overhead smash |
| lob | 4.60 m | ~1.75 m | above | Intentional high — meant to be chased |

Float and popup values come from the **additive, capped** mishit loft
(`FLOAT_APEX_ADD_V2 0.55`, `POPUP_APEX_ADD_V2 1.3`, capped at
`MISHIT_APEX_MAX_V2 3.4`) applied to the drop apex (2.10 m) — never a lob.

Use this table when tuning `PROFILES_V2.drop.apex`: lower the number to make drops
die lower (harder to attack), raise it to make even clean drops sit up.

---

## Shot Selection Pipeline

```
Player zone + ball height + intent
        ↓
Shots.classify() → shot type
        ↓
Shots.specV2()   → {apex, landZ, spin, margin, vMax, driven/direct/allowNet}
        ↓
Stability Index  → apex modifier (apexForQualityV2)
        ↓
Power cap        → intent override (maxIntent)
        ↓
Depth aim        → landZ nudge (aimDepth)
        ↓
Solve            → Physics.solveArc → _executeShotV2
```

### Court Zones (`Shots.zoneOf(absZ)`)

| Zone | `|z|` range |
|---|---|
| `kitchen` | `≤ KITCHEN + 0.4` (≤ 2.53 m) |
| `transition` | between kitchen and deep |
| `deep` | `≥ HALF_L − 1.4` (≥ 5.31 m) |

### Intent → Shot Type (`Shots.classify`)

| Zone | Intent | Ball high? | Shot type |
|---|---|---|---|
| kitchen | touch | — | dink |
| kitchen | power | yes | speedup |
| kitchen | power | no | drive |
| deep/transition | touch | — | drop |
| deep/transition | power | — | drive |
| any | lob | — | lob |

---

## Hit Model

### Swing Timing Window

The human must **press swing first**, which opens a `HIT.SWING_WINDOW = 0.30 s`
window. The ball is struck when it enters reach **during that window**.
CPU players have a reaction delay (`ai.cfg.react`) before hitting.

### Reach

Ball must satisfy **both**:
- `dist2D(ball, player) < HIT.REACH` (1.5 m horizontal)
- `0 < ball.y < HIT.REACH_Y_MAX` (2.3 m)

### Who gets the ball (contact dispatch)

`game._checkContacts()` picks **one** hitter per team per frame. By default that
is the lane-responsible player (`_responsibleSlot`, chosen by the sign of
`ball.pos.x` — left/right half), *not* whoever is closest.

**Human poach override:** before the reach gate, if the human (`players[0]`) is
on the receiving team, is *not* already the responsible slot, and has an active,
unused swing window while in reach, the human is promoted to hitter. This lets
you step in front of your AI partner and take a ball assigned to their lane —
exactly like a real poach. You **must** commit a timed swing; merely standing in
the partner's lane does not steal the ball (the partner AI still plays it). All
downstream gates (two-bounce rule, cooldown) still apply to the poached hit, and
`_hit` sets `rally.lastHitter`, so the partner can't double-hit afterward.

The opening two-bounce gate is tracked explicitly on the rally state, not just
by `phase`: normal volley play stays locked until the return has also bounced.
If a player swings at the serve or return before that bounce happens, the rally
is awarded immediately as a `volley-before-double-bounce` fault rather than the
attempt being silently ignored. CPU-controlled players consult the same lock and
defer contact until the bounce, so they do not intentionally commit opening
two-bounce faults.

### Cooldowns

- After a serve: `HIT.COOLDOWN_SERVE = 0.25 s`
- After a rally hit: `HIT.COOLDOWN_RALLY = 0.12 s`

### Match Play vs Practice

The **underlying contact quality logic is shared**:
- Reach gate is the same
- Stability Index is the same
- Power cap and shot resolution are the same

What practice adds on top:
- practice-only coaching feedback (`early`, `late`, `good`, `clean`, `perfect`)
- a live ball-color cue when the incoming machine feed enters a good contact window
- a separate machine-feed loop instead of rules-driven rally state

So a "good contact" still improves shot quality in doubles and singles, but only
practice exposes that as explicit coaching feedback.

### Input (Human)

All devices feed the same `input.state` fields (`move`, `aim`, `swingPower`,
`swingShot`) consumed by `game._hit` / `_aimTarget`.

| Abstract input | Effect |
|---|---|
| Left/right stick `move.x` | Lateral aim blend (added to `swingAim`) |
| Forward/back stick `move.z` | Depth aim (`aimDepth`) — deeper or shorter |
| Swing → `swingPower = 'power'` | Drive / speedup intent |
| Swing → `swingPower = 'touch'` | Drop / dink intent |
| Swing → `swingShot = 'lob'` | Lob override (always resolves to `lob`) |

Forehand/backhand is **not** an input at all — `Shots.swingSide(hitterX, ballX,
fwd)` derives it at contact time from which side of the hitter's body the ball
is on (every player model holds the paddle in the right hand), so it's
identical across keyboard/mouse/touch and doesn't depend on cursor position.
`swingType === 'bh'` still adds −1.5 to spinX.

**Intent is not the final shot.** A button sets the *intent*; the shot type is
resolved at contact by `Shots.classify` (zone + ball height) and can be
**downgraded by the power cap** — e.g. a `power` press on a ball at/below net
height becomes a drop/dink, and the all-kitchen dink-battle branch forces a dink
regardless of button. See [Power Cap](#power-cap) and [Intent → Shot Type](#intent--shot-type-shotsclassify).

#### Device mappings (`src/input.js`)

| Device | Move | Drive (`power`) | Drop (`touch`) | Lob | Aim |
|---|---|---|---|---|---|
| **Keyboard** | WASD / arrows | `Space` | `V` | `B` | mouse X (+ `move.x`) |
| **Mouse** | — | left-click | right-click | middle-click / shift-click | mouse X |
| **Touch** | left-thumb joystick | flick **up** | short / soft swipe | flick **down** | drag right thumb ↔ |

- Also: `Enter` (or `Space`) serves; `C` (or the 📷 button) cycles camera.
- **Touch is dual-thumb.** Left half = joystick (movement); right half = swing,
  classified on release. The joystick rests on the lower-left at all times on
  touch devices (visible affordance), floats to the thumb while held, and returns
  to rest on release. Right-thumb gesture classification (`onEnd`): a *committed*
  swipe (`dist > 55px || speed > 0.6px·ms⁻¹`) resolves by direction —
  **up = drive, down = lob**, committed-horizontal = drive; anything softer =
  **drop**. Horizontal travel also sets `aim` continuously in `onMove`.
- **No SERVE button on touch.** `queueSwing()` sets `serveQueued` ("a swing
  also serves when in serve state"), so the right-half swipe already starts
  the point. `hud.js` hides `#serveBtn` on `body.touch-device`: it was pure
  redundancy there, and it taught players the game was tap-driven — the exact
  confusion `#swipePad` exists to undo. The serve prompt in `game.js` reads
  "swipe to serve" on touch and "tap SERVE or Space" on desktop.
- **Right-thumb swipe affordance.** `#swipePad` mirrors the joystick's resting
  ring on the right half — same 120px box and rgba values, anchored in pure CSS
  at `right: calc(max(90px,14vw) - 60px); bottom: 70px`. A ghost dot rises and
  fades with ▲/▼ arrows to show the flick, because players otherwise assume the
  swing zone is a *tap*. It retires to a bare static ring (kept as a thumb-rest
  anchor) after 3 **committed** swipes — taps deliberately do not count, since
  tapping is the misconception being corrected. Progress persists in
  `localStorage` under `pb3d.swipeHint.v1`. Purely visual: it never touches
  classification, and is `pointer-events: none` so it cannot swallow the gesture
  it advertises. It yields to `#superBtn` while the meter is armed
  (`.btns-br.armed ~ #swipePad`), so it must stay the last `#hud` child.

---

## Stability Index

Computed at contact time in `game._computeStability(p)`:

```
distFactor = max(0, 1 - dist2D(ball, player) / SWEET_SPOT[difficulty])
velFactor  = max(0, 1 - (playerSpeed / HUMAN_SPEED) * VEL_WEIGHT)
stability  = distFactor × velFactor         → [0, 1]
```

**DUPR sweet-spot radii** (`STABILITY.SWEET_SPOT`):

| Difficulty | Sweet-spot radius |
|---|---|
| family | 1.2 m |
| easy (4.0) | 0.7 m |
| normal (4.5) | 1.0 m |
| hard (5.0 / Pro) | 1.4 m |

`STABILITY.VEL_WEIGHT = 0.45` — a full-sprint hit (5.2 m/s) removes 45 % of stability.

### Quality Tiers (`Shots.stabilityQuality`)

| Tier | Stability range | Arc effect |
|---|---|---|
| `clean` | `> FLOAT_THRESHOLD (0.45)` | Base apex; lands at target's feet |
| `float` | `POPUP_THRESHOLD..FLOAT_THRESHOLD` | Apex + `FLOAT_APEX_ADD_V2 (0.55)` — high, returnable |
| `popup` | `≤ POPUP_THRESHOLD (0.18)` | Apex + `POPUP_APEX_ADD_V2 (1.3)` — very high, attackable |

Apex loft is **additive and capped** (`MISHIT_APEX_MAX_V2 3.4`, never a lob) via
`Shots.apexForQualityV2(baseApex, quality)` before the shot is solved. A
float/popup-quality drive/speedup also drops out of the driven family into the arc
solver, so the mishit balloons into a punishable sitter.

Practice mode uses the same Stability Index, but with wider grading thresholds
so "clean" and "perfect" map to an arcade-usable sweet spot rather than exact
match-play precision.

---

## Power Cap

`Shots.maxIntent(ballY)` returns the highest allowed intent for a given ball height:

| Ball height | Max intent | Effect |
|---|---|---|
| `≤ POWER_CAP.NET_H` (0.86 m) | `'touch'` | Forced soft shot — dink or drop |
| `> NET_H` and `< SMASH_H` | `'power'` | Normal range |
| `≥ POWER_CAP.SMASH_H` (1.5 m) | `'smash'` | Overhead smash path |

### Smash Code Path

When `maxIntent` returns `'smash'`, **both human and AI execute a dedicated steep arc** — this is not just a flag passed to `classify()`.

**Human** (`game._hit()`): after `targetX`/`blend` are computed, a smash override fires:
- apex = `POWER_CAP.NET_H + 0.06` (0.92 m) — below contact height, so the arc dives downward
- spin = 7.0 topspin; margin = 0.06
- aims at the computed `targetX`/`at.z` (player's stick direction is respected)

**AI** (`ai.chooseShot()`): explicit branch at `ball.pos.y ≥ smashMin` (style-tuned, ~1.2–1.45 m):
- Same apex (0.92 m); spin = `5.0 + shotIQ × 2.0`
- Risk-gated: `Math.random() < aggression × speedupBias` (a Pro banger attacks nearly every pop-up; a beginner/defensive lets more go)
- CPU waits for a rising ball to reach peak before striking (`game._checkContacts` defers until `vel.y ≤ 0`)
- CPU also waits through the opening two-bounce lock; no serve/return volleys.

**Pickleball reality**: a ball almost never bounces above smash height — pickleballs bounce low (see Bounce Height Reference). Smashes happen off **in-air pop-ups** created by the stability system (float/popup tiers) or a lob that hangs too long.

---

## Dink Battle

Triggered when **all active players are in the kitchen zone** (`|z| < KITCHEN + 0.5`)
**and** the ball height is ≤ `POWER_CAP.NET_H`.

`Shots.dinkBattleTarget(playerPos, ballPos, fwd)` returns P2:
- **Default:** Cross-court diagonal kitchen corner (`targetX = −sign(playerX) × HALF_W × 0.70`).
- **Pulled fallback:** If `|playerX − ballX| > 1.5 m`, returns a straight neutral dink
  (`targetX = 0`) — safer when out of position.

---

## Practice Mode

Practice is a dedicated third mode, not a match variant.

### Structure

- One active player only: the human on the near side
- A Titan-style machine sits on the far baseline T
- The first feed is a deep middle ball so the player starts with a baseline drive
- Later feeds randomize across legal near-side target zones

### Rep Flow

1. Machine feeds one live practice ball.
2. Human moves and swings using the normal hit model.
3. On contact, the rep is graded immediately.
4. The returned shot continues as a **visual-only** ball with a landing marker.
5. The next feed can start while the old return is still finishing.
6. Visual-only return balls disappear after they land/bounce out.

### Practice Feedback

Practice feedback combines:
- timing: based on where the ball is relative to the player's body at contact
- positioning: distance from the player's strike zone
- stability: same `_computeStability()` used in match play

Labels:
- `perfect`
- `clean`
- `good`
- `reach`
- `early`
- `late`
- `far`
- `whiff`

### Live Ball Cue

During practice rallies, the incoming ball changes color as it enters a useful
contact window:
- default green = outside the cue window
- brighter yellow-green = acceptable/good window
- cyan = clean contact window
- hot orange = best/perfect window

This cue is advisory only; the actual shot still depends on the shared contact,
stability, and shot-resolution logic.

---

## Deeper-Opponent Targeting

For normal shots (not dink battle, not specialty), when the joystick aim is
near-neutral (`|blend| < 0.15`), the default P2 aim steers toward the opponent
**further from the net** (`game._deeperOpponent(team)`) and lands 0.6 m
**laterally away from their body** to force movement.

The AI (`chooseShot`) applies the same logic via the `opponents` parameter for
`drive`, `speedup`, and `drop` shots.

---

## Serve

- Diagonal deep serve into the correct service box (cross-court), ~75% depth.
- A solved arc from the `serve` envelope (`shots.js` `PROFILES_V2.serve`): apex
  hint `2.30 m`, topspin `spinX = 2.5`, `vMax = 16`, margin `0.30`. Runs through
  `Physics.solveArc` like every other shot.
- Rules enforce diagonal placement; landing in the wrong box = `serve-wrong-court` fault.

---

## Rules

Implemented in `rules.js` (pure, no Three.js).

| Rule | Enforcement |
|---|---|
| Two-bounce rule | Serve + return must bounce before being struck; play stays bounce-locked until `rally.doubleBounceOpen` |
| Kitchen volley | Volleying while `inKitchen = true` during open play = fault |
| Match mode | Doubles uses four players; singles uses one player per side |
| Doubles serve rotation | `serverNum 1/2`, `serverSlot 0/1`, starts `0-0-2` |
| Singles serve rotation | One server per side; side out immediately when receiver wins |
| Side-out scoring | Only serving team scores; game to 11 win-by-2 |
| Diagonal serve | `Rules.serveCourt()` checks landing `x`-sign vs required diagonal |

---

## AI System

### Difficulty Levels (`ai.js` `LEVELS`) — the skill tier

DUPR is the **skill tier** and is chosen in the menu. It sets every mechanical +
skill trait for **all** CPUs on the court (the human's partner can be overridden
via `partnerDiff`). The old overloaded `smart` scalar is now split into two
independent axes — `shotIQ` and `aggression` — so play *style* (personas, below)
is separable from skill.

| Level | DUPR label | `speed` | `react` | `reactJitter` | `err` | `miss` | `shotIQ` | `aggression` |
|---|---|---|---|---|---|---|---|---|
| family | FAMILY | 4.4 | 0.34 | 0.10 | 0.42 | 0.16 | 0.34 | 0.30 |
| easy | DUPR 4.0 | 4.8 | 0.30 | 0.08 | 0.45 | 0.18 | 0.40 | 0.40 |
| normal | DUPR 4.5 | 5.2 | 0.18 | 0.05 | 0.28 | 0.08 | 0.70 | 0.70 |
| hard | DUPR 5.0 | 5.6 | 0.09 | 0.03 | 0.12 | 0.02 | 0.92 | 0.92 |

- **react** — seconds of delay before CPU hits; jittered per-ball by `reactJitter`
  (gaussian) so the AI is not metronomic (`game._checkContacts`).
- **err** — aim scatter radius (m); applied to `aim.x`, `aim.z`, and `apex`
- **shotIQ** — 0–1 quality of shot *selection* (drop-when-right, dink discipline,
  kitchen advance, poach tier, Pro-specialty unlock)
- **aggression** — 0–1 risk appetite (power vs touch), *independent* of shotIQ. In
  the base tiers it is seeded equal to shotIQ so the `balanced` style reproduces
  the pre-persona AI. `smart` remains as an alias of `shotIQ`.
- **miss** — base unforced-error rate; now **pressure-linked** (scaled by the
  incoming ball's contact difficulty and by score pressure, see below).
- **FAMILY** is now a genuine beginner (slow, sloppy, passive), no longer a clone
  of NORMAL.

### Play Styles / Personas (`src/strategies/personas.js`)

Each CPU also has a **play style** layered over the skill tier — this is the
per-opponent differentiator, assigned per character in `src/characters.js`
(default `balanced`). Opponent identity = **DUPR (skill) × style**.

| Style | Behavior | Trait shift |
|---|---|---|
| **BALANCED** | Identity — reproduces the baseline AI; no glaring weakness | none |
| **BANGER** | Aggressive attacker: drives the 3rd, speeds up, rarely lobs | +aggression, −shotIQ, +speedupBias, −dropBias, low lob, **superBias 1.5** |
| **DEFENSIVE** | Counter-puncher: dinks/drops/resets, situational lobs, steady | −aggression, +shotIQ, +speed, +dropBias/dinkBias/lobBias, −err, **superBias 0.6** |

`AI.makeAI(level, persona)` merges the two via `personas.mergeTraits`. Strategy
formulas read the **gap** `aggBias = aggression − shotIQ` (0 for balanced), so
balanced stays neutral while banger/defensive diverge. The character picker, VS
splash, and character preview surface each style (tag + blurb + Power/Touch/
Control/Speed bars derived from the resolved `DUPR × style` config).

**Score-awareness** (`common.scorePressure`): near game point the CPU tightens up
protecting a lead (lower aggression + fewer misses) and gambles when behind late.

**Pressure-linked errors** (`common.ballDifficultyMult`): the effective `miss`
scales with the incoming ball's contact quality — a well-struck, stretched ball
forces more errors than a sitter.

**Situational lobbing** (`common.situationalLob`): replaces the old flat random
lob roll — fires reactively when opponents are jammed at the kitchen and the ball
is too low to attack, scaled by shotIQ + the style's `lobBias`.

### Shot Selection (`AI.chooseShot`)

`ai.js` is now a dispatcher over mode-specific strategy modules:
- `src/strategies/doubles.js` preserves the original doubles rhythm and deeper-opponent targeting.
- `src/strategies/singles.js` is intentionally **passing-first**: more width, more hit-behind-recovery returns, and fewer routine third-shot drops than doubles.

1. **Unforced error** (prob = pressure-linked `miss`) → fault (net or out)
2. **Serve** → diagonal deep
3. **Pro Erne** (`shotIQ ≥ 0.92` + position check) → see Specialty Shots
4. **Pro ATP** (`shotIQ ≥ 0.92` + position check) → see Specialty Shots
5. **Super smash** (before the normal smash) — meter armed AND `ball.y ≥ SUPER.SMASH_H` AND `rally.shots ≥ SUPER.MIN_SHOTS` AND phase `open` AND hitter outside the kitchen AND the team hasn't already used one this rally, gated by `Math.random() < aggression × superBias × SUPER.AI_UNLEASH_P` → `type: 'supersmash'`, `isSuper: true`. Present in **both** `strategies/doubles.js` and `strategies/singles.js` — editing only one means the AI silently never supers in the other mode.
6. **Overhead smash** — `ball.y ≥ smashMin` (style-tuned, ~1.2–1.45 m) AND `Math.random() < aggression × speedupBias` → steep arc (apex 0.92 m), `isSmash: true`
7. **Return of serve**
   - doubles: always deep power, usually at the deeper opponent's feet
   - singles: always deep power, but biased cross-court / behind recovery instead of at the body
8. **Third shot** (`rally.shots === 3`, serving team's first open-play hit)
   - doubles: `dropChance = clamp(max(0, shotIQ − 0.1) × 1.25 − aggBias × 0.8) × dropBias` (balanced ≈ 37/75/97 % by tier; banger drives it, defensive drops it)
   - singles: same shape, scaled by `SINGLES.THIRD_SHOT_DROP_SCALE` so baseline exchanges feature more drives and passes
9. **Power cap** — if `ball.y ≤ NET_H`, intent forced to `'touch'`
10. **Style-scaled intent** (zone + ball height + `shotIQ`/`aggression`): kitchen speedup, dink, or drive; transition/deep drop vs drive; situational lob when opponents are jammed at the kitchen
11. **Shot type** via `Shots.resolve`
11. **Target**
   - doubles: deeper-opponent feet for drive/speedup/drop; otherwise corner/body/wide
   - singles: passing-first open-court placement. Drives and speedups aim away from defender position; when the defender is stretched wide, the strategy punishes the opposite half instead of continuing through them. Body balls are a low-frequency variation only.
12. **Scatter** — add `±err` noise to `aim.x`, `aim.z`, `apex`

### Movement (`game._moveCPU`)

Lane-aware doubles positioning:
- Each CPU covers one lateral half (`_laneSign`).
- **Kitchen advance** is gated separately for the two teams:
  - **Returning team**: advances immediately once `rally.phase === 'open'` (after the return lands). Their net partner starts at the kitchen in formation already.
  - **Serving team**: stays at the baseline until `rally.shots >= 3` (after they hit their 3rd shot). Then advances at the same rate as the returning team.
  - Advance fraction = `clamp(shotIQ × 1.6 − 0.2, 0, 1)` toward the kitchen line (shotIQ-scaled):
    | Difficulty | Advance | Position |
    |---|---|---|
    | easy (0.40) | 0.44 | mid-court |
    | normal (0.70) | 0.92 | near kitchen |
    | hard (0.92) | 1.00 | kitchen line |
- Responsible player chases the ball's predicted landing (`AI.predict`).
- Pop-up detection: if the predicted apex (`prediction.peakY`) ≥ 2.0 m, the CPU holds its advance position instead of retreating to the landing point — stays forward to smash overhead.

`AI.predict` fast-path: if `ball.flight` is cached, returns the solved landing directly (exact, O(1)).
Otherwise falls back to forward integration.

Singles positioning:
- Each side has one player, so `_responsibleSlot()` always resolves to slot 0.
- The CPU covers the full side instead of a left/right lane.
- Serve formation places only the server and receiver behind their diagonal courts.
- The receiver reads serves from a slightly shallower depth than the old shared logic (`SINGLES.RETURN_READ_Z`) to cut down clean whiffs.
- Lateral pursuit starts early (`SINGLES.CHASE_X_BIAS`) so singles defenders break wider sooner instead of waiting under a doubles-style lane read.
- Recovery shades lightly opposite the opponent's current x-position rather than parking dead center, which helps the next pass read like singles instead of two-up doubles spacing.
- Poaching is disabled because there is no net partner.

### Human neutral aim assist

When the human holds a near-neutral stick (`|blend| < 0.15`), the default assist now comes from the active mode strategy:
- doubles: aim away from the deeper opponent's body
- singles: bias toward the open half away from the lone defender

This keeps casual neutral swings tactically sensible in singles without changing manual left/right aim behavior.

---

## Poaching

### Human poach

The human can poach by moving in front of their AI partner and timing a swing.
This is handled inline in `game._checkContacts()` (see **Hit Model → Who gets the
ball**), not in `AI.checkPoach`. There is **no per-ball ownership flag** — the
default assignment is lane-based (`_responsibleSlot`), and the human override
promotes `players[0]` to hitter when in reach with an active swing window.

The HUD aim marker (`game._updateHUD`) also lights up when the human is in reach
of an incoming ball (not just when it's their lane), giving visual confirmation a
poach is available.

### AI poach (`AI.checkPoach`)

Called after every paddle strike. Checks whether the receiving team's **net partner**
(not the responsible returner) should intercept. Skipped when the partner is the
human (`game._checkPoach` bails on `!partner.ai`) — the human poaches manually via
the contact-dispatch override above.

| Difficulty | Behaviour |
|---|---|
| easy (4.0) | Never poaches |
| normal (4.5) | Poaches if the landing `x` is within `SPECIALTY.POACH_NORMAL_X_HALF (0.85 m)` of partner's x |
| hard (5.0 / Pro) | Scans the cached flight `samples`; poaches if any point is within `SPECIALTY.POACH_PRO_REACH (1.9 m)` of partner **and** the partner can physically get there in time |

The Pro check is both spatial **and temporal**: each flight sample carries a `t`
(added to `physics.simulateFlight`), and a sample is only poachable when
`dist <= ai.cfg.speed * (t + ai.cfg.react)`. Without the time term the check was
purely geometric and a partner would "poach" balls travelling far too fast to
intercept — wrong at any speed, and blatant against a super smash.

### Poaching is DEFERRED, never instant

`_checkPoach()` only **arms** a poach (`game.pendingPoach`);
`_checkPoachContact()` executes it when the ball actually reaches the poacher,
checked per physics substep so a fast ball can't step past the window.

> ⚠️ This used to redirect immediately, at the instant the *original* player
> struck — teleporting the ball to the partner's position and relaunching from
> there. Measured jumps of **4–5.5 m in a single frame**, frequently across the
> net. That is what produced "the ball just appears and you never see anyone hit
> it". It also skipped the entire intervening flight, so the opponent got no
> chance to react to a ball that had visibly never travelled. Only Pro poaches
> (easy/family return early), which is why it looked intermittent.
>
> **Do not re-inline it.** If a poach must depend on something known only at hit
> time, store it on `pendingPoach` and let the contact check consume it. The
> super smash's blast uses the same arm-then-resolve shape.

On execution the ball is already AT the poacher, so `_executeShotV2` snaps to the
live contact point exactly as it does for every other shot — no teleport — and
redirects toward open court on the hitter's side.

---

## Specialty Shots (Pro / hard only)

Both triggered in `game._hit()` by position checks **before** normal shot logic. Only available when `difficulty === 'hard'`.

### Around-the-Post (ATP)

**Trigger:** `|player.x| > COURT.HALF_W + SPECIALTY.ATP_X_MARGIN (0.35 m)`

Player has been pulled completely outside the sideline. The swing fires the `atp`
envelope — a **flat shot around the net post**:
- `allowNet` skips the solver's net-clearance raising, so the low arc goes around the post rather than over it.
- Targets deep mid-court on the same lateral side.
- `spinY` applies sidespin curving around the post.

AI Pro (`shotIQ ≥ 0.92`) can also execute ATPs via `AI.chooseShot`.

### Erne

**Trigger:** `|player.x| > COURT.HALF_W + SPECIALTY.ERNE_X_MARGIN (0.25 m)` AND `|player.z| < SPECIALTY.ERNE_Z_MAX (2.7 m)`

Player has positioned outside the sideline within the kitchen zone. The swing:
- Bypasses the kitchen volley rule (`inKitchen` forced to `false`).
- Fires a downward smash: apex 0.95 m, heavy topspin (+3.5), P2 targeted mid-court.
- No leap animation yet (cosmetic follow-up; game logic is complete).

AI Pro can also execute Ernes via `AI.chooseShot`.

---

## Power Meter & Super Smash

A per-player meter that fills on **clean contacts only** and is spent as one huge
flat drive that knocks the receiver off their feet and forces a weak pop-up.
Pure economy + stun logic lives in `src/power.js` (node-testable); all tuning is
in `constants.js SUPER`.

### Charging
`_chargeMeter()` banks `Power.chargeFor(quality, stability)` on every paddle
contact, but only a `clean` grade pays. `_cpuHit` deliberately charges off the
**true** stability, not the forced-`clean` value it uses for smashes, or bangers
would bank meter for every stretched overhead.

**Measured, and it drove the tuning:** only ~25-30% of contacts grade clean, i.e.
~0.2 clean contacts per player per point (~4 per player per 11-point game). The
meter is sized so ~4 clean contacts fills it — roughly one super per player per
game. An earlier `POINT_CARRY: 0.6` decay was removed because with income that
sparse it capped the meter at 2.5x per-point income, mathematically **below 1.0**:
the bar could never fill no matter how long you played.

### Unleashing — `Power.canUnleash()`
All gates in one testable place: armed, ball at/above `SUPER.SMASH_H`, `rally.shots
>= MIN_SHOTS`, phase `open`, and **not from inside the kitchen**.

A refused super **does not spend**. The branch simply doesn't fire and the swing
falls through to the normal path — you may lose the point, but you keep the meter.

Two measured corrections shaped these gates:
- **Height is a weak lever.** Real contact heights are far lower than they feel:
  median **0.49m**, p99 **0.84m**, and only ~1 in 99 contacts clears net height.
  Gating at `POWER_CAP.SMASH_H` (1.5) made the super literally unfireable across
  whole matches. `SUPER.SMASH_H` is therefore only a floor (0.50) meaning "not
  scraped off your shoelaces". *(The same data implies the AI's normal smash
  branch, gated on `smashMin` 1.2-1.45, is near-dead code — worth revisiting.)*
- **The kitchen ban is the real protection.** `SUPER.NO_KITCHEN` refuses supers
  from inside the non-volley zone entirely, not merely on a volley. That is what
  protects the dink battle and the 4-shot pattern, and unlike a height threshold
  it is a condition the player can deliberately satisfy by backing up.

### The shot — `supersmash` is DRIVEN, not direct
The obvious choice (`direct`, like `smash`) pins the launch along the
contact→target line, which only works from a genuine overhead. Measured net
crossings from a 0.5-1.0m contact were **0.27-0.57m** — straight into a 0.86m net.
Driven crosses the tape at `netH + margin`, so it clears from any height, and
launch speed scales with contact height: **~11 m/s off the shoelaces, ~31 m/s off
a high ball**. A higher ball earns a faster super. The super's identity is the
blast, not one fixed velocity.

### The super is aimed AT A PLAYER
`_pickSuperVictim()` chooses the target BEFORE the shot is solved, and
`_executeSuper()` then aims at that player's position — a body bag should
actually be aimed at a body. Lateral input chooses WHICH opponent rather than a
patch of court; with the stick near neutral it targets whoever is closest to the
net (least time to react, most dramatic). The same player is written straight
into `this.blast`, so intent and outcome cannot disagree.

The target is clamped inside the court (someone stretched wide or standing behind
the baseline can't turn the super into an out-of-bounds fault) and kept at least
0.35m beyond the kitchen line (a target that short makes the driven solve steep
and slow, which reads as a dud rather than a rocket).

This raised the connect rate to **~0.90** with the landing within **~1m** of the
victim. The earlier design aimed at a court spot and inferred the victim from the
landing, which meant the "body bag" frequently sailed past nobody.

**Cap: one super per TEAM per rally** (`SUPER.MAX_PER_RALLY`). Without it there
is a feedback loop — a blasted rally runs long, long rallies bank more clean
contacts, more charge means more supers, which makes rallies longer still.
Measured at DUPR 5.0 it doubled the mean rally from 15.7 to 36.6 shots; the cap
brings it to 24.4. At DUPR 4.0 the effect is negligible either way (4.8 vs 4.6),
so this is a Pro-tier concern.

### The blast — a scripted intercept
`_checkBlastContact()` runs per **substep** in `_tickRally`, before `_checkContacts`
and **ignoring `lastHitCooldown`**. That bypass is the entire point: the cooldown
is 0.12s, a super covers ~3.6m in that time and kitchen-to-kitchen is only ~4.3m,
so a super struck near the net arrives *before* the receiver is even eligible to be
checked — they would be silently skipped and it would be a free winner.

Being scripted is also what lets the victim "contact the ball while being blown
back": no reach gate to fail, no swing to time, no cooldown to wait out. Paddle
contact and knockback fire in the same instant.

The victim is **exempt from the kitchen-volley rule** (faulting someone for being
hit by the opponent's shot while standing in the kitchen would be perverse);
`MIN_SHOTS >= 3` already guarantees the two-bounce lock is open. They return a
`blastpop`: weak, high, short. Measured hang **~1.53s** against **0.86s** of stun,
leaving a doubles partner ~0.65s to cover.

**If the receiver is out of position the blast simply never fires** — the ball
bounces twice and it's a normal `no-return` point. That is what keeps "not a
guaranteed put-away" honest in both directions (tracked as `metrics.supersMissed`).

### Stun — five gates
`blown (0.26s) -> down (0.30s) -> up (0.30s)`, ~0.86s total, identical in singles
and doubles. A stunned player is gated in **five** places, all required:
`_updateHuman`, `_moveCPU`, `_checkContacts` (incl. the human poach promotion),
`_checkPoach`, and the authored `api.update` in `players.js` — that last one
force-restores a locomotion loop every frame and would otherwise stomp the
knockback pose within a single frame.

`_responsibleSlot` prefers the **un-stunned partner in doubles only**. Without it
the ball keeps being assigned to the player on the ground and every blasted rally
dies instantly.

### Singles is deliberately brutal
Everything above is mode-agnostic; the only difference is that the partner
preference has no partner to find. The singles victim pops the ball up and must
chase their own pop-up from the floor, which is *near*-guaranteed to end the point.
That is intended. **Do not tune it away** — a shift toward `no-return` in singles
is expected, unlike in doubles where it is the alarm that the super became a free
winner. Frequency is the dial (`MIN_SHOTS`, `CHARGE_CLEAN`, `SMASH_H`), never the
stun, because weakening the stun would break doubles to fix a singles complaint.

Note singles rallies average only ~2.9 shots, so `MIN_SHOTS: 3` opens in a minority
of rallies and supers are naturally rarer there. 3 is the floor — lowering it would
put the scripted blast inside the two-bounce lock.

### Every `SUPER` constant

| Key | Default | What it does |
|---|---|---|
| `CHARGE_CLEAN` | 0.25 | Meter gained per clean contact (~4 to fill) |
| `CHARGE_QUALITY_BONUS` | 0.6 | Extra fraction scaled by stability above the clean threshold |
| `FULL` / `COST` | 1.0 / 1.0 | Full bar, and a full spend — no partial supers |
| `POINT_CARRY` | 1.0 | Meter kept across a point. **< 1 caps the bar below full** — see the warning above |
| `MIN_SHOTS` | 3 | Rally-shot floor. Also keeps the blast outside the two-bounce lock |
| `MAX_PER_RALLY` | 1 | Supers per **team** per rally; bounds the long-rally feedback loop |
| `SMASH_H` | 0.50 | Minimum ball height. Only a floor — contact height is median 0.49 m |
| `NO_KITCHEN` | true | Refuse supers from inside the NVZ entirely. This protects the dink battle |
| `BLAST_REACH_MUL` | 1.6 | × `HIT.REACH` — the victim is knocked *into* the ball |
| `BLAST_REACH_Y` | 2.4 | Max ball height for the blast to connect |
| `BLAST_BACK` | 1.35 | Metres the victim slides backward |
| `STUN.BLOWN/DOWN/UP` | 0.26 / 0.30 / 0.30 | Knockdown phases, ~0.86 s total. Same in singles and doubles |
| `STUN_PITCH` | 1.35 | Radians the body pitches back. Sign matters; root needs `rotation.order 'YXZ'` |
| `STUN_LIFT` | 0.26 | Root lift so a flat body clears the court. **Must stay positive** — the pivot is at the feet |
| `TIME_SCALE` | 0.34 | Sim speed during a super (the "super freeze") |
| `TIME_RAMP_IN` / `TIME_RAMP_OUT` | 0.06 / 0.30 | Seconds to ease into / out of slow-mo |
| `TIME_HOLD_AFTER` | 0.55 | Slow-mo held after the blast connects |
| `SHAKE_DELIVER` / `SHAKE_BLAST` | 0.30 / 0.38 | Camera shake — the two largest in the game (normal hit is 0.08) |
| `BALL_SCALE` | 1.35 | How much the ball swells while hot |
| `BALL_EMISSIVE_INT` | 2.4 | Hot-ball emissive intensity |
| `TRAIL_OPACITY` | 0.95 | 1px `THREE.Line` trail opacity while hot |
| `TRAIL_WIDTH` | 0.34 | Ribbon half-width (m) at the head; tapers to 0 at the tail |
| `VOICE_BASE` | boy 128 / girl 208 | Grunt base pitch (Hz) per `characters.js` `voice` |
| `AI_UNLEASH_P` | 0.45 | Chance a ready AI takes a qualifying look |
| `AI_WAIT_H` | 1.9 | A charged AI defers contact for a *higher* ball than usual |

### Time dilation ("super freeze")
Measured: a super flies in ~0.53s and the blast lands ~0.18s after contact, so
the whole beat was over in under a second and read as "the ball just vanished".
`_superTimeScale()` slows the **sim dt** to `SUPER.TIME_SCALE` (0.34) while a
super is live, holding through the knockdown then easing out — ~1.7s of slowed
wall time per super. Because the scaling is applied to dt *before* anything
downstream runs, the replay recorder captures the slowed stream and instant
replay reproduces it faithfully. Verified inert outside a super: the time scale
holds at exactly 1.0 across 6000 frames of normal play.

### Presentation
Glow/grow/pulse on the ball, an additive **tapered ribbon** for the speed trail,
a shockwave ring + dust puff at the victim's feet, the two biggest camera shakes
in the game, and a 3-layer procedural boom + gendered grunt + ground thud.
Replay captures the continuous super state through `makePlayback.sample()` and
the one-shot blast impact through `makePlayback.consumeEvents()`; keep both paths
in sync when adding presentation beats. See GRAPHICS.md for why none of it
depends on bloom.

## The 4-Shot Pattern

Real pickleball's strategic rhythm is the first four shots. Each shot is charted below against how the code models it.

| Shot # | Who hits | Real intent | How the code models it |
|---|---|---|---|
| 1 — Serve | Serving team | Deep diagonal; push receiver back | `isServe` path: `serve` envelope (apex hint 2.30 m, `spinX 2.5`), targets 75% depth diagonally |
| 2 — Return | Receiving team | Deep; buy time to reach kitchen | `isReturn` (`shots === 2`): intent always forced to `'power'`; receiver's partner starts at kitchen in formation |
| 3 — 3rd shot | Serving team | Drop into kitchen; bleed their kitchen advantage | `isThirdShot` (`shots === 3`): high drop probability (37–97% by DUPR); serving team CPUs hold baseline until after this shot |
| 4 — 4th shot | Receiving team | Attack if drop is bad; dink if drop is good | No special branch — normal intent selection. Kitchen player reads bounce height: clean drop → forced dink; float/popup → speedup or smash |

**Variance is intentional.** The Stability Index means none of these shots is free: a rushed drop produces a float or popup (attackable); a shanked return goes short and lets the server's team stay back. AI difficulty scales how consistently each team executes the pattern (`shotIQ`/`aggression` and `err` levers), and play style shifts which shots it favors.

**Both teams at the kitchen.** After a successful exchange through shots 1–4, both teams are typically at the kitchen line. The game enters the dink battle mode (see Dink Battle section) waiting for someone to float a ball high enough to speed up or smash.

---

## Tuning Surfaces — Where to Change Numbers

**Never scatter gameplay numbers across `game.js` or `ai.js`.** All tuning lives
in exactly two places:

| File | What lives here |
|---|---|
| **`src/constants.js`** | Court geometry, physics (`PHYS_V2`, `TIMING_V2`), hit timings (`HIT`), Stability Index (`STABILITY`), power cap (`POWER_CAP`), specialty triggers (`SPECIALTY`), power meter + knockdown (`SUPER`) |
| **`src/shots.js`** | Shot profiles (`PROFILES_V2`) — apex hint, depth, spin, margin, `vMax`, family flags per shot type (incl. `supersmash` / `blastpop`) |

Changing AI difficulty feel? Edit `LEVELS` in `ai.js`. Changing AI **play style**
feel? Edit `PERSONAS` in `src/strategies/personas.js`. Both are the allowed
exception — AI skill/style config belongs to the AI modules, not `constants.js`.

---

## Quick Tuning Reference

Use the Bounce Height Reference table (in Shot Types section) when adjusting drop apex.

### Ball / Arc Feel

```
Feel too floaty overall          → lower STABILITY.FLOAT_APEX_ADD_V2 (constants.js default 0.55)
                                    or raise STABILITY.FLOAT_THRESHOLD (constants.js default 0.45)
Too many pop-ups on good hits    → raise STABILITY.POPUP_THRESHOLD (default 0.18)
Not enough pop-ups               → lower STABILITY.POPUP_THRESHOLD
Clean drop still attackable      → lower PROFILES_V2.drop.apex (current 2.10); use Bounce Height table
Drop lands too short             → increase PROFILES_V2.drop.absZ (or use aimDepth)
Drives land too short/long       → adjust PROFILES_V2.drive.depthFrac (default 0.80)
Smash arc not steep enough       → lower POWER_CAP.NET_H + 0.06 offset in game._hit / ai.chooseShot
Smash fires too early (easy)     → raise POWER_CAP.SMASH_H (constants.js default 1.5)
Ball too bouncy overall          → lower PHYS_V2.RESTITUTION (default 0.62)
```

### Super Smash

Read the measured numbers in AGENTS.md -> "Balance numbers worth knowing" before
turning any of these — several are counter-intuitive.

```
Meter fills too fast/slow        → SUPER.CHARGE_CLEAN (0.25 ≈ 4 clean contacts to fill)
Meter never fills at all         → check SUPER.POINT_CARRY. Any value < 1 caps the bar at
                                    carry/(1-carry) × per-point income, and with ~0.2 clean
                                    contacts per player per point that ceiling is BELOW full
Supers happen too often          → raise SUPER.MIN_SHOTS, or lower SUPER.AI_UNLEASH_P (AI only)
Supers never fire                → SUPER.SMASH_H is the usual culprit. Contact height is
                                    median 0.49m, so any threshold near net height (0.86)
                                    almost never qualifies
Supers fired from the kitchen    → SUPER.NO_KITCHEN. This, not height, protects the dink battle
Rallies balloon after a super    → SUPER.MAX_PER_RALLY (uncapped, this doubled Pro rallies)
Super feels weak / slow          → it is DRIVEN, so speed scales with contact height
                                    (~11 m/s low, ~31 m/s off a high ball). Do NOT switch it
                                    to `direct` — direct cannot clear the net from a low contact
Super sails out                  → raise vMax, never the target depth; the driven solver keeps
                                    the landing honest
Blast never connects             → SUPER.BLAST_REACH_MUL / BLAST_REACH_Y; compare
                                    metrics.supersBlasted against supersFired
Super is a guaranteed winner     → lengthen blastpop hang (apex/vMax) or shorten SUPER.STUN.
                                    Tune the PAIR, never one alone. Expected in singles
Victim recovers too fast/slow    → SUPER.STUN.{BLOWN,DOWN,UP} (total ~0.86s)
Beat is too quick to see         → SUPER.TIME_SCALE / TIME_HOLD_AFTER (the "super freeze")
Body falls through the court     → SUPER.STUN_LIFT must stay POSITIVE (the pivot is at the feet)
Body falls the wrong way         → SUPER.STUN_PITCH sign; root needs rotation.order 'YXZ'
Grunt pitch wrong for a character→ characters.js `voice` + SUPER.VOICE_BASE
```


### Power Cap / Intent

```
Power cap too restrictive        → raise POWER_CAP.NET_H (default 0.86)
                                    or lower it to create a wider "must-lift" zone
Smash window too wide            → raise POWER_CAP.SMASH_H (default 1.5)
Smash window too narrow          → lower POWER_CAP.SMASH_H
AI smashes too often             → raise the 1.3 threshold in ai.js (line ~190) toward 1.5
```

### 4-Shot Pattern

```
Serving team reaches kitchen too fast   → raise the shots >= 3 gate in game._moveCPU
Serving team stays back too long        → lower it (e.g. >= 2) or remove isServingTeam guard
3rd-shot drop too rare on normal        → raise LEVELS.normal.shotIQ (or lower .aggression) — shifts dropChance up
3rd-shot drop too frequent on easy      → lower the -0.1 offset or 1.25 multiplier in isThirdShot block (strategies/*.js)
A style attacks/drops too much          → tune PERSONAS[style] in src/strategies/personas.js (dAggr / dropBias / speedupBias)
Return of serve sometimes drops         → the isReturn branch (shots===2) forces power; don't remove it
```

### AI Difficulty Feel

```
AI misses too much (easy)        → lower LEVELS.easy.miss in ai.js (default 0.18)
AI too accurate (hard)           → raise LEVELS.hard.err (default 0.12)
AI too reactive / robot-fast     → raise LEVELS.hard.react (default 0.09)
AI doesn't go for kitchen (easy) → raise LEVELS.easy.shotIQ (shifts advance fraction up)
AI crashes kitchen too hard      → lower LEVELS.hard.shotIQ or change 1.6 multiplier in _moveCPU
Dink battle too passive          → lower the shotIQ - 0.3 threshold in chooseShot kitchen branch
Opponents all feel the same      → they may all be BALANCED; assign styles in src/characters.js
Reaction feels robotic           → raise LEVELS.<tier>.reactJitter (per-ball gaussian spread)
```

### Specialty Shots

```
Poach too frequent at 4.5        → increase SPECIALTY.POACH_NORMAL_X_HALF (default 0.85 m)
Pro poach too easy to avoid      → decrease SPECIALTY.POACH_PRO_REACH (default 1.9 m)
Erne fires accidentally          → increase SPECIALTY.ERNE_X_MARGIN (default 0.25 m)
ATP fires too early              → increase SPECIALTY.ATP_X_MARGIN (default 0.35 m)
```
