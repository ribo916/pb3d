# Importing Authored Player Models (Quaternius CC0)

How the two shared base models (`player-male-v1`, `player-female-v1`) used by
all 4 roster slots were built. This is the durable record of the download +
optimization pipeline and the non-obvious traps in it.

Read alongside [`GRAPHICS.md`](GRAPHICS.md) (adapter contract, verification
baseline) and [`assets/README.md`](assets/README.md) (manifest field reference).

> **Superseded**: the roster now uses the 12-character Mixamo pipeline
> instead of these two Quaternius bodies — see [`GRAPHICS.md`](GRAPHICS.md)'s
> "Mixamo Character Pipeline" section and
> [`character-preview/CONTEXT.md`](character-preview/CONTEXT.md) for that
> pipeline's build tools, traps, and open TODOs. `src/characters.js` no
> longer has a `GENDERS` map or a gender-driven character modal — this file
> is kept as the historical record of the Quaternius bodies' build pipeline;
> the facing/paddle-socket/root-motion traps documented below are
> Quaternius-specific and don't carry over to the Mixamo pipeline (which hit
> analogous but distinct traps of its own — a Blender-export
> unit-conversion wrapper, not a 180°-guess problem).

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

# quick form (all defaults, no extra meshes)
node tools/build-player-model.mjs \
  "<pack>/Base Characters/Godot - UE/Superhero_Male_FullBody.gltf" \
  "<pack>/Unreal-Godot/UAL1_Standard.glb" \
  assets/models/players/player-male-v1.glb

# config form (per-gender overrides; player-male-v1/player-female-v1 need this
# to merge in hair/pants via extraMeshes)
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

### Two shared base models, multi-variant hair + facial hair (done — `player-male-v1` / `player-female-v1`)

All 4 roster slots (`nearYou`/`nearMate`/`farA`/`farB`) now share just two
authored GLBs — one male base, one female base — instead of one baked
"character" per slot. Each slot independently picks gender (which selects
the GLB), a hairstyle, a hair color, and (male only) an independent beard
toggle at runtime via `src/characters.js#resolveSlotCharacter`. The old
fantasy "Ranger" opponent outfits (from a different Quaternius pack, see git
history if you need the old approach) are gone entirely; opponents use the
same sport-neutral base bodies as everyone else.

Both free bodies (`Superhero_Male_FullBody.gltf` / `_Female_FullBody.gltf`)
ship bald aside from eyebrows, so each GLB merges **all of that gender's free
hairstyles** as toggleable variant nodes, using the build tool's
`extraMeshes` config field (an array, replacing the older single
`hairMesh`/`hairVariantValue` fields). The male build also merges
`Hair_Beard` under its own `facialHair` variant group (not `hair`) so a
beard can be shown at the same time as any hairstyle, rather than being one
more mutually-exclusive hair option:

```json
{
  "base": "<pack>/Base Characters/Godot - UE/Superhero_Male_FullBody.gltf",
  "anim": "<pack>/Unreal-Godot/UAL1_Standard.glb",
  "extraMeshes": [
    { "path": "<pack>/Hairstyles/Rigged to Head Bone/glTF (Godot -Unreal)/Hair_SimpleParted.gltf", "variantGroup": "hair", "variantValue": "simpleParted" },
    { "path": "<pack>/Hairstyles/Rigged to Head Bone/glTF (Godot -Unreal)/Hair_Buzzed.gltf", "variantGroup": "hair", "variantValue": "buzzed" },
    { "path": "<pack>/Hairstyles/Rigged to Head Bone/glTF (Godot -Unreal)/Hair_Beard.gltf", "variantGroup": "facialHair", "variantValue": "beard" }
  ],
  "out": "assets/models/players/player-male-v1.glb"
}
```

The female build is the same shape with `Superhero_Female_FullBody.gltf` and
hair values `long`/`buns`/`buzzedFemale` (no `facialHair` entry — the female
`GENDERS` entry's `facialHairOptions` is just `['none']`, so the picker never
shows a "Face" row for that gender). All hairstyle meshes come from the same
"Universal Base Characters" pack as the bodies
(`quaternius.itch.io/universal-base-characters`) — same release, same rest
pose, so the retargeting below "just works" for hair without any extra care.

