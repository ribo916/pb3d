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

---

## Ball State

```js
ball = {
  pos:   {x, y, z},       // world position (m)
  vel:   {x, y, z},       // velocity (m/s)
  spin:  {x, y, z},       // angular-ish magnitude (decay over time)
  live:  boolean,
  lastBounceSide: 0|1|-1, // +1 near, -1 far, 0 none
  spline: null | {         // set during in-flight arc; null during roll-out
    P0, P1, P2,            // Quadratic Bezier control points
    duration,              // total flight time (s)
    elapsed                // time elapsed so far (s)
  }
}
```

---

## Trajectory System — Hybrid Spline + Physics

Every paddle strike creates a **Quadratic Bezier** spline on the ball. While
`ball.spline` is non-null the ball position is sampled from the curve each
sub-step; `Physics.step()` is **not called** during flight. When `elapsed >=
duration` (or `y <= BALL_R`) the ball lands, the bounce event fires, and the
ball transitions back to `Physics.step()` for post-bounce roll-out.

### Three Control Points

| Point | Position | Purpose |
|---|---|---|
| **P0** | Paddle contact point (snapped at hit time) | Start |
| **P1** | `z = 0` (net plane), `y = max(netHeight + margin, apexY)`, `x = midpoint(P0.x, P2.x)` | Arc apex — **net clearance by construction** |
| **P2** | Target court surface `(x, 0, z)` | Landing |

`Physics.computeP1(P0, P2, apexY, margin)` builds P1. Net clearance is
**guaranteed by geometry** — no iterative solver needed.

### Flight Time

`Physics.splineFlightTime(P0, P2, apexY)` uses the same up + down formula as
the old ballistic solver (consistent timing feel):
```
T = vy/g + sqrt(2 * apex / g)   where vy = sqrt(2g*(apexY - P0.y))
```

### Post-Bounce Physics

After the spline ends, `Physics.step()` takes over. It applies:
- Gravity (`PHYS.GRAVITY = 13.5 m/s²`, arcade-tuned)
- Air drag (`PHYS.AIR_DRAG = 0.045`)
- Restitution on bounce (`PHYS.RESTITUTION = 0.66`)
- Horizontal friction on bounce (`PHYS.FRICTION = 0.78`)
- Magnus curve from spin (`PHYS.MAGNUS = 0.020`)
- Spin decay (`PHYS.SPIN_DECAY = 1.5/s`)

The old `Physics.launch()` / `clearsNet()` / `solveShot()` functions remain
in `physics.js` for test continuity but are no longer called by the hit path.
**Fault shots** (AI errors) still use `_executeHit()` → `solveShot()` so they
reliably miss.

---

## Shot Types

Defined in `shots.js` `PROFILES`. Each profile sets the **default** arc;
Stability Index, power cap, and depth aim all modify the final spline.

| Type | Apex | Depth | SpinX | Use |
|---|---|---|---|---|
| `drive` | 1.3 m | 82% court | +4.0 (topspin) | Baseline power shot |
| `drop` | 1.75 m | 55% kitchen | −2.0 (backspin) | Third-shot drop; lands in kitchen |
| `dink` | 1.4 m | kitchen+0.25 m | −1.0 (backspin) | Soft kitchen exchange |
| `lob` | 4.2 m | 85% court | −1.0 (backspin) | Overhead change-up |
| `speedup` | 1.3 m | 50% court | +4.0 (topspin) | Attack a high floated ball |

### Bounce Height Reference

Bounce height ≈ `apex × RESTITUTION²` (= `apex × 0.44`). Net height is **0.86 m**.

| Shot | Apex | Clean bounce | vs Net | Notes |
|---|---|---|---|---|
| drive | 1.3 m | ~0.57 m | below ✓ | Receiver must lift |
| dink | 1.4 m | ~0.62 m | below ✓ | Receiver must lift |
| drop (clean) | 1.75 m | ~0.77 m | below ✓ | Kitchen player forced to dink |
| drop (float) | 2.89 m | ~1.27 m | above — attackable | Bad drop; kitchen player can speedup |
| drop (popup) | 4.55 m | ~2.00 m | smash zone | Very bad drop; overhead smash |
| lob | 4.2 m | ~1.85 m | above | Intentional high — meant to be chased |

Float and popup values come from the stability multipliers (`FLOAT_APEX_MULT 1.65`, `POPUP_APEX_MULT 2.6`) applied to the drop apex (1.75 m).

Use this table when tuning `PROFILES.drop.apex`: lower the number to make drops die lower (harder to attack), raise it to make even clean drops sit up.

---

## Shot Selection Pipeline

