# character-preview — session context

This folder is a standalone Three.js POC for the Mixamo character pipeline.
It is git-tracked (`index.html`, `main.js`, `CONTEXT.md`); only
`character-preview/local-clips/` (the 6 other-sport exploratory clips + the
full tennis source take) stays out of git via
`.gitignore`. Its only job so far: let you eyeball whether Mixamo-sourced
characters + mocap swing animations are viable replacements for pb3d's
current authored player models, before touching real game code.

**If you're starting a new chat session to continue this work, paste this file
in, or point Claude at it.** It explains what exists, what's already been
proven, and what's still open — so the next session doesn't have to
re-derive any of it from scratch.

## READ THIS FIRST — status as of the end of the last session

**Current Codex pass — READY elbows moved forward/down in preview only.** Kept
`Steel_Idle_PreJump_ReadyPose__steelmanny.FBX` and the existing
`mirrorRightLegOntoLeft()` crouch fix, but added a second `tp-ready`-only
post-process in `main.js`: `pushReadyArmsForward()`. It rewrites the
retargeted `LeftArm`/`RightArm` and `LeftForeArm`/`RightForeArm` world-space aim
directions into a compact hands-in-front ready stance with enough palm spacing
to read like holding an invisible basketball, then applies a
READY-only hand roll so the palms face each other more like hands on a steering
wheel. **Important sign note:** the verified roll is `LeftHand = -PI/2`,
`RightHand = +PI/2`; the opposite signs broke the wrists 180 degrees the wrong
way, palms outward/thumbs down. **Spacing note:** the verified forearm aim is
slightly outward (`LeftForeArm = (0.03, -0.08, 0.99)`, `RightForeArm =
(-0.03, -0.08, 0.99)` before normalize); the previous inward version made the
stylized characters' hands nearly touch/overlap. This avoids both the source
pose's behind-the-body elbows and the first Codex attempt's too-flared elbows.
Verified through the live `character-preview` path with Playwright on all 12
characters for spacing, plus screenshots on `ch01`, `ch06`, and tightest-case
`ch12`; screenshots were captured to
`tools/shots/ready-elbows-ch01-front.png`,
`tools/shots/ready-elbows-ch01-3q.png`,
`tools/shots/ready-elbows-ch06-front.png`,
`tools/shots/ready-elbows-ch06-3q.png`,
`tools/shots/ready-elbows-ch12-front.png`, and
`tools/shots/ready-elbows-ch12-3q.png`. Numeric spacing check after the final
tune: all 12 characters have at least `0.247m` hand-to-hand distance, with most
in the `0.30m-0.53m` range. After preview approval, the shipped game GLB
`assets/animations/pickleball-locomotion.glb` was rebaked with
`node tools/bake-locomotion-clips.mjs`, so the real game now uses the same
READY clip. Game-side verification screenshots were captured to
`tools/shots/game-ready-baked-front.png` and
`tools/shots/game-ready-baked-3q.png`.