At runtime, `src/players.js`'s generic variant system (`variantGroup`/
`variantValue` node tagging, matched against roster `hairStyle`/
`facialHair`) shows only the chosen mesh per group and hides the rest — no
per-character rebuild needed to change cosmetics, and two different groups
(`hair` + `facialHair`) can both be visible at once since each is resolved
independently.

**Trap: reusing a merged mesh's own inverse-bind matrices breaks when the
mesh comes from a DIFFERENT donor pack than the base body/anim.** Matching
bone *names* is enough to retarget animation channels (rotations are local
and pose-driven either way) but is **not** enough to safely reuse a donor
skin's inverse-bind matrices — those encode the donor's own rest pose, which
can differ from ours even with identical joint names. `build-player-model.mjs`
precomputes each base-skeleton joint's inverse-bind matrix from the base
body's *own* skin once, up front, and reuses that for every merged mesh's new
skin (see the `baseJointInvBind` map), instead of trusting whatever the donor
mesh shipped. Verify any new cross-pack mesh merge by rendering the raw GLB
with no animation applied at all (pure bind pose) — a correctly retargeted
mesh should look clean and undistorted there; if it doesn't, the inverse-bind
data is wrong before pose even enters the picture. This fix stays in place
even though hair no longer strictly needs it (same-pack rest poses already
matched) — it's a correctness fix, not a workaround, and protects the next
cross-pack merge attempt too.

**Retired: a free "peasant pants" attachment was tried and removed.** An
earlier version of this pipeline merged a `Male_Peasant_Legs`/
`Female_Peasant_Legs` mesh (cut from Quaternius's "Modular Character Outfits
- Fantasy" pack) onto these bodies as a `pants` variant group. It never
worked well and was pulled rather than shipped as a permanent workaround —
see the "why doesn't clothing fit" question this always raises:

- Quaternius's **"Universal Base Characters"** pack (the base bodies + hair
  used here) ships **no clothing at all** — bare bodies and hairstyles only,
  confirmed on the pack's own product page.
- Quaternius's **"Modular Character Outfits - Fantasy"** pack (source of the
  peasant-pants mesh) states its outfits are *"Compatible with Universal
  Base Character **heads** but you can use your own too"* — compatibility is
  head-only. Each outfit (Ranger, Peasant, ...) is a complete standalone
  body (its own torso/arms/legs); the pack was never designed to have its
  clothing split apart and layered onto a different body's limbs.
- Practical result: the pants mesh sat almost flush against (and often
  slightly inside) the Superhero body's own thicker leg surface, since it
  was modeled to fit a different, slimmer character. It z-fought with the
  base body — badly during animated poses (running/swinging), where the two
  differently-proportioned rigs bulge differently under the same skeleton
  pose. A `polygonOffset` bias on the pants material (forcing it to always
  win the depth-test tie) mostly papered over this in some poses but not
  reliably across all of them, and it was a rendering-side cheat over a
  genuine geometry mismatch, not a real fix.
- If clothing is revisited, look for CC0/licensed assets explicitly modeled
  to fit "Universal Base Characters" proportions (or plan to reshape a
  donor mesh in a 3D tool first) rather than repeating this shortcut.

### Done: colorable shirt/pants via mesh splitting (`tools/paint-player-clothing.mjs`)

The body now has a runtime-tintable shirt and pants, picked per roster
position in the character customization UI (`GARMENT_COLORS` in
`src/characters.js`, "Shirt"/"Pants" rows in the character modal). This
superseded an earlier version of this tool that baked a single **fixed**
color into the texture (see the v1-v3 history below, kept for the technique
lessons even though the fixed-color approach itself is gone) — a baked color
can't be changed per character at runtime, which is what the color-picker
feature needs.

Both pickers include a `'none'` option (rendered with a diagonal-stripe
swatch, not a real color, deliberately not a key in `GARMENT_COLORS`).
`resolveSlotCharacter` special-cases it to fall back to the character's own
`skin` tone rather than tinting the jersey/shorts primitive — those
primitives can't be geometrically hidden without leaving a hole (their
triangles were removed from the skin primitive's own index buffer, not just
overlaid on top of it), so "no garment" is approximated by making the
region blend back into skin tone rather than truly reverting to the
original textured skin material.