```
Player zone + ball height + intent
        ↓
Shots.classify() → shot type
        ↓
Shots.params()   → {apex, landZ, spinX, spinY, margin}
        ↓
Stability Index  → apex modifier (apexForQuality)
        ↓
Power cap        → intent override (maxIntent)
        ↓
Depth aim        → landZ nudge (aimDepth)
        ↓
Bezier build     → Physics.computeP1 → _executeSplineShot
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

### Cooldowns

- After a serve: `HIT.COOLDOWN_SERVE = 0.25 s`
- After a rally hit: `HIT.COOLDOWN_RALLY = 0.12 s`

### Input (Human)

| Input | Effect |
|---|---|
| Left/right stick `move.x` | Lateral aim blend |
| Forward/back stick `move.z` | Depth aim (`aimDepth`) — deeper or shorter |
| Swing button (forehand) | Opens swing window; `swingPower = 'power'` |
| Swing button (lob) | Opens swing window; `swingShot = 'lob'` |
| Backhand modifier | Adds −1.5 to spinX |

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
| `clean` | `> FLOAT_THRESHOLD (0.45)` | Base apex; P2 at target's feet |
| `float` | `POPUP_THRESHOLD..FLOAT_THRESHOLD` | Apex × `FLOAT_APEX_MULT (1.65)` — high, returnable |
| `popup` | `≤ POPUP_THRESHOLD (0.18)` | Apex × `POPUP_APEX_MULT (2.6)` — very high, attackable |

Apex is scaled by `Shots.apexForQuality(baseApex, quality)` before P1 is computed.

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

**AI** (`ai.chooseShot()`): explicit branch at `ball.pos.y ≥ 1.3 m` (slightly lower threshold):
- Same apex (0.92 m); spin = `5.0 + smart × 2.0`
- Skill-gated: `Math.random() < smart` (Pro attacks ~92% of pop-ups; Easy ~40%)
- CPU waits for a rising ball to reach peak before striking (`game._checkContacts` defers until `vel.y ≤ 0`)

**Pickleball reality**: a ball almost never bounces above smash height — pickleballs bounce low (see Bounce Height Reference). Smashes happen off **in-air pop-ups** created by the stability system (float/popup tiers) or a lob that hangs too long.

---

## Dink Battle

Triggered when **all four players are in the kitchen zone** (`|z| < KITCHEN + 0.5`)
**and** the ball height is ≤ `POWER_CAP.NET_H`.

`Shots.dinkBattleTarget(playerPos, ballPos, fwd)` returns P2:
- **Default:** Cross-court diagonal kitchen corner (`targetX = −sign(playerX) × HALF_W × 0.70`).
- **Pulled fallback:** If `|playerX − ballX| > 1.5 m`, returns a straight neutral dink
  (`targetX = 0`) — safer when out of position.

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

- Diagonal deep serve into the correct service box (cross-court).
- Implemented as a spline: `apex = 2.5 m`, light topspin `spinX = 2.0`.
- `Physics.computeP1` + `splineFlightTime` — same path as all other shots.
- Rules enforce diagonal placement; landing in the wrong box = `serve-wrong-court` fault.

---

## Rules

Implemented in `rules.js` (pure, no Three.js).

| Rule | Enforcement |
|---|---|
| Two-bounce rule | Serve + return must bounce before being struck (`rally.bouncesSinceHit < 1`) |
| Kitchen volley | Volleying while `inKitchen = true` during open play = fault |
| Doubles serve rotation | `serverNum 1/2`, `serverSlot 0/1`, starts `0-0-2` |
| Side-out scoring | Only serving team scores; game to 11 win-by-2 |
| Diagonal serve | `Rules.serveCourt()` checks landing `x`-sign vs required diagonal |

---

## AI System

### Difficulty Levels (`ai.js` `LEVELS`)

| Level | DUPR label | `speed` | `react` | `err` | `smart` | `miss` |
|---|---|---|---|---|---|---|
| family | FAMILY | 5.2 | 0.18 | 0.28 | 0.70 | 0.08 |
| easy | DUPR 4.0 | 4.8 | 0.30 | 0.45 | 0.40 | 0.18 |
| normal | DUPR 4.5 | 5.2 | 0.18 | 0.28 | 0.70 | 0.08 |
| hard | DUPR 5.0 | 5.6 | 0.09 | 0.12 | 0.92 | 0.02 |

- **react** — seconds of delay before CPU hits (simulates reaction time)
- **err** — aim scatter radius (m); applied to `aim.x`, `aim.z`, and `apex`
- **smart** — 0–1 score gating drop shot tendency, kitchen dink rate, speedup aggression
- **miss** — unforced error rate (10 % into net, 90 % sail out)

### Shot Selection (`AI.chooseShot`)

1. **Unforced error** (prob = `miss`) → fault (net or out)
2. **Serve** → diagonal deep
3. **Pro Erne** (smart ≥ 0.92 + position check) → see Specialty Shots
4. **Pro ATP** (smart ≥ 0.92 + position check) → see Specialty Shots
5. **Overhead smash** — `ball.y ≥ 1.3 m` AND `Math.random() < smart` → steep arc (apex 0.92 m), `isSmash: true`; skill-gated
6. **Return of serve** (`rally.shots === 2`) → always `'power'` (deep); no drops on the return
7. **Third shot** (`rally.shots === 3`, serving team's first open-play hit) → strongly prefer drop; `dropChance = max(0, smart − 0.1) × 1.25` ≈ 37 % easy / 75 % normal / 97 % hard
8. **Power cap** — if `ball.y ≤ NET_H`, intent forced to `'touch'`
9. **Skill-scaled intent** (zone + ball height + `smart`): kitchen speedup, dink, or drive; transition/deep drop vs drive
10. **Shot type** via `Shots.resolve`
11. **Target** — deeper-opponent feet for drive/speedup/drop; otherwise corner/body/wide
12. **Scatter** — add `±err` noise to `aim.x`, `aim.z`, `apex`

### Movement (`game._moveCPU`)

Lane-aware doubles positioning:
- Each CPU covers one lateral half (`_laneSign`).
- **Kitchen advance** is gated separately for the two teams:
  - **Returning team**: advances immediately once `rally.phase === 'open'` (after the return lands). Their net partner starts at the kitchen in formation already.
  - **Serving team**: stays at the baseline until `rally.shots >= 3` (after they hit their 3rd shot). Then advances at the same rate as the returning team.
  - Advance fraction = `clamp(smart × 1.6 − 0.2, 0, 1)` toward the kitchen line (smart-scaled):
    | Difficulty | Advance | Position |
    |---|---|---|
    | easy (0.40) | 0.44 | mid-court |
    | normal (0.70) | 0.92 | near kitchen |
    | hard (0.92) | 1.00 | kitchen line |
- Responsible player chases the ball's predicted landing (`AI.predict`).
- Pop-up detection: if `ball.spline.P1.y ≥ 2.0 m`, the CPU holds its advance position instead of retreating to the landing point — stays forward to smash overhead.

`AI.predict` fast-path: if `ball.spline` is set, returns `P2` directly (exact, O(1)).
Otherwise falls back to ballistic integration.

---

## Poaching (`AI.checkPoach`)

Called after every paddle strike. Checks whether the receiving team's **net partner**
(not the responsible returner) should intercept.

| Difficulty | Behaviour |
|---|---|
| easy (4.0) | Never poaches |
| normal (4.5) | Poaches if `P2.x` lands within `SPECIALTY.POACH_NORMAL_X_HALF (0.85 m)` of partner's x |
| hard (5.0 / Pro) | Samples 12 points along the Bezier; poaches if any point is within `SPECIALTY.POACH_PRO_REACH (1.9 m)` of partner |

On a successful poach the ball.spline is replaced in-place with a new redirected spline toward open court on the hitter's side.

---

## Specialty Shots (Pro / hard only)

Both triggered in `game._hit()` by position checks **before** normal shot logic. Only available when `difficulty === 'hard'`.

### Around-the-Post (ATP)

**Trigger:** `|player.x| > COURT.HALF_W + SPECIALTY.ATP_X_MARGIN (0.35 m)`

Player has been pulled completely outside the sideline. The swing fires a **flat spline around the net post**:
- P1 is placed **below net height** (y = 0.4 m) — bypasses the net-apex guarantee.
- P2 targets deep mid-court on the same lateral side.
- `spinY` applies sidespin curving around the post.

AI Pro (`smart ≥ 0.92`) can also execute ATPs via `AI.chooseShot`.

### Erne

**Trigger:** `|player.x| > COURT.HALF_W + SPECIALTY.ERNE_X_MARGIN (0.25 m)` AND `|player.z| < SPECIALTY.ERNE_Z_MAX (2.7 m)`

Player has positioned outside the sideline within the kitchen zone. The swing:
- Bypasses the kitchen volley rule (`inKitchen` forced to `false`).
- Fires a downward smash: apex 0.95 m, heavy topspin (+3.5), P2 targeted mid-court.
- No leap animation yet (cosmetic follow-up; game logic is complete).

AI Pro can also execute Ernes via `AI.chooseShot`.

---

## The 4-Shot Pattern

Real pickleball's strategic rhythm is the first four shots. Each shot is charted below against how the code models it.

| Shot # | Who hits | Real intent | How the code models it |
|---|---|---|---|
| 1 — Serve | Serving team | Deep diagonal; push receiver back | `isServe` path: apex 2.4 m, `spinX 2.0`, targets 75% depth diagonally |
| 2 — Return | Receiving team | Deep; buy time to reach kitchen | `isReturn` (`shots === 2`): intent always forced to `'power'`; receiver's partner starts at kitchen in formation |
| 3 — 3rd shot | Serving team | Drop into kitchen; bleed their kitchen advantage | `isThirdShot` (`shots === 3`): high drop probability (37–97% by DUPR); serving team CPUs hold baseline until after this shot |
| 4 — 4th shot | Receiving team | Attack if drop is bad; dink if drop is good | No special branch — normal intent selection. Kitchen player reads bounce height: clean drop → forced dink; float/popup → speedup or smash |

**Variance is intentional.** The Stability Index means none of these shots is free: a rushed drop produces a float or popup (attackable); a shanked return goes short and lets the server's team stay back. AI difficulty scales how consistently each team executes the pattern (`smart` and `err` levers).

**All four players at the kitchen.** After a successful exchange through shots 1–4, both teams are typically at the kitchen line. The game enters the dink battle mode (see Dink Battle section) waiting for someone to float a ball high enough to speed up or smash.

---

## Tuning Surfaces — Where to Change Numbers

**Never scatter gameplay numbers across `game.js` or `ai.js`.** All tuning lives
in exactly two places:

| File | What lives here |
|---|---|
| **`src/constants.js`** | Court geometry, physics (`PHYS`), hit timings (`HIT`), Stability Index (`STABILITY`), power cap (`POWER_CAP`), specialty triggers (`SPECIALTY`) |
| **`src/shots.js`** | Shot profiles (`PROFILES`) — apex, depth, spin, margin per shot type |

Changing AI difficulty feel? Edit `LEVELS` in `ai.js` (the one allowed exception —
difficulty config belongs to the AI module).

---

## Quick Tuning Reference

Use the Bounce Height Reference table (in Shot Types section) when adjusting drop apex.

### Ball / Arc Feel

```
Feel too floaty overall          → lower STABILITY.FLOAT_APEX_MULT (shots.js default 1.65)
                                    or raise STABILITY.FLOAT_THRESHOLD (constants.js default 0.45)
