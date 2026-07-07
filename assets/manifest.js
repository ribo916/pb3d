/* Optional authored graphics asset slots.
 * Empty URLs are intentional: they reserve stable keys without causing runtime
 * requests. Fill in URLs as assets are authored and optimized.
 */
'use strict';

export const ASSET_MANIFEST = {
  version: 1,
  models: [
    {
      key: 'venue-shared',
      label: 'Shared venue props',
      url: '',
      scope: 'venue',
      optional: true
    },
    {
      key: 'venue-park',
      label: 'Park venue props',
      url: '/assets/models/venues/park-props.glb',
      scope: 'venue',
      venue: 'park',
      optional: true
    },
    {
      key: 'venue-tropical',
      label: 'Tropical venue props',
      url: '/assets/models/venues/tropical-props.glb',
      scope: 'venue',
      venue: 'tropical',
      optional: true
    },
    {
      key: 'venue-indoor',
      label: 'Indoor venue props',
      url: '/assets/models/venues/indoor-props.glb',
      scope: 'venue',
      venue: 'indoor',
      optional: true
    },
    {
      key: 'player-base',
      label: 'Player model prototype',
      url: '',
      scope: 'player',
      playerScale: 1,
      playerOffset: [0, 0, 0],
      playerRotation: [0, 0, 0],
      optional: true
    },
    {
      // First Mixamo-sourced character wired in as a proof of concept (see
      // character-preview/CONTEXT.md). Facing measured via
      // `node tools/validate-player-glb.mjs` (toe-vs-foot points +Z at rest,
      // matching the primitive rig's forward convention, so no rotation
      // correction needed). Bind-pose height measured at 2.12m; playerScale
      // brings it into the ~1.7-1.9m authored-player range. idle/run/ready/
      // serve/backpedal/shuffle come from the shared 'mixamo-locomotion'
      // bucket entry, and forehand/backhand/overhead from 'mixamo-swings'.
      key: 'player-ch12-v1',
      label: 'Mixamo character (ch12)',
      url: '/assets/models/players/mixamo/ch12.glb',
      scope: 'player',
      fallbackKey: 'player-ch01-v1',
      playerScale: 0.85,
      playerOffset: [0, 0, 0],
      playerRotation: [0, 0, 0],
      paddleSocketOffset: [0, 0, 0],
      paddleSocketRotation: [Math.PI, 0, 0],
      // paddle_socket's WORLD scale measured at 0.01 (not 1) -- it's a rigid
      // (non-skinned) node parented under a bone, so it inherits the
      // Blender-export cm->m unit-conversion scale baked onto the top-level
      // Armature wrapper, unlike the skinned mesh itself (whose vertex
      // deformation is computed consistently in that same space). 100x
      // compensates back to the primitive paddle's real-world size.
      paddleSocketScale: 100,
      syncPrimitiveArms: false,
      customizable: false,
      optional: true
    },
    // Remaining Mixamo catalog (ch01-ch11), calibrated the same way as ch12:
    // facing + bind-pose height measured via `node tools/validate-player-glb.mjs`
    // (all 11 report toe-vs-foot +Z, same convention as ch12 and the
    // primitive rig -- no rotation correction needed). playerScale brings
    // each character's bind-pose height to ~1.80m (matching ch12's actual
    // 2.12 * 0.85 = 1.802m). paddleSocketScale/paddleSocketRotation reuse
    // ch12's measured values as a starting point (the underlying Blender
    // cm->m export artifact is confirmed fixed across characters) --
    // visually re-verified per character via the in-menu character picker,
    // not assumed.
    {
      key: 'player-ch01-v1', label: 'Mixamo character (ch01)',
      url: '/assets/models/players/mixamo/ch01.glb', scope: 'player',
      playerScale: 0.97, playerOffset: [0, 0, 0],
      playerRotation: [0, 0, 0], paddleSocketOffset: [0, 0, 0],
      paddleSocketRotation: [Math.PI, 0, 0], paddleSocketScale: 100,
      syncPrimitiveArms: false,
      customizable: false, optional: true
    },
    {
      key: 'player-ch02-v1', label: 'Mixamo character (ch02)',
      url: '/assets/models/players/mixamo/ch02.glb', scope: 'player',
      fallbackKey: 'player-ch01-v1', playerScale: 1.02, playerOffset: [0, 0, 0],
      playerRotation: [0, 0, 0], paddleSocketOffset: [0, 0, 0],
      paddleSocketRotation: [Math.PI, 0, 0], paddleSocketScale: 100,
      syncPrimitiveArms: false,
      customizable: false, optional: true
    },
    {
      key: 'player-ch03-v1', label: 'Mixamo character (ch03)',
      url: '/assets/models/players/mixamo/ch03.glb', scope: 'player',
      fallbackKey: 'player-ch01-v1', playerScale: 1.08, playerOffset: [0, 0, 0],
      playerRotation: [0, 0, 0], paddleSocketOffset: [0, 0, 0],
      paddleSocketRotation: [Math.PI, 0, 0], paddleSocketScale: 100,
      syncPrimitiveArms: false,
      customizable: false, optional: true
    },
    {
      key: 'player-ch04-v1', label: 'Mixamo character (ch04)',
      url: '/assets/models/players/mixamo/ch04.glb', scope: 'player',
      fallbackKey: 'player-ch01-v1', playerScale: 1.12, playerOffset: [0, 0, 0],
      playerRotation: [0, 0, 0], paddleSocketOffset: [0, 0, 0],
      paddleSocketRotation: [Math.PI, 0, 0], paddleSocketScale: 100,
      syncPrimitiveArms: false,
      customizable: false, optional: true
    },
    {
      key: 'player-ch05-v1', label: 'Mixamo character (ch05)',
      url: '/assets/models/players/mixamo/ch05.glb', scope: 'player',
      fallbackKey: 'player-ch01-v1', playerScale: 1.02, playerOffset: [0, 0, 0],
      playerRotation: [0, 0, 0], paddleSocketOffset: [0, 0, 0],
      paddleSocketRotation: [Math.PI, 0, 0], paddleSocketScale: 100,
      syncPrimitiveArms: false,
      customizable: false, optional: true
    },
    {
      key: 'player-ch06-v1', label: 'Mixamo character (ch06)',
      url: '/assets/models/players/mixamo/ch06.glb', scope: 'player',
      fallbackKey: 'player-ch01-v1', playerScale: 1.03, playerOffset: [0, 0, 0],
      playerRotation: [0, 0, 0], paddleSocketOffset: [0, 0, 0],
      paddleSocketRotation: [Math.PI, 0, 0], paddleSocketScale: 100,
      syncPrimitiveArms: false,
      customizable: false, optional: true
    },
    {
      key: 'player-ch07-v1', label: 'Mixamo character (ch07)',
      url: '/assets/models/players/mixamo/ch07.glb', scope: 'player',
      fallbackKey: 'player-ch01-v1', playerScale: 1.01, playerOffset: [0, 0, 0],
      playerRotation: [0, 0, 0], paddleSocketOffset: [0, 0, 0],
      paddleSocketRotation: [Math.PI, 0, 0], paddleSocketScale: 100,
      syncPrimitiveArms: false,
      customizable: false, optional: true
    },
    {
      key: 'player-ch08-v1', label: 'Mixamo character (ch08)',
      url: '/assets/models/players/mixamo/ch08.glb', scope: 'player',
      fallbackKey: 'player-ch01-v1', playerScale: 1.00, playerOffset: [0, 0, 0],
      playerRotation: [0, 0, 0], paddleSocketOffset: [0, 0, 0],
      paddleSocketRotation: [Math.PI, 0, 0], paddleSocketScale: 100,
      syncPrimitiveArms: false,
      customizable: false, optional: true
    },
    {
      key: 'player-ch09-v1', label: 'Mixamo character (ch09)',
      url: '/assets/models/players/mixamo/ch09.glb', scope: 'player',
      fallbackKey: 'player-ch01-v1', playerScale: 1.22, playerOffset: [0, 0, 0],
      playerRotation: [0, 0, 0], paddleSocketOffset: [0, 0, 0],
      paddleSocketRotation: [Math.PI, 0, 0], paddleSocketScale: 100,
      syncPrimitiveArms: false,
      customizable: false, optional: true
    },
    {
      key: 'player-ch10-v1', label: 'Mixamo character (ch10)',
      url: '/assets/models/players/mixamo/ch10.glb', scope: 'player',
      fallbackKey: 'player-ch01-v1', playerScale: 0.99, playerOffset: [0, 0, 0],
      playerRotation: [0, 0, 0], paddleSocketOffset: [0, 0, 0],
      paddleSocketRotation: [Math.PI, 0, 0], paddleSocketScale: 100,
      syncPrimitiveArms: false,
      customizable: false, optional: true
    },
    {
      key: 'player-ch11-v1', label: 'Mixamo character (ch11)',
      url: '/assets/models/players/mixamo/ch11.glb', scope: 'player',
      fallbackKey: 'player-ch01-v1', playerScale: 0.87, playerOffset: [0, 0, 0],
      playerRotation: [0, 0, 0], paddleSocketOffset: [0, 0, 0],
      paddleSocketRotation: [Math.PI, 0, 0], paddleSocketScale: 100,
      syncPrimitiveArms: false,
      customizable: false, optional: true
    }
  ],
  textures: [
    {
      key: 'court-blue-albedo',
      label: 'Blue court albedo',
      url: '',
      scope: 'court',
      optional: true
    },
    {
      key: 'court-green-albedo',
      label: 'Green court albedo',
      url: '',
      scope: 'court',
      optional: true
    }
  ],
  environments: [
    {
      key: 'outdoor-day-env',
      label: 'Outdoor day environment',
      url: '',
      scope: 'environment',
      optional: true
    },
    {
      key: 'outdoor-night-env',
      label: 'Outdoor night environment',
      url: '',
      scope: 'environment',
      optional: true
    },
    {
      key: 'indoor-env',
      label: 'Indoor environment',
      url: '',
      scope: 'environment',
      optional: true
    }
  ],
  animations: [
    {
      key: 'player-idle',
      label: 'Player idle animation',
      url: '',
      scope: 'player-animation',
      optional: true
    },
    {
      key: 'player-run',
      label: 'Player run animation',
      url: '',
      scope: 'player-animation',
      optional: true
    },
    {
      key: 'player-ready',
      label: 'Player ready stance animation',
      url: '',
      scope: 'player-animation',
      optional: true
    },
    {
      key: 'player-forehand',
      label: 'Player forehand animation',
      url: '',
      scope: 'player-animation',
      optional: true
    },
    {
      key: 'player-backhand',
      label: 'Player backhand animation',
      url: '',
      scope: 'player-animation',
      optional: true
    },
    {
      key: 'player-serve',
      label: 'Player serve animation',
      url: '',
      scope: 'player-animation',
      optional: true
    },
    {
      key: 'player-smash',
      label: 'Player smash animation',
      url: '',
      scope: 'player-animation',
      optional: true
    },
    {
      // Shared Mixamo swing-clip library (see tools/build-mixamo-clip-library.mjs).
      // Clip names 'forehand'/'backhand'/'overhead' already match
      // src/players.js's clipKey() regexes directly (-> fh/bh/smash), no
      // renaming needed. Merged onto any player model via collectAnimationClips().
      key: 'mixamo-swings',
      label: 'Mixamo pickleball swing clips',
      url: '/assets/animations/pickleball-swings.glb',
      scope: 'player-animation',
      optional: true
    },
    {
      // Shared locomotion/serve clip library baked from the character-preview's
      // perfected UE5-Manny retargets (see tools/bake-locomotion-clips.mjs).
      // Clip names idle/ready/run/serve/backpedal/shuffle_left/shuffle_right
      // match src/players.js's clipKey() directly (shuffle_left/right split so
      // the game can pick strafe direction from localSide). Merged onto every
      // player model via collectAnimationClips(), same as the swings above.
      key: 'mixamo-locomotion',
      label: 'Mixamo locomotion + serve clips',
      url: '/assets/animations/pickleball-locomotion.glb',
      scope: 'player-animation',
      optional: true
    }
  ]
};