**Current approach: split the body mesh, don't paint it.** The single
`Superhero` body primitive is partitioned into 3 primitives — skin / jersey
/ shorts — by classifying each triangle from its vertices' skinning weights
(same weight-group logic as the old painter: leg joints for pants, spine +
arm-suppressed clavicle for the shirt, see the v1-v3 notes below for why
those groups are shaped the way they are). Skin keeps the original
primitive/material untouched; jersey and shorts become two new sibling
nodes, same skin, same shared position/normal/uv/joints/weights accessors
(just a different index buffer each — no vertex duplication, no z-fighting,
since it's literally the same continuous surface). Each new material gets
its own copy of the base texture, desaturated and contrast-stretched to a
neutral gray band. That makes the EXISTING runtime tinting system in
`players.js` (`applyModelMaterials`/`tintMaterial`/`materialSlot`) — the same
one the primitive rig always used for its own jersey/shorts spheres — treat
these two new nodes exactly like any other jersey/shorts material, multiplying
in whatever `opts.jersey`/`opts.shorts` the roster picks resolve to. No
runtime plumbing had to change; the slot system already existed; the
authored body just wasn't split into tintable pieces before.

`--legs` controls how much leg becomes a colorable "pants" region: `full`
(leggings) or `brief` (a short brief only, trimmed by height to the hip —
bare thighs/calves). Both bodies now use `full` — a male-only `brief` cut
was tried to keep bare thighs/calves, but the hard height-trim needed to
carve out just the hip band lands on coarse mesh geometry there and always
reads as a jagged edge (see the trap notes below). `full` moves that same
hem down to the ankle instead, matching the female body — same underlying
jaggedness, just far less visible at that location:

```bash
node tools/paint-player-clothing.mjs assets/models/players/player-male-v1.glb --legs=full
node tools/paint-player-clothing.mjs assets/models/players/player-female-v1.glb --legs=full
```

Add `--dump-mask` to write a `*-mask-debug.png` (jersey triangles in red,
shorts in blue, dotted at their own vertices) before committing — check this
first if the donor body's rig or UV layout ever changes. This step must be
re-run any time `tools/build-player-model.mjs` regenerates these GLBs from
scratch (it operates on the already-built GLB, so it has to run after, not
before, that pipeline).

**Traps specific to the mesh-split rewrite:**

- **Region luminance range must come from rasterizing the region's own
  triangles, not sampling at vertices.** The neutral texture copy is built by
  contrast-stretching each region's own observed brightness range to a
  standard band (so, e.g., "White" reads as an actual light color even
  though the male brief's source pixels are naturally dark navy/black — a
  fixed global brightness remap left it stuck near-black forever, since
  `material.color` can only multiply a texture darker, never brighten it).
  Sampling luminance only at each triangle's 3 vertex UV positions missed the
  true darkest interior pixels of small regions (the male brief is only
  ~250-1200 triangles), understating how dark the low end of the range
  really was and leaving most of the region clamped near black regardless of
  the stretch. Rasterizing full triangles (same barycentric fill as the old
  painter) to scan every pixel in the region's actual footprint fixed it.
- **`--legs=brief` must trim by bind-pose HEIGHT, not by narrowing the joint
  set.** The obvious-looking approach — classify "pants" using only the
  `pelvis` joint, excluding `thigh_l/r` entirely, so the region stays small —
  undershoots: the male body's baked-in brief graphic visibly extends into
  territory where `thigh_l/r`, not `pelvis`, is the skinning-dominant joint,
  so a pelvis-only group left most of the brief's own pixels stuck on the
  unpainted, untintable skin primitive. Fix: classify by the SAME full leg
  joint group as the female body (so the anatomical boundary is clean), then
  trim the result by each vertex's bind-pose Y position, keeping only the
  top fraction of the leg region's height (near the hip). This fraction is
  measured against the FULL leg span (hip to ankle), not the thigh alone —
  it first went to 0.45 to satisfy `--dump-mask`'s visualization, but that
  tool only draws small dots at each vertex rather than filling triangle
  interiors, so it understated how much of the brief graphic real (filled)
  triangles already covered. 0.45 of the full hip-to-ankle span reaches
  close to knee height — well past the actual brief — and made the (jagged,
  mesh-resolution-limited) boundary visible partway down the thigh, which a
  user later flagged. Corrected down to 0.22. **Verify coverage/boundary
  placement via an actual RENDER, not the dot-mask**, if this ever needs
  retuning — the mask tool is only good for confirming which triangles were
  classified into which bucket, not for judging visual coverage or where a
  boundary will actually land.
- **A `leg >= 0.5` / `torso >= 0.5` "majority" gate leaves a bare gap at the
  true boundary.** Right where two bones split weight close to evenly (the
  actual anatomical seam), NEITHER sum reliably clears 0.5, so those
  vertices fell through to the untinted skin primitive — invisible when
  jersey/shorts were dark like the surrounding skin, but a visible gap
  revealing the body's original texture once a light color was picked (read
  as "doesn't cover the existing shorts/bra"). Fixed by only treating
  near-zero-both vertices as skin (`SKIN_EPS = 0.15`); everywhere else, leg
  vs. torso is a winner-take-all comparison, no 0.5 floor. Combined with
  Laplacian smoothing of the raw per-vertex weight sums (via mesh adjacency
  built from the ORIGINAL index buffer) before classifying, this also
  rounds the seam into a noticeably smoother line — the raw skinning
  weights aren't smooth enough on their own to avoid a jagged "V-cut"
  boundary once split into hard geometry with no texture alpha left to
  soften it. Needed more smoothing than expected to fully round out in
  actual gameplay screenshots (close-up character-preview renders looked
  smooth well before the boundary actually was) — went from 4 iterations to
  25 to the current 45 before a user-flagged remaining rough patch at the
  waist/hem seam actually disappeared. If a seam still reads jagged, try
  raising iterations further before suspecting anything else.