Too many pop-ups on good hits    → raise STABILITY.POPUP_THRESHOLD (default 0.18)
Not enough pop-ups               → lower STABILITY.POPUP_THRESHOLD
Clean drop still attackable      → lower PROFILES.drop.apex (current 1.75); use Bounce Height table
Drop lands too short             → increase PROFILES.drop.absZ (or use aimDepth)
Drives land too short/long       → adjust PROFILES.drive.depthFrac (default 0.82)
Smash arc not steep enough       → lower POWER_CAP.NET_H + 0.06 offset in game._hit / ai.chooseShot
Smash fires too early (easy)     → raise POWER_CAP.SMASH_H (constants.js default 1.5)
Ball too bouncy overall          → lower PHYS.RESTITUTION (default 0.66)
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
3rd-shot drop too rare on normal        → raise LEVELS.normal.smart in ai.js (shifts dropChance up)
3rd-shot drop too frequent on easy      → lower the -0.1 offset or 1.25 multiplier in isThirdShot block (ai.js)
Return of serve sometimes drops         → the isReturn branch (shots===2) forces power; don't remove it
```

### AI Difficulty Feel

```
AI misses too much (easy)        → lower LEVELS.easy.miss in ai.js (default 0.18)
AI too accurate (hard)           → raise LEVELS.hard.err (default 0.12)
AI too reactive / robot-fast     → raise LEVELS.hard.react (default 0.09)
AI doesn't go for kitchen (easy) → raise LEVELS.easy.smart (shifts advance fraction up)
AI crashes kitchen too hard      → lower LEVELS.hard.smart or change 1.6 multiplier in _moveCPU
Dink battle too passive          → lower the smart - 0.3 threshold in chooseShot kitchen branch
```

### Specialty Shots

```
Poach too frequent at 4.5        → increase SPECIALTY.POACH_NORMAL_X_HALF (default 0.85 m)
Pro poach too easy to avoid      → decrease SPECIALTY.POACH_PRO_REACH (default 1.9 m)
Erne fires accidentally          → increase SPECIALTY.ERNE_X_MARGIN (default 0.25 m)
ATP fires too early              → increase SPECIALTY.ATP_X_MARGIN (default 0.35 m)
```
