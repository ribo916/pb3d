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
  forehand/backhand/overhead were cut from) are **still raw, unoptimized
  FBX** loaded via `FBXLoader`, fetched lazily on first click of their clip
  button — no smaller replacement has been built for these (nothing ships
  them), so they were deliberately left in place rather than deleted.
  `tennis-source.fbx` in particular is the only remaining copy of that mocap
  take's full context; don't delete it without re-reading the "Asset
  provenance" section below. Since this folder is untracked, a fresh clone
  won't have these files — clicking their clip buttons shows a per-button
  error instead of breaking the page.

## What the viewer does

- **Character row**: 12 characters, `CH01`–`CH12`, switchable live, each
  fetched lazily on first click (with a per-button loading/error state) via
  `preloadPlayerModels()` — clicking back to a previously-viewed character
  hits that loader's cache, no re-fetch.
- **Clip row**: whatever's baked into the selected character's own GLB
  (currently nothing — the shipped character builds carry no animation, see
  the Open TODOs section), plus a shared set of clips applied to *whichever*
  character is active: `Forehand`/`Backhand`/`Overhead` (from the shipped,
  already-fixed `pickleball-swings.glb` — same file the real game loads, no
  runtime retargeting/strip/freeze needed for these three), `Tennis Source
  (full)` (the pristine ~28.7s uncut take those three were manually cut from
  in Blender, still raw FBX), and 6 other-sport clips (`Golf Swing`,
  `Baseball Batter`, `Baseball Pitcher`, `Soccer Penalty Kick`, `Soccer
  Passing`, `Football QB`, still raw FBX with the original runtime
  retarget/strip/freeze fixes applied as before). The raw-FBX clips fetch
  lazily on first click and cache their raw download; the
  retarget/strip/freeze pass re-runs (cheaply, no network) against whichever
  character is currently active.
- Play/Pause, a scrub slider (0–1 normalized through the clip), and a
  playback-speed slider.
- `window.__poc = { character, clips, mixer }` and `window.__THREE` /
  `window.__camera` / `window.__controls` are exposed on `window` for
  ad-hoc Playwright/devtools inspection — this is how every bug in this doc
  was actually found, not by eyeballing alone.

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
  per-vertex skin deformation; verified non-regressive against the existing
  player-poc/male/female GLBs, whose reported heights didn't move).

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

- [ ] **Add the missing animations: idle, serve, run, ready.** Only
   forehand/backhand/overhead exist today. Without these, any wired-in
   character freezes in its bind pose whenever not mid-swing (confirmed
   accepted as a known/documented gap for the `ch12` proof of concept — see
   `GRAPHICS.md`). Same build pipeline (`tools/build-mixamo-clip-library.mjs`)
   should extend to cover these once suitable mocap source clips are found;
   double-check the `freezeRootHorizontalMotion` axis fix above applies
   correctly to whatever new clips get added (rebuild + re-measure Hips
   world Y across the clip, don't assume).
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