- **Desaturating the source texture is not enough to erase a drawn garment
  graphic — it needs both a blur AND a contrast reduction.** The source bake
  draws the female bra and male brief as actual ink/shading, not simply a
  flat color; desaturating it alone just turns "dark ink" into "dark gray
  ink," which still reads as a printed garment shape once tinted (glaringly
  under a light color — a bra-shaped print on a white shirt). A wide blur
  (`NEUTRAL_BLUR_SIGMA`, ~20px on the 1024px texture) erases fine printed
  linework while leaving broad low-frequency shading alone — but the
  darkest patch on the female chest turned out to be exactly that kind of
  broad, low-frequency shading (the source bake's own AO shadow under the
  bust, the same kind of shading that reads fine as "muscle definition" on
  the male chest but happens to land in bra territory here), so blur alone
  couldn't touch it. The second half of the fix is `CONTRAST_FACTOR` (0.35):
  after normalizing luminance to 0..1, compress it toward 0.5 before mapping
  to the output band, so no single AO feature — printed ink or genuine
  shading — is dark/light enough on its own to read as a distinct garment
  print. `CONTRAST_FACTOR = 1` keeps full original contrast (the ghost
  problem); `0` would be perfectly flat (no fabric shading at all, reads
  flat/plasticky). Current value is 0.15 (lowered from an initial 0.35 that
  still wasn't flat enough).
- **The remaining "shows the body through the fabric" look is NOT a
  texture/material property at all — don't keep tuning texture parameters
  for it.** After the contrast fix above, muscle/anatomy shape (breast form,
  ab lines, deltoid bulges) was still clearly visible under a light color.
  Two more targeted tests — stripping the material's normal map entirely
  (`setNormalTexture(null)`; the base material's `..._Normal` texture bakes
  in the same anatomy as bump detail, and `.clone()` carries that reference
  over unless explicitly cleared) and forcing `roughnessFactor` to `1.0`
  (fully matte, no specular highlight to emphasize form) — each changed the
  render only marginally. That rules out texture-level fixes: the shape
  being seen is the mesh's own REAL 3D sculpted geometry (this is an
  athletic "Superhero" body, genuinely modeled with muscle/anatomy bulges,
  not a flat mannequin), lit by ordinary directional lights. A neutral
  material painted directly onto that geometry will always look like
  athletic compression wear — it can't look like looser, less form-fitting
  clothing — because the surface it's riding on IS the body's exact
  shape. Getting a looser-reading garment from here requires actually
  changing geometry (e.g. inflating/offsetting the jersey/shorts vertices
  outward along their normals and smoothing to blunt anatomical crispness),
  not another material tweak; normal-map removal and `roughnessFactor: 0.85`
  were kept anyway since they're free correctness wins (a garment shouldn't
  carry the body's own bump map), just not the fix for this specific
  complaint.

### v1-v3 history (fixed-color texture painting, since replaced above)

