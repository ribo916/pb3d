# Importing Authored Player Models (Quaternius CC0)

How Player 1 (`player-human-v1`) and the CPU partner (`player-partner-v1`) were
built, and how to build the remaining roster slots (`player-opponent-a-v1`,
`player-opponent-b-v1`). This is the durable record of the download +
optimization pipeline and the non-obvious traps in it.

Read alongside [`GRAPHICS.md`](GRAPHICS.md) (adapter contract, verification
baseline) and [`assets/README.md`](assets/README.md) (manifest field reference).

## Source assets (CC0)

- Base bodies: <https://quaternius.itch.io/universal-base-characters>
- Animations: <https://quaternius.itch.io/universal-animation-library>

Use the **Standard / free** tier. Both are **CC0** (see `License_Standard.txt`
in each zip). The free base pack ships only the athletic "Superhero" male/female
bodies + separate hairstyle meshes; the "Regular" proportion bodies and any
clothing are SOURCE-tier only (paid).

### Downloading from itch.io (free "name your own price")

The download list is not in the page HTML; itch reveals it after a CSRF POST,
and the final file URL is a **signed R2 URL that expires in ~60 seconds**, so
run the whole chain in one shot. `page="https://quaternius.itch.io/<slug>"`:

1. `GET $page` → scrape `csrf_token` from the HTML.
2. `POST $page/download_url` (form field `csrf_token`, header
   `X-Requested-With: XMLHttpRequest`) → JSON `{ "url": "<download-page>" }`.
3. `GET <download-page>` (with cookies from step 1) → scrape
   `data-upload_id="<id>"`.