**Latest session — swapped 4 `TOP_PICKS` source clips for better ones; NOT a
retarget-math fix, a content-choice fix.** The user judged the actual motion
(exactly the open call CONTEXT.md's item 5 left for later) and rejected two of
them, plus flagged a missing mirrored variant and a bad `ready` pick already
called out in the Open TODOs below:
1. **Serve looked "creepy"/distorted** (aggressive hip swing bending the body
   out of proportion, more vertical than forward). Root cause confirmed NOT a
   retarget bug: `Primary_Swing1_Medium__NarbashManny.FBX` (a MOBA melee
   hero's big two-handed weapon swing) is genuinely a huge, non-human windup
   in the SOURCE data (measured Hips world Y bounce ~9cm — modest — but the
   thigh/spine swing amplitude itself is just a huge pose, confirmed by eye
   across ch01/ch03/ch04/ch06/ch07/ch09/ch10). Swapped to
   `RMB_Throw__PhaseManny.FBX` — a subtle, forward-leaning toss motion that
   looks natural across every character tested, no leg/hip distortion.
   `Ability_Grenade_Throw__DrongoManny.FBX` was also a reasonable, more
   crouched alternative if `RMB_Throw` ever needs revisiting.
2. **Hit React looked like a broken neck** (head snaps back at an extreme
   angle far beyond the torso's own motion). `HitReact_Front__AuroraManny.FBX`
   confirmed to genuinely do this on ch06. Swapped to
   `HitReact_Left__AuroraManny.FBX` — subtle, natural recoil, no extreme neck
   bend. (`HitReact_Back` has the same neck problem; `KnockBack_Front` is a
   full backward-launch/knockdown, way too dramatic for a paddle hit — neither
   is a good fallback if `HitReact_Left` needs revisiting; try
   `HitReact_Right` instead, which is comparably subtle.)
3. **Side Shuffle had no mirrored variant.** `Strafe_Left__KhaimeraManny.FBX`
   was the only entry (`tp-side-shuffle`, now renamed `tp-side-shuffle-left`).
   Added `tp-side-shuffle-right` using the already-present
   `Strafe_Right__KhaimeraManny.FBX` raw clip — no mirroring math needed, the
   source pack already ships both directions. Both retarget cleanly and look
   like genuine mirror images of each other.
4. **Ready Stance — first swapped content, then reverted per explicit user
   correction; fixed the actual pose instead.** First tried replacing
   `Steel_Idle_PreJump_ReadyPose__steelmanny.FBX` (a sprinter's pre-jump
   crouch, only 0.067s long) with `Throw_Ready_Loop__gadgetManny.FBX`. The
   user immediately rejected that swap: `Throw_Ready_Loop` reads as standing
   near-upright, and an athletic *bent-knee, low* crouch matters more for a
   tennis/pickleball ready stance than leg symmetry — "the old animation was
   odd with the leg out, but still far better than the new one where you just
   have them standing straight up." Reverted to
   `Steel_Idle_PreJump_ReadyPose__steelmanny.FBX`, then fixed its one real
   flaw (left leg straight/forward, not a symmetric crouch like the right)
   directly: `mirrorRightLegOntoLeft()` (new function, applied only for
   `clipKey === 'tp-ready'` in `activateMannyClip`) mirrors the right leg's
   retargeted WORLD-space pose onto the left, chained hip->knee->ankle, using
   the exact same aim-direction swing method `retargetMannyClip` already uses
   for these bones (mirror the right leg's world aim direction across the
   character's own sagittal plane — negate world X, since these characters
   face +Z — then apply that direction to the left leg's own rest, just like
   a normal swing retarget).
   **A first attempt at this mirror did it as a plain LOCAL quaternion
   mirror** (negate the rest-relative delta's Y/Z components) **and it
   visibly broke the pose** (legs collapsed into a contorted knot) — the
   exact same "local bone axis conventions don't mirror by simple component
   negation" disease this file's whole history warns about. Don't repeat that
   approach; the WORLD-space aim-mirror in `mirrorRightLegOntoLeft` is the
   one that's actually verified correct.
   **Verification pitfall worth recording**: this tool's default 3/4 auto-
   framed camera makes THIS pose (a deep forward torso lean, by design in the
   source clip) look foreshortened/contorted-ish regardless of whether the
   leg mirror is even applied — confirmed by screenshotting with the mirror
   explicitly disabled and seeing the same apparent "brokenness" on `ch01`.
   Don't judge this pose's correctness from that default camera angle alone;
   force a dead-on front view (`camera.position.set(center.x, center.y,
   center.z + dist)` looking down -Z at the character's own bounding-box
   center, per `window.__camera`/`window.__controls`) to actually see left/
   right symmetry. Confirmed correct that way on both `ch01` and `ch06`.
   `Throw_Ready__gadgetManny.FBX` (the non-loop, 1.2s sibling of
   `Throw_Ready_Loop`) remains a fallback idea ONLY if a future session
   revisits the "upright vs. crouched" content question — it was not what the
   user asked for this time.
   The residual "scrub bar moves fast" feel on the reinstated 0.067s clip is
   inherent to any short static-pose clip, not a bug — expected for a
   held-pose category, not a defect to keep chasing.

All 4 changes are in `TOP_PICKS` in `main.js`; the ready-stance leg fix also
added `mirrorRightLegOntoLeft()` and one call site in `activateMannyClip` --
no changes to `retargetMannyClip`'s own general retarget math. Verified via a
throwaway Playwright screenshot driver (character button click -> top-pick
click -> scrub -> screenshot), not left in the repo; recreate similarly if
revisiting (start the repo's normal Vite dev server via
`tools/vite-test-server.mjs`, navigate to `/character-preview/`, drive
`#characterButtons`/`#topPicksButtons` buttons and the `#scrub` input,
screenshot the page). For symmetry judgments specifically, force the front
camera view described above rather than trusting the default angle.

**Previous session (3 targeted fixes, unrelated to the elbow/wrist saga below):**
1. **Fixed — losing the character when leaving Raw Skeleton Preview.**
   `activateSkeletonClip` reframes the camera/grid onto the skeleton
   preview's own bounds (`frameCameraToBounds`), but `exitSkeletonPreview()`
   never reframed back onto the character afterward — clicking a Top Pick or
   Clip button after viewing a skeleton preview correctly restored
   `character.visible = true` and the mixer, but left the camera pointed at
   the skeleton's old bounds, making the character look "lost" until its own
   button was clicked again (which reframes as a side effect of
   `activateCharacter`). Fix: `exitSkeletonPreview()` now calls
   `frameCameraToObject(character)` itself. Verified visually (skeleton
   preview -> Top Pick clip, character comes back correctly framed).
2. **Done — removed Pivot Spin and Dive** from both `TOP_PICKS` (and by
   extension the Raw Skeleton Preview row, which is built from the same
   array) per explicit user decision — these two were never gotten to look
   right and weren't worth continuing to chase. 9 categories remain (was 11).
3. **Root-caused, NOT fixed (dropped instead) — the "Clip" row's
   Tennis Source (full)/Golf/Baseball (x2)/Soccer (x2)/Football QB all
   pitch the character face-down; only Forehand/Backhand/Overhead worked.**
   Root cause: these are raw, unconverted Mixamo FBX applied via the simple
   name-matching path (`retargetClipNames`, no delta/world-space math) —
   that only works if the target's bones share the source clip's rest
   ORIENTATION, which was true back when the characters were raw FBX too,
   but is no longer true now that `ch01-12.glb` go through a Blender
   FBX->glTF conversion that re-authors every bone's rest quaternion.
   Confirmed by direct measurement: `mixamorigHips`'s rest quaternion is
   `(-0.70, 0.18, -0.15, 0.67)` on the shipped `ch01.glb` vs. exact identity
   on the original raw FBX (`~/Downloads/CH01.fbx`) — applying a clip's
   rotation tracks (authored against the identity-rest convention) directly
   onto a bone whose "upright" configuration requires that drastically
   different quaternion pitches the whole body over. Forehand/Backhand/
   Overhead are unaffected because they were built through the SAME Blender
   pipeline as the characters (`tools/build-mixamo-clip-library.mjs`), so
   their tracks are already expressed in the matching rest basis. Given the
   user's choice, this was NOT fixed with new retarget math (would mean
   redoing a version of the whole elbow/wrist saga below for a second
   source rig) — the 5 broken buttons were removed from the Clip row
   instead (`CLIP_SOURCES`, `activateFbxClip`, `stripNonRootPositionAndScale`,
   `freezeRootHorizontalMotion` all deleted as dead code). The underlying
   raw FBX files in `local-clips/` are untouched on disk if this is ever
   revisited — see the options above (rebuild via Blender pipeline is the
   recommended path if it comes back up, not a from-scratch retarget
   rewrite).

**Current status (elbow/wrist work, unchanged by the above): shoulder/elbow/wrist bend angle/plane are all root-caused,
fixed, and verified** — numerically (exact/plausible match at every sampled
frame for all three joints) and visually (full regression pass across
multiple characters × Idle/Run/Serve/Victory). **Do not assume this means
everything is now perfect** — arms/elbows/wrists have been "fixed" SEVEN
separate times now (items 9, 11, 13, 15, 16, 17, 18). Item 15 was declared
fixed and numerically verified, and STILL had a real, severe, independent
bug (item 16). Item 16 was ALSO declared fixed and verified for elbows
specifically, and wrists turned out to have never even been running that
fix at all (item 17). Item 17's own same-session sibling commit (removing
the upper arm's hang-down correction to fix reach-damping on `serve`) THEN
broke `run`'s upper arm a different way (item 18 — T-pose-reveal on a
low-motion clip). Item 18 fixed this by extending the SAME parent-relative
direct-transplant method (items 15/16/17) to the upper arm, rather than
re-tuning the removed baseline correction. Treat item 18 as "the
best-verified state so far," re-check with the tools below before
extending trust to a new character/clip/pose/bone, and read items 9-18 in
full before touching this code again. **If any bone-specific report comes
in again ("same with X"), check `window.__RETARGET_DEBUG`'s `method` field
for that bone FIRST (should read `"parent-relative"` for shoulders/
forearms/hands — `PARENT_RELATIVE_BONES`) before assuming the fix's math
needs re-deriving — item 17 was found in under a minute this way, after
item 16 took a full session.** Also, per item 18's lesson: a fix verified
only on a HIGH-motion clip (serve/swing) needs separate re-verification on
LOW-motion clips (idle, run) before being trusted — removing/tuning a
baseline correction can look correct on the clip that motivated it while
silently reintroducing item 5c's T-pose-reveal bug elsewhere.

**Do not declare anything fixed again without either the user confirming it
themselves, or genuinely rigorous verification (numeric measurement AND live
visual comparison, in a BODY-RELATIVE frame if comparing two skeletons of
different scale/orientation — see items 7, 12, 14, and 16's lessons, each of
which caught the OTHER method missing something). Item 16 in particular is
the sharpest lesson in this file: a "target matches source EXACTLY, by
construction" numeric check (item 15) is NOT sufficient proof of
correctness — it proves the arithmetic is self-consistent, not that the
physical quantities being carried through it (here, "the upper arm's world
quaternion," which silently included an uncontrolled per-rig-arbitrary
twist) mean what you assumed. Only an independent physical measurement
(the upper-arm quaternion DIFFERENCE between rigs, decomposed into
aim-aligned vs. perpendicular components) revealed it.**

**What IS confirmed solid** (re-verify before fully trusting on a new
character/clip, but these have survived multiple rounds of scrutiny without
regressing): grounding (item 7), legs during `run` (item 8, ~2-6° constant
offset from the raw skeleton, confirmed multiple times since), the
world-space swing method's basic soundness for spine/shoulders (item 8),
hands no longer reverting to a flat T-pose on near-static clips (item 10),
upper-arm lateral reach on high-motion clips (item 13), and shoulder/elbow/
wrist bend angle/plane on BOTH high- and low-motion clips (items 16+17+18)
— via a "direct transplant, carried through a twist-free canonical
reference frame" mechanism, not a delta from either rig's own rest pose
(item 15 found the two rigs' rest poses are ~129° apart at the elbow,
irreconcilable from bind-pose data alone) and not the rigs' own real
(twist-arbitrary) bone orientations (item 16's fix). Wrist specifically
only actually started using any of this machinery in item 17, and the
upper arm (shoulder-relative) only in item 18 -- before that each was
silently still on the older world-space swing-from-rest method.

**Known, disclosed, NOT-yet-addressed gap**: forearm TWIST/roll (pronation/
supination around the forearm's own long axis) is still not reproduced —
`buildAimQuaternion`'s canonical frame deliberately discards it the same way
the underlying swing method always has. If a future report is specifically
about hand/wrist rotation looking wrong independent of elbow bend angle/
plane, that's this gap, not a regression of item 16.

**What's still open / not resolved:**
- **RESOLVED (items 15+16+17+18) — arms/elbows/wrists "bend backwards" on
  dynamic clips (item 14), and upper arms "flailed out"/T-posing on
  low-motion clips (item 18).** Root cause and fix in item 15 (rest-pose
  mismatch), item 16 (twist-free carrier frame), item 17 (wrists were
  silently never using either fix, due to a gap in `captureTargetRestPose`
  that's now closed), item 18 (upper arm extended onto the same
  parent-relative method after removing its hang-down baseline correction
  broke `run` specifically). Re-verify on a new character/clip before fully
  trusting, per this file's whole history, but this is the most rigorously
  verified state so far (exact/plausible numeric match at every sampled
  frame for all three joints + full visual regression across low- and
  high-motion clips). If a NEW bone-specific report comes in, check
  `window.__RETARGET_DEBUG`'s `method` field for that bone first (see item
  17's lesson) before assuming the math is wrong again.
- **Still open**: forearm TWIST/roll is not reproduced by any version of
  this method (only aim direction is ever controlled). Not yet known
  whether this is visually significant for any existing clip — no report of
  it yet, but also never specifically checked.
- The debug visualization the user asked for (twice) was built in item 12
  (`window.skeletonOverlayHelper`, the "Show Skeleton Overlay" button) and
  extended in the same session (`window.__comparisonSkeleton`, "Show Raw
  Skeleton Beside (synced)") — use these FIRST for any new pose complaint,
  before more numeric summaries. The color-coded Hips forward/right/up axis
  gizmo from the original ask was NOT built; still missing if needed.
- The user separately asked "are you sure it isn't backwards now?" (facing
  direction). This was never rigorously re-checked after the grounding fix —
  investigation got diverted into the grounding bug (which was real and
  needed fixing) but the facing question itself is still technically open.
  Use the gizmo above to actually check this once it exists.
- **PARTIALLY SUPERSEDED by item 10** — the user showed two screenshots (a
  run pose and a "ready stance" pose, both on realistic-textured characters
  — traced to `player-ch06-v1` and `player-ch08-v1` specifically) that
  looked dramatically extreme/unnatural (wide leg splits, one hand reaching
  to the ground with splayed fingers), which an early investigation
  attributed to genuine source mocap content via a hard-to-read visual
  skeleton-wireframe comparison (flagged even then as "a lead, not a settled
  fact"). Item 10 later found the splayed-finger/reaching-hand look on
  Idle/Ready Stance clips was substantially caused by a real hand-retargeting
  bug (hands reverting toward a flat rest pose), not (only) source content —
  so this "genuine content" conclusion should be treated as suspect,
  especially for the HAND/finger part of what looked extreme, until
  specifically re-checked on `ch06`/`ch08` with the current (item 17) fixed
  code. The leg-splay part of the original report was never specifically
  re-investigated after any of items 11-17's fixes. If revisited, ALSO still
  worth checking: is `Steel_Idle_PreJump_ReadyPose__steelmanny.FBX` (source
  for "Ready Stance") simply a bad CONTENT choice (an extreme athletic
  pre-jump crouch, not a moderate pickleball-ready stance) independent of any
  remaining code issue? That would mean swapping which file `TOP_PICKS`
  points to for that category (see `character-preview/local-clips/top-picks/
  ready/` for 2 unused alternatives, and ~40 other unused clips across all
  categories).

## Running it

There is no separate dev-server process anymore — `character-preview/`
is served by the normal Vite dev server:

```bash
cd /Users/ribo/Dev/pb3d
npm run dev
# open http://127.0.0.1:5173/character-preview/
```

Files:
- `character-preview/index.html` / `main.js` — the viewer app. `main.js`
  derives its character catalog from `assets/manifest.js` (no separate
  hardcoded list) and loads each character lazily, on click, via
  `src/assets.js`'s `preloadPlayerModels()` — the same scoped/cached loader
  the real game and character picker use. Nothing here duplicates the
  GLTFLoader/MeshoptDecoder setup; it imports `makeGltfLoader` from
  `src/assets.js` for the one asset that loader doesn't cover (the
  `pickleball-swings.glb` swing-clip library, fetched eagerly at page load
  since it's small and always relevant).
- `assets/models/players/mixamo/ch01.glb`…`ch12.glb` — the shipped, optimized
  character assets (0.2-1.6MB each; see `tools/build-mixamo-character.mjs`),
  the SAME files (one common location, not duplicated) wired into the real
  game's `assets/manifest.js` as `player-ch01-v1`…`player-ch12-v1`.
  `assets/animations/pickleball-swings.glb` is the shared 0.07MB
  forehand/backhand/overhead swing-clip library (see
  `tools/build-mixamo-clip-library.mjs`), also one common file. The original
  raw, unoptimized per-character FBX (5-54MB each) and the raw
  forehand/backhand/overhead FBX were deleted once this swap was verified
  working end-to-end (all 12 characters + all 3 swing clips, no console
  errors) — see git history before this point if you ever need the original
  raw FBX loading path back.
- `character-preview/local-clips/*.fbx` (untracked) — the 6 other-sport
  exploratory clips (`golf.fbx`, `baseball-batter.fbx`,
  `baseball-pitcher.fbx`, `soccer-penalty.fbx`, `soccer-passing.fbx`,
  `football-qb.fbx`) and `tennis-source.fbx` (the pristine full take
  forehand/backhand/overhead were cut from) are **no longer wired into the
  UI** (see "READ THIS FIRST" item 3, latest session) — all pitched the
  character face-down once the characters became Blender-converted GLBs,
  and rebuilding a second retarget pipeline for them wasn't judged worth it.
  The files themselves are untouched on disk (still raw, unoptimized FBX)
  in case this is revisited; `tennis-source.fbx` in particular is the only
  remaining copy of that mocap take's full context — don't delete it
  without re-reading the "Asset provenance" section below.
- `character-preview/local-clips/top-picks/<category>/*.FBX` (untracked) —
  51 candidate mocap clips the user pulled from `_top_picks` in Downloads,
  organized into 11 category folders (`idle`, `ready`, `run`, `backpedal`,
  `side_shuffle`, `pivot_spin`, `serve`, `jump_smash`, `dive`, `hit_react`,
  `victory_celebration`) for a future pass at filling the still-open
  idle/serve/run/ready gap (and adding pickleball-relevant movement clips
  beyond that). These are **Unreal Engine 5 "Manny" mannequin** exports (Epic's
  free Paragon animation packs retargeted to the standard UE5 skeleton, per
  the FBX metadata: `Unreal FBX Exporter`, source path
  `.../paragonanims/Game/RetargetedAssets/<Hero>Manny/<Clip>.FBX`) — a
  completely different bone-naming/hierarchy convention
  (`pelvis`/`clavicle_l`/`upperarm_l`/`calf_l`/...) than the Mixamo
  `mixamorig*` rig these characters use, and skeleton-only (no mesh). The
  existing name-based `retargetClipNames` path does not apply to these at
  all. `main.js`'s `TOP_PICKS` currently surfaces **one representative clip
  per category** per an explicit user decision to scope down for the first
  review pass — originally 11 buttons (one per category folder), now **9**:
  `pivot_spin` and `dive` were dropped (latest session, "READ THIS FIRST"
  item 2) since neither ever retargeted acceptably. The other ~40 files
  (plus the two now-unused `pivot_spin`/`dive` folders) are still sitting in
  their category folders if a different pick is wanted later. See
  `retargetMannyClip()` in `main.js` for the actual cross-rig retarget logic
  and the bugs found building it (next section).

## What the viewer does

- **Character row**: 12 characters, `CH01`–`CH12`, switchable live, each
  fetched lazily on first click (with a per-button loading/error state) via
  `preloadPlayerModels()` — clicking back to a previously-viewed character
  hits that loader's cache, no re-fetch.
- **Clip row**: whatever's baked into the selected character's own GLB
  (currently nothing — the shipped character builds carry no animation, see
  the Open TODOs section), plus `Forehand`/`Backhand`/`Overhead` (from the
  shipped, already-fixed `pickleball-swings.glb` — same file the real game
  loads, no runtime retargeting needed for these three). That's it as of the
  latest session — `Tennis Source (full)` and the 6 other-sport raw-FBX
  clips (`Golf Swing`/`Baseball Batter`/`Baseball Pitcher`/`Soccer Penalty
  Kick`/`Soccer Passing`/`Football QB`) were removed from this row (see
  "READ THIS FIRST" item 3): they used the old name-matching
  `retargetClipNames` path, which pitched the character face-down once the
  characters became Blender-converted GLBs with a different bone rest
  basis. `activateFbxClip`/`CLIP_SOURCES`/`stripNonRootPositionAndScale`/
  `freezeRootHorizontalMotion` were deleted as dead code along with them.
- **Raw Skeleton Preview row**: the same 9 top-picks clips (11 minus
  `pivot_spin`/`dive`, dropped the latest session), but played on
  their OWN native Manny rig with a `THREE.SkeletonHelper` line visualization
  instead of retargeted onto the active character — see `activateSkeletonClip`
  in `main.js`. No bone-name mapping, no retargeting math of any kind
  involved, so it's immune by construction to every retargeting bug in the
  section below. Added after the user reported the retargeted versions
  looking "extremely bad... like broken robots deep in the floor spazzing
  out" and asked for a way to check the clips independent of retargeting.
  Use this when a retargeted clip looks wrong to tell whether the SOURCE
  MOCAP itself is the problem (it'll look equally wrong here) or the
  retargeting math is (it'll look fine here, wrong on the character).
- Play/Pause, a scrub slider (0–1 normalized through the clip), and a
  playback-speed slider — shared across all three clip rows (Clip/Top
  Picks/Raw Skeleton Preview); switching between rows hands off `mixer`/
  `currentAction`/`currentClip` cleanly (`exitSkeletonPreview()` restores the
  character's own mixer and visibility when leaving skeleton mode).
- `window.__poc = { character, clips, mixer }`, `window.__THREE`,
  `window.__camera`, `window.__controls`, and `window.__scene` are exposed on
  `window` for ad-hoc Playwright/devtools inspection — this is how every bug
  in this doc was actually found, not by eyeballing alone.

## Asset provenance

- **Characters** (`ch01.fbx`…`ch12.fbx` originally, now `ch01.glb`…`ch12.glb`
  in `public/`): standard Mixamo library characters, downloaded directly from
  mixamo.com. Originals live in `/Users/ribo/downloads/` renamed to
  `CH01.fbx`…`CH12.fbx` (uppercase there; lowercase `chNN` copies here).
  **Licensing confirmed** (user-verified source + checked against Adobe's
  current Mixamo terms, see "Licensing status" below): free for unlimited
  commercial use, including shipping in a game, no attribution required. The
  one real restriction is not redistributing the raw character/animation
  files as a standalone, independently re-downloadable asset pack — using
  them baked into this game's own compiled/optimized GLBs is exactly the
  intended use case.
- **Forehand/Backhand/Overhead**: hand-cut in Blender by the user from a
  longer mocap take, at frame ranges (30fps) 69–117 / 170–220 / 300–381.
  Licensing is cleared for project use per owner confirmation.
- **Tennis Source (full)**: the pristine, uncut ~28.7s take those three were
  sliced from. Original file: `/Users/ribo/Dev/CharacterAssets/Sports/tennis/
  Tennis_mixamo.fbx`.
- **Golf/Baseball/Soccer/Football clips**: from
  `/Users/ribo/Dev/CharacterAssets/Sports/*_mixamo.fbx` — a folder the user
  already had, same `_mixamo` naming convention as the tennis file.

## Licensing status

- **Characters: resolved.** Confirmed directly from mixamo.com, and Adobe's
  current Mixamo FAQ (checked live, not from training-data memory) states
  content is free for unlimited personal/commercial use — explicitly
  including video games — with no royalties and no attribution requirement.
  The only prohibited use is distributing the raw files themselves as a
  standalone, independently-downloadable asset pack (e.g. selling them on an
  asset marketplace) — not applicable to shipping them compiled into this
  game.
- **Swing/sports mocap clips: resolved.** The project owner confirmed there
  are no remaining licensing blockers for the forehand/backhand/overhead
  clips, `pickleball-swings.glb`, or the 6 other-sport exploratory clips.

## Bugs found and fixed here (read before touching retargeting code again)

All three of these were found by actually loading clips onto characters and
looking closely — not by reasoning from first principles — so if something
looks subtly wrong, **go re-verify with screenshots/track dumps before
theorizing**. Don't trust a clean-looking wide shot; zoom in on the specific
joint under suspicion.

1. **Bone-prefix mismatch → animation silently does nothing.** Mixamo
   suffixes every bone name with `mixamorig` + a per-download session number
   (`mixamorig7Hips`, `mixamorig2Hips`, ...). A character and a separately-
   downloaded animation can end up with different numbers even though the rig
   is identical, so `THREE.AnimationMixer`'s name-based track binding matches
   nothing and the character just sits frozen. Fix: detect the active
   character's actual prefix (`detectBonePrefix`) and rewrite every incoming
   clip's track names to match (`retargetClipNames`) before registering it.

2. **Root motion drift under `LoopRepeat`.** These clips bake real forward
   stepping into the Hips position track and don't return to their start
   position, so looping walks the character off-screen over time. Fix:
   `freezeRootHorizontalMotion` zeros the Hips track's X/Z per-keyframe
   (leaves Y alone — that's genuine weight-drop/rise, not travel).

3. **The "long neck" bug — the important one if you touch this again.**
   Every non-root bone track (Neck, Head, Spine, ...) also carries a baked
   **absolute** `.position` value: the *mocap performer's own real bone
   length* (e.g. their actual ~11cm neck-to-head distance), plus a near-1
   `.scale` value. A correct humanoid retarget should only transfer
   **rotation** for non-root bones — position/scale should come from each
   target character's own rig. Applying the performer's absolute neck length
   onto a short-necked stylized character stretches it to match the
   performer's real proportions. This is invisible in a raw T-pose (nothing
   has touched the bones yet) and appears the instant *any* clip plays, on
   *every* character — that pattern (universal, pose-independent within a
   clip, T-pose-only-exception) is the tell for this exact bug class. Fix:
   `stripNonRootPositionAndScale` deletes every `.position`/`.scale` track
   except the root Hips's position (which is legitimate root motion, not bone
   length) before the clip is registered.

4. **Manny→Mixamo cross-rig retarget (`retargetMannyClip`) — two more bugs
   found by screenshot review, same "don't trust the math, look at the
   render" lesson as above.** Bone-name mapping (`MANNY_BONE_MAP`) plus a
   per-bone "delta from rest" transfer (`target = targetRest *
   (sourceRest⁻¹ * sourceLocal(t))`) is the standard quick cross-rig
   retarget technique, and works fine for bones whose rest orientation is
   close to identity (spine/arms/head). It does NOT work for `Hips` here:
   - **Bug A — naive per-bone delta composition for the root→pelvis chain.**
     An earlier version composed `deltaRoot(t) * deltaPelvis(t)` (each
     bone's own local delta) to combine `root`+`pelvis` (source) into one
     `Hips` (target) bone. Wrong: `pelvis`'s rest rotation is itself a large
     (~90°) fixed offset, not near-identity, so that shortcut doesn't cancel
     correctly — tipped the whole character sideways off the grid, on every
     character, immediately (confirmed via screenshot at t=0, ruling out an
     accumulation-over-time explanation). Fix: treat root→pelvis as ONE
     combined transform (`combinedRest = rootRest*pelvisRest`,
     `combinedCurrent(t) = rootLocal(t)*pelvisLocal(t)`) and apply the
     single-bone delta formula to that combined transform instead.
   - **Bug B — even fixed, full-3-axis Hips transfer was abandoned for
     YAW-ONLY.** The per-bone axis-convention mismatch between UE Manny and
     Mixamo is large enough at `Hips`/`pelvis` specifically that transferring
     the full rest-relative rotation still reads wrong. Since the only part
     that actually matters for judging locomotion clips (backpedal/pivot-spin/
     side-shuffle) is *which way the character turns*, `Hips` now only
     transfers YAW: project a reference vector through the rest and current
     combined rotations onto the horizontal (Z-up — this raw FBX loads Z-up
     in three.js, confirmed empirically from `pelvis`'s rest position landing
     almost entirely in `.z`, not assumed) plane and read off the signed
     angle between them (`worldYawDelta`). Pitch/roll (leaning
     forward/tilting sideways) intentionally do not transfer for `Hips`.
   - **Bug C — the yaw reference vector itself was unvalidated.** First
     attempt hardcoded `(1,0,0)` as the reference axis with only a
     `lengthSq < 1e-6` degeneracy bailout. For this rig's actual rest pose,
     `(1,0,0)` rotates to landing ~99.7% along the vertical (Z) axis — so
     after projecting away Z, what's left is numerical noise, not signal,
     and it's nowhere near the 1e-6 bailout threshold. Result: a near-random
     yaw every frame, confirmed by dumping the live character's actual
     `mixamorigHips` world quaternion during a plain forward jog and finding
     it ~180° off (legs thrown up over the head on screenshot). Fix:
     `pickHorizontalRefAxis` tests all three basis vectors against the rest
     orientation once per clip and keeps whichever lands most horizontal,
     instead of assuming any single axis is safe — this is exactly the kind
     of "looks fine algebraically, wrong in practice" failure this file
     keeps warning about; the fix came from dumping actual world-space bone
     positions and comparing to a plain-forward-jog screenshot, not from
     re-deriving the quaternion math.

5. **Bind pose vs. frame 0 as the retarget reference — first correctly
   diagnosed, then the FIX itself introduced a second bug, then the whole
   approach was replaced with something more robust. Read this one in full
   before touching `retargetMannyClip` again.**

   **5a — the hunch, and a wrong first write-up.** After bugs 4A-4C were
   fixed, single-frame scrubbed screenshots of several clips (idle, run,
   side-shuffle, victory) still showed a pronounced forward torso/head hunch.
   Per-bone deltas measured at the time were all individually "modest"
   (single digits to ~40°), so this got written up — wrongly — as
   probably-genuine captured motion (a combat crouch, a bow gesture), not a
   bug. **The user caught this as "these animations looked busted"** by
   watching continuous playback rather than a few scrubbed frames: the
   ~80-90 degree hunch was present through the ENTIRE clip, on every clip
   (idle included), not one moment — a systemic bias. Root cause: using each
   bone's skeleton-authored BIND POSE as the delta reference, when this
   source rig's bind pose does not represent the same neutral stance as the
   Mixamo target's, so every clip inherited a large constant misalignment
   that compounds down the 5-bone Spine→Spine1→Spine2→Neck→Head chain.

   **5b — the first fix (clip's own frame 0 as reference) created a NEW,
   worse bug: characters sank into the ground.** Switching the ROTATION
   reference to frame 0 was correct and fixed the hunch. But the same edit
   also switched the Hips POSITION height reference to frame 0 — and a
   clip's frame 0 is often mid-stride, crouched, or otherwise not a
   "standing tall" pose (confirmed: this run clip's frame-0 pelvis height is
   ~13 units below its bind-pose height), so the whole character shifted
   vertically by that clip-dependent constant. Confirmed by comparing
   retargeted Hips local Y across clips right after the fix (idle 0.2, ready
   0.42, run 3.28 — no real standing-height difference should produce a
   swing that size). **Lesson: rotation reference and position reference are
   two separate decisions — fixing one by changing "the reference" without
   being explicit about which reference (rotation vs. position; clip-frame-0
   vs. bind-pose) breaks the other.** Fix: position height reference reverted
   to the skeleton's bind pose (a clip-independent constant); rotation
   reference for Hips stayed frame 0 (already verified working for yaw).

   **5c — even with 5a/5b both fixed, arms (and any low-motion bone) still
   showed a literal T-pose.** This is NOT the same bug as 5a — confirmed by
   screenshotting the character's raw, un-animated bind pose directly
   (`mixer.stopAllAction()`): these Mixamo rigs are authored with arms in a
   literal horizontal T-pose, not a relaxed A-pose. ANY delta-from-a-single-
   reference method (frame 0 OR bind pose, raw quaternion OR the swing method
   below) necessarily shows "the target's own reference pose" whenever the
   source bone doesn't move relative to ITS reference — and idle/victory/
   hit-react all keep the arms fairly still for stretches, revealing the
   T-pose underneath while legs/hips/spine (which do move) animated fine.
   **This is a real structural limit of delta-based retargeting, not a typo**
   — the user chose, when asked, to go further than a quick patch here.

   **5d — the actual fix: geometric "swing" transfer + a measured neutral
   pose correction, replacing the raw-quaternion-delta approach entirely.**
   Two independent problems, two independent fixes, now both live in
   `retargetMannyClip`:
   - **Axis-convention robustness**: instead of transferring a raw local
     quaternion delta (which depends on each rig's arbitrary, disagreeing
     local bone axes — the root cause of 5a), each mapped bone now measures
     how far its TRUE immediate scene-graph child (see `SWING_CHILD_SOURCE`
     — NOT `children[0]`, several bones have multiple children like twist/
     corrective helpers or backpack straps, confirmed by dumping
     `bone.children` for both rigs) has swung, as a plain rotation between
     two direction vectors (`Quaternion.setFromUnitVectors`). This is
     computed entirely from the SOURCE bone's own geometry and applied onto
     the TARGET's rest quaternion; it never reads either rig's local axis
     definitions, so axis-convention mismatches (and the compounding hunch
     they caused) can't happen by construction. Reference reverted to the
     skeleton's AUTHORED BIND POSE (not frame 0 — frame 0 was only ever a
     workaround for the axis-mismatch problem this method fixes directly).
     Bones with no clean single child (head, hands, toe bases — leaves or
     many-children fan-outs) fall back to the old raw-quaternion-delta method;
     their bind rotation magnitude is small enough that the axis-mismatch
     risk is much lower there.
   - **The T-pose-when-still problem (5c)**: swing transfer does NOT fix
     this on its own (still reduces to "target's own rest" when source is
     still) — needed a genuinely separate fix. `computeHangDownOffset`
     measures, using the character's LIVE world matrices (not a guessed
     constant), the rotation that would swing `LeftArm`/`RightArm`'s child
     to point straight down in world space, and this correction is composed
     onto the bind pose BEFORE the clip's own swing layers on top
     (`NEUTRAL_OFFSET_BONES`). Computed fresh per character activation in
     `captureTargetRestPose` (self-calibrating, not a hardcoded magic
     quaternion that could drift if a character's rest pose differs
     slightly) rather than authored by hand.

   Reverified via actual multi-frame continuous-playback captures (not just
   scrubbed screenshots — see 5a's lesson) across ALL 11 top-picks clips on
   two different characters (ch12, ch05): idle/victory/hit-react no longer
   show T-pose arms, run/backpedal/side-shuffle/pivot-spin/dive/jump-smash/
   ready all look like plausible natural poses throughout, hands hang
   naturally at rest. `serve` shows a pronounced backward lean/kick
   consistently across BOTH characters and multiple points in the clip
   (checked specifically because it looked extreme) — since it's consistent
   across characters, not inverted/sunk/T-posed, and this specific clip
   (`Primary_Swing1_Medium`, a melee hero's attack from a MOBA-style game) is
   plausibly just a theatrical windup, this was left as "the user should
   judge the actual motion," not chased further as a suspected bug — don't
   assume it's fixed either though; if it still looks wrong, look at
   `upperarm_l`/`thigh_l` swing specifically for that one clip.

   **Lessons for next time, all earned the hard way in this session:**
   watching a single scrubbed frame is not enough — sample several frames of
   ACTUAL uninterrupted playback before concluding a retarget is fine; a
   "fix" for one symptom can silently break something adjacent if you're not
   explicit about exactly which reference (rotation vs. position; this
   clip's frame 0 vs. this skeleton's bind pose) you're changing; and
   "individually modest per-bone numbers" is not proof of no bug when the
   rendered character still looks wrong — always trust the render over the
   arithmetic.

6. **The geometric SWING approach (item 4 above) was ALSO wrong, and item 5's
   "serve's backward lean is probably genuine content" conclusion was a
   symptom of it, not a real finding — superseded by a full world-space FK
   rewrite.** The user reported, of the retargeted characters: "upper body
   facing forward, arms distorted, and legs running to the side... like the
   skeleton is facing sideways in the body." Diagnosis: swing was computed
   in the SOURCE bone's own local/parent-relative frame (via
   `child.position.applyQuaternion(sourceBoneQuat)`) and then composed
   DIRECTLY onto the TARGET bone's own, different, local/parent-relative
   frame (`swing.multiply(effectiveTargetRest)`) — valid only if the two
   rigs' local axis conventions happen to agree at that joint, which is
   exactly the disease this whole retarget has been chasing since bug 1.
   Small bind-pose rotations (spine, post-T-pose-fix) mostly hid it; large/
   divergent ones (thigh) exposed it as a full wrong-plane mismatch between
   torso and legs. The ONE thing that had been robust the entire time —
   Hips's yaw — worked precisely because it was computed in genuine WORLD
   space (a shared external reference), never either rig's local axes.
   **Fix: generalize that principle to every bone.** New architecture,
   entirely replacing item 4's SWING_CHILD_SOURCE/per-bone branching:
   - `computeSourceWorldQuatsPerFrame` clones the raw source FBX and, for
     every keyframe, applies ALL of the clip's quaternion tracks to the
     clone (not just mapped bones — a wanted bone's world orientation
     depends on its WHOLE ancestor chain being correctly posed, including
     unmapped bones like spine_04/05) then reads each wanted bone's
     `getWorldQuaternion()` — i.e. leans on three.js's own proven FK/
     matrixWorld math instead of hand-deriving chain composition.
   - Target's rest world quats come the same way, directly from the live
     character's bones (`captureTargetRestPose`, extended).
   - Per bone: `newWorld = effectiveTargetRestWorld * (sourceRestWorld^-1 *
     sourceCurrentWorld)` — the SAME "delta from rest" shape as the very
     first (broken) attempt in bug 1, but this time entirely in world space,
     so it can't inherit bug 1's or item 4's axis-mismatch failure mode.
     Converted back to the LOCAL rotation an AnimationClip track needs by
     dividing out that bone's PARENT's world orientation for the SAME frame
     (`TARGET_PARENT`) — parents are retargeted before children
     (MANNY_BONE_MAP's order already respects this), so "parent's world
     orientation" means its own just-computed retargeted value, not rest.
   - `NEUTRAL_OFFSET_BONES`'s T-pose correction (bug 5c) still applies,
     recomputed directly in world space (`computeHangDownOffsetWorld`).

   **Two more bugs surfaced building this, both found by how catastrophically
   wrong the render looked, not by re-reading the math:**
   - **6a — forgot the Z-up→Y-up correction on the source clone.** First
     version of `computeSourceWorldQuatsPerFrame` cloned the raw FBX with NO
     rotation applied, so its "world" quaternions were computed in the
     source's native Z-up frame while the target character's world
     quaternions are Y-up (this scene's normal convention) — mixing a Z-up
     "world" with a Y-up "world" is exactly the same disease as item 4's bug,
     just moved one level up. Symptom: the character collapsed into an
     unrecognizable blob (hair-colored mass with a hand and foot poking out
     at random angles) — a much more total failure than a wrong-angle joint,
     which is the tell for "these aren't even the same coordinate frame," not
     a calibration error. Fix: apply the same `-90° about X` correction used
     in `activateSkeletonClip` to the clone before measuring anything.
   - **6b — conflated Hips's LOCAL quaternion with its WORLD quaternion when
     using it as the parent reference for Spine/LeftUpLeg/RightUpLeg.** Fixing
     6a alone did NOT fix the blob. Hips's AnimationClip track stores its
     LOCAL rotation relative to its PARENT NODE — and these Blender-exported
     characters wrap every bone in an "Armature" node with its own fixed
     rotation (the "+90-about-X wrapper" from bug 3/CONTEXT.md history) — so
     Hips's local value is NOT its world value, and Spine/UpLeg (Hips's
     children in `TARGET_PARENT`) need the TRUE world one to divide out
     correctly. Fix: `captureTargetRestPose` now also captures
     `hipsParentWorldQuat` (Hips's bone-parent's world rotation, a constant),
     and Hips's per-frame world quat is built as
     `hipsParentWorldQuat * hipsLocalQuat(t)`, not the local value alone.
     Fixing both 6a and 6b together resolved the blob into a correctly
     proportioned, upright, naturally-posed character.

   Reverified via actual continuous-playback screenshots (not just a single
   scrubbed frame — see item 5's lesson) across all 11 clips on ch12, plus a
   spot check on ch05: idle/run/backpedal/side-shuffle/pivot-spin/serve/
   jump-smash/dive/hit-react/victory/ready all show natural, correctly-facing
   poses, torso and legs finally agreeing on which way the body faces. Also
   reverified the full 12-character × 11-clip matrix loads with zero console
   errors. **"grounded" in that sentence was WRONG — see item 7 immediately
   below, found by the user, not by this round of screenshots**, which again
   looked fine because the sinking was large but visually easy to misjudge as
   "the character is just standing a bit further back/small in frame" rather
   than "half the body is below the floor" without a numeric check.

7. **Every character's Hips sank to floor level for EVERY clip — caught by
   the user ("still in the ground... half their body is in the ground"),
   not by this tool's own screenshot review, which had just (wrongly, see
   item 6's correction above) called this "grounded."** Root cause, found by
   numerically nudging a live character's `Hips.position` axis-by-axis and
   watching which one actually moved world-space height (`+Z 10` moved world
   Y by a full unit; `+Y 10` moved it by nothing) rather than assuming: for
   these Blender-exported GLB characters, Hips's LOCAL **Z** is the true
   vertical axis (world Y ∝ −local Z), NOT local Y, despite Y being "up" in
   this tool's three.js scene. Two compounding bugs followed directly from
   assuming the old Y-up convention (correct for the OTHER clip path in this
   tool, `activateFbxClip`'s raw unwrapped FBX clips, but not for this one):
   - `retargetMannyClip`'s own Hips block added the source hip-bounce delta
     to local Y (does nothing for height on this rig) instead of local Z.
   - `activateMannyClip` then called `freezeRootHorizontalMotion` — written
     for the OLD raw-FBX path where X/Z really are horizontal — which zeros
     local X/Z. On this rig that zeros the VERTICAL axis outright, snapping
     Hips to exactly floor level (`world Y = 0`, confirmed by direct
     measurement, not approximately low — exactly zero, every character,
     every clip, the whole time).
   Fix: removed the `freezeRootHorizontalMotion` call from `activateMannyClip`
   entirely (retargetMannyClip's own Hips block already freezes the correct
   X/Y horizontal axes by construction); moved the vertical delta onto local
   Z with the correct sign (`targetHipsPos.z - verticalDelta` — the world-Y-
   vs-local-Z relationship is negative, confirmed empirically, not assumed).
   Reverified NUMERICALLY this time, not just by eye: sampled
   `Box3.setFromObject(character).min.y` at 10 points through the `run` clip
   before (consistently ≈ −0.75 to −0.8, on a ~1.9-unit-tall character — very
   close to "half the body") and after (consistently within ≈ ±0.06 of the
   floor, matching normal foot-ground contact) the fix, across the full
   12-character × 11-clip matrix (only `dive` dips further, to about −0.4,
   which is a real tumbling roll bringing the body low, not a bug — confirmed
   by screenshot, a believable mid-roll pose, and it's the ONE clip where
   that's expected). **Lesson, on top of item 6's: when the user reports a
   problem this tool's own screenshots didn't catch, don't re-verify with
   MORE screenshots — measure the actual number (bounding box, bone world
   position) directly.** Eyeballing a render is exactly the failure mode that
   let this ship as "grounded" in the first place.

8. **The "creepy horror film" bug — item 4/6's "world-space FK" fix turned
   out to have items 1/3's exact disease, just hidden one level deeper.**
   Reported directly by the user on `ch01`/AJ, `Run (Fwd Jog)`: the raw
   skeleton preview of this clip looked perfect (correct running motion,
   knees/elbows swinging naturally) while the SAME clip retargeted onto the
   character mesh looked grotesque — a splayed hand reaching toward the
   ground, contorted limbs. Since both preview modes play the identical
   source clip, and only one path (retargeting) sits between them, this
   proved conclusively the retarget math was still broken, not the mocap.
   Root cause: `newWorld = targetRestWorld * (sourceRestWorld⁻¹ *
   sourceCurrentWorld)` LOOKS axis-convention-independent because every
   quaternion fed into it is a genuine world quaternion (via real FK/
   `matrixWorld`, not hand-derived), but the formula itself still computes
   `sourceRestWorld⁻¹ * sourceCurrentWorld` — a rotation expressed IN the
   source bone's own rest-orientation frame — then reapplies that SAME
   numeric value as if it meant the same thing in the TARGET bone's own
   rest-orientation frame. That's only valid if the two rigs agree on what
   "my local axes" mean at rest, which UE Manny and this Mixamo rig do not.
   Confirmed two ways, both numeric, neither "eyeballed":
   - Per-bone delta magnitude (`sourceRestInv * sourceCurrent`, converted to
     an angle) for a plain jog cycle never dropped below ~20–40° for
     spine/shoulders across the ENTIRE clip, and legs/hands ranged as high
     as ~120° — far too large and too sustained for a jog, the tell that the
     REFERENCE itself (not the motion) was the problem.
   - Sampling limb-segment direction vectors (parent-bone-to-child-bone,
     world space) from the retargeted character AND the raw-skeleton ground
     truth at the same 10 clip-time fractions and measuring the angle
     between them: it swung incoherently frame-to-frame (0.9° at one sample,
     over 100° two samples later, no fixed relationship) — i.e. the limb was
     visibly swinging in the WRONG PLANE, not just offset by some constant
     misalignment. A 300-sample fine-grained scrub of one bone's local
     quaternion confirmed zero discontinuities across the whole clip
     (max per-step change ~0.006° at that sampling density), ruling out a
     quaternion-interpolation/sign-flip artifact as an alternative
     explanation — the wrong-plane motion is perfectly smooth, meaning every
     individual retargeted keyframe's pose is actually wrong, not a
     playback/interpolation glitch.

   Fix: for bones with a clean single "next" bone in their own chain (spine,
   shoulders, arms, legs, feet — see `SWING_SOURCE_CHILD`/
   `SWING_TARGET_CHILD` in `main.js`), stop transferring a body-frame
   rotation delta and transfer a world-space AIM/SWING instead:
   `sourceAimRest = normalize(sourceChildRestWorldPos - sourceRestWorldPos)`,
   `sourceAimCurrent(t) = normalize(sourceChildWorldPos(t) -
   sourceWorldPos(t))`, `swingQ(t) = Quaternion.setFromUnitVectors(
   sourceAimRest, sourceAimCurrent(t))`, then `newWorldQ = swingQ(t) *
   effectiveTargetRestWorld` — a genuine world-frame (extrinsic) rotation,
   composed the same way (pre-multiplied onto the target's rest) as the
   Hips-yaw fix that's been robust since the very first session. This never
   reads either rig's local bone axes, so it can't reproduce this bug (or
   items 1/3's) by construction. The one thing it deliberately gives up is
   TWIST around the aim axis (forearm pronation, thigh rotation) — a real,
   bounded limitation, not an oversight, and far less damaging than a wrong
   swing PLANE. `computeSourceWorldQuatsPerFrame` was extended (and renamed
   `computeSourceWorldFrames`) to also return world POSITIONS, not just
   quaternions, for both the mapped bones and their designated swing-child
   bones (some of which, like `spine_04`/`neck_02`, aren't independently
   retargeted bones at all — they parent-hop past MANNY_BONE_MAP's coarser
   spine subdivision and exist here only so `spine_03`'s own true swing can
   be measured against its own real child, confirmed via a live hierarchy
   dump: `clavicle_l`/`clavicle_r`/`neck_01` all actually branch off
   `spine_05`, two vertebrae past where `MANNY_BONE_MAP` stops mapping the
   spine chain). Bones with no clean single next-bone (Head, LeftHand/
   RightHand, LeftToeBase/RightToeBase — true leaves, or ones fanning into
   many finger/corrective children) keep the old quaternion-delta method;
   their bind-pose rotation magnitude and visual footprint are both small
   enough that the same axis-mismatch risk matters much less there.

   **Reverified numerically, not by eye**: resampled the same limb-direction-
   vector comparison after the fix — the angle between retargeted-character
   and raw-skeleton-ground-truth direction vectors is now a small, CONSTANT
   offset per bone across all 10 sampled clip-time fractions (essentially
   zero standard deviation): legs ~2–3°, spine ~5–10°, upper/lower arm
   ~35–62° (arms carry a larger but STABLE bias, from the NEUTRAL_OFFSET
   "T-pose→hang-down" correction not exactly matching the source's own rest
   arm angle — a real, minor, and now-understood limitation, not the
   catastrophic incoherent-per-frame failure this fix targets). Re-verified
   grounding didn't regress (`Box3.min.y` within ±0.09 across the clip,
   consistent with item 7's fix). Screenshotted continuous playback across
   the full `run` clip on `ch01` — natural, coherent running poses
   throughout, no distortion — and spot-checked `ch05`/`run`,
   `ch01`/`idle`, `ch01`/`serve` for regressions; all correct. **Not yet
   re-verified across the full 12-character × 11-clip matrix** — this was
   scoped, per explicit user instruction, to `ch01`/`Run` only for this
   session; don't assume every other clip/character combination is fixed
   without re-running the same measurement.

   Left in `main.js` for next time: `window.__RETARGET_DEBUG = true` before
   loading a clip populates `window.__lastRetargetDebug` with full per-bone,
   per-frame intermediate values (rest/current world quats, which method was
   used, the resulting local quat) for exactly this kind of numeric
   diagnosis; `activateSkeletonClip` also now exposes
   `window.__skeletonPreview = { root, mixer, action, clip }` so the raw
   ground-truth rig's bones can be scrubbed and measured the same way the
   retargeted character's can via `window.__poc`.

9. **Immediately after item 8 shipped, the user caught a second, distinct bug
   by eye: retargeted arms "run like a fairy" — held out stiffly, not
   swinging/bending like the raw-skeleton ground truth, on `ch01`/AJ/Run.**
   This was NOT a regression of item 8's fix (legs/spine/shoulders were
   correct) -- it was a second, narrower failure mode of the SAME swing
   method, specific to the forearm. Numeric measurement (limb-segment aim
   direction sampled at 10 points through the clip, this time reading the
   raw x/y/z components, not just the angle-to-ground-truth summary that
   item 8 used -- that summary metric turns out to be mathematically
   incapable of catching this class of bug, see below) showed the retargeted
   **forearm** stuck within a few percent of literal-T-pose-horizontal
   (`~[0.9-0.99, small, small]`) for the ENTIRE clip while the source
   forearm swept through a wide, clearly time-varying range. The **upper
   arm** was fine (already had `NEUTRAL_OFFSET_BONES`'s hang-down rest
   correction). Root cause: the swing method computes `newWorldQ = swingQ(t)
   * effectiveTargetRestWorld`, which applies the SAME world rotation to
   whatever direction the target's rest baseline points. A raw T-pose
   forearm points almost exactly along its own natural swing axis
   (mediolateral/left-right) -- and a running arm's elbow segment swings by
   rotating roughly ABOUT that same axis -- so rotating a vector around an
   axis nearly parallel to itself does almost nothing (a textbook degenerate
   case). The forearm had no hang-down correction (`NEUTRAL_OFFSET_BONES`
   only listed `LeftArm`/`RightArm`), so its baseline stayed at the
   degenerate literal-T-pose direction. Fix: added `LeftForeArm`/
   `RightForeArm` to `NEUTRAL_OFFSET_BONES`, giving the forearm the same
   kind of hang-down rest correction as the upper arm -- moving its baseline
   away from the degenerate direction fixes the swing transfer for the same
   reason it already worked for legs (whose T-pose rest, pointing straight
   down, was never parallel to the hip's own swing axis in the first place,
   hence needing no correction at all). **A blind alley worth recording**:
   the first hypothesis was backwards -- that the hang-down correction
   itself was CAUSING the stiffness by conflicting with the swing method, so
   it was removed for all swing bones as an experiment. That measurably made
   the upper-arm mismatch WORSE (54.8° vs. 35.2° constant offset against
   ground truth), disproving the theory before it reached any screenshot;
   reverted immediately. **Also worth recording**: item 8's own verification
   metric (angle between the retargeted and ground-truth direction vectors)
   is mathematically PROVEN to always come out perfectly constant across
   time for the swing method, by construction -- rotating two vectors by the
   identical rotation preserves the angle between them, and swing applies
   the exact same `swingQ(t)` to both the target's and (implicitly) the
   source's baseline. A constant, small angle (as item 8 measured for arms:
   35.2°/62.1°, std ≈ 0) is consistent with EITHER a working transfer with a
   modest rest-pose mismatch, OR a completely frozen limb whose fixed
   "resting" gap to a moving ground truth just happens to look small on
   average -- the metric cannot tell these apart. **The lesson: for the
   swing method specifically, always additionally inspect the RAW per-frame
   vector components (does the retargeted limb's direction actually change
   over time at all?), not just the summary angle-to-ground-truth** -- this
   is what actually caught the fairy-arm bug once the user flagged it by
   eye, and item 8's own verification pass should have run this check
   proactively rather than treating a low, constant summary angle as
   sufficient proof. Re-verified: forearm direction now visibly time-varying
   across the clip (no longer pinned near one value), continuous-playback
   screenshots across the full `run` cycle on `ch01` show a natural bent-arm
   running pump throughout, and `ch05`/run, `ch01`/idle, `ch01`/serve,
   `ch01`/victory were all re-checked for regressions (arms hang/bend
   naturally, no reversion to T-pose).

10. **Immediately after item 9, the user reported a THIRD distinct problem by
   eye, with screenshots of `ch02` (blonde bun, orange sweater) on Idle and
   Ready Stance**: Idle showed a bizarre one-foot-forward stagger with an
   arm reaching back and fingers splayed; Ready Stance showed the torso
   folded forward far more extremely than a reasonable ready crouch. Same
   root disease as item 9, one bone further out the chain: `LeftHand`/
   `RightHand` were still on the OLD quaternion-delta fallback (no clean
   "next" bone was wired up for them), and both `Idle` and especially
   `Ready Stance` turned out to be near-static HELD poses (`Ready Stance`'s
   clip duration is a mere 0.067s -- 2 keyframes, not a dynamic motion at
   all), which is exactly the condition (item 5c) under which the delta
   method reverts to showing the target's own literal rest pose --
   producing a flat, T-pose-ish splayed hand. Fix: extended the swing method
   to hands too, using each rig's middle-finger metacarpal
   (`middle_metacarpal_l`/`_r` on the source, confirmed a real child of
   `hand_l`/`hand_r`; `LeftHandMiddle1`/`RightHandMiddle1` on the target,
   confirmed a real child of `LeftHand`/`RightHand`) purely as an aim
   reference -- see the `hand_l`/`hand_r` and `LeftHand`/`RightHand` entries
   added to `SWING_SOURCE_CHILD`/`SWING_TARGET_CHILD`. Also added
   `LeftHand`/`RightHand` to `NEUTRAL_OFFSET_BONES`, for the identical
   degenerate-axis reason item 9 added the forearms (a raw T-pose hand also
   points along the arm's own horizontal line). **Also directly disproved,
   in the same investigation, the earlier (already-flagged-as-unverified)
   "READ THIS FIRST" theory that `ch06`/`ch08`'s extreme Ready-Stance poses
   were probably genuine source content, not a bug** -- `ch01` numerically
   confirmed the retargeted spine bend was actually reasonably close to (if
   anything, slightly LESS than) the raw skeleton's own bend at the one real
   keyframe, so that specific "content, not code" conclusion may still be
   right for the SPINE, but the earlier investigation never isolated hands
   as a separate variable, and the visual "wrongness" people were reacting
   to was dominated by the hand/finger bug fixed here, not the torso angle.
   If `ch06`/`ch08`'s Ready Stance still look bad after this fix, revisit
   whether it's a genuine content/casting problem for that specific source
   clip (see the "READ THIS FIRST" section's original suggestion to swap
   which file `TOP_PICKS.ready` points to). Reverified: fresh `ch02`
   screenshots for Idle (relaxed natural stance, no stagger, relaxed hand)
   and Ready Stance (a plausible aggressive athletic crouch, no longer a
   grotesque fold) after the fix; `ch02` Run/Serve/Victory and `ch01`
   Run/Idle re-checked for regressions, all still correct; grounding
   re-sampled across the `ch01` run clip, unaffected.

11. **The actual root cause underlying items 9 and 10's symptoms, found only
   after the user demanded an actual side-by-side skeleton/character visual
   comparison instead of another round of "looks fixed to me."** Items 9 and
   10 each patched a SYMPTOM (forearm frozen, hand flat) by adding more
   bones to `NEUTRAL_OFFSET_BONES`, but the CH02 Idle screenshots the user
   posted afterward still showed a stagger/reaching-arm look. Built the
   debug visualization requested since the very first session (better late
   than never) -- `window.skeletonOverlayEl`/`skeletonOverlayHelper` in
   `main.js`, a `THREE.SkeletonHelper` drawn directly on the ACTIVE
   character, toggled via the new "Show Skeleton Overlay" button -- then
   used it (mesh hidden, camera framed on the character's own Neck/Hips
   bones so the crop isn't a guess) to directly compare the retargeted
   skeleton against the raw-skeleton preview at the exact same pinned frame
   (`action.paused = true; action.time = 0`, not just a `waitForTimeout`
   after clicking -- an earlier attempt at this comparison was accidentally
   comparing two DIFFERENT moments because playback kept advancing during
   the screenshot wait).
   
   What direct visual comparison showed, unambiguously: on `ch02` Idle, the
   raw skeleton's arm hangs with **increasing** lateral distance from the
   spine going shoulder -> elbow -> hand (a normal relaxed arm-at-side
   shape); the retargeted character's arm did the opposite -- lateral
   distance *decreased* shoulder -> elbow -> hand, curling the hand in
   toward the belly/centerline instead of hanging beside the thigh. Root
   cause: `newWorldQ = swingQ(t) * effectiveTargetRestWorld` (where
   `effectiveTargetRestWorld = neutralOffset * targetRestW`, i.e. the
   NEUTRAL_OFFSET-corrected hang-down baseline) applies `swingQ(t)` --
   which was MEASURED as a delta from the source's own LITERAL rest aim --
   onto a baseline that is NOT the target's literal rest, but an already-
   different (hang-down) one. That's only harmless when `swingQ(t)` is near
   identity (source barely moving, which is why items 9/10's fixes still
   looked fine on Run's dynamic motion and even improved Idle's forearm/hand
   somewhat) -- for a genuine, non-trivial swing, replaying a rotation
   derived from one reference frame onto a materially different one doesn't
   produce an equivalent result, and the error COMPOUNDS down the chain
   (upper arm picks up a bias, forearm inherits it and adds its own).
   Fix: apply the swing against the bone's LITERAL rest -- the same
   reference it was measured from -- and apply `neutralOffset` as a
   separate GLOBAL realignment of the finished result instead:
   `neutralOffset * (swingQ(t) * targetRestW)`, i.e.
   `newWorldQ.copy(swingQ).multiply(targetRestW);
   if (neutralOffset) newWorldQ.premultiply(neutralOffset);`. When
   `swingQ(t)` is identity this reduces to exactly the old
   `effectiveTargetRestWorld` -- the original T-pose-when-still fix (item
   5c) this correction exists for is completely unaffected; only genuine,
   sizeable swings change, and only for the better. (The quaternion-delta
   FALLBACK method, used for leaves, already had this composition order
   right by simple associativity -- `effectiveTargetRestWorld * deltaQ =
   neutralOffset * (targetRestW * deltaQ)` -- which is why leaves never
   showed this particular symptom; only the swing method had it backwards.)

   **Lesson, on top of every prior one in this file**: a numeric summary
   metric (item 8's angle-to-ground-truth, item 9's aim-direction sampling)
   can be blind to an entire CLASS of bug if the bug's symptom doesn't
   happen to be the thing that metric measures. This one was only found by
   literally looking at both skeletons, at the same frame, side by side --
   exactly what the user asked for, twice, before finally being built. If
   another retargeting complaint comes in, reach for
   `window.skeletonOverlayHelper` (toggle via the UI button or
   `skeletonOverlayVisible`/`click()` on `#skeletonOverlay`) and the raw
   `sk-*` preview FIRST, at a frame pinned with `action.paused = true`, not
   another round of aggregate statistics.

   Reverified: `ch02` Idle now shows the hand hanging naturally beside the
   body (confirmed both visually, mesh-hidden skeleton-only front/side
   views, and numerically -- lateral+depth distance from the spine axis now
   increases shoulder(0.15)->upperarm(0.26)->elbow(0.21)->hand(0.26),
   matching the raw skeleton's own monotonic-outward shape reasonably well,
   not the inverted 0.26->0.21->0.10 curl from before). Re-screenshotted
   `ch01` and `ch02` across Idle/Ready Stance/Run/Serve/Victory/Hit React --
   all show natural, undistorted poses. Grounding re-sampled across `ch02`
   Run, unaffected (within the established normal foot-contact range).

12. **Built the live, synced "raw skeleton beside character" comparison
   tool the user asked for after item 11 ("we need the models to move as
   the skeletons move").** A "Show Raw Skeleton Beside (synced)" button
   (`rawSkeletonBesideEl` in `main.js`) clones the currently-playing top-
   pick clip's raw FBX, scales it to roughly the active character's height
   (purely for legibility, no bearing on correctness), places it 1.2 world
   units to the side, and locks its `AnimationAction.time` to the
   character's own `currentAction.time` every frame in `animate()` --
   because the retargeted clip's tracks reuse the source clip's own
   keyframe `times` verbatim, the same time value lands on the same point
   in both animations, so this is exact, not approximate, sync. Exposed as
   `window.__comparisonSkeleton` for the same ad-hoc-inspection reasons as
   `window.__poc`/`window.__skeletonPreview`.
   
   **Immediately caught an important methodological trap while verifying
   this**: a first side-by-side screenshot (both skeletons visible, default-
   ish 3/4 camera angle) made the retargeted character's `run` pose look
   dramatically LESS dynamic than the source at the exact same synced time
   -- legs looking nearly together/standing versus the source's clear high-
   knee stride. This looked like a serious new bug. Direct numeric
   verification (bone world positions read at that exact moment, both
   skeletons, both confirmed at identical `action.time`) showed the leg
   segment directions actually matched closely (same shape as item 8's
   original measurement). Re-shot from a genuine PURE SIDE view (camera
   along the character's own lateral axis, tightly framed on bone bounds)
   instead of an arbitrary 3/4 angle, and the two poses turned out to match
   well -- forward torso lean, one leg extended back, one bent forward, one
   arm reaching down, on both. **The original "mismatch" was an artifact of
   an ambiguous camera angle applied to two skeletons of different scale
   sitting next to each other, not a retargeting bug.** Lesson for next
   time (a new twist on the running "don't trust a render, verify"
   warning): when comparing two skeletons side by side, an arbitrary or
   default camera angle can misrepresent a CORRECT match as badly as it can
   hide a real bug -- prefer a straight-on side view (clearest read on
   sagittal-plane running/swinging motion) and/or the bone-position numbers
   over a single 3/4-angle screenshot before concluding either way.

   Separately, confirmed (numerically, across `ch02`/`run`, 10 sampled
   fractions) two REAL, but stable/minor discrepancies worth being upfront
   about, neither a new bug: legs track the source within ~2-6° at every
   single sampled fraction (excellent); the spine leans forward ~13-14°
   LESS than the source, consistently (a stable bias, same general class as
   the already-documented arm biases in items 8-11, not investigated
   further this session). Hip yaw dynamics were checked with a flawed proxy
   metric (thigh-position cross product, which conflates leg swing with
   actual pelvis rotation) and shouldn't be trusted from this session's
   numbers -- the Hips bone's own local quaternion DOES vary meaningfully
   across the clip (confirmed directly), so "hips look frozen" was likely
   also a measurement artifact, not re-verified properly.

13. **The user directly compared the two skeletons on Run using item 12's
   new live tool and pointed at the arms: the raw skeleton swings a full
   reach out to the side, the retargeted character stays tucked in close
   to the body.** Confirmed immediately and severely with the same
   lateral-distance-from-hip measurement used in item 11, sampled at 30
   points through the whole `run` cycle: the character's hand reached only
   ~10-50% of the raw skeleton's proportional lateral distance, EVERY
   frame, both arms, not just an isolated pose.
   
   First hypothesis (composition order, `swingQ * effectiveTargetRestWorld`
   vs. `neutralOffset * (swingQ * targetRestW)`) was tested by reverting to
   the former -- it did NOT fix the problem, and on the left arm made the
   ratio measurably WORSE. This ruled out composition order as the cause
   and forced a look at the actual measured swing MAGNITUDE, not just how
   it's applied. Dumped `sourceAimRest` (the source bone's own literal
   rest-pose aim direction) for `LeftArm` directly: `(0.576, -0.817, 0.023)`
   -- i.e. already ~35° off vertical, NOT a horizontal T-pose and NOT fully
   hanging straight down either. **The source rig's own upper-arm rest is a
   relaxed, partially-lowered A-pose, roughly 35° out from the body.**
   `computeHangDownOffsetWorld`'s correction, though, forces the TARGET's
   baseline all the way to dead vertical (`(0, -1, 0)`, confirmed) --
   overshooting past where the source itself actually sits at rest. Since
   the swing is a WORLD rotation applied on top of whatever baseline you
   give it, starting the target ~35° closer to the body than the source's
   own equivalent starting point means the target lands ~35° closer to the
   body at every frame too, regardless of composition order -- a genuine
   baseline MISMATCH, not a formula bug.

   Real fix: removed `LeftArm`/`RightArm` from `NEUTRAL_OFFSET_BONES`
   entirely (kept it for `LeftForeArm`/`RightForeArm`/`LeftHand`/
   `RightHand`, which have a DIFFERENT, genuine reason to need it -- see
   item 9's degenerate-swing-axis explanation, unrelated to this baseline-
   mismatch issue). The upper arm never actually needed the correction:
   item 8's very first swing-method measurement already showed `LeftArm`
   swinging a modest, non-frozen 22-39° range with NO correction applied at
   all -- the degenerate-freeze symptom item 9 fixed was specific to the
   forearm's OWN rest-aim happening to align with its natural swing axis,
   never diagnosed (or true) for the upper arm. Adding the correction to
   `LeftArm`/`RightArm` back in the very first version of this whole swing
   rewrite was over-application by analogy ("arms are T-pose-y, so correct
   all arm-related bones") rather than a measured need.

   **Reverified, numerically**: re-ran the same 30-point lateral-distance
   scan on `ch01`/`run` after removing the upper-arm correction -- left arm
   ratio improved from single digits (~4-15%) to ~37-55%, right arm from
   ~27-45% to ~70-95% (near-matching). Visually re-confirmed `ch02` Idle
   still hangs naturally (no T-pose reversion, no reintroduced curling --
   the source's own ~35°-out rest pose is itself already a reasonable
   "arms slightly away from the body" idle stance, so the LITERAL rest
   baseline now used for the upper arm reproduces something natural on its
   own, without needing an artificial correction). Full regression pass
   (`ch01`/`ch02` × Idle/Ready Stance/Run/Serve/Victory/Hit React) all show
   natural, undistorted poses with visibly better arm extension on Run and
   Serve specifically.

   **Left arm's remaining ~40-60% gap is not fully closed** -- likely the
   SAME class of baseline mismatch, now on the FOREARM (which still forces
   a hard "point straight down" correction rather than matching whatever
   angle-off-vertical the source's own forearm rest actually sits at). If
   revisited: measure the source forearm's own rest angle-from-vertical
   (the same way this item measured the upper arm's) and consider
   calibrating `computeHangDownOffsetWorld`'s target to that angle instead
   of a hardcoded straight-down, for the bones that still need any
   correction at all. Left deliberately unfixed this session to avoid
   another round of unverified speculative changes -- re-measure before
   touching it.

14. **Immediately after item 13, the user reported the fix insufficient:
   "still broke... arms and elbows look backwards," and directly asked
   whether there's any way to validate this at all.** Ran a follow-up
   measurement pass rather than another screenshot-only check:
   - **Elbow bend AMPLITUDE** (`LeftArm`/`LeftForeArm`, `ch01`/`run`, 20
     sampled frames): angle between the upper-arm and forearm direction
     vectors. Target consistently ~85-108° (a mild, right-angle-ish bend).
     Source consistently much tighter, ~28-52° (a sharply folded elbow).
     This is the SAME class of bug item 13 fixed for the upper arm
     (`computeHangDownOffsetWorld` forcing a baseline that doesn't match the
     source rig's own actual rest angle) but `LeftForeArm`/`RightForeArm`
     still carry that correction (kept deliberately in item 13, since the
     forearm has a DIFFERENT, genuine reason to need some correction — the
     degenerate-swing-axis problem from item 9). **Not yet measured**:
     what the source's `lowerarm_l` rest angle-from-vertical actually is
     (item 13's fix for the upper arm depended on measuring this number
     first, not guessing) — do that before touching `NEUTRAL_OFFSET_BONES`
     or `computeHangDownOffsetWorld` again for the forearm.
   - **Elbow bend PLANE** (does the elbow fold the same rotational way as
     the source, independent of how far): computed
     `cross(shoulder→elbow, elbow→hand)` for both target and source at each
     frame and took the dot product of the two (normalized) results --
     `+1` would mean "folds exactly the same way," `-1` would mean a clean
     180° mirror ("backwards" in the most literal sense). Actual result
     across a full `run` cycle: wobbled between `-0.06` and `+0.47` -- weak
     and inconsistent, never strongly positive, occasionally crossing to
     slightly negative. **This is NOT a clean mirror-image bug** (that would
     show consistently near `-1`), but it's also not remotely a confident
     match -- consistent with an elbow that looks like it's folding in a
     subtly-to-moderately wrong plane at various points in the stride,
     which plausibly reads as "backwards" to a human eye without being a
     single simple sign flip anywhere in the code.
   - A tightly-cropped, camera-matched visual close-up of just the
     shoulder-elbow-hand chain (both target and source, same synced frame,
     mesh hidden, skeleton-only) was captured but was NOT conclusive either
     way on quick inspection -- the crop framing differed enough between
     the two (different bone-length scales) that a confident "yes this
     looks backwards" or "no it doesn't" call couldn't be made from it.
     If picking this up again, get BOTH skeletons into the exact same
     camera frame with a shared, deliberately-chosen scale (not just
     "fit bounds"), not two separately-framed screenshots.
   
   **Honest bottom line, stated directly to the user**: validation tools
   exist and were used (this is not a "no way to validate" situation), and
   they found real, quantified, disclosed signal -- but that signal did not
   converge on a single fixable root cause within this session. Do not
   read the amplitude and bend-plane measurements above as two independent
   confirmed bugs to go fix separately without re-verifying each is real
   and distinct; they were measured together and might share one cause.

15. **Item 14's "elbows bend the wrong way" root-caused and fixed, via a
   more rigorous version of the same visual check the user asked for.** The
   user posted a screenshot of the character-plus-skeleton-overlay next to
   the raw skeleton and asked directly "can you tell elbows bend the wrong
   way?" That prompted redoing item 14's bend-plane measurement properly:
   the ORIGINAL check compared bend axes in raw WORLD space, which is
   invalid here because the target and source skeletons can have (and do
   have) different, independently time-varying overall body yaw -- so a
   world-space mismatch doesn't distinguish "the elbow itself bends wrong"
   from "the two bodies just happen to be turned differently from each
   other at this instant." Redone in a BODY-RELATIVE frame (bend axis
   decomposed against each figure's own spine-up direction): still showed a
   consistent, non-wobbly mismatch -- target's bend-plane component landed
   at a near-constant 0.96-1.00 on EVERY sampled frame of a full `run`
   cycle, while source's was consistently smaller and OPPOSITE in sign.
   That ruled out "camera/measurement artifact" and confirmed a real, fixed
   (not intermittent) bug.

   Root cause, found by dumping the actual intermediate vectors rather than
   further aggregate statistics: `LeftForeArm`'s world-space swing method
   (used since item 8) only ever constrains the elbow's AIM direction
   (elbow -> hand); it never constrains TWIST around that axis. Both the
   `neutralOffset` correction (built from the TARGET's own geometry) and
   `swingQ` (built from the SOURCE's) each independently pick their own
   "shortest path" twist via `setFromUnitVectors`, and composing two
   geometrically-arbitrary twists produces a bend plane that's an artifact
   of that composition, not a reproduction of the source's actual elbow
   articulation -- and because neither twist depends on the frame's actual
   pose, the artifact is highly consistent (matching the near-constant
   0.96-1.00 reading), not random.

   First fix attempt: compute the elbow's bend RELATIVE TO THE UPPER ARM's
   own current world rotation (undo the upper arm's rotation from the aim
   vector, for both source and target, then replay the relative delta) --
   conceptually sound (a genuinely local, twist-reduced quantity, still
   computed from measured world vectors, not named local axes) but it
   recreated the EXACT SAME degenerate-freeze bug one level deeper: the
   target's parent-relative rest aim (whether computed from the hang-down
   baseline OR the literal T-pose rest) landed almost perfectly parallel to
   the relative swing's rotation axis, so the elbow barely moved either
   way. Confirmed by direct measurement both times (frozen at `~(0,0,1)`
   with the hang-down reference, frozen at `~(0,1,0)` with the literal
   reference) before diagnosing why.

   **The actual, deeper problem, found by dumping the raw rest-pose
   vectors**: the SOURCE rig's own bind pose has the elbow ALREADY bent
   ~129° away from straight (`sourceAimRestLocal` measured as
   `(0.777, -0.629, 0)`) -- this Manny rig's rest pose is a relaxed,
   already-bent stance, not a T-pose (consistent with item 13's finding
   that its upper-arm rest is also ~35° off vertical, not horizontal). The
   target's literal rest is a dead-straight `(0, 1, 0)` T-pose forearm --
   129° apart from source's rest. Computing "how much has the elbow moved
   FURTHER from its own already-bent rest" (a small, ~5-12° swing, since
   the elbow doesn't flex much MORE during a jog beyond its resting bend)
   and replaying that small delta onto a completely different (dead
   straight) target baseline reproduces "dead straight plus a small
   wobble" -- technically a correct delta, on two baselines too far apart
   to reconcile from bind-pose data alone. Same disease as item 13's
   amplitude bug, but here the baselines are so far apart (129° vs. 35°)
   that no baseline correction fixes it -- there is no principled single
   angle to rotate a straight T-pose toward to match a 129°-bent rest
   without knowing which direction/plane that bend should be in, which the
   bind pose alone doesn't tell you.

   **Actual fix**: stop trying to preserve "delta from rest" for the elbow/
   wrist entirely. Directly transplant the source's CURRENT elbow aim,
   expressed relative to its own upper arm's current world rotation, onto
   the target's own upper arm's ACTUAL current world rotation
   (`parentFrames[i]`, already correctly retargeted) -- see the
   `useParentRelative` branch in `retargetMannyClip`. This gives up
   matching the target's own rest-pose bend angle exactly (there's no
   principled way to reconcile a 129° rest mismatch from bind-pose data
   alone) in exchange for directly reproducing the source's real elbow
   configuration every single frame, which is what actually looks correct.
   `NEUTRAL_OFFSET_BONES`/`computeHangDownOffsetWorld` are now COMPLETELY
   UNUSED for `LeftForeArm`/`RightForeArm`/`LeftHand`/`RightHand` in
   practice (the parent-relative path never reads `effectiveTargetRestWorld`
   at all) -- they still exist and are still applied to nothing, since
   removing the constant/map entries isn't necessary and the dead branch
   costs nothing.

   **Reverified, numerically and by construction**: after the fix, the
   angle between the target's and source's parent-relative forearm
   direction is exactly 0.0° at all 20 sampled frames of a `run` cycle --
   expected, since it's now a direct transplant, but this confirms the
   plumbing (which world quaternion is "current," which is "rest," the
   re-attachment via `parentFrames[i]`) is wired correctly with no sign
   errors or stale references. Full visual regression across `ch01`/`ch02`
   × Idle/Ready Stance/Run/Serve/Victory/Hit React: every clip now shows a
   clearly natural, correctly-bent elbow (visibly more so than any prior
   session's screenshots) with no reintroduced T-pose stiffness on Idle
   (removing the hang-down correction from this path turned out not to
   matter -- the direct transplant already reproduces a natural relaxed
   bend since it's copying the source's own genuinely-relaxed rest
   configuration, frame by frame, rather than needing a separate
   correction). Grounding re-sampled across `ch01` `run`, unaffected.

   **What this does NOT claim to fix**: the twist/roll around the forearm's
   own long axis is still not reproduced (never was, this whole method
   family only ever controls aim) -- if a clip's forearm PRONATION
   specifically looks wrong (not the bend angle/plane, but the hand's own
   rotation independent of elbow bend), that is a separate, known,
   undocumented-until-now gap, not covered by this fix.

16. **Immediately after item 15 shipped, the user reported the elbow now
   bends "90 degrees backwards, when they should be bent slightly forward."**
   Item 15's fix was numerically self-consistent (target's parent-relative
   forearm direction matched source's EXACTLY, confirmed) but that
   consistency check was blind to a second, independent problem, found only
   by taking the report seriously and measuring further rather than
   defending the existing fix.

   Root cause: item 15's "carry the elbow's relative configuration through
   the upper arm's own current world rotation" step used each rig's REAL
   upper-arm world quaternion for both the "undo" (source) and "redo"
   (target) steps. But the upper-arm swing method (item 13, and every swing
   bone in this file) only ever constrains AIM direction, never TWIST
   (rotation around the bone's own long axis) -- so each rig's real
   upper-arm quaternion carries its own independent, arbitrary "shortest
   path" twist convention from `setFromUnitVectors`. Measured directly: the
   quaternion difference between target's and source's upper arm, at
   matching synced frames, was a 120-140° rotation, with 70-80% of that
   rotation's axis aligned with the arm's own aim direction -- i.e.
   overwhelmingly pure TWIST mismatch, not an aim disagreement (aim itself
   was already confirmed tracking well). Carrying the elbow's relative
   configuration through each rig's own twist-laden frame rotated the
   elbow's bend PLANE by that same ~100+ degree mismatch, even though the
   underlying delta transfer was mathematically correct -- explaining
   exactly the reported symptom (a real bend, just rotated around the arm's
   own axis into approximately the wrong orientation).

   Fix: stop using either rig's REAL upper-arm world quaternion as the
   carrier frame. Build a "canonical," twist-free reference quaternion for
   each side instead (`buildAimQuaternion` in `main.js`), using ONLY the
   upper arm's own (correctly-tracked) aim direction plus ONE shared,
   externally-fixed up-hint (`TARGET_UP`, world +Y) -- i.e. construct an
   orthonormal basis from the aim direction and the up-hint the SAME way
   for both rigs, so neither rig's own internal twist convention is ever
   consulted. Use these canonical quaternions (not `sourceParentFrames[i]`/
   `parentFrames[i]`) for the undo/redo steps in the `useParentRelative`
   branch.

   **Reverified, numerically**: elbow bend ANGLE (angle between upper-arm
   and forearm direction vectors) now matches the source EXACTLY at all 20
   sampled frames of a `run` cycle (e.g. both read 45.9° at t=0, 28.2° at
   the tightest-bend frame, 52.0° at the most-extended) -- and, as a
   direct consequence of the elbow no longer distorting the arm's overall
   shape, the upper-arm lateral-reach measurement (item 13's original
   metric) also improved further, from item 13's ~0.70-0.95 ratio to a
   near-perfect ~0.89-1.03 across the whole cycle. Full visual regression
   (`ch01`/`ch02` × Idle/Ready Stance/Run/Serve/Victory/Hit React):
   consistently natural, correctly-bent elbows, no T-pose regression on
   Idle. Grounding re-sampled, unaffected.

   **Lesson, on top of item 12's**: a numeric self-consistency check
   (item 15's "target matches source exactly, by construction") proves the
   ARITHMETIC is internally coherent -- it does NOT prove the physical
   quantities being carried through that arithmetic mean what you think
   they mean. Here, "the upper arm's world quaternion" silently included an
   uncontrolled, per-rig-arbitrary twist component that the self-consistency
   check couldn't see, because IT was ALSO carried through consistently
   (garbage in, garbage out, but consistently so). Only a fresh, independent
   physical measurement (the upper-arm quaternion DIFFERENCE, decomposed
   into aim-aligned vs. perpendicular components) revealed it.

17. **Immediately after item 16, the user said "same with wrists."** Given
   item 16's fix was written generically (any bone with `neutralOffset` +
   a clean swing child goes through `useParentRelative`, not elbow-specific
   code), the instinct was to assume the SAME mechanism must be broken for
   hands too and re-derive another twist-fix. Checked the actual
   `window.__RETARGET_DEBUG` method label for `LeftHand` FIRST instead of
   assuming: it read `"swing"`, not `"parent-relative"` -- i.e.
   `useParentRelative` was silently evaluating to `false` for hands the
   whole time, meaning item 16's fix had never actually been engaging for
   wrists at all, and they were still running the OLD, pre-item-15
   world-space swing method with none of items 15/16's work applied.

   Root cause: `useParentRelative` requires `childLocalOffsetTarget =
   restPositions.get(targetChildSuffix)` to be truthy.  For `LeftForeArm`,
   `targetChildSuffix` is `"LeftHand"` -- an independently-retargeted bone,
   already captured in `restPositions` via `Object.values(MANNY_BONE_MAP)`.
   But for `LeftHand`, `targetChildSuffix` (from `SWING_TARGET_CHILD`) is
   `"LeftHandMiddle1"` -- a finger bone that exists ONLY to give the hand an
   aim reference (see item 10) and was NEVER independently retargeted, so
   it was never added to `captureTargetRestPose`'s `wantedSuffixes` set and
   `restPositions.get("LeftHandMiddle1")` was always `undefined`. Every
   other swing bone's child happens to also be a MANNY_BONE_MAP value
   (Spine's child Spine1, LeftArm's child LeftForeArm, etc.), which is
   exactly why this gap was invisible until a bone whose swing-child is a
   non-retargeted leaf (only hands, of the currently-mapped bones) was
   checked specifically.

   Fix: `wantedSuffixes` in `captureTargetRestPose` now unions in
   `Object.values(SWING_TARGET_CHILD)` as well, not just
   `Object.values(MANNY_BONE_MAP)` -- guaranteeing every bone's OWN swing-
   child reference gets its rest position captured, independently retargeted
   or not.

   **Reverified**: `window.__RETARGET_DEBUG` now shows `"parent-relative"`
   for `LeftHand` (confirmed on `ch01`/`run`). Wrist bend angle (forearm
   direction vs. hand-to-middle-finger direction) matches the source
   EXACTLY at all 21 sampled frames of a `run` cycle (constant 19.3° both
   sides -- the wrist itself barely flexes relative to the forearm during
   this particular gait, which is why it doesn't vary, not a sign the check
   is broken). Full visual regression across `ch01`/`ch02` ×
   Idle/Ready Stance/Run/Serve/Victory/Hit React: hands look relaxed and
   natural throughout, no stiff/backwards wrist bend.

   **Lesson, sharper than item 16's**: when a fix is written generically
   (intended to cover a whole class of bones), do not assume a report of
   "the same bug elsewhere" means the SAME mechanism needs re-diagnosing --
   check FIRST whether the generic fix actually engaged for that specific
   bone at all (here, one `console`/`window.__RETARGET_DEBUG` read revealed
   it silently hadn't, in under a minute) before spending time re-deriving
   physics. The bug here wasn't in the twist-fix math from item 16 at all --
   it was a silent, un-thrown, un-logged fallback to completely different,
   older code, one precondition (`childLocalOffsetTarget`) away from firing.

18. **Immediately after item 17 shipped, the user reported `run`'s arms
   "flailed out... raised as if he is trying to fly," elbows should be lower
   and tucked closer to the sides.** Same session's earlier commit had just
   REMOVED `LeftArm`/`RightArm`'s `NEUTRAL_OFFSET_BONES` hang-down correction
   (reasoning it "overshot the source rig's own ~35-degree-off-vertical rest
   pose, damping genuine reach" on swing-type clips) — this report is that
   removal's other shoe dropping, on a low-arm-motion clip instead.

   Verified numerically before touching any math (per item 17's lesson):
   `window.__RETARGET_DEBUG` on `ch01`/`run` showed `LeftArm` using method
   `"swing"` (not `"parent-relative"`), `sourceAimRest` ≈ `(0.58, -0.82,
   0.02)` (i.e. ~35° off straight-down, confirming the commit message's
   number), and — the actual bug — `newWorldQ` staying within a few degrees
   of `targetRestW` (the character's own literal T-pose rest) at every
   sampled frame of the run cycle. Root cause: with the hang-down correction
   removed, `effectiveTargetRestWorld` for the upper arm reverts to the
   literal T-pose baseline, and `run`'s upper arm barely swings relative to
   the SOURCE's own (already near-vertical) rest — so `swingQ` is small, and
   composing a small rotation onto a ~90-degree-wrong (horizontal, not
   hanging) baseline leaves the arm sitting almost exactly horizontal for
   the whole clip. Exactly item 5c/17's disease one joint further up the
   chain: any delta-from-a-mismatched-reference method reveals the TARGET's
   own rest whenever the SOURCE barely moves relative to ITS rest — it just
   hadn't been checked on a low-arm-motion clip after the neutral-offset
   removal.

   Fix: rather than reinstating a hang-down correction (which is what
   caused the reach-damping regression the same-session commit was chasing),
   extended `PARENT_RELATIVE_BONES` to include `LeftArm`/`RightArm`, so the
   upper arm now goes through the SAME direct-transplant-through-a-twist-
   free-carrier-frame method already proven for elbow/wrist (items 15/16),
   instead of the world-space swing-from-rest method. This is a genuine
   transplant of the source's actual current shoulder-relative arm
   orientation every frame, not a delta from either rig's rest, so it's
   immune to both failure modes at once (T-pose-reveal on low motion AND
   rest-mismatch damping on high motion) by construction. No new data
   plumbing was needed — `sourceParentFramePos`/`childLocalOffsetTarget`/
   `targetParentChildOffset` were already computed for every mapped bone;
   only the `useParentRelative` gate (previously piggybacked on
   `neutralOffset`, i.e. `NEUTRAL_OFFSET_BONES` membership) needed
   decoupling from that array into an independent `PARENT_RELATIVE_BONES`
   list.

   **Reverified**: `window.__RETARGET_DEBUG` now shows `"parent-relative"`
   for `LeftArm` on `run`, with the upper arm's aim direction landing
   38-50° off straight-down across sampled frames (up from pinned-at-90°/
   horizontal) — a plausible natural jog swing range, not a guess (matches
   the source's own ~35° rest plus real swing amplitude). Full visual
   regression via the skeleton-overlay + raw-skeleton-beside tools, `ch01`
   and `ch05`, across Idle/Run/Serve/Victory: arms hang naturally at rest,
   no T-pose reveal on low-motion clips, AND `serve`'s big lateral reach
   (one hand near the head, other arm extended out) is still fully
   preserved — the item-13 reach-damping bug did NOT come back.

   **Lesson**: a fix scoped to "remove a correction that's wrong for clip
   type A" needs re-verification specifically on LOW-motion clips (idle,
   run) as well as the HIGH-motion clip it was diagnosed on (serve/swing) —
   removing a baseline correction can look like a clean win on the clip
   that motivated it while quietly reintroducing item 5c's T-pose-reveal
   bug on a different clip in the same bone. When two clip types pull a
   shared baseline in opposite directions, the fix that satisfies both
   is usually to stop depending on that baseline at all (direct transplant),
   not to tune where the baseline sits.

Also tried and **reverted** (don't redo without a reason): programmatically
re-cutting forehand/backhand/overhead straight from the pristine source via
`THREE.AnimationUtils.subclip` at the same frame numbers, to avoid whatever
the Blender export path did. The re-cut overhead was wrong (grabbed the wrong
motion window); the user's original Blender-cut three were fine all along —
the real bug was the neck/position issue above, not the Blender export.
Verified the manually-cut old three are correct on multiple characters after
the position/scale fix.

## Known issues / open items (not yet addressed)

- **File size**: characters are raw FBX, unoptimized, 5–54MB each (see table
  below). Triangle counts are mostly *within* pb3d's own documented
  30k–60k-tri player budget (`GRAPHICS.md`/`PLAYER-IMPORT.md`) — the size is
  almost entirely 4096×4096 uncompressed textures (2–4x pb3d's stated 1–2k
  target) and FBX's lack of geometry compression, not excessive geometry.

  **Pipeline built and proven on all 12 characters + forehand/backhand/
  overhead**, see `tools/blender-fbx-to-gltf.py` (headless Blender FBX→glTF
  conversion), `tools/lib/mixamo-bones.mjs` (bone-name normalization + the
  three retargeting fixes below, ported to build time),
  `tools/build-mixamo-character.mjs` (per-character: meshopt geometry
  compression + WebP 1k textures + `paddle_socket` + a small procedural
  `headband` team-color accessory), and `tools/build-mixamo-clip-library.mjs`
  (one shared animation GLB instead of baking clips into every character).
  Real measured sizes, raw FBX → Blender-converted (uncompressed) → final
  optimized GLB:

  | Character | Raw FBX | Converted | Final GLB | Reduction |
  |---|---|---|---|---|
  | ch01 | 6.67 MB | 6.71 MB | 0.43 MB | 15.5x |
  | ch02 | 47.72 MB | 51.31 MB | 1.32 MB | 36.1x |
  | ch03 | 20.00 MB | 20.90 MB | 0.47 MB | 42.5x |
  | ch04 | 32.66 MB | 35.17 MB | 0.47 MB | 68.9x |
  | ch05 | 47.88 MB | 54.62 MB | 0.90 MB | 53.4x |
  | ch06 | 50.51 MB | 54.14 MB | 1.54 MB | 32.8x |
  | ch07 | 39.90 MB | 43.62 MB | 0.75 MB | 52.9x |
  | ch08 | 51.48 MB | 55.02 MB | 1.50 MB | 34.3x |
  | ch09 | 27.64 MB | 29.69 MB | 0.38 MB | 72.9x |
  | ch10 | 7.41 MB | 5.41 MB | 0.48 MB | 15.4x |
  | ch11 | 17.82 MB | 18.41 MB | 0.68 MB | 26.1x |
  | ch12 | 5.01 MB | 4.13 MB | 0.21 MB | 23.9x |

  All 12 land at **0.21–1.54 MB**, comfortably under the ≤2-3MB-per-character
  mobile-over-cellular budget. Total for all 12: **9.13 MB**. Worst-case
  4-distinct-character match (the 4 largest): **5.26 MB** — well inside the
  ~5s-on-4G target. `tools/validate-player-glb.mjs` confirms `paddle_socket`
  present and `EXT_meshopt_compression` applied on every one.

  Clips (forehand+backhand+overhead, one shared file): raw 1.53 MB combined
  → converted 0.26 MB combined → final **0.066 MB** (one file, fetched once,
  ~23x reduction).

  Two build-time findings worth keeping: (1) `ch04`/`ch05`/`ch06` actually
  *did* carry numbered Mixamo bone namespaces (`mixamorig6:`,`mixamorig10:`)
  — unlike `ch12`'s plain `mixamorig:` — so the defensive bone-prefix
  normalizer in `tools/lib/mixamo-bones.mjs` (originally added just in case)
  turned out to be load-bearing for a third of the roster, not just
  paranoia. (2) `ch10` hit a `quantize: Skipping TEXCOORD_0; out of [0,1]
  range` warning during meshopt compression (a UV set tiles/wraps beyond
  0-1) — harmless, that one primitive's UVs just stay uncompressed; final
  size (0.48 MB) is unaffected and still well in budget.

  `src/assets.js`'s `GLTFLoader`s now have `MeshoptDecoder` wired in (needed
  to load meshopt-compressed GLBs at all), and `preloadPlayerModels()` takes
  an optional `neededKeys` filter so a match only fetches the roster's actual
  4 characters instead of the whole catalog. `tools/validate-player-glb.mjs`
  also gained a size-budget check and a bounds-computation fix (its old naive
  node-matrix bounds silently read a Mixamo/Blender-exported asset's true
  ~1.6×2.1×0.7m T-pose shape as a bogus 0.02×1.45×0.02 "needle" — fixed by
  switching to `THREE.Box3.setFromObject(root, true)`, which applies real
  per-vertex skin deformation; originally verified non-regressive against the
  now-retired generated/gendered GLBs, whose reported heights didn't move).

  All 12 converted/built GLBs live in the gitignored
  `tools/.cache/mixamo-converted/` scratch dir (source of truth for
  rebuilding); the shipped copies live in `assets/models/players/` (currently
  just `player-ch12-v1.glb`, see below), `assets/animations/
  pickleball-swings.glb`, and `character-preview/public/*.glb` (all 12, for
  this viewer).

- **DONE — facing/orientation measurement, for `ch12` only.** Confirmed by
  actually measuring (not guessing): the +90°-about-X wrapper rotation +
  0.01 unit-conversion scale baked onto every character's top-level
  `Armature` node (verified identical across ch01/02/03/05/11/12) is a fixed
  Blender-export artifact, not something to solve per character — what
  varies is each character's resulting facing direction once that's
  resolved, and for `ch12` a toe-vs-foot world-position check
  (`tools/validate-player-glb.mjs`, extended this session with a reusable
  facing diagnostic) confirmed its rest pose already faces `+Z`, matching
  the primitive rig's convention, so `playerRotation: [0,0,0]`. **The other
  11 characters still need this same per-character measurement** before they
  can be wired in — don't assume they all match ch12.
- **DONE — paddle now visible.** `paddle_socket` is a plain (non-skinned)
  node parented under a bone, so it inherits the same Armature-wrapper unit
  scale (0.01) as everything else, but — unlike skinned meshes, whose vertex
  deformation is computed consistently in that same space — a rigid child
  attached there renders at 1% size unless compensated. Fixed via the
  existing `paddleSocketScale: 100` manifest field (confirmed by measuring
  `paddle_socket`'s actual world-space scale, not by guessing). Needs the
  same check for each additional character.
- **DONE (ch12) — root motion in the real game.** The horizontal-freeze fix
  bakes in at build time (`tools/build-mixamo-clip-library.mjs`, via
  `tools/lib/mixamo-bones.mjs`'s `freezeRootHorizontalMotion`), so no
  separate runtime stripping was needed in `src/players.js`. **However, this
  function had the wrong two axes zeroed for this pipeline** (ported from
  this viewer's FBX/`THREE.FBXLoader`-native coordinate frame, which has no
  wrapper rotation — a correct assumption there, but not for the
  Blender-glTF-converted character/clip files, where a child bone's own
  translation channel is still expressed in Blender's original Z-up
  authoring frame: local Z is vertical, local Y is horizontal). The bug
  pinned every character's hips to the floor for the full swing duration
  (confirmed both by measuring Hips world Y in the real game, and physically:
  the un-frozen "vertical" axis showed a ~63cm range, too large for a hip
  bob and a good match for footwork, while the frozen "horizontal" axis
  showed a tight ~6cm range that lines up with a believable weight-shift once
  correctly re-mapped as vertical). Fixed in `tools/lib/mixamo-bones.mjs`;
  `pickleball-swings.glb` was rebuilt from the still-available pre-merge
  source clips (`tools/.cache/mixamo-converted/{forehand,backhand,
  overhead}.glb`) and reverified. If you ever rebuild this file from scratch,
  make sure you're on a checkout with this fix, not the original version.
- **STILL OPEN — no contact-frame calibration.** pb3d's swing contract
  requires `contactT = 0.5` (contact at 50% of a 0.44s visual window). None
  of these clips have been calibrated to that — we found by accident that
  the code-recut forehand's 50% mark was mid-footwork, not the strike.
  Someone needs to scrub each clip and find/retime the true contact frame
  before any of this can drive believable paddle timing.
- **STILL OPEN — missing pickleball-specific shots.** Real gameplay needs at
  minimum: an *underhand* serve (pickleball's serve must be underhand — the
  tennis overhead serve is a different, rules-incorrect shot, not just a
  style choice), a dink (soft short shot from the kitchen — arguably
  pickleball's signature shot, nothing in this asset set resembles it), a
  drop shot (the "serving-team drop" from pb3d's own 4-shot pattern), a
  volley, a lob, and ideally ATP/Erne stand-ins (named, existing gameplay
  behaviors per `GRAPHICS.md` — likely no stock mocap library has these; may
  need custom capture or an accepted approximation). Also: real lateral
  movement (strafe/backpedal), not just forward run — pickleball positioning
  is lateral-heavy and a forward-run clip reused sideways will look like
  sliding. **Separately and more basically**: there's no idle, ready, run, or
  serve clip at all yet (only forehand/backhand/overhead) — see the Open
  TODOs section below.
- **RESOLVED (decision made, not built) — bone-naming vs. pb3d's existing
  adapter.** pb3d's `syncPrimitiveArms`/`visual_left_upper_arm`-style node
  mechanism is unrelated to Mixamo `mixamorig*` bone names and isn't used for
  these characters (`syncPrimitiveArms: false`, same as `player-male-v1`/
  `player-female-v1` already were) — clip application is purely
  clip-name-based (`src/players.js`'s `clipKey()`), which already works
  across bone-naming conventions.
- **RESOLVED (decision made) — customization + team color.** Per explicit
  product decision this session: these characters do **not** go through
  pb3d's per-slot gender/hair/hair-color/beard/jersey-color/shorts-color
  customization system at all. A new `customizable: false` manifest flag
  (read in `src/players.js`'s `applyModelMaterials`/`applyAuthoredIdentity`)
  skips tinting/variant-hiding entirely for these models, so they render with
  their own imported look untouched. The existing procedural `Headband`
  placeholder accessory (`tools/build-mixamo-character.mjs`) happens to
  already be tintable via the existing material-slot system, but is
  deliberately NOT wired up as a team-color feature per that decision — see
  the Open TODOs section for the "replace the character creator" item this
  feeds into.
- **RESOLVED — licensing.** The 12 characters are confirmed Mixamo content,
  free for unlimited commercial use per Adobe's current terms (checked live,
  see "Licensing status" above) — no royalties, no attribution, no
  restriction on shipping them compiled into this game. The project owner
  also confirmed there are no remaining licensing blockers for the
  swing/sports mocap clips.

## Character roster reference

| Key | File | Size | Notes |
|---|---|---|---|
| ch01 | ch01.fbx | 7.0MB | formerly "Aj", a Mixamo default sample character |
| ch02 | ch02.fbx | 50.0MB | |
| ch03 | ch03.fbx | 21.0MB | |
| ch04 | ch04.fbx | 34.2MB | |
| ch05 | ch05.fbx | 50.2MB | formerly "Ch28" |
| ch06 | ch06.fbx | 53.0MB | |
| ch07 | ch07.fbx | 41.8MB | |
| ch08 | ch08.fbx | 54.0MB | formerly "Ch42" |
| ch09 | ch09.fbx | 29.0MB | |
| ch10 | ch10.fbx | 7.8MB | formerly "claire" |
| ch11 | ch11.fbx | 18.7MB | formerly "Kachujin G Rosales" |
| ch12 | ch12.fbx | 5.3MB | formerly "Ty" |

## Where this is headed

The user's stated intent: replace pb3d's existing authored player GLBs
(`player-male-v1`/`player-female-v1`, see `PLAYER-IMPORT.md` and
`GRAPHICS.md` in the repo root) with a handful of these characters, plus a
character-chooser UI instead of the current hair/clothing customization
system. Whatever gets built must stay a visual-only overlay — re-read
`GRAPHICS.md`'s "Primitive Rig Authority" and "Non-Negotiable Gameplay
Invariants" sections; swing timing, `contactT`, paddle contact, and hit
dispatch must keep coming from the primitive rig, not from these characters
or clips.

**Update, a later session:** the "only forehand seeming to work" gameplay
symptom flagged below turned out to have a concrete, fixed root cause. The
bug was in `src/players.js`'s `clipKey()`, which tested the generic
`backpedal|backward|back` pattern *before* the more specific `backhand|bh`
pattern, so any clip literally named `"backhand"` (true of both
`player-male-v1.glb` and this project's own `pickleball-swings.glb`) matched
the generic `back` alternative first and got misfiled as locomotion, silently
losing the backhand swing to the `fh` fallback in `playOnce()`. Fixed by
reordering the checks. This was a real, pre-existing, general adapter bug —
not specific to Mixamo characters — found via the screenshot-driven
verification loop `CLAUDE.md` mandates, not by reasoning about the code in
the abstract.

## Open TODOs (tracked here — keep this list current)

- [x] **DONE (partial) — the debug visualization the user explicitly asked
   for (twice), finally built in item 12:** a "Show Skeleton
   Overlay" toggle button draws a `THREE.SkeletonHelper` directly on the
   active character (`skeletonOverlayHelper`/`skeletonOverlayVisible` in
   `main.js`) — no mesh-transparency toggle was added (the helper draws
   through the mesh by default, which was sufficient in practice; hiding
   the mesh entirely, via `character.traverse` setting `visible = false`,
   worked even better for a clean comparison and needed no new UI). **Still
   missing**: the color-coded Hips forward/right/up axis gizmo + static
   world-reference-direction arrow — the still-open "is it facing backwards"
   question below has NOT been re-checked with this tool yet. Do that before
   trusting facing on any new character/clip.
- [ ] **Re-verify the "backwards" facing question**, using the gizmo above.
   Never rigorously re-checked after the grounding fix (item 7) — got
   diverted into that bug, which was real, but the facing question itself is
   still open. See the "READ THIS FIRST" section at the top of this file.
- [x] **DONE — Serve and Hit React were bad content choices, not code bugs**
   — confirmed and fixed this session, swapping to `RMB_Throw__PhaseManny.FBX`
   (serve) and `HitReact_Left__AuroraManny.FBX` (hit react). **Ready Stance
   was NOT a bad content choice** — `Steel_Idle_PreJump_ReadyPose` was kept
   (a swap to `Throw_Ready_Loop` was tried and explicitly rejected by the
   user as too upright) and its one real flaw, the asymmetric left leg, was
   fixed directly via `mirrorRightLegOntoLeft()` instead. See "READ THIS
   FIRST" above.
- [ ] **Add the missing animations: idle, serve, run, ready.** Only
   forehand/backhand/overhead exist today. Without these, any wired-in
   character freezes in its bind pose whenever not mid-swing (confirmed
   accepted as a known/documented gap for the `ch12` proof of concept — see
   `GRAPHICS.md`). Same build pipeline (`tools/build-mixamo-clip-library.mjs`)
   should extend to cover these once suitable mocap source clips are found;
   double-check the `freezeRootHorizontalMotion` axis fix above applies
   correctly to whatever new clips get added (rebuild + re-measure Hips
   world Y across the clip, don't assume).
   **Progress this session:** 51 candidate clips (idle/ready/run/backpedal/
   side_shuffle/pivot_spin/serve/jump_smash/dive/hit_react/victory —
   see the `top-picks` bullet above) are now previewable, live-retargeted
   onto any of the 12 Mixamo characters, in this viewer for the user to
   pick from — this is PREVIEW ONLY, not the build-time pipeline. Once the
   user has picked favorites, they still need to go through
   `tools/build-mixamo-clip-library.mjs` (or an equivalent) to actually ship
   them, same as forehand/backhand/overhead did.
- [x] **DONE — all 12 characters are wired into the real game.** All of
   `ch01`-`ch12` have full `assets/manifest.js` entries (facing measured per
   character via `tools/validate-player-glb.mjs`, all `+Z`;
   `paddleSocketRotation`/`paddleSocketScale` reused from `ch12`'s values and
   visually confirmed correct for every character via the character
   picker's live preview — no per-character adjustment was needed).
   `src/characters.js` now has no gender concept; each roster slot
   independently picks one of the 12 by id.
- [x] **DONE — the character creator has been replaced with a character
   chooser.** The old gender/hair/color customization modal is gone
   entirely. The main menu's "Choose" button now opens a fighting-game-style
   picker (`#characterModal` in `index.html`, behavior in `src/main.js`): a
   P1/P2/P3/P4 tab strip switches the active roster slot, and clicking a
   tile in a shared 12-character grid assigns that character to it.
   Duplicate picks across slots are allowed.
- [ ] **Real team-color art / accessory**, beyond the current placeholder
   `Headband` box — a stated `GRAPHICS.md` priority (player team/role
   distinction) with no concrete plan yet for fixed, non-customizable
   characters.

Also still true from the original pass: pb3d's broader gameplay feel
(jerky hits, movement/AI tuning) is a *different system*
(`src/shots.js`, `src/game.js`, `src/ai.js`, `src/constants.js`) that this
character-preview/Mixamo work does not touch — the specific "only forehand
working" symptom under that umbrella is now understood and fixed (see
above), but that doesn't mean every gameplay-feel complaint is resolved;
treat that as a still-open, separate investigation if it resurfaces.