These three rounds happened before the mesh-split rewrite, back when the
tool baked ONE fixed color into the texture instead of making it runtime
tintable. Kept because the underlying weight-group reasoning (why `pelvis`
and `spine_01` are in the leg group, why clavicle is arm-suppressed rather
than flatly capped) still applies unchanged to the current mesh-split code —
only the "paint a pixel" step at the end was replaced by "assign this
triangle to a primitive."

**v1 mistake:** classified each vertex by its single *dominant* joint and
painted whole triangles in/out by majority vote, and sampled the fill color
from the body's own pelvis-region pixels. Both were wrong: dominant-joint
classification flips discontinuously between adjacent vertices even though
the underlying weights are smooth, producing a saw-tooth/jagged boundary,
and restricting the torso group to spine-only left the shoulders bare,
reading as a bra/bikini cut on the male model rather than a tank top.
Pixel-sampling the fill color also picked up whatever tone happened to be
under the pelvis (skin-toned on the female body), instead of a clean fabric
color. Fixed with continuous per-vertex weight SUMS (not a single dominant
joint) interpolated as a paint alpha, plus a fixed neutral fill color.

**v2 mistake:** summing raw `clavicle_l/r` weight uncapped into the torso
group covered the shoulder (fixing the v1 bra look) but also bled down the
front deltoid — this rig's clavicle skin weight reaches further onto the arm
at the front than at the back, so the top read as a symmetric tank top from
behind but a lopsided short-sleeve from the front. First fix tried: a flat
cap (`CLAVICLE_CAP = 0.35`) so clavicle weight alone couldn't cross the paint
threshold. Also added `pelvis` to the leg group, since leaving it unpainted
(it sits between the waistband and thighs) let the body's own baked-in brief
show through as a bare gap between top and leggings.

**v3 mistake:** the flat clavicle cap overcorrected — it suppressed the true
shoulder-top/collar coverage by the same amount as the unwanted arm bleed,
so the top read as if its top edge had been cut away. Replaced with
`UPPERARM_JOINTS` suppression: clavicle's contribution is scaled down only
where `upperarm_l/r` weight is *also* present at that vertex (via
`smoothstep(0.02, 0.15, upperArmWeight)`) — that weight is the actual
skinning signal for "this vertex is out on the arm," so the collar/
shoulder-top (upperarm weight ~0 there) keeps full clavicle coverage while
the sleeve-bleed zone is suppressed. Separately, the hip gap persisted even
with `pelvis` in the leg group — `spine_01` (the waist bone immediately
above pelvis) also carries meaningful weight at the same hip vertices,
diluting both sums below the paint threshold there. Adding `spine_01` to the
leg group too (it was already in the torso group; double-counting is
harmless) closed the gap. Both fixes carry over unchanged to the current
mesh-split classification.

## Reproducing a build from scratch

1. Re-download both packs via the itch.io CSRF flow (GET page → scrape
   `csrf_token` → POST `download_url` → GET the returned download page →
   scrape `data-upload_id` → POST `file/<id>?source=game_download&as_props=1&after_download_lightbox=true`
   → GET the first `url` in that JSON, a signed R2 link expiring in ~60s).
   Apply the texture-filename fixups (copy `T_Hair_1_Normal.png` →
   `T_Hair_1_Normal_png.png`, `T_Eye_Normal.png` → `T_Eye_Normal_png.png`, for
   both base bodies) before building.
2. Write a config.json per gender (see above) and run
   `node tools/build-player-model.mjs config.json`.
3. `node tools/validate-player-glb.mjs <out.glb>` — require `paddle_socket:
   OK`, height ~1.7–1.9 m, all 7 clips recognized; slot/arm-sync warnings are
   expected for this asset (single-material body, see the team-color trap
   above).
4. Wire it up: `assets/manifest.js` `models[]` entry (`player-male-v1`/
   `player-female-v1`), and `src/characters.js`'s `GENDERS` map
   (`playerModelKey`, `hairOptions`, `defaultHair`, `facialHairOptions`).
5. `npm run player:check` + `npm run shots` — **look at the PNGs** (facing,
   paddle, scale vs teammates, hair/facial-hair toggling across all
   combinations), then `npm test` + `npm run build`.
6. Keep the primitive rig gameplay-authoritative: do not touch
   `constants/physics/shots/rules/ai/utils`, `HIT.SWING_WINDOW`, or `contactT`.
