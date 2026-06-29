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
| `drop` | 2.1 m | 55% kitchen | −2.0 (backspin) | Third-shot drop; lands in kitchen |
| `dink` | 1.4 m | kitchen+0.25 m | −1.0 (backspin) | Soft kitchen exchange |
| `lob` | 4.2 m | 85% court | −1.0 (backspin) | Overhead change-up |
| `speedup` | 1.3 m | 50% court | +4.0 (topspin) | Attack a high floated ball |

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
| `≥ POWER_CAP.SMASH_H` (1.5 m) | `'smash'` | Smash intent (uses `'power'` in classify) |

The cap overrides the human's held intent in `_hit()` and the AI's intent in `chooseShot()`.

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
5. **Power cap** — if `ball.y ≤ NET_H`, intent forced to `'touch'`
6. **Skill-scaled intent** (zone + ball height + `smart`)
7. **Shot type** via `Shots.resolve`
8. **Target** — deeper-opponent feet for drive/speedup/drop; otherwise corner/body/wide
9. **Scatter** — add `±err` noise to `aim.x`, `aim.z`, `apex`

### Movement (`game._moveCPU`)

Lane-aware doubles positioning:
- Each CPU covers one lateral half (`_laneSign`).
- During `open` phase, advance fraction = `clamp((smart − 0.35) × 1.4, 0, 1)`
  toward the kitchen line (smart-scaled kitchen race).
- Responsible player chases the ball's predicted landing (`AI.predict`).

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

```
Feel too floaty overall     → lower STABILITY.FLOAT_APEX_MULT or raise STABILITY.FLOAT_THRESHOLD
Too many pop-ups            → raise STABILITY.POPUP_THRESHOLD
Dink battle too easy        → shrink STABILITY.SWEET_SPOT for easy/normal
Power cap too restrictive   → raise POWER_CAP.NET_H or lower POWER_CAP.SMASH_H
Drives land too short/long  → adjust PROFILES.drive.depthFrac in shots.js
Drops too easy to attack    → lower PROFILES.drop.apex
Poach too frequent at 4.5   → increase SPECIALTY.POACH_NORMAL_X_HALF
Pro poach too easy to avoid → decrease SPECIALTY.POACH_PRO_REACH
Erne fires accidentally     → increase SPECIALTY.ERNE_X_MARGIN
ATP fires too early         → increase SPECIALTY.ATP_X_MARGIN
AI misses too much (easy)   → lower LEVELS.easy.miss in ai.js
AI too reactive (hard)      → raise LEVELS.hard.react in ai.js
```