4. `POST $page/file/<id>?source=game_download&as_props=1&after_download_lightbox=true`
   (form field `csrf_token`) → JSON whose **first** `url` is the R2 file link
   (a later `url` in the same JSON is a decoy — parse JSON, don't regex).
5. `GET` that R2 URL immediately (< 60s) → the zip.

`data.json` at `$page/data.json` confirms title/price without auth.

## Pipeline: `tools/build-player-model.mjs`

Offline tool (deps not in `package.json`, like the raw music helpers):

```bash
npm i @gltf-transform/core @gltf-transform/extensions \
      @gltf-transform/functions sharp

# quick form (all defaults, no hair mesh)
node tools/build-player-model.mjs \
  "<pack>/Base Characters/Godot - UE/Superhero_Male_FullBody.gltf" \
  "<pack>/Unreal-Godot/UAL1_Standard.glb" \
  assets/models/players/player-human-v1.glb

# config form (per-player overrides; player-human-v1 now needs this to add hair)
node tools/build-player-model.mjs path/to/config.json
```

What it does: merges the animation GLB, **retargets every clip channel onto the
base skeleton by bone name** (the two packs share the UE-mannequin rig:
`root/pelvis/spine_*/clavicle_*/upperarm_*/lowerarm_*/hand_*`, fingers,
`thigh/calf/foot`), renames the mapped clips to the adapter keys, strips
root-translation + finger/toe channels, adds a `paddle_socket` node under
`hand_r`, compresses textures to 1k WebP, and prunes to a single-buffer GLB
(~1.1 MB). Config fields are documented in the script header.

Default clip map (source clip → adapter key). Only `idle`/`run` are strictly
required; the rest give swing motion since the packs have **no pickleball
swing**:

| adapter key | source clip          |
|-------------|----------------------|
| idle        | `Idle_Loop`          |
| ready       | `Sword_Idle`         |
| run         | `Jog_Fwd_Loop`       |
| forehand    | `Sword_Attack`       |
| backhand    | `Punch_Cross`        |
| serve       | `Spell_Simple_Shoot` |
| smash       | `Punch_Jab`          |

## Traps that cost real time (don't relearn these)

- **Texture filename mismatch.** The base glTFs reference some textures with a
  `_png` suffix that the pack ships without it. For each `uri` a glTF requests
  that is missing on disk, copy the matching present file to that name, e.g.:
  - Male body: `cp T_Hair_1_Normal.png T_Hair_1_Normal_png.png` and
    `cp T_Eye_Normal.png T_Eye_Normal_png.png`.
  - Female body: `cp T_Eye_Normal.png T_Eye_Normal_png.png`.
  Otherwise every loader errors on the missing file.
- **`Animation.dispose()` does not cascade** to its samplers/channels. Leftover
  samplers keep their accessors alive and get serialized — this bloated the file
  ~6× (6.9 MB → 1.09 MB once fixed). Dispose channels *and* samplers, and sweep
  any accessor left attached only to `Root`.
- **GLB needs a single buffer.** After merge there are 2; reassign all accessors
  to one buffer and dispose the rest before writing.
- **`prune()` deletes empty leaf nodes** — add `paddle_socket` *after* the
  prune/dedup pass, not before, or it vanishes.
- **Facing must be measured, not guessed.** This asset faces **local +Z**
  (matches the primitive rig's "face on +z"), so `playerRotation: [0, 0, 0]`.
  A `[0, π, 0]` guess put the player 180° backward (facing off-court). Verify
  from geometry — toe-vs-ankle Z and eyebrow-vs-head Z both point the facing
  direction — not from the contrived `player:check` close-up pose.
- **Single-material body = no per-slot team color.** The free "Superhero" body
  is one material (`MI_Superhero_Male`) and is shirtless/barefoot/bald. Only the
  eyebrows map to the `hair` slot. Real jersey/shorts/skin/shoe team recoloring
  needs a mesh split (by UV or bone weight) or SOURCE-tier clothing meshes.
- **Validator needs headless shims.** `tools/validate-player-glb.mjs` was built
  for the texture-less POC; it now includes DOM/texture shims + skinned-mesh-safe
  bounds so it can load real textured/skinned GLBs in Node (three's GLTFLoader
  otherwise throws `Image is not defined` and mis-measures skinned height).

### Player 1 hair (done — `player-human-v1`)

Player 1's base body (`Superhero_Male_FullBody.gltf`) is also bald aside from
eyebrows. `player-human-v1.glb` now merges the `Hair_SimpleParted.gltf`
hairstyle mesh the same way the partner does (see "Female partner specifics"
below for the mechanics), tagged `hairVariantValue: 'short'` to match the
`nearYou` roster's `hairStyle: 'short'`. config.json used:

```json
{
  "base": "<pack>/Base Characters/Godot - UE/Superhero_Male_FullBody.gltf",
  "anim": "<pack>/Unreal-Godot/UAL1_Standard.glb",
  "hairMesh": "<pack>/Hairstyles/Rigged to Head Bone/glTF (Godot -Unreal)/Hair_SimpleParted.gltf",
  "hairVariantValue": "short",
  "out": "assets/models/players/player-human-v1.glb"
}
```

The pack also ships `Hair_Buzzed.gltf` (shorter/buzzed) and `Hair_Beard.gltf`
(a separate beard mesh, mergeable the same way) if a different look is wanted.

## Wiring a partner / opponent slot (not Player 1)

Player 1 and the CPU partner (`nearMate`) are already wired. The two opponents
(`farA`/`farB`) are still **hardcoded to `player-poc`** and need TWO edits, not
just a manifest URL, to add each:

1. **Add a manifest entry** in `assets/manifest.js` `models[]`, copying the
   `player-human-v1` block. Give it a stable key
   (`player-partner-v1`, `player-opponent-a-v1`, `player-opponent-b-v1`),
   `fallbackKey: 'player-poc'`, `playerRotation: [0,0,0]`,
   `paddleSocketRotation: [Math.PI,0,0]`, `syncPrimitiveArms: false`.
2. **Point the roster at it** in `src/game.js` (the `palettes` object, ~line
   186). Each member has a `playerModelKey`. The near partner is `nearMate`
   (~line 196), opponents are `farA` / `farB`. Change the relevant
   `playerModelKey: 'player-poc'` to your new key. This is visual wiring only —
   it does not touch the gameplay-pure modules.

The roster `palette` also carries `skin`/`hair`/`build`/`height`; those still
tint the eyebrows (`hair` slot) and scale the authored model, but the free
body's single suit material is **not** recolored (see the team-color trap).

### Female partner specifics (done — `player-partner-v1`)

- Body: `Superhero_Female_FullBody.gltf` (same UE rig, same clip map, faces +Z).
- The female base is **also bald** — only eyebrows, no hair mesh. A bald
  muscular female didn't read clearly as female, so `player-partner-v1` merges
  a hairstyle mesh via the `hairMesh` config field (added to
  `build-player-model.mjs` for this): it reads a second glTF (e.g.
  `Hairstyles/Rigged to Head Bone/glTF (Godot -Unreal)/Hair_Long.gltf`),
  **retargets its skin onto the base skeleton by bone name** — the same
  by-name-matching trick used for animation channels above, not a static parent
  to the `Head` bone, since the hairstyle ships pre-rigged to the shared UE
  rig — disposes the hair doc's now-unreferenced duplicate skeleton copy, and
  tags the merged mesh `variantGroup: 'hair'` / `variantValue: '<hairVariantValue>'`
  so the adapter shows it only for roster members with a matching `hairStyle`.
  Reuse `hairMesh` (e.g. `Hair_Buns.gltf`) for either opponent if they need hair.

config.json (the tool only accepts a JSON file path when `hairMesh` is needed,
not the quick 3-arg form):

```json
{
  "base": "<pack>/Base Characters/Godot - UE/Superhero_Female_FullBody.gltf",
  "anim": "<pack>/Unreal-Godot/UAL1_Standard.glb",
  "hairMesh": "<pack>/Hairstyles/Rigged to Head Bone/glTF (Godot -Unreal)/Hair_Long.gltf",
  "hairVariantValue": "long",
  "out": "assets/models/players/player-partner-v1.glb"
}
```

```bash
node tools/build-player-model.mjs config.json
```

## Per-player checklist

1. Download + unzip both packs (see flow above); apply the texture-name copies.
2. Pick a body; write a config (`out` = the target `player-*.glb`, tweak
   `clipMap`/`socketTranslation` only if needed).
3. `node tools/build-player-model.mjs config.json`.
4. `node tools/validate-player-glb.mjs <out.glb>` — require `paddle_socket: OK`,
   height ~1.7–1.9 m, all 7 clips recognized; slot/arm-sync warnings are
   expected for this asset.
5. Wire it up — for Player 1 just fill the existing manifest `url`; for the
   partner/opponents add a manifest slot **and** flip the `playerModelKey` in
   `src/game.js` (see "Wiring a partner / opponent slot" above).
6. `npm run player:check` + `npm run shots` — **look at the PNGs** (facing,
   paddle, scale vs teammates), then `npm test` + `npm run build`.
7. Keep the primitive rig gameplay-authoritative: do not touch
   `constants/physics/shots/rules/ai/utils`, `HIT.SWING_WINDOW`, or `contactT`.
