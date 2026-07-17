# PB3D Asset Pipeline

This folder is for optional authored graphics assets. The game must still run
with the procedural fallback when any of these files are absent.

For the broader graphics-overhaul state, visual verification baseline, and next
character-model priorities, see [`../GRAPHICS.md`](../GRAPHICS.md).

For the retired Quaternius CC0 humanoid pipeline (download flow,
`tools/build-player-model.mjs`, and its traps), see
[`../PLAYER-IMPORT.md`](../PLAYER-IMPORT.md). `player-male-v1` and
`player-female-v1` were built this way historically, but their runtime GLBs and
manifest slots have been removed. The active roster now uses the 12 Mixamo
slots `player-ch01-v1`, `player-ch03-v1`, `player-ch04-v1`,
`player-ch06-v1` through `player-ch12-v1`, `player-ch14-v1`, and
`player-ch15-v1` (there is no `ch02`/`ch05`/`ch13`).

## Structure

```text
assets/
  models/
    venues/       Optional `.glb` / `.gltf` venue props or full venue shells.
    players/      Skinned or static player models.
      mixamo/     Active optimized Mixamo character catalog (12 files: ch01,
                  ch03, ch04, ch06-ch12, ch14, ch15 — no ch02/ch05/ch13),
                  wired in `assets/manifest.js` as player model slots.
                  Also read by `character-preview/`, so this is the one common
                  location for these files.
  textures/
    court/        Optional court/surface texture sets.
    venues/       Optional prop and venue texture sets.
  environments/   Optional HDR/equirect environment maps.
  animations/     Shared animation-only GLBs: pickleball-swings.glb (forehand/
                  backhand/overhead) and pickleball-locomotion.glb (idle/ready/
                  run/serve/backpedal/shuffle_left/shuffle_right).
  manifest.js     Runtime asset slots consumed by `src/assets.js`.
```

Prefer `.glb` for bundled models. Keep generated or source art out of the
runtime path unless it is meant to ship.

## Adding A Model

1. Put the optimized `.glb` under the matching folder.
2. Add or update a manifest entry in `assets/manifest.js`.
3. Set `url` to the static path, for example
   `/assets/models/venues/park-props.glb`.
4. Keep `optional: true` until the procedural fallback has been fully replaced
   and verified.

The loader only fetches entries with a non-empty `url`, so placeholder manifest
entries are safe and do not produce missing-file requests.

## Player Model Contract

- Put a real authored GLB under `assets/models/players/` and add or update a
  `player-*` manifest entry. If it should be selectable in the active roster,
  add it to `src/characters.js`.
- Use `player-base` only for future shared roster-wide replacement work.
- Authored player GLBs should face local `+z`, use an origin at the feet, and
  arrive at real-world scale around 1.7-1.9 m before manifest alignment.
- Skinned meshes are cloned with skeleton-safe cloning so the four roster
  instances can animate independently.
- The current primitive rig remains the fallback and gameplay driver. When a
  player model is loaded, the primitive body is hidden but its paddle stays
  visible; `contactT` and `paddleWorld` still come from the same paddle blade.
- Authored models may include a named `paddle_socket` node under the right hand
  or forearm. When present, the visible primitive paddle is attached there and
  `paddleWorld` is refreshed from that same blade after arm sync. Older models
  without the socket keep the previous primitive-paddle attachment.
- Optional manifest fields `paddleSocketOffset`, `paddleSocketRotation`, and
  `paddleSocketScale` fine-tune the attached paddle after it is parented to the
  socket.
- Optional manifest fields `playerScale`, `playerOffset`, and `playerRotation`
  align authored models with the primitive rig.
- Optional manifest field `fallbackKey` lets an empty or failed optional player
  slot resolve to another loaded model. The active roster uses
  `player-ch01-v1` as the shared Mixamo fallback for the other Mixamo slots.
- Legacy roster `height`/`build` fields still scale authored and primitive
  players when present; the active Mixamo chooser does not expose those
  cosmetic controls.
- `syncPrimitiveArms: true` lets named authored arm nodes follow the existing
  primitive swing rotations during transition work. The expected node names are
  `visual_left_upper_arm`, `visual_left_forearm`, `visual_right_upper_arm`, and
  `visual_right_forearm`.
- Mesh or material names, or `userData.slot` / `userData.materialSlot`, may use
  `jersey`, `shorts`, `skin`, `hair`, `shoe`, `headband`, or `paddle` to receive
  roster colors.
- Variant groups may be named `variant_<group>_<value>` (e.g.
  `variant_hair_long`, `variant_facialhair_beard`, `variant_headwear_cap`), or
  use matching `userData.variantGroup` / `userData.variantValue` fields (the
  `extraMeshes` build config sets these directly — see `PLAYER-IMPORT.md`).
  The adapter shows the node matching roster `hairStyle`, `facialHair`, and
  `headwear`, and hides the rest in each group. A cosmetic field with no
  matching baked node (e.g. `facialHair: 'none'`) simply hides all nodes in
  that group. Different groups are independent, so e.g. `hair` and
  `facialHair` nodes can both be visible at once (a hairstyle plus a beard).
- Animation clips may live on the player GLB or optional animation GLBs. Names
  containing `idle`, `ready`, `run`/`jog`, `forehand`/`fh`, `backhand`/`bh`,
  `serve`, or `smash` are recognized by the adapter. In-match stationary players
  prefer `ready` when available and fall back to `idle`. Swing clips are scaled
  to the primitive swing duration, while the primitive rig remains the gameplay
  timing source.
- Optional manifest field `swingClipOverrides` can remap a requested swing type
  to another available clip, e.g. `{ serve: 'fh' }` for imported characters whose
  temporary serve source animation is not a paddle swing.
- Swing clips should place paddle contact at 50% of a 0.44 s swing clip so they
  line up with `contactT = 0.5`. Do not change gameplay timing to fit the art.
- Player 1 high-quality target budget is roughly 30k-60k triangles, optimized
  GLB, and 1k-2k PBR textures where they materially improve face, skin, hair,
  clothes, and shoes. Provide a lower LOD or rely on the primitive fallback for
  mobile if needed.
- All active roster slots (`nearYou`/`nearMate`/`farA`/`farB`) resolve through
  `src/characters.js` to one of the selectable Mixamo model keys. Keep the same
  visual-only primitive-rig contract for all four players.
- Optional manifest field `customizable: false` opts a model out of the
  roster's cosmetic system entirely: `applyModelMaterials`/
  `applyAuthoredIdentity` (`src/players.js`) skip jersey/shorts/hair/headwear
  tinting and variant-node hiding, leaving the model's own imported look
  untouched. Used by the active Mixamo character pipeline (see
  `GRAPHICS.md`'s "Mixamo Character Pipeline" section and
  `character-preview/CONTEXT.md`) for characters that are not meant to be
  customized the way the retired Quaternius bodies were. Defaults to
  customizable (omit the field, or set `true`) for existing models.

Validate a candidate player GLB without rendering:

```bash
node tools/validate-player-glb.mjs assets/models/players/mixamo/ch01.glb
```

Capture Player 1 comparison screenshots:

```bash
npm run player:check
```

## Optimization Path

- Compress large GLBs with `gltf-transform optimize` or an equivalent pipeline.
- Prefer KTX2/Basis-compressed textures once texture size becomes meaningful.
- Share materials across repeated props; use instancing for repeated venue
  objects where practical.
- Keep ball, court-line, and player-readability checks ahead of visual density.
